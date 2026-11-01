// Guarda la pantalla de la app para que abra rápido; los precios siempre se
// piden al servidor (nunca se muestran precios guardados como si fueran nuevos).
// También recibe las notificaciones push del monitoreo.
const VERSION = 'mp-v12';
const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'ajustes.js',
  'catalogo.js',
  'csv.js',
  'datos.js',
  'escaner.js',
  'estado.js',
  'inventario.js',
  'lista.js',
  'optimizar.js',
  'pedido.js',
  'proveedores.js',
  'reglas.js',
  'resultados.js',
  'sync.js',
  'tutorial.js',
  'util.js',
  'ventas.js',
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
  // Red primero; si no hay conexión, la copia guardada. Solo se guardan
  // respuestas correctas: un 404 o un 500 no reemplaza la copia buena.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error()),
  );
});

// ── Notificaciones push ────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let datos = {};
  try {
    datos = e.data ? e.data.json() : {};
  } catch {
    datos = { title: 'Mejor Precio', body: e.data?.text() || '' };
  }
  e.waitUntil(
    self.registration.showNotification(datos.title || 'Mejor Precio', {
      body: datos.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: datos.tag || undefined,
      data: { url: datos.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', self.location.origin);
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const abierta = ventanas.find((v) => new URL(v.url).origin === destino.origin);
      if (abierta) {
        await abierta.focus();
        const q = destino.searchParams.get('q');
        if (q) abierta.postMessage({ tipo: 'abrir', q });
        return;
      }
      await self.clients.openWindow(destino.href);
    })(),
  );
});
