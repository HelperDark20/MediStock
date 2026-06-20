require('dotenv').config();
const express = require('express');
const app = require('./src/app');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos (frontend)
app.use(express.static(path.join(__dirname)));

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