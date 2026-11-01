// Guarda la pantalla de la app para que abra rápido; los precios siempre se
// piden al servidor (nunca se muestran precios guardados como si fueran nuevos).
const VERSION = 'mp-v11';
const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'datos.js',
  'reglas.js',
  'tutorial.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fuentes/archivo-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Red primero; si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
