// Service worker di QuickSmart: rete prima, cache come paracadute.
//
// Due cose NON devono mai passare di qui: le richieste non-GET (le azioni di
// gioco) e /api (lo stream SSE della partita: metterlo in cache o anche solo
// intercettarlo significa giocare con uno stato vecchio).

const CACHE = 'qs-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(event.request, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw new Error('offline e non in cache');
      }
    })()
  );
});
