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
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Only handle standard HTTP/HTTPS requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Exclude API requests, agent endpoints, dev server paths, and node_modules
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/agent') ||
    url.pathname.startsWith('/demo-project') ||
    url.pathname.startsWith('/node_modules') ||
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
  const networkResponse = fetch(event.request);
  const cacheUpdate = networkResponse.then((response) => {
    if (!response || response.status !== 200) return;
    return caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
  });

  event.waitUntil(cacheUpdate.catch(() => {}));
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => cachedResponse || networkResponse)
  );
});
