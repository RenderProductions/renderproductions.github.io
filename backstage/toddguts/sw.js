// TODD.OS as an app: keeps his files on the phone so he opens without a connection.
// Online, everything comes fresh from the site (and the copy here is updated); offline, the saved copy is used.
// (The pages ask for their files with ?v=... on the end; that's ignored when matching the saved copy.)
const CACHE = 'todd-os-v1';
const CORE = [
  './', './index.html', './todd.css', './todd.js', './chat.js', './brain.json', './terminal.json',
  './faces.png', './agony.jpg', './todd.gltf', './vendor/three-gltf.min.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  '/inventory.js', '/prices.json', '/backstage/frequency/signals.json'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.url.split('?')[0], copy)); }
      return res;
    }).catch(() => caches.match(req.url.split('?')[0], { ignoreSearch: true }).then((hit) => hit || caches.match(req, { ignoreSearch: true })))
  );
});
