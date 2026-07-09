const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// ── Helper: arma personal + depósitos por evento (reutilizado en varias rutas) ──
async function _cargarPersonal(eventoIds) {
  if (!eventoIds.length) return {};
  const usuarios = await pool.query(`
    SELECT eu.evento_id, us.id, us.nombre
    FROM evento_usuarios eu
    JOIN usuarios us ON eu.usuario_id = us.id
    WHERE eu.evento_id = ANY($1::int[])
    ORDER BY us.nombre
  `, [eventoIds]);

  const asignaciones = await pool.query(`
    SELECT eub.evento_id, eub.usuario_id, b.id AS bodega_id, b.nombre AS bodega_nombre
    FROM evento_usuario_bodegas eub
    JOIN bodegas b ON eub.bodega_id = b.id
    WHERE eub.evento_id = ANY($1::int[])
  `, [eventoIds]);

  const porEvento = {};
  eventoIds.forEach(id => { porEvento[id] = []; });
  usuarios.rows.forEach(u => {
    porEvento[u.evento_id].push({
      id: u.id,
      nombre: u.nombre,
      bodegas: asignaciones.rows
        .filter(a => a.evento_id === u.evento_id && a.usuario_id === u.id)
        .map(a => ({ id: a.bodega_id, nombre: a.bodega_nombre }))
    });
  });
  return porEvento;
}

// GET /api/eventos — cualquier nivel autenticado
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
    const personalPorEvento = await _cargarPersonal(ids);
    res.json(eventos.rows.map(e => ({ ...e, personal: personalPorEvento[e.id] || [] })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/eventos/activo — evento en curso asignado al usuario autenticado
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
      FROM evento_usuario_bodegas eub
      JOIN bodegas b ON eub.bodega_id = b.id
      WHERE eub.evento_id = $1 AND eub.usuario_id = $2 AND b.activo = true
    `, [evento.id, req.usuario.id]);

    res.json({ ...evento, bodegas: bodegas.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/eventos/:id — detalle de un evento (nivel 4, usado en el modal de detalle)
router.get('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const eventoRes = await pool.query(`
      SELECT e.*, u.nombre AS ubicacion_nombre
      FROM eventos e
      LEFT JOIN ubicaciones u ON e.ubicacion_id = u.id
      WHERE e.id = $1 AND e.activo = true
    `, [req.params.id]);
    if (!eventoRes.rows.length) return res.status(404).json({ error: 'Evento no encontrado' });
    const evento = eventoRes.rows[0];
    const personalPorEvento = await _cargarPersonal([evento.id]);
    res.json({ ...evento, personal: personalPorEvento[evento.id] || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/eventos — nivel 4 — SOLO datos del evento, sin enfermeros
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, fecha_inicio, fecha_fin, ubicacion_id } = req.body;
  if (!nombre || !fecha_inicio || !fecha_fin || !ubicacion_id) {
    return res.status(400).json({ error: 'Nombre, fechas y ubicación son obligatorios' });
  }
  if (new Date(fecha_fin) < new Date(fecha_inicio)) {
    return res.status(400).json({ error: 'La fecha de finalización no puede ser anterior a la de inicio' });
  }
  try {
    const evento = await pool.query(
      `INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, ubicacion_id, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre.trim(), fecha_inicio, fecha_fin, ubicacion_id, req.usuario.id]
    );
    res.status(201).json(evento.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el evento' });
  }
});

// PUT /api/eventos/:id — nivel 4 — editar datos del evento
// Si cambia la ubicación, se limpian los depósitos ya asignados a cada
// enfermero (pertenecían a la sede anterior y podrían no existir en la nueva).
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, fecha_inicio, fecha_fin, ubicacion_id } = req.body;
  if (!nombre || !fecha_inicio || !fecha_fin || !ubicacion_id) {
    return res.status(400).json({ error: 'Nombre, fechas y ubicación son obligatorios' });
  }
  if (new Date(fecha_fin) < new Date(fecha_inicio)) {
    return res.status(400).json({ error: 'La fecha de finalización no puede ser anterior a la de inicio' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT ubicacion_id, estado FROM eventos WHERE id = $1 AND activo = true', [req.params.id]
    );
    if (!actual.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (actual.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }

    const cambioUbicacion = actual.rows[0].ubicacion_id !== ubicacion_id;

    const result = await client.query(
      `UPDATE eventos SET nombre = $1, fecha_inicio = $2, fecha_fin = $3, ubicacion_id = $4
       WHERE id = $5 RETURNING *`,
      [nombre.trim(), fecha_inicio, fecha_fin, ubicacion_id, req.params.id]
    );

    if (cambioUbicacion) {
      await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1', [req.params.id]);
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], bodegas_reiniciadas: cambioUbicacion });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el evento' });
  } finally {
    client.release();
  }
});

// POST /api/eventos/:id/enfermeros — nivel 4 — agregar enfermero al evento
// body: { usuario_id, bodega_ids?: [...] }
router.post('/:id/enfermeros', verificarToken, verificarNivel(4), async (req, res) => {
  const { usuario_id, bodega_ids } = req.body;
  if (!usuario_id) return res.status(400).json({ error: 'Selecciona un enfermero' });
  const bodegas = Array.isArray(bodega_ids) ? bodega_ids : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado FROM eventos WHERE id = $1 AND activo = true', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }

    await client.query(
      'INSERT INTO evento_usuarios (evento_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, usuario_id]
    );
    for (const bid of bodegas) {
      await client.query(
        'INSERT INTO evento_usuario_bodegas (evento_id, usuario_id, bodega_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.params.id, usuario_id, bid]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Enfermero agregado al evento' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al agregar el enfermero' });
  } finally {
    client.release();
  }
});

// PUT /api/eventos/:id/enfermeros/:usuarioId — nivel 4 — reemplaza los
// depósitos asignados a ESE enfermero dentro del evento
// body: { bodega_ids: [...] }
router.put('/:id/enfermeros/:usuarioId', verificarToken, verificarNivel(4), async (req, res) => {
  const { bodega_ids } = req.body;
  const bodegas = Array.isArray(bodega_ids) ? bodega_ids : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado FROM eventos WHERE id = $1 AND activo = true', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }
    const miembro = await client.query(
      'SELECT 1 FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2',
      [req.params.id, req.params.usuarioId]
    );
    if (!miembro.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ese enfermero no pertenece a este evento' });
    }

    await client.query(
      'DELETE FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2',
      [req.params.id, req.params.usuarioId]
    );
    for (const bid of bodegas) {
      await client.query(
        'INSERT INTO evento_usuario_bodegas (evento_id, usuario_id, bodega_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.params.id, req.params.usuarioId, bid]
      );
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Depósitos actualizados' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar los depósitos' });
  } finally {
    client.release();
  }
});

// DELETE /api/eventos/:id/enfermeros/:usuarioId — nivel 4 — quitar del evento
router.delete('/:id/enfermeros/:usuarioId', verificarToken, verificarNivel(4), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado FROM eventos WHERE id = $1 AND activo = true', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }
    await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2', [req.params.id, req.params.usuarioId]);
    await client.query('DELETE FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2', [req.params.id, req.params.usuarioId]);
    await client.query('COMMIT');
    res.json({ mensaje: 'Enfermero removido del evento' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al remover el enfermero' });
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