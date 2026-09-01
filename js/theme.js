// js/theme.js
// Dark mode and Anthropic Claude light mode switcher with system preference detection.

import { el, state, LS } from './state.js';

export function applyTheme(theme) {
  const isLight = theme === 'light';
  if (isLight) {
    document.documentElement.setAttribute('data-theme', 'light');
    if (el.themeIconSun) el.themeIconSun.style.display = 'none';
    if (el.themeIconMoon) el.themeIconMoon.style.display = 'block';
    if (el.themeToggle) el.themeToggle.title = '切换为深色外观';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (el.themeIconSun) el.themeIconSun.style.display = 'block';
    if (el.themeIconMoon) el.themeIconMoon.style.display = 'none';
    if (el.themeToggle) el.themeToggle.title = '切换为浅色外观';
  }
  state.theme = isLight ? 'light' : 'dark';
  localStorage.setItem(LS.theme, state.theme);
}

export function initTheme(onToast) {
  let savedTheme = localStorage.getItem(LS.theme);
  if (!savedTheme) {
    savedTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  applyTheme(savedTheme);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (!localStorage.getItem(LS.theme)) {
        applyTheme(e.matches ? 'light' : 'dark');
      }
    });
  }

  if (el.themeToggle) {
    el.themeToggle.addEventListener('click', () => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      if (onToast) {
        onToast(nextTheme === 'light' ? '已切换至浅色模式' : '已切换至深色模式', 'info');
      }
    });
  }
}
