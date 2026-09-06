// edge-functions/api/chat.js
// 在 EdgeOne Pages 边缘节点上反向代理 ZenMux 的 chat/completions，并原样透传 SSE 流。
// API Key 只存在于平台环境变量（Secret），永远不会下发到浏览器。

const UPSTREAM = 'https://zenmux.ai/api/v1/chat/completions';

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

import { verifyUserToken } from './_auth.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    // 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验 8 位用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    if (!payload || !Array.isArray(payload.messages)) {
      return json({ error: '缺少 messages 字段' }, 400);
    }

    // 强制流式与 Token 消耗审计
    payload.stream = true;
    payload.stream_options = { include_usage: true };

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: '连接上游失败', detail: String(e && e.message) }, 502);
    }

    // 边缘自愈重试：若上游因模型不支持特定参数（如 temperature / reasoning_effort / stream_options）返回 400，自动剔除并就地重试
    if (upstream.status === 400) {
      const detail = await upstream.text().catch(() => '');
      let modified = false;

      if (/temperature/i.test(detail) && /(?:deprecated|unsupported|not supported|invalid|disallowed|extra fields)/i.test(detail)) {
        delete payload.temperature;
        modified = true;
      }
      if (/reasoning/i.test(detail) && /(?:deprecated|unsupported|not supported|invalid|disallowed|extra fields)/i.test(detail)) {
        delete payload.reasoning;
        delete payload.reasoning_effort;
        modified = true;
      }
      if (/(?:tools|tool_choice|function)/i.test(detail) && /(?:deprecated|unsupported|not supported|invalid|disallowed|extra fields)/i.test(detail)) {
        delete payload.tools;
        delete payload.tool_choice;
        modified = true;
      }
      if (/stream_options/i.test(detail) && /(?:deprecated|unsupported|not supported|invalid|disallowed|extra fields)/i.test(detail)) {
        delete payload.stream_options;
        modified = true;
      }

      if (modified) {
        try {
          const retryRes = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
          });
          if (retryRes.ok && retryRes.body) {
            return new Response(retryRes.body, {
              status: 200,
              headers: {
                ...CORS,
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
              },
            });
          }
        } catch (retryErr) { }
      }

      return json(
        { error: '上游返回 400', detail: detail.slice(0, 800) },
        400
      );
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return json(
        { error: `上游返回 ${upstream.status}`, detail: detail.slice(0, 800) },
        upstream.status || 502
      );
    }

    // 直接把上游的 ReadableStream 作为响应体返回，零拷贝透传
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // 关键：禁止 Nginx / 网关层缓冲 SSE，否则会攒成一坨一次吐出
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (fatalErr) {
    return json({
      error: '网关内部异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
