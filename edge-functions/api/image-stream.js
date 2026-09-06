// edge-functions/api/image-stream.js
// 在 EdgeOne Pages Anycast 边缘节点上流式透传任意外部图像资源。
// 运行于轻量 V8 Isolate 沙箱（冷启动 <5ms），彻底消除浏览器跨域限制 (CORS)，
// 并支持端侧 IndexedDB 离线归档（零云端存储开销）。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
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

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    // 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验 8 位用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
      return json({ error: '缺少有效的目标 url 参数' }, 400);
    }

    // 从上游对象存储/CDN拉取二进制图像流
    const upstreamRes = await fetch(target, {
      headers: {
        'User-Agent': 'ZenMux-Chat-ImageStream/2.16 (contact@zenmux.ai)',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!upstreamRes.ok) {
      return json({
        error: `上游存储节点响应异常: HTTP ${upstreamRes.status} ${upstreamRes.statusText}`,
      }, 502);
    }

    let contentType = upstreamRes.headers.get('content-type') || '';
    if (!contentType || !contentType.startsWith('image/')) {
      // 依据 URL 扩展名进行防御性 MIME 嗅探
      const lower = target.toLowerCase();
      if (lower.includes('.png')) contentType = 'image/png';
      else if (lower.includes('.jpg') || lower.includes('.jpeg')) contentType = 'image/jpeg';
      else if (lower.includes('.webp')) contentType = 'image/webp';
      else if (lower.includes('.gif')) contentType = 'image/gif';
      else contentType = 'image/png';
    }

    const headers = {
      ...CORS,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    };

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) {
      headers['X-Content-Length'] = contentLength;
    }

    // 零拷贝直接流式返回二进制 Body
    return new Response(upstreamRes.body, {
      status: 200,
      headers,
    });
  } catch (fatalErr) {
    return json({
      error: '边缘图像流式传输异常',
      detail: String(fatalErr && fatalErr.message),
    }, 500);
  }
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, {
    status: res.status,
    headers: res.headers,
  });
}

// 统一路由分发兜底
export async function onRequest(context) {
  const method = (context.request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions(context);
  if (method === 'GET') return onRequestGet(context);
  if (method === 'HEAD') return onRequestHead(context);
  return json({ error: `Method ${method} not allowed` }, 405);
}
