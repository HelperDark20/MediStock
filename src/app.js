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
app.set('trust proxy', 1);

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
      // Permitir llamadas al mismo origen y al CDN de iconos Tabler
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));
app.use(cors());
app.use(express.json());

// Rate limit estricto solo para login (anti fuerza bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // máximo 10 intentos por IP
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit general para el resto de la API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rutas
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/skus', apiLimiter, skusRoutes);
app.use('/api/movimientos', apiLimiter, movimientosRoutes);
app.use('/api/usuarios', apiLimiter, usuariosRoutes);
app.use('/api/bodegas', apiLimiter, bodegasRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MediStock API funcionando' });
});

module.exports = app;