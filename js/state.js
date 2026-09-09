// js/state.js
// Centralized state, DOM element selectors, LocalStorage keys, and core utilities.

export const APP_VERSION = '2.20.20';

export const LS = {
  cur: 'zm.current',
  model: 'zm.model',
  token: 'zm.token',
  gated: 'zm.gated',
  effort: 'zm.effort',
  ctx: 'zm.ctx',
  searchDepth: 'zm.searchDepth',
  toolTurns: 'zm.toolTurns',
  activePlugins: 'zm.plugins.active',
  theme: 'zm.theme',
  themeMode: 'zm.theme.mode',
  instructions: 'zm.instructions',
  instructionsEnabled: 'zm.instructions.enabled',
  memoryList: 'zm.memory.list',
  memoryEnabled: 'zm.memory.enabled',
  sidebarWidth: 'zm.sidebar.width',
  imageSize: 'zm.image.size',
  imageQuality: 'zm.image.quality',
  imageBackground: 'zm.image.background',
  updateSnoozedUntil: 'zm.update.snoozed_until',
  asrModel: 'zm.asr.model',
  ttsModel: 'zm.tts.model',
  ttsVoice: 'zm.tts.voice',
};

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const getStorageItem = (key) => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);

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
  modelPickerWrap: $('model-picker-wrap'),
  modelPickerBtn: $('model-picker-btn'),
  modelPickerLabel: $('model-picker-label'),
  modelPickerBackdrop: $('model-picker-backdrop'),
  modelPickerPanel: $('model-picker-panel'),
  modelPickerClose: $('model-picker-close'),
  modelSearchInput: $('model-search-input'),
  modelSearchClear: $('model-search-clear'),
  modelPickerList: $('model-picker-list'),

  chatParamsGroup: $('chat-params-group'),
  effort: $('effort'),
  searchDepth: $('search-depth'),
  toolTurns: $('tool-turns'),
  ctx: $('ctx'),

  imageParamsGroup: $('image-params-group'),
  imageBar: $('image-params-group'),
  imageSize: $('image-size'),
  imageQuality: $('image-quality'),
  imageBackground: $('image-bg'),

  settingsBtn: $('settings-btn'),
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
  voiceOverlay: $('composer-voice-overlay'),
  voiceStatus: $('voice-overlay-status'),
  voiceTimer: $('voice-overlay-timer'),
  voiceWave: $('voice-wave-visualizer'),
  fileInput: $('file-input'),
  attachmentsTray: $('composer-attachments'),
  dropOverlay: $('drop-overlay'),

  pluginsModal: $('plugins-modal'),
  pluginsModalBackdrop: $('plugins-modal-backdrop'),
  pluginsList: $('plugins-list'),
  pluginsClose: $('plugins-close'),
  pluginsEnableAll: $('plugins-enable-all'),
  pluginsDisableAll: $('plugins-disable-all'),

  settingsModal: $('settings-modal'),
  settingsModalBackdrop: $('settings-modal-backdrop'),
  settingsClose: $('settings-close'),
  settingsInstructions: $('settings-instructions'),
  settingsInstructionsToggle: $('settings-instructions-toggle'),
  settingsCharCount: $('settings-char-count'),
  settingsSaveBtn: $('settings-save-btn'),
  settingsClearBtn: $('settings-clear-btn'),
  settingsMemoryToggle: $('settings-memory-toggle'),
  settingsMemoryList: $('settings-memory-list'),
  settingsMemoryInput: $('settings-memory-input'),
  settingsMemoryAddBtn: $('settings-memory-add-btn'),
  settingsMemoryClearBtn: $('settings-memory-clear-btn'),
  settingsMemoryCount: $('settings-memory-count'),
  settingsCheckUpdateBtn: $('settings-check-update-btn'),
  settingsUpdateStatus: $('settings-update-status'),
  settingsAsrModel: $('settings-asr-model'),
  settingsTtsModel: $('settings-tts-model'),
  settingsTtsVoice: $('settings-tts-voice'),
  settingsTtsVoiceRow: $('settings-tts-voice-row'),
  themePillDark: $('theme-pill-dark'),
  themePillLight: $('theme-pill-light'),
  themePillAuto: $('theme-pill-auto'),

  lightbox: $('lightbox'),
  lightboxImg: $('lightbox-img'),
  lightboxClose: $('lightbox-close'),

  gate: $('gate'),
  gateInput: $('gate-input'),
  gateGo: $('gate-go'),
  gateErr: $('gate-err'),

  updateBanner: $('update-banner'),
  updateText: $('update-text'),
  updateReload: $('update-reload-btn'),
  updateLater: $('update-later-btn'),
  updateClose: $('update-close-btn'),

  toast: $('toast'),
};

export const state = {
  token: getStorageItem(LS.token) || '',
  model: getStorageItem(LS.model) || '',
  theme: getStorageItem(LS.theme) || 'dark',
  themeMode: getStorageItem(LS.themeMode) || (getStorageItem(LS.theme) ? getStorageItem(LS.theme) : 'auto'),
  instructions: getStorageItem(LS.instructions) || '',
  instructionsEnabled: getStorageItem(LS.instructionsEnabled) !== 'false',
  memoryEnabled: getStorageItem(LS.memoryEnabled) !== 'false',
  memories: [],
  conversations: [],
  currentId: getStorageItem(LS.cur) || null,
  currentConv: null,
  effort: getStorageItem(LS.effort) || '',
  ctxN: parseInt(getStorageItem(LS.ctx), 10),
  toolMaxTurns: parseInt(getStorageItem(LS.toolTurns), 10),
  searchDepth: getStorageItem(LS.searchDepth) || 'standard',
  asrModel: getStorageItem(LS.asrModel) || 'bytedance/doubao-seed-asr-2.0',
  ttsModel: getStorageItem(LS.ttsModel) || 'browser',
  ttsVoice: getStorageItem(LS.ttsVoice) || 'Kore',
  imageSize: getStorageItem(LS.imageSize) || 'auto',
  imageQuality: getStorageItem(LS.imageQuality) || 'auto',
  imageBackground: getStorageItem(LS.imageBackground) || 'auto',
  isImageMode: false,
  modelMeta: {},
  pendingAttachments: [],
  busy: false,
  controller: null,
};

if (isNaN(state.ctxN)) state.ctxN = 20;
if (isNaN(state.toolMaxTurns)) state.toolMaxTurns = 20;

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
