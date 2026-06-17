const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/ubicaciones — todos los niveles
router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*,
             COUNT(b.id) FILTER (WHERE b.activo = true) AS total_depositos
      FROM ubicaciones u
      LEFT JOIN bodegas b ON b.ubicacion_id = u.id
      WHERE u.activo = true
      GROUP BY u.id
      ORDER BY u.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/ubicaciones — nivel 4
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const nombreUpper = nombre.trim().toUpperCase();
  try {
    const existe = await pool.query('SELECT id FROM ubicaciones WHERE UPPER(nombre) = $1', [nombreUpper]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Esta ubicación ya existe' });
    const result = await pool.query(
      'INSERT INTO ubicaciones (nombre) VALUES ($1) RETURNING *', [nombreUpper]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/ubicaciones/:id — nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    // Verificar que no tenga depósitos activos
    const depositos = await pool.query(
      'SELECT COUNT(*) FROM bodegas WHERE ubicacion_id = $1 AND activo = true', [req.params.id]
    );
    if (parseInt(depositos.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Elimina primero todos los depósitos de esta ubicación' });
    }
    await pool.query('UPDATE ubicaciones SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Ubicación eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;