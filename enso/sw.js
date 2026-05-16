// Service worker. Network-first for same-origin requests so a fresh deploy
// is picked up immediately — the cache is only a fallback for offline use.
// Bump CACHE on any change that must invalidate old clients.

const CACHE = 'enso-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './plan.js',
  './storage.js',
  './suggestions.js',
  './quotes.js',
  './claude-export.js',
  './enso-svg.js',
  './strava.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // never intercept cross-origin API calls (strava, fonts, etc.)
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  // Network-first: always try the server, fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
