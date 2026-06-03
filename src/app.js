const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const skusRoutes = require('./routes/skus');
const movimientosRoutes = require('./routes/movimientos');
const usuariosRoutes = require('./routes/usuarios');
const bodegasRoutes = require('./routes/bodegas');

const app = express();

// Seguridad
app.use(helmet());
app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use(require('express').static(require('path').join(__dirname, '..')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/skus', skusRoutes);
app.use('/api/movimientos', movimientosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/bodegas', bodegasRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MediStock API funcionando' });
});

module.exports = app;