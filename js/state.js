// js/state.js
// Centralized state, DOM element selectors, LocalStorage keys, and core utilities.

export const APP_VERSION = '2.5.5';

export const LS = {
  cur: 'zm.current',
  model: 'zm.model',
  token: 'zm.token',
  gated: 'zm.gated',
  effort: 'zm.effort',
  ctx: 'zm.ctx',
  searchDepth: 'zm.searchDepth',
  activePlugins: 'zm.plugins.active',
  theme: 'zm.theme',
  sidebarWidth: 'zm.sidebar.width',
};

const $ = (id) => document.getElementById(id);

export const el = {
  sidebar: $('sidebar'),
  sidebarResizer: $('sidebar-resizer'),
  sidebarBackdrop: $('sidebar-backdrop'),
  sidebarToggle: $('sidebar-toggle'),
  burger: $('burger'),
  newChat: $('new-chat'),
  convList: $('conv-list'),
  sidebarFooterText: $('sidebar-footer-text'),

  model: $('model'),
  effort: $('effort'),
  searchDepth: $('search-depth'),
  ctx: $('ctx'),

  themeToggle: $('theme-toggle'),
  themeIconSun: $('theme-icon-sun'),
  themeIconMoon: $('theme-icon-moon'),
  logout: $('logout'),

  thread: $('thread'),
  threadInner: $('thread-inner'),

  input: $('input'),
  send: $('send'),
  stop: $('stop'),

  attachBtn: $('attach-btn'),
  pluginsBtn: $('plugins-btn'),
  pluginsBadge: $('plugins-badge'),
  voiceBtn: $('voice-btn'),
  fileInput: $('file-input'),
  attachmentsTray: $('composer-attachments'),
  dropOverlay: $('drop-overlay'),

  pluginsModal: $('plugins-modal'),
  pluginsModalBackdrop: $('plugins-modal-backdrop'),
  pluginsList: $('plugins-list'),
  pluginsClose: $('plugins-close'),
  pluginsEnableAll: $('plugins-enable-all'),
  pluginsDisableAll: $('plugins-disable-all'),

  lightbox: $('lightbox'),
  lightboxImg: $('lightbox-img'),
  lightboxClose: $('lightbox-close'),

  gate: $('gate'),
  gateInput: $('gate-input'),
  gateGo: $('gate-go'),
  gateErr: $('gate-err'),

  toast: $('toast'),
};

export const state = {
  token: localStorage.getItem(LS.token) || '',
  model: localStorage.getItem(LS.model) || '',
  theme: localStorage.getItem(LS.theme) || 'dark',
  conversations: [],
  currentId: localStorage.getItem(LS.cur) || null,
  currentConv: null,
  effort: localStorage.getItem(LS.effort) || '',
  ctxN: parseInt(localStorage.getItem(LS.ctx), 10),
  searchDepth: localStorage.getItem(LS.searchDepth) || 'standard',
  modelMeta: {},
  pendingAttachments: [],
  busy: false,
  controller: null,
};

if (isNaN(state.ctxN)) state.ctxN = 20;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

export function getSearchCountByDepth(depth) {
  switch (depth) {
    case 'quick': return 3;
    case 'deep': return 10;
    case 'pro': return 20;
    case 'standard':
    default: return 5;
  }
}

export function calculateSessionTokens(conv) {
  if (!conv || !conv.messages) return 0;
  return conv.messages.reduce((sum, m) => sum + ((m.usage && m.usage.total_tokens) || 0), 0);
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
