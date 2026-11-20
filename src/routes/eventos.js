const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { validarParamsId, idValido, idsValidos, texto } = require('../utils/validar');
const { fechaValida } = require('../utils/fechas');
const { bloqueoPorTurnosAbiertos } = require('../utils/asistencia');
const { normalizarPunto, medicoDelPunto } = require('../utils/puntos');

// :id, :usuarioId deben ser ids numéricos (si no, 400 en vez de error 500)
validarParamsId(router, 'id', 'usuarioId');

const NIVEL_MEDICO = 1;
const NIVEL_ENFERMERO = 2;
// Topes de la estructura que se guarda de una vez desde la vista del evento
const MAX_PUNTOS = 100, MAX_MEDICOS = 100, MAX_ENFERMEROS = 500, MAX_DEPOSITOS = 50;

// Comprueba que el usuario se pueda agregar como personal del evento:
// activo y enfermero (nivel 2) o médico (nivel 1). A un médico no se le
// asignan depósitos. Devuelve un mensaje de error, o null si está bien.
async function _validarPersonal(client, usuarioId, bodegas, alAgregar = true) {
  const r = await client.query('SELECT nivel FROM usuarios WHERE id = $1 AND activo = true', [usuarioId]);
  if (!r.rows.length) return 'El usuario no existe o está inactivo';
  const nivel = r.rows[0].nivel;
  // Al editar no se revalida el nivel: alguien agregado antes con otro
  // nivel debe poder seguir editándose
  if (alAgregar && nivel !== NIVEL_ENFERMERO && nivel !== NIVEL_MEDICO) return 'Solo se pueden agregar enfermeros o médicos al evento';
  if (nivel === NIVEL_MEDICO && bodegas.length) return 'A un médico no se le asignan depósitos';
  return null;
}

// ── Helper: arma personal + depósitos por evento (reutilizado en varias rutas) ──
async function _cargarPersonal(eventoIds, db = pool) {
  if (!eventoIds.length) return {};
  const usuarios = await db.query(`
    SELECT eu.evento_id, us.id, us.nombre, us.nivel, us.cedula, eu.punto_id,
           COALESCE(p.nombre, eu.ubicacion) AS ubicacion
    FROM evento_usuarios eu
    JOIN usuarios us ON eu.usuario_id = us.id
    LEFT JOIN evento_puntos p ON p.id = eu.punto_id AND p.activo = true
    WHERE eu.evento_id = ANY($1::int[])
    ORDER BY us.nombre
  `, [eventoIds]);

  const asignaciones = await db.query(`
    SELECT eub.evento_id, eub.usuario_id, b.id AS bodega_id, b.nombre AS bodega_nombre
    FROM evento_usuario_bodegas eub
    JOIN bodegas b ON eub.bodega_id = b.id
    WHERE eub.evento_id = ANY($1::int[])
    ORDER BY b.nombre
  `, [eventoIds]);

  const porEvento = {};
  eventoIds.forEach(id => { porEvento[id] = []; });
  usuarios.rows.forEach(u => {
    porEvento[u.evento_id].push({
      id: u.id,
      nombre: u.nombre,
      // Personal del evento: enfermeros (con depósitos y su punto de
      // atención) y médicos (nivel 1, sin depósitos: responden por las
      // historias clínicas de los puntos que tienen a cargo)
      nivel: u.nivel,
      es_medico: u.nivel === NIVEL_MEDICO,
      cedula: u.cedula,   // en el médico es también su registro profesional
      punto_id: u.nivel === NIVEL_MEDICO ? null : (u.punto_id || null),
      ubicacion: u.ubicacion || '',   // nombre del punto de atención
      bodegas: asignaciones.rows
        .filter(a => a.evento_id === u.evento_id && a.usuario_id === u.id)
        .map(a => ({ id: a.bodega_id, nombre: a.bodega_nombre }))
    });
  });
  return porEvento;
}

// Puntos de atención activos por evento, con su médico ({ id, nombre })
async function _cargarPuntos(eventoIds, db = pool) {
  const porEvento = {};
  eventoIds.forEach(id => { porEvento[id] = []; });
  if (!eventoIds.length) return porEvento;
  const r = await db.query(`
    SELECT p.id, p.evento_id, p.nombre, p.medico_id, us.nombre AS medico_nombre
    FROM evento_puntos p
    LEFT JOIN usuarios us ON us.id = p.medico_id
    WHERE p.evento_id = ANY($1::int[]) AND p.activo = true
    ORDER BY p.id
  `, [eventoIds]);
  r.rows.forEach(p => porEvento[p.evento_id].push({
    id: p.id, nombre: p.nombre,
    medico: p.medico_id ? { id: p.medico_id, nombre: p.medico_nombre } : null
  }));
  return porEvento;
}

// Los depósitos asignados a un enfermero deben estar en la ubicación del
// evento. Evita asignar, con la pantalla desactualizada, un depósito que
// mientras tanto se prestó a (o volvió de) una ubicación temporal.
async function _bodegasFueraDeUbicacion(client, eventoUbicacionId, bodegaIds) {
  if (!bodegaIds.length) return [];
  const r = await client.query(
    `SELECT nombre FROM bodegas
     WHERE id = ANY($1::int[]) AND (ubicacion_id IS DISTINCT FROM $2 OR activo = false)`,
    [bodegaIds, eventoUbicacionId]
  );
  return r.rows.map(b => b.nombre);
}

async function _ubicacionActiva(ubicacionId, db = pool) {
  const r = await db.query('SELECT 1 FROM ubicaciones WHERE id = $1 AND activo = true', [ubicacionId]);
  return r.rows.length > 0;
}

// Cada cambio en el personal o los puntos sube la versión del evento: la
// vista completa la envía al guardar para no pisar cambios de otra persona
async function _subirVersion(client, eventoId) {
  await client.query('UPDATE eventos SET version = version + 1 WHERE id = $1', [eventoId]);
}

// Punto de atención por nombre (lo crea si no existe). Para las rutas que
// reciben la ubicación del enfermero como texto (compatibilidad).
async function _puntoPorNombre(client, eventoId, nombre) {
  const r = await client.query(
    'SELECT id FROM evento_puntos WHERE evento_id = $1 AND activo = true AND UPPER(nombre) = $2', [eventoId, nombre]);
  if (r.rows.length) return r.rows[0].id;
  // Si el evento tiene un solo médico, el punto nuevo queda a su cargo (como
  // cuando el médico respondía por todo el evento)
  const meds = await client.query(
    `SELECT us.id FROM evento_usuarios eu JOIN usuarios us ON us.id = eu.usuario_id
     WHERE eu.evento_id = $1 AND us.nivel = $2`, [eventoId, NIVEL_MEDICO]);
  const ins = await client.query(
    'INSERT INTO evento_puntos (evento_id, nombre, medico_id) VALUES ($1, $2, $3) RETURNING id',
    [eventoId, nombre, meds.rows.length === 1 ? meds.rows[0].id : null]);
  return ins.rows[0].id;
}

// GET /api/eventos — panel principal (nivel 3+). La cédula del personal solo
// la ve el administrador. El enfermero usa /activo y /activos (solo los suyos).
router.get('/', verificarToken, verificarNivel(3), async (req, res) => {
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
    const puntosPorEvento = await _cargarPuntos(ids);
    const conCedula = req.usuario.nivel >= 4;
    res.json(eventos.rows.map(e => ({
      ...e,
      puntos: puntosPorEvento[e.id] || [],
      personal: (personalPorEvento[e.id] || []).map(p => conCedula ? p : { ...p, cedula: undefined })
    })));
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

// GET /api/eventos/activos — TODOS los eventos en curso asignados al usuario,
// cada uno con sus depósitos. Si hay más de uno, el panel del enfermero le
// pide elegir en cuál va a trabajar. Para la historia clínica trae además el
// municipio de la ubicación, el punto de atención del enfermero y el médico
// de ese punto en `medicos` (0 o 1; el panel los guarda para trabajar sin
// conexión).
router.get('/activos', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, u.nombre AS ubicacion_nombre, u.municipio_codigo,
             m.nombre AS municipio_nombre, m.departamento AS municipio_departamento,
             eu.punto_id, p.nombre AS punto_nombre, p.medico_id AS punto_medico_id
      FROM eventos e
      JOIN evento_usuarios eu ON eu.evento_id = e.id
      LEFT JOIN evento_puntos p ON p.id = eu.punto_id AND p.activo = true
      LEFT JOIN ubicaciones u ON e.ubicacion_id = u.id
      LEFT JOIN municipios m ON m.codigo = u.municipio_codigo
      WHERE eu.usuario_id = $1 AND e.estado = 'en_curso' AND e.activo = true
      ORDER BY e.iniciado_at DESC
    `, [req.usuario.id]);
    if (!result.rows.length) return res.json([]);

    const ids = result.rows.map(e => e.id);
    const bodegas = await pool.query(`
      SELECT eub.evento_id, b.id, b.nombre
      FROM evento_usuario_bodegas eub
      JOIN bodegas b ON eub.bodega_id = b.id
      WHERE eub.evento_id = ANY($1::int[]) AND eub.usuario_id = $2 AND b.activo = true
      ORDER BY b.nombre
    `, [ids, req.usuario.id]);
    const medicos = await pool.query(`
      SELECT eu.evento_id, us.id, us.nombre, us.cedula
      FROM evento_usuarios eu
      JOIN usuarios us ON us.id = eu.usuario_id
      WHERE eu.evento_id = ANY($1::int[]) AND us.nivel = ${NIVEL_MEDICO} AND us.activo = true
      ORDER BY us.nombre
    `, [ids]);

    res.json(result.rows.map(e => {
      const { punto_id, punto_nombre, punto_medico_id, ...ev } = e;
      const delEvento = medicos.rows.filter(m => m.evento_id === e.id).map(m => ({ id: m.id, nombre: m.nombre, cedula: m.cedula }));
      const medico = medicoDelPunto(delEvento, { punto_id: punto_nombre ? punto_id : null, medico_id: punto_medico_id });
      return {
        ...ev,
        punto: punto_nombre ? { id: punto_id, nombre: punto_nombre } : null,
        bodegas: bodegas.rows.filter(b => b.evento_id === e.id).map(b => ({ id: b.id, nombre: b.nombre })),
        medicos: medico ? [medico] : []
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/eventos/sugerencia-puntos?ubicacion_id=&excluir= — nivel 4.
// Nombres de los puntos del último evento hecho en esa ubicación (para no
// volver a escribirlos). Va antes de /:id.
router.get('/sugerencia-puntos', verificarToken, verificarNivel(4), async (req, res) => {
  const ubicacionId = idValido(req.query.ubicacion_id);
  if (!ubicacionId) return res.status(400).json({ error: 'Ubicación inválida' });
  const excluir = idValido(req.query.excluir) || 0;
  try {
    const ev = await pool.query(`
      SELECT e.id, e.nombre FROM eventos e
      WHERE e.ubicacion_id = $1 AND e.activo = true AND e.id <> $2
        AND EXISTS (SELECT 1 FROM evento_puntos p WHERE p.evento_id = e.id AND p.activo = true)
      ORDER BY e.fecha_inicio DESC, e.id DESC
      LIMIT 1`, [ubicacionId, excluir]);
    if (!ev.rows.length) return res.json({ evento: null, puntos: [] });
    const p = await pool.query(
      'SELECT nombre FROM evento_puntos WHERE evento_id = $1 AND activo = true ORDER BY id', [ev.rows[0].id]);
    res.json({ evento: ev.rows[0].nombre, puntos: p.rows.map(x => x.nombre) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/eventos/:id — detalle de un evento (nivel 4, vista del evento)
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
    const puntosPorEvento = await _cargarPuntos([evento.id]);
    res.json({ ...evento, puntos: puntosPorEvento[evento.id] || [], personal: personalPorEvento[evento.id] || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// bodega_ids del cuerpo: ausente → [] (sin depósitos); lista de ids → esos
// ids como números; cualquier otra cosa → null (inválido)
function _bodegasDelBody(body) {
  if (body.bodega_ids === undefined || body.bodega_ids === null) return [];
  return idsValidos(body.bodega_ids);
}

// Valida y normaliza el cuerpo de crear/editar evento. Las fechas llegan de
// un <input type="date"> (AAAA-MM-DD); con otro formato o una fecha que no
// existe, antes fallaba la base de datos con error 500.
// Horas del evento (para el reporte: atención PRE / IN / POST). Formato
// 24 h HH:MM; si la final es menor que la inicial el evento pasa la medianoche.
const RE_HORA_EVENTO = /^([01]\d|2[0-3]):[0-5]\d$/;
function _datosEvento(body) {
  const nombre = texto(body.nombre);
  const { fecha_inicio, fecha_fin } = body;
  if (!nombre || !fecha_inicio || !fecha_fin || !body.ubicacion_id) {
    return { error: 'Nombre, fechas y ubicación son obligatorios' };
  }
  const hora_inicio = String(body.hora_inicio || ''), hora_fin = String(body.hora_fin || '');
  if (!RE_HORA_EVENTO.test(hora_inicio) || !RE_HORA_EVENTO.test(hora_fin)) {
    return { error: 'Indica la hora de inicio y la hora final del evento' };
  }
  if (hora_inicio === hora_fin) return { error: 'La hora final debe ser distinta a la de inicio' };
  if (!fechaValida(fecha_inicio) || !fechaValida(fecha_fin)) {
    return { error: 'Las fechas del evento no son válidas' };
  }
  if (fecha_fin < fecha_inicio) {   // AAAA-MM-DD se compara bien como texto
    return { error: 'La fecha de finalización no puede ser anterior a la de inicio' };
  }
  const ubicacion_id = idValido(body.ubicacion_id);
  if (!ubicacion_id) return { error: 'Ubicación inválida' };
  return { nombre, fecha_inicio, fecha_fin, ubicacion_id, hora_inicio, hora_fin };
}

// ── ESTRUCTURA DEL EVENTO (vista completa) ──
// Forma que envía la vista al crear o guardar:
//   puntos:     [{ id?, clave, nombre, medico_id|null }]  (clave: texto que
//               usan los enfermeros para indicar su punto; id si ya existe)
//   medicos:    [usuario_id]
//   enfermeros: [{ usuario_id, punto: clave, bodega_ids: [] }]
// Devuelve { error } o la estructura normalizada (sin tocar la base).
function _formaEstructura(b) {
  if (!Array.isArray(b.puntos) || !Array.isArray(b.medicos) || !Array.isArray(b.enfermeros)) {
    return { error: 'Faltan los puntos de atención, los médicos o los enfermeros del evento' };
  }
  if (b.puntos.length > MAX_PUNTOS) return { error: `Máximo ${MAX_PUNTOS} puntos de atención por evento` };
  if (b.medicos.length > MAX_MEDICOS) return { error: `Máximo ${MAX_MEDICOS} médicos por evento` };
  if (b.enfermeros.length > MAX_ENFERMEROS) return { error: `Máximo ${MAX_ENFERMEROS} enfermeros por evento` };

  const medicos = idsValidos(b.medicos);
  if (!medicos) return { error: 'Médicos inválidos' };
  if (medicos.length !== b.medicos.length) return { error: 'Hay un médico repetido' };

  const puntos = [], claves = new Set(), nombres = new Set(), idsPunto = new Set();
  for (const p of b.puntos) {
    if (!p || typeof p !== 'object') return { error: 'Punto de atención inválido' };
    const clave = texto(String(p.clave == null ? '' : p.clave)).slice(0, 40);
    if (!clave || claves.has(clave)) return { error: 'Punto de atención inválido (clave repetida o vacía)' };
    const nombre = normalizarPunto(p.nombre);
    if (nombre.length < 2) return { error: 'Escribe el nombre de cada punto de atención' };
    if (nombres.has(nombre)) return { error: `El punto de atención "${nombre}" está repetido` };
    let id = null;
    if (p.id !== undefined && p.id !== null && p.id !== '') {
      id = idValido(p.id);
      if (!id || idsPunto.has(id)) return { error: 'Punto de atención inválido' };
      idsPunto.add(id);
    }
    let medicoId = null;
    if (p.medico_id !== undefined && p.medico_id !== null && p.medico_id !== '') {
      medicoId = idValido(p.medico_id);
      if (!medicoId) return { error: 'Médico del punto inválido' };
      if (!medicos.includes(medicoId)) return { error: `El médico del punto "${nombre}" debe estar entre los médicos del evento` };
    }
    claves.add(clave); nombres.add(nombre);
    puntos.push({ id, clave, nombre, medico_id: medicoId });
  }

  const enfermeros = [], vistos = new Set();
  for (const e of b.enfermeros) {
    if (!e || typeof e !== 'object') return { error: 'Enfermero inválido' };
    const uid = idValido(e.usuario_id);
    if (!uid) return { error: 'Enfermero inválido' };
    if (vistos.has(uid)) return { error: 'Hay un enfermero repetido' };
    if (medicos.includes(uid)) return { error: 'Una persona no puede estar como médico y como enfermero' };
    vistos.add(uid);
    const clave = texto(String(e.punto == null ? '' : e.punto)).slice(0, 40);
    if (!clave || !claves.has(clave)) return { error: 'Cada enfermero debe quedar en un punto de atención', usuario_id: uid };
    const bodegas = e.bodega_ids === undefined || e.bodega_ids === null ? [] : idsValidos(e.bodega_ids);
    if (!bodegas) return { error: 'Depósitos inválidos' };
    if (bodegas.length > MAX_DEPOSITOS) return { error: `Máximo ${MAX_DEPOSITOS} depósitos por enfermero` };
    enfermeros.push({ usuario_id: uid, punto: clave, bodega_ids: bodegas });
  }
  return { puntos, medicos, enfermeros };
}

// Error de validación con su código HTTP (se responde tal cual)
class ErrorEstructura extends Error {
  constructor(status, cuerpo) { super(cuerpo.error); this.status = status; this.cuerpo = cuerpo; }
}
const _falla = (status, error, extra) => { throw new ErrorEstructura(status, { error, ...(extra || {}) }); };

// Aplica la estructura (ya con la forma validada) dentro de la transacción.
//   ev: { id, estado, ubicacion_id } con la ubicación YA actualizada
//   depositosReiniciados: la ubicación cambió y se borraron los depósitos
//   confirmarQuitar: en un evento en curso, quitar enfermeros exige confirmación
async function _aplicarEstructura(client, ev, est, { confirmarQuitar = false, depositosReiniciados = false } = {}) {
  const enCurso = ev.estado === 'en_curso';
  const actual = await client.query(
    `SELECT eu.usuario_id, us.nombre, us.nivel, us.activo FROM evento_usuarios eu
     JOIN usuarios us ON us.id = eu.usuario_id WHERE eu.evento_id = $1`, [ev.id]);
  const enEvento = new Map(actual.rows.map(r => [r.usuario_id, r]));

  // Personas nuevas: deben existir, estar activas y tener el nivel correcto.
  // Las que ya estaban se respetan aunque después les hayan cambiado algo.
  const nuevos = est.medicos.concat(est.enfermeros.map(e => e.usuario_id)).filter(id => !enEvento.has(id));
  const info = new Map();
  if (nuevos.length) {
    const r = await client.query('SELECT id, nombre, nivel, activo FROM usuarios WHERE id = ANY($1::int[])', [nuevos]);
    r.rows.forEach(u => info.set(u.id, u));
  }
  for (const id of est.medicos) {
    const u = enEvento.get(id) || info.get(id);
    if (!u || (!enEvento.has(id) && !u.activo)) _falla(400, 'Uno de los médicos no existe o está inactivo');
    if (u.nivel !== NIVEL_MEDICO) _falla(400, `${u.nombre} no es médico`);
  }
  // Un médico desactivado puede seguir en el evento (historial), pero no
  // queda a cargo de ningún punto
  for (const p of est.puntos) {
    const u = p.medico_id && (enEvento.get(p.medico_id) || info.get(p.medico_id));
    if (u && !u.activo) _falla(400, `${u.nombre} está inactivo: no puede quedar a cargo del punto "${p.nombre}"`);
  }
  for (const e of est.enfermeros) {
    const u = enEvento.get(e.usuario_id) || info.get(e.usuario_id);
    if (!u || (!enEvento.has(e.usuario_id) && !u.activo)) _falla(400, 'Uno de los enfermeros no existe o está inactivo');
    if (u.nivel === NIVEL_MEDICO) _falla(400, `${u.nombre} es médico: agrégalo en "Médicos del evento"`);
    if (!enEvento.has(e.usuario_id) && u.nivel !== NIVEL_ENFERMERO) _falla(400, `${u.nombre} no es enfermero`);
  }

  // Quién sale del evento
  const quedan = new Set(est.medicos.concat(est.enfermeros.map(e => e.usuario_id)));
  const salen = actual.rows.filter(r => !quedan.has(r.usuario_id));
  if (enCurso) {
    // Un médico no sale de un evento en curso: las historias clínicas que
    // siguen en las tablets sin señal lo tienen como responsable. Se le
    // pueden quitar sus puntos.
    const medSale = salen.find(r => r.nivel === NIVEL_MEDICO);
    if (medSale) _falla(400, `El evento está en curso: ${medSale.nombre} no se puede quitar del evento (las historias clínicas pendientes de sincronizar lo tienen como médico). Quítale sus puntos de atención.`);
    if (salen.length && !confirmarQuitar) {
      _falla(409, 'Confirma que quieres quitar personal de un evento en curso', {
        requiere_confirmacion: true, quitar: salen.map(r => r.nombre)
      });
    }
  }

  // Depósitos nuevos: deben estar en la ubicación del evento (los que ya
  // tenía asignados se respetan, salvo que la ubicación haya cambiado)
  const previos = depositosReiniciados ? { rows: [] } : await client.query(
    'SELECT usuario_id, bodega_id FROM evento_usuario_bodegas WHERE evento_id = $1', [ev.id]);
  const yaAsignado = new Set(previos.rows.map(r => r.usuario_id + ':' + r.bodega_id));
  const depNuevos = [];
  est.enfermeros.forEach(e => e.bodega_ids.forEach(b => { if (!yaAsignado.has(e.usuario_id + ':' + b)) depNuevos.push(b); }));
  const depUnicos = [...new Set(depNuevos)];
  if (depUnicos.length) {
    const existen = await client.query('SELECT COUNT(*)::int AS n FROM bodegas WHERE id = ANY($1::int[])', [depUnicos]);
    if (existen.rows[0].n !== depUnicos.length) _falla(400, 'Uno de los depósitos no existe. Recarga e intenta de nuevo.');
  }
  const fuera = await _bodegasFueraDeUbicacion(client, ev.ubicacion_id, depUnicos);
  if (fuera.length) _falla(400, `Estos depósitos no están en la ubicación del evento: ${fuera.join(', ')}. Recarga e intenta de nuevo.`);

  // ── Puntos: los que ya no vienen se desactivan; los demás se renombran
  // (pasando por un nombre temporal para poder intercambiar nombres) ──
  const existentes = await client.query('SELECT id FROM evento_puntos WHERE evento_id = $1 AND activo = true', [ev.id]);
  const idsExistentes = new Set(existentes.rows.map(r => r.id));
  for (const p of est.puntos) {
    if (p.id && !idsExistentes.has(p.id)) _falla(409, 'Un punto de atención ya no existe (otra persona lo quitó). Recarga el evento.');
  }
  const idsQuedan = new Set(est.puntos.filter(p => p.id).map(p => p.id));
  const puntosSalen = [...idsExistentes].filter(id => !idsQuedan.has(id));
  if (puntosSalen.length) {
    await client.query('UPDATE evento_usuarios SET punto_id = NULL WHERE evento_id = $1 AND punto_id = ANY($2::int[])', [ev.id, puntosSalen]);
    await client.query('UPDATE evento_puntos SET activo = false WHERE id = ANY($1::int[])', [puntosSalen]);
  }
  for (const p of est.puntos.filter(x => x.id)) {
    await client.query("UPDATE evento_puntos SET nombre = '~' || id WHERE id = $1", [p.id]);
  }
  const idPorClave = {};
  for (const p of est.puntos) {
    if (p.id) {
      await client.query('UPDATE evento_puntos SET nombre = $2, medico_id = $3 WHERE id = $1', [p.id, p.nombre, p.medico_id]);
      idPorClave[p.clave] = p.id;
    } else {
      const r = await client.query(
        'INSERT INTO evento_puntos (evento_id, nombre, medico_id) VALUES ($1, $2, $3) RETURNING id', [ev.id, p.nombre, p.medico_id]);
      idPorClave[p.clave] = r.rows[0].id;
    }
  }

  // ── Personal que sale ──
  for (const r of salen) {
    await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2', [ev.id, r.usuario_id]);
    await client.query('DELETE FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2', [ev.id, r.usuario_id]);
  }
  // ── Médicos ──
  for (const id of est.medicos) {
    await client.query(
      'INSERT INTO evento_usuarios (evento_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ev.id, id]);
  }
  // ── Enfermeros: punto (y su nombre como ubicación, para lo anterior) y depósitos ──
  const nombrePorClave = {};
  est.puntos.forEach(p => { nombrePorClave[p.clave] = p.nombre; });
  for (const e of est.enfermeros) {
    const upd = await client.query(
      'UPDATE evento_usuarios SET punto_id = $3, ubicacion = $4 WHERE evento_id = $1 AND usuario_id = $2',
      [ev.id, e.usuario_id, idPorClave[e.punto], nombrePorClave[e.punto]]);
    if (!upd.rowCount) {
      await client.query(
        'INSERT INTO evento_usuarios (evento_id, usuario_id, punto_id, ubicacion) VALUES ($1, $2, $3, $4)',
        [ev.id, e.usuario_id, idPorClave[e.punto], nombrePorClave[e.punto]]);
    }
    await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2', [ev.id, e.usuario_id]);
    for (const bid of e.bodega_ids) {
      await client.query(
        'INSERT INTO evento_usuario_bodegas (evento_id, usuario_id, bodega_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [ev.id, e.usuario_id, bid]);
    }
  }
  await _subirVersion(client, ev.id);
}

function _responderError(res, err, mensaje) {
  if (err instanceof ErrorEstructura) return res.status(err.status).json(err.cuerpo);
  console.error(err);
  // Choque con el índice único del nombre del punto (dos guardados a la vez)
  if (err && err.code === '23505') return res.status(409).json({ error: 'Otra persona cambió los puntos de atención al mismo tiempo. Recarga el evento.' });
  res.status(500).json({ error: mensaje });
}

// POST /api/eventos — nivel 4. Datos del evento y, si la vista los envía,
// sus puntos de atención, médicos y enfermeros (todo en una transacción)
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const datos = _datosEvento(req.body);
  if (datos.error) return res.status(400).json({ error: datos.error });
  const conEstructura = req.body.puntos !== undefined || req.body.medicos !== undefined || req.body.enfermeros !== undefined;
  const est = conEstructura ? _formaEstructura(req.body) : null;
  if (est && est.error) return res.status(400).json(est);
  const { nombre, fecha_inicio, fecha_fin, ubicacion_id, hora_inicio, hora_fin } = datos;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await _ubicacionActiva(ubicacion_id, client)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La ubicación seleccionada ya no está activa' });
    }
    const evento = await client.query(
      `INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, ubicacion_id, creado_por, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nombre, fecha_inicio, fecha_fin, ubicacion_id, req.usuario.id, hora_inicio, hora_fin]
    );
    const ev = evento.rows[0];
    if (est) await _aplicarEstructura(client, ev, est);
    const fin = await client.query('SELECT * FROM eventos WHERE id = $1', [ev.id]);
    await client.query('COMMIT');
    res.status(201).json(fin.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    _responderError(res, err, 'Error al crear el evento');
  } finally {
    client.release();
  }
});

// PUT /api/eventos/:id/estructura — nivel 4 — guarda TODO lo de la vista del
// evento: datos, puntos de atención, médicos y enfermeros con sus depósitos.
// body: { version, datos del evento..., puntos, medicos, enfermeros, confirmar_quitar }
router.put('/:id/estructura', verificarToken, verificarNivel(4), async (req, res) => {
  const datos = _datosEvento(req.body);
  if (datos.error) return res.status(400).json({ error: datos.error });
  // La forma se valida después de comprobar el estado del evento (un evento
  // finalizado responde eso, no un error de su contenido)
  const est = _formaEstructura(req.body);
  const version = Number(req.body.version);
  if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'Falta la versión del evento: recarga la página' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT id, ubicacion_id, estado, version FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]);
    if (!actual.rows.length) _falla(404, 'Evento no encontrado');
    const ev = actual.rows[0];
    if (ev.estado === 'finalizado') _falla(400, 'No puedes editar un evento finalizado');
    if (ev.version !== version) _falla(409, 'Otra persona modificó este evento mientras lo editabas. Recarga para ver los cambios.', { version_cambiada: true });
    if (est.error) throw new ErrorEstructura(400, est);

    // Primero la ubicación (si cambia se borran los depósitos asignados) y
    // después se validan los depósitos contra la nueva
    const cambioUbicacion = ev.ubicacion_id !== datos.ubicacion_id;
    if (cambioUbicacion && !await _ubicacionActiva(datos.ubicacion_id, client)) _falla(400, 'La ubicación seleccionada ya no está activa');
    await client.query(
      `UPDATE eventos SET nombre = $1, fecha_inicio = $2, fecha_fin = $3, ubicacion_id = $4, hora_inicio = $6, hora_fin = $7
       WHERE id = $5`,
      [datos.nombre, datos.fecha_inicio, datos.fecha_fin, datos.ubicacion_id, ev.id, datos.hora_inicio, datos.hora_fin]);
    if (cambioUbicacion) await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1', [ev.id]);

    await _aplicarEstructura(client, { ...ev, ubicacion_id: datos.ubicacion_id }, est,
      { confirmarQuitar: req.body.confirmar_quitar === true, depositosReiniciados: cambioUbicacion });
    const fin = await client.query('SELECT * FROM eventos WHERE id = $1', [ev.id]);
    await client.query('COMMIT');
    res.json({ ...fin.rows[0], bodegas_reiniciadas: cambioUbicacion });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    _responderError(res, err, 'Error al guardar el evento');
  } finally {
    client.release();
  }
});

// PUT /api/eventos/:id — nivel 4 — editar solo los datos del evento
// Si cambia la ubicación, se limpian los depósitos ya asignados a cada
// enfermero (pertenecían a la sede anterior y podrían no existir en la nueva).
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const datos = _datosEvento(req.body);
  if (datos.error) return res.status(400).json({ error: datos.error });
  const { nombre, fecha_inicio, fecha_fin, ubicacion_id, hora_inicio, hora_fin } = datos;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT ubicacion_id, estado FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]
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
    if (cambioUbicacion && !await _ubicacionActiva(ubicacion_id, client)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La ubicación seleccionada ya no está activa' });
    }

    const result = await client.query(
      `UPDATE eventos SET nombre = $1, fecha_inicio = $2, fecha_fin = $3, ubicacion_id = $4, hora_inicio = $6, hora_fin = $7,
              version = version + 1
       WHERE id = $5 RETURNING *`,
      [nombre, fecha_inicio, fecha_fin, ubicacion_id, req.params.id, hora_inicio, hora_fin]
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

// POST /api/eventos/:id/enfermeros — nivel 4 — agregar personal al evento
// (enfermero con sus depósitos, o médico sin depósitos). La vista completa
// usa /estructura; esta ruta se conserva por compatibilidad.
// body: { usuario_id, bodega_ids?: [...] }
router.post('/:id/enfermeros', verificarToken, verificarNivel(4), async (req, res) => {
  const usuario_id = idValido(req.body.usuario_id);
  if (!usuario_id) return res.status(400).json({ error: 'Selecciona un enfermero o médico' });
  const bodegas = _bodegasDelBody(req.body);
  if (!bodegas) return res.status(400).json({ error: 'Depósitos inválidos' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado, ubicacion_id FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }
    const fuera = await _bodegasFueraDeUbicacion(client, evento.rows[0].ubicacion_id, bodegas);
    if (fuera.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Estos depósitos ya no están en la ubicación del evento: ${fuera.join(', ')}. Recarga e intenta de nuevo.` });
    }
    const invalido = await _validarPersonal(client, usuario_id, bodegas);
    if (invalido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: invalido });
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
    await _subirVersion(client, req.params.id);
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Personal agregado al evento' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al agregar el personal' });
  } finally {
    client.release();
  }
});

// PUT /api/eventos/:id/enfermeros/:usuarioId — nivel 4 — reemplaza los
// depósitos asignados a ESE enfermero dentro del evento y su punto de
// atención (punto_id, o `ubicacion` como texto: se busca o crea el punto con
// ese nombre; obligatorio para enfermeros)
// body: { bodega_ids: [...], punto_id? , ubicacion? }
router.put('/:id/enfermeros/:usuarioId', verificarToken, verificarNivel(4), async (req, res) => {
  const bodegas = _bodegasDelBody(req.body);
  if (!bodegas) return res.status(400).json({ error: 'Depósitos inválidos' });
  const ubicacion = normalizarPunto(texto(req.body.ubicacion || ''));
  const puntoId = req.body.punto_id !== undefined && req.body.punto_id !== null ? idValido(req.body.punto_id) : null;
  if (req.body.punto_id !== undefined && req.body.punto_id !== null && !puntoId) return res.status(400).json({ error: 'Punto de atención inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado, ubicacion_id FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }
    const fuera = await _bodegasFueraDeUbicacion(client, evento.rows[0].ubicacion_id, bodegas);
    if (fuera.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Estos depósitos ya no están en la ubicación del evento: ${fuera.join(', ')}. Recarga e intenta de nuevo.` });
    }
    const miembro = await client.query(
      'SELECT 1 FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2',
      [req.params.id, req.params.usuarioId]
    );
    if (!miembro.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Esa persona no pertenece a este evento' });
    }
    const invalido = await _validarPersonal(client, req.params.usuarioId, bodegas, false);
    if (invalido) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: invalido });
    }
    const nivel = (await client.query('SELECT nivel FROM usuarios WHERE id = $1', [req.params.usuarioId])).rows[0].nivel;
    if (nivel !== NIVEL_MEDICO) {
      let punto = null;
      if (puntoId) {
        const p = await client.query('SELECT id, nombre FROM evento_puntos WHERE id = $1 AND evento_id = $2 AND activo = true', [puntoId, req.params.id]);
        if (!p.rows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Ese punto de atención no es de este evento' });
        }
        punto = p.rows[0];
      } else if (ubicacion.length >= 2) {
        punto = { id: await _puntoPorNombre(client, req.params.id, ubicacion), nombre: ubicacion };
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Elige el punto de atención del enfermero dentro del evento' });
      }
      await client.query('UPDATE evento_usuarios SET punto_id = $3, ubicacion = $4 WHERE evento_id = $1 AND usuario_id = $2',
        [req.params.id, req.params.usuarioId, punto.id, punto.nombre]);
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
    await _subirVersion(client, req.params.id);
    await client.query('COMMIT');
    res.json({ mensaje: 'Depósitos y punto de atención actualizados' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar los depósitos' });
  } finally {
    client.release();
  }
});

// DELETE /api/eventos/:id/enfermeros/:usuarioId — nivel 4 — quitar del evento.
// Un médico no se quita de un evento en curso (ver /estructura).
router.delete('/:id/enfermeros/:usuarioId', verificarToken, verificarNivel(4), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evento = await client.query('SELECT id, estado FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]);
    if (!evento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    if (evento.rows[0].estado === 'finalizado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes editar un evento finalizado' });
    }
    const u = await client.query('SELECT nivel FROM usuarios WHERE id = $1', [req.params.usuarioId]);
    const esMedico = u.rows.length && u.rows[0].nivel === NIVEL_MEDICO;
    if (esMedico && evento.rows[0].estado === 'en_curso') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El evento está en curso: el médico no se puede quitar del evento. Quítale sus puntos de atención.' });
    }
    if (esMedico) {
      await client.query('UPDATE evento_puntos SET medico_id = NULL WHERE evento_id = $1 AND medico_id = $2', [req.params.id, req.params.usuarioId]);
    }
    await client.query('DELETE FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2', [req.params.id, req.params.usuarioId]);
    await client.query('DELETE FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2', [req.params.id, req.params.usuarioId]);
    await _subirVersion(client, req.params.id);
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

// POST /api/eventos/:id/iniciar — nivel 4. Cada enfermero debe tener su
// punto de atención (de ahí sale el médico responsable de sus HC).
router.post('/:id/iniciar', verificarToken, verificarNivel(4), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Bloquea el evento: un guardado de la estructura al mismo tiempo espera
    await client.query('SELECT id FROM eventos WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]);
    const sinPunto = await client.query(`
      SELECT us.nombre FROM evento_usuarios eu
      JOIN usuarios us ON us.id = eu.usuario_id
      LEFT JOIN evento_puntos p ON p.id = eu.punto_id AND p.activo = true
      WHERE eu.evento_id = $1 AND us.nivel <> $2 AND p.id IS NULL
      ORDER BY us.nombre`, [req.params.id, NIVEL_MEDICO]);
    if (sinPunto.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Asigna un punto de atención a: ${sinPunto.rows.map(r => r.nombre).join(', ')}` });
    }
    const result = await client.query(
      `UPDATE eventos SET estado = 'en_curso', iniciado_at = NOW(), version = version + 1
       WHERE id = $1 AND activo = true AND estado = 'creado' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El evento no se puede iniciar (ya está en curso o finalizado)' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/eventos/:id/finalizar — nivel 4. No se puede con personal en
// turno (asistencia). Quien no marcó ningún turno queda como "no asistió".
router.post('/:id/finalizar', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const bloqueo = await bloqueoPorTurnosAbiertos(pool, req.params.id, 'finalizar');
    if (bloqueo) return res.status(400).json({ error: bloqueo });
    const result = await pool.query(
      `UPDATE eventos SET estado = 'finalizado', finalizado_at = NOW(), version = version + 1
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
    const bloqueo = await bloqueoPorTurnosAbiertos(pool, req.params.id, 'eliminar');
    if (bloqueo) return res.status(400).json({ error: bloqueo });
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
