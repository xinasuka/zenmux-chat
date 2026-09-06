// edge-functions/api/images.js
// Edge Gatekeeper: 运行于 Anycast 边缘节点，负责全站文生图流量的高速鉴权与入口防护。
// 利用 _auth.js (EdgeOne KV: ZENMUX_CHAT + V8 Isolate 内存缓存) 在 <5ms 内完成用户口令校验与请求清洗，
// 拦截所有非法请求，仅向内部 300 秒长耗时生图容器 (/api/images-worker) 转发合法流量。

import { CORS, json, verifyUserToken } from './_auth.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 边缘统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 与 60s 内存缓存极速校验 (<5ms)
    const auth = await verifyUserToken(request, env, context);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    // 2. 边缘请求体完整性前置清洗（杜绝畸形请求消耗中心云函数算力）
    let bodyText = '';
    try {
      bodyText = await request.text();
    } catch (_) {
      return json({ error: '无法读取请求体内容' }, 400);
    }

    let payload = null;
    try {
      payload = JSON.parse(bodyText);
    } catch (_) {
      return json({ error: '请求体不是合法的 JSON 格式' }, 400);
    }

    if (!payload || !payload.prompt || !String(payload.prompt).trim()) {
      return json({ error: '缺少必需的 prompt 参数' }, 400);
    }

    // 3. 内部受信任转发：构造指向中心机房生图容器 (/api/images-worker) 的受保护子请求
    const internalSecret = (env.ADMIN_TOKEN ? String(env.ADMIN_TOKEN).trim() : '') 
      || (env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : 'zenmux-internal-gatekeeper');

    const workerUrl = new URL('/api/images-worker', request.url);
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('Content-Type', 'application/json');
    forwardHeaders.set('X-Internal-Secret', internalSecret);
    if (auth.user && auth.user.name) {
      forwardHeaders.set('X-Authenticated-User', encodeURIComponent(auth.user.name));
    }

    // 发起边缘至云函数容器的子请求，开启 300 秒长时保持通道
    const workerRes = await fetch(workerUrl.toString(), {
      method: 'POST',
      headers: forwardHeaders,
      body: bodyText,
      eo: {
        timeoutSetting: {
          connectTimeout: 30000,
          readTimeout: 300000,
          writeTimeout: 30000
        }
      }
    });

    // 4. 将云函数的 SSE 心跳与流式响应无损透传给客户端
    const responseHeaders = new Headers(workerRes.headers);
    for (const [k, v] of Object.entries(CORS)) {
      responseHeaders.set(k, v);
    }

    return new Response(workerRes.body, {
      status: workerRes.status,
      statusText: workerRes.statusText,
      headers: responseHeaders
    });

  } catch (fatalErr) {
    return json({
      error: '边缘生图网关转发异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
