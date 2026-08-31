/* ZenMux Chat —— 前端逻辑。无构建、无外部依赖。
   后端契约：
     GET  /api/models  头 X-Access-Token: <口令>  → OpenAI 兼容的 { data: [{id}] }
     POST /api/chat    头 X-Access-Token + JSON {model, messages} → text/event-stream
*/
(function () {
  'use strict';

  var LS = {
    conv: 'zm.conversations',
    cur: 'zm.current',
    model: 'zm.model',
    token: 'zm.token',
    gated: 'zm.gated',
    effort: 'zm.effort',
    ctx: 'zm.ctx',
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    sidebar: $('sidebar'), burger: $('burger'), newChat: $('new-chat'), convList: $('conv-list'),
    model: $('model'), effort: $('effort'), ctx: $('ctx'), logout: $('logout'),
    thread: $('thread'), threadInner: $('thread-inner'),
    input: $('input'), send: $('send'), stop: $('stop'),
    gate: $('gate'), gateInput: $('gate-input'), gateGo: $('gate-go'), gateErr: $('gate-err'),
    toast: $('toast'),
  };

  var state = {
    token: localStorage.getItem(LS.token) || '',
    model: localStorage.getItem(LS.model) || '',
    conversations: read(LS.conv, []),
    currentId: localStorage.getItem(LS.cur) || null,
    // '' = 不传参数（由 ZenMux 按模型默认，通常 medium）；'off' = 显式关闭推理
    effort: localStorage.getItem(LS.effort) || '',
    // 每次请求携带的历史消息条数，0 = 全部（受模型 context_length 与 1MB 请求体上限约束）
    ctxN: parseInt(localStorage.getItem(LS.ctx), 10),
    modelMeta: {},
    busy: false,
    controller: null,
  };
  if (isNaN(state.ctxN)) state.ctxN = 20;

  /* ---------------- 存储 ---------------- */
  function read(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
    catch (e) { return d; }
  }
  function store(k, v) {
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
    catch (e) { toast('本地存储写入失败，会话可能无法保留'); }
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------- Markdown ---------------- */
  var SENT = String.fromCharCode(1);

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 行内样式。入参已 esc 过。
  function inline(s) {
    s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
      .map(function (c) { return c.trim(); });
  }

  var RE_FENCE = /```[a-zA-Z0-9_+#-]*\n?([\s\S]*?)```/g;
  var RE_HEAD = /^(#{1,4})\s+(.*)$/;
  var RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  var RE_QUOTE = /^\s*>/;
  var RE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
  var RE_UL = /^\s*[-*+]\s+/;
  var RE_TBL_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

  function renderMd(src) {
    var blocks = [];
    var text = String(src).replace(/\r\n?/g, '\n');

    // 围栏代码块先抽出来，避免内部内容被行内规则污染
    text = text.replace(RE_FENCE, function (m, code) {
      blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
      return '\n' + SENT + 'B' + (blocks.length - 1) + SENT + '\n';
    });

    var lines = text.split('\n');
    var out = [];
    var i = 0;
    var ph = new RegExp('^' + SENT + 'B(\\d+)' + SENT + '$');

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      var m = line.trim().match(ph);
      if (m) { out.push(blocks[+m[1]]); i++; continue; }

      if (RE_HEAD.test(line)) {
        var h = line.match(RE_HEAD);
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(esc(h[2])) + '</h' + lv + '>');
        i++; continue;
      }

      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      if (RE_QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + renderMd(q.join('\n')) + '</blockquote>');
        continue;
      }

      if (line.indexOf('|') !== -1 && i + 1 < lines.length && RE_TBL_SEP.test(lines[i + 1])) {
        var head = splitRow(lines[i]);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var thead = '<tr>' + head.map(function (c) { return '<th>' + inline(esc(c)) + '</th>'; }).join('') + '</tr>';
        var tbody = rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + inline(esc(c)) + '</td>'; }).join('') + '</tr>';
        }).join('');
        out.push('<table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>');
        continue;
      }

      if (RE_ITEM.test(line)) {
        var ordered = !RE_UL.test(line);
        var items = [];
        while (i < lines.length) {
          if (RE_ITEM.test(lines[i])) {
            items.push(lines[i].replace(RE_ITEM, ''));
            i++;
          } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !RE_ITEM.test(lines[i])) {
            items[items.length - 1] += '\n' + lines[i].trim();  // 续行
            i++;
          } else break;
        }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map(function (t) {
          return '<li>' + inline(esc(t)).replace(/\n/g, '<br>') + '</li>';
        }).join('') + '</' + tag + '>');
        continue;
      }

      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
        !RE_HEAD.test(lines[i]) && !RE_QUOTE.test(lines[i]) && !RE_ITEM.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push('<p>' + inline(esc(para.join('\n'))).replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('');
  }

  // 流式过程中代码块可能尚未闭合，临时补一个围栏，避免半截代码被当正文渲染
  function renderStream(text) {
    var t = String(text);
    var fences = (t.match(/```/g) || []).length;
    if (fences % 2 === 1) t += '\n```';
    return renderMd(t);
  }

  // 渲染「推理过程 + 正文」。reasoning 折叠显示，content 正常 Markdown。
  function renderParts(reasoning, content) {
    var html = '';
    if (reasoning && reasoning.trim()) {
      html += '<details class="reasoning" open><summary>思考过程</summary>' +
        renderMd(reasoning) + '</details>';
    }
    html += renderMd(content || '');
    return html;
  }

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.display = 'none'; }, 4000);
  }

  /* ---------------- 会话 ---------------- */
  function current() {
    var c = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === state.currentId) { c = state.conversations[i]; break; }
    }
    if (!c) {
      c = { id: uid(), title: '新对话', messages: [], createdAt: Date.now() };
      state.conversations.unshift(c);
      state.currentId = c.id;
      persist();
    }
    return c;
  }

  function persist() {
    store(LS.conv, state.conversations);
    store(LS.cur, state.currentId);
  }

  function renderConvList() {
    el.convList.innerHTML = '';
    state.conversations.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'conv' + (c.id === state.currentId ? ' active' : '');

      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = c.title;

      var del = document.createElement('span');
      del.className = 'del';
      del.textContent = '\u00d7';
      del.title = '删除';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.busy) return;
        state.conversations = state.conversations.filter(function (x) { return x.id !== c.id; });
        if (state.currentId === c.id) state.currentId = null;
        persist();
        renderConvList();
        renderThread();
        syncSend();
      });

      row.appendChild(txt);
      row.appendChild(del);
      row.addEventListener('click', function () {
        if (state.busy) return;
        state.currentId = c.id;
        persist();
        renderConvList();
        renderThread();
        closeSidebar();
      });
      el.convList.appendChild(row);
    });
  }

  function nearBottom() {
    return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 120;
  }
  function toBottom() { el.thread.scrollTop = el.thread.scrollHeight; }

  function renderThread() {
    var c = current();
    el.threadInner.innerHTML = '';

    if (!c.messages.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.model ? '开始一段对话' : '先在上方填写模型 ID';
      el.threadInner.appendChild(empty);
      return;
    }

    c.messages.forEach(function (m) {
      el.threadInner.appendChild(bubble(m.role, m.content));
    });
    toBottom();
  }

  function bubble(role, content) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + role;

    var avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';

    var col = document.createElement('div');
    col.className = 'body';

    var who = document.createElement('div');
    who.className = 'role';
    who.textContent = role === 'user' ? '你' : 'ZenMux';

    var body = document.createElement('div');
    if (role === 'user') body.textContent = content;
    else body.innerHTML = renderMd(content);

    col.appendChild(who);
    col.appendChild(body);
    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  function appendBubble(role) {
    var node = bubble(role, '');
    el.threadInner.appendChild(node);
    return node.querySelector('.body > div:last-child');
  }

  /* ---------------- 模型列表 ---------------- */
  function loadModels() {
    fetch('/api/models', { headers: { 'X-Access-Token': state.token } })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 401 ? '口令不正确' : 'HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var list = (j && j.data) || [];
        if (!list.length) throw new Error('模型列表为空');
        fillModels(list);
        var ids = list.map(function (m) { return m.id; });
        if (!state.model || ids.indexOf(state.model) === -1) {
          state.model = list[0].id;
        }
        el.model.value = state.model;
        store(LS.model, state.model);
        syncEffort();
        renderThread();
      })
      .catch(function (e) {
        toast('模型列表拉取失败：' + e.message + '（可手动选择模型）');
      });
  }

  // 按 owned_by 分组填充模型下拉；option 显示 display_name，value 为模型 id
  // 从 pricings 判断是否免费：prompt 与 completion 单价都为 0
  function isFree(m) {
    var p = m.pricings || {};
    function zero(arr) {
      if (!arr || !arr.length) return false;
      for (var i = 0; i < arr.length; i++) if (Number(arr[i].value) !== 0) return false;
      return true;
    }
    return zero(p.prompt) && zero(p.completion);
  }

  function fillModels(list) {
    el.model.innerHTML = '';
    state.modelMeta = {};
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = list.length ? '选择模型…' : '无可用模型';
    el.model.appendChild(ph);

    var groups = {};
    list.forEach(function (m) {
      state.modelMeta[m.id] = m;
      var g = m.owned_by || '其他';
      (groups[g] = groups[g] || []).push(m);
    });
    Object.keys(groups).sort().forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id;
        var label = m.display_name || m.id;
        if (m.capabilities && m.capabilities.reasoning) label += ' ·推理';
        if (isFree(m)) label += ' ·免费';
        o.textContent = label;
        og.appendChild(o);
      });
      el.model.appendChild(og);
    });
  }

  // 当前模型不支持推理时，禁用推理强度选择器并说明原因
  function syncEffort() {
    var m = state.modelMeta[state.model];
    var can = !!(m && m.capabilities && m.capabilities.reasoning);
    // 模型元数据还没拉到时不要误禁用
    var unknown = !m;
    el.effort.disabled = !can && !unknown;
    el.effort.title = can
      ? '推理强度：ZenMux 不传此参数时默认 medium'
      : (unknown ? '推理强度（模型信息载入中）' : '当前模型不支持推理，此项无效');
  }

  /* ---------------- 错误解释 ---------------- */
  // 反代把上游错误包成 {error, detail}，detail 里才是真正的原因。
  // 直接显示「上游返回 402」等于没说，这里翻成人话。
  function explainError(raw, status) {
    var outer = {}, inner = {};
    try { outer = JSON.parse(raw) || {}; } catch (e) { /* 非 JSON */ }
    try { inner = (JSON.parse(outer.detail || '{}') || {}).error || {}; } catch (e) { /* 非 JSON */ }
    var upMsg = inner.message || '';
    var type = inner.type || '';

    if (status === 402 || type === 'reject_no_credit') {
      return '该模型要求账户余额大于 0（ZenMux 的防滥用策略，不是扣费）。'
        + '免费模型也受此限制，充一点余额即可解锁。';
    }
    if (status === 429 || type === 'rate_limit') {
      return '该模型当前访问量过大被限流，稍后重试或换一个模型。';
    }
    if (status === 401) return '访问口令不正确，请点右上角退出后重新输入。';
    if (status === 400) return '请求被上游拒绝：' + (upMsg || '参数不被该模型支持');
    if (status === 502) return '边缘节点连接 ZenMux 失败，稍后重试。';
    if (status === 500 && /ZENMUX_API_KEY/.test(raw)) {
      return '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。';
    }
    return upMsg || outer.error || raw.slice(0, 300) || ('HTTP ' + status);
  }

  /* ---------------- 发送 ---------------- */
  function syncSend() {
    el.send.disabled = state.busy || !el.input.value.trim() || !state.model;
  }

  function send() {
    var text = el.input.value.trim();
    if (!text || state.busy) return;
    if (!state.model) { toast('请先填写模型 ID'); el.model.focus(); return; }

    var c = current();
    var first = c.messages.length === 0;
    c.messages.push({ role: 'user', content: text });
    if (first) c.title = text.slice(0, 28);
    persist();
    renderConvList();
    renderThread();

    el.input.value = '';
    autoGrow();
    syncSend();

    var body = appendBubble('assistant');
    var acc = '';
    var reasonAcc = '';
    var stick = true;

    state.busy = true;
    el.send.style.display = 'none';
    el.stop.style.display = 'flex';
    state.controller = new AbortController();

    // 这里是「多轮对话」的全部实现：Chat Completions 协议无服务端状态，
    // 每次请求都要把历史原样重发一遍。只回传 content，不回传 reasoning
    // （上游不需要，且会白烧 token）。
    var hist = c.messages.filter(function (m) { return m.content; });
    var history = (state.ctxN > 0 ? hist.slice(-state.ctxN) : hist)
      .map(function (m) { return { role: m.role, content: m.content }; });

    var payload = { model: state.model, messages: history, temperature: 0.7 };
    var meta = state.modelMeta[state.model];
    var canReason = !!(meta && meta.capabilities && meta.capabilities.reasoning);
    if (canReason && state.effort) {
      if (state.effort === 'off') payload.reasoning = { enabled: false };
      else payload.reasoning_effort = state.effort;
    }

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Token': state.token },
      body: JSON.stringify(payload),
      signal: state.controller.signal,
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(explainError(t, res.status));
          });
        }
        if (!res.body) throw new Error('服务端未返回流，反代可能不支持 SSE');
        return pump(res, function (cDelta, rDelta, done) {
          if (rDelta) reasonAcc += rDelta;
          if (cDelta) acc += cDelta;
          if (stick && nearBottom()) toBottom();
          body.innerHTML = renderParts(reasonAcc, acc) + (done ? '' : '<span class="caret"></span>');
          if (!done && nearBottom()) toBottom();
        });
      })
      .then(function () {
        if (acc) {
          c.messages.push({ role: 'assistant', content: acc });
          persist();
        }
        body.innerHTML = renderParts(reasonAcc, acc);
      })
      .catch(function (e) {
        if (e.name === 'AbortError') {
          if (acc) { c.messages.push({ role: 'assistant', content: acc }); persist(); }
          body.innerHTML = renderParts(reasonAcc, acc);
          return;
        }
        toast(e.message || String(e));
        if (!acc) body.parentNode.parentNode.removeChild(body.parentNode);
      })
      .then(function () {
        state.busy = false;
        state.controller = null;
        el.stop.style.display = 'none';
        el.send.style.display = 'flex';
        syncSend();
        toBottom();
      });
  }

  // 逐块读取 SSE，把 content / reasoning 增量分别交给 onChunk(cDelta, rDelta, done)
  function pump(res, onChunk) {
    var reader = res.body.getReader();
    var dec = new TextDecoder('utf-8');
    var buf = '';

    return reader.read().then(function step(part) {
      if (part.done) { onChunk('', '', true); return; }
      buf += dec.decode(part.value, { stream: true });

      var lines = buf.split('\n');
      buf = lines.pop();

      var c = '';
      var r = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('data:') !== 0) continue;
        var data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          var j = JSON.parse(data);
          var ch = j.choices && j.choices[0];
          if (!ch) continue;
          var d = ch.delta || {};
          if (d.reasoning) r += d.reasoning;
          if (d.content) c += d.content;
        } catch (e) { /* 半包，下一块补齐后再解析 */ }
      }
      if (c || r) onChunk(c, r, false);
      return reader.read().then(step);
    });
  }

  /* ---------------- 门禁 ---------------- */
  function showGate(err) {
    el.gate.classList.remove('hide');
    el.gateErr.textContent = err || '';
    setTimeout(function () { el.gateInput.focus(); }, 30);
  }
  function hideGate() { el.gate.classList.add('hide'); }

  function submitGate() {
    var v = el.gateInput.value.trim();
    el.gateErr.textContent = '验证中…';
    fetch('/api/models', { headers: { 'X-Access-Token': v } })
      .then(function (r) {
        if (r.status === 401) throw new Error('口令不正确');
        if (!r.ok) throw new Error('服务端 HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        state.token = v;
        store(LS.token, v);
        store(LS.gated, '1');
        hideGate();
        var list = (j && j.data) || [];
        fillModels(list);
        var ids = list.map(function (m) { return m.id; });
        if (list.length && (!state.model || ids.indexOf(state.model) === -1)) {
          state.model = list[0].id;
        }
        el.model.value = state.model;
        store(LS.model, state.model);
        syncEffort();
        renderThread();
        syncSend();
      })
      .catch(function (e) {
        showGate(e.message || String(e));
      });
  }

  /* ---------------- UI ---------------- */
  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
  }
  function closeSidebar() { el.sidebar.classList.remove('open'); }

  el.input.addEventListener('input', function () { autoGrow(); syncSend(); });
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  el.send.addEventListener('click', send);
  el.stop.addEventListener('click', function () {
    if (state.controller) state.controller.abort();
  });

  el.newChat.addEventListener('click', function () {
    if (state.busy) return;
    state.currentId = null;
    current();
    persist();
    renderConvList();
    renderThread();
    closeSidebar();
    el.input.focus();
  });

  el.burger.addEventListener('click', function () { el.sidebar.classList.toggle('open'); });
  el.thread.addEventListener('click', closeSidebar);

  el.model.addEventListener('change', function () {
    state.model = el.model.value.trim();
    store(LS.model, state.model);
    syncSend();
    syncEffort();
    renderThread();
  });

  el.effort.addEventListener('change', function () {
    state.effort = el.effort.value;
    store(LS.effort, state.effort);
  });

  el.ctx.addEventListener('change', function () {
    state.ctxN = parseInt(el.ctx.value, 10) || 0;
    store(LS.ctx, String(state.ctxN));
    if (state.ctxN === 0) toast('已改为携带全部历史：长会话会显著增加费用，也可能撞上 1MB 请求体上限');
  });

  el.logout.addEventListener('click', function () {
    store(LS.gated, '');
    showGate('');
  });

  el.gateGo.addEventListener('click', submitGate);
  el.gateInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitGate(); }
  });

  /* ---------------- 启动 ---------------- */
  el.model.value = state.model;
  el.effort.value = state.effort;
  el.ctx.value = String(state.ctxN);
  syncEffort();
  autoGrow();
  renderConvList();
  renderThread();
  syncSend();

  if (localStorage.getItem(LS.gated) === '1') {
    hideGate();
    loadModels();
  } else {
    showGate('');
  }
})();
