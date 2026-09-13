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
 * Supports both novel creation (POST) and in-place version mutation (PUT) via slug.
 */
export async function publishSessionShare({ title, html, ttlDays, slug }) {
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
      slug: slug || undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.detail || '发布会话分享失败');
  }

  return data;
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
