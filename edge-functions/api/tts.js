// edge-functions/api/tts.js
// 在 EdgeOne Pages 边缘节点上反向代理微软 Edge TTS 神经语音合成服务，返回标准 MP3 二进制流。
// 全平台（iOS / Android / Safari / Chrome / Firefox）通用无缝播放。

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Access-Token, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// 动态计算微软 Sec-MS-GEC 防伪签名（基于 Windows FileTime Epoch 300秒时间窗口 + SHA256）
async function getSecMsGec() {
  let unixSec = Math.floor(Date.now() / 1000);
  unixSec -= (unixSec % 300);
  const windowsTicks = (BigInt(unixSec) + 11644473600n) * 10000000n;
  const strToHash = `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`;
  const encoded = new TextEncoder().encode(strToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateRandomHex(length = 32) {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. 口令验证（如果配置了 ACCESS_TOKEN）
  const accessToken = env.ACCESS_TOKEN;
  if (accessToken) {
    const auth = request.headers.get('X-Access-Token') || '';
    if (auth !== accessToken) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const text = (body.text || '').trim();
  if (!text) {
    return json({ error: '缺少 text 参数' }, 400);
  }

  const voice = body.voice || 'zh-CN-XiaoxiaoNeural';
  const rate = body.rate || '+0%';
  const pitch = body.pitch || '+0Hz';

  try {
    const secMsGec = await getSecMsGec();
    const connId = generateRandomHex(32);
    const wsUrl = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${connId}`;

    const audioBuffer = await new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (wsInitErr) {
        return reject(wsInitErr);
      }
      ws.binaryType = 'arraybuffer';

      const audioChunks = [];
      const reqId = generateRandomHex(32);
      let timeoutTimer = null;

      timeoutTimer = setTimeout(() => {
        try { ws.close(); } catch (e) {}
        if (audioChunks.length > 0) {
          resolve(concatArrayBuffers(audioChunks));
        } else {
          reject(new Error('TTS 合成超时 (15s)'));
        }
      }, 15000);

      ws.onopen = () => {
        // 1. 发送配置信息
        const configMsg =
          'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: 'false',
                    wordBoundaryEnabled: 'false',
                  },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          });
        ws.send(configMsg);

        // 2. 发送 SSML 标记
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${escapeXml(voice)}'><prosody pitch='${escapeXml(pitch)}' rate='${escapeXml(rate)}'>${escapeXml(text)}</prosody></voice></speak>`;
        const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMsg);
      };

      ws.onmessage = (event) => {
        const data = event.data;
        if (data instanceof ArrayBuffer) {
          const u8 = new Uint8Array(data);
          if (u8.length > 2) {
            const headerLen = (u8[0] << 8) | u8[1];
            if (u8.length > headerLen + 2) {
              const headerStr = new TextDecoder().decode(u8.subarray(2, headerLen + 2));
              if (headerStr.includes('Path:audio')) {
                const audioPart = u8.subarray(headerLen + 2);
                audioChunks.push(audioPart.buffer.slice(audioPart.byteOffset, audioPart.byteOffset + audioPart.byteLength));
              }
            }
          }
        } else if (typeof data === 'string') {
          if (data.includes('Path:turn.end')) {
            clearTimeout(timeoutTimer);
            try { ws.close(); } catch (e) {}
            resolve(concatArrayBuffers(audioChunks));
          }
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timeoutTimer);
        reject(err || new Error('WebSocket 连接失败'));
      };

      ws.onclose = () => {
        clearTimeout(timeoutTimer);
        if (audioChunks.length > 0) {
          resolve(concatArrayBuffers(audioChunks));
        } else {
          reject(new Error('连接关闭且未接收到音频数据'));
        }
      };
    });

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return json({ error: '语音合成失败: ' + (err.message || String(err)) }, 500);
  }
}

function concatArrayBuffers(buffers) {
  let totalLen = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalLen += buffers[i].byteLength;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (let i = 0; i < buffers.length; i++) {
    result.set(new Uint8Array(buffers[i]), offset);
    offset += buffers[i].byteLength;
  }
  return result.buffer;
}
