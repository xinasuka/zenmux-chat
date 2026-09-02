import { el, state, uid, esc } from './state.js';
import { ZenMuxDB } from './db.js';
import { PluginRegistry } from './plugins.js';
import { MemoryStore } from './memory.js';
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
    const systemParts = [];
    if (state.instructions && state.instructions.trim() && state.instructionsEnabled) {
      systemParts.push(state.instructions.trim());
    }
    if (state.memoryEnabled && state.instructionsEnabled !== false) {
      const memoryBlock = MemoryStore.compileSystemPrompt();
      if (memoryBlock) {
        systemParts.push(memoryBlock);
      }
    }

    let finalMsgs = msgs;
    if (systemParts.length > 0) {
      const systemInstruction = {
        role: 'system',
        content: systemParts.join('\n\n')
      };
      if (!finalMsgs.length || finalMsgs[0].role !== 'system') {
        finalMsgs = [systemInstruction, ...finalMsgs];
      }
    }

    const p = { model: state.model, messages: finalMsgs };
    if (canReason && state.effort) {
      if (state.effort === 'off') p.reasoning = { enabled: false };
      else p.reasoning_effort = state.effort;
    }
    if (allowTools) {
      const activePlugins = PluginRegistry.getActivePlugins();
      const tools = activePlugins.map((pl) => pl.toolSchema);
      if (state.memoryEnabled) {
        tools.push(MemoryStore.getToolSchema());
      }
      if (tools.length) {
        p.tools = tools;
      }
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

    // 2. 实时插件调用状态动画 (Active Tool Execution Progress)
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
      // 在所有连续轮次中始终保留当前激活插件的 tools 定义
      const payload = buildPayload(currentHistory, true);
      const streamResult = await runStream(payload);

      const toolCalls = streamResult && streamResult.toolCalls;
      const activeCall = (toolCalls && toolCalls.length) ? toolCalls[0] : null;

      if (!activeCall || !activeCall.function) {
        // 模型已完成所有工具调用决策并生成最终回复
        break;
      }

      const fnName = activeCall.function.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(activeCall.function.arguments || '{}');
      } catch (e) {
        fnArgs = {};
      }

      // 若模型在触发工具调用前输出了前置思考/正文，无损并入思考过程流
      if (acc && acc.trim()) {
        reasonAcc = (reasonAcc ? reasonAcc + '\n\n' : '') + acc.trim();
        acc = '';
      }

      const toolCallId = activeCall.id || ('call_' + uid());
      let toolResultContent = '';

      const plugin = PluginRegistry.getByToolName(fnName);
      if (plugin) {
        isSearching = true;
        searchStatusText = `正在调用【${plugin.name}】插件…`;
        renderLiveUI(false);
        toBottom();

        let pluginResult = null;
        try {
          pluginResult = await plugin.execute(fnArgs, state.token);
        } catch (err) {
          toast(`插件【${plugin.name}】提示: ${err.message || '调用失败'}`, 'info');
          pluginResult = { error: err.message };
        }

        isSearching = false;

        // 格式化并并入思考过程时间线标记
        if (typeof plugin.formatCoTMarker === 'function') {
          const cotMarker = plugin.formatCoTMarker(fnArgs, pluginResult);
          if (cotMarker) reasonAcc += cotMarker;
        }

        // 提取并聚合参考来源
        if (typeof plugin.getSources === 'function') {
          const sources = plugin.getSources(pluginResult) || [];
          sources.forEach((s) => {
            if (s && s.url && !activeSources.some((existing) => existing.url === s.url)) {
              activeSources.push(s);
            }
          });
        }

        toolResultContent = plugin.formatToolResult(pluginResult);
      } else {
        toolResultContent = `未知工具或插件未启用: ${fnName}`;
      }

      const asstToolMsg = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: fnName,
              arguments: JSON.stringify(fnArgs)
            }
          }
        ]
      };
      const toolResultMsg = {
        role: 'tool',
        tool_call_id: toolCallId,
        content: toolResultContent
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
