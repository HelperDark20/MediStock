const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/stock-seguridad — nivel 4
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const grupos = await pool.query(
      'SELECT id, nombre, patron_tokens FROM stock_seguridad_grupos WHERE activo = true ORDER BY nombre'
    );
    if (!grupos.rows.length) return res.json([]);
    const ids = grupos.rows.map(g => g.id);
    const items = await pool.query(
      'SELECT id, grupo_id, item_nombre, cantidad_esperada FROM stock_seguridad_items WHERE grupo_id = ANY($1::int[]) ORDER BY item_nombre',
      [ids]
    );
    const porGrupo = {};
    ids.forEach(id => { porGrupo[id] = []; });
    items.rows.forEach(it => porGrupo[it.grupo_id].push({
      id: it.id,
      item_nombre: it.item_nombre,
      cantidad_esperada: it.cantidad_esperada
    }));
    res.json(grupos.rows.map(g => ({ ...g, items: porGrupo[g.id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/stock-seguridad/grupos — nivel 4 — crear grupo nuevo
router.post('/grupos', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, patron_tokens } = req.body;
  if (!nombre || !Array.isArray(patron_tokens) || !patron_tokens.length) {
    return res.status(400).json({ error: 'Nombre y patrón de tokens son obligatorios' });
  }
  const tokensUpper = patron_tokens.map(t => String(t).trim().toUpperCase()).filter(Boolean);
  try {
    const existe = await pool.query('SELECT id FROM stock_seguridad_grupos WHERE UPPER(nombre) = UPPER($1) AND activo = true', [nombre.trim()]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });

    const result = await pool.query(
      `INSERT INTO stock_seguridad_grupos (nombre, patron_tokens) VALUES ($1, $2) RETURNING id, nombre, patron_tokens`,
      [nombre.trim(), JSON.stringify(tokensUpper)]
    );
    res.status(201).json({ ...result.rows[0], items: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el grupo' });
  }
});

// PUT /api/stock-seguridad/grupos/:id — nivel 4 — editar nombre/patrón
router.put('/grupos/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, patron_tokens } = req.body;
  if (!nombre || !Array.isArray(patron_tokens) || !patron_tokens.length) {
    return res.status(400).json({ error: 'Nombre y patrón de tokens son obligatorios' });
  }
  const tokensUpper = patron_tokens.map(t => String(t).trim().toUpperCase()).filter(Boolean);
  try {
    const result = await pool.query(
      `UPDATE stock_seguridad_grupos SET nombre = $1, patron_tokens = $2 WHERE id = $3 AND activo = true RETURNING id, nombre, patron_tokens`,
      [nombre.trim(), JSON.stringify(tokensUpper), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el grupo' });
  }
});

// DELETE /api/stock-seguridad/grupos/:id — nivel 4 — soft delete (arrastra sus ítems)
router.delete('/grupos/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query('UPDATE stock_seguridad_grupos SET activo = false WHERE id = $1 AND activo = true RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ mensaje: 'Grupo eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/stock-seguridad/items — nivel 4 — añadir ítem a un grupo (referencia a SKU Global por nombre)
router.post('/items', verificarToken, verificarNivel(4), async (req, res) => {
  const { grupo_id, item_nombre, cantidad_esperada } = req.body;
  if (!grupo_id || !item_nombre || cantidad_esperada === undefined || cantidad_esperada === null || isNaN(cantidad_esperada) || Number(cantidad_esperada) < 0) {
    return res.status(400).json({ error: 'Grupo, ítem y cantidad esperada (0 o mayor) son obligatorios' });
  }
  try {
    const grupo = await pool.query('SELECT id FROM stock_seguridad_grupos WHERE id = $1 AND activo = true', [grupo_id]);
    if (!grupo.rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });

    const existe = await pool.query(
      'SELECT id FROM stock_seguridad_items WHERE grupo_id = $1 AND UPPER(item_nombre) = UPPER($2)',
      [grupo_id, item_nombre]
    );
    if (existe.rows.length) return res.status(400).json({ error: 'Este ítem ya está en la lista de este grupo' });

    const result = await pool.query(
      `INSERT INTO stock_seguridad_items (grupo_id, item_nombre, cantidad_esperada) VALUES ($1, $2, $3) RETURNING id, grupo_id, item_nombre, cantidad_esperada`,
      [grupo_id, item_nombre.trim(), Math.round(Number(cantidad_esperada))]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar el ítem' });
  }
});

// PUT /api/stock-seguridad/items/:id — nivel 4 — editar SOLO la cantidad esperada
router.put('/items/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { cantidad_esperada } = req.body;
  if (cantidad_esperada === undefined || cantidad_esperada === null || isNaN(cantidad_esperada) || Number(cantidad_esperada) < 0) {
    return res.status(400).json({ error: 'Ingresa una cantidad esperada válida (0 o mayor)' });
  }
  try {
    const result = await pool.query(
      `UPDATE stock_seguridad_items SET cantidad_esperada = $1 WHERE id = $2 RETURNING id, grupo_id, item_nombre, cantidad_esperada`,
      [Math.round(Number(cantidad_esperada)), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el ítem' });
  }
});

// DELETE /api/stock-seguridad/items/:id — nivel 4
router.delete('/items/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM stock_seguridad_items WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json({ mensaje: 'Ítem eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;