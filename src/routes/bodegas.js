const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/bodegas — todos los niveles
router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bodegas WHERE activo = true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/bodegas — solo nivel 4
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { tipo, sufijo } = req.body;
  if (!tipo || !sufijo) {
    return res.status(400).json({ error: 'Tipo y sufijo requeridos' });
  }
  const nombre = `${tipo}-${sufijo.toUpperCase()}`;
  try {
    const existe = await pool.query(
      'SELECT id FROM bodegas WHERE nombre = $1', [nombre]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Esta ubicación ya existe' });
    }
    const result = await pool.query(
      'INSERT INTO bodegas (nombre, tipo) VALUES ($1, $2) RETURNING *',
      [nombre, tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/bodegas/:id — solo nivel 4
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre } = req.body;
  try {
    const result = await pool.query(
      'UPDATE bodegas SET nombre = $1 WHERE id = $2 RETURNING *',
      [nombre, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bodega no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/bodegas/:id — solo nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query(
      'UPDATE bodegas SET activo = false WHERE id = $1', [req.params.id]
    );
    res.json({ mensaje: 'Bodega desactivada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;