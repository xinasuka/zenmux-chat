// edge-functions/api/plugins/search.js
// 在 EdgeOne Pages 边缘节点上安全代理 AnySearch (api.anysearch.com)，实现全模型实时联网检索与 RAG 事实增强。
// ANYSEARCH_API_KEY 存放于服务端 Secret 环境变量，受 ACCESS_TOKEN 统一鉴权保护。

import { CORS, json, verifyUserToken } from '../_auth.js';

const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    // 2. 检查 ANYSEARCH_API_KEY
    const apiKey = env.ANYSEARCH_API_KEY ? String(env.ANYSEARCH_API_KEY).trim() : '';
    if (!apiKey) {
      return json({
        error: '服务端未配置 ANYSEARCH_API_KEY，请在 EdgeOne 控制台添加环境变量（类型选 Secret）并重新部署。',
        missingKey: true
      }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const query = (payload && payload.query) ? String(payload.query).trim() : '';
    if (!query) {
      return json({ error: '缺少搜索 query 参数' }, 400);
    }

    const maxResults = Math.min(Math.max(parseInt(payload.max_results, 10) || 5, 1), 20);

    let searchRes;
    try {
      searchRes = await fetch(ANYSEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query,
          max_results: maxResults,
        }),
      });
    } catch (e) {
      return json({ error: '连接 AnySearch 搜索引擎失败', detail: String(e && e.message) }, 502);
    }

    if (!searchRes.ok) {
      const detail = await searchRes.text().catch(() => '');
      return json(
        { error: `AnySearch 接口返回 HTTP ${searchRes.status}`, detail: detail.slice(0, 500) },
        searchRes.status || 502
      );
    }

    const data = await searchRes.json().catch(() => null);
    if (!data) {
      return json({ error: '解析 AnySearch 响应数据失败' }, 502);
    }

    return json(data, 200);
  } catch (fatalErr) {
    return json({
      error: 'AnySearch 插件网关异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
