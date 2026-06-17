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
app.set('trust proxy', 1); // ← agregar esta línea

// Seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));
app.use(cors());
app.use(express.json());

// Rate limiting general (más permisivo)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,              // era 100
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter estricto solo para login (prevenir brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/skus', limiter, skusRoutes);
app.use('/api/movimientos', limiter, movimientosRoutes);
app.use('/api/usuarios', limiter, usuariosRoutes);
app.use('/api/bodegas', limiter, bodegasRoutes);

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