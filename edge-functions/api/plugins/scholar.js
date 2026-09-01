// edge-functions/api/plugins/scholar.js
// 在 EdgeOne Pages 边缘节点上代理 Semantic Scholar Graph API，实现学术论文、摘要及引用检索。
// SEMANTIC_SCHOLAR_KEY 为可选 Secret 环境变量（未配置时使用官方公共限速额度）。

const SCHOLAR_ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/search';

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
  const { request, env } = context;

  // 1. 门禁鉴权
  const accessToken = env.ACCESS_TOKEN;
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
    return json({ error: '缺少检索 query 参数' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 5, 1), 10);
  const fields = 'title,authors,year,abstract,citationCount,url,openAccessPdf,externalIds,venue';

  const targetUrl = `${SCHOLAR_ENDPOINT}?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;

  const headers = { 'User-Agent': 'ZenMux-Chat-Scholar-Plugin/2.5' };
  if (env.SEMANTIC_SCHOLAR_KEY) {
    headers['x-api-key'] = env.SEMANTIC_SCHOLAR_KEY;
  }

  let res;
  try {
    res = await fetch(targetUrl, { method: 'GET', headers });
  } catch (e) {
    return json({ error: '连接 Semantic Scholar 服务失败', detail: String(e && e.message) }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json(
      { error: `Semantic Scholar 接口返回 HTTP ${res.status}`, detail: detail.slice(0, 500) },
      res.status || 502
    );
  }

  const result = await res.json().catch(() => null);
  const papers = (result && result.data) || [];

  const formatted = papers.map((p) => {
    const authors = (p.authors || []).map((a) => a.name).slice(0, 5).join(', ');
    const pdfUrl = p.openAccessPdf ? p.openAccessPdf.url : '';
    const doi = (p.externalIds && p.externalIds.DOI) ? `https://doi.org/${p.externalIds.DOI}` : '';
    return {
      title: p.title || 'Untitled Paper',
      authors: authors || 'Unknown Authors',
      year: p.year || 'N/A',
      venue: p.venue || '',
      citationCount: p.citationCount || 0,
      abstract: p.abstract || 'No abstract provided.',
      url: doi || pdfUrl || p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      pdfUrl: pdfUrl,
    };
  });

  return json({ success: true, query, total: result.total || formatted.length, papers: formatted }, 200);
}
