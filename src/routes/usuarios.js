const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

const NIVELES_VALIDOS = [1, 2, 3, 4];

// GET /api/usuarios/me — cualquier nivel autenticado
router.get('/me', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.cedula, u.nivel, u.genero, u.ubicacion_id,
              ub.nombre AS ubicacion_nombre
       FROM usuarios u
       LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
       WHERE u.id = $1 AND u.activo = true`,
      [req.usuario.id]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/usuarios — nivel 4
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.cedula, u.nivel, u.genero, u.fecha_nacimiento,
              u.activo, u.ubicacion_id, ub.nombre AS ubicacion_nombre
       FROM usuarios u
       LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
       WHERE u.activo = true ORDER BY u.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/usuarios — nivel 4
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, cedula, nivel, genero, fecha_nacimiento, password, ubicacion_id } = req.body;
  if (!nombre || !cedula || !nivel || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  // FIX SEGURIDAD: validar que nivel esté en rango permitido
  if (!NIVELES_VALIDOS.includes(parseInt(nivel))) {
    return res.status(400).json({ error: 'Nivel inválido. Debe ser 1, 2, 3 o 4' });
  }
  try {
    const existe = await pool.query('SELECT id, activo FROM usuarios WHERE cedula = $1', [cedula]);
    if (existe.rows.length > 0 && existe.rows[0].activo) {
      return res.status(400).json({ error: 'Esta cédula ya está registrada' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    let result;
    if (existe.rows.length > 0 && !existe.rows[0].activo) {
      result = await pool.query(
        `UPDATE usuarios SET nombre=$1, nivel=$2, genero=$3, fecha_nacimiento=$4,
        password_hash=$5, ubicacion_id=$6, activo=true
        WHERE cedula=$7
        RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
        [nombre, parseInt(nivel), genero, fecha_nacimiento, password_hash, ubicacion_id || null, cedula]
      );
    } else {
      result = await pool.query(
        `INSERT INTO usuarios (nombre, cedula, nivel, genero, fecha_nacimiento, password_hash, ubicacion_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
        [nombre, cedula, parseInt(nivel), genero, fecha_nacimiento, password_hash, ubicacion_id || null]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/usuarios/:id — nivel 4
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, nivel, genero, password, ubicacion_id } = req.body;
  // FIX SEGURIDAD: validar nivel si se está cambiando
  if (nivel !== undefined && !NIVELES_VALIDOS.includes(parseInt(nivel))) {
    return res.status(400).json({ error: 'Nivel inválido. Debe ser 1, 2, 3 o 4' });
  }
  try {
    let password_hash = null;
    if (password) {
      password_hash = await bcrypt.hash(password, 10);
    }
    const result = await pool.query(
      `UPDATE usuarios SET
        nombre       = COALESCE($1, nombre),
        nivel        = COALESCE($2, nivel),
        genero       = COALESCE($3, genero),
        ubicacion_id = $4,
        password_hash = CASE WHEN $5::text IS NOT NULL THEN $5::text ELSE password_hash END
       WHERE id = $6 AND activo = true
       RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
      [nombre || null, nivel ? parseInt(nivel) : null, genero || null, ubicacion_id || null, password_hash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/usuarios/:id — nivel 4 (soft delete)
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }
    const result = await pool.query(
      'UPDATE usuarios SET activo = false WHERE id = $1 AND activo = true RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado o ya desactivado' });
    }
    res.json({ mensaje: 'Usuario desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;