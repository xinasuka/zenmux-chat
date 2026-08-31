/* ZenMux Chat —— 现代化边缘 AI 对话站
   存储架构：IndexedDB (ZenMuxChatDB) 高性能异步持久化
   多模态与文件：客户端 Canvas 图像自适应重采样与压缩、全格式代码/文档就地文本提取与上下文注入、剪贴板粘贴、文件拖拽、灯箱预览
   会话管理：双阶启发式智能标题提炼 + 侧边栏内联手动重命名
   联网检索：全模型前置实时全网检索增强 (RAG Grounding) + 检索深度多档位控制 + 引用来源溯源
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
    webSearch: 'zm.webSearch',
    searchDepth: 'zm.searchDepth',
  };

  var DB_NAME = 'ZenMuxChatDB';
  var DB_VERSION = 1;
  var STORE_CONV = 'conversations';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    sidebar: $('sidebar'), burger: $('burger'), newChat: $('new-chat'), convList: $('conv-list'),
    model: $('model'), effort: $('effort'), searchDepth: $('search-depth'), ctx: $('ctx'), logout: $('logout'),
    thread: $('thread'), threadInner: $('thread-inner'),
    input: $('input'), send: $('send'), stop: $('stop'),
    attachBtn: $('attach-btn'), webSearchBtn: $('web-search-btn'), fileInput: $('file-input'), attachmentsTray: $('composer-attachments'),
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
    webSearch: localStorage.getItem(LS.webSearch) === '1',
    searchDepth: localStorage.getItem(LS.searchDepth) || 'standard',
    modelMeta: {},
    pendingAttachments: [],
    busy: false,
    controller: null,
  };
  if (isNaN(state.ctxN)) state.ctxN = 20;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function getSearchCountByDepth(depth) {
    switch (depth) {
      case 'quick': return 3;
      case 'deep': return 10;
      case 'pro': return 20;
      case 'standard':
      default: return 5;
    }
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
     2. 图像重采样与压缩引擎 (ImageProcessor)
     ========================================================================== */
  var ImageProcessor = {
    MAX_DIMENSION: 1600,
    JPEG_QUALITY: 0.82,
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

            var isSmallPng = file.type === 'image/png' && file.size < 250 * 1024;
            var mime = isSmallPng ? 'image/png' : 'image/jpeg';
            var dataUrl = canvas.toDataURL(mime, self.JPEG_QUALITY);

            var head = dataUrl.indexOf(',');
            var b64Len = dataUrl.length - (head >= 0 ? head + 1 : 0);
            var compSize = Math.round((b64Len * 3) / 4);

            resolve({
              id: uid(),
              type: 'image',
              name: file.name || 'image.jpg',
              ext: (file.name || '').split('.').pop().toLowerCase() || 'img',
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
     3. 源码与文档就地文本提取引擎 (FileTextExtractor)
     ========================================================================== */
  var FileTextExtractor = {
    MAX_CHARS: 100000,
    MAX_FILE_SIZE_MB: 10,

    isImageFile: function (file) {
      if (file.type && file.type.indexOf('image/') === 0) return true;
      var ext = (file.name || '').split('.').pop().toLowerCase();
      return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext) !== -1;
    },

    processFile: function (file) {
      var self = this;
      var ext = (file.name || '').split('.').pop().toLowerCase();

      if (file.size > self.MAX_FILE_SIZE_MB * 1024 * 1024) {
        return Promise.reject(new Error('文件超过 ' + self.MAX_FILE_SIZE_MB + 'MB 上限'));
      }

      if (ext === 'pdf') {
        return self.extractPdf(file);
      }

      return self.extractPlainText(file, ext);
    },

    extractPlainText: function (file, ext) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var raw = e.target.result || '';
          var isTruncated = false;
          if (raw.length > self.MAX_CHARS) {
            raw = raw.slice(0, self.MAX_CHARS) + '\n\n[... 文件过长，已自动截取前 ' + self.MAX_CHARS.toLocaleString() + ' 字符 ...]';
            isTruncated = true;
          }
          var lines = raw.split('\n').length;
          resolve({
            id: uid(),
            type: 'file',
            name: file.name,
            ext: ext || 'txt',
            text: raw,
            lines: lines,
            chars: raw.length,
            size: file.size,
            truncated: isTruncated
          });
        };
        reader.onerror = function () {
          reject(new Error('读取文件失败'));
        };
        reader.readAsText(file, 'utf-8');
      });
    },

    extractPdf: function (file) {
      var self = this;
      return new Promise(function (resolve, reject) {
        function doParse(pdfjs) {
          var reader = new FileReader();
          reader.onload = function (e) {
            var typedarray = new Uint8Array(e.target.result);
            pdfjs.getDocument(typedarray).promise.then(function (pdf) {
              var maxPages = Math.min(pdf.numPages, 60);
              var pagePromises = [];
              for (var i = 1; i <= maxPages; i++) {
                pagePromises.push(pdf.getPage(i).then(function (page) {
                  return page.getTextContent().then(function (content) {
                    return content.items.map(function (item) { return item.str; }).join(' ');
                  });
                }));
              }
              Promise.all(pagePromises).then(function (pagesText) {
                var fullText = pagesText.map(function (t, idx) {
                  return '--- 第 ' + (idx + 1) + ' 页 ---\n' + t;
                }).join('\n\n');

                if (fullText.length > self.MAX_CHARS) {
                  fullText = fullText.slice(0, self.MAX_CHARS) + '\n\n[... PDF 内容过长，已自动截取前 ' + self.MAX_CHARS.toLocaleString() + ' 字符 ...]';
                }

                resolve({
                  id: uid(),
                  type: 'file',
                  name: file.name,
                  ext: 'pdf',
                  text: fullText,
                  lines: fullText.split('\n').length,
                  chars: fullText.length,
                  size: file.size,
                  pages: pdf.numPages
                });
              }).catch(reject);
            }).catch(reject);
          };
          reader.onerror = function () { reject(new Error('读取 PDF 失败')); };
          reader.readAsArrayBuffer(file);
        }

        if (window.pdfjsLib) {
          doParse(window.pdfjsLib);
        } else {
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          s.onload = function () {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            doParse(window.pdfjsLib);
          };
          s.onerror = function () {
            reject(new Error('无法动态载入 PDF.js 模块，请检查网络'));
          };
          document.head.appendChild(s);
        }
      });
    }
  };

  /* ==========================================================================
     4. 全模型实时联网检索服务 (WebSearchService)
     ========================================================================== */
  var WebSearchService = {
    search: function (query, token, count) {
      var maxResults = count || 5;
      return fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Access-Token': token
        },
        body: JSON.stringify({ query: query, max_results: maxResults })
      })
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok || (j && j.code !== 0 && j.code !== undefined)) {
              throw new Error((j && j.error) || (j && j.message) || ('HTTP ' + r.status));
            }
            var results = (j && j.data && j.data.results) || [];
            return results.map(function (item) {
              return {
                title: item.title || '网页结果',
                url: item.url || '',
                snippet: item.snippet || item.content || ''
              };
            });
          });
        });
    },

    formatGroundingPrompt: function (query, results) {
      if (!results || !results.length) return '';
      var items = results.map(function (r, idx) {
        var domain = getHostname(r.url);
        return '[' + (idx + 1) + '] 《' + r.title + '》' + (domain ? ' (' + domain + ')' : '') + '\n' +
               '链接: ' + r.url + '\n' +
               '摘要: ' + (r.snippet || '').trim();
      }).join('\n\n');

      return '--- 实时全网检索事实参考 (Web Grounding) ---\n' +
             '以下是针对用户查询【' + query + '】检索到的最新全网参考资料：\n\n' +
             items + '\n\n' +
             '--- 检索信息结束。请基于上述最新事实与数据进行严谨准确的回答，并在引用处标注来源序号（如 [1]）。 ---';
    }
  };

  /* ==========================================================================
     5. 智能标题提取与降噪引擎 (TitleExtractor)
     ========================================================================== */
  var TitleExtractor = {
    cleanUserPrompt: function (text, files, images) {
      if (files && files.length) {
        return (files[0].name + (files.length > 1 ? ' 等' + files.length + '个文件' : '')).slice(0, 24);
      }
      var raw = (text || '').trim();
      if (!raw) return '新对话';

      var cleaned = raw.replace(/^(?:(?:请问|请帮我|麻烦帮我|我想了解|帮我写一个|帮我写|帮我做|帮我分析|请分析|请解释|请教|你好|您好|hi|hello|如何|怎么|怎样|如何实现|怎么写|能否|可以帮我|想问下|我想问)[\s，,：:、]*)+/i, '').trim();
      cleaned = cleaned.replace(/^[？?！!，,。.\s]+/, '').trim();

      var result = cleaned || raw;
      if (images && images.length && (!text || !text.trim())) {
        result = '[图片] ' + result;
      }
      return result.slice(0, 24);
    },

    sniffAssistantTitle: function (content) {
      if (!content || typeof content !== 'string') return null;
      var text = content.trim();

      var headMatch = text.match(/(?:^|\n)#{1,3}\s+([^\n#`]{3,30})/);
      if (headMatch && headMatch[1]) {
        var h = headMatch[1].trim()
          .replace(/^[\d+.\s、]+/, '')
          .replace(/[：:。!！?？]+$/, '')
          .trim();
        if (h.length >= 2 && h.length <= 26 && !/^(引言|简介|概述|分析|总结|解答|步骤|方案|说明)$/.test(h)) {
          return h;
        }
      }

      var boldMatch = text.match(/(?:^|\n)\*\*([^*\n]{3,24})\*\*/);
      if (boldMatch && boldMatch[1]) {
        var b = boldMatch[1].trim()
          .replace(/^[\d+.\s、]+/, '')
          .replace(/[：:。!！?？]+$/, '')
          .trim();
        if (b.length >= 2 && b.length <= 24 && !/^(注意|提示|警告|总结|说明|步骤|方案)$/.test(b)) {
          return b;
        }
      }

      return null;
    }
  };

  /* ==========================================================================
     6. Markdown 渲染引擎
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
     7. 交互提示 & 灯箱大图预览 (Toast & Lightbox)
     ========================================================================== */
  var toastTimer = null;
  function toast(msg, type) {
    el.toast.textContent = msg;
    el.toast.className = (type === 'error' ? 'error' : 'info');
    el.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.display = 'none'; }, 3500);
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
     8. 统一附件管理与文件添加 (Attachments Management)
     ========================================================================== */
  function renderAttachments() {
    el.attachmentsTray.innerHTML = '';
    if (!state.pendingAttachments.length) return;

    state.pendingAttachments.forEach(function (att, idx) {
      var card;
      if (att.type === 'image') {
        card = document.createElement('div');
        card.className = 'attachment-card';
        var pic = document.createElement('img');
        pic.src = att.dataUrl;
        pic.alt = att.name;
        pic.title = att.name + ' (' + formatSize(att.size) + ')';
        pic.addEventListener('click', function () { openLightbox(att.dataUrl); });
        card.appendChild(pic);
      } else {
        card = document.createElement('div');
        card.className = 'attachment-file-card';
        var badge = document.createElement('div');
        badge.className = 'file-icon-badge';
        badge.textContent = (att.ext || 'FILE').slice(0, 4).toUpperCase();

        var metaCol = document.createElement('div');
        metaCol.className = 'file-meta-col';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'file-name-text';
        nameSpan.textContent = att.name;
        nameSpan.title = att.name;

        var sizeSpan = document.createElement('span');
        sizeSpan.className = 'file-size-text';
        sizeSpan.textContent = formatSize(att.size) + (att.lines ? ' · ' + att.lines + '行' : '');

        metaCol.appendChild(nameSpan);
        metaCol.appendChild(sizeSpan);
        card.appendChild(badge);
        card.appendChild(metaCol);
      }

      var del = document.createElement('button');
      del.className = 'attachment-del';
      del.textContent = '×';
      del.title = '移除此附件';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.pendingAttachments.splice(idx, 1);
        renderAttachments();
        syncSend();
      });

      card.appendChild(del);
      el.attachmentsTray.appendChild(card);
    });
  }

  function handleIncomingFiles(fileList) {
    if (!fileList || !fileList.length) return;
    var files = Array.prototype.slice.call(fileList);

    if (state.pendingAttachments.length + files.length > 8) {
      toast('单次提问最多附加 8 个附件', 'info');
      files = files.slice(0, 8 - state.pendingAttachments.length);
    }

    var m = state.modelMeta[state.model];
    var canVision = hasVision(m);

    var promises = files.map(function (file) {
      if (FileTextExtractor.isImageFile(file)) {
        if (m && !canVision) {
          toast('当前模型不支持图片，已忽略图片 "' + file.name + '"（代码/文本文件可正常分析）', 'info');
          return Promise.resolve();
        }
        return ImageProcessor.processFile(file).then(function (imgObj) {
          state.pendingAttachments.push(imgObj);
        }).catch(function (err) {
          toast('处理图片 "' + file.name + '" 失败: ' + err.message, 'error');
        });
      } else {
        return FileTextExtractor.processFile(file).then(function (fileObj) {
          state.pendingAttachments.push(fileObj);
        }).catch(function (err) {
          toast('读取文件 "' + file.name + '" 失败: ' + err.message, 'error');
        });
      }
    });

    Promise.all(promises).then(function () {
      renderAttachments();
      syncSend();
      el.input.focus();
    });
  }

  el.attachBtn.addEventListener('click', function () {
    el.fileInput.click();
  });

  el.fileInput.addEventListener('change', function () {
    handleIncomingFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  function syncWebSearchBtn() {
    if (state.webSearch) {
      el.webSearchBtn.classList.add('active');
      el.webSearchBtn.title = '联网搜索：已开启（实时全网检索增强，点击关闭）';
    } else {
      el.webSearchBtn.classList.remove('active');
      el.webSearchBtn.title = '联网搜索：已关闭（点击开启实时全网检索）';
    }
  }

  el.webSearchBtn.addEventListener('click', function () {
    state.webSearch = !state.webSearch;
    localStorage.setItem(LS.webSearch, state.webSearch ? '1' : '0');
    syncWebSearchBtn();
    toast('联网搜索已' + (state.webSearch ? '开启' : '关闭'), 'info');
  });

  // 剪贴板粘贴图片与代码文件
  window.addEventListener('paste', function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;
    var items = e.clipboardData.items;
    var pastedFiles = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        var blob = items[i].getAsFile();
        if (blob) pastedFiles.push(blob);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleIncomingFiles(pastedFiles);
    }
  });

  // 拖拽上传
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
      handleIncomingFiles(e.dataTransfer.files);
    }
  });

  /* ==========================================================================
     9. 会话模型与 IndexedDB 联动 (Conversation Lifecycle)
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
      toast('读取 IndexedDB 会话失败: ' + err.message, 'error');
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

      var isEditing = false;

      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = c.title || '新对话';
      txt.title = '双击可修改标题';

      var actions = document.createElement('span');
      actions.className = 'actions';

      var editBtn = document.createElement('button');
      editBtn.className = 'conv-btn edit';
      editBtn.title = '重命名';
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

      var delBtn = document.createElement('button');
      delBtn.className = 'conv-btn del';
      delBtn.title = '删除对话';
      delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

      function startEdit() {
        if (isEditing || state.busy) return;
        isEditing = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'conv-edit-input';
        input.value = c.title || '';

        function commitEdit() {
          if (!isEditing) return;
          isEditing = false;
          var val = input.value.trim();
          if (val && val !== c.title) {
            c.title = val;
            c.customTitle = true;
            ZenMuxDB.putConversation(c);
          }
          renderConvList();
        }

        function cancelEdit() {
          if (!isEditing) return;
          isEditing = false;
          renderConvList();
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        });
        input.addEventListener('blur', commitEdit);
        input.addEventListener('click', function (e) { e.stopPropagation(); });

        row.innerHTML = '';
        row.appendChild(input);
        setTimeout(function () { input.focus(); input.select(); }, 20);
      }

      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        startEdit();
      });

      txt.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        startEdit();
      });

      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.busy) return;
        var titleToDel = c.title || '此对话';
        if (!window.confirm('确定要删除对话「' + titleToDel + '」吗？此操作不可撤销。')) return;
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
          toast('删除失败: ' + err.message, 'error');
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(txt);
      row.appendChild(actions);

      row.addEventListener('click', function () {
        if (state.busy || state.currentId === c.id || isEditing) return;
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
      empty.innerHTML = '<div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>' +
        '<span>' + (state.model ? '开始一段对话，支持拖拽代码文件、数据表格与图片分析' : '请先在上方选择模型') + '</span>';
      el.threadInner.appendChild(empty);
      return;
    }

    c.messages.forEach(function (m) {
      el.threadInner.appendChild(bubble(m.role, m.content, m.images, m.reasoning, m.files, m.displayContent, m.sources));
    });
    toBottom();
  }

  function bubble(role, content, images, reasoning, files, displayContent, sources) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + role;

    var avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';

    var col = document.createElement('div');
    col.className = 'body';

    // 1. 若附带图片，渲染图片网格
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
      col.appendChild(grid);
    }

    // 2. 若附带源码/文档附件，渲染可折叠卡片
    if (files && files.length) {
      var fileBox = document.createElement('div');
      fileBox.className = 'msg-files';
      files.forEach(function (f) {
        var card = document.createElement('details');
        card.className = 'msg-file-card';

        var summary = document.createElement('summary');
        summary.innerHTML = '📄 <strong>' + esc(f.name) + '</strong> <span style="font-size:11px;color:var(--fg-dim);margin-left:auto">' +
          formatSize(f.size) + (f.lines ? ' · ' + f.lines + '行' : '') + '</span>';

        var pre = document.createElement('pre');
        var code = document.createElement('code');
        code.textContent = f.text || '';
        pre.appendChild(code);

        card.appendChild(summary);
        card.appendChild(pre);
        fileBox.appendChild(card);
      });
      col.appendChild(fileBox);
    }

    // 3. 若附带联网检索来源，渲染参考来源卡片
    if (sources && sources.length) {
      var srcBox = document.createElement('details');
      srcBox.className = 'msg-sources';
      var srcSummary = document.createElement('summary');
      srcSummary.innerHTML = '🌐 <strong>参考来源</strong> (' + sources.length + ' 个网页)';

      var list = document.createElement('div');
      list.className = 'sources-list';
      sources.forEach(function (s, idx) {
        var link = document.createElement('a');
        link.className = 'source-item';
        link.href = s.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        var idxSpan = document.createElement('span');
        idxSpan.className = 'source-index';
        idxSpan.textContent = '[' + (idx + 1) + ']';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'source-title';
        titleSpan.textContent = s.title || s.url;
        titleSpan.title = s.title;

        var domSpan = document.createElement('span');
        domSpan.className = 'source-domain';
        domSpan.textContent = getHostname(s.url);

        link.appendChild(idxSpan);
        link.appendChild(titleSpan);
        link.appendChild(domSpan);
        list.appendChild(link);
      });

      srcBox.appendChild(srcSummary);
      srcBox.appendChild(list);
      col.appendChild(srcBox);
    }

    // 4. 正文
    var textNode = document.createElement('div');
    textNode.className = 'msg-text';
    if (role === 'user') {
      textNode.textContent = displayContent || content || '';
    } else {
      textNode.innerHTML = renderParts(reasoning, content);
    }
    col.appendChild(textNode);

    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  function appendBubble(role) {
    var wrap = bubble(role, '', null, '', null, '', null);
    el.threadInner.appendChild(wrap);
    return wrap.querySelector('.msg-text');
  }

  /* ==========================================================================
     10. 模型列表与能力检测 (Models & Capabilities)
     ========================================================================== */
  function hasVision(m) {
    if (!m) return false;
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
        toast('模型列表拉取失败：' + e.message + '（可手动输入/选择）', 'error');
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
    if (status === 400) return '请求被上游拒绝：' + (upMsg || '参数格式不被该模型支持');
    if (status === 502) return '边缘节点连接 ZenMux 失败，稍后重试。';
    if (status === 500 && /ZENMUX_API_KEY/.test(raw)) {
      return '服务端未配置 ZENMUX_API_KEY，请到 EdgeOne 控制台补上环境变量并重新部署。';
    }
    return upMsg || outer.error || raw.slice(0, 300) || ('HTTP ' + status);
  }

  /* ==========================================================================
     11. 消息发送与多模态/文件上下文流式响应 (Message Dispatch & Streaming)
     ========================================================================== */
  function syncSend() {
    var hasContent = !!el.input.value.trim() || state.pendingAttachments.length > 0;
    el.send.disabled = state.busy || !hasContent || !state.model;
  }

  function send() {
    var text = el.input.value.trim();
    var atts = state.pendingAttachments.slice();
    if ((!text && !atts.length) || state.busy) return;
    if (!state.model) { toast('请先选择模型', 'info'); el.model.focus(); return; }

    var images = atts.filter(function (a) { return a.type === 'image'; });
    var files = atts.filter(function (a) { return a.type === 'file'; });

    var meta = state.modelMeta[state.model];
    if (images.length && meta && !hasVision(meta)) {
      toast('当前模型不支持图片输入，请切换至支持视觉的模型', 'info');
      return;
    }

    var c = state.currentConv;
    if (!c) return;

    var first = c.messages.length === 0;

    // 清空暂存输入框与托盘
    el.input.value = '';
    state.pendingAttachments = [];
    renderAttachments();
    autoGrow();
    syncSend();

    var emptyNode = el.threadInner.querySelector('.empty');
    if (emptyNode) {
      emptyNode.parentNode.removeChild(emptyNode);
    }

    // 初步构建 Prompt
    var fullPrompt = text;
    if (files.length) {
      var fileContextBlocks = files.map(function (f) {
        var lang = f.ext || 'text';
        return '--- 附件文件: ' + f.name + ' (' + formatSize(f.size) + (f.lines ? ', ' + f.lines + '行' : '') + ') ---\n' +
          '```' + lang + '\n' +
          f.text + '\n' +
          '```\n' +
          '--- 附件结束 ---';
      }).join('\n\n');

      fullPrompt = fileContextBlocks + (text ? '\n\n' + text : '\n\n请分析以上文件内容。');
    }

    // 阶段 1: 初次发言智能初拟标题
    if (first && !c.customTitle) {
      c.title = TitleExtractor.cleanUserPrompt(text, files, images);
      c.autoTitled = true;
    }

    // 挂载用户气泡
    el.threadInner.appendChild(bubble('user', fullPrompt, images, '', files, text, null));

    var body = appendBubble('assistant');
    toBottom();

    state.busy = true;
    el.send.style.display = 'none';
    el.stop.style.display = 'flex';
    state.controller = new AbortController();

    // 异步执行实时联网检索（若开启）
    var searchPromise = Promise.resolve(null);
    if (state.webSearch && text) {
      body.innerHTML = '<div class="search-status"><span class="attachment-spinner"></span> 正在检索实时网络事实…</div>';
      var searchCount = getSearchCountByDepth(state.searchDepth);
      searchPromise = WebSearchService.search(text, state.token, searchCount).catch(function (err) {
        if (err && /ANYSEARCH_API_KEY/.test(err.message)) {
          toast('服务端未配置联网搜索密钥（将以常规方式回答，可在控制台配置）', 'info');
        } else {
          toast('联网检索提示: ' + (err.message || '未获取到有效搜索结果'), 'info');
        }
        return null;
      });
    }

    searchPromise.then(function (searchResults) {
      var finalPrompt = fullPrompt;
      var activeSources = (searchResults && searchResults.length) ? searchResults : null;

      if (activeSources) {
        var groundingBlock = WebSearchService.formatGroundingPrompt(text, activeSources);
        finalPrompt = groundingBlock + '\n\n' + finalPrompt;
      }

      var userMsg = {
        id: uid(),
        role: 'user',
        content: finalPrompt,
        displayContent: text,
        images: images.length ? images : undefined,
        files: files.length ? files : undefined,
        createdAt: Date.now()
      };
      c.messages.push(userMsg);
      c.updatedAt = Date.now();

      ZenMuxDB.putConversation(c).then(function () {
        renderConvList();
      });

      // 格式化上下文历史为 OpenAI Multimodal 规范
      var hist = c.messages.filter(function (m) { return m.content || (m.images && m.images.length); });
      var sliced = (state.ctxN > 0 ? hist.slice(-state.ctxN) : hist);

      var history = sliced.map(function (m) {
        if (m.role === 'user' && m.images && m.images.length) {
          var parts = [];
          if (m.content && m.content.trim()) {
            parts.push({ type: 'text', text: m.content });
          } else {
            parts.push({ type: 'text', text: '请分析上述内容' });
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

      var acc = '';
      var reasonAcc = '';
      var stick = true;

      return fetch('/api/chat', {
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

          // 如果存在搜索来源，挂载参考来源折叠组件
          if (activeSources && body.parentNode) {
            var srcBox = document.createElement('details');
            srcBox.className = 'msg-sources';
            var srcSummary = document.createElement('summary');
            srcSummary.innerHTML = '🌐 <strong>参考来源</strong> (' + activeSources.length + ' 个网页)';

            var list = document.createElement('div');
            list.className = 'sources-list';
            activeSources.forEach(function (s, idx) {
              var link = document.createElement('a');
              link.className = 'source-item';
              link.href = s.url;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';

              var idxSpan = document.createElement('span');
              idxSpan.className = 'source-index';
              idxSpan.textContent = '[' + (idx + 1) + ']';

              var titleSpan = document.createElement('span');
              titleSpan.className = 'source-title';
              titleSpan.textContent = s.title || s.url;
              titleSpan.title = s.title;

              var domSpan = document.createElement('span');
              domSpan.className = 'source-domain';
              domSpan.textContent = getHostname(s.url);

              link.appendChild(idxSpan);
              link.appendChild(titleSpan);
              link.appendChild(domSpan);
              list.appendChild(link);
            });

            srcBox.appendChild(srcSummary);
            srcBox.appendChild(list);
            body.parentNode.insertBefore(srcBox, body);
          }

          body.innerHTML = '<span class="caret"></span>';

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
              sources: activeSources || undefined,
              createdAt: Date.now()
            };
            c.messages.push(asstMsg);
            c.updatedAt = Date.now();

            // 阶段 2: 智能嗅探 AI 回复中的标题进行润色
            if (c.autoTitled && !c.customTitle && c.messages.length === 2) {
              var refined = TitleExtractor.sniffAssistantTitle(acc);
              if (refined && refined !== c.title) {
                c.title = refined;
              }
            }

            ZenMuxDB.putConversation(c).then(function () {
              renderConvList();
            });
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
                sources: activeSources || undefined,
                createdAt: Date.now()
              });
              c.updatedAt = Date.now();
              ZenMuxDB.putConversation(c);
            }
            body.innerHTML = renderParts(reasonAcc, acc);
            return;
          }
          toast(e.message || String(e), 'error');
          if (!acc && !reasonAcc && body && body.parentNode && body.parentNode.parentNode) {
            body.parentNode.parentNode.removeChild(body.parentNode);
          }
        });
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
     12. 门禁验证 (Access Gate)
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
     13. 界面事件监听与初始化 (UI & Startup)
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

  el.searchDepth.addEventListener('change', function () {
    state.searchDepth = el.searchDepth.value;
    localStorage.setItem(LS.searchDepth, state.searchDepth);
    var label = el.searchDepth.options[el.searchDepth.selectedIndex].text;
    toast('已切换为：' + label, 'info');
  });

  el.ctx.addEventListener('change', function () {
    state.ctxN = parseInt(el.ctx.value, 10) || 0;
    localStorage.setItem(LS.ctx, String(state.ctxN));
    var label = el.ctx.options[el.ctx.selectedIndex].text;
    toast('已切换为：' + label, 'info');
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
  el.searchDepth.value = state.searchDepth;
  el.ctx.value = String(state.ctxN);
  syncModelCapabilities();
  syncWebSearchBtn();
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
