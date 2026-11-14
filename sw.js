/* Offline support. Bump VERSION when you upload changed files. */
const VERSION = 'cuefollow-1.0.2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'tracker.js', 'speech.js', 'files.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'vosk.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/voice-model.tar.gz')) {
    // The voice model ships as two parts (GitHub's upload limit is 25 MB per file). Join them here.
    e.respondWith((async () => {
      const base = url.href.replace(/voice-model\.tar\.gz.*$/, '');
      const parts = await Promise.all(['voice-model.part00', 'voice-model.part01'].map((p) => fetch(base + p)));
      if (parts.some((r) => !r.ok)) return new Response('model parts missing', { status: 404 });
      const blob = new Blob(await Promise.all(parts.map((r) => r.arrayBuffer())), { type: 'application/gzip' });
      return new Response(blob, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(blob.size) } });
    })());
    return;
  }
  if (url.pathname.includes('/voice-model.part')) return; // parts go straight to the network; the unpacked model is kept in IndexedDB
  if (url.pathname.endsWith('/vosk.js')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // App files: network first so uploads take effect, cache when offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
