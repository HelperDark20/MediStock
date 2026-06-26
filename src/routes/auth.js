const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { cedula, password } = req.body;

  if (!cedula || !password) {
    return res.status(400).json({ error: 'Cédula y contraseña requeridas' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE cedula = $1 AND activo = true',
      [cedula]
    );

    // FIX: mismo mensaje sin importar si la cédula existe o no
    // (evita enumeración de usuarios registrados)
    const usuario = result.rows[0];
    const passwordValida = usuario
      ? await bcrypt.compare(password, usuario.password_hash)
      : false;

    if (!usuario || !passwordValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        cedula: usuario.cedula,
        nombre: usuario.nombre,
        nivel: usuario.nivel,
        genero: usuario.genero,
        ubicacion_id: usuario.ubicacion_id || null
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        cedula: usuario.cedula,
        nivel: usuario.nivel,
        genero: usuario.genero,
        ubicacion_id: usuario.ubicacion_id || null
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/auth/me — valida token server-side y devuelve usuario actual
// Usado por checkSession() al recargar la página
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verificar que el usuario sigue activo en la DB
    const result = await pool.query(
      'SELECT id, nombre, cedula, nivel, genero, ubicacion_id FROM usuarios WHERE id = $1 AND activo = true',
      [decoded.id]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }

    res.json({ usuario: result.rows[0] });
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
});

module.exports = router;