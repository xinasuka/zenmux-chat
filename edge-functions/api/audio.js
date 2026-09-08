// edge-functions/api/audio.js
// 统一语音转文字 (ASR) 边缘网关：运行于腾讯云 EdgeOne Anycast 边缘节点。
// 接收端侧 VAD 降噪切除后的 Base64 音频，通过 EdgeOne KV (ZENMUX_CHAT) 统一鉴权后，
// 安全反向代理至 ZenMux ASR 语音模型集群 (Doubao-Seed-ASR / MiMo / Qwen / Whisper)。

import { CORS, json, verifyUserToken } from './_auth.js';

const UPSTREAM = 'https://zenmux.ai/api/v1/audio/transcriptions';

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

    if (!payload || !payload.audio || typeof payload.audio !== 'string') {
      return json({ error: '缺少必需的 audio (Base64 音频流) 字段' }, 400);
    }

    // 防御性限制：单次语音音频 Base64 体积上限（10MB，约合 5 分钟 16kHz 未压缩 WAV）
    if (payload.audio.length > 10 * 1024 * 1024) {
      return json({ error: '音频数据过大，单次语音输入请限制在 5 分钟以内' }, 413);
    }

    const model = (payload.model && String(payload.model).trim()) || 'bytedance/doubao-seed-asr-2.0';
    const format = (payload.format && String(payload.format).trim().toLowerCase()) || 'wav';

    // 4. 构造符合 ZenMux ASR 统一规范的 JSON 载荷
    const upstreamPayload = {
      model,
      input_audio: {
        data: payload.audio,
        format
      },
      enable_itn: true // 默认开启逆文本正则化 (ITN: 如将“二零二六年”转为“2026年”)
    };

    if (payload.language && typeof payload.language === 'string') {
      upstreamPayload.language = payload.language.trim();
    }

    // 5. 转发上游 ZenMux ASR 语音模型集群
    let upstreamRes;
    try {
      upstreamRes = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ZenMux-Chat-Audio/2.20 (contact@zenmux.ai)'
        },
        body: JSON.stringify(upstreamPayload)
      });
    } catch (netErr) {
      return json({
        error: '连接上游语音识别服务失败',
        detail: String(netErr && netErr.message)
      }, 502);
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '');
      return json({
        error: `上游 ASR 服务返回异常: HTTP ${upstreamRes.status}`,
        detail: errText
      }, upstreamRes.status);
    }

    const result = await upstreamRes.json().catch(() => ({}));
    // 兼容上游可能的多态返回结构: { text: "..." } 或 { data: { text: "..." } }
    const transcript = (typeof result.text === 'string' ? result.text : '')
      || (result.data && typeof result.data.text === 'string' ? result.data.text : '')
      || '';

    return json({
      text: transcript.trim(),
      model
    }, 200);

  } catch (fatalErr) {
    // 终极异常屏障：拦截所有未捕获异常，防止 EdgeOne 抛出 HTTP 545
    return json({
      error: '边缘语音转文字网关执行异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
