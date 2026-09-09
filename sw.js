// sw.js - ZenChat Progressive Web App Service Worker
// Governs offline application shell caching, stale-while-revalidate delivery,
// and atomic cache bucket invalidation across production semver increments.

// CACHE_NAME acts as the primary invalidation catalyst.
// Synchronized atomically with package.json via scripts/bump.js on every release.
const CACHE_NAME = 'zenchat-shell-v2.20.18';

// Static application shell assets pre-cached during worker installation
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/js/app.js',
  '/favicon.ico',
  '/icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest'
];

/**
 * Installation Lifecycle Event
 * Fetches fresh application shell assets from the network and stores them
 * directly into the new CACHE_NAME bucket (bypassing active worker's cache).
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting()) // Instantly transition worker to activate phase
  );
});

/**
 * Activation Lifecycle Event
 * Performs deterministic garbage collection: purges all legacy cache buckets
 * that do not match the active CACHE_NAME, then claims control of all open tabs.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim()) // Immediately take control of all active clients
  );
});

/**
 * Fetch Interception Pipeline
 * Enforces strict network-only bypass for streaming AI APIs and release polling,
 * while applying Stale-While-Revalidate (SWR) caching to static shell resources.
 */
self.addEventListener('fetch', (event) => {
  // 1. Strict Network-Only: Dynamic LLM APIs, SSE streams, version polling, and non-HTTP schemes
  // Only process standard http/https GET requests. Ignore chrome-extension://, moz-extension://, data:, etc.
  if (
    event.request.method !== 'GET' ||
    !event.request.url ||
    (!event.request.url.startsWith('http:') && !event.request.url.startsWith('https:'))
  ) {
    return; // Allow standard unmediated network pass-through
  }

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/version.json') {
    return;
  }

  // 2. Stale-While-Revalidate: Serve cached shell asset instantly while updating cache in background
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              cache.put(event.request, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      });
    }).catch(() => fetch(event.request))
  );
});
