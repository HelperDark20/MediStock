/* Service Worker de /datacontrol (asistencia en tablets, navegadores modernos).
   Guarda la página y sus archivos para que abra sin señal. Las llamadas a
   /api/ siempre van a la red (las marcas sin conexión las guarda
   datacontrol-lite.js en localStorage).
   server.js lo sirve en /sw-datacontrol.js con la versión y la lista de
   archivos reemplazadas. */
var CACHE = 'datacontrol-__VERSION__';
var ARCHIVOS = __ARCHIVOS__;

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ARCHIVOS); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(claves){
    return Promise.all(claves.filter(function(k){ return k.indexOf('datacontrol-') === 0 && k !== CACHE; })
      .map(function(k){ return caches['delete'](k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) return;
  var clave = url.pathname === '/datacontrol' ? '/datacontrol' : e.request;
  e.respondWith(caches.match(clave).then(function(r){ return r || fetch(e.request); }));
});
