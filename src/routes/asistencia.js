// Asistencia de personal — tablets de /datacontrol y módulo admin "Asistencias".
//
// Tablet (cuenta propia, sesión sin vencimiento; no sirve para el resto de la app):
//   POST /api/asistencia/kiosco/login     usuario + contraseña → token
//   GET  /api/asistencia/kiosco/datos     eventos vigentes, su personal (con
//                                         sal y hash del PIN) y jornadas abiertas
//   POST /api/asistencia/kiosco/marcas    entradas y salidas (en línea o las
//                                         guardadas sin conexión), con foto
// Admin (nivel 4):
//   GET  /api/asistencia                  jornadas con filtros + resumen
//   GET  /api/asistencia/:id/foto/:tipo   foto de la entrada o la salida
//   POST /api/asistencia/:id/salida       salida manual (fecha, hora, motivo)
//   GET/PUT /api/asistencia/cuenta        cuenta de las tablets
//   POST /api/asistencia/cuenta/cerrar-sesiones   invalida todas las tablets
//
// Reglas: solo médicos y enfermeros asignados al evento; entrada dentro de las
// fechas del evento (hora de Colombia); jornada = entrada → salida, aunque la
// salida caiga otro día; máximo 16 h (si no, "sin salida" y la salida la pone
// el administrador); una sola jornada abierta por persona.
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { enviarCorreo } = require('../utils/correo');
const { fechaValida } = require('../utils/fechas');
const A = require('../utils/asistencia');

const NIVELES_ASISTENCIA = [1, 2];   // médicos y enfermeros
const MAX_MARCAS = 50;
const RE_CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const idValido = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };

// ══════════════════════════════════════════
// TABLET
// ══════════════════════════════════════════
// Token de la tablet: { kiosco: id }. Sin vencimiento: deja de servir si la
// cuenta se desactiva o si el admin pulsa "Cerrar sesión de tablets"
// (sesiones_desde posterior a la emisión del token).
async function verificarKiosco(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Esta tablet no está activada' });
  let p;
  try { p = jwt.verify(token, process.env.JWT_SECRET); }
  catch (e) { return res.status(401).json({ error: 'Esta tablet no está activada' }); }
  if (!p || !idValido(p.kiosco) || !p.iat) return res.status(401).json({ error: 'Esta tablet no está activada' });
  try {
    const r = await pool.query(
      'SELECT id, usuario FROM asistencia_cuentas WHERE id = $1 AND activo = true AND $2::bigint >= FLOOR(EXTRACT(EPOCH FROM sesiones_desde))',
      [p.kiosco, p.iat]);
    if (!r.rows.length) return res.status(401).json({ error: 'La sesión de esta tablet se cerró. Vuelve a activarla.' });
    req.kiosco = r.rows[0];
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
}

router.post('/kiosco/login', async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!usuario || !password) return res.status(400).json({ error: 'Escribe el usuario y la contraseña de la tablet' });
  try {
    const r = await pool.query('SELECT id, usuario, password_hash FROM asistencia_cuentas WHERE usuario = $1 AND activo = true', [usuario]);
    const c = r.rows[0];
    if (!c || !(await bcrypt.compare(password, c.password_hash))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign({ kiosco: c.id }, process.env.JWT_SECRET);   // sin vencimiento
    res.json({ token, usuario: c.usuario });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Jornadas abiertas hace más de 16 h pasan a "sin salida"
async function _vencerJornadas(db) {
  await db.query(
    `UPDATE asistencia_jornadas SET estado = 'sin_salida'
     WHERE estado = 'abierta' AND entrada_at < NOW() - INTERVAL '16 hours'`);
}

router.get('/kiosco/datos', verificarKiosco, async (req, res) => {
  try {
    await _vencerJornadas(pool);
    const hoy = A.fechaCO(new Date());
    // Eventos vigentes hoy, más los que terminaron ayer (para cerrar turnos
    // que pasan la medianoche del último día)
    const ev = await pool.query(
      `SELECT e.id, e.nombre, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin,
              u.nombre AS ubicacion_nombre, COALESCE(u.es_temporal, false) AS es_temporal
       FROM eventos e LEFT JOIN ubicaciones u ON u.id = e.ubicacion_id
       WHERE e.activo = true AND e.estado <> 'finalizado'
         AND e.fecha_inicio <= $1::date AND e.fecha_fin >= ($1::date - 1)
       ORDER BY e.fecha_inicio, e.nombre`, [hoy]);
    const ids = ev.rows.map(e => e.id);
    let personal = [], abiertas = [];
    if (ids.length) {
      personal = (await pool.query(
        `SELECT eu.evento_id, us.id, us.nombre, us.cedula, us.nivel,
                us.pin_asistencia_salt AS pin_sal, us.pin_asistencia_hash AS pin_hash
         FROM evento_usuarios eu JOIN usuarios us ON us.id = eu.usuario_id
         WHERE eu.evento_id = ANY($1::int[]) AND us.activo = true AND us.nivel = ANY($2::int[])
         ORDER BY us.nombre`, [ids, NIVELES_ASISTENCIA])).rows;
      const usuarios = [...new Set(personal.map(p => p.id))];
      if (usuarios.length) {
        abiertas = (await pool.query(
          `SELECT usuario_id, evento_id, entrada_client_id, entrada_at
           FROM asistencia_jornadas WHERE estado = 'abierta' AND usuario_id = ANY($1::int[])`, [usuarios])).rows;
      }
    }
    res.json({
      hora_servidor: new Date().toISOString(),
      hoy,
      eventos: ev.rows.map(e => ({
        ...e,
        permite_entrada: e.fecha_fin >= hoy,
        personal: personal.filter(p => p.evento_id === e.id).map(p => ({
          id: p.id, nombre: p.nombre, cedula: p.cedula, nivel: p.nivel, pin_sal: p.pin_sal, pin_hash: p.pin_hash
        }))
      })),
      abiertas
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Aviso por correo de cada entrada y salida (no detiene la respuesta)
function _avisar(tipo, j, foto) {
  const para = process.env.ASISTENCIA_CORREO_DESTINO;
  const esEntrada = tipo === 'entrada';
  const hora = A.fechaHoraCO(esEntrada ? j.entrada_at : j.salida_at);
  const asunto = `${esEntrada ? 'Entrada' : 'Salida'}${j.salida_manual && !esEntrada ? ' (manual)' : ''} · ${j.persona} · ${j.evento} · ${hora}`;
  const filas = [
    ['Persona', `${j.persona} (CC ${j.cedula})`],
    ['Evento', j.evento],
    [esEntrada ? 'Entrada' : 'Salida', hora],
  ];
  if (!esEntrada) {
    filas.push(['Entrada', A.fechaHoraCO(j.entrada_at)]);
    filas.push(['Tiempo trabajado', A.textoDuracion(A.minutosEntre(j.entrada_at, j.salida_at))]);
    if (j.salida_manual) filas.push(['Registrada por', `${j.salida_manual_por} — ${j.salida_manual_motivo}`]);
  }
  if (j.offline) filas.push(['Nota', 'Marcada sin conexión; se sincronizó después']);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0A1628">
    <h2 style="margin:0 0 10px;font-size:18px">${esEntrada ? 'Entrada' : 'Salida'} registrada</h2>
    <table style="border-collapse:collapse">${filas.map(([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>
    <p style="color:#888;font-size:12px;margin-top:14px">MediStock · Asistencia de personal</p></div>`;
  const texto = filas.map(([k, v]) => `${k}: ${v}`).join('\n');
  const adjuntos = foto ? [{ filename: `${tipo}-${j.cedula}.${A.mimeFoto(foto) === 'image/png' ? 'png' : 'jpg'}`, content: foto }] : [];
  enviarCorreo({ para, asunto, html, texto, adjuntos })
    .catch(e => console.error('ERROR enviando correo de asistencia:', e.message));
}

// Datos para el correo de una jornada
async function _datosAviso(db, jornadaId) {
  const r = await db.query(
    `SELECT j.*, us.nombre AS persona, us.cedula, e.nombre AS evento
     FROM asistencia_jornadas j JOIN usuarios us ON us.id = j.usuario_id JOIN eventos e ON e.id = j.evento_id
     WHERE j.id = $1`, [jornadaId]);
  return r.rows[0];
}

// Valida a la persona: asignada al evento, médico o enfermero, PIN correcto
async function _validarPersona(db, eventoId, usuarioId, pin) {
  const r = await db.query(
    `SELECT us.id, us.pin_asistencia_salt AS sal, us.pin_asistencia_hash AS hash
     FROM evento_usuarios eu JOIN usuarios us ON us.id = eu.usuario_id
     WHERE eu.evento_id = $1 AND eu.usuario_id = $2 AND us.activo = true AND us.nivel = ANY($3::int[])`,
    [eventoId, usuarioId, NIVELES_ASISTENCIA]);
  if (!r.rows.length) return 'No está asignado a este evento';
  if (!r.rows[0].hash) return 'No tiene PIN de asistencia: pídelo al administrador';
  if (!A.pinCoincide(r.rows[0].sal, r.rows[0].hash, pin)) return 'PIN incorrecto';
  return null;
}

// Una marca (entrada o salida) dentro de su propia transacción.
// Devuelve { estado: 'ok' | 'duplicado' | 'error', error?, jornada_id? }
async function _procesarMarca(m, fecha, desfaseSeg) {
  const foto = m.foto ? A.fotoDesdeDataUrl(m.foto) : null;
  if (m.foto && !foto) return { estado: 'error', error: 'La foto no es válida' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (m.tipo === 'entrada') {
      const ya = await client.query('SELECT id FROM asistencia_jornadas WHERE entrada_client_id = $1', [m.client_id]);
      if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado', jornada_id: ya.rows[0].id }; }
      const persona = await _validarPersona(client, m.evento_id, m.usuario_id, m.pin);
      if (persona) { await client.query('ROLLBACK'); return { estado: 'error', error: persona }; }
      const ev = await client.query(
        `SELECT fecha_inicio::text AS ini, fecha_fin::text AS fin, estado, finalizado_at
         FROM eventos WHERE id = $1 AND activo = true`, [m.evento_id]);
      const e = ev.rows[0];
      const dia = A.fechaCO(fecha);
      if (!e || dia < e.ini || dia > e.fin) { await client.query('ROLLBACK'); return { estado: 'error', error: 'Fuera de las fechas del evento' }; }
      if (e.estado === 'finalizado' && e.finalizado_at && fecha.getTime() > new Date(e.finalizado_at).getTime() + 10 * 60000) {
        await client.query('ROLLBACK'); return { estado: 'error', error: 'El evento ya finalizó' };
      }
      // Jornadas abiertas de más de 16 h (respecto a esta entrada) → sin salida
      await client.query(
        `UPDATE asistencia_jornadas SET estado = 'sin_salida'
         WHERE usuario_id = $1 AND estado = 'abierta' AND entrada_at < $2::timestamptz - INTERVAL '16 hours'`,
        [m.usuario_id, fecha.toISOString()]);
      const abierta = await client.query(
        `SELECT j.entrada_at, e.nombre FROM asistencia_jornadas j JOIN eventos e ON e.id = j.evento_id
         WHERE j.usuario_id = $1 AND j.estado = 'abierta'`, [m.usuario_id]);
      if (abierta.rows.length) {
        await client.query('ROLLBACK');
        return { estado: 'error', error: `Ya tiene una entrada abierta (${abierta.rows[0].nombre}, ${A.fechaHoraCO(abierta.rows[0].entrada_at)}): debe marcar salida primero` };
      }
      const ins = await client.query(
        `INSERT INTO asistencia_jornadas
           (evento_id, usuario_id, estado, entrada_client_id, entrada_at, entrada_foto, entrada_offline, reloj_desfase_seg)
         VALUES ($1, $2, 'abierta', $3, $4, $5, $6, $7) RETURNING id`,
        [m.evento_id, m.usuario_id, m.client_id, fecha.toISOString(), foto, !!m.offline, desfaseSeg]);
      await client.query('COMMIT');
      return { estado: 'ok', jornada_id: ins.rows[0].id, foto };
    }
    // Salida
    const ya = await client.query('SELECT id FROM asistencia_jornadas WHERE salida_client_id = $1', [m.client_id]);
    if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado', jornada_id: ya.rows[0].id }; }
    const persona = await _validarPersona(client, m.evento_id, m.usuario_id, m.pin);
    if (persona) { await client.query('ROLLBACK'); return { estado: 'error', error: persona }; }
    const jr = await client.query(
      'SELECT id, usuario_id, estado, entrada_at, salida_at FROM asistencia_jornadas WHERE entrada_client_id = $1 FOR UPDATE',
      [m.jornada_client_id]);
    const j = jr.rows[0];
    if (!j || j.usuario_id !== m.usuario_id) { await client.query('ROLLBACK'); return { estado: 'error', error: 'No se encontró la entrada de esta salida' }; }
    if (j.salida_at) { await client.query('ROLLBACK'); return { estado: 'error', error: 'Esta jornada ya tenía salida' }; }
    const dur = fecha.getTime() - new Date(j.entrada_at).getTime();
    if (dur <= 0) { await client.query('ROLLBACK'); return { estado: 'error', error: 'La salida no puede ser antes de la entrada' }; }
    if (dur > A.MAX_JORNADA_MS) {
      await client.query("UPDATE asistencia_jornadas SET estado = 'sin_salida' WHERE id = $1 AND estado = 'abierta'", [j.id]);
      await client.query('COMMIT');
      return { estado: 'error', error: 'Pasaron más de 16 horas desde la entrada: la salida la registra el administrador' };
    }
    await client.query(
      `UPDATE asistencia_jornadas SET estado = 'cerrada', salida_client_id = $2, salida_at = $3, salida_recibida_at = NOW(),
              salida_foto = $4, salida_offline = $5,
              reloj_desfase_seg = CASE WHEN ABS(COALESCE($6::int, 0)) > ABS(COALESCE(reloj_desfase_seg, 0)) THEN $6::int ELSE reloj_desfase_seg END
       WHERE id = $1`,
      [j.id, m.client_id, fecha.toISOString(), foto, !!m.offline, desfaseSeg]);
    await client.query('COMMIT');
    return { estado: 'ok', jornada_id: j.id, foto };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return { estado: 'error', error: 'Ya tiene una entrada abierta: debe marcar salida primero' };
    }
    throw err;
  } finally {
    client.release();
  }
}

router.post('/kiosco/marcas', verificarKiosco, async (req, res) => {
  const marcas = req.body && req.body.marcas;
  if (!Array.isArray(marcas) || !marcas.length) return res.status(400).json({ error: 'No hay marcas para enviar' });
  if (marcas.length > MAX_MARCAS) return res.status(400).json({ error: `Máximo ${MAX_MARCAS} marcas por envío` });
  // Reloj de la tablet: si difiere del servidor se corrigen las horas de sus
  // marcas con esa diferencia (el reloj desfasado afecta a todas por igual)
  const ahora = Date.now();
  const reloj = Date.parse(req.body.reloj_tablet);
  const desfase = isNaN(reloj) ? 0 : ahora - reloj;
  const corregir = Math.abs(desfase) > A.TOLERANCIA_RELOJ_MS;
  const desfaseSeg = corregir ? Math.round(desfase / 1000) : null;

  const resultados = [];
  for (const m0 of marcas) {
    const m = m0 && typeof m0 === 'object' ? m0 : {};
    const client_id = RE_CLIENT_ID.test(String(m.client_id || '')) ? String(m.client_id) : null;
    if (!client_id) { resultados.push({ client_id: m.client_id, estado: 'error', error: 'Identificador de marca inválido' }); continue; }
    const tipo = m.tipo === 'entrada' || m.tipo === 'salida' ? m.tipo : null;
    const evento_id = idValido(m.evento_id), usuario_id = idValido(m.usuario_id);
    const pin = typeof m.pin === 'string' ? m.pin : '';
    const jornada_client_id = tipo === 'salida' && RE_CLIENT_ID.test(String(m.jornada_client_id || '')) ? String(m.jornada_client_id) : null;
    if (!tipo || !evento_id || !usuario_id || !A.pinValido(pin) || (tipo === 'salida' && !jornada_client_id)) {
      resultados.push({ client_id, estado: 'error', error: 'Faltan datos de la marca' });
      continue;
    }
    let fecha = new Date(Date.parse(m.fecha));
    if (isNaN(fecha.getTime())) fecha = new Date(ahora);
    if (corregir) fecha = new Date(fecha.getTime() + desfase);
    if (fecha.getTime() > ahora + 10 * 60000) fecha = new Date(ahora);
    try {
      const r = await _procesarMarca({ client_id, tipo, evento_id, usuario_id, pin, jornada_client_id, foto: m.foto, offline: !!m.offline },
        fecha, desfaseSeg);
      resultados.push({ client_id, estado: r.estado, error: r.error, jornada_id: r.jornada_id });
      if (r.estado === 'ok') {
        const j = await _datosAviso(pool, r.jornada_id);
        if (j) _avisar(tipo, { ...j, offline: !!m.offline }, r.foto);
      }
    } catch (err) {
      console.error('ERROR registrando marca de asistencia', client_id, err.message);
      resultados.push({ client_id, estado: 'error', error: 'Error del servidor', reintentar: true });
    }
  }
  res.json({ resultados, hora_servidor: new Date().toISOString() });
});

// ══════════════════════════════════════════
// ADMIN (nivel 4)
// ══════════════════════════════════════════
router.get('/cuenta', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const r = await pool.query('SELECT usuario, activo, sesiones_desde, actualizada_at FROM asistencia_cuentas ORDER BY id LIMIT 1');
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Crea o actualiza la cuenta de las tablets. La contraseña es obligatoria al
// crearla; al editar, solo si se quiere cambiar (mín. 8 caracteres).
router.put('/cuenta', verificarToken, verificarNivel(4), async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  if (!/^[a-z0-9._@-]{4,80}$/.test(usuario)) return res.status(400).json({ error: 'Usuario inválido (letras, números, punto, guion o @)' });
  if (password && password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  try {
    const actual = await pool.query('SELECT id FROM asistencia_cuentas ORDER BY id LIMIT 1');
    if (!actual.rows.length) {
      if (!password) return res.status(400).json({ error: 'Asigna una contraseña a la cuenta de las tablets' });
      await pool.query('INSERT INTO asistencia_cuentas (usuario, password_hash) VALUES ($1, $2)', [usuario, await bcrypt.hash(password, 10)]);
    } else {
      await pool.query(
        `UPDATE asistencia_cuentas SET usuario = $2, actualizada_at = NOW(),
                password_hash = COALESCE($3, password_hash),
                sesiones_desde = CASE WHEN $3::text IS NULL THEN sesiones_desde ELSE NOW() END
         WHERE id = $1`,
        [actual.rows[0].id, usuario, password ? await bcrypt.hash(password, 10) : null]);
    }
    res.json({ mensaje: password && actual.rows.length ? 'Cuenta actualizada: las tablets deben activarse con la contraseña nueva' : 'Cuenta guardada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/cuenta/cerrar-sesiones', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    // +1 s: los tokens emitidos en este mismo segundo también quedan fuera
    const r = await pool.query("UPDATE asistencia_cuentas SET sesiones_desde = NOW() + INTERVAL '1 second' RETURNING id");
    if (!r.rows.length) return res.status(400).json({ error: 'No hay cuenta de tablets creada' });
    res.json({ mensaje: 'Se cerró la sesión de todas las tablets' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/asistencia?evento_id&desde&hasta&usuario_id&estado
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  const q = req.query, cond = ['1=1'], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (q.evento_id) { const id = idValido(q.evento_id); if (!id) return res.status(400).json({ error: 'Evento inválido' }); cond.push(`j.evento_id = ${p(id)}`); }
  if (q.usuario_id) { const id = idValido(q.usuario_id); if (!id) return res.status(400).json({ error: 'Persona inválida' }); cond.push(`j.usuario_id = ${p(id)}`); }
  if (q.desde) { if (!fechaValida(q.desde)) return res.status(400).json({ error: 'Fecha "desde" inválida' }); cond.push(`j.entrada_at >= ${p(A.desdeCO(q.desde, '00:00').toISOString())}`); }
  if (q.hasta) { if (!fechaValida(q.hasta)) return res.status(400).json({ error: 'Fecha "hasta" inválida' }); cond.push(`j.entrada_at < ${p(new Date(A.desdeCO(q.hasta, '00:00').getTime() + 864e5).toISOString())}`); }
  if (q.estado) {
    if (q.estado === 'manual') cond.push('j.salida_manual = true');
    else if (['abierta', 'cerrada', 'sin_salida'].indexOf(q.estado) >= 0) cond.push(`j.estado = ${p(q.estado)}`);
    else return res.status(400).json({ error: 'Estado inválido' });
  }
  try {
    await _vencerJornadas(pool);
    const r = await pool.query(
      `SELECT j.id, j.evento_id, e.nombre AS evento, j.usuario_id, us.nombre AS persona, us.cedula, us.nivel,
              j.estado, j.entrada_at, j.salida_at, j.entrada_offline, j.salida_offline,
              j.salida_manual, j.salida_manual_por, j.salida_manual_motivo, j.salida_manual_at, j.reloj_desfase_seg,
              (j.entrada_foto IS NOT NULL) AS foto_entrada, (j.salida_foto IS NOT NULL) AS foto_salida,
              CASE WHEN j.salida_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (j.salida_at - j.entrada_at)) / 60)::int END AS minutos
       FROM asistencia_jornadas j
       JOIN usuarios us ON us.id = j.usuario_id
       JOIN eventos e ON e.id = j.evento_id
       WHERE ${cond.join(' AND ')}
       ORDER BY j.entrada_at DESC, j.id DESC
       LIMIT 5000`, params);
    let asignadas = null;
    if (q.evento_id) {
      asignadas = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM evento_usuarios eu JOIN usuarios us ON us.id = eu.usuario_id
         WHERE eu.evento_id = $1 AND us.activo = true AND us.nivel = ANY($2::int[])`, [idValido(q.evento_id), NIVELES_ASISTENCIA])).rows[0].n;
    }
    const filas = r.rows;
    res.json({
      jornadas: filas,
      resumen: {
        personas_asignadas: asignadas,
        en_turno: filas.filter(f => f.estado === 'abierta').length,
        sin_salida: filas.filter(f => f.estado === 'sin_salida').length,
        minutos: filas.reduce((s, f) => s + (f.minutos || 0), 0)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/:id/foto/:tipo', verificarToken, verificarNivel(4), async (req, res) => {
  const id = idValido(req.params.id);
  const col = req.params.tipo === 'entrada' ? 'entrada_foto' : req.params.tipo === 'salida' ? 'salida_foto' : null;
  if (!id || !col) return res.status(400).json({ error: 'Solicitud inválida' });
  try {
    const r = await pool.query(`SELECT ${col} AS foto FROM asistencia_jornadas WHERE id = $1`, [id]);
    const foto = r.rows[0] && r.rows[0].foto;
    if (!foto) return res.status(404).json({ error: 'Sin foto' });
    res.set({ 'Content-Type': A.mimeFoto(foto), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(foto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Salida manual: el administrador pone la hora (y el motivo) de una jornada
// abierta o sin salida. Queda registrado quién y cuándo.
router.post('/:id/salida', verificarToken, verificarNivel(4), async (req, res) => {
  const id = idValido(req.params.id);
  const b = req.body || {};
  const motivo = typeof b.motivo === 'string' ? b.motivo.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!id) return res.status(400).json({ error: 'Solicitud inválida' });
  if (!fechaValida(b.fecha) || !RE_HORA.test(String(b.hora || ''))) return res.status(400).json({ error: 'Indica la fecha y la hora de salida' });
  if (motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la salida manual' });
  const salida = A.desdeCO(b.fecha, b.hora);
  if (salida.getTime() > Date.now() + 5 * 60000) return res.status(400).json({ error: 'La salida no puede quedar en el futuro' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id, estado, entrada_at, salida_at FROM asistencia_jornadas WHERE id = $1 FOR UPDATE', [id]);
    const j = r.rows[0];
    if (!j) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Jornada no encontrada' }); }
    if (j.salida_at) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Esta jornada ya tiene salida' }); }
    const dur = salida.getTime() - new Date(j.entrada_at).getTime();
    if (dur <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La salida debe ser después de la entrada' }); }
    if (dur > A.MAX_SALIDA_MANUAL_MS) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La salida no puede ser más de 24 horas después de la entrada' }); }
    await client.query(
      `UPDATE asistencia_jornadas SET estado = 'cerrada', salida_at = $2, salida_recibida_at = NOW(),
              salida_manual = true, salida_manual_por = $3, salida_manual_motivo = $4, salida_manual_at = NOW()
       WHERE id = $1`,
      [id, salida.toISOString(), req.usuario.nombre, motivo]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
  try {
    const j = await _datosAviso(pool, id);
    if (j) _avisar('salida', j, null);
  } catch (e) { console.error(e.message); }
  res.json({ mensaje: 'Salida registrada' });
});

module.exports = router;
