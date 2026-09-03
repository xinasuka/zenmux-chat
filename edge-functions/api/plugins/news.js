// edge-functions/api/plugins/news.js
// 在 EdgeOne Pages 边缘节点上代理 NewsAPI (newsapi.org)，提供全球主流媒体的实时新闻、头条快讯与时事动态检索。
// NEWSAPI_KEY 为服务端 Secret 环境变量。

const NEWSAPI_ENDPOINT = 'https://newsapi.org/v2/everything';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 门禁鉴权
    const accessToken = env.ACCESS_TOKEN ? String(env.ACCESS_TOKEN).trim() : '';
    if (accessToken) {
      const auth = request.headers.get('X-Access-Token') || '';
      if (auth !== accessToken) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    // 2. 检查 NEWSAPI_KEY
    const apiKey = env.NEWSAPI_KEY ? String(env.NEWSAPI_KEY).trim() : '';
    if (!apiKey) {
      return json({
        error: '服务端未配置 NEWSAPI_KEY，请在 EdgeOne 控制台添加环境变量（类型选 Secret）并重新部署。',
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
      return json({ error: '缺少新闻检索 query 参数' }, 400);
    }

    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 5, 1), 10);
    const sortBy = (payload && payload.sortBy && ['relevancy', 'popularity', 'publishedAt'].includes(payload.sortBy)) ? payload.sortBy : 'publishedAt';
    let targetUrl = `${NEWSAPI_ENDPOINT}?q=${encodeURIComponent(query)}&pageSize=${limit}&sortBy=${sortBy}`;
    if (payload && payload.language) {
      targetUrl += `&language=${encodeURIComponent(payload.language)}`;
    }

    let newsRes;
    try {
      newsRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'ZenMux-Chat-NewsPlugin/2.5 (contact@zenmux.ai)',
        }
      });
    } catch (e) {
      return json({ error: '连接 NewsAPI 新闻服务失败', detail: String(e && e.message) }, 502);
    }

    if (!newsRes.ok) {
      const detail = await newsRes.text().catch(() => '');
      return json(
        { error: `NewsAPI 接口返回 HTTP ${newsRes.status}`, detail: detail.slice(0, 500) },
        newsRes.status || 502
      );
    }

    const data = await newsRes.json().catch(() => null);
    if (!data || data.status !== 'ok') {
      const msg = (data && data.message) || 'NewsAPI 未返回正常数据';
      return json({ error: msg }, 502);
    }

    const articles = (data.articles || []).map((a) => {
      return {
        title: a.title || 'Untitled News',
        source: (a.source && a.source.name) || 'Global News',
        author: a.author || '',
        description: a.description || a.content || '无新闻描述',
        url: a.url || '',
        publishedAt: a.publishedAt || '',
      };
    });

    return json({
      success: true,
      query,
      totalResults: data.totalResults || articles.length,
      articles
    }, 200);
  } catch (fatalErr) {
    return json({
      error: 'NewsAPI 网关内部异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
