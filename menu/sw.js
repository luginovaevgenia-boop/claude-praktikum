// Кэш оболочки приложения: после первого открытия оно запускается и без сети.
// При изменении файлов приложения увеличьте номер версии.
const CACHE = 'menu-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'logic.js', 'dishes.js', 'recipes.js', 'storage.js',
  'firebase-config.js', 'manifest.webmanifest', 'icon.svg'];

const EXTERNAL = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала из кэша, в фоне обновляем; так же для файлов Firebase SDK и шрифтов.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !EXTERNAL.includes(url.hostname)) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || Response.error();
  }));
});
