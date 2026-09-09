// edge-functions/api/tts.js
// 统一文字转语音 (TTS) 边缘网关：运行于腾讯云 EdgeOne Anycast 边缘节点。
// 通过 EdgeOne KV (ZENMUX_CHAT) 统一鉴权后，安全反向代理至 ZenMux 语音合成模型集群
// (OpenAI TTS-1 / TTS-1-HD / Google Gemini TTS / Qwen-Audio TTS / Grok Voice TTS)，
// 将高拟真二进制音频流直接透明传输至端侧播放。

import { CORS, json, verifyUserToken } from './_auth.js';

const UPSTREAM = 'https://zenmux.ai/api/v1/audio/speech';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 密钥检验与安全清洗（剔除换行与首尾空白，防御 HTTP Header 注入）
    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    // 2. 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 与 60s 内存缓存极速校验 (<5ms)
    const auth = await verifyUserToken(request, env, context);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    // 3. 请求体解析与前置校验
    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return json({ error: '请求体不是合法的 JSON 格式' }, 400);
    }

    if (!payload || !payload.input || typeof payload.input !== 'string' || !payload.input.trim()) {
      return json({ error: '缺少必需的 input (待朗读文本) 字段或内容为空' }, 400);
    }

    // 文本规格化与防御性截断（单次朗读上限 4096 字符）
    const textInput = payload.input.trim().slice(0, 4096);
    const model = (payload.model && String(payload.model).trim()) || 'google/gemini-3.1-flash-tts-preview';
    const voice = (payload.voice && String(payload.voice).trim()) || 'nova';
    const responseFormat = (payload.response_format && String(payload.response_format).trim().toLowerCase()) || 'mp3';
    const speed = typeof payload.speed === 'number' ? Math.max(0.25, Math.min(4.0, payload.speed)) : 1.0;

    // 4. 构造统一 TTS 请求体：上游 ZenMux 强制要求 pcm 格式
    const upstreamPayload = {
      model,
      input: textInput,
      voice,
      response_format: 'pcm',
      speed
    };

    // 5. 反向代理至上游 ZenMux 语音合成模型集群
    let upstreamRes;
    try {
      upstreamRes = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ZenMux-Chat-TTS/2.20 (contact@zenmux.ai)'
        },
        body: JSON.stringify(upstreamPayload)
      });
    } catch (netErr) {
      return json({
        error: '连接上游语音合成服务失败',
        detail: String(netErr && netErr.message)
      }, 502);
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '');
      let errMsg = `上游 TTS 服务返回异常: HTTP ${upstreamRes.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error) {
          errMsg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || errMsg);
        } else if (parsed.message) {
          errMsg = parsed.message;
        }
      } catch (_) {}

      return json({
        error: errMsg,
        detail: errText
      }, upstreamRes.status);
    }

    // 6. 二进制音频流解析与自适应容器封装
    const rawAudioBuffer = await upstreamRes.arrayBuffer();

    // 解析上游返回的采样率（默认为 24000 Hz 神经网络超清标准）
    let sampleRate = 24000;
    const ct = upstreamRes.headers.get('Content-Type') || '';
    const rateMatch = ct.match(/rate=(\d+)/i) || (upstreamRes.headers.get('x-audio-sample-rate') || '').match(/(\d+)/);
    if (rateMatch) {
      sampleRate = parseInt(rateMatch[1], 10);
    }

    const { buffer: finalBuffer, contentType } = pcmToWav(rawAudioBuffer, sampleRate);

    return new Response(finalBuffer, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': contentType,
        'Content-Length': String(finalBuffer.byteLength),
        'Cache-Control': 'public, max-age=86400'
      }
    });

  } catch (fatalErr) {
    // 终极异常屏障：拦截所有未捕获异常，防止 EdgeOne 抛出 HTTP 545
    return json({
      error: '边缘语音合成网关执行异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}

/**
 * 将裸 16-bit Linear PCM 二进制数据无缝封装为标准 RIFF/WAVE 容器，使全平台原生 <audio> 均能无损解码播放
 */
export function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const pcmBytes = new Uint8Array(pcmBuffer);
  // 若上游已携带标准 WAV 容器头 (RIFF...WAVE) 或 MP3 同步字，直接透传
  if (pcmBytes.length >= 4 && pcmBytes[0] === 0x52 && pcmBytes[1] === 0x49 && pcmBytes[2] === 0x46 && pcmBytes[3] === 0x46) {
    return { buffer: pcmBuffer, contentType: 'audio/wav' };
  }
  if (pcmBytes.length >= 2 && pcmBytes[0] === 0xFF && (pcmBytes[1] & 0xE0) === 0xE0) {
    return { buffer: pcmBuffer, contentType: 'audio/mpeg' };
  }

  const dataSize = pcmBytes.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor
  view.setUint8(0, 0x52); // 'R'
  view.setUint8(1, 0x49); // 'I'
  view.setUint8(2, 0x46); // 'F'
  view.setUint8(3, 0x46); // 'F'
  view.setUint32(4, 36 + dataSize, true);
  view.setUint8(8, 0x57);  // 'W'
  view.setUint8(9, 0x41);  // 'A'
  view.setUint8(10, 0x56); // 'V'
  view.setUint8(11, 0x45); // 'E'

  // fmt sub-chunk
  view.setUint8(12, 0x66); // 'f'
  view.setUint8(13, 0x6D); // 'm'
  view.setUint8(14, 0x74); // 't'
  view.setUint8(15, 0x20); // ' '
  view.setUint32(16, 16, true);                                // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);                                 // AudioFormat (1 = Linear PCM)
  view.setUint16(22, numChannels, true);                       // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);                        // SampleRate
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
  view.setUint16(34, bitsPerSample, true);                     // BitsPerSample

  // data sub-chunk
  view.setUint8(36, 0x64); // 'd'
  view.setUint8(37, 0x61); // 'a'
  view.setUint8(38, 0x74); // 't'
  view.setUint8(39, 0x61); // 'a'
  view.setUint32(40, dataSize, true);

  const combined = new Uint8Array(44 + dataSize);
  combined.set(new Uint8Array(header), 0);
  combined.set(pcmBytes, 44);

  return { buffer: combined.buffer, contentType: 'audio/wav' };
}
