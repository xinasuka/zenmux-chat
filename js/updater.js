// js/updater.js
// Single Page Application (SPA) version update detection, zero-cache polling,
// Page Visibility API event integration, and non-intrusive notification manager.

import { el, state, LS, APP_VERSION } from './state.js';

const THROTTLE_MS = 5 * 60 * 1000;      // 5 minutes throttle between visibility checks
const INTERVAL_MS = 30 * 60 * 1000;     // 30 minutes periodic active polling
const SNOOZE_MS = 2 * 60 * 60 * 1000;   // 2 hours snooze duration

let lastCheckTime = 0;
let pollTimer = null;
let pendingNewVersion = null;
let isPromptVisible = false;

/**
 * Compare two semver strings (e.g. "2.17.9" vs "2.17.8").
 * Returns true if remote is strictly greater than local.
 */
export function isNewerVersion(remote, local) {
  const parse = (v) => (v || '').replace(/^v/, '').trim().split('.').map(n => parseInt(n, 10));
  const r = parse(remote);
  const l = parse(local);
  if (r.length !== 3 || l.length !== 3 || r.some(isNaN) || l.some(isNaN)) return false;
  if (r[0] !== l[0]) return r[0] > l[0];
  if (r[1] !== l[1]) return r[1] > l[1];
  return r[2] > l[2];
}

/**
 * Check if the user has snoozed update notifications.
 */
export function isSnoozed() {
  try {
    const raw = localStorage.getItem(LS.updateSnoozedUntil);
    if (!raw) return false;
    const snoozedUntil = parseInt(raw, 10);
    return !isNaN(snoozedUntil) && Date.now() < snoozedUntil;
  } catch (e) {
    return false;
  }
}

/**
 * Snooze update notifications for SNOOZE_MS (2 hours).
 */
export function snoozeUpdate() {
  try {
    localStorage.setItem(LS.updateSnoozedUntil, String(Date.now() + SNOOZE_MS));
  } catch (e) { }
  dismissUpdateBanner();
}

/**
 * Show the non-intrusive floating update notification banner.
 */
export function showUpdateBanner(newVersion) {
  isPromptVisible = true;
  if (el.updateText) {
    el.updateText.innerHTML = `发现新版本 <strong>v${newVersion}</strong>（当前 v${APP_VERSION}）`;
  }
  if (el.updateBanner) {
    el.updateBanner.classList.remove('hide');
  }
  // Synchronize settings modal version card if rendered
  if (el.settingsUpdateStatus) {
    el.settingsUpdateStatus.innerHTML = `发现新版本 <strong>v${newVersion}</strong>（当前 v${APP_VERSION}）`;
    el.settingsUpdateStatus.classList.add('has-update');
  }
  if (el.settingsCheckUpdateBtn) {
    el.settingsCheckUpdateBtn.classList.add('has-update');
    const label = el.settingsCheckUpdateBtn.querySelector('.check-update-label');
    if (label) label.textContent = '立即重启更新';
  }
  // Subtle badge update on sidebar
  document.querySelectorAll('.app-version-badge').forEach((badge) => {
    badge.classList.add('has-update');
    badge.title = `发现新版本 v${newVersion}，点击顶部横幅更新`;
  });
}

/**
 * Dismiss the update notification banner.
 */
export function dismissUpdateBanner() {
  isPromptVisible = false;
  if (el.updateBanner) {
    el.updateBanner.classList.add('hide');
  }
}

/**
 * Immediately reload the application to ingest the latest bundle.
 */
export function triggerAppReload() {
  window.location.reload();
}

/**
 * Flush any queued update notification once active generation completes.
 */
export function flushPendingUpdate() {
  if (pendingNewVersion && !isPromptVisible && !isSnoozed()) {
    showUpdateBanner(pendingNewVersion);
    pendingNewVersion = null;
  }
}

/**
 * Perform a zero-cache fetch for version.json and evaluate if a newer release exists.
 */
export async function checkVersionForUpdate(force = false) {
  const now = Date.now();
  if (!force && (now - lastCheckTime) < THROTTLE_MS) return { throttled: true };
  lastCheckTime = now;

  if (!force && isSnoozed()) return { snoozed: true };

  try {
    const res = await fetch(`/version.json?_t=${now}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (!res.ok) return { error: true, status: res.status };
    const data = await res.json();
    const remoteVer = data && data.version;

    if (remoteVer && isNewerVersion(remoteVer, APP_VERSION)) {
      // Proactively signal Service Worker registration to check for updated sw.js over the network.
      // In SPAs, navigations do not naturally occur during long-lived tabs; calling reg.update()
      // imperatively kicks off the SW update cycle and pre-caches the new shell ahead of reload.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg) reg.update().catch(() => {});
        }).catch(() => {});
      }
      if (state.busy) {
        pendingNewVersion = remoteVer;
      } else {
        showUpdateBanner(remoteVer);
      }
      return { hasUpdate: true, remoteVersion: remoteVer, currentVersion: APP_VERSION };
    }
    return { hasUpdate: false, currentVersion: APP_VERSION };
  } catch (err) {
    return { error: true, message: err.message };
  }
}

function startPeriodicPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkVersionForUpdate();
    }
  }, INTERVAL_MS);
}

function stopPeriodicPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Initialize the SPA Version Checker, event listeners, and visibility triggers.
 */
export function initVersionChecker(onToast) {
  // Bind UI buttons
  if (el.updateReload) {
    el.updateReload.addEventListener('click', triggerAppReload);
  }
  if (el.updateLater) {
    el.updateLater.addEventListener('click', snoozeUpdate);
  }
  if (el.updateClose) {
    el.updateClose.addEventListener('click', snoozeUpdate);
  }

  // Bind settings manual update check button
  if (el.settingsCheckUpdateBtn) {
    el.settingsCheckUpdateBtn.addEventListener('click', async () => {
      const btn = el.settingsCheckUpdateBtn;
      const statusEl = el.settingsUpdateStatus;
      const label = btn.querySelector('.check-update-label');
      const icon = btn.querySelector('.check-update-icon');

      // If already in "Update Available" state and user clicks, trigger immediate reload
      if (btn.classList.contains('has-update')) {
        triggerAppReload();
        return;
      }

      // Enter active checking state
      btn.disabled = true;
      if (icon) icon.classList.add('spinning');
      if (label) label.textContent = '检查中…';
      if (statusEl) {
        statusEl.textContent = '正在连接服务器查询最新发布…';
        statusEl.classList.remove('has-update', 'has-error');
      }

      try {
        const res = await checkVersionForUpdate(true);
        btn.disabled = false;
        if (icon) icon.classList.remove('spinning');

        if (res.hasUpdate) {
          if (statusEl) {
            statusEl.innerHTML = `发现新版本 <strong>v${res.remoteVersion}</strong>（当前 v${APP_VERSION}）`;
            statusEl.classList.add('has-update');
          }
          btn.classList.add('has-update');
          if (label) label.textContent = '立即重启更新';
          if (onToast) onToast(`发现新版本 v${res.remoteVersion}，点击设置中的按钮即可更新`, 'info');
        } else if (res.error) {
          if (statusEl) {
            statusEl.textContent = '未能获取版本信息，请检查网络连接后重试';
            statusEl.classList.add('has-error');
          }
          if (label) label.textContent = '重新检查';
          if (onToast) onToast('检查更新失败，请稍后重试', 'error');
        } else {
          if (statusEl) {
            statusEl.textContent = `当前已是最新版本 (v${APP_VERSION})`;
            statusEl.classList.remove('has-update', 'has-error');
          }
          if (label) label.textContent = '检查更新';
          if (onToast) onToast(`当前已是最新版本 (v${APP_VERSION})`, 'info');
        }
      } catch (err) {
        btn.disabled = false;
        if (icon) icon.classList.remove('spinning');
        if (label) label.textContent = '检查更新';
        if (statusEl) statusEl.textContent = '检查异常，请稍后重试';
      }
    });
  }

  // Page Visibility API integration: check on tab re-entry, pause polling when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkVersionForUpdate();
      startPeriodicPolling();
    } else {
      stopPeriodicPolling();
    }
  });

  // Start active interval timer
  startPeriodicPolling();

  // Gentle initial check after application hydration (warmup: 8 seconds)
  setTimeout(() => {
    checkVersionForUpdate();
  }, 8000);
}
