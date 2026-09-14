// js/share.js
// Session Save & Share Engine: Compiles conversations into hermetic standalone HTML snapshots,
// transcodes binary media to Base64 data URIs, and publishes snapshots via here.now edge gateway.

import { state, el, esc, formatSize } from './state.js';
import { renderMd } from './markdown.js';
import { t } from './i18n.js';
import { ZenMuxDB } from './db.js';
import { toast } from './ui.js';

// Embedded authentic ZenChat 48x48 brand icon data URL
const ZENCHAT_ICON_DATA_URL = 'data:image/png;base64,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';

/**
 * Extracts structured prompt-response dyads (turns) from a conversation.
 */
export function extractDyads(conv) {
  if (!conv || !Array.isArray(conv.messages)) return [];
  const messages = conv.messages;
  const dyads = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') {
      const dyad = {
        id: `dyad-${dyads.length + 1}`,
        turnIndex: dyads.length + 1,
        userIndex: i,
        userMsg: m,
        userText: m.displayContent || m.content || '',
        userImages: Array.isArray(m.images) ? m.images : [],
        userFiles: Array.isArray(m.files) ? m.files : [],
        asstMsg: null,
        asstIndex: -1,
        asstText: '',
        asstReasoning: '',
        asstModel: '',
        asstUsage: null,
        asstSources: [],
        asstImageMeta: null,
      };

      // Find the directly paired assistant message
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'assistant') {
          const asst = messages[j];
          dyad.asstMsg = asst;
          dyad.asstIndex = j;
          dyad.asstText = asst.content || '';
          dyad.asstReasoning = asst.reasoning || '';
          dyad.asstModel = asst.model || state.model || '';
          dyad.asstUsage = asst.usage || null;
          dyad.asstSources = Array.isArray(asst.sources) ? asst.sources : [];
          if (asst.type === 'image') {
            dyad.asstImageMeta = {
              imageId: asst.imageId,
              prompt: asst.prompt || asst.content,
              revisedPrompt: asst.revisedPrompt,
              size: asst.size,
              quality: asst.quality,
              url: asst.url,
            };
          }
          break;
        } else if (messages[j].role === 'user') {
          // Another user message without assistant response
          break;
        }
      }

      dyads.push(dyad);
    }
  }

  return dyads;
}

/**
 * Converts a Blob to a Base64 data URL string.
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolves an image source or image metadata into a standalone Base64 Data URL.
 */
async function resolveImageAsBase64(imgSrc, imageMeta) {
  if (!imgSrc && (!imageMeta || !imageMeta.imageId)) return '';
  if (imgSrc && imgSrc.startsWith('data:image/')) return imgSrc;

  // 1. Try local IndexedDB binary store if imageId is provided
  if (imageMeta && imageMeta.imageId) {
    try {
      const rec = await ZenMuxDB.getImage(imageMeta.imageId);
      if (rec && rec.blob) {
        return await blobToDataUrl(rec.blob);
      }
      if (rec && rec.url && rec.url.startsWith('data:image/')) {
        return rec.url;
      }
    } catch (_) {}
  }

  // 2. Try fetching blob URL or remote URL directly
  if (imgSrc && (imgSrc.startsWith('blob:') || imgSrc.startsWith('http'))) {
    try {
      const res = await fetch(imgSrc);
      if (res.ok) {
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      }
    } catch (_) {
      // Remote fetch failed (e.g. CORS) -> return original URL as fallback
      return imgSrc;
    }
  }

  return imgSrc || '';
}

/**
 * Resolves the primary application origin for cross-site interactions (e.g. Fork in ZenChat).
 * Reverts to production default if running on private, loopback, or invalid origins.
 */
export function resolveAppOrigin() {
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    const hostname = window.location.hostname;
    const isPrivate = (
      !hostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.endsWith('.local')
    );
    if (!isPrivate && origin && origin !== 'null') {
      return origin;
    }
  }
  return 'https://zenchat.cc.cd';
}

/**
 * Compiles selected dyads into a self-contained, beautifully styled HTML snapshot document.
 */
export async function compileStandaloneHtml({ title, dyads, conversation = null, options = {} }) {
  const {
    includeReasoning = true,
    includeMetrics = true,
    theme = 'dark',
    lang = state.lang || 'zh',
  } = options;

  const createdAt = new Date().toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const appOrigin = resolveAppOrigin();

  // Extract messages corresponding to selected dyads for lossless IndexedDB clone
  const snapshotMessages = [];
  for (const d of dyads) {
    if (d.userMsg) snapshotMessages.push(d.userMsg);
    if (d.asstMsg) snapshotMessages.push(d.asstMsg);
  }

  const conversationPayload = {
    id: (conversation && conversation.id) || `conv_${Date.now()}`,
    title: title || (conversation && conversation.title) || 'Shared Conversation',
    model: (conversation && conversation.model) || (dyads[0] && dyads[0].asstModel) || state.model || '',
    createdAt: (conversation && conversation.createdAt) || Date.now(),
    updatedAt: Date.now(),
    messages: snapshotMessages.length > 0 ? snapshotMessages : (conversation && conversation.messages ? conversation.messages : []),
  };

  const safeJsonIsland = JSON.stringify(conversationPayload).replace(/<\/script>/gi, '<\\/script>');

  // Asynchronously resolve all images in user and assistant messages to Base64
  const resolvedDyads = await Promise.all(
    dyads.map(async (d) => {
      // User images
      const resolvedUserImages = await Promise.all(
        (Array.isArray(d.userImages) ? d.userImages : []).map(async (img) => {
          const base64 = await resolveImageAsBase64(img.dataUrl || img.src);
          return { ...img, dataUrl: base64 };
        })
      );

      // Assistant generated image (if any)
      let resolvedAsstImageSrc = '';
      if (d.asstImageMeta) {
        resolvedAsstImageSrc = await resolveImageAsBase64(d.asstImageMeta.url, d.asstImageMeta);
      }

      return {
        ...d,
        userImages: resolvedUserImages,
        resolvedAsstImageSrc,
      };
    })
  );

  // Render turns HTML using SVG symbol sprite references (#icon-copy)
  const turnsHtml = resolvedDyads.map((d) => {
    // User images grid
    let userImgsHtml = '';
    if (d.userImages && d.userImages.length) {
      userImgsHtml = `
        <div class="msg-images">
          ${d.userImages.map((img) => `<div class="img-thumb" onclick="openLightbox('${esc(img.dataUrl)}')"><img src="${esc(img.dataUrl)}" alt="${esc(img.name || 'Image')}" loading="lazy"></div>`).join('')}
        </div>
      `;
    }

    // User attached files
    let userFilesHtml = '';
    if (d.userFiles && d.userFiles.length) {
      userFilesHtml = `
        <div class="msg-files">
          ${d.userFiles.map((f) => `
            <details class="file-card">
              <summary><strong>${esc(f.name)}</strong> <span class="file-size">${formatSize(f.size || 0)}</span></summary>
              <pre><code>${esc(f.text || '')}</code></pre>
            </details>
          `).join('')}
        </div>
      `;
    }

    // Assistant reasoning
    let reasoningHtml = '';
    if (includeReasoning && d.asstReasoning && d.asstReasoning.trim()) {
      reasoningHtml = `
        <details class="reasoning-card" open>
          <summary><span class="sparkle">✦</span> <span>${lang === 'en' ? 'Thinking Process' : '深度思考过程'}</span></summary>
          <div class="reasoning-body">${renderMd(d.asstReasoning)}</div>
        </details>
      `;
    }

    // Assistant reference sources
    let sourcesHtml = '';
    if (d.asstSources && d.asstSources.length) {
      sourcesHtml = `
        <div class="sources-box">
          <div class="sources-title">${lang === 'en' ? 'Reference Sources' : '参考来源'} (${d.asstSources.length})</div>
          <div class="sources-list">
            ${d.asstSources.map((s, idx) => `
              <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="source-item">
                <span class="source-num">${idx + 1}</span>
                <span class="source-title">${esc(s.title || s.url)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Assistant generated image or text
    let asstContentHtml = '';
    if (d.asstImageMeta && d.resolvedAsstImageSrc) {
      asstContentHtml = `
        <div class="img-output-card">
          <img src="${esc(d.resolvedAsstImageSrc)}" alt="${esc(d.asstImageMeta.prompt || 'Generated Image')}" class="gen-img" onclick="openLightbox('${esc(d.resolvedAsstImageSrc)}')">
          <div class="img-meta">
            <span class="prompt-text">${esc(d.asstImageMeta.prompt || '')}</span>
            ${d.asstImageMeta.size ? `<span class="size-tag">${esc(d.asstImageMeta.size)}</span>` : ''}
          </div>
        </div>
      `;
    } else {
      asstContentHtml = `<div class="msg-text">${renderMd(d.asstText)}</div>`;
    }

    // Metrics tag
    let metricsHtml = '';
    if (includeMetrics) {
      const parts = [];
      if (d.asstModel) parts.push(esc(d.asstModel));
      if (d.asstUsage && d.asstUsage.total_tokens) {
        parts.push(`${d.asstUsage.total_tokens.toLocaleString()} Tokens`);
      }
      if (parts.length) {
        metricsHtml = `<div class="turn-meta-tag">${parts.join(' · ')}</div>`;
      }
    }

    // Plain text version for clipboard copying
    const rawInteractionText = `User: ${d.userText}\n\nAssistant: ${d.asstText}`;

    return `
      <article class="thread-turn" id="${d.id}" data-raw="${esc(rawInteractionText)}">
        <!-- User Row (Right-aligned bubble, no avatar) -->
        <div class="user-row">
          <div class="user-bubble">
            ${userImgsHtml}
            ${userFilesHtml}
            <div class="msg-text">${renderMd(d.userText)}</div>
          </div>
        </div>

        <!-- Assistant Row (Left-aligned, no avatar) -->
        <div class="asst-row">
          <div class="asst-bubble">
            ${reasoningHtml}
            ${sourcesHtml}
            ${asstContentHtml}

            <!-- Assistant Footer: Metrics and Deflated SVG Sprite Copy Button -->
            <div class="asst-footer">
              <div class="asst-metrics">${metricsHtml}</div>
              <button class="turn-copy-btn" onclick="copyDyad('${d.id}', this)" title="${lang === 'en' ? 'Copy interaction' : '复制本轮对话'}" aria-label="${lang === 'en' ? 'Copy interaction' : '复制本轮对话'}">
                <svg class="zm-icon zm-icon-sm" aria-hidden="true"><use href="#icon-copy"></use></svg>
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} · ZenChat</title>
  <meta name="description" content="Shared Conversation from ZenChat">
  <meta name="zenchat:app-origin" content="${esc(appOrigin)}">
  <style>
    :root {
      --bg: #1c1c1e;
      --bg-side: #171719;
      --bg-elev: #232326;
      --bg-surface: #232326;
      --line: #2f2f33;
      --line-soft: #26262a;
      --fg: #e8e8ea;
      --fg-dim: #9a9aa0;
      --fg-faint: #6b6b72;
      --accent: #7f77dd;
      --accent-hover: #928bf2;
      --accent-glow: rgba(127, 119, 221, 0.22);
      --radius: 12px;
      --card-bg: #141418;
      --card-item-bg: #1a1a1e;
      --card-border: rgba(255, 255, 255, 0.04);
      --code-block-bg: #131315;
      --inline-code-bg: #2a2a30;
      --inline-code-fg: #e2b7b5;
      --thought-bg: #151518;
      --thought-border: #26262c;
      --thought-rail: #7f77dd;
      --thought-fg: #a2a2aa;
      --bg-bubble-user: #28282d;
      --bubble-user-border: #383840;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
      --brand-font: "Newsreader", "Charter", "Bitstream Charter", "Georgia", "Cambria", ui-serif, serif;
      --mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    }

    [data-theme="light"] {
      --bg: #FAF9F5;
      --bg-side: #EFECE6;
      --bg-elev: #FFFFFF;
      --bg-surface: #FFFFFF;
      --line: #E5E0D3;
      --line-soft: #ECE7DB;
      --fg: #1F1E1B;
      --fg-dim: #6B685C;
      --fg-faint: #9B978B;
      --accent: #CC785C;
      --accent-hover: #B86549;
      --accent-glow: rgba(204, 120, 92, 0.16);
      --radius: 12px;
      --card-bg: #F5F2EA;
      --card-item-bg: #FFFFFF;
      --card-border: rgba(60, 50, 40, 0.08);
      --code-block-bg: #EFECE3;
      --inline-code-bg: #ECE6DA;
      --inline-code-fg: #9E3B20;
      --thought-bg: #F4F0E6;
      --thought-border: #E2DBD0;
      --thought-rail: #CC785C;
      --thought-fg: #666258;
      --bg-bubble-user: #EAE5D9;
      --bubble-user-border: #D8D1C2;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    ::selection { background: var(--accent-glow); color: var(--fg); }
    [data-theme="light"] ::selection { background: rgba(204, 120, 92, 0.25); color: #1F1E1B; }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
      padding: 32px 16px 80px;
      transition: background 0.2s ease, color 0.2s ease;
    }

    .zenmux-doc { max-width: 780px; margin: 0 auto; }

    .zm-icon {
      width: 15px;
      height: 15px;
      display: inline-block;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .zm-icon-sm { width: 13px; height: 13px; }
    .zm-icon-xs { width: 12px; height: 12px; }

    /* Header */
    .zenmux-header {
      padding: 20px 24px;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      margin-bottom: 28px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    .zenmux-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      gap: 12px;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .brand-logo { border-radius: 6px; display: block; }
    .brand-title {
      font-family: var(--brand-font);
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.3px;
      color: var(--fg);
      line-height: 1.2;
    }
    .brand-sep { color: var(--fg-faint); font-size: 11px; }
    .brand-sub {
      font-size: 12px;
      font-weight: 500;
      color: var(--accent);
      letter-spacing: 0.1px;
    }
    .brand-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .fork-btn {
      background: var(--accent);
      color: #fff;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 0 12px;
      height: 32px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease, opacity 0.15s ease;
      white-space: nowrap;
    }
    .fork-btn:hover { background: var(--accent-hover); }
    [data-theme="light"] .fork-btn { color: #fff; }
    @media (max-width: 480px) {
      .fork-btn span { display: none; }
      .fork-btn { padding: 0 8px; }
    }
    .header-icon-btn {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--fg-dim);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .header-icon-btn:hover {
      background: var(--card-bg);
      color: var(--fg);
      border-color: var(--accent);
    }
    .zenmux-title {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.2px;
      margin-bottom: 8px;
      color: var(--fg);
      word-break: break-word;
    }
    .zenmux-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--fg-dim);
    }
    .zenmux-time { color: var(--fg-dim); }
    .zenmux-disclaimer {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--fg-dim);
      background: var(--card-bg);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid var(--line-soft);
      font-size: 11.5px;
    }

    /* Thread Turns */
    .zenmux-thread { display: flex; flex-direction: column; gap: 26px; }
    .thread-turn {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line-soft);
    }
    .thread-turn:last-child { border-bottom: none; padding-bottom: 0; }

    /* User Bubble */
    .user-row { display: flex; justify-content: flex-end; width: 100%; }
    .user-bubble {
      max-width: min(85%, 660px);
      background: var(--bg-bubble-user);
      border: 1px solid var(--bubble-user-border);
      border-radius: 18px 18px 4px 18px;
      padding: 11px 16px;
      color: var(--fg);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
      font-size: 14.5px;
      line-height: 1.6;
    }

    /* Assistant Bubble */
    .asst-row { display: flex; justify-content: flex-start; width: 100%; }
    .asst-bubble {
      width: 100%;
      background: transparent;
      padding: 2px 0 6px;
      color: var(--fg);
      font-size: 15px;
      line-height: 1.65;
    }

    /* Typography & Markdown */
    .msg-text { word-break: break-word; overflow-wrap: anywhere; }
    .msg-text p { margin-bottom: 12px; }
    .msg-text p:last-child { margin-bottom: 0; }
    .msg-text h1, .msg-text h2, .msg-text h3, .msg-text h4 {
      font-size: 16px;
      font-weight: 600;
      margin: 18px 0 8px;
      color: var(--fg);
    }
    .msg-text ul, .msg-text ol { margin: 0 0 12px; padding-left: 22px; }
    .msg-text li { margin: 3px 0; }
    .msg-text blockquote {
      margin: 12px 0;
      padding: 4px 0 4px 14px;
      border-left: 3px solid var(--accent);
      background: var(--accent-glow);
      border-radius: 0 8px 8px 0;
      color: var(--fg);
      font-size: 13.5px;
    }
    .msg-text a { color: var(--accent); text-decoration: none; }
    .msg-text a:hover { text-decoration: underline; }
    .msg-text code {
      background: var(--inline-code-bg);
      border-radius: 5px;
      padding: 1.5px 5px;
      font-size: 13px;
      color: var(--inline-code-fg);
      font-family: var(--mono);
    }
    .msg-text pre {
      background: var(--code-block-bg);
      border: 1px solid var(--line-soft);
      border-radius: 10px;
      padding: 12px 14px;
      overflow-x: auto;
      margin: 12px 0;
    }
    .msg-text pre code {
      background: transparent;
      border: none;
      padding: 0;
      color: var(--fg);
      font-size: 13px;
      line-height: 1.55;
      white-space: pre;
      font-family: var(--mono);
    }
    .msg-text table {
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 13.5px;
      width: 100%;
      overflow-x: auto;
      display: block;
    }
    .msg-text th, .msg-text td { border: 1px solid var(--line); padding: 6px 10px; }
    .msg-text th { background: var(--card-bg); font-weight: 600; text-align: left; }

    /* Reasoning card */
    .reasoning-card {
      margin: 0 0 14px;
      background: var(--thought-bg);
      border: 1px solid var(--thought-border);
      border-left: 3px solid var(--thought-rail);
      border-radius: 10px;
      padding: 9px 13px;
      color: var(--thought-fg);
      font-size: 13px;
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    .reasoning-card summary {
      cursor: pointer;
      color: var(--fg-dim);
      font-size: 12.5px;
      font-weight: 500;
      user-select: none;
      outline: none;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: color 0.15s;
    }
    .reasoning-card summary:hover { color: var(--fg); }
    .reasoning-card summary::-webkit-details-marker { display: none; }
    .reasoning-card[open] summary {
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--thought-border);
    }
    .reasoning-body { font-size: 12.5px; line-height: 1.6; color: var(--thought-fg); word-break: break-word; overflow-wrap: anywhere; }
    .reasoning-body p { margin: 0 0 8px; }
    .reasoning-body p:last-child { margin-bottom: 0; }
    .reasoning-body ul, .reasoning-body ol { margin: 4px 0 8px; padding-left: 22px; }
    .reasoning-body ul ul, .reasoning-body ol ol, .reasoning-body ul ol, .reasoning-body ol ul { margin: 2px 0; padding-left: 18px; }
    .reasoning-body li { margin: 2px 0; }
    .reasoning-body blockquote {
      margin: 8px 0;
      padding: 6px 12px;
      background: var(--accent-glow);
      border-left: 3px solid var(--accent);
      border-radius: 7px;
      color: var(--fg);
      font-size: 12px;
      line-height: 1.5;
    }
    .reasoning-body blockquote p { margin: 0; }
    .reasoning-body code {
      background: var(--inline-code-bg);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 11.5px;
      font-family: var(--mono);
    }
    .reasoning-body pre {
      background: var(--code-block-bg);
      border: 1px solid var(--thought-border);
      margin: 6px 0 8px;
      padding: 8px 10px;
      border-radius: 8px;
      overflow-x: auto;
    }
    .reasoning-body pre code {
      background: transparent;
      border: none;
      padding: 0;
      font-size: 12px;
      white-space: pre;
    }

    /* Images and Files */
    .msg-images { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
    .img-thumb {
      width: 88px;
      height: 88px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--line-soft);
      cursor: pointer;
    }
    .img-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .gen-img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--line-soft);
      cursor: pointer;
      display: block;
      margin-bottom: 8px;
    }
    .img-meta { font-size: 12px; color: var(--fg-faint); display: flex; justify-content: space-between; }
    .file-card {
      background: var(--card-bg);
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 8px;
      font-size: 12.5px;
      color: var(--fg);
    }
    .file-card summary { cursor: pointer; display: flex; justify-content: space-between; color: var(--fg-dim); }
    .file-card summary:hover { color: var(--fg); }
    .file-size { color: var(--fg-faint); font-size: 11px; }

    /* Sources */
    .sources-box {
      background: var(--card-bg);
      border: 1px solid var(--line-soft);
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .sources-title { font-size: 12px; font-weight: 600; color: var(--fg-dim); margin-bottom: 8px; }
    .sources-list { display: flex; flex-direction: column; gap: 6px; }
    .source-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 7px;
      background: var(--card-item-bg);
      border: 1px solid var(--card-border);
      color: var(--fg);
      text-decoration: none;
      font-size: 12.5px;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .source-item:hover { background: var(--bg-surface); color: var(--accent); border-color: var(--accent); }
    .source-num {
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-glow);
      padding: 1px 5px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    /* Assistant Footer */
    .asst-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding-top: 6px;
    }
    .asst-metrics, .turn-meta-tag { font-size: 11.5px; color: var(--fg-faint); font-variant-numeric: tabular-nums; }
    .turn-copy-btn {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--fg-faint);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      margin-left: auto;
    }
    .turn-copy-btn:hover { color: var(--fg); border-color: var(--accent); background: var(--card-bg); }

    /* Lightbox modal */
    #lightbox {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.84);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      cursor: zoom-out;
      backdrop-filter: blur(4px);
    }
    #lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); }

    /* Responsive */
    @media (max-width: 640px) {
      body { padding: 16px 12px 60px; }
      .zenmux-header { padding: 16px 18px; margin-bottom: 20px; }
      .user-bubble { max-width: 92%; padding: 10px 14px; }
      .zenmux-title { font-size: 18px; }
    }
  </style>
</head>
<body>
  <!-- Hidden SVG Symbol Sprite -->
  <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
    <symbol id="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </symbol>
    <symbol id="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </symbol>
    <symbol id="icon-fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"></line>
      <circle cx="18" cy="6" r="3"></circle>
      <circle cx="6" cy="18" r="3"></circle>
      <path d="M18 9a9 9 0 0 1-9 9"></path>
    </symbol>
    <symbol id="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </symbol>
    <symbol id="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </symbol>
    <symbol id="icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </symbol>
  </svg>

  <div class="zenmux-doc">
    <header class="zenmux-header">
      <div class="zenmux-brand-row">
        <div class="brand-badge">
          <img src="${ZENCHAT_ICON_DATA_URL}" width="22" height="22" class="brand-logo" alt="ZenChat">
          <span class="brand-title">ZenChat</span>
          <span class="brand-sep">·</span>
          <span class="brand-sub">${lang === 'en' ? 'Shared Conversation' : '共享对话'}</span>
        </div>
        <div class="brand-actions">
          <button class="fork-btn" id="fork-btn" onclick="continueInZenChat()" title="${lang === 'en' ? 'Continue in ZenChat' : '在 ZenChat 中继续'}">
            <svg class="zm-icon" aria-hidden="true"><use href="#icon-fork"></use></svg>
            <span>${lang === 'en' ? 'Continue in ZenChat' : '在 ZenChat 中继续'}</span>
          </button>
          <button class="header-icon-btn" onclick="copyAll(this)" title="${lang === 'en' ? 'Copy All' : '复制全文'}" aria-label="${lang === 'en' ? 'Copy All' : '复制全文'}">
            <svg class="zm-icon" aria-hidden="true"><use href="#icon-copy"></use></svg>
          </button>
          <button class="header-icon-btn" onclick="toggleTheme()" title="${lang === 'en' ? 'Toggle Theme' : '切换主题'}" aria-label="${lang === 'en' ? 'Toggle Theme' : '切换主题'}">
            <svg class="zm-icon sun-icon" aria-hidden="true" style="${theme === 'light' ? 'display:none' : ''}"><use href="#icon-sun"></use></svg>
            <svg class="zm-icon moon-icon" aria-hidden="true" style="${theme === 'light' ? 'display:block' : 'display:none'}"><use href="#icon-moon"></use></svg>
          </button>
        </div>
      </div>
      <h1 class="zenmux-title">${esc(title)}</h1>
      <div class="zenmux-meta-row">
        <span class="zenmux-time">${createdAt}</span>
        <div class="zenmux-disclaimer">
          <svg class="zm-icon zm-icon-xs" aria-hidden="true"><use href="#icon-info"></use></svg>
          <span>${lang === 'en' ? 'This shared conversation is generated by AI, for reference only.' : '此共享对话由 AI 生成，仅供参考。'}</span>
        </div>
      </div>
    </header>

    <main class="zenmux-thread">
      ${turnsHtml}
    </main>
  </div>

  <!-- Raw Session Data Island for Direct Import / Fork -->
  <script type="application/json" id="zenchat-snapshot-data">
${safeJsonIsland}
  </script>

  <div id="lightbox" onclick="closeLightbox()">
    <img id="lightbox-img" src="" alt="Full view">
  </div>

  <script>
    function copyDyad(cardId, btn) {
      const card = document.getElementById(cardId);
      if (!card) return;
      const raw = card.getAttribute('data-raw') || card.innerText;
      navigator.clipboard.writeText(raw).then(() => {
        if (btn) {
          const origHtml = btn.innerHTML;
          btn.innerHTML = '<svg class="zm-icon zm-icon-sm" style="color:#10b981" aria-hidden="true"><use href="#icon-check"></use></svg>';
          setTimeout(() => { btn.innerHTML = origHtml; }, 1800);
        }
      });
    }

    function copyAll(btn) {
      const cards = document.querySelectorAll('.thread-turn');
      const allText = Array.from(cards).map(c => c.getAttribute('data-raw')).join('\\n\\n---\\n\\n');
      navigator.clipboard.writeText(allText).then(() => {
        if (btn) {
          const origHtml = btn.innerHTML;
          btn.innerHTML = '<svg class="zm-icon" style="color:#10b981" aria-hidden="true"><use href="#icon-check"></use></svg>';
          setTimeout(() => { btn.innerHTML = origHtml; }, 1800);
        }
      });
    }

    function updateThemeIcons(th) {
      const sun = document.querySelector('.sun-icon');
      const moon = document.querySelector('.moon-icon');
      if (!sun || !moon) return;
      if (th === 'light') {
        sun.style.display = 'none';
        moon.style.display = 'block';
      } else {
        sun.style.display = 'block';
        moon.style.display = 'none';
      }
    }

    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('zm.snap.theme', next);
      updateThemeIcons(next);
    }

    function continueInZenChat() {
      const meta = document.querySelector('meta[name="zenchat:app-origin"]');
      const defaultOrigin = (meta && meta.content) ? meta.content : 'https://zenchat.cc.cd';
      let targetOrigin = defaultOrigin;
      try {
        const custom = localStorage.getItem('zm.custom.origin');
        if (custom && custom.trim()) {
          targetOrigin = custom.trim().replace(/\\/+$/, '');
        }
      } catch (e) {}

      const dataIsland = document.getElementById('zenchat-snapshot-data');
      if (!dataIsland || !dataIsland.textContent) return;

      const newWin = window.open(targetOrigin, '_blank');
      if (!newWin) return;

      const payload = {
        type: 'ZENCHAT_SNAPSHOT_IMPORT',
        rawJson: dataIsland.textContent.trim(),
      };

      function sendPayload() {
        try {
          newWin.postMessage(payload, targetOrigin);
        } catch (_) {}
      }

      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (attempts > 30 || newWin.closed) {
          clearInterval(timer);
          return;
        }
        sendPayload();
      }, 300);

      window.addEventListener('message', function onMessage(ev) {
        if (ev.origin === targetOrigin && ev.data) {
          if (ev.data.type === 'ZENCHAT_RECEIVER_READY') {
            sendPayload();
          } else if (ev.data.type === 'ZENCHAT_IMPORT_ACK') {
            clearInterval(timer);
            window.removeEventListener('message', onMessage);
          }
        }
      });
    }

    function openLightbox(src) {
      const box = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      img.src = src;
      box.style.display = 'flex';
    }

    function closeLightbox() {
      document.getElementById('lightbox').style.display = 'none';
    }

    (function init() {
      const saved = localStorage.getItem('zm.snap.theme');
      if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcons(saved);
      } else {
        updateThemeIcons(document.documentElement.getAttribute('data-theme') || '${theme}');
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Dispatches the compiled HTML snapshot using the unified 3-phase presigned storage upload protocol.
 * Phase 1: Calls EdgeOne /api/share (action: 'prepare') to obtain the presigned R2 PUT URL.
 * Phase 2: Directly uploads the raw HTML binary to Cloudflare R2, completely bypassing EdgeOne's 1 MB limit.
 * Phase 3: Calls EdgeOne /api/share (action: 'finalize') to activate the new version on here.now.
 */
export async function publishSessionShare({ title, html, ttlDays, slug }) {
  const token = state.token;
  if (!token) {
    throw new Error(t('gate.invalidKey') || '未提供用户访问口令');
  }

  const encoder = new TextEncoder();
  const htmlBytes = encoder.encode(html);
  const htmlSize = htmlBytes.byteLength;

  // Phase 1: Stage Publish Manifest via EdgeOne Control Plane (< 1 KB JSON)
  const prepRes = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': token,
    },
    body: JSON.stringify({
      action: 'prepare',
      title,
      ttlDays,
      htmlSize,
      slug: slug || undefined,
    }),
  });

  const prepData = await prepRes.json();
  if (!prepRes.ok || !prepData.ok) {
    throw new Error(prepData.error || prepData.detail || '准备发布快照失败');
  }

  // Phase 2: Direct Binary Stream to Cloudflare R2 Storage (Presigned URL)
  const putHeaders = new Headers(prepData.uploadHeaders || {});
  if (!putHeaders.has('Content-Type')) {
    putHeaders.set('Content-Type', 'text/html; charset=utf-8');
  }

  const putRes = await fetch(prepData.uploadUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: htmlBytes,
  });

  if (!putRes.ok) {
    const putErr = await putRes.text();
    throw new Error(`上传快照至存储节点失败 (${putRes.status}): ${putErr || putRes.statusText}`);
  }

  // Phase 3: Finalize and Activate Deployment via EdgeOne Control Plane (< 1 KB JSON)
  const finRes = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': token,
    },
    body: JSON.stringify({
      action: 'finalize',
      slug: prepData.slug,
      versionId: prepData.versionId,
      ttlSeconds: prepData.ttlSeconds,
      ttlDays,
      isUpdate: prepData.isUpdate,
    }),
  });

  const finData = await finRes.json();
  if (!finRes.ok || !finData.ok) {
    throw new Error(finData.error || finData.detail || '确认快照生效失败');
  }

  return finData;
}

/**
 * Global active share state management
 */
let globalActiveDrawer = null;
let activeThreadShareState = null;

/**
 * Exits thread selection mode, removing all injected overlay mask elements and CSS markers.
 */
export function exitThreadShareMode() {
  if (activeThreadShareState) {
    if (Array.isArray(activeThreadShareState.cleanups)) {
      activeThreadShareState.cleanups.forEach((fn) => {
        try { fn(); } catch (_) {}
      });
    }
    activeThreadShareState = null;
  }

  if (el.threadInner) {
    el.threadInner.classList.remove('thread-share-mode');
    const overlays = el.threadInner.querySelectorAll('.msg-share-overlay');
    overlays.forEach((o) => o.remove());

    const messages = el.threadInner.querySelectorAll('.msg');
    messages.forEach((m) => {
      m.classList.remove('share-turn-selected', 'share-turn-unselected');
    });
  }
}

/**
 * Enters thread selection mode, injecting full-surface selection overlay masks over prompt/response pairs.
 * The overlay intercepts all clicks, protecting interactive buttons/code/audio and preventing text selection.
 */
export function enterThreadShareMode({ dyads, selectedDyadIds, onSelectionChange }) {
  exitThreadShareMode();

  if (!el.threadInner || !Array.isArray(dyads) || !dyads.length) return;

  el.threadInner.classList.add('thread-share-mode');
  const cleanups = [];

  function getMessageElement(role, index) {
    if (typeof index !== 'number' || index < 0) return null;
    // 1. Precise lookup via data-msg-index
    const elFound = el.threadInner.querySelector(`.msg.${role}[data-msg-index="${index}"]`);
    if (elFound) return elFound;

    // 2. Resilient fallback: index-based scan across all .msg elements in threadInner
    const allMsgs = el.threadInner.querySelectorAll('.msg');
    if (allMsgs && allMsgs[index] && allMsgs[index].classList.contains(role)) {
      allMsgs[index].setAttribute('data-msg-index', String(index));
      return allMsgs[index];
    }

    // 3. Fallback for the last assistant response:
    if (role === 'assistant') {
      const allAsstMsgs = el.threadInner.querySelectorAll('.msg.assistant');
      const lastDyad = dyads[dyads.length - 1];
      if (lastDyad && lastDyad.asstIndex === index && allAsstMsgs.length > 0) {
        const lastAsst = allAsstMsgs[allAsstMsgs.length - 1];
        lastAsst.setAttribute('data-msg-index', String(index));
        return lastAsst;
      }
    }

    return null;
  }

  function syncVisuals() {
    dyads.forEach((d) => {
      const isSelected = selectedDyadIds.has(d.id);
      const userEl = getMessageElement('user', d.userIndex);
      const asstEl = d.asstIndex >= 0 ? getMessageElement('assistant', d.asstIndex) : null;

      if (userEl) {
        userEl.classList.toggle('share-turn-selected', isSelected);
        userEl.classList.toggle('share-turn-unselected', !isSelected);
      }
      if (asstEl) {
        asstEl.classList.toggle('share-turn-selected', isSelected);
        asstEl.classList.toggle('share-turn-unselected', !isSelected);
      }
    });
  }

  function toggleDyad(dyadId) {
    if (selectedDyadIds.has(dyadId)) {
      selectedDyadIds.delete(dyadId);
    } else {
      selectedDyadIds.add(dyadId);
    }
    syncVisuals();
    if (typeof onSelectionChange === 'function') {
      onSelectionChange(selectedDyadIds);
    }
  }

  function attachTurnOverlay(msgElem, dyadId) {
    if (!msgElem) return;
    if (msgElem.querySelector(`.msg-share-overlay[data-dyad-id="${dyadId}"]`)) return;

    const overlay = document.createElement('div');
    overlay.className = 'msg-share-overlay';
    overlay.setAttribute('data-dyad-id', dyadId);
    overlay.setAttribute('role', 'button');
    overlay.title = t('share.toggleDyad') || '点击切换此轮对话选择状态';

    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDyad(dyadId);
    };
    overlay.addEventListener('click', handler);
    cleanups.push(() => overlay.removeEventListener('click', handler));

    msgElem.appendChild(overlay);
  }

  dyads.forEach((d) => {
    const userEl = getMessageElement('user', d.userIndex);
    const asstEl = d.asstIndex >= 0 ? getMessageElement('assistant', d.asstIndex) : null;

    attachTurnOverlay(userEl, d.id);
    attachTurnOverlay(asstEl, d.id);
  });

  syncVisuals();

  activeThreadShareState = {
    dyads,
    selectedDyadIds,
    syncVisuals,
    cleanups,
  };
}

/**
 * Creates and mounts an in-situ expandable Share Drawer inside the message actions container.
 */
export function createShareDrawer(msg, msgIndex, onClose) {
  // Close any previously active drawer across the entire app
  if (globalActiveDrawer && typeof globalActiveDrawer._close === 'function') {
    globalActiveDrawer._close();
  }

  const conv = state.currentConv;
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
    toast(t('share.emptySession') || '当前会话没有可分享的内容', 'info');
    return null;
  }

  const dyads = extractDyads(conv);
  if (!dyads.length) {
    toast(t('share.noDyads') || '当前会话暂无完整的问答交互', 'info');
    return null;
  }

  const targetMsg = (typeof msgIndex === 'number' && conv.messages && conv.messages[msgIndex]) || msg;
  const matchedDyad = dyads.find((d) => d.asstIndex === msgIndex) || dyads[dyads.length - 1];

  const hostMsgElem = (typeof msgIndex === 'number' && el.threadInner && el.threadInner.querySelector(`.msg.assistant[data-msg-index="${msgIndex}"]`)) ||
    (matchedDyad && el.threadInner && el.threadInner.querySelector(`.msg.assistant[data-msg-index="${matchedDyad.asstIndex}"]`));
  if (hostMsgElem) {
    hostMsgElem.classList.add('has-share-drawer');
  }

  const existingShare = targetMsg && targetMsg.share && targetMsg.share.siteUrl ? targetMsg.share : null;
  const effectiveExpiresAt = existingShare && (
    existingShare.ttlDays === 0
      ? null
      : (existingShare.expiresAt || (existingShare.ttlDays > 0 && existingShare.sharedAt ? new Date(existingShare.sharedAt + existingShare.ttlDays * 86400000).toISOString() : null))
  );
  const isExpired = effectiveExpiresAt && Date.now() > new Date(effectiveExpiresAt).getTime();
  const hasValidExistingShare = Boolean(existingShare && !isExpired);

  const drawer = document.createElement('div');
  drawer.className = 'msg-share-drawer';

  function closeDrawer() {
    exitThreadShareMode();
    if (hostMsgElem) {
      hostMsgElem.classList.remove('has-share-drawer');
    }
    if (globalActiveDrawer === drawer) {
      globalActiveDrawer = null;
    }
    if (drawer.parentElement) {
      drawer.parentElement.removeChild(drawer);
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  }
  drawer._close = closeDrawer;
  globalActiveDrawer = drawer;

  // Render Header
  const header = document.createElement('div');
  header.className = 'share-drawer-header';
  header.innerHTML = `
    <div class="share-drawer-title">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
      </svg>
      <span>${t('share.modalTitle') || '保存与分享'}</span>
    </div>
    <button type="button" class="share-drawer-close" title="${t('common.close') || '关闭'}">×</button>
  `;
  header.querySelector('.share-drawer-close').addEventListener('click', closeDrawer);
  drawer.appendChild(header);

  // Body container for switching between Config View and Result View
  const bodyWrap = document.createElement('div');
  drawer.appendChild(bodyWrap);

  let selectedDyadIds = new Set();
  if (matchedDyad) {
    selectedDyadIds.add(matchedDyad.id);
  } else if (dyads.length) {
    selectedDyadIds.add(dyads[dyads.length - 1].id);
  }

  function getShareStatusInfo(expiresAt) {
    if (!expiresAt) {
      return {
        text: t('share.statusPermanent') || (state.lang === 'en' ? 'Permanent' : '永久有效'),
        type: 'permanent',
      };
    }

    const expTime = new Date(expiresAt).getTime();
    if (isNaN(expTime)) {
      return {
        text: t('share.statusPermanent') || (state.lang === 'en' ? 'Permanent' : '永久有效'),
        type: 'permanent',
      };
    }

    const diffMs = expTime - Date.now();
    if (diffMs <= 0) {
      return {
        text: t('share.statusExpired') || (state.lang === 'en' ? 'Expired' : '已过期'),
        type: 'expired',
      };
    }

    const hoursRemain = Math.ceil(diffMs / (1000 * 60 * 60));
    if (hoursRemain < 24) {
      return {
        text: t('share.statusHoursRemain') || (state.lang === 'en' ? '< 24h remain' : '剩余不到 1 天'),
        type: 'expiring',
      };
    }

    const daysRemain = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
      text: t('share.statusDaysRemain', { days: daysRemain }) || (state.lang === 'en' ? `${daysRemain} days remain` : `剩余 ${daysRemain} 天`),
      type: 'expiring',
    };
  }

  function renderResultView(siteUrl, expiresAt, isRetrieved = false) {
    exitThreadShareMode();
    bodyWrap.innerHTML = '';

    const resCard = document.createElement('div');
    resCard.className = 'share-drawer-result-body';

    const statusInfo = getShareStatusInfo(expiresAt);

    resCard.innerHTML = `
      <div class="share-drawer-ready-row">
        <div class="share-drawer-ready-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>${t('share.publishSuccess') || '分享链接已就绪'}</span>
        </div>
        <span class="share-drawer-status-pill ${statusInfo.type}">${statusInfo.text}</span>
      </div>

      <div class="share-drawer-url-box">
        <a class="share-drawer-link-anchor" href="${siteUrl}" target="_blank" rel="noopener noreferrer">
          <span class="url-text">${siteUrl}</span>
          <svg class="share-external-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>

      <div class="share-drawer-actions">
        <button type="button" class="share-drawer-copy-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span class="copy-btn-text">${t('share.copyLink') || '复制链接'}</span>
        </button>
        <button type="button" class="share-drawer-edit-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          <span>${t('share.updateSnapshot') || '重新选择'}</span>
        </button>
      </div>
    `;

    const copyBtn = resCard.querySelector('.share-drawer-copy-btn');
    const copyText = copyBtn.querySelector('.copy-btn-text');
    copyBtn.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(siteUrl).then(() => {
          toast(t('share.copied') || '已复制分享链接到剪贴板', 'success');
          copyText.textContent = t('common.copied') || '已复制';
          setTimeout(() => { copyText.textContent = t('share.copyLink') || '复制链接'; }, 2000);
        }).catch(() => {
          toast(t('common.copyFailed') || '复制失败，请手动选取', 'error');
        });
      }
    });

    resCard.querySelector('.share-drawer-edit-btn').addEventListener('click', () => {
      renderConfigView(true);
    });

    bodyWrap.appendChild(resCard);
  }

  function renderConfigView(isUpdate = false) {
    bodyWrap.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'share-drawer-form-body';

    const existingSlug = targetMsg && targetMsg.share && targetMsg.share.slug ? targetMsg.share.slug : null;

    form.innerHTML = `
      <div class="share-drawer-selection-bar">
        <span class="share-drawer-count-badge"></span>
        <div class="share-drawer-pills">
          <button type="button" class="share-pill-btn share-pill-current">${t('share.selectCurrent') || '仅此单轮'}</button>
          <button type="button" class="share-pill-btn share-pill-all">${t('share.selectAll') || '全选会话'}</button>
        </div>
      </div>

      <div class="share-drawer-hint">
        ${t('share.drawerHint') || '点击上方任意对话即可自由选入或移出分享内容。'}
      </div>

      <div class="share-drawer-retention-row">
        <label class="share-retention-label">${t('share.retentionLabel') || '保留策略'}:</label>
        <select class="share-retention-select">
          <option value="7" selected>${t('share.ttl7d') || '7 天有效 (推荐)'}</option>
          <option value="14">${t('share.ttl14d') || '14 天有效'}</option>
          <option value="30">${t('share.ttl30d') || '30 天有效'}</option>
          <option value="0">${t('share.ttlPermanent') || '永久保留 (FIFO 自动轮转)'}</option>
        </select>
      </div>

      <div class="share-drawer-actions">
        <button type="button" class="share-drawer-publish-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          <span class="btn-text">${existingSlug || isUpdate ? (t('share.updateBtn') || '更新此分享链接内容') : (t('share.publishBtn') || '生成并发布分享链接')}</span>
        </button>
        <button type="button" class="share-drawer-cancel-btn">${t('common.cancel') || '取消'}</button>
      </div>
    `;

    const countBadge = form.querySelector('.share-drawer-count-badge');
    const publishBtn = form.querySelector('.share-drawer-publish-btn');
    const cancelBtn = form.querySelector('.share-drawer-cancel-btn');
    const ttlSelect = form.querySelector('.share-retention-select');
    if (targetMsg && targetMsg.share && typeof targetMsg.share.ttlDays !== 'undefined') {
      ttlSelect.value = String(targetMsg.share.ttlDays);
    }

    function updateBadge() {
      countBadge.textContent = t('share.selectedBadge', {
        selected: selectedDyadIds.size,
        total: dyads.length,
      }) || `已选 ${selectedDyadIds.size} / ${dyads.length} 轮交互`;
      publishBtn.disabled = selectedDyadIds.size === 0;
    }

    form.querySelector('.share-pill-current').addEventListener('click', () => {
      selectedDyadIds.clear();
      if (matchedDyad) selectedDyadIds.add(matchedDyad.id);
      else if (dyads.length) selectedDyadIds.add(dyads[dyads.length - 1].id);
      if (activeThreadShareState && activeThreadShareState.syncVisuals) {
        activeThreadShareState.syncVisuals();
      }
      updateBadge();
    });

    form.querySelector('.share-pill-all').addEventListener('click', () => {
      dyads.forEach((d) => selectedDyadIds.add(d.id));
      if (activeThreadShareState && activeThreadShareState.syncVisuals) {
        activeThreadShareState.syncVisuals();
      }
      updateBadge();
    });

    cancelBtn.addEventListener('click', closeDrawer);

    publishBtn.addEventListener('click', async () => {
      if (!selectedDyadIds.size) {
        toast(t('share.emptySelection') || '请至少选择一轮对话进行分享', 'info');
        return;
      }

      const targetDyads = dyads.filter((d) => selectedDyadIds.has(d.id));
      const parsedTtl = parseInt(ttlSelect.value, 10);
      const ttlDays = isNaN(parsedTtl) ? 7 : parsedTtl;
      const slugToUse = existingSlug || (targetMsg && targetMsg.share ? targetMsg.share.slug : null);

      publishBtn.disabled = true;
      const origHtml = publishBtn.innerHTML;
      publishBtn.innerHTML = `
        <span class="spinner-border" style="width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:swUpdateSpin .6s linear infinite;display:inline-block"></span>
        <span>${slugToUse ? (t('share.updating') || '正在更新并同步快照…') : (t('share.publishing') || '正在生成并发布快照…')}</span>
      `;

      try {
        const html = await compileStandaloneHtml({
          title: (conv && conv.title) || 'ZenMux Chat Session',
          dyads: targetDyads,
          conversation: conv,
          options: {
            includeReasoning: true,
            includeMetrics: true,
            theme: state.theme || 'dark',
            lang: state.lang || 'zh',
          },
        });

        const result = await publishSessionShare({
          title: (conv && conv.title) || 'ZenMux Chat Session',
          html,
          ttlDays,
          slug: slugToUse,
        });

        const resolvedExpiresAt = (ttlDays > 0)
          ? (result.expiresAt || new Date(Date.now() + ttlDays * 86400000).toISOString())
          : null;

        if (targetMsg) {
          targetMsg.share = {
            slug: result.slug,
            siteUrl: result.siteUrl,
            expiresAt: resolvedExpiresAt,
            sharedAt: Date.now(),
            ttlDays,
          };
          import('./db.js').then(({ ZenMuxDB }) => {
            ZenMuxDB.putConversation(conv).catch(() => {});
          });
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(result.siteUrl).catch(() => {});
        }

        try {
          const historyRaw = localStorage.getItem('zm.share.history') || '[]';
          const history = JSON.parse(historyRaw);
          history.unshift({
            slug: result.slug,
            url: result.siteUrl,
            title: (conv && conv.title) || 'ZenMux Chat Session',
            createdAt: result.createdAt || new Date().toISOString(),
            expiresAt: resolvedExpiresAt,
            turnsCount: targetDyads.length,
          });
          localStorage.setItem('zm.share.history', JSON.stringify(history.slice(0, 50)));
        } catch (_) {}

        const successNotice = result.updated
          ? (t('share.updateSuccess') || '分享链接内容已更新并已复制到剪贴板')
          : (t('share.publishSuccess') || '分享链接已就绪并已自动复制到剪贴板');
        toast(successNotice, 'success');

        renderResultView(result.siteUrl, resolvedExpiresAt, false);

      } catch (err) {
        toast(t('share.shareFailed', { error: err.message || err }), 'error');
        publishBtn.disabled = false;
        publishBtn.innerHTML = origHtml;
      }
    });

    bodyWrap.appendChild(form);

    enterThreadShareMode({
      dyads,
      selectedDyadIds,
      onSelectionChange: () => updateBadge(),
    });

    updateBadge();
  }

  if (hasValidExistingShare) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(existingShare.siteUrl).catch(() => {});
    }
    renderResultView(existingShare.siteUrl, effectiveExpiresAt, true);
    toast(t('share.retrievedSuccess') || '链接已复制到剪贴板', 'info');
  } else {
    renderConfigView(false);
  }

  return drawer;
}

/**
 * Initializes global share listeners (Escape key, thread cleanup).
 */
export function initShareEngine() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && globalActiveDrawer) {
      if (typeof globalActiveDrawer._close === 'function') {
        globalActiveDrawer._close();
      }
    }
  });
}
