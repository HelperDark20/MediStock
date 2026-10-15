require('dotenv').config();
const express = require('express');
const app = require('./src/app');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos (frontend)
// FIX SEGURIDAD: antes se servía toda la raíz del proyecto con
// express.static(__dirname), lo que exponía el código del backend
// (/src/..., /server.js, /package.json). Ahora solo se publica lo que
// el navegador necesita.
app.use('/js',    express.static(path.join(__dirname, 'js')));
app.use('/css',   express.static(path.join(__dirname, 'css')));
app.use('/fonts', express.static(path.join(__dirname, 'fonts')));
app.get('/api.js',   (req, res) => res.sendFile(path.join(__dirname, 'api.js')));
app.get('/logo.png', (req, res) => res.sendFile(path.join(__dirname, 'logo.png')));

// Panel de enfermero compatible con navegadores antiguos (iPad con iOS 9–12).
// Página independiente y liviana; js/compat-check.js redirige aquí a los
// navegadores que no pueden ejecutar la app principal.
app.get('/enfermero', (req, res) => res.sendFile(path.join(__dirname, 'enfermero.html')));

// Modo offline del panel de enfermero: la página se guarda en el dispositivo.
//   - Safari de iOS 9–12 → AppCache (/enfermero.appcache, atributo manifest)
//   - navegadores modernos → Service Worker (/sw-enfermero.js)
// La versión es un hash de los archivos del panel: al desplegar cambios y
// reiniciar, los dispositivos descargan la versión nueva por sí solos.
const crypto = require('crypto');
const fs = require('fs');
const ARCHIVOS_PANEL = [
  'enfermero.html', 'css/enfermero-lite.css', 'js/lite/enfermero-lite.js', 'js/lite/sw-enfermero.js',
  'fonts/METHANERSE_Free_Trial.woff2', 'fonts/METHANERSE_Free_Trial.woff', 'logo.png'
];
const hashPanel = crypto.createHash('sha1');
ARCHIVOS_PANEL.forEach(f => hashPanel.update(fs.readFileSync(path.join(__dirname, f))));
const VERSION_PANEL = hashPanel.digest('hex').slice(0, 12);

app.get('/enfermero.appcache', (req, res) => {
  res.type('text/cache-manifest').set('Cache-Control', 'no-cache').send([
    'CACHE MANIFEST',
    `# version ${VERSION_PANEL}`,
    'CACHE:',
    '/css/enfermero-lite.css',
    '/js/lite/enfermero-lite.js',
    '/fonts/METHANERSE_Free_Trial.woff',
    '/logo.png',
    'NETWORK:',
    '*',
    ''
  ].join('\n'));
});

const swPanel = fs.readFileSync(path.join(__dirname, 'js/lite/sw-enfermero.js'), 'utf8')
  .replace(/__VERSION__/g, VERSION_PANEL);
app.get('/sw-enfermero.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(swPanel);
});

// Fix #12: la versión anterior no llamaba next() cuando la ruta era /api,
// dejando esas peticiones sin respuesta en Express 5 (timeout silencioso).
// Ahora: rutas no-API → sirve index.html; rutas /api → pasa al siguiente
// middleware (que devolverá 404 si la ruta no existe en ningún router).
app.get('/{*any}', (req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    next();
  }
});

require('./src/config/migraciones').aplicarMigraciones();

app.listen(PORT, () => {
  console.log(`MediStock corriendo en puerto ${PORT}`);
});