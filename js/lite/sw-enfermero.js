/* Service Worker del panel de enfermero (navegadores modernos).
   Guarda la página y sus archivos en el dispositivo para que /enfermero
   abra sin señal. Las llamadas a /api/ siempre van a la red (los consumos
   offline los maneja enfermero-lite.js con localStorage).

   El servidor (server.js) sirve este archivo en /sw-enfermero.js
   reemplazando __VERSION__ por un hash de los archivos del panel: cuando
   cambian, el navegador instala la versión nueva y borra la anterior. */
var CACHE = 'enfermero-__VERSION__';
var ARCHIVOS = [
  '/enfermero',
  '/css/enfermero-lite.css',
  '/js/lite/enfermero-lite.js',
  '/fonts/METHANERSE_Free_Trial.woff2',
  '/fonts/METHANERSE_Free_Trial.woff',
  '/logo.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ARCHIVOS); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(claves){
    return Promise.all(claves.filter(function(k){ return k.indexOf('enfermero-') === 0 && k !== CACHE; })
      .map(function(k){ return caches['delete'](k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) return;
  var clave = url.pathname === '/enfermero' ? '/enfermero' : e.request;
  e.respondWith(caches.match(clave).then(function(r){ return r || fetch(e.request); }));
});
