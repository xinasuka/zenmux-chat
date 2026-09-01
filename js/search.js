// js/search.js
// Model-Driven Web Search service, OpenAI Function Calling Schema, and search result formatting.

import { getHostname } from './state.js';

export const WebSearchService = {
  getToolSchema() {
    return {
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
    };
  },

  search(query, token, count) {
    const maxResults = count || 5;
    return fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': token
      },
      body: JSON.stringify({ query: query, max_results: maxResults })
    })
      .then((r) => {
        return r.json().then((j) => {
          if (!r.ok || (j && j.code !== 0 && j.code !== undefined)) {
            throw new Error((j && j.error) || (j && j.message) || ('HTTP ' + r.status));
          }
          const results = (j && j.data && j.data.results) || [];
          return results.map((item) => ({
            title: item.title || '网页结果',
            url: item.url || '',
            snippet: item.snippet || item.content || ''
          }));
        });
      });
  },

  formatToolResult(results) {
    if (!results || !results.length) return '未检索到相关网页内容。请基于现有知识回答并向用户说明未找到检索结果。';
    const items = results.map((r, idx) => {
      const domain = getHostname(r.url);
      return `[${idx + 1}] 《${r.title}》${domain ? ` (${domain})` : ''}\n链接: ${r.url}\n摘要: ${(r.snippet || '').trim()}`;
    }).join('\n\n');

    return `以下是检索到的实时网页事实资料：\n\n${items}\n\n请结合上述资料回答，并使用 [1]、[2] 形式标注引用的来源序号。`;
  },

  formatGroundingPrompt(query, results) {
    if (!results || !results.length) return '';
    const items = results.map((r, idx) => {
      const domain = getHostname(r.url);
      return `[${idx + 1}] 《${r.title}》${domain ? ` (${domain})` : ''}\n链接: ${r.url}\n摘要: ${(r.snippet || '').trim()}`;
    }).join('\n\n');

    return `--- 实时全网检索事实参考 (Web Grounding) ---\n以下是针对用户查询【${query}】检索到的最新全网参考资料：\n\n${items}\n\n--- 检索信息结束。请基于上述最新事实与数据进行严谨准确的回答，并在引用处标注来源序号（如 [1]）。 ---`;
  }
};

export const WebExtractService = {
  getToolSchema() {
    return {
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
    };
  },

  extract(url, token) {
    return fetch('/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': token
      },
      body: JSON.stringify({ url: url })
    })
      .then((r) => {
        return r.json().then((j) => {
          if (!r.ok || (j && j.error)) {
            throw new Error((j && j.error) || ('HTTP ' + r.status));
          }
          return {
            url: j.url || url,
            title: j.title || url,
            description: j.description || '',
            markdown: j.markdown || '',
            length: j.length || (j.markdown ? j.markdown.length : 0),
            truncated: !!j.truncated
          };
        });
      });
  },

  formatToolResult(data) {
    if (!data || !data.markdown) return '未能提取到该网页的有效正文内容。';
    const domain = getHostname(data.url);
    return `以下是通过 Firecrawl 提取的网页完整内容：\n\n【网页标题】：${data.title}${domain ? ` (${domain})` : ''}\n【原始链接】：${data.url}\n\n【正文 Markdown】：\n${data.markdown}\n\n请基于上述网页完整内容进行深度分析、总结或解答。`;
  }
};

