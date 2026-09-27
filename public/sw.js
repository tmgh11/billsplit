// Offline support: network-first for the page, cache-first for static files.
// Supabase and exchange-rate requests are never cached here.
const CACHE = 'billsplit-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) event.waitUntil(updateShell(res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

/**
 * Keep the latest page for offline use. When it has changed (a new deploy), drop cached build files
 * it no longer uses: every build gets new hashed names under assets/, so old ones would otherwise
 * pile up on the phone forever. Icons and the OCR files keep their names and are left alone.
 * The current build's lazily loaded files (e.g. receipt scanning) are cached again on next use.
 */
async function updateShell(res) {
  const cache = await caches.open(CACHE);
  const html = await res.text();
  const previous = await cache.match('./index.html');
  await cache.put('./index.html', new Response(html, { headers: res.headers }));
  if (!previous || (await previous.text()) === html) return;

  const used = new Set(
    [...html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href),
  );
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname.includes('/assets/') && !used.has(key.url)) await cache.delete(key);
  }
}
