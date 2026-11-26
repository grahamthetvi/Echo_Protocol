// Service worker: precache the app shell so Echo Protocol works offline after the
// first visit, and cache audio files the first time each one is fetched.
const VERSION = 'echo-v1';
const SHELL = `${VERSION}-shell`;
const AUDIO = `${VERSION}-audio`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    let files = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'assets/audio/manifest.json'];
    try {
      const res = await fetch('precache-manifest.json', { cache: 'no-cache' });
      if (res.ok) files = [...new Set([...files, ...(await res.json()).files])];
    } catch { /* fall back to the minimal shell; the rest is cached on first use */ }
    await cache.addAll(files);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isAudio = /\/assets\/audio\/.+\.(ogg|webm|opus|mp3|wav|m4a)$/.test(new URL(req.url).pathname);
  event.respondWith((async () => {
    const cache = await caches.open(isAudio ? AUDIO : SHELL);
    const hit = await cache.match(req, { ignoreSearch: !isAudio });
    if (hit) {
      if (!isAudio) {
        // Stale-while-revalidate for code and data so updates arrive on the next visit.
        fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); }).catch(() => {});
      }
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw e;
    }
  })());
});
