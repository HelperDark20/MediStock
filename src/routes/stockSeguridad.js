const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/stock-seguridad — nivel 4 — devuelve todos los grupos con sus ítems anidados
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const grupos = await pool.query(
      'SELECT id, nombre, patron_tokens FROM stock_seguridad_grupos WHERE activo = true ORDER BY nombre'
    );
    if (!grupos.rows.length) return res.json([]);
    const ids = grupos.rows.map(g => g.id);
    const items = await pool.query(
      'SELECT grupo_id, item_nombre, cantidad_esperada FROM stock_seguridad_items WHERE grupo_id = ANY($1::int[]) ORDER BY item_nombre',
      [ids]
    );
    const porGrupo = {};
    ids.forEach(id => { porGrupo[id] = []; });
    items.rows.forEach(it => porGrupo[it.grupo_id].push({
      item_nombre: it.item_nombre,
      cantidad_esperada: it.cantidad_esperada
    }));
    res.json(grupos.rows.map(g => ({ ...g, items: porGrupo[g.id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;