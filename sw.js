// Met toute l'appli en cache pour qu'elle fonctionne sans réseau en magasin.
// Changer CACHE à chaque mise à jour des fichiers.
const CACHE = 'courses-v3';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'price.js',
  'catalog.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-512.png',
  'vendor/tesseract.min.js',
  'vendor/worker.min.js',
  'vendor/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract-core-lstm.wasm.js',
  'vendor/fra.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
