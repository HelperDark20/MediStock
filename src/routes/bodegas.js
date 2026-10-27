const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/bodegas — todos los niveles, incluye nombre de ubicación
router.get('/', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, u.nombre AS ubicacion_nombre, u.es_temporal AS ubicacion_es_temporal,
             uo.nombre AS ubicacion_origen_nombre,
             sg.nombre AS stock_seguridad_nombre
      FROM bodegas b
      LEFT JOIN ubicaciones u  ON b.ubicacion_id = u.id
      LEFT JOIN ubicaciones uo ON b.ubicacion_origen_id = uo.id
      LEFT JOIN stock_seguridad_grupos sg ON b.stock_seguridad_grupo_id = sg.id AND sg.activo = true
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
    // Los depósitos nacen en una sede permanente; a una temporal solo se
    // prestan (al finalizarla no tendrían a dónde volver)
    const ub = await pool.query(
      'SELECT es_temporal FROM ubicaciones WHERE id = $1 AND activo = true', [ubicacion_id]
    );
    if (!ub.rows.length) return res.status(400).json({ error: 'Ubicación no encontrada' });
    if (ub.rows[0].es_temporal) {
      return res.status(400).json({ error: 'No se crean depósitos en una ubicación temporal: préstale depósitos de una sede permanente' });
    }
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

// PUT /api/bodegas/:id — nivel 4 — renombrar (tipo y sufijo) y asignar su
// stock de seguridad (stock_seguridad_grupo_id: id de un grupo o null). Stock,
// movimientos y asignaciones de eventos usan bodega_id, así que se conservan.
// La ubicación no se cambia aquí: un depósito solo sale de su sede prestado
// a una ubicación temporal (ver routes/ubicaciones.js).
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { tipo, sufijo } = req.body;
  if (!tipo || !String(tipo).trim() || !sufijo || !String(sufijo).trim()) {
    return res.status(400).json({ error: 'Tipo y nombre del depósito son requeridos' });
  }
  const tipoUpper = String(tipo).trim().toUpperCase();
  const nombre = `${tipoUpper}-${String(sufijo).trim().toUpperCase()}`;
  const grupoRaw = req.body.stock_seguridad_grupo_id;
  const grupoId = grupoRaw === null || grupoRaw === '' || grupoRaw === undefined ? null : parseInt(grupoRaw);
  if (grupoRaw !== undefined && grupoId !== null && !(grupoId > 0)) {
    return res.status(400).json({ error: 'Stock de seguridad inválido' });
  }
  try {
    const existe = await pool.query('SELECT id FROM bodegas WHERE nombre = $1 AND id <> $2', [nombre, req.params.id]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Ya existe un depósito con ese nombre' });
    if (grupoId) {
      const g = await pool.query('SELECT 1 FROM stock_seguridad_grupos WHERE id = $1 AND activo = true', [grupoId]);
      if (!g.rows.length) return res.status(400).json({ error: 'Ese stock de seguridad ya no existe' });
    }
    // Sin stock_seguridad_grupo_id en el body, la asignación no se toca
    const result = grupoRaw === undefined
      ? await pool.query(
          'UPDATE bodegas SET nombre = $1, tipo = $2 WHERE id = $3 AND activo = true RETURNING *',
          [nombre, tipoUpper, req.params.id])
      : await pool.query(
          'UPDATE bodegas SET nombre = $1, tipo = $2, stock_seguridad_grupo_id = $3 WHERE id = $4 AND activo = true RETURNING *',
          [nombre, tipoUpper, grupoId, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Depósito no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/bodegas/:id — nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const prestado = await pool.query(
      'SELECT 1 FROM bodegas WHERE id = $1 AND ubicacion_origen_id IS NOT NULL', [req.params.id]
    );
    if (prestado.rows.length) {
      return res.status(400).json({ error: 'Este depósito está prestado a una ubicación temporal. Devuélvelo antes de eliminarlo.' });
    }
    // FIX: no permitir eliminar un depósito con stock — ese stock dejaba de
    // aparecer en los listados (se filtran depósitos inactivos)
    const conStock = await pool.query(
      'SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE bodega_id = $1 AND cantidad > 0',
      [req.params.id]
    );
    if (Number(conStock.rows[0].total) > 0) {
      return res.status(400).json({ error: 'Este depósito todavía tiene stock. Trasládalo antes de eliminarlo.' });
    }
    await pool.query('UPDATE bodegas SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Depósito eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;