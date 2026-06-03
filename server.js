require('dotenv').config();
const express = require('express');
const app = require('./src/app');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos (frontend)
app.use(express.static(path.join(__dirname)));

// Cualquier ruta que no sea /api → sirve el index.html
app.get('/{*any}', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`MediStock corriendo en puerto ${PORT}`);
});