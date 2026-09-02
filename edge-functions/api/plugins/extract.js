// edge-functions/api/plugins/extract.js
// 在 EdgeOne Pages 边缘节点上安全代理 Firecrawl v2 (/v2/scrape)，实现深度网页内容解析与 React/SPA 动态站点抓取。
// FIRECRAWL_API_KEY 存放于服务端 Secret 环境变量，受 ACCESS_TOKEN 统一鉴权保护。

const FIRECRAWL_SCRAPE_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';
const MAX_MARKDOWN_CHARS = 50000; // 50k 字符安全上限，保护模型上下文窗口

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

  // 1. 门禁鉴权：若配置了 ACCESS_TOKEN，则校验请求头
  const accessToken = env.ACCESS_TOKEN ? String(env.ACCESS_TOKEN).trim() : '';
  if (accessToken) {
    const auth = request.headers.get('X-Access-Token') || '';
    if (auth !== accessToken) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  // 2. 检查 FIRECRAWL_API_KEY
  const apiKey = env.FIRECRAWL_API_KEY ? String(env.FIRECRAWL_API_KEY).trim() : '';
  if (!apiKey) {
    return json({
      error: '服务端未配置 FIRECRAWL_API_KEY，请在 EdgeOne 控制台添加环境变量（类型选 Secret）并重新部署。',
      missingKey: true
    }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const targetUrl = (payload && payload.url) ? String(payload.url).trim() : '';
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return json({ error: '缺少有效的目标网页 url 参数（必须以 http:// 或 https:// 开头）' }, 400);
  }

  let scrapeRes;
  try {
    scrapeRes = await fetch(FIRECRAWL_SCRAPE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });
  } catch (e) {
    return json({ error: '连接 Firecrawl 抓取服务失败', detail: String(e && e.message) }, 502);
  }

  if (!scrapeRes.ok) {
    const detail = await scrapeRes.text().catch(() => '');
    return json(
      { error: `Firecrawl 接口返回 HTTP ${scrapeRes.status}`, detail: detail.slice(0, 500) },
      scrapeRes.status || 502
    );
  }

  const result = await scrapeRes.json().catch(() => null);
  if (!result || !result.success) {
    const msg = (result && result.error) || '网页抓取未返回成功状态';
    return json({ error: msg }, 502);
  }

  const data = result.data || {};
  let markdown = data.markdown || '';
  const metadata = data.metadata || {};
  const isTruncated = markdown.length > MAX_MARKDOWN_CHARS;

  if (isTruncated) {
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS) + '\n\n... (内容过长，已截取前 50,000 字符)';
  }

  return json({
    success: true,
    url: targetUrl,
    title: metadata.title || metadata.ogTitle || targetUrl,
    description: metadata.description || metadata.ogDescription || '',
    markdown: markdown,
    length: markdown.length,
    truncated: isTruncated,
    statusCode: metadata.statusCode || 200,
  }, 200);
}
