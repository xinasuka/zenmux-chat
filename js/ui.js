// js/ui.js
// DOM component constructors: message bubbles, actions toolbar, web sources card, lightbox, toasts, and title sniffer.

import { el, state, esc, formatSize, getHostname, calculateSessionTokens } from './state.js';
import { renderMd, renderParts } from './markdown.js';
import { createAudioPlayerDrawer, stopGlobalAudio } from './tts.js';

let toastTimer = null;
export function toast(msg, type) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.className = (type === 'error' ? 'error' : 'info');
  el.toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el.toast) el.toast.style.display = 'none';
  }, 4000);
}

export function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('已复制到剪贴板', 'info');
  } catch (e) {
    toast('复制失败，请手动长按复制', 'error');
  }
  document.body.removeChild(ta);
}

export function openLightbox(src) {
  if (!src || !el.lightbox || !el.lightboxImg) return;
  el.lightboxImg.src = src;
  el.lightbox.classList.remove('hide');
}

export function closeLightbox() {
  if (!el.lightbox || !el.lightboxImg) return;
  el.lightbox.classList.add('hide');
  el.lightboxImg.src = '';
}

export const TitleExtractor = {
  cleanUserPrompt(text, files, images) {
    if (files && files.length) {
      return (files[0].name + (files.length > 1 ? ` 等${files.length}个文件` : '')).slice(0, 24);
    }
    const raw = (text || '').trim();
    if (!raw) return '新对话';

    let cleaned = raw.replace(/^(?:(?:请问|请帮我|麻烦帮我|我想了解|帮我写一个|帮我写|帮我做|帮我分析|请分析|请解释|请教|你好|您好|hi|hello|如何|怎么|怎样|如何实现|怎么写|能否|可以帮我|想问下|我想问)[\s，,：:、]*)+/i, '').trim();
    cleaned = cleaned.replace(/^[？?！!，,。.\s]+/, '').trim();

    let result = cleaned || raw;
    if (images && images.length && (!text || !text.trim())) {
      result = '[图片] ' + result;
    }
    return result.slice(0, 24);
  },

  sniffAssistantTitle(content) {
    if (!content || typeof content !== 'string') return null;
    const text = content.trim();

    const headMatch = text.match(/(?:^|\n)#{1,3}\s+([^\n#`]{3,30})/);
    if (headMatch && headMatch[1]) {
      const h = headMatch[1].trim()
        .replace(/^[\d+.\s、]+/, '')
        .replace(/[：:。!！?？]+$/, '')
        .trim();
      if (h.length >= 2 && h.length <= 26 && !/^(引言|简介|概述|分析|总结|解答|步骤|方案|说明)$/.test(h)) {
        return h;
      }
    }

    const boldMatch = text.match(/(?:^|\n)\*\*([^*\n]{3,24})\*\*/);
    if (boldMatch && boldMatch[1]) {
      const b = boldMatch[1].trim()
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

export function updateSidebarFooter() {
  if (!el.sidebarFooterText) return;
  const total = calculateSessionTokens(state.currentConv);
  if (total > 0) {
    el.sidebarFooterText.textContent = `会话仅存于本机 · 消耗 ${total.toLocaleString()} Tokens`;
  } else {
    el.sidebarFooterText.textContent = '会话仅存于本机浏览器';
  }
}

export function createSourcesElement(sources) {
  if (!sources || !sources.length) return null;
  const srcBox = document.createElement('details');
  srcBox.className = 'msg-sources';
  const srcSummary = document.createElement('summary');
  srcSummary.innerHTML = `<span class="source-icon">✦</span> <strong>参考来源</strong> (${sources.length} 个网页)`;

  const list = document.createElement('div');
  list.className = 'sources-list';
  sources.forEach((s, idx) => {
    const link = document.createElement('a');
    link.className = 'source-item';
    link.href = s.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const idxSpan = document.createElement('span');
    idxSpan.className = 'source-index';
    idxSpan.textContent = `[${idx + 1}]`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'source-title';
    titleSpan.textContent = s.title || s.url;
    titleSpan.title = s.title;

    const domSpan = document.createElement('span');
    domSpan.className = 'source-domain';
    domSpan.textContent = getHostname(s.url);

    link.appendChild(idxSpan);
    link.appendChild(titleSpan);
    link.appendChild(domSpan);
    list.appendChild(link);
  });

  srcBox.appendChild(srcSummary);
  srcBox.appendChild(list);
  return srcBox;
}

export function createActionsToolbar(msg, msgIndex, onRegenerate) {
  const container = document.createElement('div');
  container.className = 'msg-actions-container';

  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  // 1. 复制按钮
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn copy';
  copyBtn.title = '复制回复内容';
  copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> 复制';
  copyBtn.addEventListener('click', () => {
    const textToCopy = msg.content || '';
    if (!textToCopy) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        toast('已复制到剪贴板', 'info');
      }).catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  });
  bar.appendChild(copyBtn);

  // 2. 重新生成按钮
  const regenBtn = document.createElement('button');
  regenBtn.className = 'msg-action-btn regen';
  regenBtn.title = '使用当前模型重新生成回答';
  regenBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> 重新生成';
  regenBtn.addEventListener('click', () => {
    if (state.busy) {
      toast('AI 正在回答中，请稍候…', 'info');
      return;
    }
    if (typeof onRegenerate === 'function') {
      onRegenerate(msgIndex);
    }
  });
  bar.appendChild(regenBtn);

  // 3. Token 消耗详情展开按钮
  if (msg.usage && msg.usage.total_tokens) {
    const u = msg.usage;
    const infoBtn = document.createElement('button');
    infoBtn.className = 'msg-action-btn info-btn';
    infoBtn.title = '展开/折叠 Token 消耗与模型详情';
    infoBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> ${u.total_tokens.toLocaleString()} Tokens`;

    const usageCard = document.createElement('div');
    usageCard.className = 'msg-usage-card hide';

    infoBtn.addEventListener('click', () => {
      const isHidden = usageCard.classList.contains('hide');
      if (isHidden) {
        const sessTotal = calculateSessionTokens(state.currentConv);
        const modelName = msg.model || state.model || '大模型';
        const promptT = (u.prompt_tokens || 0).toLocaleString();
        const compT = (u.completion_tokens || 0).toLocaleString();
        const totalT = (u.total_tokens || 0).toLocaleString();
        const sessT = sessTotal.toLocaleString();

        usageCard.innerHTML = `
          <div class="usage-grid">
            <div class="usage-item"><span class="usage-lbl">输入</span><span class="usage-val">${promptT}</span></div>
            <div class="usage-item"><span class="usage-lbl">输出</span><span class="usage-val">${compT}</span></div>
            <div class="usage-item highlight"><span class="usage-lbl">本轮总计</span><span class="usage-val">${totalT}</span></div>
            <div class="usage-item"><span class="usage-lbl">会话累计</span><span class="usage-val">${sessT}</span></div>
          </div>
          <div class="usage-model-tag">响应模型: ${esc(modelName)}</div>
        `;
        usageCard.classList.remove('hide');
        infoBtn.classList.add('active');
      } else {
        usageCard.classList.add('hide');
        infoBtn.classList.remove('active');
      }
    });

    bar.appendChild(infoBtn);
    container.appendChild(usageCard);
  }

  // 4. 语音朗读按钮
  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'msg-action-btn tts-btn';
  ttsBtn.title = '展开语音朗读播放器';
  ttsBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg> 朗读';

  let activePlayerDrawer = null;
  ttsBtn.addEventListener('click', () => {
    if (activePlayerDrawer && container.contains(activePlayerDrawer)) {
      stopGlobalAudio();
      container.removeChild(activePlayerDrawer);
      activePlayerDrawer = null;
      ttsBtn.classList.remove('active');
    } else {
      activePlayerDrawer = createAudioPlayerDrawer(msg, () => {
        ttsBtn.classList.remove('active');
        activePlayerDrawer = null;
      }, toast);
      container.appendChild(activePlayerDrawer);
      ttsBtn.classList.add('active');
    }
  });

  bar.appendChild(ttsBtn);
  container.appendChild(bar);
  return container;
}

export function createImageCard(item, onRegenerate) {
  const card = document.createElement('div');
  card.className = 'img-card-wrap';

  const preview = document.createElement('div');
  preview.className = 'img-card-preview';

  if (item.loading) {
    preview.innerHTML = `
      <div class="img-card-skeleton">
        <div class="img-card-skeleton-spinner"></div>
        <div class="img-card-skeleton-text">正在调度生图引擎渲染画面…</div>
      </div>
    `;
  } else if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.prompt || 'AI 生成图片';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(item.src));
    preview.appendChild(img);
  }

  card.appendChild(preview);

  if (item.revisedPrompt && item.revisedPrompt !== item.prompt) {
    const rev = document.createElement('div');
    rev.className = 'img-card-revised';
    rev.innerHTML = `<strong>精修提示词:</strong> ${esc(item.revisedPrompt)}`;
    card.appendChild(rev);
  }

  if (!item.loading && item.src) {
    const footer = document.createElement('div');
    footer.className = 'img-card-footer';

    const meta = document.createElement('div');
    meta.className = 'img-card-meta';
    meta.textContent = `${item.size || '1024x1024'} · ${item.model ? item.model.split('/').pop() : '生图'}`;
    footer.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'img-card-actions';

    // 1. 下载按钮 (优先利用本地二进制 Blob，若为远程链接则借助边缘代理下载以防浏览器跨域拦截)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'img-card-btn';
    dlBtn.title = '下载高清图片 (PNG)';
    dlBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> 下载';
    dlBtn.addEventListener('click', async () => {
      try {
        let downloadUrl = item.src;
        let objectUrlToRevoke = null;
        if (item.blob) {
          downloadUrl = URL.createObjectURL(item.blob);
          objectUrlToRevoke = downloadUrl;
        } else if (item.src && item.src.startsWith('http')) {
          try {
            const tokenHeader = (state && state.token) ? { 'X-Access-Token': state.token } : {};
            const res = await fetch(`/api/image-stream?url=${encodeURIComponent(item.src)}`, { headers: tokenHeader });
            if (res.ok) {
              const b = await res.blob();
              item.blob = b;
              downloadUrl = URL.createObjectURL(b);
              objectUrlToRevoke = downloadUrl;
            }
          } catch (_) {}
        }
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `zenmux-${Date.now()}.png`;
        a.click();
        if (objectUrlToRevoke) {
          setTimeout(() => URL.revokeObjectURL(objectUrlToRevoke), 10000);
        }
      } catch (e) {
        window.open(item.src, '_blank');
      }
    });
    actions.appendChild(dlBtn);

    // 2. 复制图片到剪贴板
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined' && window.ClipboardItem && item.blob) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'img-card-btn';
      copyBtn.title = '复制图片到剪贴板';
      copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> 复制';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [item.blob.type || 'image/png']: item.blob })
          ]);
          toast('图片已复制到剪贴板', 'info');
        } catch (e) {
          toast('复制失败，可直接点击下载', 'error');
        }
      });
      actions.appendChild(copyBtn);
    }

    footer.appendChild(actions);
    card.appendChild(footer);
  }

  return card;
}

export function bubble(role, content, images, reasoning, files, displayContent, sources, usage, model, msgIndex, onRegenerate, imageMeta) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '我' : 'AI';

  const col = document.createElement('div');
  col.className = 'body';

  // 1. 若为图像生成消息 (imageMeta 存在)
  if (role === 'assistant' && imageMeta) {
    const cardWrap = document.createElement('div');
    cardWrap.className = 'img-card-container';
    cardWrap.innerHTML = `
      <div class="img-card-wrap">
        <div class="img-card-preview">
          <div class="img-card-skeleton">
            <div class="img-card-skeleton-spinner"></div>
            <div class="img-card-skeleton-text">正在读取本地图像…</div>
          </div>
        </div>
      </div>
    `;
    col.appendChild(cardWrap);

    if (imageMeta.imageId || imageMeta.url) {
      import('./db.js').then(({ ZenMuxDB }) => {
        const fetchRecord = imageMeta.imageId ? ZenMuxDB.getImage(imageMeta.imageId) : Promise.resolve(null);
        fetchRecord.then((rec) => {
          if (rec && rec.blob) {
            const src = URL.createObjectURL(rec.blob);
            const card = createImageCard({
              src,
              blob: rec.blob,
              prompt: rec.prompt || content,
              revisedPrompt: rec.revisedPrompt || imageMeta.revisedPrompt,
              model: rec.model || model,
              size: rec.size || imageMeta.size,
              quality: rec.quality || imageMeta.quality
            }, onRegenerate);
            cardWrap.replaceWith(card);
          } else if (imageMeta.url || (rec && rec.url)) {
            const fallbackSrc = imageMeta.url || (rec && rec.url);
            const card = createImageCard({
              src: fallbackSrc,
              prompt: (rec && rec.prompt) || content,
              revisedPrompt: (rec && rec.revisedPrompt) || imageMeta.revisedPrompt,
              model: (rec && rec.model) || model,
              size: (rec && rec.size) || imageMeta.size,
              quality: (rec && rec.quality) || imageMeta.quality
            }, onRegenerate);
            cardWrap.replaceWith(card);

            // Self-healing: if historical record has remote URL but missing blob, cache via image-stream
            if (imageMeta.imageId && fallbackSrc && fallbackSrc.startsWith('http')) {
              const tokenHeader = (state && state.token) ? { 'X-Access-Token': state.token } : {};
              fetch(`/api/image-stream?url=${encodeURIComponent(fallbackSrc)}`, { headers: tokenHeader })
                .then((r) => (r.ok ? r.blob() : null))
                .catch(() => fetch(fallbackSrc).then((r) => (r.ok ? r.blob() : null)).catch(() => null))
                .then((fetchedBlob) => {
                  if (fetchedBlob) {
                    ZenMuxDB.putImage(imageMeta.imageId, fetchedBlob, {
                      prompt: (rec && rec.prompt) || content,
                      revisedPrompt: (rec && rec.revisedPrompt) || imageMeta.revisedPrompt,
                      model: (rec && rec.model) || model,
                      size: (rec && rec.size) || imageMeta.size,
                      quality: (rec && rec.quality) || imageMeta.quality,
                      url: fallbackSrc,
                      createdAt: (rec && rec.createdAt) || Date.now()
                    }).catch(() => {});
                  }
                })
                .catch(() => {});
            }
          } else {
            const promptText = (rec && rec.prompt) || content || '';
            const modelText = (rec && rec.model) || (imageMeta && imageMeta.model) || model || '';
            const sizeText = (rec && rec.size) || (imageMeta && imageMeta.size) || '';

            cardWrap.innerHTML = `
              <div class="img-card-wrap" style="padding:14px 16px;border:1px dashed var(--line);background:rgba(255,255,255,.015);box-shadow:none">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px">
                  <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--fg-dim)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    <span>图片数据已失效</span>
                  </div>
                  ${modelText ? `<div style="font-size:11px;color:var(--fg-dim);opacity:.7">${esc(modelText.split('/').pop())}${sizeText ? ' · ' + esc(sizeText) : ''}</div>` : ''}
                </div>
                <div style="font-size:12px;color:var(--fg-dim);line-height:1.6;margin-bottom:12px">
                  <div>· 本地未保留二进制图像（IndexedDB 离线缓存已清理或未写入）</div>
                  <div>· 远程图床链接已过期或未提供</div>
                </div>
                ${promptText ? `
                <div style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid var(--line);gap:8px">
                  <div style="font-size:11.5px;color:var(--fg-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px" title="${esc(promptText)}">${esc(promptText)}</div>
                  <button class="img-card-btn copy-prompt-btn" style="white-space:nowrap">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    复制提示词
                  </button>
                </div>` : ''}
              </div>
            `;

            const copyBtn = cardWrap.querySelector('.copy-prompt-btn');
            if (copyBtn && promptText) {
              copyBtn.addEventListener('click', async () => {
                try {
                  await navigator.clipboard.writeText(promptText);
                  toast('提示词已复制到剪贴板', 'success');
                } catch (_) {
                  toast('复制失败，请手动选取', 'error');
                }
              });
            }
          }
        }).catch(() => {
          if (imageMeta.url) {
            const card = createImageCard({
              src: imageMeta.url,
              prompt: content,
              revisedPrompt: imageMeta.revisedPrompt,
              model: model,
              size: imageMeta.size,
              quality: imageMeta.quality
            }, onRegenerate);
            cardWrap.replaceWith(card);
          } else {
            cardWrap.innerHTML = '<div class="msg-text" style="color:var(--danger);font-size:12px;padding:8px">读取本地图片异常</div>';
          }
        });
      });
    }

    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  // 2. 若附带图片，渲染图片网格
  if (images && images.length) {
    const grid = document.createElement('div');
    grid.className = 'msg-images';
    images.forEach((img) => {
      const thumb = document.createElement('div');
      thumb.className = 'msg-img-thumb';
      const imgTag = document.createElement('img');
      imgTag.src = img.dataUrl;
      imgTag.alt = img.name || '图片';
      imgTag.loading = 'lazy';
      thumb.addEventListener('click', () => openLightbox(img.dataUrl));
      thumb.appendChild(imgTag);
      grid.appendChild(thumb);
    });
    col.appendChild(grid);
  }

  // 3. 若附带源码/文档附件，渲染可折叠卡片
  if (files && files.length) {
    const fileBox = document.createElement('div');
    fileBox.className = 'msg-files';
    files.forEach((f) => {
      const card = document.createElement('details');
      card.className = 'msg-file-card';
      const summary = document.createElement('summary');
      summary.innerHTML = `<strong>${esc(f.name)}</strong> <span style="font-size:11px;color:var(--fg-dim);margin-left:auto">${formatSize(f.size)}${f.lines ? ` · ${f.lines}行` : ''}</span>`;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = f.text || '';
      pre.appendChild(code);
      card.appendChild(summary);
      card.appendChild(pre);
      fileBox.appendChild(card);
    });
    col.appendChild(fileBox);
  }

  // 4. AI Assistant 结构: 思考过程 (Reasoning) -> 参考来源 (Sources) -> 正文 (Text) -> 工具栏 (Toolbar)
  if (role === 'assistant') {
    // (a) 思考过程 (Thinking Process)
    if (reasoning && reasoning.trim()) {
      const rDetails = document.createElement('details');
      rDetails.className = 'reasoning';
      rDetails.open = true;
      rDetails.innerHTML = `<summary><span class="reasoning-sparkle">✦</span> <span>思考过程</span></summary><div class="reasoning-body">${renderMd(reasoning)}</div>`;
      col.appendChild(rDetails);
    }

    // (b) 参考来源 (Reference Sources Drawer)
    if (sources && sources.length) {
      const srcElement = createSourcesElement(sources);
      if (srcElement) col.appendChild(srcElement);
    }

    // (c) 正文回复 (Markdown Text)
    if (content || !reasoning) {
      const textNode = document.createElement('div');
      textNode.className = 'msg-text';
      textNode.innerHTML = renderMd(content || '');
      col.appendChild(textNode);
    }

    // (d) 操作工具栏（仅对已生成完毕的 Assistant 消息）
    if (content || reasoning) {
      const actionsBar = createActionsToolbar({ content, usage, model }, msgIndex, onRegenerate);
      col.appendChild(actionsBar);
    }
  } else {
    // 5. 用户消息正文
    const textNode = document.createElement('div');
    textNode.className = 'msg-text';
    textNode.textContent = displayContent || content || '';
    col.appendChild(textNode);
  }

  wrap.appendChild(avatar);
  wrap.appendChild(col);
  return wrap;
}

export function appendBubble(role, sources) {
  const wrap = bubble(role, '', null, '', null, '', sources, null, null, null, null);
  if (el.threadInner) el.threadInner.appendChild(wrap);
  return wrap.querySelector('.body');
}

/* ---------- Custom Parameter Pickers (Visual Parity with Model Picker) ---------- */

export function closeAllParamPickers() {
  document.querySelectorAll('.param-picker-wrap.open').forEach((w) => {
    w.classList.remove('open');
    const b = w.querySelector('.param-picker-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
}

export function syncParamPicker(selectEl) {
  if (selectEl && typeof selectEl._syncParamPicker === 'function') {
    selectEl._syncParamPicker();
  }
}

export function initParamPickers() {
  const selects = [
    el.effort,
    el.searchDepth,
    el.toolTurns,
    el.ctx,
    el.imageSize,
    el.imageQuality,
    el.imageBackground
  ].filter(Boolean);

  selects.forEach((sel) => {
    if (sel.dataset.hasParamPicker) return;
    sel.dataset.hasParamPicker = 'true';

    // Visually conceal native select while maintaining complete accessibility and form value state
    sel.classList.add('param-select-hidden');

    const wrap = document.createElement('div');
    wrap.className = 'param-picker-wrap';
    wrap.id = `param-picker-${sel.id}`;

    const btn = document.createElement('button');
    btn.className = 'param-picker-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = sel.title || '';

    const label = document.createElement('span');
    label.className = 'param-picker-label';

    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'param-picker-arrow');
    arrowSvg.setAttribute('width', '11');
    arrowSvg.setAttribute('height', '11');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('fill', 'none');
    arrowSvg.setAttribute('stroke', 'currentColor');
    arrowSvg.setAttribute('stroke-width', '2');
    arrowSvg.setAttribute('stroke-linecap', 'round');
    arrowSvg.setAttribute('stroke-linejoin', 'round');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    arrowSvg.appendChild(polyline);

    btn.appendChild(label);
    btn.appendChild(arrowSvg);

    const panel = document.createElement('div');
    panel.className = 'param-picker-panel';
    panel.setAttribute('role', 'listbox');

    wrap.appendChild(btn);
    wrap.appendChild(panel);

    if (sel.parentNode) {
      sel.parentNode.insertBefore(wrap, sel.nextSibling);
    }

    function syncUI() {
      btn.disabled = !!sel.disabled;
      btn.title = sel.title || '';
      const activeOpt = Array.from(sel.options).find((o) => o.value === sel.value) || sel.options[0];
      label.textContent = activeOpt ? activeOpt.textContent : '';

      panel.querySelectorAll('.param-picker-item').forEach((item) => {
        const isMatch = item.getAttribute('data-value') === sel.value;
        item.classList.toggle('active', isMatch);
        item.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    function renderOptions() {
      panel.innerHTML = '';
      Array.from(sel.options).forEach((opt) => {
        const item = document.createElement('div');
        item.className = 'param-picker-item';
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', opt.value);
        item.setAttribute('tabindex', '0');

        const text = document.createElement('span');
        text.className = 'param-item-text';
        text.textContent = opt.textContent;

        const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        checkSvg.setAttribute('class', 'param-item-check');
        checkSvg.setAttribute('width', '12');
        checkSvg.setAttribute('height', '12');
        checkSvg.setAttribute('viewBox', '0 0 24 24');
        checkSvg.setAttribute('fill', 'none');
        checkSvg.setAttribute('stroke', 'currentColor');
        checkSvg.setAttribute('stroke-width', '2.5');
        checkSvg.setAttribute('stroke-linecap', 'round');
        checkSvg.setAttribute('stroke-linejoin', 'round');
        const checkPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        checkPoly.setAttribute('points', '20 6 9 17 4 12');
        checkSvg.appendChild(checkPoly);

        item.appendChild(text);
        item.appendChild(checkSvg);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          syncUI();
          wrap.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        });

        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });

        panel.appendChild(item);
      });
      syncUI();
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const isOpen = wrap.classList.contains('open');

      closeAllParamPickers();
      if (el.modelPickerWrap) {
        el.modelPickerWrap.classList.remove('open');
        if (el.modelPickerBtn) el.modelPickerBtn.setAttribute('aria-expanded', 'false');
      }

      if (!isOpen) {
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');

        // Dynamic edge collision detection: align right if panel overflows or element is in right hemisphere on compact screens
        const rect = wrap.getBoundingClientRect();
        if (rect.left + 140 > window.innerWidth || (window.innerWidth <= 768 && rect.left + rect.width / 2 > window.innerWidth / 2)) {
          wrap.classList.add('align-right');
        } else {
          wrap.classList.remove('align-right');
        }
      }
    });

    sel.addEventListener('change', syncUI);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => syncUI());
      observer.observe(sel, { attributes: true, attributeFilter: ['disabled', 'title'] });
    }

    renderOptions();
    sel._syncParamPicker = syncUI;
  });

  // Global dismissal listeners (delegated once)
  if (!document._paramPickerGlobalListeners) {
    document._paramPickerGlobalListeners = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.param-picker-wrap')) {
        closeAllParamPickers();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllParamPickers();
      }
    });
  }
}
