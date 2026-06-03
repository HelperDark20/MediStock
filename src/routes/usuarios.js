const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/usuarios — nivel 4
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, cedula, nivel, genero, fecha_nacimiento, activo 
       FROM usuarios WHERE activo = true ORDER BY nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/usuarios — nivel 4
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, cedula, nivel, genero, fecha_nacimiento, password } = req.body;
  if (!nombre || !cedula || !nivel || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  try {
    const existe = await pool.query(
      'SELECT id FROM usuarios WHERE cedula = $1', [cedula]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Esta cédula ya está registrada' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (nombre, cedula, nivel, genero, fecha_nacimiento, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, cedula, nivel, genero`,
      [nombre, cedula, nivel, genero, fecha_nacimiento, password_hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/usuarios/:id — nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query(
      'UPDATE usuarios SET activo = false WHERE id = $1', [req.params.id]
    );
    res.json({ mensaje: 'Usuario desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;