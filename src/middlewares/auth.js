const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// FIX SEGURIDAD: además de validar la firma del token, se consulta la DB
// en cada petición. Así un usuario desactivado pierde el acceso de
// inmediato, y si se le cambia el nivel, el nuevo nivel aplica ya
// (antes conservaba el nivel del token hasta 8 h).
const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }

  try {
    const result = await pool.query(
      'SELECT id, cedula, nombre, nivel, genero, ubicacion_id FROM usuarios WHERE id = $1 AND activo = true',
      [decoded.id]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }
    req.usuario = { ...decoded, ...result.rows[0] };
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
};

const verificarNivel = (nivelMinimo) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (req.usuario.nivel < nivelMinimo) {
      return res.status(403).json({
        error: `Se requiere nivel ${nivelMinimo} o superior`
      });
    }
    next();
  };
};

module.exports = { verificarToken, verificarNivel };
