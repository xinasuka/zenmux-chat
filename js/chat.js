import { el, state, uid, esc, getSearchCountByDepth } from './state.js';
import { ZenMuxDB } from './db.js';
import { WebSearchService } from './search.js';
import { renderMd, renderParts } from './markdown.js';
import { appendBubble, createSourcesElement, createActionsToolbar, TitleExtractor, toast, updateSidebarFooter } from './ui.js';

export function explainError(raw, status) {
  let outer = {}, inner = {};
  try { outer = JSON.parse(raw) || {}; } catch (e) { }
  try { inner = (JSON.parse(outer.detail || '{}') || {}).error || {}; } catch (e) { }
  const upMsg = inner.message || '';
  const type = inner.type || '';

  if (status === 402 || type === 'reject_no_credit') {
    return '该模型要求账户余额大于 0（ZenMux 的防滥用策略，不是扣费）。充一点余额即可解锁。';
  }
  if (status === 429 || type === 'rate_limit') {
    return '该模型当前访问量过大被限流，稍后重试或换一个模型。';
  }
  if (status === 401) return '访问口令不正确，请点右上角退出后重新输入。';
  if (status === 400) return '请求被上游拒绝：' + (upMsg || '参数格式不被该模型支持');
  if (status === 502) return '边缘节点连接 ZenMux 失败，稍后重试。';
  if (status === 500 && /ZENMUX_API_KEY/.test(raw)) {
    return '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。';
  }
  return upMsg || outer.error || raw.slice(0, 300) || ('HTTP ' + status);
}

export function pump(res, onChunk) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  let lastUsage = null;
  const accumulatedToolCalls = [];

  return reader.read().then(function step(part) {
    if (part.done) {
      onChunk('', '', true, lastUsage, accumulatedToolCalls.length ? accumulatedToolCalls : null);
      return {
        toolCalls: accumulatedToolCalls.length ? accumulatedToolCalls : null,
        usage: lastUsage
      };
    }
    buf += dec.decode(part.value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop();

    let c = '';
    let r = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.indexOf('data:') !== 0) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        if (j.usage) {
          lastUsage = {
            prompt_tokens: j.usage.prompt_tokens || 0,
            completion_tokens: j.usage.completion_tokens || 0,
            total_tokens: j.usage.total_tokens || 0
          };
        }
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const d = ch.delta || {};
        if (d.reasoning) r += d.reasoning;
        if (d.reasoning_content) r += d.reasoning_content;
        if (d.content) c += d.content;

        if (Array.isArray(d.tool_calls)) {
          d.tool_calls.forEach((tc) => {
            const idx = tc.index !== undefined ? tc.index : accumulatedToolCalls.length;
            if (!accumulatedToolCalls[idx]) {
              accumulatedToolCalls[idx] = {
                id: tc.id || '',
                type: tc.type || 'function',
                function: {
                  name: (tc.function && tc.function.name) || '',
                  arguments: (tc.function && tc.function.arguments) || ''
                }
              };
            } else {
              if (tc.id) accumulatedToolCalls[idx].id = tc.id;
              if (tc.type) accumulatedToolCalls[idx].type = tc.type;
              if (tc.function) {
                if (tc.function.name) accumulatedToolCalls[idx].function.name += tc.function.name;
                if (tc.function.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          });
        }
      } catch (e) { }
    }
    if (c || r) onChunk(c, r, false, lastUsage, accumulatedToolCalls.length ? accumulatedToolCalls : null);
    return reader.read().then(step);
  });
}

export async function executeAssistantStream(userMsg, options = {}) {
  const c = state.currentConv;
  if (!c) return;

  const meta = state.modelMeta[state.model];
  const col = appendBubble('assistant', null); // Returns .body container element
  
  const toBottom = () => { if (el.thread) el.thread.scrollTop = el.thread.scrollHeight; };
  const nearBottom = () => el.thread ? (el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 120) : true;
  toBottom();

  state.busy = true;
  if (el.send) el.send.style.display = 'none';
  if (el.stop) el.stop.style.display = 'flex';
  state.controller = new AbortController();

  const hist = c.messages.filter((m) => m.content || (m.images && m.images.length));
  const sliced = (state.ctxN > 0 ? hist.slice(-state.ctxN) : hist);

  const history = sliced.map((m) => {
    if (m.role === 'user' && m.images && m.images.length) {
      const parts = [];
      if (m.content && m.content.trim()) {
        parts.push({ type: 'text', text: m.content });
      } else {
        parts.push({ type: 'text', text: '请分析上述内容' });
      }
      m.images.forEach((img) => {
        parts.push({
          type: 'image_url',
          image_url: { url: img.dataUrl, detail: 'auto' }
        });
      });
      return { role: 'user', content: parts };
    }
    return { role: m.role, content: m.content || '' };
  });

  const canReason = !!(meta && meta.capabilities && meta.capabilities.reasoning);

  function buildPayload(msgs, allowTools) {
    const p = { model: state.model, messages: msgs };
    if (canReason && state.effort) {
      if (state.effort === 'off') p.reasoning = { enabled: false };
      else p.reasoning_effort = state.effort;
    }
    if (allowTools && state.webSearch) {
      p.tools = [WebSearchService.getToolSchema()];
    }
    return p;
  }

  let acc = '';
  let reasonAcc = '';
  let activeSources = [];
  let isSearching = false;
  let searchStatusText = '';
  let capturedUsage = null;

  function renderLiveUI(isFinal) {
    col.innerHTML = '';

    // 1. 思考过程 (Thinking Process)
    if (reasonAcc && reasonAcc.trim()) {
      const rDetails = document.createElement('details');
      rDetails.className = 'reasoning';
      rDetails.open = true;
      rDetails.innerHTML = `<summary><span class="reasoning-sparkle">✦</span> <span>思考过程</span></summary><div class="reasoning-body">${renderMd(reasonAcc)}</div>`;
      col.appendChild(rDetails);
    }

    // 2. 实时搜索状态动画 (Active Search Progress)
    if (isSearching) {
      const searchBox = document.createElement('div');
      searchBox.className = 'search-status';
      searchBox.innerHTML = `<span class="search-spinner"></span> ${esc(searchStatusText)}`;
      col.appendChild(searchBox);
    }

    // 3. 参考来源卡片 (Reference Sources Drawer)
    if (activeSources && activeSources.length) {
      const srcElement = createSourcesElement(activeSources);
      if (srcElement) col.appendChild(srcElement);
    }

    // 4. 正文回复 (Markdown Response)
    if (acc || !isFinal) {
      const textNode = document.createElement('div');
      textNode.className = 'msg-text';
      textNode.innerHTML = renderMd(acc) + (isFinal ? '' : '<span class="caret"></span>');
      col.appendChild(textNode);
    }
  }

  function runStream(payload) {
    return fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Token': state.token },
      body: JSON.stringify(payload),
      signal: state.controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          return res.text().then((t) => {
            throw new Error(explainError(t, res.status));
          });
        }
        if (!res.body) throw new Error('服务端未返回流，反代可能不支持 SSE');

        return pump(res, (cDelta, rDelta, done, lastUsage) => {
          if (rDelta) reasonAcc += rDelta;
          if (cDelta) acc += cDelta;
          if (lastUsage) capturedUsage = lastUsage;
          if (nearBottom()) toBottom();
          renderLiveUI(done);
          if (!done && nearBottom()) toBottom();
        });
      });
  }

  // 初始渲染光标
  renderLiveUI(false);

  let currentHistory = history;

  try {
    while (true) {
      // 在所有连续轮次中始终保留 tools 定义，使模型可进行多步检索
      const payload = buildPayload(currentHistory, true);
      const streamResult = await runStream(payload);

      const toolCalls = streamResult && streamResult.toolCalls;
      const webSearchCall = (toolCalls && toolCalls.length) ? toolCalls.find((tc) => {
        return tc.function && tc.function.name === 'web_search';
      }) : null;

      if (!webSearchCall) {
        // 模型已完成检索决策并生成最终回复
        break;
      }

      // 解析检索参数
      let searchArgs = {};
      try {
        searchArgs = JSON.parse(webSearchCall.function.arguments || '{}');
      } catch (e) {
        searchArgs = { query: webSearchCall.function.arguments || userMsg.content };
      }
      const searchQuery = (searchArgs.query || userMsg.displayContent || userMsg.content || '').trim();

      // 若模型在触发工具调用前输出了前置思考/正文，无损并入思考过程流
      if (acc && acc.trim()) {
        reasonAcc = (reasonAcc ? reasonAcc + '\n\n' : '') + acc.trim();
        acc = '';
      }

      isSearching = true;
      searchStatusText = `正在实时检索：${searchQuery}…`;
      renderLiveUI(false);
      toBottom();

      const searchCount = getSearchCountByDepth(state.searchDepth);
      let stepSources = [];
      try {
        stepSources = await WebSearchService.search(searchQuery, state.token, searchCount);
      } catch (err) {
        if (err && /ANYSEARCH_API_KEY/.test(err.message)) {
          toast('服务端未配置 ANYSEARCH_API_KEY 环境变量', 'info');
        } else {
          toast('联网检索提示: ' + (err.message || '未获取到有效搜索结果'), 'info');
        }
        stepSources = [];
      }

      // 聚合参考来源并去重
      stepSources.forEach((s) => {
        if (!activeSources.some((existing) => existing.url === s.url)) {
          activeSources.push(s);
        }
      });

      isSearching = false;
      const count = stepSources.length;
      const searchMarker = `\n\n> ✦ **已联网检索**：\`${searchQuery}\` (获取到 ${count} 个网页参考资料)\n\n`;
      reasonAcc += searchMarker;

      const toolCallId = webSearchCall.id || ('call_' + uid());
      const asstToolMsg = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: 'web_search',
              arguments: JSON.stringify(searchArgs)
            }
          }
        ]
      };
      const toolResultMsg = {
        role: 'tool',
        tool_call_id: toolCallId,
        content: WebSearchService.formatToolResult(stepSources)
      };

      currentHistory = currentHistory.concat([asstToolMsg, toolResultMsg]);
      acc = '';
      renderLiveUI(false);
    }

    renderLiveUI(true);
    if (acc || reasonAcc) {
      const asstMsg = {
        id: uid(),
        role: 'assistant',
        content: acc,
        reasoning: reasonAcc || undefined,
        sources: (activeSources && activeSources.length) ? activeSources : undefined,
        usage: capturedUsage || undefined,
        model: state.model || undefined,
        createdAt: Date.now()
      };
      c.messages.push(asstMsg);
      c.updatedAt = Date.now();

      if (c.autoTitled && !c.customTitle && c.messages.length === 2) {
        const refined = TitleExtractor.sniffAssistantTitle(acc);
        if (refined && refined !== c.title) {
          c.title = refined;
        }
      }

      ZenMuxDB.putConversation(c).then(() => {
        if (typeof options.onUpdateConvList === 'function') options.onUpdateConvList();
      });

      const actionsBar = createActionsToolbar(asstMsg, c.messages.length - 1, options.onRegenerate);
      col.appendChild(actionsBar);
      updateSidebarFooter();
    }
  } catch (e) {
    isSearching = false;
    renderLiveUI(true);
    if (e.name === 'AbortError') {
      if (acc || reasonAcc) {
        const partialMsg = {
          id: uid(),
          role: 'assistant',
          content: acc,
          reasoning: reasonAcc || undefined,
          sources: (activeSources && activeSources.length) ? activeSources : undefined,
          usage: capturedUsage || undefined,
          model: state.model || undefined,
          createdAt: Date.now()
        };
        c.messages.push(partialMsg);
        c.updatedAt = Date.now();
        ZenMuxDB.putConversation(c);
        const actionsBar = createActionsToolbar(partialMsg, c.messages.length - 1, options.onRegenerate);
        col.appendChild(actionsBar);
        updateSidebarFooter();
      }
      return;
    }
    toast(e.message || String(e), 'error');
    if (!acc && !reasonAcc && col && col.parentNode) {
      col.parentNode.removeChild(col);
    }
  } finally {
    state.busy = false;
    state.controller = null;
    if (el.stop) el.stop.style.display = 'none';
    if (el.send) el.send.style.display = 'flex';
    if (typeof options.onSyncSend === 'function') options.onSyncSend();
    toBottom();
  }
}
