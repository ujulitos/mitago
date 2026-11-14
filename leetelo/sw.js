// PWA Service Worker for Léetelo WebApp
// Enables full 100% offline reading on any device (phone, tablet, computer)

const CACHE_NAME = 'leetelo-pwa-v79';

const STATIC_ASSETS = [
  './',
  './index.html',
  './favicon.ico',
  './app.webmanifest',
  './icons/icon.svg',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-48.png',
  './icons/icon-128.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/libro.jpg',
  './src/lib/theme-boot.js',
  './src/lib/base.css',
  './src/lib/fonts.css',
  './src/lib/chrome-shim.js',
  './src/lib/i18n.js',
  './src/lib/i18n-es.js',
  './src/lib/i18n-en.js',
  './src/lib/icons.js',
  './src/lib/toast.js',
  './src/lib/theme.js',
  './src/reader/reader.css',
  './src/reader/reader.js',
  './src/reader/dom.js',
  './src/reader/logic.js',
  './src/reader/library.js',
  './src/reader/reading.js',
  './src/reader/highlights.js',
  './src/reader/stats.js',
  './src/reader/libfile.js',
  './src/reader/libio.js',
  './src/reader/remote.js',
  './src/core/formats.js',
  './src/core/loader.js',
  './src/core/render.js',
  './src/core/store.js',
  './src/core/position.js',
  './src/core/epub.js',
  './src/core/fb2.js',
  './src/core/cbz.js',
  './src/core/turn.js',
  './src/core/spread.js',
  './src/core/search.js',
  './src/core/notes.js',
  './src/core/anchor.js',
  './src/core/xml.js',
  './src/core/zip.js',
  './src/core/zipwrite.js',
  './fonts/asap-condensed-italic-400-latin.woff2',
  './fonts/asap-condensed-italic-400-latin-ext.woff2',
  './fonts/asap-condensed-italic-500-latin.woff2',
  './fonts/asap-condensed-italic-500-latin-ext.woff2',
  './fonts/asap-condensed-italic-600-latin.woff2',
  './fonts/asap-condensed-italic-600-latin-ext.woff2',
  './fonts/asap-condensed-italic-700-latin.woff2',
  './fonts/asap-condensed-italic-700-latin-ext.woff2',
  './fonts/asap-condensed-normal-400-latin.woff2',
  './fonts/asap-condensed-normal-400-latin-ext.woff2',
  './fonts/asap-condensed-normal-500-latin.woff2',
  './fonts/asap-condensed-normal-500-latin-ext.woff2',
  './fonts/asap-condensed-normal-600-latin.woff2',
  './fonts/asap-condensed-normal-600-latin-ext.woff2',
  './fonts/asap-condensed-normal-700-latin.woff2',
  './fonts/asap-condensed-normal-700-latin-ext.woff2',
  './fonts/atkinson-hyperlegible-italic-400-latin.woff2',
  './fonts/atkinson-hyperlegible-italic-400-latin-ext.woff2',
  './fonts/atkinson-hyperlegible-italic-700-latin.woff2',
  './fonts/atkinson-hyperlegible-italic-700-latin-ext.woff2',
  './fonts/atkinson-hyperlegible-normal-400-latin.woff2',
  './fonts/atkinson-hyperlegible-normal-400-latin-ext.woff2',
  './fonts/atkinson-hyperlegible-normal-700-latin.woff2',
  './fonts/atkinson-hyperlegible-normal-700-latin-ext.woff2',
  './fonts/fira-sans-condensed-italic-400-latin.woff2',
  './fonts/fira-sans-condensed-italic-400-latin-ext.woff2',
  './fonts/fira-sans-condensed-italic-500-latin.woff2',
  './fonts/fira-sans-condensed-italic-500-latin-ext.woff2',
  './fonts/fira-sans-condensed-italic-600-latin.woff2',
  './fonts/fira-sans-condensed-italic-600-latin-ext.woff2',
  './fonts/fira-sans-condensed-italic-700-latin.woff2',
  './fonts/fira-sans-condensed-italic-700-latin-ext.woff2',
  './fonts/fira-sans-condensed-normal-400-latin.woff2',
  './fonts/fira-sans-condensed-normal-400-latin-ext.woff2',
  './fonts/fira-sans-condensed-normal-500-latin.woff2',
  './fonts/fira-sans-condensed-normal-500-latin-ext.woff2',
  './fonts/fira-sans-condensed-normal-600-latin.woff2',
  './fonts/fira-sans-condensed-normal-600-latin-ext.woff2',
  './fonts/fira-sans-condensed-normal-700-latin.woff2',
  './fonts/fira-sans-condensed-normal-700-latin-ext.woff2',
  './fonts/noto-sans-italic-300-700-latin.woff2',
  './fonts/noto-sans-italic-300-700-latin-ext.woff2',
  './fonts/noto-sans-normal-300-700-latin.woff2',
  './fonts/noto-sans-normal-300-700-latin-ext.woff2',
  './fonts/roboto-condensed-italic-300-700-latin.woff2',
  './fonts/roboto-condensed-italic-300-700-latin-ext.woff2',
  './fonts/roboto-condensed-normal-300-700-latin.woff2',
  './fonts/roboto-condensed-normal-300-700-latin-ext.woff2',
  './fonts/source-sans-3-italic-300-700-latin.woff2',
  './fonts/source-sans-3-italic-300-700-latin-ext.woff2',
  './fonts/source-sans-3-normal-300-700-latin.woff2',
  './fonts/source-sans-3-normal-300-700-latin-ext.woff2',
];

async function matchCached(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  if (request.mode === 'navigate') {
    return (await caches.match('./index.html'))
      || (await caches.match('./'))
      || caches.match(request, { ignoreSearch: true });
  }
  return caches.match(request, { ignoreSearch: true });
}

function fetchWithTimeout(request, init, ms = 3500) {
  if (typeof AbortController === 'undefined') return fetch(request, init);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fetch(request, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept non-GET, cross-origin, or API requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell (HTML, CSS, JS, manifest) uses Network-First with fast timeout and offline cache fallback
  const isAppShell = event.request.mode === 'navigate'
    || /\.(?:html|css|js|mjs|webmanifest)$/i.test(url.pathname)
    || url.pathname.endsWith('/');

  if (isAppShell) {
    event.respondWith(
      fetchWithTimeout(event.request, { cache: 'no-cache' }, 3500)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return networkResponse;
          }
          return (await matchCached(event.request)) || networkResponse;
        })
        .catch(() => matchCached(event.request))
    );
    return;
  }

  // Static assets (fonts, icons, images): Cache-First for instant offline availability
  event.respondWith(
    matchCached(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        if (self.navigator?.onLine !== false) {
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
        }
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      }).catch(() => matchCached(event.request));
    })
  );
});
