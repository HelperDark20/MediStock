const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/movimientos — todos los niveles
router.get('/', verificarToken, async (req, res) => {
  const { sku_global, sub_sku_id, bodega } = req.query;
  // FIX SEGURIDAD: cap máximo de 1000 para evitar DoS por limit arbitrario
  const requestedLimit = parseInt(req.query.limit) || 500;
  const limit = Math.min(requestedLimit, 1000);

  try {
    let query = `
      SELECT m.*,
             g.codigo  AS sku_global_codigo,
             g.nombre  AS nombre,
             s.sub_sku,
             s.unidad,
             bo.nombre AS origen_nombre,
             bd.nombre AS destino_nombre,
             COALESCE(m.usuario_nombre, u.nombre) AS usuario_nombre,
             u.nivel                               AS usuario_nivel
      FROM movimientos m
      JOIN sub_skus s      ON m.sub_sku_id = s.id
      JOIN skus_globales g ON s.sku_global_id = g.id
      LEFT JOIN bodegas bo ON m.bodega_origen_id  = bo.id
      LEFT JOIN bodegas bd ON m.bodega_destino_id = bd.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (sku_global) {
      params.push(sku_global);
      query += ` AND g.codigo = $${params.length}`;
    }
    if (sub_sku_id) {
      params.push(sub_sku_id);
      query += ` AND m.sub_sku_id = $${params.length}`;
    }
    if (bodega) {
      params.push(bodega);
      query += ` AND (bo.nombre = $${params.length} OR bd.nombre = $${params.length})`;
    }

    query += ' ORDER BY m.created_at DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/movimientos/reportes — nivel 4 — sin el tope de 1000 del historial normal,
// pensado para reportes que necesitan ver todo el histórico o rangos de fecha amplios
router.get('/reportes', verificarToken, verificarNivel(4), async (req, res) => {
  const { tipo, fecha_inicio, fecha_fin, ubicacion_id, bodega, cedula_paciente } = req.query;
  try {
    let query = `
      SELECT m.*,
             g.codigo   AS sku_global_codigo,
             g.nombre   AS nombre,
             s.sub_sku,
             s.unidad,
             s.precio,
             bo.nombre  AS origen_nombre,
             bd.nombre  AS destino_nombre,
             bo.ubicacion_id AS origen_ubicacion_id,
             ubo.nombre AS origen_ubicacion_nombre,
             COALESCE(m.usuario_nombre, u.nombre) AS usuario_nombre,
             u.nivel                               AS usuario_nivel
      FROM movimientos m
      JOIN sub_skus s      ON m.sub_sku_id = s.id
      JOIN skus_globales g ON s.sku_global_id = g.id
      LEFT JOIN bodegas bo      ON m.bodega_origen_id  = bo.id
      LEFT JOIN bodegas bd      ON m.bodega_destino_id = bd.id
      LEFT JOIN ubicaciones ubo ON bo.ubicacion_id = ubo.id
      LEFT JOIN usuarios u      ON m.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (tipo) {
      params.push(tipo);
      query += ` AND m.tipo = $${params.length}`;
    }
    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND (m.created_at AT TIME ZONE 'America/Bogota') >= $${params.length}::date`;
    }
    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND (m.created_at AT TIME ZONE 'America/Bogota') < ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (ubicacion_id) {
      params.push(ubicacion_id);
      query += ` AND bo.ubicacion_id = $${params.length}`;
    }
    if (bodega) {
      params.push(bodega);
      query += ` AND bo.nombre = $${params.length}`;
    }
    if (cedula_paciente) {
      params.push(String(cedula_paciente).replace(/\D/g, ''));
      query += ` AND m.cedula_paciente = $${params.length}`;
    }

    query += ' ORDER BY m.created_at DESC LIMIT 20000';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor al generar el reporte' });
  }
});

// POST /api/movimientos/entrada — nivel 3 y 4
router.post('/entrada', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_destino_id, cantidad } = req.body;
  if (!sub_sku_id || !bodega_destino_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_destino_id, cantidad, usuario_id, usuario_nombre)
       VALUES ($1, 'compra', $2, $3, $4, $5)`,
      [sub_sku_id, bodega_destino_id, cantidad, req.usuario.id, req.usuario.nombre]
    );
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [sub_sku_id, bodega_destino_id, cantidad]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Entrada registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/consumo — nivel 2, 3 y 4
router.post('/consumo', verificarToken, verificarNivel(2), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, cantidad, cedula_paciente } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  // FIX: sanitizar cedula_paciente — solo dígitos
  const cedulaPacienteVal = cedula_paciente
    ? String(cedula_paciente).replace(/\D/g, '') || null
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, cedula_paciente)
       VALUES ($1, 'consumo', $2, $3, $4, $5, $6)`,
      [sub_sku_id, bodega_origen_id, cantidad, req.usuario.id, req.usuario.nombre, cedulaPacienteVal]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Consumo registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/traslado — nivel 3 y 4
router.post('/traslado', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, bodega_destino_id, cantidad } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !bodega_destino_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (bodega_origen_id === bodega_destino_id) {
    return res.status(400).json({ error: 'Origen y destino son iguales' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente en origen' });
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad, usuario_id, usuario_nombre)
       VALUES ($1, 'traslado', $2, $3, $4, $5, $6)`,
      [sub_sku_id, bodega_origen_id, bodega_destino_id, cantidad, req.usuario.id, req.usuario.nombre]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [sub_sku_id, bodega_destino_id, cantidad]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Traslado registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/destruccion — nivel 3 y 4
router.post('/destruccion', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, cantidad, motivo } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, cantidad, motivo, usuario_id, usuario_nombre)
       VALUES ($1, 'destruccion', $2, $3, $4, $5, $6)`,
      [sub_sku_id, bodega_origen_id, cantidad, motivo, req.usuario.id, req.usuario.nombre]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Destrucción registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/contingencia — nivel 4
//
// El Administrador transcribe un movimiento (consumo/traslado/destrucción)
// que el enfermero registró en papel durante una contingencia de
// conectividad. A diferencia de los endpoints normales:
//   - usuario_id/usuario_nombre del movimiento son del ENFERMERO que
//     atendió (no de quien hace el POST), para no romper trazabilidad
//     ni el historial "Mis consumos de hoy" del panel enfermero.
//   - fecha_atencion guarda la hora reportada en el papel.
//   - created_at NO se toca — sigue siendo la hora real de inserción
//     en la base de datos (ancla de auditoría inmutable).
//   - cargado_por_id/cargado_por_nombre identifican al Administrador
//     que hizo la carga, para dejar rastro de quién transcribió qué.
router.post('/contingencia', verificarToken, verificarNivel(4), async (req, res) => {
  const {
    usuario_id, fecha_atencion, tipo,
    sub_sku_id, bodega_origen_id, bodega_destino_id,
    cantidad, cedula_paciente, motivo
  } = req.body;

  const TIPOS_VALIDOS = ['consumo', 'traslado', 'destruccion'];

  if (!usuario_id || !fecha_atencion || !tipo || !sub_sku_id || !bodega_origen_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de movimiento inválido para contingencia' });
  }

  const fechaAt = new Date(fecha_atencion);
  if (isNaN(fechaAt.getTime())) {
    return res.status(400).json({ error: 'Fecha de atención inválida' });
  }
  if (fechaAt.getTime() > Date.now()) {
    return res.status(400).json({ error: 'La fecha de atención no puede ser futura' });
  }
  if (tipo === 'traslado' && (!bodega_destino_id || bodega_destino_id === bodega_origen_id)) {
    return res.status(400).json({ error: 'Selecciona un depósito destino distinto al de origen' });
  }

  const cedulaPacienteVal = cedula_paciente
    ? String(cedula_paciente).replace(/\D/g, '') || null
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El enfermero debe existir y estar activo — su nombre se denormaliza
    // igual que en los demás endpoints, para sobrevivir a un futuro
    // borrado suave del usuario.
    const enfermero = await client.query(
      'SELECT id, nombre FROM usuarios WHERE id = $1 AND activo = true',
      [usuario_id]
    );
    if (!enfermero.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'El usuario seleccionado no existe o está inactivo' });
    }
    const nombreEnfermero = enfermero.rows[0].nombre;

    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente en el depósito de origen' });
    }

    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad,
          usuario_id, usuario_nombre, cedula_paciente, motivo,
          fecha_atencion, es_contingencia, cargado_por_id, cargado_por_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)`,
      [
        sub_sku_id,
        tipo,
        bodega_origen_id,
        tipo === 'traslado' ? bodega_destino_id : null,
        cantidad,
        usuario_id,
        nombreEnfermero,
        tipo === 'consumo' ? cedulaPacienteVal : null,
        tipo === 'destruccion' ? (motivo || null) : null,
        fechaAt.toISOString(),
        req.usuario.id,
        req.usuario.nombre
      ]
    );

    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );

    if (tipo === 'traslado') {
      await client.query(
        `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (sub_sku_id, bodega_id)
         DO UPDATE SET cantidad = stock.cantidad + $3`,
        [sub_sku_id, bodega_destino_id, cantidad]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Contingencia registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor al registrar la contingencia' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/:id/revertir — nivel 4 — revierte un movimiento y ajusta el stock
router.post('/:id/revertir', verificarToken, verificarNivel(4), async (req, res) => {
  const movId = parseInt(req.params.id);
  if (!movId) return res.status(400).json({ error: 'Movimiento inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const movResult = await client.query('SELECT * FROM movimientos WHERE id = $1 FOR UPDATE', [movId]);
    if (!movResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }
    const mov = movResult.rows[0];

    if (mov.revertido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este movimiento ya fue revertido' });
    }
    if (mov.tipo === 'reversion') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes revertir una reversión' });
    }

    let nuevoOrigenId = null, nuevoDestinoId = null;

    if (mov.tipo === 'compra') {
      const stockActual = await client.query(
        'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
        [mov.sub_sku_id, mov.bodega_destino_id]
      );
      const disponible = stockActual.rows[0]?.cantidad || 0;
      if (disponible < mov.cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No se puede revertir: solo quedan ${disponible} unidades disponibles en ese depósito (parte del stock ya se movió o consumió)` });
      }
      await client.query(
        'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
        [mov.cantidad, mov.sub_sku_id, mov.bodega_destino_id]
      );
      nuevoDestinoId = mov.bodega_destino_id;

    } else if (mov.tipo === 'consumo' || mov.tipo === 'destruccion') {
      await client.query(
        `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (sub_sku_id, bodega_id)
         DO UPDATE SET cantidad = stock.cantidad + $3`,
        [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad]
      );
      nuevoOrigenId = mov.bodega_origen_id;

    } else if (mov.tipo === 'traslado') {
      const stockDestino = await client.query(
        'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
        [mov.sub_sku_id, mov.bodega_destino_id]
      );
      const disponibleDestino = stockDestino.rows[0]?.cantidad || 0;
      if (disponibleDestino < mov.cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No se puede revertir: solo quedan ${disponibleDestino} unidades disponibles en el depósito destino` });
      }
      await client.query(
        'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
        [mov.cantidad, mov.sub_sku_id, mov.bodega_destino_id]
      );
      await client.query(
        `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (sub_sku_id, bodega_id)
         DO UPDATE SET cantidad = stock.cantidad + $3`,
        [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad]
      );
      nuevoOrigenId = mov.bodega_destino_id;
      nuevoDestinoId = mov.bodega_origen_id;

    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este tipo de movimiento no se puede revertir' });
    }

    await client.query(
      `UPDATE movimientos SET revertido = true, revertido_at = NOW(), revertido_por = $1 WHERE id = $2`,
      [req.usuario.id, movId]
    );

    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad, usuario_id, usuario_nombre, movimiento_original_id)
       VALUES ($1, 'reversion', $2, $3, $4, $5, $6, $7)`,
      [mov.sub_sku_id, nuevoOrigenId, nuevoDestinoId, mov.cantidad, req.usuario.id, req.usuario.nombre, movId]
    );

    await client.query('COMMIT');
    res.json({ mensaje: 'Movimiento revertido correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor al revertir el movimiento' });
  } finally {
    client.release();
  }
});

module.exports = router;