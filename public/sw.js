const CACHE_NAME = 'ddraft-cache-v4';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest?v=4',
  '/favicon.ico?v=4',
  '/favicon-32x32.png?v=4',
  '/favicon-16x16.png?v=4',
  '/favicon.png?v=4',
  '/logo.png',
  '/icon-192.png?v=4',
  '/icon-512.png?v=4',
  '/icon-maskable-512.png?v=4',
  '/apple-touch-icon.png?v=4'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Exclude API requests, agent endpoints, and dev server sockets
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/agent') ||
    url.pathname.startsWith('/demo-project') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src')
  ) {
    return;
  }

  // Network-first for HTML pages so updates are immediate
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((res) => res || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate for static assets & fonts
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
