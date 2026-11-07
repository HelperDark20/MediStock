const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { validarParamsId, idValido } = require('../utils/validar');
const { fechaValida } = require('../utils/fechas');

// :id debe ser un id numérico (si no, 400 en vez de error 500)
validarParamsId(router, 'id');

// FIX: cantidad debe ser un entero positivo. Antes un texto como "abc"
// pasaba la validación (`"abc" <= 0` es false) y terminaba en error 500.
function _cantidadValida(c) {
  const n = Number(c);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// FIX CONCURRENCIA: valida y descuenta el stock en una sola sentencia.
// Antes se hacía SELECT y luego UPDATE: dos peticiones simultáneas podían
// pasar ambas la validación y dejar el stock en negativo.
// Devuelve true si había stock suficiente y se descontó.
async function _descontarStock(client, subSkuId, bodegaId, cantidad) {
  const r = await client.query(
    `UPDATE stock SET cantidad = cantidad - $1
     WHERE sub_sku_id = $2 AND bodega_id = $3 AND cantidad >= $1
     RETURNING cantidad`,
    [cantidad, subSkuId, bodegaId]
  );
  return r.rows.length > 0;
}

// Envíos duplicados (doble clic en "Registrar", reintento tras un corte de
// red): el frontend manda un client_id único por registro. Si ya existe un
// movimiento con ese client_id, el segundo envío se descarta sin tocar el
// stock. Si llegan dos a la vez, el índice único movimientos_client_id_key
// frena el segundo (error 23505) y su transacción se deshace.
async function _yaRegistrado(client, clientId) {
  if (!clientId) return false;
  const r = await client.query('SELECT 1 FROM movimientos WHERE client_id = $1', [clientId]);
  return r.rows.length > 0;
}
function _esDuplicado(err, clientId) {
  return !!clientId && err && err.code === '23505';
}
function _respuestaDuplicado(res) {
  return res.json({ mensaje: 'Este movimiento ya estaba registrado', duplicado: true });
}

async function _stockDisponible(client, subSkuId, bodegaId) {
  const r = await client.query(
    'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
    [subSkuId, bodegaId]
  );
  return r.rows[0]?.cantidad || 0;
}

// GET /api/movimientos — todos los niveles
router.get('/', verificarToken, async (req, res) => {
  const { sku_global, sub_sku_id, bodega, mios } = req.query;
  if (sub_sku_id && !idValido(sub_sku_id)) return res.status(400).json({ error: 'Sub-SKU inválido' });
  // FIX SEGURIDAD: cap máximo de 1000 para evitar DoS por limit arbitrario
  // FIX: un limit negativo o 0 hacía fallar la consulta (LIMIT -5 → error 500)
  const requestedLimit = parseInt(req.query.limit);
  const limit = requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 500;

  try {
    let query = `
      SELECT m.*,
             COALESCE(m.fecha_atencion, m.created_at) AS fecha_real,
             g.codigo  AS sku_global_codigo,
             g.nombre  AS nombre,
             s.sub_sku,
             s.unidad,
             bo.nombre AS origen_nombre,
             bd.nombre AS destino_nombre,
             ubo.nombre AS origen_ubicacion_nombre,
             ubd.nombre AS destino_ubicacion_nombre,
             COALESCE(m.usuario_nombre, u.nombre) AS usuario_nombre,
             u.nivel                               AS usuario_nivel
      FROM movimientos m
      JOIN sub_skus s      ON m.sub_sku_id = s.id
      JOIN skus_globales g ON s.sku_global_id = g.id
      LEFT JOIN bodegas bo ON m.bodega_origen_id  = bo.id
      LEFT JOIN bodegas bd ON m.bodega_destino_id = bd.id
      LEFT JOIN ubicaciones ubo ON m.ubicacion_origen_id  = ubo.id
      LEFT JOIN ubicaciones ubd ON m.ubicacion_destino_id = ubd.id
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
    // mios=1 → solo los movimientos del usuario autenticado (panel enfermero
    // liviano: evita descargar el historial de todos en tablets antiguas)
    if (mios === '1') {
      params.push(req.usuario.id);
      query += ` AND m.usuario_id = $${params.length}`;
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
// pensado para reportes que necesitan ver todo el histórico o rangos de fecha amplios.
// Las fechas se filtran por la hora REAL de atención (fecha_atencion, que tienen
// las contingencias y los consumos offline) y, si no existe, por created_at.
// La ubicación es la que tenía el depósito al momento del movimiento
// (ubicacion_origen_id / ubicacion_destino_id), no la actual: así los
// consumos hechos en una ubicación temporal siguen siendo de esa ubicación
// aunque el depósito ya haya vuelto a su sede.
// También lo usa la descarga a Excel del historial de movimientos (todos los
// tipos): por eso trae lote, vencimiento y la ubicación de destino.
router.get('/reportes', verificarToken, verificarNivel(4), async (req, res) => {
  const { tipo, fecha_inicio, fecha_fin, ubicacion_id, bodega, sub_sku_id, cedula_paciente } = req.query;
  if ((fecha_inicio && !fechaValida(fecha_inicio)) || (fecha_fin && !fechaValida(fecha_fin))) {
    return res.status(400).json({ error: 'Rango de fechas inválido' });
  }
  if ((ubicacion_id && !idValido(ubicacion_id)) || (sub_sku_id && !idValido(sub_sku_id))) {
    return res.status(400).json({ error: 'Filtro inválido' });
  }
  try {
    let query = `
      SELECT m.*,
             COALESCE(m.fecha_atencion, m.created_at) AS fecha_real,
             g.codigo   AS sku_global_codigo,
             g.nombre   AS nombre,
             s.sub_sku,
             s.unidad,
             s.precio,
             s.lote,
             s.caducidad,
             bo.nombre  AS origen_nombre,
             bd.nombre  AS destino_nombre,
             m.ubicacion_origen_id AS origen_ubicacion_id,
             ubo.nombre AS origen_ubicacion_nombre,
             ubd.nombre AS destino_ubicacion_nombre,
             COALESCE(m.usuario_nombre, u.nombre) AS usuario_nombre,
             u.nivel                               AS usuario_nivel
      FROM movimientos m
      JOIN sub_skus s      ON m.sub_sku_id = s.id
      JOIN skus_globales g ON s.sku_global_id = g.id
      LEFT JOIN bodegas bo      ON m.bodega_origen_id  = bo.id
      LEFT JOIN bodegas bd      ON m.bodega_destino_id = bd.id
      LEFT JOIN ubicaciones ubo ON m.ubicacion_origen_id  = ubo.id
      LEFT JOIN ubicaciones ubd ON m.ubicacion_destino_id = ubd.id
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
      query += ` AND (COALESCE(m.fecha_atencion, m.created_at) AT TIME ZONE 'America/Bogota') >= $${params.length}::date`;
    }
    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND (COALESCE(m.fecha_atencion, m.created_at) AT TIME ZONE 'America/Bogota') < ($${params.length}::date + INTERVAL '1 day')`;
    }
    // Origen o destino: los consumos solo tienen origen; así un traslado o
    // una compra hacia esa ubicación también aparecen en el Excel del historial
    if (ubicacion_id) {
      params.push(ubicacion_id);
      query += ` AND (m.ubicacion_origen_id = $${params.length} OR m.ubicacion_destino_id = $${params.length})`;
    }
    if (bodega) {
      params.push(bodega);
      query += ` AND bo.nombre = $${params.length}`;
    }
    if (sub_sku_id) {
      params.push(sub_sku_id);
      query += ` AND m.sub_sku_id = $${params.length}`;
    }
    if (cedula_paciente) {
      params.push(String(cedula_paciente).replace(/\D/g, ''));
      query += ` AND m.cedula_paciente = $${params.length}`;
    }

    // Se pide una fila de más para saber si el resultado quedó recortado
    const TOPE_REPORTE = 20000;
    query += ` ORDER BY COALESCE(m.fecha_atencion, m.created_at) DESC LIMIT ${TOPE_REPORTE + 1}`;

    const result = await pool.query(query, params);
    if (result.rows.length > TOPE_REPORTE) {
      res.set('X-Reporte-Truncado', String(TOPE_REPORTE));
      return res.json(result.rows.slice(0, TOPE_REPORTE));
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor al generar el reporte' });
  }
});

// POST /api/movimientos/entrada — nivel 3 y 4
router.post('/entrada', verificarToken, verificarNivel(3), async (req, res) => {
  const sub_sku_id = idValido(req.body.sub_sku_id);
  const bodega_destino_id = idValido(req.body.bodega_destino_id);
  const cantidad = _cantidadValida(req.body.cantidad);
  if (!sub_sku_id || !bodega_destino_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o la cantidad no es un entero positivo' });
  }
  const client_id = _clientIdValido(req.body.client_id);
  if (client_id === undefined) return res.status(400).json({ error: 'Identificador de registro inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await _yaRegistrado(client, client_id)) {
      await client.query('ROLLBACK');
      return _respuestaDuplicado(res);
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_destino_id, cantidad, usuario_id, usuario_nombre, client_id)
       VALUES ($1, 'compra', $2, $3, $4, $5, $6)`,
      [sub_sku_id, bodega_destino_id, cantidad, req.usuario.id, req.usuario.nombre, client_id]
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
    if (_esDuplicado(err, client_id)) return _respuestaDuplicado(res);
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/consumo — nivel 2, 3 y 4
// client_id: id que genera el panel de enfermero para cada consumo. Si llega
// dos veces (reintento tras un corte de red, o sincronización repetida) el
// segundo se ignora. Formato libre pero acotado.
function _clientIdValido(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : undefined;  // undefined = inválido
}

// Registra un consumo dentro de una transacción propia.
// Devuelve { estado: 'ok' | 'duplicado' | 'sin_stock' }.
async function _registrarConsumo(usuario, d) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (d.client_id) {
      const ya = await client.query('SELECT id FROM movimientos WHERE client_id = $1', [d.client_id]);
      if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado' }; }
    }
    // Una HC ya enviada no admite más consumos
    if (d.hc_client_id) {
      const hc = await client.query('SELECT 1 FROM historias_clinicas WHERE client_id = $1', [d.hc_client_id]);
      if (hc.rows.length) { await client.query('ROLLBACK'); return { estado: 'hc_enviada' }; }
    }
    if (!await _descontarStock(client, d.sub_sku_id, d.bodega_origen_id, d.cantidad)) {
      await client.query('ROLLBACK');
      return { estado: 'sin_stock' };
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, cedula_paciente,
          client_id, es_offline, fecha_atencion, sincronizado_at, hc_client_id)
       VALUES ($1, 'consumo', $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 THEN NOW() END, $10)`,
      [d.sub_sku_id, d.bodega_origen_id, d.cantidad, usuario.id, usuario.nombre, d.cedula_paciente,
       d.client_id, !!d.es_offline, d.fecha_atencion || null, d.hc_client_id || null]
    );
    await client.query('COMMIT');
    return { estado: 'ok' };
  } catch (err) {
    await client.query('ROLLBACK');
    // Dos envíos simultáneos del mismo client_id: el índice único frena el segundo
    if (err.code === '23505' && d.client_id) return { estado: 'duplicado' };
    throw err;
  } finally {
    client.release();
  }
}

// Cédula del paciente: OBLIGATORIA en todo consumo, solo números, mínimo 5
// dígitos (máximo 15). Se toleran puntos, guiones y espacios de formato
// ("1.006.166.884") y se guardan solo los dígitos. Devuelve null si no es válida.
const CEDULA_ERROR = 'La cédula del paciente es obligatoria (solo números, mínimo 5 dígitos)';
function _cedulaPaciente(v) {
  const s = String(v ?? '').replace(/[\s.\-]/g, '');
  return /^\d{5,15}$/.test(s) ? s : null;
}

// Consumo dentro de una historia clínica (módulo 6): hc_client_id es el id de
// la HC en la tablet. El paciente sale de la HC, así que su documento puede
// tener letras (pasaporte) o no existir todavía (paciente NN); al enviarse la
// HC se actualiza con el documento definitivo. Sin hc_client_id rige la regla
// de siempre: cédula obligatoria, solo números.
// Devuelve { hc_client_id, cedula_paciente } o { error }.
function _pacienteDelConsumo(body) {
  const hc = _clientIdValido(body.hc_client_id);
  if (hc === undefined) return { error: 'Identificador de historia clínica inválido' };
  if (!hc) {
    const cedula = _cedulaPaciente(body.cedula_paciente);
    return cedula ? { hc_client_id: null, cedula_paciente: cedula } : { error: CEDULA_ERROR };
  }
  const doc = String(body.cedula_paciente ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (doc && (doc.length < 3 || doc.length > 20)) return { error: 'Documento del paciente inválido' };
  return { hc_client_id: hc, cedula_paciente: doc || null };
}
const ERROR_HC_ENVIADA = 'La historia clínica ya fue enviada: no se le pueden agregar consumos';

router.post('/consumo', verificarToken, verificarNivel(2), async (req, res) => {
  const sub_sku_id = idValido(req.body.sub_sku_id);
  const bodega_origen_id = idValido(req.body.bodega_origen_id);
  const cantidad = _cantidadValida(req.body.cantidad);
  if (!sub_sku_id || !bodega_origen_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o la cantidad no es un entero positivo' });
  }
  const paciente = _pacienteDelConsumo(req.body);
  if (paciente.error) return res.status(400).json({ error: paciente.error });
  const client_id = _clientIdValido(req.body.client_id);
  if (client_id === undefined) return res.status(400).json({ error: 'Identificador de consumo inválido' });

  try {
    const r = await _registrarConsumo(req.usuario, {
      sub_sku_id, bodega_origen_id, cantidad, client_id, ...paciente
    });
    if (r.estado === 'sin_stock') return res.status(400).json({ error: 'Stock insuficiente' });
    if (r.estado === 'hc_enviada') return res.status(400).json({ error: ERROR_HC_ENVIADA });
    if (r.estado === 'duplicado') return res.json({ mensaje: 'Este consumo ya estaba registrado', duplicado: true });
    res.status(201).json({ mensaje: 'Consumo registrado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/movimientos/sincronizar — nivel 2+ — sube los consumos que el
// panel de enfermero guardó en modo offline.
// body: { consumos: [{ client_id, sub_sku_id, bodega_origen_id, cantidad,
//                      cedula_paciente, fecha_atencion }] }
// Cada consumo se procesa en su propia transacción y se responde uno por uno,
// así un fallo no bloquea el resto. Es seguro reintentar: los client_id ya
// registrados vuelven como "duplicado" sin tocar el stock.
const MAX_SINCRONIZAR = 200;
const TOLERANCIA_RELOJ_MS = 10 * 60 * 1000;   // reloj de la tablet adelantado

router.post('/sincronizar', verificarToken, verificarNivel(2), async (req, res) => {
  const consumos = req.body && req.body.consumos;
  if (!Array.isArray(consumos) || !consumos.length) {
    return res.status(400).json({ error: 'No hay consumos para sincronizar' });
  }
  if (consumos.length > MAX_SINCRONIZAR) {
    return res.status(400).json({ error: `Máximo ${MAX_SINCRONIZAR} consumos por envío` });
  }

  const resultados = [];
  for (const c of consumos) {
    const client_id = _clientIdValido(c && c.client_id);
    const cantidad = _cantidadValida(c && c.cantidad);
    if (!client_id) { resultados.push({ client_id: c && c.client_id, estado: 'error', error: 'Identificador de consumo inválido' }); continue; }
    const sub_sku_id = idValido(c.sub_sku_id);
    const bodega_origen_id = idValido(c.bodega_origen_id);
    if (!sub_sku_id || !bodega_origen_id || !cantidad) {
      resultados.push({ client_id, estado: 'error', error: 'Faltan datos del consumo' });
      continue;
    }
    const paciente = _pacienteDelConsumo(c);
    if (paciente.error) { resultados.push({ client_id, estado: 'error', error: paciente.error }); continue; }
    // Hora real de atención = reloj de la tablet. Si viene inválida o en el
    // futuro (reloj adelantado), se usa la hora de llegada al servidor.
    let fecha = c.fecha_atencion ? new Date(c.fecha_atencion) : null;
    if (!fecha || isNaN(fecha.getTime()) || fecha.getTime() > Date.now() + TOLERANCIA_RELOJ_MS) fecha = new Date();

    try {
      const r = await _registrarConsumo(req.usuario, {
        sub_sku_id, bodega_origen_id, cantidad, client_id,
        ...paciente,
        es_offline: true, fecha_atencion: fecha.toISOString()
      });
      if (r.estado === 'sin_stock') resultados.push({ client_id, estado: 'error', error: 'Stock insuficiente en la bodega' });
      else if (r.estado === 'hc_enviada') resultados.push({ client_id, estado: 'error', error: ERROR_HC_ENVIADA });
      else resultados.push({ client_id, estado: r.estado });
    } catch (err) {
      console.error('ERROR sincronizando consumo', client_id, err.message);
      resultados.push({ client_id, estado: 'error', error: 'Error del servidor', reintentar: true });
    }
  }
  res.json({ resultados });
});

// POST /api/movimientos/anular-consumo — nivel 2+ — el enfermero quita un
// consumo de una historia clínica que todavía no envió (se equivocó de
// producto o de cantidad). El stock vuelve a la bodega con un movimiento de
// reversión, igual que cuando el administrador revierte un movimiento.
// Es seguro repetirlo. body: { client_id }
router.post('/anular-consumo', verificarToken, verificarNivel(2), async (req, res) => {
  const clientId = _clientIdValido(req.body && req.body.client_id);
  if (!clientId) return res.status(400).json({ error: 'Identificador de consumo inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM movimientos WHERE client_id = $1 FOR UPDATE', [clientId]);
    const mov = r.rows[0];
    if (!mov) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ese consumo no está registrado en el servidor' });
    }
    if (mov.tipo !== 'consumo' || !mov.hc_client_id || mov.usuario_id !== req.usuario.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo puedes quitar consumos de tus propias historias clínicas' });
    }
    if (mov.revertido) {
      await client.query('ROLLBACK');
      return res.json({ mensaje: 'Este consumo ya estaba anulado', ya_anulado: true });
    }
    const enviada = await client.query('SELECT 1 FROM historias_clinicas WHERE client_id = $1', [mov.hc_client_id]);
    if (enviada.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La historia clínica ya fue enviada: pide al administrador que corrija el consumo' });
    }
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad]
    );
    await client.query(
      'UPDATE movimientos SET revertido = true, revertido_at = NOW(), revertido_por = $1 WHERE id = $2',
      [req.usuario.id, mov.id]
    );
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, movimiento_original_id)
       VALUES ($1, 'reversion', $2, $3, $4, $5, $6)`,
      [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad, req.usuario.id, req.usuario.nombre, mov.id]
    );
    await client.query('COMMIT');
    res.json({ mensaje: 'Consumo anulado: el stock volvió a la bodega' });
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
  const sub_sku_id = idValido(req.body.sub_sku_id);
  const bodega_origen_id = idValido(req.body.bodega_origen_id);
  const bodega_destino_id = idValido(req.body.bodega_destino_id);
  const cantidad = _cantidadValida(req.body.cantidad);
  if (!sub_sku_id || !bodega_origen_id || !bodega_destino_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o la cantidad no es un entero positivo' });
  }
  // String() para que "3" y 3 se consideren iguales
  if (String(bodega_origen_id) === String(bodega_destino_id)) {
    return res.status(400).json({ error: 'Origen y destino son iguales' });
  }
  const client_id = _clientIdValido(req.body.client_id);
  if (client_id === undefined) return res.status(400).json({ error: 'Identificador de registro inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await _yaRegistrado(client, client_id)) {
      await client.query('ROLLBACK');
      return _respuestaDuplicado(res);
    }
    if (!await _descontarStock(client, sub_sku_id, bodega_origen_id, cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente en origen' });
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad, usuario_id, usuario_nombre, client_id)
       VALUES ($1, 'traslado', $2, $3, $4, $5, $6, $7)`,
      [sub_sku_id, bodega_origen_id, bodega_destino_id, cantidad, req.usuario.id, req.usuario.nombre, client_id]
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
    if (_esDuplicado(err, client_id)) return _respuestaDuplicado(res);
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/destruccion — nivel 3 y 4
router.post('/destruccion', verificarToken, verificarNivel(3), async (req, res) => {
  const sub_sku_id = idValido(req.body.sub_sku_id);
  const bodega_origen_id = idValido(req.body.bodega_origen_id);
  const motivo = req.body.motivo == null ? null : String(req.body.motivo);
  const cantidad = _cantidadValida(req.body.cantidad);
  if (!sub_sku_id || !bodega_origen_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o la cantidad no es un entero positivo' });
  }
  const client_id = _clientIdValido(req.body.client_id);
  if (client_id === undefined) return res.status(400).json({ error: 'Identificador de registro inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await _yaRegistrado(client, client_id)) {
      await client.query('ROLLBACK');
      return _respuestaDuplicado(res);
    }
    if (!await _descontarStock(client, sub_sku_id, bodega_origen_id, cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, cantidad, motivo, usuario_id, usuario_nombre, client_id)
       VALUES ($1, 'destruccion', $2, $3, $4, $5, $6, $7)`,
      [sub_sku_id, bodega_origen_id, cantidad, motivo, req.usuario.id, req.usuario.nombre, client_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Destrucción registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (_esDuplicado(err, client_id)) return _respuestaDuplicado(res);
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
  const { fecha_atencion, tipo, cedula_paciente } = req.body;
  const usuario_id       = idValido(req.body.usuario_id);
  const sub_sku_id       = idValido(req.body.sub_sku_id);
  const bodega_origen_id = idValido(req.body.bodega_origen_id);
  const bodega_destino_id = req.body.bodega_destino_id == null || req.body.bodega_destino_id === ''
    ? null : idValido(req.body.bodega_destino_id);
  const motivo = req.body.motivo == null ? null : String(req.body.motivo);
  const cantidad = _cantidadValida(req.body.cantidad);

  const TIPOS_VALIDOS = ['consumo', 'traslado', 'destruccion'];

  if (!usuario_id || !fecha_atencion || !tipo || !sub_sku_id || !bodega_origen_id || !cantidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o la cantidad no es un entero positivo' });
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
  if (tipo === 'traslado' && (!bodega_destino_id || String(bodega_destino_id) === String(bodega_origen_id))) {
    return res.status(400).json({ error: 'Selecciona un depósito destino distinto al de origen' });
  }

  const cedulaPacienteVal = _cedulaPaciente(cedula_paciente);
  if (tipo === 'consumo' && !cedulaPacienteVal) {
    return res.status(400).json({ error: CEDULA_ERROR });
  }

  const client_id = _clientIdValido(req.body.client_id);
  if (client_id === undefined) return res.status(400).json({ error: 'Identificador de registro inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (await _yaRegistrado(client, client_id)) {
      await client.query('ROLLBACK');
      return _respuestaDuplicado(res);
    }

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

    if (!await _descontarStock(client, sub_sku_id, bodega_origen_id, cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente en el depósito de origen' });
    }

    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad,
          usuario_id, usuario_nombre, cedula_paciente, motivo,
          fecha_atencion, es_contingencia, cargado_por_id, cargado_por_nombre, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13)`,
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
        req.usuario.nombre,
        client_id
      ]
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
    if (_esDuplicado(err, client_id)) return _respuestaDuplicado(res);
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
      if (!await _descontarStock(client, mov.sub_sku_id, mov.bodega_destino_id, mov.cantidad)) {
        const disponible = await _stockDisponible(client, mov.sub_sku_id, mov.bodega_destino_id);
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No se puede revertir: solo quedan ${disponible} unidades disponibles en ese depósito (parte del stock ya se movió o consumió)` });
      }
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
      if (!await _descontarStock(client, mov.sub_sku_id, mov.bodega_destino_id, mov.cantidad)) {
        const disponibleDestino = await _stockDisponible(client, mov.sub_sku_id, mov.bodega_destino_id);
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No se puede revertir: solo quedan ${disponibleDestino} unidades disponibles en el depósito destino` });
      }
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