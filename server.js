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

app.listen(PORT, () => {
  console.log(`MediStock corriendo en puerto ${PORT}`);
});