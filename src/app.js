const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const authRoutes        = require('./routes/auth');
const skusRoutes        = require('./routes/skus');
const movimientosRoutes = require('./routes/movimientos');
const usuariosRoutes    = require('./routes/usuarios');
const bodegasRoutes     = require('./routes/bodegas');
const ubicacionesRoutes = require('./routes/ubicaciones');
const eventosRoutes     = require('./routes/eventos');
const stockSeguridadRoutes = require('./routes/stockSeguridad');
const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Fix CSP: se agregan cdnjs.cloudflare.com y cdn.jsdelivr.net a scriptSrc
      // para permitir Chart.js y cualquier otro script de CDN que use el frontend.
      // 'unsafe-inline' eliminado de scriptSrc — protege scripts externos.
      // scriptSrcAttr mantiene 'unsafe-inline' porque el HTML usa onclick= inline.
      // Para eliminarlo completamente habría que migrar todos los handlers a JS.
      scriptSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com"
      ],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com"
      ]
    }
  }
}));
// FIX SEGURIDAD: el frontend se sirve desde el mismo dominio que la API,
// así que no necesita CORS. Si algún día se consume desde otro dominio,
// definir CORS_ORIGIN en el .env (varios separados por coma).
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : false
}));
app.use(express.json());

// ── Rate limit login: 10 intentos / 15 min por IP (anti fuerza bruta) ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// El hosting (cPanel) atiende a través de un proxy (Apache). Sin esto,
// req.ip es la dirección del proxy y TODOS los usuarios compartían un
// mismo cupo del límite por IP. 1 = confiar en un salto de proxy (la IP
// real que agrega Apache, no la que pueda inventar el cliente).
app.set('trust proxy', process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1);

// Al pasar el límite se responde en JSON (antes era texto plano: el
// navegador no lo podía leer, mostraba "The string did not match the
// expected pattern" y la app quedaba sin datos).
const MENSAJE_LIMITE = { error: 'Demasiadas solicitudes en poco tiempo. Espera unos minutos e intenta de nuevo.' };

// ── Fix #9: Rate limit API por IP ──
// Límites pensados contra abuso, no contra el uso normal: cada acción en la
// app hace ~10 solicitudes (la acción + recargar datos), y una sede entera
// puede salir por la misma IP.
const apiLimiterByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: MENSAJE_LIMITE,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// ── Fix #9: Rate limit API por usuario autenticado ──
// FIX SEGURIDAD: el id se toma solo de un token con firma válida. Antes se
// decodificaba sin verificar, y cualquiera podía fabricar un token con el
// id de otro usuario para agotarle el cupo (bloquearlo con 429).
function _usuarioIdVerificado(req) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.id || null;
  } catch {
    return null;
  }
}

const apiLimiterByUser = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: MENSAJE_LIMITE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user_${_usuarioIdVerificado(req)}`,
  skip: (req) => !_usuarioIdVerificado(req),
});

// Rutas
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/skus',         apiLimiterByIp, apiLimiterByUser, skusRoutes);
app.use('/api/movimientos',  apiLimiterByIp, apiLimiterByUser, movimientosRoutes);
app.use('/api/stock-seguridad', apiLimiterByIp, apiLimiterByUser, stockSeguridadRoutes);
// /api/usuarios/me está incluido dentro de usuariosRoutes (Fix crítico #1 — no requiere nivel 4)
app.use('/api/usuarios',     apiLimiterByIp, apiLimiterByUser, usuariosRoutes);
app.use('/api/bodegas',      apiLimiterByIp, apiLimiterByUser, bodegasRoutes);
app.use('/api/ubicaciones',  apiLimiterByIp, apiLimiterByUser, ubicacionesRoutes);
app.use('/api/eventos',      apiLimiterByIp, apiLimiterByUser, eventosRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const { estado } = require('./config/migraciones');
  res.json({ status: 'ok', message: 'MediStock API funcionando', migraciones: estado.migraciones });
});

module.exports = app;
