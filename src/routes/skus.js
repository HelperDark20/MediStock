const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/skus/globales
router.get('/globales', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM skus_globales WHERE activo = true ORDER BY codigo'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/skus/globales — nivel 4
router.post('/globales', verificarToken, verificarNivel(4), async (req, res) => {
  const { codigo, nombre, familia, subgrupo, precio, campos } = req.body;
  if (!codigo || !nombre || !familia || !subgrupo) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  try {
    const existe = await pool.query(
      'SELECT id FROM skus_globales WHERE codigo = $1', [codigo]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Este SKU ya existe' });
    }
    const result = await pool.query(
      `INSERT INTO skus_globales (codigo, nombre, familia, subgrupo, precio, campos)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [codigo, nombre, familia, subgrupo, precio||0, JSON.stringify(campos || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/skus/globales/:id — nivel 4
router.delete('/globales/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query('UPDATE skus_globales SET activo = false WHERE id = $1', [req.params.id]);
    await pool.query('UPDATE sub_skus SET activo = false WHERE sku_global_id = $1', [req.params.id]);
    res.json({ mensaje: 'SKU Global desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/skus/sub
router.get('/sub', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, g.codigo as sku_global, g.nombre as nombre_global,
              g.familia, g.subgrupo
       FROM sub_skus s
       JOIN skus_globales g ON s.sku_global_id = g.id
       WHERE s.activo = true
       ORDER BY g.codigo, s.sub_sku`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/skus/sub — nivel 3 y 4
router.post('/sub', verificarToken, verificarNivel(3), async (req, res) => {
  const { sku_global_id, proveedor, lote, invima, caducidad, unidad, precio, sub_sku_manual } = req.body;
  if (!sku_global_id || !unidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const abrevProv = (str) => {
    if (!str) return null;
    const words = str.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return str.replace(/[^a-zA-Z0-9]/g,'').substring(0,4).toUpperCase();
    return words.map(w => w[0]?.toUpperCase() || '').join('').substring(0,4).padEnd(4,'X');
  };

  // Construir sub_sku dinámicamente según lo que venga
  let partes = [];
  if (proveedor) partes.push(abrevProv(proveedor));
  if (lote)      partes.push(lote.toUpperCase());
  if (sub_sku_manual) partes.push(sub_sku_manual.toUpperCase());
  if (!partes.length) partes.push('GEN'); // fallback si nada activo

  const sub_sku = partes.join('-');

  try {
    const existe = await pool.query(
      'SELECT * FROM sub_skus WHERE sub_sku = $1 AND sku_global_id = $2 AND activo = true',
      [sub_sku, sku_global_id]
    );
    if (existe.rows.length > 0) {
      return res.json({ ...existe.rows[0], ya_existe: true });
    }
    const result = await pool.query(
      `INSERT INTO sub_skus (sku_global_id, sub_sku, proveedor, lote, invima, caducidad, unidad, precio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [sku_global_id, sub_sku, proveedor||null, lote||null, invima||null, caducidad||null, unidad, precio||0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/skus/stock
router.get('/stock', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT st.sub_sku_id,
              COALESCE(st.bodega_id, NULL) as bodega_id,
              COALESCE(st.cantidad, 0) as cantidad,
              s.id as sub_sku_id,
              s.sku_global_id,
              s.sub_sku,
              s.proveedor,
              s.lote,
              s.caducidad,
              s.unidad,
              s.precio,
              s.serial,
              g.codigo as sku_global,
              g.nombre,
              g.familia,
              g.subgrupo,
              b.nombre as bodega_nombre
       FROM sub_skus s
       JOIN skus_globales g ON s.sku_global_id = g.id
       LEFT JOIN stock st ON st.sub_sku_id = s.id
       LEFT JOIN bodegas b ON st.bodega_id = b.id AND b.activo = true
       WHERE s.activo = true
       ORDER BY g.codigo, b.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/skus/sub/:id — nivel 4
router.delete('/sub/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query('UPDATE sub_skus SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Sub-SKU desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;