/* ZenMux Chat —— 现代化边缘 AI 对话站
   存储架构：IndexedDB (ZenMuxChatDB) 高性能异步持久化
   多模态：客户端 Canvas 自适应重采样与压缩、剪贴板粘贴、文件拖拽、灯箱大图预览、输入模态自适应
*/
(function () {
  'use strict';

  var LS = {
    cur: 'zm.current',
    model: 'zm.model',
    token: 'zm.token',
    gated: 'zm.gated',
    effort: 'zm.effort',
    ctx: 'zm.ctx',
  };

  var DB_NAME = 'ZenMuxChatDB';
  var DB_VERSION = 1;
  var STORE_CONV = 'conversations';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    sidebar: $('sidebar'), burger: $('burger'), newChat: $('new-chat'), convList: $('conv-list'),
    model: $('model'), effort: $('effort'), ctx: $('ctx'), logout: $('logout'),
    thread: $('thread'), threadInner: $('thread-inner'),
    input: $('input'), send: $('send'), stop: $('stop'),
    attachBtn: $('attach-btn'), fileInput: $('file-input'), attachmentsTray: $('composer-attachments'),
    dropOverlay: $('drop-overlay'),
    lightbox: $('lightbox'), lightboxImg: $('lightbox-img'), lightboxClose: $('lightbox-close'),
    gate: $('gate'), gateInput: $('gate-input'), gateGo: $('gate-go'), gateErr: $('gate-err'),
    toast: $('toast'),
  };

  var state = {
    token: localStorage.getItem(LS.token) || '',
    model: localStorage.getItem(LS.model) || '',
    conversations: [],
    currentId: localStorage.getItem(LS.cur) || null,
    currentConv: null,
    effort: localStorage.getItem(LS.effort) || '',
    ctxN: parseInt(localStorage.getItem(LS.ctx), 10),
    modelMeta: {},
    pendingImages: [], // [{ id, name, dataUrl, width, height, size }]
    busy: false,
    controller: null,
  };
  if (isNaN(state.ctxN)) state.ctxN = 20;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ==========================================================================
     1. IndexedDB 存储引擎 (ZenMuxDB)
     ========================================================================== */
  var ZenMuxDB = {
    _db: null,
    init: function () {
      var self = this;
      if (self._db) return Promise.resolve(self._db);
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
          return reject(new Error('当前浏览器不支持 IndexedDB'));
        }
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_CONV)) {
            var store = db.createObjectStore(STORE_CONV, { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
        };
        req.onsuccess = function (e) {
          self._db = e.target.result;
          resolve(self._db);
        };
        req.onerror = function (e) {
          reject(e.target.error || new Error('打开 IndexedDB 数据库失败'));
        };
      });
    },

    getAllConversations: function () {
      var self = this;
      return self.init().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([STORE_CONV], 'readonly');
          var store = tx.objectStore(STORE_CONV);
          var req = store.getAll();
          req.onsuccess = function () {
            var list = req.result || [];
            list.sort(function (a, b) {
              return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
            });
            resolve(list);
          };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    getConversation: function (id) {
      var self = this;
      return self.init().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([STORE_CONV], 'readonly');
          var store = tx.objectStore(STORE_CONV);
          var req = store.get(id);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    putConversation: function (conv) {
      var self = this;
      return self.init().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([STORE_CONV], 'readwrite');
          var store = tx.objectStore(STORE_CONV);
          var req = store.put(conv);
          req.onsuccess = function () { resolve(conv); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    deleteConversation: function (id) {
      var self = this;
      return self.init().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([STORE_CONV], 'readwrite');
          var store = tx.objectStore(STORE_CONV);
          var req = store.delete(id);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    }
  };

  /* ==========================================================================
     2. 客户端自适应图像重采样与压缩引擎 (ImageProcessor)
     ========================================================================== */
  var ImageProcessor = {
    MAX_DIMENSION: 1600, // 最大宽/高限制（像素）
    JPEG_QUALITY: 0.82,  // 压缩质量
    MAX_FILE_SIZE_MB: 15,

    processFile: function (file) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
          return reject(new Error('所选文件不是有效的图片格式'));
        }
        if (file.size > self.MAX_FILE_SIZE_MB * 1024 * 1024) {
          return reject(new Error('图片大小超过 ' + self.MAX_FILE_SIZE_MB + 'MB 上限'));
        }

        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            var originalWidth = img.naturalWidth || img.width;
            var originalHeight = img.naturalHeight || img.height;
            var w = originalWidth;
            var h = originalHeight;

            // 等比缩放
            if (w > self.MAX_DIMENSION || h > self.MAX_DIMENSION) {
              if (w >= h) {
                h = Math.round((h * self.MAX_DIMENSION) / w);
                w = self.MAX_DIMENSION;
              } else {
                w = Math.round((w * self.MAX_DIMENSION) / h);
                h = self.MAX_DIMENSION;
              }
            }

            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, w, h);
            }

            // 保持透明小图为 PNG，其余转为高压缩比 JPEG
            var isSmallPng = file.type === 'image/png' && file.size < 250 * 1024;
            var mime = isSmallPng ? 'image/png' : 'image/jpeg';
            var dataUrl = canvas.toDataURL(mime, self.JPEG_QUALITY);

            var head = dataUrl.indexOf(',');
            var b64Len = dataUrl.length - (head >= 0 ? head + 1 : 0);
            var compSize = Math.round((b64Len * 3) / 4);

            resolve({
              id: uid(),
              name: file.name || 'image.jpg',
              mimeType: mime,
              dataUrl: dataUrl,
              width: w,
              height: h,
              originalSize: file.size,
              size: compSize,
            });
          };
          img.onerror = function () {
            reject(new Error('无法解码该图片文件'));
          };
          img.src = e.target.result;
        };
        reader.onerror = function () {
          reject(new Error('读取图片文件失败'));
        };
        reader.readAsDataURL(file);
      });
    }
  };

  /* ==========================================================================
     3. Markdown 渲染引擎
     ========================================================================== */
  var SENT = String.fromCharCode(1);

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    var text = String(src || '').replace(/\r\n?/g, '\n');

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
            items[items.length - 1] += '\n' + lines[i].trim();
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

  function renderParts(reasoning, content) {
    var html = '';
    if (reasoning && reasoning.trim()) {
      html += '<details class="reasoning" open><summary>思考过程</summary>' +
        renderMd(reasoning) + '</details>';
    }
    html += renderMd(content || '');
    return html;
  }

  /* ==========================================================================
     4. 交互提示 & 灯箱大图预览 (Toast & Lightbox)
     ========================================================================== */
  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.display = 'none'; }, 4000);
  }

  function openLightbox(src) {
    if (!src) return;
    el.lightboxImg.src = src;
    el.lightbox.classList.remove('hide');
  }

  function closeLightbox() {
    el.lightbox.classList.add('hide');
    el.lightboxImg.src = '';
  }

  el.lightboxClose.addEventListener('click', closeLightbox);
  el.lightbox.addEventListener('click', function (e) {
    if (e.target === el.lightbox || e.target === el.lightboxClose) closeLightbox();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.lightbox.classList.contains('hide')) {
      closeLightbox();
    }
  });

  /* ==========================================================================
     5. 附件管理与图片添加 (Attachments & Vision Input)
     ========================================================================== */
  function renderAttachments() {
    el.attachmentsTray.innerHTML = '';
    if (!state.pendingImages.length) return;

    state.pendingImages.forEach(function (img, idx) {
      var card = document.createElement('div');
      card.className = 'attachment-card';

      var pic = document.createElement('img');
      pic.src = img.dataUrl;
      pic.alt = img.name;
      pic.title = img.name + ' (' + Math.round(img.size / 1024) + ' KB)';
      pic.addEventListener('click', function () { openLightbox(img.dataUrl); });

      var del = document.createElement('button');
      del.className = 'attachment-del';
      del.textContent = '×';
      del.title = '移除此图片';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.pendingImages.splice(idx, 1);
        renderAttachments();
        syncSend();
      });

      card.appendChild(pic);
      card.appendChild(del);
      el.attachmentsTray.appendChild(card);
    });
  }

  function handleIncomingFiles(fileList) {
    if (!fileList || !fileList.length) return;

    var m = state.modelMeta[state.model];
    if (m && !hasVision(m)) {
      toast('当前选中的模型不支持图片输入，请先切换至支持视觉的模型');
      return;
    }

    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f.type && f.type.indexOf('image/') === 0;
    });
    if (!files.length) {
      toast('仅支持添加图片格式文件 (JPEG, PNG, WebP, GIF)');
      return;
    }

    if (state.pendingImages.length + files.length > 6) {
      toast('单次提问最多附加 6 张图片');
      files = files.slice(0, 6 - state.pendingImages.length);
    }

    var promises = files.map(function (file) {
      return ImageProcessor.processFile(file).then(function (imgObj) {
        state.pendingImages.push(imgObj);
      }).catch(function (err) {
        toast('处理图片 "' + file.name + '" 失败: ' + err.message);
      });
    });

    Promise.all(promises).then(function () {
      renderAttachments();
      syncSend();
      el.input.focus();
    });
  }

  el.attachBtn.addEventListener('click', function () {
    var m = state.modelMeta[state.model];
    if (m && !hasVision(m)) {
      toast('当前选中的模型不支持图片输入');
      return;
    }
    el.fileInput.click();
  });

  el.fileInput.addEventListener('change', function () {
    handleIncomingFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  // 剪贴板粘贴图片 (Paste Event)
  window.addEventListener('paste', function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;
    var items = e.clipboardData.items;
    var pastedImages = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var blob = items[i].getAsFile();
        if (blob) pastedImages.push(blob);
      }
    }
    if (pastedImages.length > 0) {
      e.preventDefault();
      var m = state.modelMeta[state.model];
      if (m && !hasVision(m)) {
        toast('当前选中的模型不支持图片输入，请先切换至支持视觉的模型');
        return;
      }
      handleIncomingFiles(pastedImages);
    }
  });

  // 拖拽上传 (Drag & Drop)
  var dragCounter = 0;
  window.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragCounter++;
    el.dropOverlay.classList.add('active');
  });

  window.addEventListener('dragover', function (e) {
    e.preventDefault();
  });

  window.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      el.dropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragCounter = 0;
    el.dropOverlay.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files) {
      var m = state.modelMeta[state.model];
      if (m && !hasVision(m)) {
        toast('当前选中的模型不支持图片输入，请先切换至支持视觉的模型');
        return;
      }
      handleIncomingFiles(e.dataTransfer.files);
    }
  });

  /* ==========================================================================
     6. 会话模型与 IndexedDB 联动 (Conversation Lifecycle)
     ========================================================================== */
  function loadAllConversations() {
    return ZenMuxDB.getAllConversations().then(function (list) {
      state.conversations = list;
      if (!list.length) {
        return createNewConversation();
      }
      var found = list.find(function (c) { return c.id === state.currentId; });
      if (!found) {
        state.currentId = list[0].id;
        state.currentConv = list[0];
      } else {
        state.currentConv = found;
      }
      localStorage.setItem(LS.cur, state.currentId);
      renderConvList();
      renderThread();
    }).catch(function (err) {
      toast('读取 IndexedDB 会话失败: ' + err.message);
    });
  }

  function createNewConversation() {
    var c = {
      id: uid(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return ZenMuxDB.putConversation(c).then(function () {
      state.conversations.unshift(c);
      state.currentId = c.id;
      state.currentConv = c;
      localStorage.setItem(LS.cur, c.id);
      renderConvList();
      renderThread();
      return c;
    });
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
        ZenMuxDB.deleteConversation(c.id).then(function () {
          state.conversations = state.conversations.filter(function (x) { return x.id !== c.id; });
          if (state.currentId === c.id) {
            state.currentId = state.conversations.length ? state.conversations[0].id : null;
            state.currentConv = state.conversations.length ? state.conversations[0] : null;
            if (state.currentId) localStorage.setItem(LS.cur, state.currentId);
            else localStorage.removeItem(LS.cur);
          }
          if (!state.conversations.length) {
            createNewConversation();
          } else {
            renderConvList();
            renderThread();
          }
          syncSend();
        }).catch(function (err) {
          toast('删除失败: ' + err.message);
        });
      });

      row.appendChild(txt);
      row.appendChild(del);
      row.addEventListener('click', function () {
        if (state.busy || state.currentId === c.id) return;
        state.currentId = c.id;
        state.currentConv = c;
        localStorage.setItem(LS.cur, c.id);
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
    var c = state.currentConv;
    el.threadInner.innerHTML = '';

    if (!c || !c.messages || !c.messages.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.model ? '开始一段对话，支持发送图片与多模态分析' : '先在上方选择模型';
      el.threadInner.appendChild(empty);
      return;
    }

    c.messages.forEach(function (m) {
      el.threadInner.appendChild(bubble(m.role, m.content, m.images, m.reasoning));
    });
    toBottom();
  }

  function bubble(role, content, images, reasoning) {
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

    // 若附带图片，在气泡顶部渲染图片网格
    if (images && images.length) {
      var grid = document.createElement('div');
      grid.className = 'msg-images';
      images.forEach(function (img) {
        var thumb = document.createElement('div');
        thumb.className = 'msg-img-thumb';
        var imgTag = document.createElement('img');
        imgTag.src = img.dataUrl;
        imgTag.alt = img.name || '图片';
        imgTag.loading = 'lazy';
        thumb.addEventListener('click', function () {
          openLightbox(img.dataUrl);
        });
        thumb.appendChild(imgTag);
        grid.appendChild(thumb);
      });
      body.appendChild(grid);
    }

    var textNode = document.createElement('div');
    if (role === 'user') {
      textNode.textContent = content || '';
    } else {
      textNode.innerHTML = renderParts(reasoning, content);
    }
    body.appendChild(textNode);

    col.appendChild(who);
    col.appendChild(body);
    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  function appendBubble(role) {
    var wrap = bubble(role, '', null, '');
    el.threadInner.appendChild(wrap);
    return wrap.querySelector('.body > div:last-child');
  }

  /* ==========================================================================
     7. 模型列表与能力检测 (Models & Capabilities)
     ========================================================================== */
  function hasVision(m) {
    if (!m) return false;
    // 优先依据 ZenMux 返回的 input_modalities 数组判断
    if (Array.isArray(m.input_modalities)) {
      return m.input_modalities.indexOf('image') !== -1;
    }
    if (m.capabilities && m.capabilities.vision) return true;
    var id = (m.id || '').toLowerCase();
    return /gpt-4o|claude-3|gemini|vl|vision|qwen.*vl|yi-vl|pixtral|llava|glm-4v/i.test(id);
  }

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
        if (hasVision(m)) label += ' ·视觉';
        if (m.capabilities && m.capabilities.reasoning) label += ' ·推理';
        if (isFree(m)) label += ' ·免费';
        o.textContent = label;
        og.appendChild(o);
      });
      el.model.appendChild(og);
    });
  }

  function syncVision() {
    var m = state.modelMeta[state.model];
    var can = hasVision(m);
    var unknown = !m;
    var enabled = can || unknown;
    el.attachBtn.disabled = !enabled;
    el.fileInput.disabled = !enabled;
    if (enabled) {
      el.attachBtn.classList.remove('disabled');
      el.attachBtn.title = '添加图片（支持点击、拖拽、剪贴板粘贴）';
    } else {
      el.attachBtn.classList.add('disabled');
      el.attachBtn.title = '当前模型不支持图片输入';
      if (state.pendingImages.length > 0) {
        state.pendingImages = [];
        renderAttachments();
        toast('已切换至不支持图片输入的模型，已清空图片附件');
      }
    }
  }

  function syncEffort() {
    var m = state.modelMeta[state.model];
    var can = !!(m && m.capabilities && m.capabilities.reasoning);
    var unknown = !m;
    el.effort.disabled = !can && !unknown;
    el.effort.title = can
      ? '推理强度：ZenMux 不传此参数时默认 medium'
      : (unknown ? '推理强度（模型信息载入中）' : '当前模型不支持推理');
  }

  function syncModelCapabilities() {
    syncVision();
    syncEffort();
  }

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
        localStorage.setItem(LS.model, state.model);
        syncModelCapabilities();
        renderThread();
      })
      .catch(function (e) {
        toast('模型列表拉取失败：' + e.message + '（可手动输入/选择）');
      });
  }

  function explainError(raw, status) {
    var outer = {}, inner = {};
    try { outer = JSON.parse(raw) || {}; } catch (e) { }
    try { inner = (JSON.parse(outer.detail || '{}') || {}).error || {}; } catch (e) { }
    var upMsg = inner.message || '';
    var type = inner.type || '';

    if (status === 402 || type === 'reject_no_credit') {
      return '该模型要求账户余额大于 0（ZenMux 的防滥用策略，不是扣费）。充一点余额即可解锁。';
    }
    if (status === 429 || type === 'rate_limit') {
      return '该模型当前访问量过大被限流，稍后重试或换一个模型。';
    }
    if (status === 401) return '访问口令不正确，请点右上角退出后重新输入。';
    if (status === 400) return '请求被上游拒绝：' + (upMsg || '参数或多模态格式不被该模型支持');
    if (status === 502) return '边缘节点连接 ZenMux 失败，稍后重试。';
    if (status === 500 && /ZENMUX_API_KEY/.test(raw)) {
      return '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。';
    }
    return upMsg || outer.error || raw.slice(0, 300) || ('HTTP ' + status);
  }

  /* ==========================================================================
     8. 消息发送与 SSE 多模态流式响应 (Message Dispatch & Streaming)
     ========================================================================== */
  function syncSend() {
    var hasContent = !!el.input.value.trim() || state.pendingImages.length > 0;
    el.send.disabled = state.busy || !hasContent || !state.model;
  }

  function send() {
    var text = el.input.value.trim();
    var images = state.pendingImages.slice();
    if ((!text && !images.length) || state.busy) return;
    if (!state.model) { toast('请先选择模型'); el.model.focus(); return; }

    var meta = state.modelMeta[state.model];
    if (images.length && meta && !hasVision(meta)) {
      toast('当前模型不支持图片输入，请先切换至支持视觉的模型');
      return;
    }

    var c = state.currentConv;
    if (!c) return;

    var first = c.messages.length === 0;
    var userMsg = {
      id: uid(),
      role: 'user',
      content: text,
      images: images.length ? images : undefined,
      createdAt: Date.now()
    };
    c.messages.push(userMsg);
    c.updatedAt = Date.now();
    if (first) {
      c.title = (text || (images.length ? '[图片分析]' : '新对话')).slice(0, 28);
    }

    // 移除空白提示
    var emptyNode = el.threadInner.querySelector('.empty');
    if (emptyNode) {
      emptyNode.parentNode.removeChild(emptyNode);
    }

    // 直接追加 User 气泡到活跃 DOM，绝不在流式开始前重写 innerHTML
    el.threadInner.appendChild(bubble('user', text, images, ''));

    // 后台异步保存至 IndexedDB 并更新左侧会话标题
    ZenMuxDB.putConversation(c).then(function () {
      renderConvList();
    });

    // 清空输入与附件
    el.input.value = '';
    state.pendingImages = [];
    renderAttachments();
    autoGrow();
    syncSend();

    // 追加 Assistant 气泡并获取正文引用
    var body = appendBubble('assistant');
    toBottom();

    var acc = '';
    var reasonAcc = '';
    var stick = true;

    state.busy = true;
    el.send.style.display = 'none';
    el.stop.style.display = 'flex';
    state.controller = new AbortController();

    // 格式化上下文历史为 OpenAI Multimodal 规范
    var hist = c.messages.filter(function (m) { return m.content || (m.images && m.images.length); });
    var sliced = (state.ctxN > 0 ? hist.slice(-state.ctxN) : hist);

    var history = sliced.map(function (m) {
      if (m.role === 'user' && m.images && m.images.length) {
        var parts = [];
        if (m.content && m.content.trim()) {
          parts.push({ type: 'text', text: m.content });
        } else {
          parts.push({ type: 'text', text: '请分析上述图片' });
        }
        m.images.forEach(function (img) {
          parts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl, detail: 'auto' }
          });
        });
        return { role: 'user', content: parts };
      }
      return { role: m.role, content: m.content || '' };
    });

    var payload = { model: state.model, messages: history, temperature: 0.7 };
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
        if (acc || reasonAcc) {
          var asstMsg = {
            id: uid(),
            role: 'assistant',
            content: acc,
            reasoning: reasonAcc || undefined,
            createdAt: Date.now()
          };
          c.messages.push(asstMsg);
          c.updatedAt = Date.now();
          ZenMuxDB.putConversation(c);
        }
        body.innerHTML = renderParts(reasonAcc, acc);
      })
      .catch(function (e) {
        if (e.name === 'AbortError') {
          if (acc || reasonAcc) {
            c.messages.push({
              id: uid(),
              role: 'assistant',
              content: acc,
              reasoning: reasonAcc || undefined,
              createdAt: Date.now()
            });
            c.updatedAt = Date.now();
            ZenMuxDB.putConversation(c);
          }
          body.innerHTML = renderParts(reasonAcc, acc);
          return;
        }
        toast(e.message || String(e));
        if (!acc && !reasonAcc && body && body.parentNode && body.parentNode.parentNode) {
          body.parentNode.parentNode.removeChild(body.parentNode);
        }
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
        } catch (e) { }
      }
      if (c || r) onChunk(c, r, false);
      return reader.read().then(step);
    });
  }

  /* ==========================================================================
     9. 门禁验证 (Access Gate)
     ========================================================================== */
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
        localStorage.setItem(LS.token, v);
        localStorage.setItem(LS.gated, '1');
        hideGate();
        var list = (j && j.data) || [];
        fillModels(list);
        var ids = list.map(function (m) { return m.id; });
        if (list.length && (!state.model || ids.indexOf(state.model) === -1)) {
          state.model = list[0].id;
        }
        el.model.value = state.model;
        localStorage.setItem(LS.model, state.model);
        syncModelCapabilities();
        renderThread();
        syncSend();
      })
      .catch(function (e) {
        showGate(e.message || String(e));
      });
  }

  /* ==========================================================================
     10. 界面事件监听与初始化 (UI & Startup)
     ========================================================================== */
  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
  }
  function closeSidebar() { el.sidebar.classList.remove('open'); }

  el.input.addEventListener('input', function () { autoGrow(); syncSend(); });
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  el.send.addEventListener('click', send);
  el.stop.addEventListener('click', function () {
    if (state.controller) state.controller.abort();
  });

  el.newChat.addEventListener('click', function () {
    if (state.busy) return;
    createNewConversation().then(function () {
      closeSidebar();
      el.input.focus();
    });
  });

  el.burger.addEventListener('click', function () { el.sidebar.classList.toggle('open'); });
  el.thread.addEventListener('click', closeSidebar);

  el.model.addEventListener('change', function () {
    state.model = el.model.value.trim();
    localStorage.setItem(LS.model, state.model);
    syncSend();
    syncModelCapabilities();
    renderThread();
  });

  el.effort.addEventListener('change', function () {
    state.effort = el.effort.value;
    localStorage.setItem(LS.effort, state.effort);
  });

  el.ctx.addEventListener('change', function () {
    state.ctxN = parseInt(el.ctx.value, 10) || 0;
    localStorage.setItem(LS.ctx, String(state.ctxN));
    if (state.ctxN === 0) toast('已改为携带全部历史');
  });

  el.logout.addEventListener('click', function () {
    localStorage.setItem(LS.gated, '');
    showGate('');
  });

  el.gateGo.addEventListener('click', submitGate);
  el.gateInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitGate(); }
  });

  // 启动引导
  el.model.value = state.model;
  el.effort.value = state.effort;
  el.ctx.value = String(state.ctxN);
  syncModelCapabilities();
  autoGrow();
  syncSend();

  loadAllConversations().then(function () {
    if (localStorage.getItem(LS.gated) === '1') {
      hideGate();
      loadModels();
    } else {
      showGate('');
    }
  });
})();
