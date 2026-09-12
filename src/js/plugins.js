// js/plugins.js
// Centralized Plugin Registry, Tool Calling Schema Management, and Multiplexed Tool Execution.

import { getHostname, getSearchCountByDepth, state } from './state.js';
import { MemoryStore } from './memory.js';

export const LS_ACTIVE_PLUGINS = 'zm.plugins.active';

const ALL_PLUGINS = [
  {
    id: 'web_search',
    name: { zh: '实时全网搜索', en: 'Live Web Search' },
    provider: 'AnySearch',
    category: 'search',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
    description: {
      zh: '实时检索全网最新资讯、技术文档与通用网页事实',
      en: 'Search live web facts, technical documentation, coding tutorials, and encyclopedia pages'
    },
    defaultEnabled: true,
    toolSchema: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the live internet for general web information, technical documentation, coding tutorials, encyclopedic facts, company websites, and public pages across the entire web. When looking specifically for breaking journalistic news, headlines, or press reports from media outlets, prefer using `news_search`.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Targeted keyword query optimized for general search engines (concise and specific).'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const count = getSearchCountByDepth(state.searchDepth);
      const res = await fetch('/api/plugins/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, max_results: count })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.code !== 0 && j.code !== undefined && j.error)) {
        throw new Error((j && j.error) || (j && j.message) || ('HTTP ' + res.status));
      }
      const results = (j && j.data && j.data.results) || [];
      return {
        query,
        results: results.map((item) => ({
          title: item.title || 'Web Result',
          url: item.url || '',
          snippet: item.snippet || item.content || ''
        }))
      };
    },
    formatToolResult(data) {
      const results = (data && data.results) || [];
      if (!results.length) return 'No relevant web content found. Please answer based on existing knowledge and inform the user that search returned no matching results.';
      const items = results.map((r, idx) => {
        const domain = getHostname(r.url);
        return `[${idx + 1}] "${r.title}"${domain ? ` (${domain})` : ''}\nURL: ${r.url}\nSnippet: ${(r.snippet || '').trim()}`;
      }).join('\n\n');
      return `Here are the real-time search results retrieved from the web:\n\n${items}\n\nPlease synthesize an answer based on the above information, citing sources using [1], [2] format.`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.results) ? data.results.length : 0;
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Web Search**: \`${query}\` (${count} web references retrieved)\n\n`;
      }
      return `\n\n> ✦ **已联网检索**：\`${query}\` (获取到 ${count} 个网页参考资料)\n\n`;
    },
    getSources(data) {
      return (data && data.results) || [];
    }
  },
  {
    id: 'web_extract',
    name: { zh: '深度网页抓取', en: 'Deep Web Extract' },
    provider: 'Firecrawl v2',
    category: 'search',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    description: {
      zh: '深度抓取单页内容，解析 React/SPA 动态站点并转为 Markdown',
      en: 'Extract full-text clean Markdown content from dynamic React/SPA web pages'
    },
    defaultEnabled: true,
    toolSchema: {
      type: 'function',
      function: {
        name: 'web_extract',
        description: 'Extract and read full-text clean Markdown content from a specific web URL (supports dynamic JavaScript and React/SPA websites). Use this when the user asks to read, analyze, summarize, or inspect a specific link, or when you need full-text reading of a webpage discovered during search.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The complete HTTP/HTTPS URL of the webpage to scrape and extract.'
            }
          },
          required: ['url']
        }
      }
    },
    async execute(args, token) {
      const targetUrl = (args && args.url) ? String(args.url).trim() : '';
      const res = await fetch('/api/plugins/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ url: targetUrl })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return {
        url: j.url || targetUrl,
        title: j.title || targetUrl,
        description: j.description || '',
        markdown: j.markdown || '',
        length: j.length || (j.markdown ? j.markdown.length : 0),
        truncated: !!j.truncated
      };
    },
    formatToolResult(data) {
      if (!data || !data.markdown) return 'Failed to extract valid content from this webpage.';
      const domain = getHostname(data.url);
      return `Here is the full webpage content extracted via Firecrawl:\n\nTitle: ${data.title}${domain ? ` (${domain})` : ''}\nURL: ${data.url}\n\nMarkdown Content:\n${data.markdown}\n\nPlease provide an in-depth analysis, summary, or response based on the above content.`;
    },
    formatCoTMarker(args, data) {
      const url = (data && data.url) || (args && args.url) || '';
      const title = (data && data.title) || url;
      const charCount = (data && data.length) ? data.length : ((data && data.markdown) ? data.markdown.length : 0);
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Web Extracted**: [${title}](${url}) (${charCount} characters)\n\n`;
      }
      return `\n\n> ✦ **已提取网页内容**：[${title}](${url}) (共 ${charCount} 字符)\n\n`;
    },
    getSources(data) {
      if (!data || !data.url) return [];
      return [{
        title: data.title || data.url,
        url: data.url,
        snippet: data.description || (data.markdown ? data.markdown.slice(0, 150) : '')
      }];
    }
  },
  {
    id: 'scholar',
    name: { zh: '学术文献检索', en: 'Academic Scholar Search' },
    provider: 'Semantic Scholar',
    category: 'research',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
    description: {
      zh: '检索 2 亿+ 篇学术论文、核心摘要、作者、引用数及 DOI 论文链接',
      en: 'Search 200M+ academic papers, core abstracts, authors, citations, and DOI links'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'scholar_search',
        description: 'Search academic papers, scientific literature, publications, and citations across all scientific disciplines (computer science, physics, biology, medicine, economics, etc.) via Semantic Scholar.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Academic topic, paper title, author, or research query keywords in English or Chinese.'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const res = await fetch('/api/plugins/scholar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, limit: 5 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return {
        query,
        papers: j.papers || [],
        attempts: j.attempts || 1
      };
    },
    formatToolResult(data) {
      const papers = (data && data.papers) || [];
      if (!papers.length) return 'No academic papers found. Try searching with broader English academic keywords.';
      const items = papers.map((p, idx) => {
        return `[${idx + 1}] [${p.title}](${p.url}) (${p.year})\n- Authors: ${p.authors}\n- Venue: ${p.venue || 'N/A'} (Citations: ${p.citationCount})\n- DOI/Link: ${p.url}\n- Abstract: ${p.abstract}`;
      }).join('\n\n');
      return `Here are the academic publications retrieved via Semantic Scholar:\n\n${items}\n\nPlease provide rigorous academic analysis. When citing papers in your answer, format them as Markdown links [Paper Title](URL) with reference numbers [1], [2].`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.papers) ? data.papers.length : 0;
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Academic Literature**: \`${query}\` (${count} papers & citations retrieved)\n\n`;
      }
      return `\n\n> ✦ **已检索学术文献**：\`${query}\` (获取到 ${count} 篇学术论文与引用)\n\n`;
    },
    getSources(data) {
      const isEn = state && state.lang === 'en';
      return ((data && data.papers) || []).map((p) => ({
        title: `《${p.title}》 (${p.year})`,
        url: p.url,
        snippet: isEn
          ? `Authors: ${p.authors} · Citations: ${p.citationCount} · ${p.abstract.slice(0, 150)}`
          : `作者: ${p.authors} · 引用: ${p.citationCount} · ${p.abstract.slice(0, 150)}`
      }));
    }
  },
  {
    id: 'openalex',
    name: { zh: 'OpenAlex 学术智库', en: 'OpenAlex Research Graph' },
    provider: 'OpenAlex API',
    category: 'research',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    description: {
      zh: '检索全球 2.5 亿+ 篇学术文献、引用网络、作者机构与开放获取 DOI',
      en: 'Search 250M+ scholarly works, citation graphs, author institutions, and open-access DOIs'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'openalex_search',
        description: 'Search academic research papers, scholarly literature, journal articles, and citations across OpenAlex open scientific graph database.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Scientific keywords, academic paper title, or author name in English or Chinese.'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const res = await fetch('/api/plugins/openalex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, limit: 5 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return {
        query,
        works: j.works || []
      };
    },
    formatToolResult(data) {
      const works = (data && data.works) || [];
      if (!works.length) return 'No matching scholarly works found in the OpenAlex database.';
      const items = works.map((w, idx) => {
        return `[${idx + 1}] [${w.title}](${w.url}) (${w.year})\n- Authors: ${w.authors}\n- Venue: ${w.venue} (Citations: ${w.citationCount})\n- DOI/Link: ${w.url}\n- Abstract: ${w.abstract}`;
      }).join('\n\n');
      return `Here are the scholarly works retrieved via OpenAlex:\n\n${items}\n\nPlease synthesize an in-depth academic summary. Cite papers using Markdown links [Paper Title](URL) with reference numbers [1], [2].`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.works) ? data.works.length : 0;
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **OpenAlex Graph**: \`${query}\` (${count} works & citations retrieved)\n\n`;
      }
      return `\n\n> ✦ **已检索 OpenAlex 文献**：\`${query}\` (获取到 ${count} 篇学术文献与引用)\n\n`;
    },
    getSources(data) {
      const isEn = state && state.lang === 'en';
      return ((data && data.works) || []).map((w) => ({
        title: `《${w.title}》 (${w.year})`,
        url: w.url,
        snippet: isEn
          ? `Authors: ${w.authors} · Citations: ${w.citationCount} · ${w.abstract.slice(0, 150)}`
          : `作者: ${w.authors} · 引用: ${w.citationCount} · ${w.abstract.slice(0, 150)}`
      }));
    }
  },
  {
    id: 'wiki',
    name: { zh: '维基百科知识库', en: 'Wikipedia Knowledge' },
    provider: 'Wikimedia Foundation',
    category: 'research',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><line x1="9" y1="7" x2="15" y2="7"></line><line x1="9" y1="11" x2="15" y2="11"></line></svg>`,
    description: {
      zh: '检索维基百科 6,000 万+ 权威多语种百科词条、科学概念定义、历史事件与事实溯源',
      en: 'Search 60M+ Wikipedia encyclopedia articles, definitions, and peer-reviewed facts'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'wiki_search',
        description: 'Search Wikipedia for authoritative encyclopedia articles, concept definitions, scientific principles, historical events, notable people, and peer-reviewed facts across global languages (English, Chinese, Japanese, German, French, Korean, etc.). Best for objective knowledge, entity overviews, and structured background information.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The encyclopedia topic, concept, historical event, or entity keyword to look up (e.g. "Quantum Computing", "General Relativity", "Turing Award", "Renaissance").'
            },
            language: {
              type: 'string',
              description: 'Optional ISO language code (e.g. "zh", "en", "ja", "de", "fr", "es", "ko", "ru", "it", "pt", or "auto"). Defaults to "auto" which intelligently detects language from query script.'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const language = (args && args.language) ? String(args.language).trim() : 'auto';
      const res = await fetch('/api/plugins/wiki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, language, limit: 3 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return j;
    },
    formatToolResult(data) {
      const entries = (data && data.entries) || [];
      const langNames = { zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', ru: 'Russian', pt: 'Portuguese', ar: 'Arabic' };
      const langLabel = langNames[data.language] || (data.language ? data.language.toUpperCase() : 'Global');
      if (!entries.length) return `No Wikipedia (${langLabel}) articles matched the query "${data.query}".`;
      const items = entries.map((e, idx) => {
        return `[${idx + 1}] [${e.title}](${e.url})\n- Definition/Overview: ${e.description}\n- Summary: ${e.extract}`;
      }).join('\n\n');
      return `Here are the authoritative Wikipedia (${langLabel}) articles:\n\n${items}\n\nPlease synthesize an objective and rigorous response. When citing articles, use Markdown links [Article Title](URL) with reference numbers [1], [2].`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.entries) ? data.entries.length : 0;
      const isEn = state && state.lang === 'en';
      const langNamesZh = { zh: '中文', en: '英文', ja: '日语', ko: '韩语', de: '德语', fr: '法语', es: '西语', it: '意语', ru: '俄语', pt: '葡语', ar: '阿语' };
      const langNamesEn = { zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', ru: 'Russian', pt: 'Portuguese', ar: 'Arabic' };
      const langLabel = isEn ? (langNamesEn[data.language] || (data.language ? data.language.toUpperCase() : 'Global')) : (langNamesZh[data.language] || (data.language ? data.language.toUpperCase() : '全球'));
      if (isEn) {
        return `\n\n> ✦ **Wikipedia Knowledge** (${langLabel}): \`${query}\` (${count} encyclopedia summaries retrieved)\n\n`;
      }
      return `\n\n> ✦ **已查阅维基百科** (${langLabel})：\`${query}\` (获取到 ${count} 个权威词条概述)\n\n`;
    },
    getSources(data) {
      const isEn = state && state.lang === 'en';
      return ((data && data.entries) || []).map((e) => ({
        title: isEn ? `Wikipedia: ${e.title}` : `维基百科: ${e.title}`,
        url: e.url,
        snippet: `${e.description} · ${e.extract.slice(0, 150)}`
      }));
    }
  },
  {
    id: 'news',
    name: { zh: '全球时事新闻', en: 'Global News Feed' },
    provider: 'NewsAPI.org',
    category: 'news',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><path d="M18 14h-8"></path><path d="M15 18h-5"></path><path d="M10 6h8v4h-8V6Z"></path></svg>`,
    description: {
      zh: '检索全球 80,000+ 权威新闻媒体的实时头条快讯与深度时事报道',
      en: 'Search breaking headlines, press releases, and editorial coverage from 80,000+ news outlets'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'news_search',
        description: 'Search journalistic news articles, breaking international headlines, press releases, and editorial media coverage from 80,000+ trusted news agencies and journalism outlets worldwide via NewsAPI. For technical documentation, developer tutorials, company homepages, or general encyclopedic search, prefer `web_search`.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Targeted news search topic or current event keywords (e.g. "G7 summit climate agreement", "Federal Reserve interest rates").'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const res = await fetch('/api/plugins/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, limit: 5 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return {
        query,
        articles: j.articles || []
      };
    },
    formatToolResult(data) {
      const articles = (data && data.articles) || [];
      if (!articles.length) return 'No relevant news articles found.';
      const items = articles.map((a, idx) => {
        return `[${idx + 1}] "${a.title}"\n- Source: ${a.source} (Published: ${a.publishedAt})\n- Link: ${a.url}\n- Description: ${a.description}`;
      }).join('\n\n');
      return `Here are the latest news articles retrieved via NewsAPI:\n\n${items}\n\nPlease synthesize an objective analysis and cite sources using [1], [2] format.`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.articles) ? data.articles.length : 0;
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Global News**: \`${query}\` (${count} news articles retrieved)\n\n`;
      }
      return `\n\n> ✦ **已检索全球新闻**：\`${query}\` (获取到 ${count} 条最新新闻资讯)\n\n`;
    },
    getSources(data) {
      const isEn = state && state.lang === 'en';
      return ((data && data.articles) || []).map((a) => ({
        title: `《${a.title}》 (${a.source})`,
        url: a.url,
        snippet: isEn ? `Published: ${a.publishedAt} · ${a.description}` : `发布: ${a.publishedAt} · ${a.description}`
      }));
    }
  },
  {
    id: 'weather',
    name: { zh: '全球精准气象', en: 'Global Weather Forecast' },
    provider: 'Open-Meteo',
    category: 'utility',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
    description: {
      zh: '免 Key 查询全球任意城市的实时气温、湿度、降水及 7 日天气预报',
      en: 'Live weather, temperature, humidity, precipitation, and 7-day forecast for any global city'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'weather_forecast',
        description: 'Get real-time live weather conditions, temperature, humidity, wind, and 7-day weather forecasts for any city or location in the world.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name or geographical location (e.g. "Beijing", "Tokyo", "London", "Paris", "New York").'
            }
          },
          required: ['location']
        }
      }
    },
    async execute(args, token) {
      const location = (args && args.location) ? String(args.location).trim() : '';
      const res = await fetch('/api/plugins/weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ location })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return j;
    },
    formatToolResult(data) {
      if (!data || !data.current) return 'Unable to retrieve weather data for the specified location.';
      const cur = data.current;
      const forecastLines = (data.forecast || []).map((f) => {
        return `- ${f.date}: ${f.condition}, Temp: ${f.minTemp} ~ ${f.maxTemp}, Precipitation: ${f.precipitation}`;
      }).join('\n');

      return `Weather data for ${data.location}:\n\n[Current Conditions]:\n- Temperature: ${cur.temperature} (Feels like: ${cur.apparentTemperature})\n- Condition: ${cur.condition}\n- Humidity: ${cur.humidity}\n- Wind: ${cur.windSpeed}\n- Precipitation: ${cur.precipitation}\n\n[7-Day Forecast]:\n${forecastLines}\n\nPlease summarize the weather conditions and provide helpful suggestions for activities and dressing.`;
    },
    formatCoTMarker(args, data) {
      const loc = (data && data.location) || (args && args.location) || '';
      const cur = data && data.current;
      const temp = cur ? cur.temperature : '';
      const cond = cur ? cur.condition : '';
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Weather Forecast**: ${loc}${temp ? ` (${temp}, ${cond})` : ''}\n\n`;
      }
      return `\n\n> ✦ **已查询气象数据**：${loc}${temp ? ` (当前气温 ${temp}, ${cond})` : ''}\n\n`;
    },
    getSources() {
      return [];
    }
  },
  {
    id: 'github',
    name: { zh: 'GitHub 开源探索', en: 'GitHub Explorer' },
    provider: 'GitHub REST API',
    category: 'dev',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`,
    description: {
      zh: '搜索探索 GitHub 热门开源项目，或查询指定仓库详情、Star 榜单与最新 Release',
      en: 'Search trending open-source repositories, inspect stars, topics, README summaries, and releases'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'github_search',
        description: 'Search and explore GitHub repositories, discover trending/popular open-source projects by keywords or topics (e.g., "AI agent", "web framework", "stars:>1000 language:rust"), or inspect a specific repository (e.g. "facebook/react", "zustand") to retrieve stars, forks, latest release version, topics, description, and link.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search keywords, topic, technology name, or specific repository name (e.g. "trending AI agents", "react state management", "pmndrs/zustand", "facebook/react").'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && (args.query || args.repo)) ? String(args.query || args.repo).trim() : '';
      const res = await fetch('/api/plugins/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, limit: 5 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return j;
    },
    formatToolResult(data) {
      if (!data) return 'Unable to retrieve GitHub information.';
      if (data.mode === 'repo' && data.repo) {
        const r = data.repo;
        return `GitHub Repository Details for [${r.fullName}](${r.htmlUrl}):\n\n- Description: ${r.description}\n- Metrics: ⭐ ${r.stars.toLocaleString()} Stars | 🍴 ${r.forks.toLocaleString()} Forks | ❗ ${r.openIssues} Issues\n- Primary Language: ${r.language}\n- License: ${r.license}\n- Latest Release: ${r.latestRelease}\n- Topics: ${(r.topics || []).join(', ') || 'None'}\n\nPlease provide a detailed overview of this repository, its popularity, and tech stack.`;
      }
      const repos = data.repos || [];
      if (!repos.length) return `No GitHub repositories found matching "${data.query}".`;
      const items = repos.map((r, idx) => {
        return `[${idx + 1}] [${r.fullName}](${r.htmlUrl})\n- Description: ${r.description}\n- Metrics: ⭐ ${r.stars.toLocaleString()} Stars | 🍴 ${r.forks.toLocaleString()} Forks | Language: ${r.language}\n- Topics: ${(r.topics || []).join(', ') || 'None'}`;
      }).join('\n\n');
      return `Here are the trending/relevant open-source repositories from GitHub:\n\n${items}\n\nPlease compare and recommend suitable projects, citing sources using [1], [2].`;
    },
    formatCoTMarker(args, data) {
      const isEn = state && state.lang === 'en';
      if (data && data.mode === 'repo' && data.repo) {
        const r = data.repo;
        const stars = r.stars ? ` (⭐ ${r.stars.toLocaleString()})` : '';
        if (isEn) {
          return `\n\n> ✦ **GitHub Repository**: [${r.fullName}](${r.htmlUrl})${stars}\n\n`;
        }
        return `\n\n> ✦ **已分析 GitHub 仓库**：[${r.fullName}](${r.htmlUrl})${stars}\n\n`;
      }
      const query = (data && data.query) || (args && (args.query || args.repo)) || '';
      const count = (data && data.repos) ? data.repos.length : 0;
      if (isEn) {
        return `\n\n> ✦ **GitHub Search**: \`${query}\` (${count} repositories found)\n\n`;
      }
      return `\n\n> ✦ **已检索 GitHub 开源项目**：\`${query}\` (发现 ${count} 个相关热门开源仓库)\n\n`;
    },
    getSources(data) {
      if (data && data.mode === 'repo' && data.repo) {
        const r = data.repo;
        return [{
          title: `GitHub: ${r.fullName}`,
          url: r.htmlUrl,
          snippet: `⭐ ${r.stars} Stars · ${r.language} · ${r.description}`
        }];
      }
      return ((data && data.repos) || []).map((r) => ({
        title: `GitHub: ${r.fullName} (⭐ ${r.stars.toLocaleString()})`,
        url: r.htmlUrl,
        snippet: `${r.language} · ${r.description}`
      }));
    }
  },
  {
    id: 'finance',
    name: { zh: '全球金融市场', en: 'Global Financial Markets' },
    provider: 'CoinGecko & Finnhub & Forex',
    category: 'utility',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
    description: {
      zh: '免 Key 实时查询加密货币（BTC/ETH/SOL）、全球法定汇率换算及美股股票实时行情',
      en: 'Real-time cryptocurrency quotes (BTC/ETH/SOL), fiat exchange rates, and US stock quotes'
    },
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'finance_market',
        description: 'Get real-time financial market data, including cryptocurrency prices and 24h changes (Bitcoin, Ethereum, Solana, Altcoins), global fiat exchange rates and currency conversion (USD/CNY, EUR, JPY, GBP), and US/global stock quotes (NVDA, AAPL, TSLA, SPY).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Target asset ticker, company name, cryptocurrency, or currency pair (e.g. "NVDA", "AAPL", "TSLA", "BTC", "Solana", "USD/CNY", "Nvidia", "Bitcoin").'
            },
            asset_type: {
              type: 'string',
              enum: ['stock', 'crypto', 'forex', 'auto'],
              description: 'Optional asset category. Explicitly set to "stock" for companies and equities (e.g. NVDA, AAPL, TSLA), "crypto" for cryptocurrencies (BTC, ETH, SOL), "forex" for currency exchange rates (USD/CNY), or "auto".'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const asset_type = (args && args.asset_type) ? String(args.asset_type).trim() : 'auto';
      const res = await fetch('/api/plugins/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query, asset_type })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return j;
    },
    formatToolResult(data) {
      if (!data) return 'Unable to retrieve financial market data.';
      if (data.assetType === 'crypto') {
        const changeStr = data.change24hUsd !== undefined ? `${data.change24hUsd >= 0 ? '+' : ''}${data.change24hUsd.toFixed(2)}%` : 'N/A';
        const volStr = data.volume24hUsd ? `$${(data.volume24hUsd / 1e8).toFixed(2)}00M` : 'N/A';
        const capStr = data.marketCapUsd ? `$${(data.marketCapUsd / 1e8).toFixed(2)}00M` : 'N/A';
        return `Cryptocurrency Market Data for [${data.coinId.toUpperCase()}]:\n\n- USD Price: $${Number(data.priceUsd).toLocaleString()}\n- CNY Price: ¥${Number(data.priceCny).toLocaleString()}\n- 24h Change: ${changeStr}\n- 24h Volume: ${volStr}\n- Market Cap: ${capStr}\n- Source: [CoinGecko](${data.url})\n\nPlease provide an objective summary of current price movements and market performance.`;
      }
      if (data.assetType === 'forex') {
        const rateLines = Object.entries(data.rates || {}).map(([c, r]) => `- 1 ${data.baseCurrency} = ${r} ${c}`).join('\n');
        return `Live Foreign Exchange Rates based on [${data.baseCurrency}] (Updated: ${data.lastUpdated}):\n\n${rateLines}\n\nPlease provide accurate exchange rate conversions and financial calculations.`;
      }
      if (data.assetType === 'stock') {
        const changeStr = data.percentChange !== undefined ? `${data.percentChange >= 0 ? '+' : ''}${Number(data.percentChange).toFixed(2)}% ($${data.change >= 0 ? '+' : ''}${Number(data.change).toFixed(2)})` : 'N/A';
        const metaInfo = [
          data.industry && data.industry !== 'N/A' ? `Industry: ${data.industry}` : '',
          data.marketCap && data.marketCap !== 'N/A' ? `Market Cap: ${data.marketCap}` : '',
          data.exchange ? `Exchange: ${data.exchange}` : ''
        ].filter(Boolean).join(' | ');
        return `Stock Quote for [${data.symbol}] (${data.companyName}):\n\n- Current Price: $${Number(data.currentPrice).toFixed(2)}\n- Today's Change: ${changeStr}\n- Day Range: $${Number(data.lowPrice).toFixed(2)} - $${Number(data.highPrice).toFixed(2)}\n- Open / Prev Close: $${Number(data.openPrice).toFixed(2)} / $${Number(data.prevClose).toFixed(2)}\n${metaInfo ? `- Overview: ${metaInfo}\n` : ''}- Chart Link: [Yahoo Finance](${data.url})\n\nPlease interpret today's price movements and company fundamentals.`;
      }
      if (data.assetType === 'overview') {
        const btc = data.crypto && data.crypto.bitcoin ? `$${Number(data.crypto.bitcoin.usd).toLocaleString()} (${data.crypto.bitcoin.usd_24h_change >= 0 ? '+' : ''}${data.crypto.bitcoin.usd_24h_change?.toFixed(2)}%)` : 'N/A';
        const eth = data.crypto && data.crypto.ethereum ? `$${Number(data.crypto.ethereum.usd).toLocaleString()} (${data.crypto.ethereum.usd_24h_change >= 0 ? '+' : ''}${data.crypto.ethereum.usd_24h_change?.toFixed(2)}%)` : 'N/A';
        const fxCny = data.forex && data.forex.CNY ? `1 USD = ${data.forex.CNY} CNY` : 'N/A';
        const fxEur = data.forex && data.forex.EUR ? `1 USD = ${data.forex.EUR} EUR` : 'N/A';
        return `Key Global Financial Market Benchmarks:\n\n- Bitcoin (BTC): ${btc}\n- Ethereum (ETH): ${eth}\n- USD / CNY: ${fxCny}\n- USD / EUR: ${fxEur}\n${data.note ? `\n> Note: ${data.note}` : ''}`;
      }
      return 'No valid market quote found for the specified asset.';
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const isEn = state && state.lang === 'en';
      const typeMapZh = { crypto: '加密货币', forex: '外汇汇率', stock: '股票行情', overview: '大盘概览' };
      const typeMapEn = { crypto: 'Crypto', forex: 'Forex', stock: 'Stock Quote', overview: 'Market Overview' };
      const typeLabel = isEn ? (typeMapEn[data && data.assetType] || 'Financial Market') : (typeMapZh[data && data.assetType] || '金融市场');
      if (isEn) {
        return `\n\n> ✦ **Financial Markets** (${typeLabel}): \`${query}\`\n\n`;
      }
      return `\n\n> ✦ **已获取金融行情** (${typeLabel})：\`${query}\`\n\n`;
    },
    getSources(data) {
      if (!data) return [];
      const isEn = state && state.lang === 'en';
      if (data.assetType === 'crypto') {
        return [{
          title: `CoinGecko: ${data.coinId.toUpperCase()}`,
          url: data.url || `https://www.coingecko.com/en/coins/${data.coinId}`,
          snippet: isEn
            ? `Price: $${data.priceUsd} · 24h Change: ${data.change24hUsd?.toFixed(2)}%`
            : `现价: $${data.priceUsd} (¥${data.priceCny}) · 24h 涨跌: ${data.change24hUsd?.toFixed(2)}%`
        }];
      }
      if (data.assetType === 'stock') {
        return [{
          title: `Stock Quote: ${data.symbol}`,
          url: data.url,
          snippet: isEn
            ? `${data.companyName} · Price: $${data.currentPrice} · Change: ${data.percentChange?.toFixed(2)}%`
            : `${data.companyName} · 现价: $${data.currentPrice} · 涨跌: ${data.percentChange?.toFixed(2)}%`
        }];
      }
      if (data.assetType === 'forex') {
        return [{
          title: `ExchangeRate-API (${data.baseCurrency})`,
          url: 'https://www.exchangerate-api.com',
          snippet: isEn
            ? `Base Currency: ${data.baseCurrency} · Updated: ${data.lastUpdated}`
            : `基准货币: ${data.baseCurrency} · 更新时间: ${data.lastUpdated}`
        }];
      }
      return [];
    }
  },
  {
    id: 'code_eval',
    name: { zh: '代码与数学沙盒', en: 'Code & Math Sandbox' },
    provider: 'In-Browser JS/Wasm',
    category: 'compute',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
    description: {
      zh: '在隔离沙盒中安全执行 JavaScript 代码与高精度数学公式，验证算法、统计与多步推导',
      en: 'Safely execute JavaScript and high-precision math in an isolated browser sandbox'
    },
    defaultEnabled: true,
    toolSchema: {
      type: 'function',
      function: {
        name: 'code_eval',
        description: 'Execute JavaScript code safely in a client-side isolated sandbox for precise mathematical calculations, financial formulas (compound interest, loan amortization), statistical analysis, date offsets, array transformations, and algorithmic verification. Both the completion value and console.log outputs are returned.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'The JavaScript code to execute. Can define variables, multi-line logic, loops, Math functions, and return or evaluate expressions.'
            }
          },
          required: ['code']
        }
      }
    },
    async execute(args) {
      const code = (args && args.code) ? String(args.code) : '';
      return await runSandboxedCode(code, 2500);
    },
    formatCoTMarker(args, data) {
      const code = (args && args.code) ? String(args.code).trim() : '';
      const preview = code.replace(/\s+/g, ' ').slice(0, 45) + (code.length > 45 ? '...' : '');
      const timeStr = data && data.executionTimeMs !== undefined ? ` (${data.executionTimeMs}ms)` : '';
      if (state && state.lang === 'en') {
        return `\n\n> ✦ **Code & Math Sandbox**: \`${preview}\`${timeStr}\n\n`;
      }
      return `\n\n> ✦ **已安全执行代码与数学运算**：\`${preview}\`${timeStr}\n\n`;
    },
    formatToolResult(data) {
      if (!data) return 'Execution completed with no return value.';
      if (!data.success) {
        let errOut = `Code execution failed (Runtime Error): ${data.error || 'Unknown runtime error'}`;
        if (data.logs && data.logs.length) {
          errOut += `\nConsole Output (console.log):\n${data.logs.join('\n')}`;
        }
        return errOut;
      }
      let out = `Code executed successfully (Elapsed: ${data.executionTimeMs || 0}ms)`;
      if (data.logs && data.logs.length) {
        out += `\nConsole Output (console.log):\n${data.logs.join('\n')}`;
      }
      let resStr = typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : String(data.result);
      if (data.result !== undefined && resStr !== (data.logs && data.logs.join('\n'))) {
        out += `\nReturn Value: ${resStr}`;
      } else if (!data.logs || !data.logs.length) {
        out += `\nReturn Value: ${resStr}`;
      }
      return out;
    },
    getSources() {
      return [];
    }
  }
];

export function runSandboxedCode(code, timeoutMs = 2500) {
  const startTime = Date.now();
  const codeToRun = String(code || '').trim();

  if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    return new Promise((resolve) => {
      const workerScript = `
        self.onmessage = function(e) {
          var logs = [];
          var customConsole = {
            log: function() { logs.push(Array.prototype.slice.call(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
            info: function() { logs.push(Array.prototype.slice.call(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
            warn: function() { logs.push(Array.prototype.slice.call(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
            error: function() { logs.push(Array.prototype.slice.call(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); }
          };
          self.console = customConsole;
          try {
            var fn = new Function('console', 'Math', 'Date', 'JSON', 'Array', 'Object', 'Number', 'String', 'RegExp',
              '"use strict";\\n' +
              'var fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, importScripts = undefined, indexedDB = undefined;\\n' +
              'return eval(' + JSON.stringify(e.data.code) + ');'
            );
            var res = fn(customConsole, Math, Date, JSON, Array, Object, Number, String, RegExp);
            self.postMessage({
              success: true,
              result: res !== undefined ? res : (logs.length ? logs.join('\\n') : 'Execution succeeded (no return value)'),
              logs: logs
            });
          } catch (err) {
            self.postMessage({
              success: false,
              error: err.message || String(err),
              logs: logs
            });
          }
        };
      `;

      let blobUrl = '';
      let worker = null;
      try {
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        blobUrl = URL.createObjectURL(blob);
        worker = new Worker(blobUrl);
      } catch (err) {
        return resolve(runInlineSandboxedCode(codeToRun, timeoutMs));
      }

      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          worker.terminate();
          try { URL.revokeObjectURL(blobUrl); } catch (e) { }
          resolve({
            success: false,
            error: 'Execution timed out (> ' + timeoutMs + 'ms, infinite loop detected)',
            executionTimeMs: timeoutMs
          });
        }
      }, timeoutMs);

      worker.onmessage = (evt) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          worker.terminate();
          try { URL.revokeObjectURL(blobUrl); } catch (e) { }
          const data = evt.data || {};
          data.executionTimeMs = Date.now() - startTime;
          resolve(data);
        }
      };

      worker.onerror = (err) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          worker.terminate();
          try { URL.revokeObjectURL(blobUrl); } catch (e) { }
          resolve({
            success: false,
            error: err.message || 'Worker runtime error',
            executionTimeMs: Date.now() - startTime
          });
        }
      };

      worker.postMessage({ code: codeToRun });
    });
  }

  return runInlineSandboxedCode(codeToRun, timeoutMs);
}

function runInlineSandboxedCode(codeToRun, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs = [];
    const customConsole = {
      log: (...args) => logs.push(args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      info: (...args) => logs.push(args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      warn: (...args) => logs.push(args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      error: (...args) => logs.push(args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    };

    try {
      const fn = new Function(
        'console', 'Math', 'Date', 'JSON', 'Array', 'Object', 'Number', 'String', 'RegExp',
        `"use strict";
        var window = undefined, document = undefined, localStorage = undefined, sessionStorage = undefined, fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, process = undefined, require = undefined;
        return eval(${JSON.stringify(codeToRun)});`
      );
      const res = fn(customConsole, Math, Date, JSON, Array, Object, Number, String, RegExp);
      resolve({
        success: true,
        result: res !== undefined ? res : (logs.length ? logs.join('\n') : 'Execution succeeded (no return value)'),
        logs,
        executionTimeMs: Date.now() - startTime
      });
    } catch (err) {
      resolve({
        success: false,
        error: err.message || String(err),
        logs,
        executionTimeMs: Date.now() - startTime
      });
    }
  });
}

export class PluginRegistry {
  static getActiveSet() {
    try {
      const raw = localStorage.getItem(LS_ACTIVE_PLUGINS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) { }

    // 默认启用 web_search, web_extract 和 code_eval
    return new Set(ALL_PLUGINS.filter((p) => p.defaultEnabled).map((p) => p.id));
  }

  static saveActiveSet(set) {
    try {
      localStorage.setItem(LS_ACTIVE_PLUGINS, JSON.stringify(Array.from(set)));
    } catch (e) { }
  }

  static isEnabled(id) {
    const set = this.getActiveSet();
    return set.has(id);
  }

  static toggle(id, enabled) {
    const set = this.getActiveSet();
    if (enabled) set.add(id);
    else set.delete(id);
    this.saveActiveSet(set);
  }

  static getAll() {
    return ALL_PLUGINS;
  }

  static getActivePlugins() {
    const set = this.getActiveSet();
    return ALL_PLUGINS.filter((p) => set.has(p.id));
  }

  static getActiveCount() {
    return this.getActiveSet().size;
  }

  static getPluginName(plugin) {
    if (!plugin || !plugin.name) return '';
    if (typeof plugin.name === 'object') {
      const lang = (state && state.lang) || 'zh';
      return plugin.name[lang] || plugin.name.en || plugin.name.zh || '';
    }
    return String(plugin.name);
  }

  static getPluginDescription(plugin) {
    if (!plugin || !plugin.description) return '';
    if (typeof plugin.description === 'object') {
      const lang = (state && state.lang) || 'zh';
      return plugin.description[lang] || plugin.description.en || plugin.description.zh || '';
    }
    return String(plugin.description);
  }

  static getByToolName(toolName) {
    if (toolName === 'manage_memory') {
      return {
        id: 'manage_memory',
        name: { zh: '长期记忆管理', en: 'Long-Term Memory' },
        provider: 'Local-First Memory',
        category: 'system',
        toolSchema: MemoryStore.getToolSchema(),
        async execute(args) {
          return MemoryStore.executeTool(args);
        },
        formatToolResult(data) {
          if (state && state.lang === 'en') {
            return (data && data.success) ? 'Memory updated successfully.' : ((data && data.message) || 'Memory update completed.');
          }
          return (data && data.message) || '已成功更新记忆。';
        },
        formatCoTMarker(args, data) {
          if (state && state.lang === 'en') {
            return '\n\n> ✦ **Memory Updated**\n\n';
          }
          return '\n\n> ✦ **已更新记忆**\n\n';
        },
        getSources() {
          return [];
        }
      };
    }
    return ALL_PLUGINS.find((p) => p.toolSchema && p.toolSchema.function && p.toolSchema.function.name === toolName);
  }

  static getById(id) {
    return ALL_PLUGINS.find((p) => p.id === id);
  }
}
