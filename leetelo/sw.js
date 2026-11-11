// PWA Service Worker for Léetelo WebApp
// Enables offline reading on any device (phone, tablet, computer)

const CACHE_NAME = 'leetelo-pwa-v29';

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
  './src/core/zipwrite.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept non-GET or API requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached asset, and optionally update in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Not in cache: fetch from network and store in cache
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // Offline fallback for HTML navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
      });
    })
  );
});

