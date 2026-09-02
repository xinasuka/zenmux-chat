// edge-functions/api/plugins/wiki.js
// 在 EdgeOne Pages 边缘节点上代理 Wikimedia 官方 REST API，提供维基百科权威词条、概念定义与事实检索。
// 100% 免费开源，无需任何 API Key，具备全局 CDN 高速缓存。

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

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const query = (payload && payload.query) ? String(payload.query).trim() : '';
    if (!query) {
      return json({ error: '缺少百科检索 query 参数' }, 400);
    }

    // 2. 语种智能识别与解析
    let lang = (payload && payload.language && payload.language !== 'auto') ? String(payload.language).toLowerCase() : '';
    if (!lang) {
      // 包含中文字符默认使用中文维基百科，否则默认英文
      lang = /[\u4e00-\u9fa5]/.test(query) ? 'zh' : 'en';
    }

    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 3, 1), 5);
    const headers = {
      'User-Agent': 'ZenMux-Chat-WikiPlugin/2.6 (contact@zenmux.ai)',
      'Accept': 'application/json',
    };

    // 3. 执行维基百科搜索
    const searchUrl = `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`;
    let searchRes;
    try {
      searchRes = await fetch(searchUrl, { headers });
    } catch (e) {
      return json({ error: '连接维基百科服务失败', detail: String(e && e.message) }, 502);
    }

    if (!searchRes.ok) {
      const detail = await searchRes.text().catch(() => '');
      return json({ error: `维基百科搜索返回 HTTP ${searchRes.status}`, detail: detail.slice(0, 300) }, searchRes.status || 502);
    }

    const searchData = await searchRes.json().catch(() => null);
    const pages = (searchData && searchData.pages) || [];

    if (!pages.length) {
      return json({
        success: true,
        query,
        language: lang,
        entries: []
      }, 200);
    }

    // 4. 并发拉取前排词条的结构化权威摘要（Summary Endpoint）
    const entryPromises = pages.slice(0, 3).map(async (p) => {
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key || p.title)}`;
      try {
        const sumRes = await fetch(summaryUrl, { headers });
        if (sumRes.ok) {
          const sum = await sumRes.json();
          return {
            title: sum.title || p.title,
            description: sum.description || p.description || '无词条简述',
            extract: sum.extract || p.excerpt ? p.excerpt.replace(/<[^>]+>/g, '') : '暂无详细内容',
            url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key || p.title)}`,
            thumbnail: (sum.thumbnail && sum.thumbnail.source) || (p.thumbnail && p.thumbnail.url ? `https:${p.thumbnail.url}` : null),
          };
        }
      } catch (e) { }

      // 回退使用 search 基础数据
      return {
        title: p.title,
        description: p.description || '无词条简述',
        extract: (p.excerpt || '').replace(/<[^>]+>/g, ''),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key || p.title)}`,
        thumbnail: p.thumbnail && p.thumbnail.url ? `https:${p.thumbnail.url}` : null,
      };
    });

    const entries = await Promise.all(entryPromises);

    return json({
      success: true,
      query,
      language: lang,
      entries
    }, 200);
  } catch (fatalErr) {
    return json({
      error: '维基百科边缘函数内部异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
