/**
 * PhotoGuide Service Worker
 * Provides offline capability and resource caching for the Clinical Photography PWA.
 */

const CACHE_VERSION = 'photoguide-v6';
const RUNTIME_CACHE = 'photoguide-runtime-v6';

// Resources to pre-cache on install (app shell)
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './lib/tf.min.js',
  './lib/blazeface.min.js',
];

// CDN resources to cache at runtime on first fetch
const CDN_PATTERNS = [
  'cdn.tailwindcss.com',
  'unpkg.com/react',
  'unpkg.com/react-dom',
  'unpkg.com/@babel/standalone',
  'accounts.google.com/gsi',
  'gstatic.com/firebasejs',
];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome-extension:// etc.
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Strategy: Cache-first for app shell & CDN assets
  const isCDN = CDN_PATTERNS.some((p) => url.href.includes(p));
  const isAppShell = url.origin === self.location.origin;

  if (isAppShell || isCDN) {
    event.respondWith(cacheFirst(request));
  }
  // For everything else, network-first
  else {
    event.respondWith(networkFirst(request));
  }
});

// ─── Strategies ────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response('Offline — resource not cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// ─── Background Sync (Google Drive upload queue) ────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-photos') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_UPLOADS' }));
      })
    );
  }
});
