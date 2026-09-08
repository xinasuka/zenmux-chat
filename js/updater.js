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
  if (!force && (now - lastCheckTime) < THROTTLE_MS) return;
  lastCheckTime = now;

  if (!force && isSnoozed()) return;

  try {
    const res = await fetch(`/version.json?_t=${now}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    const remoteVer = data && data.version;

    if (remoteVer && isNewerVersion(remoteVer, APP_VERSION)) {
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
    }
  } catch (err) {
    // Network errors fail silently without disturbing the user
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
export function initVersionChecker() {
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
