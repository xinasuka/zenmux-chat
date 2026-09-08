// js/app.js
// Main entrypoint and orchestrator for ZenMux Chat.

import { el, state, LS, uid, formatSize, getHostname, APP_VERSION, esc } from './state.js';
import { ZenMuxDB } from './db.js';
import { initTheme, applyTheme, syncThemePillsUI } from './theme.js';
import { MemoryStore, MAX_MEMORY_ITEMS } from './memory.js';
import { toast, bubble, openLightbox, closeLightbox, TitleExtractor, updateSidebarFooter, initParamPickers, syncParamPicker, closeAllParamPickers } from './ui.js';
import { renderAttachmentsTray, processIncomingFiles } from './attachments.js';
import { executeAssistantStream, executeImageGeneration } from './chat.js';
import { PluginRegistry } from './plugins.js';
import { initVersionChecker, flushPendingUpdate } from './updater.js';
import { AudioRecorder } from './audio.js';

/* ---------- Responsive Sidebar State Persistence & Resizing ---------- */
const LS_SIDEBAR_COLLAPSED = 'zenmux_sidebar_collapsed';
const isMobileScreen = () => window.innerWidth <= 768;

const DEFAULT_SIDEBAR_WIDTH = 248;
const MIN_SIDEBAR_WIDTH = 180;
const getMaxSidebarWidth = () => Math.min(520, Math.floor(window.innerWidth * 0.45));

// Restore sidebar width immediately before first render to prevent layout jump
const initialSavedWidth = localStorage.getItem(LS.sidebarWidth);
if (initialSavedWidth) {
  const num = parseInt(initialSavedWidth, 10);
  if (!isNaN(num) && num >= MIN_SIDEBAR_WIDTH && num <= 600) {
    document.documentElement.style.setProperty('--sidebar-width', `${num}px`);
  }
}

export function initSidebarResizer() {
  const resizer = el.sidebarResizer || document.getElementById('sidebar-resizer');
  if (!resizer) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = DEFAULT_SIDEBAR_WIDTH;

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isMobileScreen()) return;
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startWidth = el.sidebar ? el.sidebar.getBoundingClientRect().width : DEFAULT_SIDEBAR_WIDTH;
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
  });

  resizer.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const delta = e.clientX - startX;
    const maxW = getMaxSidebarWidth();
    const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, Math.round(startWidth + delta)));
    document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
  });

  const stopDragging = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try { resizer.releasePointerCapture(e.pointerId); } catch (err) {}
    document.body.classList.remove('is-resizing');
    if (el.sidebar) {
      const currentWidth = Math.round(el.sidebar.getBoundingClientRect().width);
      if (currentWidth >= MIN_SIDEBAR_WIDTH) {
        localStorage.setItem(LS.sidebarWidth, String(currentWidth));
      }
    }
  };

  resizer.addEventListener('pointerup', stopDragging);
  resizer.addEventListener('pointercancel', stopDragging);

  // Double-click to reset to default width
  resizer.addEventListener('dblclick', () => {
    if (isMobileScreen()) return;
    document.documentElement.style.setProperty('--sidebar-width', `${DEFAULT_SIDEBAR_WIDTH}px`);
    localStorage.setItem(LS.sidebarWidth, String(DEFAULT_SIDEBAR_WIDTH));
  });
}

if (!isMobileScreen() && localStorage.getItem(LS_SIDEBAR_COLLAPSED) === 'true') {
  document.body.classList.add('sidebar-collapsed');
}

export function openSidebar() {
  if (isMobileScreen()) {
    if (el.sidebar) el.sidebar.classList.add('open');
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add('active');
  } else {
    document.body.classList.remove('sidebar-collapsed');
    localStorage.setItem(LS_SIDEBAR_COLLAPSED, 'false');
  }
}

export function closeSidebar() {
  if (isMobileScreen()) {
    if (el.sidebar) el.sidebar.classList.remove('open');
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.remove('active');
  } else {
    document.body.classList.add('sidebar-collapsed');
    localStorage.setItem(LS_SIDEBAR_COLLAPSED, 'true');
  }
}

export function toggleSidebar() {
  if (isMobileScreen()) {
    if (el.sidebar && el.sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  } else {
    const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem(LS_SIDEBAR_COLLAPSED, isCollapsed ? 'true' : 'false');
  }
}

export function autoGrow() {
  if (!el.input) return;
  el.input.style.height = 'auto';
  const sh = el.input.scrollHeight;
  if (sh > 0) {
    el.input.style.height = Math.min(Math.max(sh, 34), 200) + 'px';
  } else {
    el.input.style.removeProperty('height');
  }
}

export function syncSend() {
  const hasContent = !!(el.input && el.input.value.trim()) || state.pendingAttachments.length > 0;
  if (el.send) el.send.disabled = state.busy || !hasContent || !state.model;
  if (!state.busy) {
    flushPendingUpdate();
  }
}

export function hasVision(m) {
  if (!m) return false;
  if (Array.isArray(m.input_modalities)) {
    return m.input_modalities.indexOf('image') !== -1;
  }
  if (m.capabilities && m.capabilities.vision) return true;
  const id = (m.id || '').toLowerCase();
  return /gpt-4o|claude-3|gemini|vl|vision|qwen.*vl|yi-vl|pixtral|llava|glm-4v/i.test(id);
}

export function hasImageGen(m) {
  if (!m) return false;
  if (Array.isArray(m.output_modalities) && m.output_modalities.includes('image')) return true;
  if (Array.isArray(m.outputModalities) && m.outputModalities.includes('image')) return true;
  if (m.capabilities && (m.capabilities.image_generation || m.capabilities.image_output)) return true;
  const id = (m.id || m.name || '').toLowerCase();
  return /dall-e|imagen|stable-diffusion|flux|midjourney|recraft|gpt-image|kling|seedream|hy-image|glm-image|agnes-image|-image\b|image-|\/image\b/i.test(id);
}

function isFree(m) {
  const p = m.pricings || {};
  function zero(arr) {
    if (!arr || !arr.length) return false;
    for (let i = 0; i < arr.length; i++) if (Number(arr[i].value) !== 0) return false;
    return true;
  }
  return zero(p.prompt) && zero(p.completion);
}

export function fillModels(list) {
  if (!el.model) return;
  el.model.innerHTML = '';
  state.modelMeta = {};
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = list.length ? '选择模型…' : '无可用模型';
  el.model.appendChild(ph);

  const imageModels = [];
  const textGroups = {};
  const seen = new Set();

  list.forEach((m) => {
    const id = m.id || m.name;
    if (!id || seen.has(id)) return;
    seen.add(id);
    state.modelMeta[id] = m;

    if (hasImageGen(m)) {
      imageModels.push(m);
    } else {
      const g = m.owned_by || '其他';
      (textGroups[g] = textGroups[g] || []).push(m);
    }
  });

  // 1. 独立专区：图像生成专区（置顶呈现，不与文本模型混杂）
  if (imageModels.length > 0) {
    const imgGroup = document.createElement('optgroup');
    imgGroup.label = '图像生成 (Image Generation)';

    // 依展示名称或 ID 进行自然排序
    imageModels.sort((a, b) => (a.display_name || a.id).localeCompare(b.display_name || b.id));

    imageModels.forEach((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      // 呈现精炼、高可读性的标签，统一附带 ·生图 标牌与免费状态
      let label = m.display_name || m.id;
      label += ' ·生图';
      if (isFree(m)) label += ' ·免费';
      o.textContent = label;
      imgGroup.appendChild(o);
    });
    el.model.appendChild(imgGroup);
  }

  // 2. 文本对话模型专区（按厂商分别归集）
  Object.keys(textGroups).sort().forEach((g) => {
    const og = document.createElement('optgroup');
    og.label = g;
    textGroups[g].forEach((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      let label = m.display_name || m.id;
      if (hasVision(m)) label += ' ·视觉';
      if (m.capabilities && m.capabilities.reasoning) label += ' ·推理';
      if (isFree(m)) label += ' ·免费';
      o.textContent = label;
      og.appendChild(o);
    });
    el.model.appendChild(og);
  });

  // 3. 构建高可读性、全定制的 ModelPicker 自定义弹出面板
  renderCustomModelPicker(imageModels, textGroups);
}

function createModelPickerItem(m, isImage = false) {
  const item = document.createElement('div');
  item.className = 'model-picker-item';
  item.setAttribute('role', 'option');
  item.setAttribute('data-id', m.id);
  item.setAttribute('tabindex', '0');

  const left = document.createElement('div');
  left.className = 'model-item-left';

  const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkSvg.setAttribute('class', 'model-item-check');
  checkSvg.setAttribute('viewBox', '0 0 24 24');
  checkSvg.setAttribute('fill', 'none');
  checkSvg.setAttribute('stroke', 'currentColor');
  checkSvg.setAttribute('stroke-width', '2.5');
  checkSvg.setAttribute('stroke-linecap', 'round');
  checkSvg.setAttribute('stroke-linejoin', 'round');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '20 6 9 17 4 12');
  checkSvg.appendChild(polyline);

  const name = document.createElement('span');
  name.className = 'model-item-name';
  name.textContent = m.display_name || m.id;
  name.title = m.id;

  left.appendChild(checkSvg);
  left.appendChild(name);

  const badges = document.createElement('div');
  badges.className = 'model-item-badges';

  if (isImage || hasImageGen(m)) {
    const pill = document.createElement('span');
    pill.className = 'model-pill model-pill-image';
    pill.textContent = '生图';
    badges.appendChild(pill);
  } else {
    if (hasVision(m)) {
      const pill = document.createElement('span');
      pill.className = 'model-pill model-pill-vision';
      pill.textContent = '视觉';
      badges.appendChild(pill);
    }
    if (m.capabilities && m.capabilities.reasoning) {
      const pill = document.createElement('span');
      pill.className = 'model-pill model-pill-reasoning';
      pill.textContent = '推理';
      badges.appendChild(pill);
    }
  }

  if (isFree(m)) {
    const pill = document.createElement('span');
    pill.className = 'model-pill model-pill-free';
    pill.textContent = '免费';
    badges.appendChild(pill);
  }

  item.appendChild(left);
  item.appendChild(badges);

  item.addEventListener('click', () => {
    selectModel(m.id);
  });
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectModel(m.id);
    }
  });

  return item;
}

function createModelGroupSection(title, models, isImage = false) {
  const section = document.createElement('div');
  section.className = 'model-group-section';
  section.setAttribute('data-group', title.toLowerCase());

  const header = document.createElement('div');
  header.className = 'model-group-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'model-group-title';
  titleSpan.textContent = title;

  const countSpan = document.createElement('span');
  countSpan.className = 'model-group-count';
  countSpan.textContent = String(models.length);

  header.appendChild(titleSpan);
  header.appendChild(countSpan);
  section.appendChild(header);

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'model-group-options';

  models.forEach((m) => {
    optionsContainer.appendChild(createModelPickerItem(m, isImage));
  });

  section.appendChild(optionsContainer);
  return section;
}

export function renderCustomModelPicker(imageModels, textGroups) {
  if (!el.modelPickerList) return;
  el.modelPickerList.innerHTML = '';

  if (imageModels.length > 0) {
    const sec = createModelGroupSection('图像生成 (Image Generation)', imageModels, true);
    el.modelPickerList.appendChild(sec);
  }

  Object.keys(textGroups).sort().forEach((g) => {
    const groupModels = textGroups[g];
    const sec = createModelGroupSection(g, groupModels, false);
    el.modelPickerList.appendChild(sec);
  });

  syncModelPickerUI();
}

export function selectModel(id) {
  if (!id) return;
  state.model = id.trim();
  if (el.model) {
    el.model.value = state.model;
    el.model.dispatchEvent(new Event('change'));
  }
  syncModelPickerUI();
  closeModelPicker();
}

export function syncModelPickerUI() {
  const currentId = state.model;
  const meta = state.modelMeta[currentId];
  let labelText = currentId;
  if (meta && meta.display_name) {
    labelText = meta.display_name;
  } else if (!currentId) {
    labelText = '选择模型…';
  }

  if (el.modelPickerLabel) {
    el.modelPickerLabel.textContent = labelText;
    el.modelPickerLabel.title = currentId || '';
  }

  if (el.modelPickerList) {
    const items = el.modelPickerList.querySelectorAll('.model-picker-item');
    items.forEach((item) => {
      const match = item.getAttribute('data-id') === currentId;
      item.classList.toggle('active', match);
      item.setAttribute('aria-selected', match ? 'true' : 'false');
    });
  }
}

export function openModelPicker() {
  if (!el.modelPickerWrap) return;
  closeAllParamPickers();
  el.modelPickerWrap.classList.add('open');
  if (el.modelPickerBtn) el.modelPickerBtn.setAttribute('aria-expanded', 'true');
  if (el.modelSearchInput) {
    el.modelSearchInput.value = '';
    filterModelPicker('');
    // Focus search input exclusively on desktop to prevent mobile virtual keyboard surge
    if (window.innerWidth > 768) {
      setTimeout(() => {
        if (el.modelSearchInput) el.modelSearchInput.focus();
      }, 60);
    }
  }
  const activeItem = el.modelPickerList ? el.modelPickerList.querySelector('.model-picker-item.active') : null;
  if (activeItem && el.modelPickerList) {
    // Scroll active item into view strictly inside the picker container without shifting window viewport
    const listRect = el.modelPickerList.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const offsetDiff = itemRect.top - listRect.top;
    el.modelPickerList.scrollTop += (offsetDiff - (listRect.height / 2) + (itemRect.height / 2));
  }
}

export function closeModelPicker() {
  if (!el.modelPickerWrap) return;
  el.modelPickerWrap.classList.remove('open');
  if (el.modelPickerBtn) el.modelPickerBtn.setAttribute('aria-expanded', 'false');
}

export function toggleModelPicker() {
  if (!el.modelPickerWrap) return;
  if (el.modelPickerWrap.classList.contains('open')) {
    closeModelPicker();
  } else {
    openModelPicker();
  }
}

export function filterModelPicker(query) {
  if (!el.modelPickerList) return;
  const q = (query || '').trim().toLowerCase();

  if (el.modelSearchClear) {
    el.modelSearchClear.classList.toggle('hide', !q);
  }

  const sections = el.modelPickerList.querySelectorAll('.model-group-section');
  let totalVisible = 0;

  sections.forEach((sec) => {
    const items = sec.querySelectorAll('.model-picker-item');
    let sectionVisibleCount = 0;
    const groupName = sec.getAttribute('data-group') || '';

    items.forEach((item) => {
      const id = (item.getAttribute('data-id') || '').toLowerCase();
      const name = (item.querySelector('.model-item-name')?.textContent || '').toLowerCase();
      const match = !q || id.includes(q) || name.includes(q) || groupName.includes(q);
      item.style.display = match ? 'flex' : 'none';
      if (match) {
        sectionVisibleCount++;
        totalVisible++;
      }
    });

    sec.style.display = sectionVisibleCount > 0 ? 'flex' : 'none';
  });

  let emptyEl = el.modelPickerList.querySelector('.model-picker-empty');
  if (totalVisible === 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'model-picker-empty';
      emptyEl.textContent = '未找到匹配的模型';
      el.modelPickerList.appendChild(emptyEl);
    }
    emptyEl.style.display = 'block';
  } else if (emptyEl) {
    emptyEl.style.display = 'none';
  }
}

export function syncEffort() {
  if (!el.effort) return;
  const m = state.modelMeta[state.model];
  const can = !!(m && m.capabilities && m.capabilities.reasoning);
  const unknown = !m;
  el.effort.disabled = !can && !unknown;
  el.effort.title = can
    ? '推理强度：ZenMux 不传此参数时默认 medium'
    : (unknown ? '推理强度（模型信息载入中）' : '当前模型不支持推理');
  syncParamPicker(el.effort);
}

export function syncWorkstationMode(isImgGen, meta) {
  state.isImageMode = !!isImgGen;
  closeAllParamPickers();

  if (el.chatParamsGroup) {
    if (isImgGen) el.chatParamsGroup.classList.add('hide');
    else el.chatParamsGroup.classList.remove('hide');
  }

  if (el.imageParamsGroup) {
    if (isImgGen) el.imageParamsGroup.classList.remove('hide');
    else el.imageParamsGroup.classList.add('hide');
  }

  if (el.pluginsBtn) {
    el.pluginsBtn.style.display = isImgGen ? 'none' : '';
  }

  if (el.attachBtn) {
    el.attachBtn.style.display = isImgGen ? 'none' : '';
  }

  if (el.input) {
    el.input.placeholder = isImgGen
      ? '描述你想生成的画面 (Prompt)，Enter 开始绘制…'
      : '发消息或粘贴/拖拽文件、图片，Enter 发送，Shift+Enter 换行';
  }

  if (el.send) {
    el.send.title = isImgGen ? '开始生图 (Enter)' : '发送';
  }
}

export function syncModelCapabilities() {
  const meta = state.modelMeta[state.model];
  const isImgGen = hasImageGen(meta);
  syncEffort();
  syncWorkstationMode(isImgGen, meta);
  syncModelPickerUI();
}

export function loadModels() {
  return fetch('/api/models', { headers: { 'X-Access-Token': state.token } })
    .then((r) => {
      if (r.status === 401) {
        showGate('访问口令已失效或已被停用，请重新输入');
        throw new Error('口令不正确');
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((j) => {
      const list = (j && j.data) || [];
      if (!list.length) throw new Error('模型列表为空');
      fillModels(list);
      const ids = list.map((m) => m.id);
      if (!state.model || ids.indexOf(state.model) === -1) {
        state.model = list[0].id;
      }
      el.model.value = state.model;
      localStorage.setItem(LS.model, state.model);
      syncModelCapabilities();
      renderThread();
    })
    .catch((e) => {
      if (e.message !== '口令不正确') {
        toast(`模型列表拉取失败：${e.message}（可手动输入/选择）`, 'error');
      }
    });
}

export function syncPluginsUI() {
  const count = PluginRegistry.getActiveCount();
  if (el.pluginsBadge) el.pluginsBadge.textContent = String(count);
  if (el.pluginsBtn) {
    if (count > 0) {
      el.pluginsBtn.classList.add('active');
      el.pluginsBtn.title = `扩展插件与工具（已激活 ${count} 个插件，点击配置）`;
    } else {
      el.pluginsBtn.classList.remove('active');
      el.pluginsBtn.title = '扩展插件与工具（当前未开启任何插件，点击配置）';
    }
  }
  const summaryEl = document.getElementById('plugins-active-summary');
  if (summaryEl) {
    summaryEl.textContent = count > 0 ? `已启用 ${count} 个插件` : '当前未启用任何插件';
  }
}

export function renderPluginsModalList() {
  if (!el.pluginsList) return;
  const all = PluginRegistry.getAll();
  el.pluginsList.innerHTML = '';

  all.forEach((plugin) => {
    const isChecked = PluginRegistry.isEnabled(plugin.id);
    const card = document.createElement('div');
    card.className = `plugin-card ${isChecked ? 'active' : ''}`;
    card.innerHTML = `
      <div class="plugin-card-left">
        <div class="plugin-icon-box">${plugin.icon}</div>
        <div class="plugin-info">
          <div class="plugin-title-row">
            <span class="plugin-name">${esc(plugin.name)}</span>
            <span class="plugin-provider">${esc(plugin.provider || '')}</span>
          </div>
          <div class="plugin-desc">${esc(plugin.description || '')}</div>
        </div>
      </div>
      <label class="plugin-switch" title="开启/关闭此插件">
        <input type="checkbox" data-plugin-id="${plugin.id}" ${isChecked ? 'checked' : ''}>
        <span class="plugin-switch-slider"></span>
      </label>
    `;

    const checkbox = card.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        PluginRegistry.toggle(plugin.id, e.target.checked);
        if (e.target.checked) card.classList.add('active');
        else card.classList.remove('active');
        syncPluginsUI();
      });
    }

    el.pluginsList.appendChild(card);
  });

  syncPluginsUI();
}

export function syncModalOpenState() {
  const isOpen = !!document.querySelector('.modal-backdrop:not(.hide)');
  document.body.classList.toggle('has-modal-open', isOpen);
}

export function openPluginsModal() {
  renderPluginsModalList();
  if (el.pluginsModalBackdrop) el.pluginsModalBackdrop.classList.remove('hide');
  syncModalOpenState();
}

export function closePluginsModal() {
  if (el.pluginsModalBackdrop) el.pluginsModalBackdrop.classList.add('hide');
  syncModalOpenState();
}

export function updateSettingsCharCount() {
  if (el.settingsInstructions && el.settingsCharCount) {
    el.settingsCharCount.textContent = `${el.settingsInstructions.value.length} 字符`;
  }
}

export function renderMemoryManagerUI() {
  if (!el.settingsMemoryList) return;
  if (el.settingsMemoryToggle) {
    el.settingsMemoryToggle.checked = state.memoryEnabled !== false;
  }

  const list = MemoryStore.getAll();
  state.memories = list;

  if (el.settingsMemoryCount) {
    el.settingsMemoryCount.textContent = `已记住 ${list.length} 条内容 (上限 ${MAX_MEMORY_ITEMS} 条)`;
  }

  el.settingsMemoryList.innerHTML = '';
  if (list.length === 0) {
    el.settingsMemoryList.innerHTML = '<div class="memory-empty-state">暂无存储的长期记忆。可在对话中告诉 AI“记住...”或在上方手动添加。</div>';
    return;
  }

  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'memory-item';

    function renderViewMode() {
      row.innerHTML = `
        <span class="memory-item-content" title="点击直接修改">${esc(item.content)}</span>
        <div class="memory-actions">
          <button type="button" class="memory-edit-btn" title="修改该条记忆">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button type="button" class="memory-del-btn" title="删除该条记忆">×</button>
        </div>
      `;

      const contentSpan = row.querySelector('.memory-item-content');
      const editBtn = row.querySelector('.memory-edit-btn');
      const delBtn = row.querySelector('.memory-del-btn');

      if (contentSpan) contentSpan.addEventListener('click', renderEditMode);
      if (editBtn) editBtn.addEventListener('click', renderEditMode);
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          MemoryStore.delete(item.id);
          renderMemoryManagerUI();
          toast('已删除该条记忆', 'info');
        });
      }
    }

    function renderEditMode() {
      row.innerHTML = `
        <form class="memory-edit-form">
          <input type="text" class="memory-edit-input" value="${esc(item.content)}" />
          <button type="submit" class="memory-edit-save-btn">保存</button>
          <button type="button" class="memory-edit-cancel-btn">取消</button>
        </form>
      `;

      const form = row.querySelector('.memory-edit-form');
      const input = row.querySelector('.memory-edit-input');
      const cancelBtn = row.querySelector('.memory-edit-cancel-btn');

      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }

      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const newVal = input ? input.value.trim() : '';
          if (!newVal) {
            toast('记忆内容不能为空，若需删除请点击右侧删除按钮', 'info');
            renderViewMode();
            return;
          }
          if (newVal !== item.content) {
            MemoryStore.update(item.id, newVal);
            toast('已更新记忆内容', 'info');
            renderMemoryManagerUI();
          } else {
            renderViewMode();
          }
        });
      }

      if (cancelBtn) {
        cancelBtn.addEventListener('click', renderViewMode);
      }
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            renderViewMode();
          }
        });
      }
    }

    renderViewMode();
    el.settingsMemoryList.appendChild(row);
  });
}

export function renderSettingsState() {
  if (el.settingsInstructions) {
    el.settingsInstructions.value = state.instructions || '';
  }
  if (el.settingsInstructionsToggle) {
    el.settingsInstructionsToggle.checked = !!state.instructionsEnabled;
  }
  if (el.settingsAsrModel) {
    el.settingsAsrModel.value = state.asrModel || 'bytedance/doubao-seed-asr-2.0';
  }
  updateSettingsCharCount();
  syncThemePillsUI(state.themeMode);
  renderMemoryManagerUI();
}

export function openSettingsModal() {
  renderSettingsState();
  if (el.settingsModalBackdrop) el.settingsModalBackdrop.classList.remove('hide');
  syncModalOpenState();
}

export function closeSettingsModal() {
  if (el.settingsModalBackdrop) el.settingsModalBackdrop.classList.add('hide');
  syncModalOpenState();
}

export function saveSettings() {
  const text = (el.settingsInstructions ? el.settingsInstructions.value : '').trim();
  const enabled = el.settingsInstructionsToggle ? el.settingsInstructionsToggle.checked : true;
  const memoryEnabled = el.settingsMemoryToggle ? el.settingsMemoryToggle.checked : true;
  const asrModel = (el.settingsAsrModel ? el.settingsAsrModel.value : '') || 'bytedance/doubao-seed-asr-2.0';

  state.instructions = text;
  state.instructionsEnabled = enabled;
  state.memoryEnabled = memoryEnabled;
  state.asrModel = asrModel;

  localStorage.setItem(LS.instructions, text);
  localStorage.setItem(LS.instructionsEnabled, String(enabled));
  localStorage.setItem(LS.memoryEnabled, String(memoryEnabled));
  localStorage.setItem(LS.asrModel, asrModel);

  closeSettingsModal();
  toast('偏好设置已保存并应用', 'info');
}

export function renderAttachments() {
  if (!el.attachmentsTray) return;
  renderAttachmentsTray(
    state.pendingAttachments,
    el.attachmentsTray,
    (idx) => {
      state.pendingAttachments.splice(idx, 1);
      renderAttachments();
      syncSend();
    },
    (src) => openLightbox(src)
  );
}

export function handleIncomingFiles(fileList) {
  const m = state.modelMeta[state.model];
  const canVision = hasVision(m);
  processIncomingFiles(fileList, state.pendingAttachments, canVision, toast).then((newItems) => {
    if (newItems && newItems.length) {
      state.pendingAttachments.push(...newItems);
      renderAttachments();
      syncSend();
      if (el.input) el.input.focus();
    }
  });
}

export function renderConvList() {
  if (!el.convList) return;
  el.convList.innerHTML = '';
  state.conversations.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'conv' + (c.id === state.currentId ? ' active' : '');

    let isEditing = false;

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = c.title || '新对话';
    txt.title = '双击可修改标题';

    const actions = document.createElement('span');
    actions.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'conv-btn edit';
    editBtn.title = '重命名';
    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

    const delBtn = document.createElement('button');
    delBtn.className = 'conv-btn del';
    delBtn.title = '删除对话';
    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

    function startEdit() {
      if (isEditing || state.busy) return;
      isEditing = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'conv-edit-input';
      input.value = c.title || '';

      function commitEdit() {
        if (!isEditing) return;
        isEditing = false;
        const val = input.value.trim();
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

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      input.addEventListener('blur', commitEdit);
      input.addEventListener('click', (e) => e.stopPropagation());

      row.innerHTML = '';
      row.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 20);
    }

    editBtn.addEventListener('click', (e) => { e.stopPropagation(); startEdit(); });
    txt.addEventListener('dblclick', (e) => { e.stopPropagation(); startEdit(); });

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.busy) return;
      const titleToDel = c.title || '此对话';
      if (!window.confirm(`确定要删除对话「${titleToDel}」吗？此操作不可撤销。`)) return;
      ZenMuxDB.deleteConversation(c.id).then(() => {
        state.conversations = state.conversations.filter((x) => x.id !== c.id);
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
      }).catch((err) => {
        toast(`删除失败: ${err.message}`, 'error');
      });
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(txt);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      if (state.busy || state.currentId === c.id || isEditing) return;
      state.currentId = c.id;
      state.currentConv = c;
      localStorage.setItem(LS.cur, c.id);
      renderConvList();
      renderThread();
      if (isMobileScreen()) closeSidebar();
    });
    el.convList.appendChild(row);
  });
}

export function createNewConversation() {
  const c = {
    id: uid(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return ZenMuxDB.putConversation(c).then(() => {
    state.conversations.unshift(c);
    state.currentId = c.id;
    state.currentConv = c;
    localStorage.setItem(LS.cur, c.id);
    renderConvList();
    renderThread();
    return c;
  });
}

export function loadAllConversations() {
  return ZenMuxDB.getAllConversations().then((list) => {
    state.conversations = list;
    if (!list.length) {
      return createNewConversation();
    }
    const found = list.find((c) => c.id === state.currentId);
    if (!found) {
      state.currentId = list[0].id;
      state.currentConv = list[0];
    } else {
      state.currentConv = found;
    }
    localStorage.setItem(LS.cur, state.currentId);
    renderConvList();
    renderThread();
  }).catch((err) => {
    toast(`读取 IndexedDB 会话失败: ${err.message}`, 'error');
  });
}

export function regenerateFrom(asstIndex) {
  const c = state.currentConv;
  if (!c || !c.messages || state.busy) return;

  let userIndex = asstIndex - 1;
  while (userIndex >= 0 && c.messages[userIndex].role !== 'user') {
    userIndex--;
  }
  if (userIndex < 0) {
    toast('未找到上一轮提问', 'info');
    return;
  }

  const userMsg = c.messages[userIndex];
  c.messages = c.messages.slice(0, userIndex + 1);
  ZenMuxDB.putConversation(c).then(() => {
    renderThread();
    executeAssistantStream(userMsg, {
      onUpdateConvList: renderConvList,
      onRegenerate: regenerateFrom,
      onSyncSend: syncSend,
    });
  });
}

export function renderThread() {
  const c = state.currentConv;
  if (!el.threadInner) return;
  el.threadInner.innerHTML = '';

  if (!c || !c.messages || !c.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <span>${state.model ? '开始一段对话，支持拖拽代码文件、数据表格与图片分析' : '请先在上方选择模型'}</span>
    `;
    el.threadInner.appendChild(empty);
    updateSidebarFooter();
    return;
  }

  c.messages.forEach((m, idx) => {
    const imgMeta = m.type === 'image' ? {
      imageId: m.imageId,
      revisedPrompt: m.revisedPrompt,
      size: m.size,
      quality: m.quality,
      url: m.url,
    } : null;

    el.threadInner.appendChild(
      bubble(m.role, m.content, m.images, m.reasoning, m.files, m.displayContent, m.sources, m.usage, m.model, idx, regenerateFrom, imgMeta)
    );
  });
  updateSidebarFooter();
  if (el.thread) el.thread.scrollTop = el.thread.scrollHeight;
}

export function send() {
  const text = (el.input ? el.input.value : '').trim();
  const atts = state.pendingAttachments.slice();
  if ((!text && !atts.length) || state.busy) return;
  if (!state.model) {
    toast('请先选择模型', 'info');
    if (el.modelPickerBtn) {
      el.modelPickerBtn.focus();
      openModelPicker();
    } else if (el.model) {
      el.model.focus();
    }
    return;
  }

  const images = atts.filter((a) => a.type === 'image');
  const files = atts.filter((a) => a.type === 'file');

  const meta = state.modelMeta[state.model];
  if (images.length && meta && !hasVision(meta)) {
    toast('当前模型不支持图片输入，请切换至支持视觉的模型', 'info');
    return;
  }

  const c = state.currentConv;
  if (!c) return;

  const first = c.messages.length === 0;

  if (el.input) el.input.value = '';
  state.pendingAttachments = [];
  renderAttachments();
  autoGrow();
  syncSend();

  const emptyNode = el.threadInner ? el.threadInner.querySelector('.empty') : null;
  if (emptyNode && emptyNode.parentNode) {
    emptyNode.parentNode.removeChild(emptyNode);
  }

  let fullPrompt = text;
  if (files.length) {
    const fileContextBlocks = files.map((f) => {
      const lang = f.ext || 'text';
      return `--- 附件文件: ${f.name} (${formatSize(f.size)}${f.lines ? `, ${f.lines}行` : ''}) ---\n\`\`\`${lang}\n${f.text}\n\`\`\`\n--- 附件结束 ---`;
    }).join('\n\n');

    fullPrompt = fileContextBlocks + (text ? '\n\n' + text : '\n\n请分析以上文件内容。');
  }

  if (first && !c.customTitle) {
    c.title = TitleExtractor.cleanUserPrompt(text, files, images);
    c.autoTitled = true;
  }

  const userMsg = {
    id: uid(),
    role: 'user',
    content: fullPrompt,
    displayContent: text,
    images: images.length ? images : undefined,
    files: files.length ? files : undefined,
    createdAt: Date.now()
  };
  c.messages.push(userMsg);
  c.updatedAt = Date.now();

  ZenMuxDB.putConversation(c).then(() => {
    renderConvList();
  });

  if (el.threadInner) {
    el.threadInner.appendChild(bubble('user', fullPrompt, images, '', files, text, null, null, null, c.messages.length - 1, regenerateFrom));
  }

  if (hasImageGen(meta)) {
    executeImageGeneration(userMsg, {
      onUpdateConvList: renderConvList,
      onRegenerate: regenerateFrom,
      onSyncSend: syncSend,
    });
  } else {
    executeAssistantStream(userMsg, {
      onUpdateConvList: renderConvList,
      onRegenerate: regenerateFrom,
      onSyncSend: syncSend,
    });
  }
}

export function showGate(err = '', isLoading = false) {
  document.body.classList.add('is-gated');
  if (el.gate) {
    el.gate.classList.remove('hide', 'dissolve');
  }
  if (el.gateErr) {
    el.gateErr.textContent = err || '';
    el.gateErr.className = isLoading ? 'gate-loading' : '';
  }
  if (el.gateGo) {
    el.gateGo.disabled = isLoading;
    el.gateGo.textContent = isLoading ? '正在验证…' : '验证并进入';
  }
  if (!isLoading && el.gateInput) {
    setTimeout(() => { if (el.gateInput) el.gateInput.focus(); }, 40);
  }
}

export function hideGate() {
  document.body.classList.remove('is-gated');
  if (el.gate) {
    el.gate.classList.add('hide');
    el.gate.classList.remove('dissolve');
  }
  requestAnimationFrame(() => {
    autoGrow();
  });
}

export function dissipateGate() {
  document.body.classList.remove('is-gated');
  if (el.gate) {
    el.gate.classList.add('dissolve');
    setTimeout(() => {
      el.gate.classList.add('hide');
      el.gate.classList.remove('dissolve');
    }, 400);
  }
  requestAnimationFrame(() => {
    autoGrow();
  });
}

async function unlockAndHydrateWorkspace(modelsList) {
  dissipateGate();
  await loadAllConversations();
  if (modelsList && modelsList.length) {
    fillModels(modelsList);
    const ids = modelsList.map((m) => m.id);
    if (!state.model || ids.indexOf(state.model) === -1) {
      state.model = modelsList[0].id;
    }
    if (el.model) el.model.value = state.model;
    localStorage.setItem(LS.model, state.model);
    syncModelCapabilities();
  }
  syncPluginsUI();
  renderThread();
  syncSend();
  requestAnimationFrame(() => {
    autoGrow();
    if (el.input && !isMobileScreen()) {
      el.input.focus();
    }
  });
}

export async function submitGate() {
  if (!el.gateInput) return;
  const v = el.gateInput.value.trim();
  if (!v) {
    showGate('请输入访问口令');
    return;
  }
  showGate('正在验证身份凭据…', true);

  try {
    const res = await fetch('/api/models', { headers: { 'X-Access-Token': v } });
    if (res.status === 401) throw new Error('访问口令无效或已被管理员停用');
    if (!res.ok) throw new Error(`服务端异常 (HTTP ${res.status})`);
    const data = await res.json();
    const modelsList = (data && data.data) || [];

    state.token = v;
    localStorage.setItem(LS.token, v);
    localStorage.setItem(LS.gated, '1');

    await unlockAndHydrateWorkspace(modelsList);
  } catch (err) {
    showGate(err.message || String(err));
  }
}

function initVoiceInput() {
  let recorder = null;

  function updateVoiceBtnUI(status) {
    if (!el.voiceBtn) return;
    el.voiceBtn.classList.remove('recording', 'transcribing');
    if (status === 'listening') {
      el.voiceBtn.classList.add('recording');
      el.voiceBtn.title = '正在聆听 (端侧 VAD 智能降噪生效中)… 点击直接结束并识别';
    } else if (status === 'transcribing') {
      el.voiceBtn.classList.add('transcribing');
      el.voiceBtn.title = '正在云端高精度 ASR 识别中…';
    } else {
      el.voiceBtn.title = '语音输入（VAD 智能切除静音，云端大模型高精度识别）';
    }
  }

  function ensureRecorder() {
    if (!recorder) {
      recorder = new AudioRecorder({
        onStateChange: (recState) => {
          updateVoiceBtnUI(recState);
        },
        onTranscript: (text) => {
          if (el.input && text) {
            const cur = el.input.value.trim();
            el.input.value = (cur ? cur + ' ' : '') + text;
            autoGrow();
            syncSend();
          }
          toast('语音识别完成', 'info');
        },
        onError: (err) => {
          toast(err, 'error');
        }
      });
    }
    return recorder;
  }

  if (el.voiceBtn) {
    el.voiceBtn.addEventListener('click', async () => {
      const rec = ensureRecorder();
      if (rec.state === 'listening') {
        rec.stop();
      } else if (rec.state === 'idle') {
        toast('正在启动麦克风 (VAD 智能降噪已生效)…', 'info');
        await rec.start();
      }
    });
  }
}

/* ---------- Global Event Listeners Registration ---------- */
function initEventListeners() {
  if (el.input) {
    el.input.addEventListener('input', () => { autoGrow(); syncSend(); });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
  }

  if (el.send) el.send.addEventListener('click', send);
  if (el.stop) el.stop.addEventListener('click', () => {
    if (state.controller) state.controller.abort();
  });

  if (el.thread) {
    el.thread.addEventListener('click', (e) => {
      const img = e.target.closest('.chat-md-img, .body img');
      if (img && img.src) {
        openLightbox(img.src);
      }
    });
  }

  if (el.burger) el.burger.addEventListener('click', openSidebar);
  if (el.sidebarToggle) {
    el.sidebarToggle.addEventListener('click', toggleSidebar);
  }

  if (el.sidebarBackdrop) el.sidebarBackdrop.addEventListener('click', closeSidebar);
  if (el.newChat) el.newChat.addEventListener('click', () => {
    if (state.busy) return;
    createNewConversation();
    if (isMobileScreen()) closeSidebar();
  });

  if (el.logout) {
    el.logout.addEventListener('click', () => {
      localStorage.removeItem(LS.token);
      localStorage.removeItem(LS.gated);
      state.token = '';
      showGate('');
    });
  }

  if (el.modelPickerBtn) {
    el.modelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleModelPicker();
    });
  }

  if (el.modelPickerClose) {
    el.modelPickerClose.addEventListener('click', () => closeModelPicker());
  }

  if (el.modelPickerBackdrop) {
    el.modelPickerBackdrop.addEventListener('click', () => closeModelPicker());
  }

  if (el.modelSearchInput) {
    el.modelSearchInput.addEventListener('input', () => {
      filterModelPicker(el.modelSearchInput.value);
    });
    el.modelSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModelPicker();
        if (el.modelPickerBtn) el.modelPickerBtn.focus();
      }
    });
  }

  if (el.modelSearchClear) {
    el.modelSearchClear.addEventListener('click', () => {
      if (el.modelSearchInput) {
        el.modelSearchInput.value = '';
        filterModelPicker('');
        el.modelSearchInput.focus();
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (el.modelPickerWrap && el.modelPickerWrap.classList.contains('open')) {
      if (!el.modelPickerWrap.contains(e.target)) {
        closeModelPicker();
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.modelPickerWrap && el.modelPickerWrap.classList.contains('open')) {
      closeModelPicker();
      if (el.modelPickerBtn) el.modelPickerBtn.focus();
    }
  });

  if (el.model) {
    el.model.addEventListener('change', () => {
      state.model = el.model.value.trim();
      localStorage.setItem(LS.model, state.model);
      syncSend();
      syncModelCapabilities();
      renderThread();
    });
  }

  if (el.effort) {
    el.effort.addEventListener('change', () => {
      state.effort = el.effort.value;
      localStorage.setItem(LS.effort, state.effort);
    });
  }

  if (el.searchDepth) {
    el.searchDepth.addEventListener('change', () => {
      state.searchDepth = el.searchDepth.value;
      localStorage.setItem(LS.searchDepth, state.searchDepth);
    });
  }

  if (el.toolTurns) {
    el.toolTurns.addEventListener('change', () => {
      state.toolMaxTurns = parseInt(el.toolTurns.value, 10);
      if (isNaN(state.toolMaxTurns)) state.toolMaxTurns = 20;
      localStorage.setItem(LS.toolTurns, String(state.toolMaxTurns));
    });
  }

  if (el.ctx) {
    el.ctx.addEventListener('change', () => {
      state.ctxN = parseInt(el.ctx.value, 10);
      if (isNaN(state.ctxN)) state.ctxN = 20;
      localStorage.setItem(LS.ctx, String(state.ctxN));
    });
  }

  if (el.imageSize) {
    el.imageSize.value = state.imageSize;
    el.imageSize.addEventListener('change', () => {
      state.imageSize = el.imageSize.value;
      localStorage.setItem(LS.imageSize, state.imageSize);
    });
  }

  if (el.imageQuality) {
    el.imageQuality.value = state.imageQuality;
    el.imageQuality.addEventListener('change', () => {
      state.imageQuality = el.imageQuality.value;
      localStorage.setItem(LS.imageQuality, state.imageQuality);
    });
  }

  if (el.imageBackground) {
    el.imageBackground.value = state.imageBackground;
    el.imageBackground.addEventListener('change', () => {
      state.imageBackground = el.imageBackground.value;
      localStorage.setItem(LS.imageBackground, state.imageBackground);
    });
  }

  if (el.attachBtn && el.fileInput) {
    el.attachBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', () => {
      handleIncomingFiles(el.fileInput.files);
      el.fileInput.value = '';
    });
  }

  // Plugins Modal triggers
  if (el.pluginsBtn) el.pluginsBtn.addEventListener('click', openPluginsModal);
  if (el.pluginsClose) el.pluginsClose.addEventListener('click', closePluginsModal);
  if (el.pluginsModalBackdrop) {
    el.pluginsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === el.pluginsModalBackdrop) closePluginsModal();
    });
  }
  if (el.pluginsEnableAll) {
    el.pluginsEnableAll.addEventListener('click', () => {
      PluginRegistry.getAll().forEach((p) => PluginRegistry.toggle(p.id, true));
      renderPluginsModalList();
    });
  }
  if (el.pluginsDisableAll) {
    el.pluginsDisableAll.addEventListener('click', () => {
      PluginRegistry.getAll().forEach((p) => PluginRegistry.toggle(p.id, false));
      renderPluginsModalList();
    });
  }

  // Settings Modal triggers & actions
  if (el.settingsBtn) el.settingsBtn.addEventListener('click', openSettingsModal);
  if (el.settingsClose) el.settingsClose.addEventListener('click', closeSettingsModal);
  if (el.settingsModalBackdrop) {
    el.settingsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === el.settingsModalBackdrop) closeSettingsModal();
    });
  }
  if (el.settingsSaveBtn) el.settingsSaveBtn.addEventListener('click', saveSettings);
  if (el.settingsClearBtn) {
    el.settingsClearBtn.addEventListener('click', () => {
      if (el.settingsInstructions) {
        el.settingsInstructions.value = '';
        updateSettingsCharCount();
        el.settingsInstructions.focus();
      }
    });
  }
  if (el.settingsInstructions) {
    el.settingsInstructions.addEventListener('input', updateSettingsCharCount);
  }

  // Memory Manager triggers & actions
  if (el.settingsMemoryToggle) {
    el.settingsMemoryToggle.addEventListener('change', (e) => {
      state.memoryEnabled = e.target.checked;
      localStorage.setItem(LS.memoryEnabled, String(e.target.checked));
      toast(e.target.checked ? '已开启长程记忆功能' : '已关闭长程记忆功能', 'info');
    });
  }

  function handleManualAddMemory() {
    if (!el.settingsMemoryInput) return;
    const text = el.settingsMemoryInput.value.trim();
    if (!text) return;
    MemoryStore.add(text);
    el.settingsMemoryInput.value = '';
    renderMemoryManagerUI();
    toast('已添加新记忆', 'info');
  }

  if (el.settingsMemoryAddBtn) {
    el.settingsMemoryAddBtn.addEventListener('click', handleManualAddMemory);
  }
  if (el.settingsMemoryInput) {
    el.settingsMemoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleManualAddMemory();
      }
    });
  }

  if (el.settingsMemoryClearBtn) {
    el.settingsMemoryClearBtn.addEventListener('click', () => {
      const count = MemoryStore.getAll().length;
      if (count === 0) return;
      if (confirm(`确定要清空全部 ${count} 条长期记忆吗？此操作不可恢复。`)) {
        MemoryStore.clear();
        renderMemoryManagerUI();
        toast('已清空所有长期记忆', 'info');
      }
    });
  }

  // Cross-component live memory event listener
  window.addEventListener('zm:memory-updated', () => {
    renderMemoryManagerUI();
  });

  // Theme Pills in Settings Modal
  if (el.themePillDark) el.themePillDark.addEventListener('click', () => applyTheme('dark'));
  if (el.themePillLight) el.themePillLight.addEventListener('click', () => applyTheme('light'));
  if (el.themePillAuto) el.themePillAuto.addEventListener('click', () => applyTheme('auto'));

  // Prompt Preset Chips in Settings Modal
  document.querySelectorAll('.prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt') || '';
      if (el.settingsInstructions) {
        el.settingsInstructions.value = promptText;
        updateSettingsCharCount();
        if (el.settingsInstructionsToggle) el.settingsInstructionsToggle.checked = true;
        el.settingsInstructions.focus();
      }
    });
  });

  // Lightbox close listeners
  if (el.lightboxClose) el.lightboxClose.addEventListener('click', closeLightbox);
  if (el.lightbox) {
    el.lightbox.addEventListener('click', (e) => {
      if (e.target === el.lightbox || e.target === el.lightboxClose) closeLightbox();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.lightbox && !el.lightbox.classList.contains('hide')) closeLightbox();
      if (el.pluginsModalBackdrop && !el.pluginsModalBackdrop.classList.contains('hide')) closePluginsModal();
      if (el.settingsModalBackdrop && !el.settingsModalBackdrop.classList.contains('hide')) closeSettingsModal();
    }
  });

  // Clipboard paste listener
  window.addEventListener('paste', (e) => {
    if (!e.clipboardData || !e.clipboardData.items) return;
    const items = e.clipboardData.items;
    const pastedFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const blob = items[i].getAsFile();
        if (blob) pastedFiles.push(blob);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleIncomingFiles(pastedFiles);
    }
  });

  // Drag & drop file overlay
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (el.dropOverlay) el.dropOverlay.classList.add('active');
  });

  window.addEventListener('dragover', (e) => e.preventDefault());

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (el.dropOverlay) el.dropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (el.dropOverlay) el.dropOverlay.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files) {
      handleIncomingFiles(e.dataTransfer.files);
    }
  });

  // Gate form
  if (el.gateGo) el.gateGo.addEventListener('click', submitGate);
  if (el.gateInput) {
    el.gateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitGate(); }
    });
  }
}

/* ---------- Bootstrap Application Lifecycle ---------- */
export async function initApp() {
  document.querySelectorAll('.app-version-badge').forEach((badge) => {
    badge.textContent = 'v' + APP_VERSION;
  });

  initTheme(toast);
  initEventListeners();
  initSidebarResizer();
  initVersionChecker(toast);

  if (el.model) el.model.value = state.model;
  if (el.effort) el.effort.value = state.effort;
  if (el.searchDepth) el.searchDepth.value = state.searchDepth;
  if (el.toolTurns) el.toolTurns.value = String(state.toolMaxTurns);
  if (el.ctx) el.ctx.value = String(state.ctxN);
  if (el.imageSize) el.imageSize.value = state.imageSize;
  if (el.imageQuality) el.imageQuality.value = state.imageQuality;
  if (el.imageBackground) el.imageBackground.value = state.imageBackground;

  initParamPickers();

  initVoiceInput();
  autoGrow();

  const savedToken = state.token || (typeof localStorage !== 'undefined' ? localStorage.getItem(LS.token) : '');
  if (savedToken) {
    // 门禁前置验证：在未确认凭据有效前，彻底隐藏工作台与历史对话，杜绝任何内容泄漏
    showGate('正在验证身份凭据…', true);
    if (el.gateInput) el.gateInput.value = savedToken;

    try {
      const res = await fetch('/api/models', { headers: { 'X-Access-Token': savedToken } });
      if (res.status === 401) throw new Error('访问口令已失效或未授权，请重新输入');
      if (!res.ok) throw new Error(`服务端验证异常 (HTTP ${res.status})`);
      const data = await res.json();
      const modelsList = (data && data.data) || [];

      state.token = savedToken;
      localStorage.setItem(LS.token, savedToken);
      localStorage.setItem(LS.gated, '1');

      await unlockAndHydrateWorkspace(modelsList);
    } catch (err) {
      // 凭据无效或已失效：彻底清除无效凭据并停留在门禁主屏，严禁展示工作台
      state.token = '';
      localStorage.removeItem(LS.token);
      localStorage.removeItem(LS.gated);
      showGate(err.message || String(err));
    }
  } else {
    // 首次访问或已登出：前置拦截，工作台保持绝对隔离隐藏
    showGate('');
  }
}

// Kickstart
initApp();
