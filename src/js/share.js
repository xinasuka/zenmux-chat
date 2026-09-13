// js/share.js
// Session Save & Share Engine: Compiles conversations into hermetic standalone HTML snapshots,
// transcodes binary media to Base64 data URIs, and publishes snapshots via here.now edge gateway.

import { state, el, esc, formatSize } from './state.js';
import { renderMd } from './markdown.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { ZenMuxDB } from './db.js';

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
 * Compiles selected dyads into a self-contained, beautifully styled HTML snapshot document.
 */
export async function compileStandaloneHtml({ title, dyads, options = {} }) {
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

  // Asynchronously resolve all images in user and assistant messages to Base64
  const resolvedDyads = await Promise.all(
    dyads.map(async (d) => {
      // User images
      const resolvedUserImages = await Promise.all(
        d.userImages.map(async (img) => {
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

  // Render turns HTML
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
      <article class="turn-container" id="${d.id}" data-raw="${esc(rawInteractionText)}">
        <div class="turn-header">
          <span class="turn-badge">${lang === 'en' ? `Turn #${d.turnIndex}` : `第 ${d.turnIndex} 轮交互`}</span>
          ${metricsHtml}
        </div>

        <!-- User Bubble -->
        <div class="msg-row user-row">
          <div class="avatar user-avatar">${lang === 'en' ? 'Me' : '我'}</div>
          <div class="bubble-body">
            ${userImgsHtml}
            ${userFilesHtml}
            <div class="msg-text">${renderMd(d.userText)}</div>
          </div>
        </div>

        <!-- Assistant Bubble -->
        <div class="msg-row asst-row">
          <div class="avatar asst-avatar">AI</div>
          <div class="bubble-body">
            ${reasoningHtml}
            ${sourcesHtml}
            ${asstContentHtml}
          </div>
        </div>

        <!-- Turn Action Footer -->
        <div class="turn-footer">
          <button class="turn-copy-btn" onclick="copyDyad('${d.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>${lang === 'en' ? 'Copy Interaction' : '复制本轮对话'}</span>
          </button>
        </div>
      </article>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} · ZenMux Chat</title>
  <meta name="description" content="Exported conversation snapshot from ZenMux Chat">
  <style>
    :root {
      --bg: #090a0f;
      --bg-surface: #11131a;
      --bg-card: rgba(255, 255, 255, 0.035);
      --bg-bubble-user: rgba(255, 255, 255, 0.07);
      --bg-bubble-asst: transparent;
      --fg: #f1f5f9;
      --fg-dim: #94a3b8;
      --fg-subtle: #64748b;
      --line: rgba(255, 255, 255, 0.09);
      --primary: #38bdf8;
      --primary-dim: rgba(56, 189, 248, 0.15);
      --primary-border: rgba(56, 189, 248, 0.35);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", Helvetica, Arial, sans-serif;
      --mono: "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace;
      --radius: 12px;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-surface: #ffffff;
      --bg-card: #f1f5f9;
      --bg-bubble-user: #e2e8f0;
      --bg-bubble-asst: transparent;
      --fg: #0f172a;
      --fg-dim: #475569;
      --fg-subtle: #94a3b8;
      --line: rgba(0, 0, 0, 0.08);
      --primary: #0284c7;
      --primary-dim: rgba(2, 132, 199, 0.12);
      --primary-border: rgba(2, 132, 199, 0.3);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 14.5px;
      line-height: 1.68;
      -webkit-font-smoothing: antialiased;
      padding: 32px 16px 80px;
    }

    .zenmux-doc {
      max-width: 820px;
      margin: 0 auto;
    }

    /* Header */
    .zenmux-header {
      padding: 24px 28px;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      margin-bottom: 28px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .zenmux-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .brand-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .theme-toggle-btn, .header-copy-btn {
      background: var(--bg-card);
      border: 1px solid var(--line);
      color: var(--fg-dim);
      padding: 5px 11px;
      font-size: 12px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .theme-toggle-btn:hover, .header-copy-btn:hover {
      color: var(--fg);
      border-color: var(--primary);
    }
    .zenmux-title {
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 6px;
      color: var(--fg);
    }
    .zenmux-meta {
      font-size: 12.5px;
      color: var(--fg-subtle);
    }

    /* Turn Container */
    .turn-container {
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 24px;
      position: relative;
    }
    .turn-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .turn-badge {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--primary);
      background: var(--primary-dim);
      border: 1px solid var(--primary-border);
      padding: 2px 9px;
      border-radius: 20px;
    }
    .turn-meta-tag {
      font-size: 11.5px;
      color: var(--fg-subtle);
    }

    /* Message Rows */
    .msg-row {
      display: flex;
      gap: 14px;
      margin-bottom: 20px;
    }
    .msg-row:last-of-type {
      margin-bottom: 12px;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11.5px;
      font-weight: 700;
    }
    .user-avatar {
      background: var(--primary);
      color: #fff;
    }
    .asst-avatar {
      background: var(--bg-card);
      border: 1px solid var(--line);
      color: var(--primary);
    }
    .bubble-body {
      flex: 1;
      min-width: 0;
    }

    /* Typography & Markdown */
    .msg-text { word-break: break-word; }
    .msg-text p { margin-bottom: 12px; }
    .msg-text p:last-child { margin-bottom: 0; }
    .msg-text h1, .msg-text h2, .msg-text h3 {
      font-weight: 700;
      margin: 18px 0 10px;
      color: var(--fg);
    }
    .msg-text h1 { font-size: 1.4em; }
    .msg-text h2 { font-size: 1.22em; }
    .msg-text h3 { font-size: 1.08em; }
    .msg-text ul, .msg-text ol {
      margin: 8px 0 12px 22px;
    }
    .msg-text li { margin-bottom: 4px; }
    .msg-text blockquote {
      border-left: 3px solid var(--primary);
      padding: 6px 14px;
      background: var(--primary-dim);
      border-radius: 0 6px 6px 0;
      color: var(--fg-dim);
      margin: 12px 0;
    }
    .msg-text a {
      color: var(--primary);
      text-decoration: none;
    }
    .msg-text a:hover { text-decoration: underline; }
    .msg-text code {
      font-family: var(--mono);
      font-size: 0.9em;
      background: var(--bg-card);
      border: 1px solid var(--line);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--primary);
    }
    .msg-text pre {
      background: #050608;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
      overflow-x: auto;
      margin: 12px 0;
    }
    .msg-text pre code {
      background: transparent;
      border: none;
      padding: 0;
      color: #e2e8f0;
      font-size: 12.5px;
      line-height: 1.55;
    }

    /* Reasoning block */
    .reasoning-card {
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 14px;
      font-size: 13px;
    }
    .reasoning-card summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--fg-dim);
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .reasoning-card summary::-webkit-details-marker { display: none; }
    .reasoning-card .sparkle { color: var(--primary); }
    .reasoning-body {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
      color: var(--fg-dim);
      font-size: 12.5px;
    }

    /* Images and Files */
    .msg-images {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .img-thumb {
      width: 90px;
      height: 90px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--line);
      cursor: pointer;
    }
    .img-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .gen-img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--line);
      cursor: pointer;
      display: block;
      margin-bottom: 8px;
    }
    .img-meta {
      font-size: 12px;
      color: var(--fg-subtle);
      display: flex;
      justify-content: space-between;
    }
    .file-card {
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 8px;
      font-size: 12.5px;
    }
    .file-card summary { cursor: pointer; display: flex; justify-content: space-between; }
    .file-size { color: var(--fg-subtle); font-size: 11px; }

    /* Sources */
    .sources-box {
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .sources-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg-dim);
      margin-bottom: 8px;
    }
    .sources-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .source-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--primary);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .source-num {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--primary-dim);
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Turn Footer */
    .turn-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      margin-top: 14px;
    }
    .turn-copy-btn {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--fg-dim);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    .turn-copy-btn:hover {
      color: var(--primary);
      border-color: var(--primary-border);
      background: var(--primary-dim);
    }

    /* Lightbox modal */
    #lightbox {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      cursor: zoom-out;
    }
    #lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }

    /* Footer badge */
    .zenmux-footer-badge {
      text-align: center;
      margin-top: 40px;
      font-size: 12px;
      color: var(--fg-subtle);
    }
    .zenmux-footer-badge a {
      color: var(--primary);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="zenmux-doc">
    <header class="zenmux-header">
      <div class="zenmux-brand-row">
        <div class="brand-badge">
          <span>ZenMux Chat</span>
          <span>·</span>
          <span>Snapshot</span>
        </div>
        <div class="brand-actions">
          <button class="header-copy-btn" onclick="copyAll()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span id="copy-all-lbl">${lang === 'en' ? 'Copy All' : '复制全文'}</span>
          </button>
          <button class="theme-toggle-btn" onclick="toggleTheme()">
            <span id="theme-lbl">Theme</span>
          </button>
        </div>
      </div>
      <h1 class="zenmux-title">${esc(title)}</h1>
      <div class="zenmux-meta">${lang === 'en' ? `Archived snapshot · ${createdAt} · ${dyads.length} interactions` : `归档快照 · ${createdAt} · 共 ${dyads.length} 轮交互`}</div>
    </header>

    <main class="zenmux-thread">
      ${turnsHtml}
    </main>

    <footer class="zenmux-footer-badge">
      ${lang === 'en' ? 'Generated by <a href="https://zenmux.ai" target="_blank">ZenMux Chat</a> · Hosted on <a href="https://here.now" target="_blank">here.now</a>' : '由 <a href="https://zenmux.ai" target="_blank">ZenMux Chat</a> 归档并生成 · 托管于 <a href="https://here.now" target="_blank">here.now</a>'}
    </footer>
  </div>

  <div id="lightbox" onclick="closeLightbox()">
    <img id="lightbox-img" src="" alt="Full view">
  </div>

  <script>
    function copyDyad(cardId) {
      const card = document.getElementById(cardId);
      if (!card) return;
      const raw = card.getAttribute('data-raw') || card.innerText;
      navigator.clipboard.writeText(raw).then(() => {
        const btn = card.querySelector('.turn-copy-btn span');
        if (btn) {
          const old = btn.textContent;
          btn.textContent = '${lang === 'en' ? 'Copied!' : '已复制！'}';
          setTimeout(() => { btn.textContent = old; }, 2000);
        }
      });
    }

    function copyAll() {
      const cards = document.querySelectorAll('.turn-container');
      const allText = Array.from(cards).map(c => c.getAttribute('data-raw')).join('\\n\\n---\\n\\n');
      navigator.clipboard.writeText(allText).then(() => {
        const lbl = document.getElementById('copy-all-lbl');
        if (lbl) {
          const old = lbl.textContent;
          lbl.textContent = '${lang === 'en' ? 'All Copied!' : '已全部复制！'}';
          setTimeout(() => { lbl.textContent = old; }, 2000);
        }
      });
    }

    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('zm.snap.theme', next);
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
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    })();
  </script>
</body>
</html>`;
}

/**
 * Dispatches the compiled HTML snapshot to the EdgeOne /api/share gateway.
 */
export async function publishSessionShare({ title, html, ttlDays }) {
  const token = state.token;
  if (!token) {
    throw new Error(t('gate.invalidKey') || '未提供用户访问口令');
  }

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': token,
    },
    body: JSON.stringify({
      title,
      html,
      ttlDays,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.detail || '发布会话分享失败');
  }

  return data;
}

/**
 * Share Modal State and UI Controller
 */
let activeConversation = null;
let currentDyads = [];
let selectedDyadIds = new Set();

export function openShareModal({ conversation, targetAsstIndex = null }) {
  activeConversation = conversation || state.currentConv;
  if (!activeConversation || !activeConversation.messages || !activeConversation.messages.length) {
    toast(t('share.emptySession') || '当前会话没有可分享的内容', 'info');
    return;
  }

  currentDyads = extractDyads(activeConversation);
  if (!currentDyads.length) {
    toast(t('share.noDyads') || '当前会话暂无完整的问答交互', 'info');
    return;
  }

  // Pre-selection strategy:
  // If invoked from a specific assistant message toolbar -> select ONLY that dyad.
  // Otherwise (invoked from header/topbar) -> select ALL dyads by default.
  selectedDyadIds.clear();
  if (targetAsstIndex !== null) {
    const matched = currentDyads.find((d) => d.asstIndex === targetAsstIndex);
    if (matched) {
      selectedDyadIds.add(matched.id);
    } else {
      // Fallback: select the latest dyad
      selectedDyadIds.add(currentDyads[currentDyads.length - 1].id);
    }
  } else {
    currentDyads.forEach((d) => selectedDyadIds.add(d.id));
  }

  renderShareModalBody();

  // Reset results view to form view
  if (el.shareResultCard) el.shareResultCard.classList.add('hide');
  if (el.shareFormBody) el.shareFormBody.classList.remove('hide');
  if (el.shareSubmitBtn) {
    el.shareSubmitBtn.disabled = false;
    el.shareSubmitBtn.classList.remove('btn-loading');
  }

  // Open modal DOM
  if (el.shareModal) el.shareModal.classList.add('open');
  if (el.shareModalBackdrop) el.shareModalBackdrop.classList.add('open');
}

export function closeShareModal() {
  if (el.shareModal) el.shareModal.classList.remove('open');
  if (el.shareModalBackdrop) el.shareModalBackdrop.classList.remove('open');
}

function updateSelectedCountBadge() {
  if (el.shareSelectedCount) {
    el.shareSelectedCount.textContent = t('share.selectedBadge', {
      selected: selectedDyadIds.size,
      total: currentDyads.length,
    });
  }
  if (el.shareSubmitBtn) {
    el.shareSubmitBtn.disabled = selectedDyadIds.size === 0;
  }
}

function renderShareModalBody() {
  if (!el.shareDyadList) return;
  el.shareDyadList.innerHTML = '';

  currentDyads.forEach((d) => {
    const isChecked = selectedDyadIds.has(d.id);
    const item = document.createElement('div');
    item.className = 'share-dyad-item' + (isChecked ? ' selected' : '');
    item.setAttribute('data-id', d.id);

    const userSnippet = d.userText.length > 70 ? d.userText.slice(0, 70) + '…' : d.userText;
    const asstSnippet = d.asstText.length > 90 ? d.asstText.slice(0, 90) + '…' : (d.asstImageMeta ? '[图像生成]' : d.asstText);

    item.innerHTML = `
      <label class="share-dyad-checkbox-wrap">
        <input type="checkbox" class="share-dyad-checkbox" ${isChecked ? 'checked' : ''}>
        <span class="share-dyad-custom-check"></span>
      </label>
      <div class="share-dyad-content">
        <div class="share-dyad-header-row">
          <span class="share-dyad-index">${t('share.turnNumber', { number: d.turnIndex })}</span>
          ${d.asstModel ? `<span class="share-dyad-model">${esc(d.asstModel.split('/').pop())}</span>` : ''}
        </div>
        <div class="share-dyad-user-preview">
          <span class="role-tag">${t('share.userRole')}:</span> ${esc(userSnippet)}
        </div>
        <div class="share-dyad-asst-preview">
          <span class="role-tag">${t('share.asstRole')}:</span> ${esc(asstSnippet)}
        </div>
      </div>
    `;

    const checkbox = item.querySelector('.share-dyad-checkbox');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedDyadIds.add(d.id);
        item.classList.add('selected');
      } else {
        selectedDyadIds.delete(d.id);
        item.classList.remove('selected');
      }
      updateSelectedCountBadge();
    });

    item.addEventListener('click', (e) => {
      if (e.target === checkbox || e.target.closest('.share-dyad-checkbox-wrap')) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    el.shareDyadList.appendChild(item);
  });

  updateSelectedCountBadge();
}

/**
 * Initializes all event listeners for the Share Modal.
 */
export function initShareEngine() {
  // 1. Close button and backdrop
  if (el.shareClose) el.shareClose.addEventListener('click', closeShareModal);
  if (el.shareModalBackdrop) el.shareModalBackdrop.addEventListener('click', closeShareModal);

  // 2. Bulk mutator buttons
  if (el.shareSelectCurrent) {
    el.shareSelectCurrent.addEventListener('click', () => {
      selectedDyadIds.clear();
      if (currentDyads.length) {
        selectedDyadIds.add(currentDyads[currentDyads.length - 1].id);
      }
      renderShareModalBody();
    });
  }

  if (el.shareSelectAll) {
    el.shareSelectAll.addEventListener('click', () => {
      currentDyads.forEach((d) => selectedDyadIds.add(d.id));
      renderShareModalBody();
    });
  }

  if (el.shareClearAll) {
    el.shareClearAll.addEventListener('click', () => {
      selectedDyadIds.clear();
      renderShareModalBody();
    });
  }

  // 3. Submit Share Button
  if (el.shareSubmitBtn) {
    el.shareSubmitBtn.addEventListener('click', async () => {
      if (!selectedDyadIds.size) {
        toast(t('share.emptySelection') || '请至少选择一轮对话进行分享', 'info');
        return;
      }

      const targetDyads = currentDyads.filter((d) => selectedDyadIds.has(d.id));
      const ttlDays = el.shareTtlSelect ? parseInt(el.shareTtlSelect.value, 10) : 7;
      const includeReasoning = el.shareIncludeReasoning ? el.shareIncludeReasoning.checked : true;
      const includeMetrics = el.shareIncludeMetrics ? el.shareIncludeMetrics.checked : true;

      el.shareSubmitBtn.disabled = true;
      el.shareSubmitBtn.classList.add('btn-loading');
      el.shareSubmitBtn.textContent = t('share.publishing') || '正在生成并发布快照…';

      try {
        // Compile self-contained HTML
        const html = await compileStandaloneHtml({
          title: (activeConversation && activeConversation.title) || 'ZenMux Chat Session',
          dyads: targetDyads,
          options: {
            includeReasoning,
            includeMetrics,
            theme: state.theme || 'dark',
            lang: state.lang || 'zh',
          },
        });

        // Publish to Edge Gateway
        const result = await publishSessionShare({
          title: (activeConversation && activeConversation.title) || 'ZenMux Chat Session',
          html,
          ttlDays,
        });

        // Transition to success card
        if (el.shareFormBody) el.shareFormBody.classList.add('hide');
        if (el.shareResultCard) {
          el.shareResultCard.classList.remove('hide');
          if (el.shareResultUrl) {
            el.shareResultUrl.value = result.siteUrl;
          }
          if (el.shareResultExpiry) {
            if (result.expiresAt) {
              const expDate = new Date(result.expiresAt).toLocaleDateString(state.lang === 'en' ? 'en-US' : 'zh-CN');
              el.shareResultExpiry.textContent = t('share.expiresNotice', { date: expDate });
            } else {
              el.shareResultExpiry.textContent = t('share.permanentNotice');
            }
          }
        }

        // Save to local share history
        try {
          const historyRaw = localStorage.getItem('zm.share.history') || '[]';
          const history = JSON.parse(historyRaw);
          history.unshift({
            slug: result.slug,
            url: result.siteUrl,
            title: (activeConversation && activeConversation.title) || 'ZenMux Chat Session',
            createdAt: result.createdAt || new Date().toISOString(),
            expiresAt: result.expiresAt,
            turnsCount: targetDyads.length,
          });
          localStorage.setItem('zm.share.history', JSON.stringify(history.slice(0, 50)));
        } catch (_) {}

        toast(t('share.publishSuccess') || '分享链接已就绪', 'success');

      } catch (err) {
        toast(t('share.shareFailed', { error: err.message || err }), 'error');
      } finally {
        el.shareSubmitBtn.disabled = false;
        el.shareSubmitBtn.classList.remove('btn-loading');
        el.shareSubmitBtn.textContent = t('share.publishBtn') || '生成并发布分享链接';
      }
    });
  }

  // 4. Copy and Open result link
  if (el.shareCopyLinkBtn) {
    el.shareCopyLinkBtn.addEventListener('click', () => {
      const url = el.shareResultUrl ? el.shareResultUrl.value : '';
      if (!url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          toast(t('share.copied') || '已复制分享链接到剪贴板', 'success');
        });
      }
    });
  }

  if (el.shareOpenLinkBtn) {
    el.shareOpenLinkBtn.addEventListener('click', () => {
      const url = el.shareResultUrl ? el.shareResultUrl.value : '';
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
}
