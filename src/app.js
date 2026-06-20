const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const authRoutes       = require('./routes/auth');
const skusRoutes       = require('./routes/skus');
const movimientosRoutes = require('./routes/movimientos');
const usuariosRoutes   = require('./routes/usuarios');
const bodegasRoutes    = require('./routes/bodegas');
const ubicacionesRoutes = require('./routes/ubicaciones');

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
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));
app.use(cors());
app.use(express.json());

// ── Rate limit login: 10 intentos / 15 min por IP (anti fuerza bruta) ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Fix #9: Rate limit API por IP ──
// Se aumenta de 300 a 600 req/15min para evitar bloquear clínicas
// donde múltiples enfermeros comparten la misma IP pública (NAT/proxy).
const apiLimiterByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // Si el límite por IP se alcanza, aún puede pasar el límite por usuario
  skipSuccessfulRequests: false,
});

// ── Fix #9: Rate limit API por usuario autenticado ──
// Complementa el límite por IP: cada usuario tiene su propia cuota de
// 200 req/15min independientemente de cuántos usuarios compartan IP.
// Si el token es inválido o ausente, se omite este limitador y solo
// aplica el de IP (el endpoint de auth lo rechazará de todas formas).
const apiLimiterByUser = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) return null; // sin token → no aplica este limitador
      // Solo decodificamos (sin verificar firma) para obtener el ID.
      // La verificación real ocurre en verificarToken; aquí solo necesitamos
      // una clave de agrupación estable por usuario.
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf8')
      );
      return payload.id ? `user_${payload.id}` : null;
    } catch {
      return null; // token malformado → no aplica este limitador
    }
  },
  skip: (req) => {
    // Si keyGenerator devuelve null, skip = true → no limitar
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) return true;
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf8')
      );
      return !payload.id;
    } catch {
      return true;
    }
  },
});

// Rutas
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/skus',         apiLimiterByIp, apiLimiterByUser, skusRoutes);
app.use('/api/movimientos',  apiLimiterByIp, apiLimiterByUser, movimientosRoutes);
// /api/usuarios/me está incluido dentro de usuariosRoutes (Fix crítico #1 — no requiere nivel 4)
app.use('/api/usuarios',     apiLimiterByIp, apiLimiterByUser, usuariosRoutes);
app.use('/api/bodegas',      apiLimiterByIp, apiLimiterByUser, bodegasRoutes);
app.use('/api/ubicaciones',  apiLimiterByIp, apiLimiterByUser, ubicacionesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MediStock API funcionando' });
});

module.exports = app;