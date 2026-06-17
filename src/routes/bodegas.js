const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/bodegas — todos los niveles, incluye nombre de ubicación
router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, u.nombre AS ubicacion_nombre
      FROM bodegas b
      LEFT JOIN ubicaciones u ON b.ubicacion_id = u.id
      WHERE b.activo = true
      ORDER BY u.nombre, b.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/bodegas — nivel 4, ahora requiere ubicacion_id
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { tipo, sufijo, ubicacion_id } = req.body;
  if (!tipo || !sufijo || !ubicacion_id) {
    return res.status(400).json({ error: 'Tipo, sufijo y ubicación son requeridos' });
  }
  const nombre = `${tipo.toUpperCase()}-${sufijo.toUpperCase()}`;
  try {
    const existe = await pool.query('SELECT id FROM bodegas WHERE nombre = $1', [nombre]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Este depósito ya existe' });
    const result = await pool.query(
      'INSERT INTO bodegas (nombre, tipo, ubicacion_id) VALUES ($1, $2, $3) RETURNING *',
      [nombre, tipo.toUpperCase(), ubicacion_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/bodegas/:id — nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query('UPDATE bodegas SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Depósito eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;