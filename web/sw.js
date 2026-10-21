// 浪人パンチフライト：オフラインでも開けるようにする
const CACHE = 'rpf-__VER__';
const MEDIA = 'rpf-media-__MVER__'; // 曲（大きいので、曲が変わったときだけ入れかえる）
const CORE = ['/', '/index.html', '/app.js?v=__VER__', '/app.css?v=__VER__', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/cp-600.woff2', '/cp-700.woff2', '/cp-700i.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== MEDIA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // HTML は最新を先に取りにいく（つながらないときはキャッシュ）
  if (e.request.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const c = r.clone();
          caches.open(CACHE).then((ca) => ca.put('/index.html', c));
          return r;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }
  const store = /\.(m4a|mp3)$/.test(u.pathname) ? MEDIA : CACHE;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((r) => {
          if (r.ok && r.status === 200) {
            const c = r.clone();
            caches.open(store).then((ca) => ca.put(e.request, c));
          }
          return r;
        })
    )
  );
});
