// Service worker de Caja Movil - cachea solo la "cascara" de la app
// (HTML/JS/iconos) para que abra al instante, incluso sin señal. Los DATOS
// (productos, ventas, etc.) siguen viniendo de Firestore normal - eso ya
// tiene su propio manejo offline (enableIndexedDbPersistence), no hace
// falta que este service worker se meta en eso.

// OJO: subir este numero en CADA deploy que cambie HTML/JS. La estrategia
// es "cache primero", asi que sin un nombre nuevo los equipos que ya tienen
// la app siguen mostrando la version vieja para siempre (el navegador solo
// instala un service worker nuevo si este archivo cambia).
const VERSION_CACHE = 'caja-movil-v10';
// TODOS los archivos propios que cargan panel.html y activar.html - antes
// faltaban algunos (reportes, qrcode, el lector de codigos, el modal de
// historial), que se guardaban recien al usarse y podian quedar de otra
// version que el resto.
const ARCHIVOS_CASCARA = [
  './panel.html',
  './activar.html',
  './carrito_compartido.js',
  './motor.js',
  './datos.js',
  './firebase-sync.bundle.js',
  './modal_historial.js',
  './qrcode.js',
  './reportes.js',
  './html5-qrcode.min.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Cada archivo se baja con "?v=<version>" y cache:'reload': lo primero
// esquiva el cache del hosting (Render guarda copias hasta 5 min despues de
// publicar), lo segundo el del navegador. Sin esto, un equipo que se
// actualizaba justo despues de publicar podia quedar con el panel.html nuevo
// y algun .js viejo mezclados - y con eso la app ni arrancaba. Se guarda bajo
// el nombre normal (sin "?v="), que es como la app los pide. Si falla
// cualquiera, la instalacion entera falla y sigue andando la version anterior
// completa (nunca queda a medias).
self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const descargados = await Promise.all(ARCHIVOS_CASCARA.map(async (ruta) => {
      const respuesta = await fetch(`${ruta}?v=${VERSION_CACHE}`, { cache: 'reload' });
      if (!respuesta.ok) throw new Error(`No se pudo bajar ${ruta} (${respuesta.status})`);
      // El contenido se lee entero APENAS llega. Si las respuestas quedaran
      // sin leer hasta que terminen todas, ocupan las conexiones del navegador
      // (6 por sitio) y las descargas siguientes esperan para siempre - la
      // instalacion se colgaba y el equipo nunca se actualizaba.
      const contenido = await respuesta.blob();
      return [ruta, new Response(contenido, { headers: respuesta.headers })];
    }));
    const cache = await caches.open(VERSION_CACHE);
    await Promise.all(descargados.map(([ruta, respuesta]) => cache.put(ruta, respuesta)));
  })());
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
