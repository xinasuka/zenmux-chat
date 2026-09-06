// edge-functions/api/plugins/wiki.js
// 在 EdgeOne Pages 边缘节点上代理 Wikimedia 官方 REST API，提供维基百科权威词条、概念定义与事实检索。
// 100% 免费开源，无需任何 API Key，具备全局 CDN 高速缓存。

import { CORS, json, verifyUserToken } from '../_auth.js';

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

    // 2. 语种智能识别与解析 (支持全球 ISO 语言代码与主流文字脚本自动感知)
    let lang = (payload && payload.language && payload.language !== 'auto') 
      ? String(payload.language).toLowerCase().replace(/[^a-z-]/g, '').trim() 
      : '';

    if (!lang) {
      if (/[\u3040-\u309F\u30A0-\u30FF]/.test(query)) {
        lang = 'ja'; // 日语 (平假名 / 片假名)
      } else if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(query)) {
        lang = 'ko'; // 韩语 (谚文 / 字母)
      } else if (/[\u0400-\u04FF]/.test(query)) {
        lang = 'ru'; // 俄语 (西里尔字母)
      } else if (/[\u0600-\u06FF\u0750-\u077F]/.test(query)) {
        lang = 'ar'; // 阿拉伯语
      } else if (/[\u4E00-\u9FFF]/.test(query)) {
        lang = 'zh'; // 中文 (汉字)
      } else {
        lang = 'en'; // 英文及其他拉丁文字默认路由至全球英文主站
      }
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
