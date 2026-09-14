// js/ui.js
// DOM component constructors: message bubbles, actions toolbar, web sources card, lightbox, toasts, and title sniffer.

import { el, state, esc, formatSize, getHostname, calculateSessionTokens, hasImageGen, isFree, hasReasoning } from './state.js';
import { renderMd, renderParts } from './markdown.js';
import { createAudioPlayerDrawer, stopGlobalAudio } from './tts.js';
import { ZenMuxDB } from './db.js';
import { t } from './i18n.js';

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
    toast(t('common.copied') || '已复制到剪贴板', 'info');
  } catch (e) {
    toast(t('common.copyFailed') || '复制失败，请手动长按复制', 'error');
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

const activeTitleRequests = new Set();

export const TitleExtractor = {
  cleanUserPrompt(text, files, images) {
    if (files && files.length) {
      const moreStr = files.length > 1
        ? (state.lang === 'en' ? ` & ${files.length - 1} more` : ` 等${files.length}个文件`)
        : '';
      return (files[0].name + moreStr).slice(0, 24);
    }
    const raw = (text || '').trim();
    if (!raw) return t('sidebar.newChatTitle') || '新对话';

    let cleaned = raw.replace(/^(?:(?:please tell me|please help me|can you|could you|how to|what is|who is|hi|hello|hey|请问|请帮我|麻烦帮我|我想了解|帮我写一个|帮我写|帮我做|帮我分析|请分析|请解释|请教|你好|您好|如何|怎么|怎样|如何实现|怎么写|能否|可以帮我|想问下|我想问)[\s，,：:、]*)+/i, '').trim();
    cleaned = cleaned.replace(/^[？?！!，,。.\s]+/, '').trim();

    let result = cleaned || raw;
    if (images && images.length && (!text || !text.trim())) {
      result = (state.lang === 'en' ? '[Image] ' : '[图片] ') + result;
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
      if (h.length >= 2 && h.length <= 26 && !/^(引言|简介|概述|分析|总结|解答|步骤|方案|说明|Introduction|Overview|Summary|Analysis|Solution|Steps|Notes?|Warning)$/i.test(h)) {
        return h;
      }
    }

    const boldMatch = text.match(/(?:^|\n)\*\*([^*\n]{3,24})\*\*/);
    if (boldMatch && boldMatch[1]) {
      const b = boldMatch[1].trim()
        .replace(/^[\d+.\s、]+/, '')
        .replace(/[：:。!！?？]+$/, '')
        .trim();
      if (b.length >= 2 && b.length <= 24 && !/^(注意|提示|警告|总结|说明|步骤|方案|Introduction|Overview|Summary|Analysis|Solution|Steps|Notes?|Warning)$/i.test(b)) {
        return b;
      }
    }

    return null;
  },

  findFreeTextModel(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const freeText = list.filter((m) => !hasImageGen(m) && isFree(m));
    if (!freeText.length) return null;

    // 1. Prioritize non-reasoning free models if available
    const nonReasoning = freeText.find((m) => !hasReasoning(m));
    if (nonReasoning) return nonReasoning;

    // 2. Prioritize lightweight conversational flash / glm / tiny / chat models
    const preferred = freeText.find((m) => /flash|glm|tiny|chat|mini/i.test(m.id || m.name || ''));
    if (preferred) return preferred;

    // 3. Fallback: Any free text model
    return freeText[0] || null;
  },

  async generateDynamicTitle({ conversation, promptText, responseText, modelsList, token, onUpdate }) {
    if (!conversation || conversation.customTitle || conversation.titleGenerated) return;
    if (activeTitleRequests.has(conversation.id)) return;

    const applyHeuristicFallback = async () => {
      if (conversation.customTitle || conversation.titleGenerated) return;
      const refined = this.sniffAssistantTitle(responseText);
      if (refined && refined !== conversation.title) {
        conversation.title = refined;
        conversation.titleGenerated = true;
        await ZenMuxDB.putConversation(conversation);
        if (typeof onUpdate === 'function') {
          onUpdate();
        }
      }
    };

    const candidate = this.findFreeTextModel(modelsList || state.rawModelList);
    if (!candidate || !candidate.id) {
      await applyHeuristicFallback();
      return;
    }

    // Extract compact thematic nucleus (max 600 characters each)
    const cleanPrompt = (promptText || '').trim().slice(0, 600);
    const cleanResponse = (responseText || '').trim().slice(0, 600);
    if (!cleanPrompt) return;

    activeTitleRequests.add(conversation.id);

    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-Access-Token'] = token;

      const res = await fetch('/api/title', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: candidate.id,
          prompt: cleanPrompt,
          response: cleanResponse
        }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(16000) : undefined
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        await applyHeuristicFallback();
        return;
      }

      const newTitle = data && data.title && data.title.trim();

      if (newTitle && newTitle.length >= 2) {
        // Race Condition Guard: If user renamed or modified customTitle while in flight, discard
        if (conversation.customTitle) return;

        conversation.title = newTitle;
        conversation.titleGenerated = true;
        await ZenMuxDB.putConversation(conversation);

        if (typeof onUpdate === 'function') {
          onUpdate();
        }
      } else {
        await applyHeuristicFallback();
      }
    } catch (_) {
      await applyHeuristicFallback();
    } finally {
      activeTitleRequests.delete(conversation.id);
    }
  }
};

export function updateSidebarFooter() {
  if (!el.sidebarFooterText) return;
  const total = calculateSessionTokens(state.currentConv);
  if (total > 0) {
    el.sidebarFooterText.textContent = t('sidebar.localTokens', { total: total.toLocaleString() });
  } else {
    el.sidebarFooterText.textContent = t('sidebar.localOnly');
  }
}

export function createSourcesElement(sources) {
  if (!sources || !sources.length) return null;
  const srcBox = document.createElement('details');
  srcBox.className = 'msg-sources';
  const srcSummary = document.createElement('summary');
  const titleText = t('chat.sourcesTitle', { count: sources.length });
  srcSummary.innerHTML = `<span class="source-icon">✦</span> <strong>${titleText}</strong>`;

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
  copyBtn.title = t('chat.copyResponseTooltip');
  copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> ${t('chat.copyResponse')}`;
  copyBtn.addEventListener('click', () => {
    const textToCopy = msg.content || '';
    if (!textToCopy) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        toast(t('common.copied') || '已复制到剪贴板', 'info');
      }).catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  });
  bar.appendChild(copyBtn);

  // 2. 重新生成按钮
  const regenBtn = document.createElement('button');
  regenBtn.className = 'msg-action-btn regen';
  regenBtn.title = t('chat.regenerateTooltip');
  regenBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> ${t('chat.regenerate')}`;
  regenBtn.addEventListener('click', () => {
    if (state.busy) {
      toast(t('chat.busyWaiting') || 'AI 正在回答中，请稍候…', 'info');
      return;
    }
    if (typeof onRegenerate === 'function') {
      onRegenerate(msgIndex);
    }
  });
  bar.appendChild(regenBtn);

  // 3. 分享/保存交互按钮 (紧随重新生成按钮)
  const shareBtn = document.createElement('button');
  shareBtn.className = 'msg-action-btn share-btn';
  shareBtn.title = t('chat.shareTooltip') || '分享或保存此交互';
  shareBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg> ${t('chat.share') || '分享'}`;

  let activeShareDrawer = null;
  shareBtn.addEventListener('click', () => {
    if (activeShareDrawer && container.contains(activeShareDrawer)) {
      if (typeof activeShareDrawer._close === 'function') {
        activeShareDrawer._close();
      } else {
        container.removeChild(activeShareDrawer);
      }
      activeShareDrawer = null;
      shareBtn.classList.remove('active');
    } else {
      if (activePlayerDrawer && container.contains(activePlayerDrawer)) {
        stopGlobalAudio();
        container.removeChild(activePlayerDrawer);
        activePlayerDrawer = null;
        ttsBtn.classList.remove('active');
      }
      import('./share.js').then(({ createShareDrawer }) => {
        if (activeShareDrawer && container.contains(activeShareDrawer)) return;
        activeShareDrawer = createShareDrawer(msg, msgIndex, () => {
          shareBtn.classList.remove('active');
          activeShareDrawer = null;
        });
        if (activeShareDrawer) {
          container.appendChild(activeShareDrawer);
          shareBtn.classList.add('active');
        }
      });
    }
  });
  bar.appendChild(shareBtn);

  // 4. Token 消耗详情展开按钮
  if (msg.usage && msg.usage.total_tokens) {
    const u = msg.usage;
    const infoBtn = document.createElement('button');
    infoBtn.className = 'msg-action-btn info-btn';
    infoBtn.title = t('chat.usageBtnTooltip');
    infoBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> ${u.total_tokens.toLocaleString()} Tokens`;

    const usageCard = document.createElement('div');
    usageCard.className = 'msg-usage-card hide';

    infoBtn.addEventListener('click', () => {
      const isHidden = usageCard.classList.contains('hide');
      if (isHidden) {
        const sessTotal = calculateSessionTokens(state.currentConv);
        const modelName = msg.model || state.model || (state.lang === 'en' ? 'Model' : '大模型');
        const promptT = (u.prompt_tokens || 0).toLocaleString();
        const compT = (u.completion_tokens || 0).toLocaleString();
        const totalT = (u.total_tokens || 0).toLocaleString();
        const sessT = sessTotal.toLocaleString();

        usageCard.innerHTML = `
          <div class="usage-grid">
            <div class="usage-item"><span class="usage-lbl">${t('chat.usageInput')}</span><span class="usage-val">${promptT}</span></div>
            <div class="usage-item"><span class="usage-lbl">${t('chat.usageOutput')}</span><span class="usage-val">${compT}</span></div>
            <div class="usage-item highlight"><span class="usage-lbl">${t('chat.usageTurnTotal')}</span><span class="usage-val">${totalT}</span></div>
            <div class="usage-item"><span class="usage-lbl">${t('chat.usageSessionTotal')}</span><span class="usage-val">${sessT}</span></div>
          </div>
          <div class="usage-model-tag">${t('chat.usageModel', { model: esc(modelName) })}</div>
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

  // 5. 语音朗读按钮
  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'msg-action-btn tts-btn';
  ttsBtn.title = t('chat.readAloudTooltip');
  ttsBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg> ${t('chat.readAloud')}`;

  let activePlayerDrawer = null;
  ttsBtn.addEventListener('click', () => {
    if (activeShareDrawer && container.contains(activeShareDrawer)) {
      if (typeof activeShareDrawer._close === 'function') {
        activeShareDrawer._close();
      } else {
        container.removeChild(activeShareDrawer);
      }
      activeShareDrawer = null;
      shareBtn.classList.remove('active');
    }
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
        <div class="img-card-skeleton-text">${t('chat.imageRenderingProgress', { elapsed: 1 })}</div>
      </div>
    `;
  } else if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.prompt || t('chat.imageAlt');
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(item.src));
    preview.appendChild(img);
  }

  card.appendChild(preview);

  if (item.revisedPrompt && item.revisedPrompt !== item.prompt) {
    const rev = document.createElement('div');
    rev.className = 'img-card-revised';
    rev.innerHTML = `<strong>${state.lang === 'en' ? 'Revised Prompt:' : '精修提示词:'}</strong> ${esc(item.revisedPrompt)}`;
    card.appendChild(rev);
  }

  if (!item.loading && item.src) {
    const footer = document.createElement('div');
    footer.className = 'img-card-footer';

    const meta = document.createElement('div');
    meta.className = 'img-card-meta';
    meta.textContent = `${item.size || '1024x1024'} · ${item.model ? item.model.split('/').pop() : (state.lang === 'en' ? 'Image' : '生图')}`;
    footer.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'img-card-actions';

    // 1. 下载按钮 (优先利用本地二进制 Blob，若为远程链接则借助边缘代理下载以防浏览器跨域拦截)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'img-card-btn';
    dlBtn.title = state.lang === 'en' ? 'Download HD image (PNG)' : '下载高清图片 (PNG)';
    dlBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> ${state.lang === 'en' ? 'Download' : '下载'}`;
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
      copyBtn.title = state.lang === 'en' ? 'Copy image to clipboard' : '复制图片到剪贴板';
      copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> ${t('common.copy')}`;
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [item.blob.type || 'image/png']: item.blob })
          ]);
          toast(state.lang === 'en' ? 'Image copied to clipboard' : '图片已复制到剪贴板', 'info');
        } catch (e) {
          toast(state.lang === 'en' ? 'Copy failed, click Download instead' : '复制失败，可直接点击下载', 'error');
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
  if (typeof msgIndex === 'number') {
    wrap.setAttribute('data-msg-index', String(msgIndex));
  }

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? (state.lang === 'en' ? 'Me' : '我') : 'AI';

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
            <div class="img-card-skeleton-text">${state.lang === 'en' ? 'Loading local image…' : '正在读取本地图像…'}</div>
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
                    <span>${t('chat.imageExpired')}</span>
                  </div>
                  ${modelText ? `<div style="font-size:11px;color:var(--fg-dim);opacity:.7">${esc(modelText.split('/').pop())}${sizeText ? ' · ' + esc(sizeText) : ''}</div>` : ''}
                </div>
                <div style="font-size:12px;color:var(--fg-dim);line-height:1.6;margin-bottom:12px">
                  <div>${t('chat.imageExpiredDesc1')}</div>
                  <div>${t('chat.imageExpiredDesc2')}</div>
                </div>
                ${promptText ? `
                <div style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid var(--line);gap:8px">
                  <div style="font-size:11.5px;color:var(--fg-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px" title="${esc(promptText)}">${esc(promptText)}</div>
                  <button class="img-card-btn copy-prompt-btn" style="white-space:nowrap">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    ${t('chat.copyPrompt')}
                  </button>
                </div>` : ''}
              </div>
            `;

            const copyBtn = cardWrap.querySelector('.copy-prompt-btn');
            if (copyBtn && promptText) {
              copyBtn.addEventListener('click', async () => {
                try {
                  await navigator.clipboard.writeText(promptText);
                  toast(t('chat.promptCopied'), 'success');
                } catch (_) {
                  toast(state.lang === 'en' ? 'Copy failed, please select manually' : '复制失败，请手动选取', 'error');
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
            cardWrap.innerHTML = `<div class="msg-text" style="color:var(--danger);font-size:12px;padding:8px">${state.lang === 'en' ? 'Failed to read local image' : '读取本地图片异常'}</div>`;
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
      imgTag.alt = img.name || (state.lang === 'en' ? 'Image' : '图片');
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
      const linesStr = f.lines ? ` · ${t('chat.linesCount', { count: f.lines })}` : '';
      summary.innerHTML = `<strong>${esc(f.name)}</strong> <span style="font-size:11px;color:var(--fg-dim);margin-left:auto">${formatSize(f.size)}${linesStr}</span>`;
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
      rDetails.innerHTML = `<summary><span class="reasoning-sparkle">✦</span> <span>${t('chat.thinkingProcess')}</span></summary><div class="reasoning-body">${renderMd(reasoning)}</div>`;
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
      const fullMsg = (state.currentConv && state.currentConv.messages && typeof msgIndex === 'number')
        ? state.currentConv.messages[msgIndex]
        : { content, reasoning, usage, model };
      const actionsBar = createActionsToolbar(fullMsg, msgIndex, onRegenerate);
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

export function appendBubble(role, sources, msgIndex) {
  const wrap = bubble(role, '', null, '', null, '', sources, null, null, typeof msgIndex === 'number' ? msgIndex : null, null);
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
    sel._renderParamOptions = renderOptions;
  });

  if (!document._paramPickerLanguageListener) {
    document._paramPickerLanguageListener = true;
    window.addEventListener('languagechange', () => {
      selects.forEach((sel) => {
        if (typeof sel._renderParamOptions === 'function') {
          sel._renderParamOptions();
        }
      });
    });
  }

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

/* ---------- Custom Settings Pickers (Anthropic Parity & Mobile Bottom Sheets) ---------- */

export function closeAllSettingsPickers() {
  document.querySelectorAll('.settings-picker-wrap.open').forEach((w) => {
    w.classList.remove('open');
    const b = w.querySelector('.settings-picker-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.settings-picker-panel.open').forEach((p) => {
    p.classList.remove('open');
    p.classList.remove('dropup');
    if (window.innerWidth > 768) {
      p.style.display = '';
      p.style.visibility = '';
      p.style.opacity = '';
    }
  });
  document.querySelectorAll('.settings-picker-backdrop.open').forEach((bd) => {
    bd.classList.remove('open');
  });
}

export function syncSettingsPicker(selectEl) {
  if (selectEl && typeof selectEl._syncSettingsPicker === 'function') {
    selectEl._syncSettingsPicker();
  }
}

let lastModalScrollTop = 0;

export function initSettingsPickers() {
  const selects = document.querySelectorAll('.settings-select');
  if (!selects.length) return;

  const modalBody = document.querySelector('.settings-modal-body');

  selects.forEach((sel) => {
    if (sel.dataset.hasSettingsPicker) return;
    sel.dataset.hasSettingsPicker = 'true';

    // Visually conceal native select while maintaining complete accessibility and form value state
    sel.classList.add('param-select-hidden');

    const isSubselect = sel.classList.contains('settings-subselect');
    const wrap = document.createElement('div');
    wrap.className = `settings-picker-wrap${isSubselect ? ' subselect-wrap' : ''}`;
    wrap.id = `settings-picker-${sel.id}`;

    const btn = document.createElement('button');
    btn.className = 'settings-picker-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = sel.title || '';

    const label = document.createElement('span');
    label.className = 'settings-picker-label';

    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'settings-picker-arrow');
    arrowSvg.setAttribute('width', '12');
    arrowSvg.setAttribute('height', '12');
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

    // Mobile sheet backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'settings-picker-backdrop';
    backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllSettingsPickers();
    });

    // Popover / sheet panel
    const panel = document.createElement('div');
    panel.className = 'settings-picker-panel';
    panel.setAttribute('role', 'listbox');

    // Mobile drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'settings-picker-drag-handle';

    // Mobile sheet header with title & close button
    const sheetHeader = document.createElement('div');
    sheetHeader.className = 'settings-picker-sheet-header';

    const sheetTitle = document.createElement('span');
    sheetTitle.className = 'settings-picker-sheet-title';
    let derivedTitle = '';
    if (isSubselect) {
      const sublabel = sel.closest('.settings-subrow')?.querySelector('.settings-sublabel');
      derivedTitle = sublabel ? sublabel.textContent.replace(/[:：]/g, '').trim() : '';
    }
    if (!derivedTitle) {
      const secTitle = sel.closest('.settings-section')?.querySelector('.settings-section-title');
      derivedTitle = secTitle ? secTitle.textContent.trim() : '';
    }
    sheetTitle.textContent = derivedTitle || t('settings.selectOption');

    const sheetClose = document.createElement('button');
    sheetClose.className = 'settings-picker-sheet-close';
    sheetClose.type = 'button';
    sheetClose.setAttribute('aria-label', t('common.close'));
    sheetClose.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    sheetClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllSettingsPickers();
    });

    sheetHeader.appendChild(sheetTitle);
    sheetHeader.appendChild(sheetClose);

    const listContainer = document.createElement('div');
    listContainer.className = 'settings-picker-list';

    panel.appendChild(dragHandle);
    panel.appendChild(sheetHeader);
    panel.appendChild(listContainer);

    wrap.appendChild(btn);

    // Teleport panel & backdrop directly to body to avoid parent modal clipping, scroll constraints, or CSS transform stacking traps
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    if (sel.parentNode) {
      sel.parentNode.insertBefore(wrap, sel.nextSibling);
    }

    function syncUI() {
      btn.disabled = !!sel.disabled;
      const activeOpt = Array.from(sel.options).find((o) => o.value === sel.value) || sel.options[0];
      let activeText = activeOpt ? activeOpt.textContent : '';
      if (activeText.includes('· 推荐') || activeText.includes('· Recommended')) {
        const badgeWord = state.lang === 'en' ? 'Recommended' : '推荐';
        activeText = activeText.replace(/\s*·\s*(?:推荐|Recommended)(?=\)?)/i, '') + ' · ' + badgeWord;
      } else if (activeText.includes('· 默认') || activeText.includes('· Default')) {
        const badgeWord = state.lang === 'en' ? 'Default' : '默认';
        activeText = activeText.replace(/\s*·\s*(?:默认|Default)(?=\)?)/i, '') + ' · ' + badgeWord;
      }
      label.textContent = activeText;

      panel.querySelectorAll('.settings-picker-item').forEach((item) => {
        const isMatch = item.getAttribute('data-value') === sel.value;
        item.classList.toggle('active', isMatch);
        item.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    function createItem(opt) {
      const item = document.createElement('div');
      item.className = 'settings-picker-item';
      item.setAttribute('role', 'option');
      item.setAttribute('data-value', opt.value);
      item.setAttribute('tabindex', '0');

      const contentWrap = document.createElement('div');
      contentWrap.className = 'settings-picker-item-content';

      const textSpan = document.createElement('span');
      textSpan.className = 'settings-picker-item-text';

      let rawText = (opt.textContent || '').trim();
      let badgeText = '';
      if (rawText.includes('· 推荐') || rawText.includes('· Recommended')) {
        badgeText = state.lang === 'en' ? 'Recommended' : '推荐';
        rawText = rawText.replace(/\s*·\s*(?:推荐|Recommended)(?=\)?)/i, '');
      } else if (rawText.includes('· 默认') || rawText.includes('· Default')) {
        badgeText = state.lang === 'en' ? 'Default' : '默认';
        rawText = rawText.replace(/\s*·\s*(?:默认|Default)(?=\)?)/i, '');
      }

      textSpan.textContent = rawText;
      contentWrap.appendChild(textSpan);

      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'settings-picker-item-badge';
        badge.textContent = badgeText;
        contentWrap.appendChild(badge);
      }

      const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      checkSvg.setAttribute('class', 'settings-picker-item-check');
      checkSvg.setAttribute('width', '13');
      checkSvg.setAttribute('height', '13');
      checkSvg.setAttribute('viewBox', '0 0 24 24');
      checkSvg.setAttribute('fill', 'none');
      checkSvg.setAttribute('stroke', 'currentColor');
      checkSvg.setAttribute('stroke-width', '2.5');
      checkSvg.setAttribute('stroke-linecap', 'round');
      checkSvg.setAttribute('stroke-linejoin', 'round');
      const checkPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      checkPoly.setAttribute('points', '20 6 9 17 4 12');
      checkSvg.appendChild(checkPoly);

      item.appendChild(contentWrap);
      item.appendChild(checkSvg);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncUI();
        closeAllSettingsPickers();
      });

      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        }
      });

      return item;
    }

    function renderOptions() {
      let currentTitle = '';
      if (isSubselect) {
        const sublabel = sel.closest('.settings-subrow')?.querySelector('.settings-sublabel');
        currentTitle = sublabel ? sublabel.textContent.replace(/[:：]/g, '').trim() : '';
      }
      if (!currentTitle) {
        const secTitle = sel.closest('.settings-section')?.querySelector('.settings-section-title');
        currentTitle = secTitle ? secTitle.textContent.trim() : '';
      }
      sheetTitle.textContent = currentTitle || t('settings.selectOption');
      sheetClose.setAttribute('aria-label', t('common.close'));

      listContainer.innerHTML = '';
      const children = Array.from(sel.children);
      const hasOptgroups = children.some((c) => c.tagName === 'OPTGROUP');

      if (hasOptgroups) {
        children.forEach((child) => {
          if (child.tagName === 'OPTGROUP') {
            const groupWrap = document.createElement('div');
            groupWrap.className = 'settings-picker-group';

            const groupTitle = document.createElement('div');
            groupTitle.className = 'settings-picker-group-title';
            groupTitle.textContent = child.label || '';
            groupWrap.appendChild(groupTitle);

            Array.from(child.children).forEach((opt) => {
              if (opt.tagName === 'OPTION') {
                groupWrap.appendChild(createItem(opt));
              }
            });

            listContainer.appendChild(groupWrap);
          } else if (child.tagName === 'OPTION') {
            listContainer.appendChild(createItem(child));
          }
        });
      } else {
        Array.from(sel.options).forEach((opt) => {
          listContainer.appendChild(createItem(opt));
        });
      }
      syncUI();
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const isOpen = panel.classList.contains('open');

      closeAllSettingsPickers();
      closeAllParamPickers();

      if (!isOpen) {
        wrap.classList.add('open');
        panel.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');

        if (window.innerWidth > 768) {
          lastModalScrollTop = modalBody ? modalBody.scrollTop : 0;
          const rect = btn.getBoundingClientRect();
          const targetWidth = Math.round(Math.max(rect.width, 260));
          const maxLeft = Math.max(12, window.innerWidth - targetWidth - 16);
          const leftPos = Math.max(12, Math.min(Math.round(rect.left), maxLeft));

          panel.style.position = 'fixed';
          panel.style.zIndex = '2500';
          panel.style.left = `${leftPos}px`;
          panel.style.width = `${targetWidth}px`;
          panel.style.display = 'flex';
          panel.style.visibility = 'visible';
          panel.style.opacity = '1';

          const spaceBelow = window.innerHeight - rect.bottom;
          if (spaceBelow < 260 && rect.top > 260) {
            panel.style.top = 'auto';
            panel.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
            panel.classList.add('dropup');
          } else {
            panel.style.bottom = 'auto';
            panel.style.top = `${Math.round(rect.bottom + 4)}px`;
            panel.classList.remove('dropup');
          }
        } else {
          // Mobile bottom sheet mode
          backdrop.classList.add('open');
          panel.style.position = '';
          panel.style.left = '';
          panel.style.right = '';
          panel.style.top = '';
          panel.style.bottom = '';
          panel.style.width = '';
          panel.style.display = '';
          panel.style.visibility = '';
          panel.style.opacity = '';
          panel.classList.remove('dropup');
        }
      }
    });

    sel.addEventListener('change', syncUI);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        renderOptions();
        syncUI();
      });
      observer.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }

    renderOptions();
    sel._syncSettingsPicker = () => {
      renderOptions();
      syncUI();
    };
  });

  if (!document._settingsPickerGlobalListeners) {
    document._settingsPickerGlobalListeners = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.settings-picker-wrap') && !e.target.closest('.settings-picker-panel')) {
        closeAllSettingsPickers();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllSettingsPickers();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && document.querySelector('.settings-picker-panel.open')) {
        closeAllSettingsPickers();
      }
    });
    if (modalBody) {
      modalBody.addEventListener('scroll', () => {
        if (window.innerWidth > 768 && document.querySelector('.settings-picker-panel.open')) {
          if (Math.abs(modalBody.scrollTop - lastModalScrollTop) > 20) {
            closeAllSettingsPickers();
          }
        }
      }, { passive: true });
    }
    window.addEventListener('languagechange', () => {
      selects.forEach((sel) => {
        if (typeof sel._syncSettingsPicker === 'function') {
          sel._syncSettingsPicker();
        }
      });
    });
  }
}



