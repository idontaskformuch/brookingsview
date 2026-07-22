// Service worker -- shared across all cities built from this codebase (see
// site/src/lib/site-config.ts). The cache name is just a local browser-storage
// label, scoped per-origin already, so it doesn't need to be city-specific.
//
// News here updates every hour, so pages must never be served stale-first.
// Strategy: network-first for navigations (HTML), cache-first for static
// assets (icons, fonts). Bump CACHE_NAME on deploys that change static
// asset paths; otherwise old caches are pruned automatically on activate.

const CACHE_NAME = 'site-static-v1';
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (HTML pages): always go to the network first so hourly
  // updates show up immediately. Fall back to the offline page only when
  // there's truly no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets: cache-first, refresh in the background.
  if (/\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
