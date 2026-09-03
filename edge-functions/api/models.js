// edge-functions/api/models.js
// 透传 ZenMux 的模型列表，供前端下拉选择。同样受 ACCESS_TOKEN 保护。

const UPSTREAM = 'https://zenmux.ai/api/v1/models';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Access-Token, Content-Type',
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

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    const accessToken = env.ACCESS_TOKEN ? String(env.ACCESS_TOKEN).trim() : '';
    if (accessToken) {
      const auth = request.headers.get('X-Access-Token') || '';
      if (auth !== accessToken) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    const r = await fetch(UPSTREAM, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await r.text();

    return new Response(text, {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (fatalErr) {
    return json({
      error: '获取模型列表异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
