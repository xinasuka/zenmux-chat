// js/theme.js
// Dark mode, Anthropic Claude paper light mode, and System Auto mode with live preference detection.

import { el, state, LS } from './state.js';

export function getSystemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}

export function syncThemePillsUI(mode) {
  const pills = [
    { el: el.themePillDark || document.getElementById('theme-pill-dark'), mode: 'dark' },
    { el: el.themePillLight || document.getElementById('theme-pill-light'), mode: 'light' },
    { el: el.themePillAuto || document.getElementById('theme-pill-auto'), mode: 'auto' },
  ];

  pills.forEach(({ el: pill, mode: m }) => {
    if (pill) {
      if (m === mode) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  });
}

export function applyTheme(mode) {
  const validMode = (mode === 'light' || mode === 'dark' || mode === 'auto') ? mode : 'auto';
  const effectiveTheme = (validMode === 'auto') ? getSystemTheme() : validMode;
  const isLight = effectiveTheme === 'light';

  if (isLight) {
    document.documentElement.setAttribute('data-theme', 'light');
    if (el.themeIconSun) el.themeIconSun.style.display = 'none';
    if (el.themeIconMoon) el.themeIconMoon.style.display = 'block';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (el.themeIconSun) el.themeIconSun.style.display = 'block';
    if (el.themeIconMoon) el.themeIconMoon.style.display = 'none';
  }

  state.themeMode = validMode;
  state.theme = effectiveTheme;
  localStorage.setItem(LS.themeMode, validMode);
  localStorage.setItem(LS.theme, effectiveTheme);

  syncThemePillsUI(validMode);
}

export function initTheme(onToast) {
  let savedMode = localStorage.getItem(LS.themeMode);
  if (!savedMode) {
    const legacyTheme = localStorage.getItem(LS.theme);
    savedMode = legacyTheme ? legacyTheme : 'auto';
  }

  applyTheme(savedMode);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (state.themeMode === 'auto') {
        applyTheme('auto');
      }
    });
  }

  if (el.themeToggle) {
    el.themeToggle.addEventListener('click', () => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      if (onToast) {
        onToast(nextTheme === 'light' ? '已切换至浅色外观' : '已切换至深色外观', 'info');
      }
    });
  }
}

