import { el, state, uid, esc } from './state.js';
import { ZenMuxDB } from './db.js';
import { PluginRegistry } from './plugins.js';
import { MemoryStore } from './memory.js';
import { renderMd, renderParts } from './markdown.js';
import { appendBubble, createSourcesElement, createActionsToolbar, createImageCard, TitleExtractor, toast, updateSidebarFooter } from './ui.js';

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
  if (status === 504 || (typeof raw === 'string' && (raw.includes('CLOUD_FUNCTION_INVOCATION_TIMEOUT') || raw.includes('504')))) {
    return '生图超时 (HTTP 504)：上游模型渲染耗时过长，超出了边缘函数执行时限。建议稍后重试或尝试切换其他生图模型。';
  }
  if (status === 502) {
    if (outer.error) return `网关异常 (HTTP 502)：${outer.error}`;
    return '边缘节点连接 ZenMux 失败，稍后重试。';
  }
  if (status === 500 && /ZENMUX_API_KEY/.test(raw)) {
    return '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。';
  }
  if (typeof raw === 'string' && (raw.includes('<html') || raw.includes('<!doctype html'))) {
    return `边缘网关返回异常状态 (HTTP ${status || 500})，服务暂时不可用，请稍后重试。`;
  }
}

export function getToolCallFingerprint(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return name + '::' + JSON.stringify(args || '');
  }
  const sorted = Object.keys(args).sort().reduce((acc, k) => {
    acc[k] = args[k];
    return acc;
  }, {});
  return name + '::' + JSON.stringify(sorted);
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
    if (state.memoryEnabled !== false) {
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
    let toolTurns = 0;
    const maxTurns = (typeof state.toolMaxTurns === 'number') ? state.toolMaxTurns : 20;
    let lastCallSignature = '';
    let duplicateCallCount = 0;
    let isTerminatedEarly = false;

    while (true) {
      if (maxTurns > 0 && toolTurns >= maxTurns) {
        toast(`单轮工具调用已达上限 (${maxTurns} 次)，已自动停止调度并综合生成回答`, 'info');
        isTerminatedEarly = true;
        break;
      }
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

      // 循环死锁检测 (Canonical Loop Detection / Repetitive Thrashing Guard)
      const currentSignature = getToolCallFingerprint(fnName, fnArgs);
      if (currentSignature === lastCallSignature) {
        duplicateCallCount++;
        // 允许最多 2 次合理重试（应对瞬态网络超时或接口限流），连续第 4 次调用同一工具且参数一致时判定为死循环
        if (duplicateCallCount >= 3) {
          toast(`检测到工具【${fnName}】连续重复尝试超过上限，已自动终止并综合生成回答`, 'info');
          isTerminatedEarly = true;
          break;
        }
      } else {
        duplicateCallCount = 0;
        lastCallSignature = currentSignature;
      }

      toolTurns++;

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
    }

    // 强制收尾综合调用 (Forced Final Synthesis Pass):
    // 若工具调用被上限截断或死循环熔断，且模型尚未给出最终回答，
    // 立即剥离所有 tools 定义重新发起收尾请求，迫使模型基于已收集的多轮工具观察输出综合结论。
    if (!acc && isTerminatedEarly) {
      searchStatusText = '正在根据收集到的全部信息撰写最终回答…';
      isSearching = true;
      renderLiveUI(false);
      toBottom();

      const finalPayload = buildPayload(currentHistory, false);
      isSearching = false;
      await runStream(finalPayload);
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
    const wrap = col && col.closest ? col.closest('.msg') : (col && col.parentNode);
    if (!acc && !reasonAcc && wrap && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap);
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

export async function executeImageGeneration(userMsg, options = {}) {
  const c = state.currentConv;
  if (!c) return;

  state.busy = true;
  if (el.send) el.send.disabled = true;
  if (el.stop) el.stop.style.display = 'none';

  const col = appendBubble('assistant', null);
  const skeletonCard = createImageCard({ loading: true });
  col.appendChild(skeletonCard);

  const toBottom = () => { if (el.thread) el.thread.scrollTop = el.thread.scrollHeight; };
  toBottom();

  const controller = new AbortController();
  state.controller = controller;

  const prompt = userMsg.content;
  const payload = {
    model: state.model,
    prompt: prompt,
    size: state.imageSize || 'auto',
    quality: state.imageQuality || 'auto',
    background: state.imageBackground || 'auto',
    output_format: 'png',
    n: 1
  };

  try {
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        'X-Access-Token': state.token || ''
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = explainError(errText, res.status) || `生图失败 (HTTP ${res.status}): ${errText}`;
      throw new Error(msg);
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const startTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;
          if (block.startsWith(':')) {
            // Heartbeat comment from edge gateway keep-alive
            const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            const tipEl = skeletonCard.querySelector('.img-card-skeleton-text') || skeletonCard.querySelector('.image-card-tip');
            if (tipEl) {
              tipEl.textContent = `正在调度生图引擎渲染画面 (${elapsed}s)...`;
            }
            continue;
          }

          const eventMatch = block.match(/event:\s*([^\n]+)/);
          const dataMatch = block.match(/data:\s*([\s\S]+)/);
          const eventType = eventMatch ? eventMatch[1].trim() : 'message';
          const rawData = dataMatch ? dataMatch[1].trim() : '';

          if (eventType === 'result') {
            try {
              data = JSON.parse(rawData);
            } catch (_) {
              data = rawData;
            }
          } else if (eventType === 'error') {
            let parsedErr;
            try {
              parsedErr = JSON.parse(rawData);
            } catch (_) {
              parsedErr = { error: rawData };
            }
            const errDetail = parsedErr.error || parsedErr.message || '图像生成服务异常';
            const status = parsedErr.status || 500;
            const explained = explainError(errDetail, status) || `生图失败 (HTTP ${status}): ${errDetail}`;
            throw new Error(explained);
          }
        }
      }
    } else {
      data = await res.json();
    }

    let item = data && data.data && data.data[0];
    if (!item && data && typeof data === 'object') {
      // Defensive client fallback for direct multimodal responses
      if (Array.isArray(data.predictions) && data.predictions[0]) {
        const p = data.predictions[0];
        item = typeof p === 'string' ? { b64_json: p } : { b64_json: p.bytesBase64Encoded || p.imageBytes || p.b64_json, url: p.url };
      } else if (Array.isArray(data.generatedImages || data.generated_images)) {
        const g = (data.generatedImages || data.generated_images)[0];
        item = g && g.image ? { b64_json: g.image.imageBytes || g.image.b64_json, url: g.image.url } : null;
      } else if (Array.isArray(data.candidates) && data.candidates[0]) {
        const parts = (data.candidates[0].content && data.candidates[0].content.parts) || [];
        for (const pt of parts) {
          if (pt.inlineData && pt.inlineData.data) {
            item = { b64_json: pt.inlineData.data };
            break;
          } else if (pt.inline_data && pt.inline_data.data) {
            item = { b64_json: pt.inline_data.data };
            break;
          }
        }
      }
    }

    const rawB64 = item && (item.b64_json || item.bytesBase64Encoded || item.imageBytes);
    const b64Data = rawB64 ? String(rawB64).replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s+/g, '') : '';
    if (!item || (!b64Data && !item.url)) {
      throw new Error((data && data.error) || '上游未返回有效的图像数据');
    }

    let blob = null;
    let src = '';
    if (b64Data) {
      const binaryString = atob(b64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: 'image/png' });
      src = URL.createObjectURL(blob);
    } else {
      src = item.url;
    }

    const imageId = 'img_' + uid();
    const revisedPrompt = item.revised_prompt || '';

    // 1. Instantly save image record with remote URL to IndexedDB
    await ZenMuxDB.putImage(imageId, blob, {
      prompt,
      revisedPrompt,
      model: state.model,
      size: state.imageSize,
      quality: state.imageQuality,
      url: src && src.startsWith('http') ? src : '',
      createdAt: Date.now()
    }).catch(() => {});

    // 2. Opportunistic background caching: if remote URL, attempt non-blocking blob fetch via proxy to bypass CORS
    if (!blob && src && src.startsWith('http')) {
      const proxyUrl = `/api/images?url=${encodeURIComponent(src)}`;
      fetch(proxyUrl)
        .then((r) => (r.ok ? r.blob() : null))
        .catch(() => fetch(src).then((r) => (r.ok ? r.blob() : null)).catch(() => null))
        .then((fetchedBlob) => {
          if (fetchedBlob) {
            ZenMuxDB.putImage(imageId, fetchedBlob, {
              prompt,
              revisedPrompt,
              model: state.model,
              size: state.imageSize,
              quality: state.imageQuality,
              url: src,
              createdAt: Date.now()
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // Replace skeleton with real image card
    const card = createImageCard({
      src,
      blob,
      prompt,
      revisedPrompt,
      model: state.model,
      size: state.imageSize,
      quality: state.imageQuality
    }, options.onRegenerate);
    skeletonCard.replaceWith(card);

    // Save message to conversation
    const assistantMsg = {
      id: uid(),
      role: 'assistant',
      type: 'image',
      imageId,
      url: src && src.startsWith('http') ? src : undefined,
      content: prompt,
      revisedPrompt,
      model: state.model,
      size: state.imageSize,
      quality: state.imageQuality,
      createdAt: Date.now()
    };
    c.messages.push(assistantMsg);
    c.updatedAt = Date.now();

    await ZenMuxDB.putConversation(c);
    if (typeof options.onUpdateConvList === 'function') options.onUpdateConvList();

  } catch (err) {
    if (err.name === 'AbortError') {
      skeletonCard.innerHTML = '<div class="msg-text" style="color:var(--fg-dim);padding:8px">已取消图像生成。</div>';
    } else {
      toast(err.message || String(err), 'error');
      skeletonCard.innerHTML = `<div class="msg-text" style="color:var(--danger);padding:8px">图像生成失败：${esc(err.message)}</div>`;
    }
  } finally {
    state.busy = false;
    state.controller = null;
    if (typeof options.onSyncSend === 'function') options.onSyncSend();
    toBottom();
  }
}

