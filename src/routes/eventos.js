const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/eventos — cualquier nivel autenticado
// (el dashboard muestra "eventos en curso" a todos los roles)
router.get('/', verificarToken, async (req, res) => {
  try {
    const eventos = await pool.query(`
      SELECT e.*, u.nombre AS ubicacion_nombre
      FROM eventos e
      LEFT JOIN ubicaciones u ON e.ubicacion_id = u.id
      WHERE e.activo = true
      ORDER BY
        CASE e.estado WHEN 'en_curso' THEN 0 WHEN 'creado' THEN 1 ELSE 2 END,
        e.fecha_inicio DESC
    `);

    if (!eventos.rows.length) return res.json([]);

    const ids = eventos.rows.map(e => e.id);

    const usuarios = await pool.query(`
      SELECT eu.evento_id, us.id, us.nombre
      FROM evento_usuarios eu
      JOIN usuarios us ON eu.usuario_id = us.id
      WHERE eu.evento_id = ANY($1::int[])
    `, [ids]);

    const bodegas = await pool.query(`
      SELECT eb.evento_id, b.id, b.nombre
      FROM evento_bodegas eb
      JOIN bodegas b ON eb.bodega_id = b.id
      WHERE eb.evento_id = ANY($1::int[])
    `, [ids]);

    const result = eventos.rows.map(e => ({
      ...e,
      personal: usuarios.rows.filter(u => u.evento_id === e.id).map(u => ({ id: u.id, nombre: u.nombre })),
      bodegas: bodegas.rows.filter(b => b.evento_id === e.id).map(b => ({ id: b.id, nombre: b.nombre }))
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/eventos/activo — evento en curso asignado al usuario autenticado
// (usado por el panel de Enfermero para saber qué depósitos puede usar)
router.get('/activo', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, u.nombre AS ubicacion_nombre
      FROM eventos e
      JOIN evento_usuarios eu ON eu.evento_id = e.id
      LEFT JOIN ubicaciones u ON e.ubicacion_id = u.id
      WHERE eu.usuario_id = $1 AND e.estado = 'en_curso' AND e.activo = true
      ORDER BY e.iniciado_at DESC
      LIMIT 1
    `, [req.usuario.id]);

    if (!result.rows.length) return res.json(null);

    const evento = result.rows[0];
    const bodegas = await pool.query(`
      SELECT b.id, b.nombre
      FROM evento_bodegas eb
      JOIN bodegas b ON eb.bodega_id = b.id
      WHERE eb.evento_id = $1 AND b.activo = true
    `, [evento.id]);

    res.json({ ...evento, bodegas: bodegas.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/eventos — nivel 4
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, fecha_inicio, fecha_fin, ubicacion_id, usuario_ids, bodega_ids } = req.body;

  if (!nombre || !fecha_inicio || !fecha_fin || !ubicacion_id) {
    return res.status(400).json({ error: 'Nombre, fechas y ubicación son obligatorios' });
  }
  if (!Array.isArray(usuario_ids) || !usuario_ids.length) {
    return res.status(400).json({ error: 'Selecciona al menos un enfermero' });
  }
  if (!Array.isArray(bodega_ids) || !bodega_ids.length) {
    return res.status(400).json({ error: 'Selecciona al menos un depósito' });
  }
  if (new Date(fecha_fin) < new Date(fecha_inicio)) {
    return res.status(400).json({ error: 'La fecha de finalización no puede ser anterior a la de inicio' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const evento = await client.query(
      `INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, ubicacion_id, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre.trim(), fecha_inicio, fecha_fin, ubicacion_id, req.usuario.id]
    );
    const eventoId = evento.rows[0].id;

    for (const uid of usuario_ids) {
      await client.query(
        'INSERT INTO evento_usuarios (evento_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [eventoId, uid]
      );
    }
    for (const bid of bodega_ids) {
      await client.query(
        'INSERT INTO evento_bodegas (evento_id, bodega_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [eventoId, bid]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(evento.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al crear el evento' });
  } finally {
    client.release();
  }
});

// POST /api/eventos/:id/iniciar — nivel 4
router.post('/:id/iniciar', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE eventos SET estado = 'en_curso', iniciado_at = NOW()
       WHERE id = $1 AND activo = true AND estado = 'creado' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'El evento no se puede iniciar (ya está en curso o finalizado)' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/eventos/:id/finalizar — nivel 4
router.post('/:id/finalizar', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE eventos SET estado = 'finalizado', finalizado_at = NOW()
       WHERE id = $1 AND activo = true AND estado = 'en_curso' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'El evento no está en curso' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/eventos/:id — nivel 4 (soft delete; no permite borrar un evento en curso)
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE eventos SET activo = false WHERE id = $1 AND estado != 'en_curso' RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'No puedes eliminar un evento en curso' });
    }
    res.json({ mensaje: 'Evento eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
