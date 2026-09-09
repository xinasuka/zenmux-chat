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

    // 4. 构造统一 TTS 请求体
    const upstreamPayload = {
      model,
      input: textInput,
      voice,
      response_format: responseFormat,
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

    // 6. 二进制音频流透传返回
    const contentType = upstreamRes.headers.get('Content-Type') || (responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg');
    return new Response(upstreamRes.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': contentType,
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
