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
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    sidebar: $('sidebar'), burger: $('burger'), newChat: $('new-chat'), convList: $('conv-list'),
    model: $('model'), modelList: $('model-list'), logout: $('logout'),
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
    busy: false,
    controller: null,
  };

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
        el.modelList.innerHTML = '';
        list.forEach(function (m) {
          var o = document.createElement('option');
          o.value = m.id;
          if (m.id.indexOf(state.model) === 0) o.label = m.id;
          el.modelList.appendChild(o);
        });
        if (!state.model) {
          state.model = list[0].id;
          el.model.value = state.model;
          store(LS.model, state.model);
        }
        renderThread();
      })
      .catch(function (e) {
        toast('模型列表拉取失败：' + e.message + '（可手动填写模型 ID）');
      });
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
    var stick = true;

    state.busy = true;
    el.send.style.display = 'none';
    el.stop.style.display = 'flex';
    state.controller = new AbortController();

    var history = c.messages
      .filter(function (m) { return m.content; })
      .slice(-20)
      .map(function (m) { return { role: m.role, content: m.content }; });

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Token': state.token },
      body: JSON.stringify({ model: state.model, messages: history, temperature: 0.7 }),
      signal: state.controller.signal,
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            var msg = '';
            try { msg = (JSON.parse(t) || {}).error || (JSON.parse(t) || {}).message || ''; }
            catch (e) { msg = t.slice(0, 300); }
            throw new Error(msg || ('HTTP ' + res.status));
          });
        }
        if (!res.body) throw new Error('服务端未返回流，反代可能不支持 SSE');
        return pump(res, function (chunk, done) {
          if (chunk) acc += chunk;
          if (stick && nearBottom()) toBottom();
          body.innerHTML = renderStream(acc) + (done ? '' : '<span class="caret"></span>');
          if (!done && nearBottom()) toBottom();
        });
      })
      .then(function () {
        if (acc) {
          c.messages.push({ role: 'assistant', content: acc });
          persist();
        }
        body.innerHTML = renderMd(acc);
      })
      .catch(function (e) {
        if (e.name === 'AbortError') {
          if (acc) { c.messages.push({ role: 'assistant', content: acc }); persist(); }
          body.innerHTML = renderMd(acc);
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

  // 逐块读取 SSE，把 delta 交给 onChunk
  function pump(res, onChunk) {
    var reader = res.body.getReader();
    var dec = new TextDecoder('utf-8');
    var buf = '';

    return reader.read().then(function step(part) {
      if (part.done) { onChunk('', true); return; }
      buf += dec.decode(part.value, { stream: true });

      var lines = buf.split('\n');
      buf = lines.pop();

      var delta = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('data:') !== 0) continue;
        var data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          var j = JSON.parse(data);
          var ch = j.choices && j.choices[0];
          if (!ch) continue;
          var d = (ch.delta && ch.delta.content) || (ch.message && ch.message.content);
          if (d) delta += d;
        } catch (e) { /* 半包，下一块补齐后再解析 */ }
      }
      if (delta) onChunk(delta, false);
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
        el.modelList.innerHTML = '';
        list.forEach(function (m) {
          var o = document.createElement('option');
          o.value = m.id;
          el.modelList.appendChild(o);
        });
        if (list.length && !state.model) {
          state.model = list[0].id;
          el.model.value = state.model;
          store(LS.model, state.model);
        }
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
    renderThread();
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
