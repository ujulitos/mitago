const CACHE_NAME = 'mitago-pwa-v2';

const PRECACHE_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'projectInfo.json',
  'assets/mitago.png',
  'assets/album-cover.jpg',
  'assets/project_cover.jpg',
  'assets/proximamente.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-192-maskable.png',
  'assets/icons/icon-512-maskable.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-32x32.png'
];

// --- Install Event: Cache Core Assets ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching app shell assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[Service Worker] Cache addAll error:', err))
  );
});

// --- Activate Event: Cleanup Old Caches ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// --- Fetch Event: Cache Strategy ---
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Bypass Service Worker for media streaming to allow native HTTP Range requests (partial content)
  if (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.wav') || url.pathname.endsWith('.ogg')) {
    return;
  }

  // Network First for PHP scripts (e.g. get_songs.php)
  if (url.pathname.endsWith('.php')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Stale-While-Revalidate / Cache First for static resources
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update in parallel to revalidate cache
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          }
        }).catch(() => {/* ignore network error when offline */});

        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Fallback for HTML page navigation offline
        if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
          return caches.match('./') || caches.match('index.html');
        }
      });
    })
  );
});
