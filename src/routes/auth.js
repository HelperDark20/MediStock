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

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Cédula no encontrada' });
    }

    const usuario = result.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordValida) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
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

module.exports = router;