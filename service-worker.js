// Service worker de Caja Movil - cachea solo la "cascara" de la app
// (HTML/JS/iconos) para que abra al instante, incluso sin señal. Los DATOS
// (productos, ventas, etc.) siguen viniendo de Firestore normal - eso ya
// tiene su propio manejo offline (enableIndexedDbPersistence), no hace
// falta que este service worker se meta en eso.

const VERSION_CACHE = 'caja-movil-v1';
const ARCHIVOS_CASCARA = [
  './panel.html',
  './activar.html',
  './carrito_compartido.js',
  './motor.js',
  './datos.js',
  './firebase-sync.bundle.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION_CACHE).then((cache) => cache.addAll(ARCHIVOS_CASCARA))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  // Borra caches de versiones viejas cuando se sube una nueva
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== VERSION_CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Nunca cachear pedidos a Firebase/Firestore/Google - esos ya tienen su
  // propio manejo offline, y cachearlos aca podria mostrar datos viejos
  // (stock desactualizado) sin que nadie se de cuenta.
  if (url.hostname.includes('firestore') || url.hostname.includes('googleapis') || url.hostname.includes('google.com')) {
    return;
  }

  evento.respondWith(
    caches.match(evento.request).then((respuestaCache) => {
      if (respuestaCache) return respuestaCache;
      return fetch(evento.request).then((respuestaRed) => {
        // Guarda una copia de lo que se pidio, para la proxima vez sin señal
        const copia = respuestaRed.clone();
        caches.open(VERSION_CACHE).then((cache) => cache.put(evento.request, copia));
        return respuestaRed;
      }).catch(() => caches.match('./panel.html'));
    })
  );
});
