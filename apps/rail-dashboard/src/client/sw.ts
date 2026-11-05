/// <reference lib="webworker" />
// Service worker: app shell is served cache-first (instant start, works
// offline); API calls always go to the network — the page keeps its own
// clearly-labelled cache of the last results.

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const CACHE = `rail-shell-${__BUILD_ID__}`;
const SHELL = [
  '/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/roboto-latin-400-normal.woff2', '/fonts/roboto-latin-500-normal.woff2', '/fonts/roboto-latin-700-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rail-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Shell first for speed; refresh it in the background.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match('/index.html');
        const network = fetch(req)
          .then((res) => {
            if (res.ok) void cache.put('/index.html', res.clone());
            return res;
          })
          .catch(() => cached ?? Response.error());
        return cached ?? network;
      }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok && (url.pathname === '/stations.json' || SHELL.includes(url.pathname))) void cache.put(req, res.clone());
      return res;
    }),
  );
});
