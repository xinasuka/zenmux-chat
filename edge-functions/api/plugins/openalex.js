// edge-functions/api/plugins/openalex.js
// 在 EdgeOne Pages 边缘节点上代理 OpenAlex API，检索 2.5 亿+ 学术文献、论文引用、DOI、作者机构及全文开放获取链接。
// OPENALEX_API_KEY 为可选 Secret 环境变量（配置后可获得 100,000 credits/day 高额度与高速通道）。

const OPENALEX_ENDPOINT = 'https://api.openalex.org/works';
const SELECT_FIELDS = 'id,doi,title,publication_year,cited_by_count,primary_location,open_access,authorships,abstract_inverted_index';

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

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        words[pos] = word;
      }
    }
  }
  return words.filter(Boolean).join(' ').trim();
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
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
    return json({ error: '缺少学术检索 query 参数' }, 400);
  }

  const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 5, 1), 10);
  const apiKey = env.OPENALEX_API_KEY ? String(env.OPENALEX_API_KEY).trim() : '';

  let targetUrl = `${OPENALEX_ENDPOINT}?search=${encodeURIComponent(query)}&per-page=${limit}&select=${SELECT_FIELDS}`;
  if (apiKey) {
    targetUrl += `&api_key=${encodeURIComponent(apiKey)}`;
  }

  const headers = {
    'User-Agent': 'ZenMux-Chat-OpenAlex-Plugin/2.5 (mailto:contact@zenmux.ai)',
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['api-key'] = apiKey;
  }

  let res;
  try {
    res = await fetch(targetUrl, { method: 'GET', headers });
  } catch (e) {
    return json({ error: '连接 OpenAlex 学术数据库失败', detail: String(e && e.message) }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json(
      { error: `OpenAlex 接口返回 HTTP ${res.status}`, detail: detail.slice(0, 500) },
      res.status || 502
    );
  }

  const result = await res.json().catch(() => null);
  const works = (result && result.results) || [];

  const formatted = works.map((w) => {
    const authors = (w.authorships || []).map((a) => (a.author && a.author.display_name) || '').filter(Boolean).slice(0, 6).join(', ');
    const doi = w.doi || '';
    const oaUrl = (w.open_access && w.open_access.oa_url) || '';
    const openAlexUrl = w.id ? (w.id.startsWith('http') ? w.id : `https://openalex.org/${w.id}`) : '';
    const finalUrl = doi || pdfUrl || oaUrl || landingUrl || openAlexUrl;
    const abstract = reconstructAbstract(w.abstract_inverted_index);

    return {
      id: w.id || '',
      title: w.title || 'Untitled Work',
      authors: authors || 'Unknown Authors',
      year: w.publication_year || 'N/A',
      venue: venue || 'Academic Journal / Conference',
      citationCount: w.cited_by_count || 0,
      abstract: abstract || 'No abstract text available in OpenAlex index.',
      url: finalUrl,
      pdfUrl: pdfUrl || oaUrl,
    };
  });

  return json({
    success: true,
    query,
    total: (result && result.meta && result.meta.count) || formatted.length,
    works: formatted
  }, 200);
}
