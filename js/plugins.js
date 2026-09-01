// js/plugins.js
// Centralized Plugin Registry, Tool Calling Schema Management, and Multiplexed Tool Execution.

import { getHostname, getSearchCountByDepth, state } from './state.js';

export const LS_ACTIVE_PLUGINS = 'zm.plugins.active';

const ALL_PLUGINS = [
  {
    id: 'web_search',
    name: '实时全网搜索',
    provider: 'AnySearch',
    category: 'search',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
    description: '实时检索全网最新资讯、新闻与实时事实数据',
    defaultEnabled: true,
    toolSchema: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the live internet for up-to-date facts, current events, recent news, official documentation, or real-time data when your internal knowledge is insufficient or temporal verification is needed.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The targeted search query keywords optimized for search engines (concise and specific).'
            }
          },
          required: ['query']
        }
      }
    },
    async execute(args, token) {
      const query = (args && args.query) ? String(args.query).trim() : '';
      const count = getSearchCountByDepth(state.searchDepth);
      const res = await fetch('/api/search', {
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
          title: item.title || '网页结果',
          url: item.url || '',
          snippet: item.snippet || item.content || ''
        }))
      };
    },
    formatToolResult(data) {
      const results = (data && data.results) || [];
      if (!results.length) return '未检索到相关网页内容。请基于现有知识回答并向用户说明未找到检索结果。';
      const items = results.map((r, idx) => {
        const domain = getHostname(r.url);
        return `[${idx + 1}] 《${r.title}》${domain ? ` (${domain})` : ''}\n链接: ${r.url}\n摘要: ${(r.snippet || '').trim()}`;
      }).join('\n\n');
      return `以下是检索到的实时网页事实资料：\n\n${items}\n\n请结合上述资料回答，并使用 [1]、[2] 形式标注引用的来源序号。`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.results) ? data.results.length : 0;
      return `\n\n> ✦ **已联网检索**：\`${query}\` (获取到 ${count} 个网页参考资料)\n\n`;
    },
    getSources(data) {
      return (data && data.results) || [];
    }
  },
  {
    id: 'web_extract',
    name: '深度网页抓取',
    provider: 'Firecrawl v2',
    category: 'search',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    description: '深度抓取单页内容，解析 React/SPA 动态站点并转为 Markdown',
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
      const res = await fetch('/api/extract', {
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
      if (!data || !data.markdown) return '未能提取到该网页的有效正文内容。';
      const domain = getHostname(data.url);
      return `以下是通过 Firecrawl 提取的网页完整内容：\n\n【网页标题】：${data.title}${domain ? ` (${domain})` : ''}\n【原始链接】：${data.url}\n\n【正文 Markdown】：\n${data.markdown}\n\n请基于上述网页完整内容进行深度分析、总结或解答。`;
    },
    formatCoTMarker(args, data) {
      const url = (data && data.url) || (args && args.url) || '';
      const title = (data && data.title) || url;
      const charCount = (data && data.length) ? data.length : ((data && data.markdown) ? data.markdown.length : 0);
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
    name: '学术文献检索',
    provider: 'Semantic Scholar',
    category: 'research',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
    description: '检索 2 亿+ 篇学术论文、核心摘要、作者、引用数及 DOI 论文链接',
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
        papers: j.papers || []
      };
    },
    formatToolResult(data) {
      const papers = (data && data.papers) || [];
      if (!papers.length) return '未检索到相关学术论文。请尝试使用更加通用的英文学术关键词再次检索。';
      const items = papers.map((p, idx) => {
        return `[${idx + 1}] 《${p.title}》 (${p.year})\n- 作者: ${p.authors}\n- 期刊/会议: ${p.venue || 'N/A'} (引用数: ${p.citationCount})\n- 论文链接/DOI: ${p.url}\n- 摘要: ${p.abstract}`;
      }).join('\n\n');
      return `以下是通过 Semantic Scholar 检索到的学术文献：\n\n${items}\n\n请基于上述论文事实与摘要进行严谨的学术分析，并在引用处标注 [1]、[2] 等序号。`;
    },
    formatCoTMarker(args, data) {
      const query = (data && data.query) || (args && args.query) || '';
      const count = (data && data.papers) ? data.papers.length : 0;
      return `\n\n> ✦ **已检索学术文献**：\`${query}\` (获取到 ${count} 篇学术论文与引用)\n\n`;
    },
    getSources(data) {
      return ((data && data.papers) || []).map((p) => ({
        title: `《${p.title}》 (${p.year})`,
        url: p.url,
        snippet: `作者: ${p.authors} · 引用: ${p.citationCount} · ${p.abstract.slice(0, 150)}`
      }));
    }
  },
  {
    id: 'weather',
    name: '全球精准气象',
    provider: 'Open-Meteo',
    category: 'utility',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
    description: '免 Key 查询全球任意城市的实时气温、湿度、降水及 7 日天气预报',
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
              description: 'City name or geographical location (e.g. "Beijing", "Tokyo", "London", "上海", "深圳").'
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
      if (!data || !data.current) return '未能获取到该地点的气象信息。';
      const cur = data.current;
      const forecastLines = (data.forecast || []).map((f) => {
        return `- ${f.date}: ${f.condition}, 气温 ${f.minTemp} ~ ${f.maxTemp}, 降水: ${f.precipitation}`;
      }).join('\n');

      return `以下是【${data.location}】的最新气象数据：\n\n【当前天气】：\n- 气温: ${cur.temperature} (体感 ${cur.apparentTemperature})\n- 天气状况: ${cur.condition}\n- 相对湿度: ${cur.humidity}\n- 风速: ${cur.windSpeed}\n- 降水量: ${cur.precipitation}\n\n【未来 7 日预报】：\n${forecastLines}\n\n请向用户总结当前天气状况并提供温馨出行或穿衣建议。`;
    },
    formatCoTMarker(args, data) {
      const loc = (data && data.location) || (args && args.location) || '';
      const cur = data && data.current;
      const temp = cur ? cur.temperature : '';
      const cond = cur ? cur.condition : '';
      return `\n\n> ✦ **已查询气象数据**：${loc}${temp ? ` (当前气温 ${temp}, ${cond})` : ''}\n\n`;
    },
    getSources() {
      return [];
    }
  },
  {
    id: 'github',
    name: 'GitHub 开源探索',
    provider: 'GitHub REST API',
    category: 'dev',
    icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`,
    description: '查询开源仓库详情、Star 趋势、Release 版本日志及技术栈信息',
    defaultEnabled: false,
    toolSchema: {
      type: 'function',
      function: {
        name: 'github_repo',
        description: 'Inspect a GitHub open-source repository to get real-time stars, forks, open issues, license, programming languages, latest release notes, and description.',
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'The GitHub repository identifier in "owner/repo" format or full URL (e.g. "facebook/react", "vercel/next.js", "vllm-project/vllm").'
            }
          },
          required: ['repo']
        }
      }
    },
    async execute(args, token) {
      const repo = (args && (args.repo || args.query)) ? String(args.repo || args.query).trim() : '';
      const res = await fetch('/api/plugins/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ repo })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j && j.error)) {
        throw new Error((j && j.error) || ('HTTP ' + res.status));
      }
      return j;
    },
    formatToolResult(data) {
      if (!data || !data.fullName) return '未能获取到该 GitHub 仓库的信息。';
      return `以下是 GitHub 仓库【${data.fullName}】的实时信息：\n\n- 仓库地址: ${data.htmlUrl}\n- 项目描述: ${data.description}\n- 关注与分支: ⭐ ${data.stars.toLocaleString()} Stars | 🍴 ${data.forks.toLocaleString()} Forks | ❗ ${data.openIssues} Issues\n- 主要语言: ${data.language}\n- 开源协议: ${data.license}\n- 最新发布版本: ${data.latestRelease}\n- 标签主题: ${(data.topics || []).join(', ') || '无'}\n- 默认分支: ${data.defaultBranch}\n\n请向用户详细介绍该开源项目的定位、流行度指标与最新动态。`;
    },
    formatCoTMarker(args, data) {
      const name = (data && data.fullName) || (args && args.repo) || '';
      const url = (data && data.htmlUrl) || '';
      const stars = (data && data.stars) ? ` (⭐ ${data.stars.toLocaleString()})` : '';
      return `\n\n> ✦ **已分析 GitHub 仓库**：[${name}](${url})${stars}\n\n`;
    },
    getSources(data) {
      if (!data || !data.htmlUrl) return [];
      return [{
        title: `GitHub: ${data.fullName}`,
        url: data.htmlUrl,
        snippet: `⭐ ${data.stars} Stars · ${data.language} · ${data.description}`
      }];
    }
  }
];

export class PluginRegistry {
  static getActiveSet() {
    try {
      const raw = localStorage.getItem(LS_ACTIVE_PLUGINS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch (e) { }

    // 默认启用 web_search 和 web_extract
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

  static getByToolName(toolName) {
    return ALL_PLUGINS.find((p) => p.toolSchema && p.toolSchema.function && p.toolSchema.function.name === toolName);
  }

  static getById(id) {
    return ALL_PLUGINS.find((p) => p.id === id);
  }
}
