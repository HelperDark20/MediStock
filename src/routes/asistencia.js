// Asistencia de personal — tablets de /datacontrol y módulo admin "Asistencias".
//
// El personal que marca es el que el admin carga para cada evento desde un
// archivo (nombre completo y cédula) en el módulo Asistencias. El PIN es el
// final de la cédula; la foto de cada marca es la evidencia.
//
// Tablet (cuenta propia, sesión sin vencimiento; no sirve para el resto de la app):
//   POST /api/asistencia/kiosco/login     usuario + contraseña → token
//   GET  /api/asistencia/kiosco/datos     eventos vigentes con su personal
//                                         cargado y las jornadas abiertas
//   POST /api/asistencia/kiosco/marcas    entradas y salidas (en línea o las
//                                         guardadas sin conexión), con foto
// Admin y supervisor (nivel 3 o más):
//   GET    /api/asistencia/eventos              eventos activos (para cargar personal)
//   GET    /api/asistencia/personal?evento_id   personal cargado y su estado de hoy
//   POST   /api/asistencia/personal             agrega personal a un evento (no borra)
//   DELETE /api/asistencia/personal/:id         quita a alguien que aún no ha marcado
//   GET    /api/asistencia                      jornadas con filtros + resumen
//   GET    /api/asistencia/:id/foto/:tipo       foto de la entrada o la salida
//   POST   /api/asistencia/:id/salida           salida manual (fecha, hora, motivo)
//   GET/POST /api/asistencia/cuentas            cuentas de las tablets (sin límite)
//   PUT/DELETE /api/asistencia/cuentas/:id      editar (usuario, contraseña nueva) / eliminar
//   POST   /api/asistencia/cuenta/cerrar-sesiones   invalida todas las tablets
//   GET    /api/asistencia/dispositivos         tablets que han marcado (con nombre)
//   PUT    /api/asistencia/dispositivos/:id     nombre de una tablet
//   GET    /api/asistencia/marcas-ip            consolidado de marcas con IP y dispositivo
//
// Reglas: se marca solo con el evento EN CURSO (entre "Iniciar" y "Finalizar"
// evento; sin conexión cuenta la hora en que se marcó); jornada = entrada →
// salida aunque la salida caiga otro día; máximo 16 h (si no, "sin salida" y
// la salida la pone el admin); una sola jornada abierta por cédula.
// Cada marca guarda la IP, el dispositivo (identificador propio de cada
// tablet) y la cuenta con que se hizo: solo para identificar, no bloquea.
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { enviarCorreo } = require('../utils/correo');
const { fechaValida } = require('../utils/fechas');
const A = require('../utils/asistencia');

const MAX_MARCAS = 50;
const MAX_CARGA = 2000;
const RE_CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const idValido = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };

// ══════════════════════════════════════════
// TABLET
// ══════════════════════════════════════════
// Token de la tablet: { kiosco: id }. Sin vencimiento: deja de servir si la
// cuenta se desactiva o si el admin pulsa "Cerrar sesión de tablets"
// (sesiones_desde posterior a la emisión del token).
// Identificador propio de cada tablet (lo genera la tablet y lo guarda en su
// navegador): se registra la primera vez y se actualiza en cada uso
const RE_DISPOSITIVO = /^[A-Za-z0-9_-]{12,64}$/;
async function _dispositivo(req, cuentaId, codigo) {
  codigo = String(codigo || req.headers['x-dispositivo'] || '');
  if (!RE_DISPOSITIVO.test(codigo)) return null;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const r = await pool.query(
    `INSERT INTO asistencia_dispositivos (codigo, cuenta_id, ultima_ip, navegador)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (codigo) DO UPDATE SET ultima_vez_at = NOW(), cuenta_id = $2, ultima_ip = $3, navegador = $4
     RETURNING id`, [codigo, cuentaId, req.ip || null, ua]);
  return r.rows[0].id;
}

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
    await pool.query('UPDATE asistencia_cuentas SET ultimo_ingreso_at = NOW() WHERE id = $1', [c.id]);
    await _dispositivo(req, c.id, req.body && req.body.dispositivo);
    const token = jwt.sign({ kiosco: c.id }, process.env.JWT_SECRET);   // sin vencimiento
    res.json({ token, usuario: c.usuario });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Jornadas abiertas hace más de 16 h pasan a "sin salida"
// Jornadas abiertas que ya no se pueden cerrar desde la tablet → "sin salida"
// (la salida la registra el administrador):
//   - más de 16 h desde la entrada
//   - su evento ya finalizó (no se arrastran al siguiente evento de la persona)
async function _vencerJornadas(db) {
  await db.query(
    `UPDATE asistencia_jornadas j SET estado = 'sin_salida'
     FROM eventos e
     WHERE e.id = j.evento_id AND j.estado = 'abierta'
       AND (j.entrada_at < NOW() - INTERVAL '16 hours' OR e.estado = 'finalizado')`);
}

router.get('/kiosco/datos', verificarKiosco, async (req, res) => {
  try {
    await _vencerJornadas(pool);
    const hoy = A.fechaCO(new Date());
    // Eventos EN CURSO (entre "Iniciar" y "Finalizar" evento) con personal cargado
    const ev = await pool.query(
      `SELECT e.id, e.nombre, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin, e.iniciado_at,
              u.nombre AS ubicacion_nombre, COALESCE(u.es_temporal, false) AS es_temporal
       FROM eventos e LEFT JOIN ubicaciones u ON u.id = e.ubicacion_id
       WHERE e.activo = true AND e.estado = 'en_curso'
         AND EXISTS (SELECT 1 FROM asistencia_personal p WHERE p.evento_id = e.id)
       ORDER BY e.iniciado_at, e.nombre`);
    await _dispositivo(req, req.kiosco.id);
    const ids = ev.rows.map(e => e.id);
    let personal = [], abiertas = [];
    if (ids.length) {
      personal = (await pool.query(
        `SELECT id, evento_id, nombre, cedula FROM asistencia_personal
         WHERE evento_id = ANY($1::int[]) ORDER BY nombre`, [ids])).rows;
      const cedulas = [...new Set(personal.map(p => p.cedula))];
      if (cedulas.length) {
        abiertas = (await pool.query(
          `SELECT j.cedula, j.personal_id, j.evento_id, e.nombre AS evento_nombre, j.entrada_client_id, j.entrada_at
           FROM asistencia_jornadas j JOIN eventos e ON e.id = j.evento_id
           WHERE j.estado = 'abierta' AND j.cedula = ANY($1::text[])`, [cedulas])).rows;
      }
    }
    res.json({
      hora_servidor: new Date().toISOString(),
      hoy,
      aviso_datos_version: A.AVISO_DATOS_VERSION,
      eventos: ev.rows.map(e => ({
        ...e,
        permite_entrada: true,
        personal: personal.filter(p => p.evento_id === e.id).map(p => ({ id: p.id, nombre: p.nombre, cedula: p.cedula }))
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

// Datos de una jornada para el correo (personal cargado o, en jornadas
// anteriores, el usuario)
async function _datosAviso(db, jornadaId) {
  const r = await db.query(
    `SELECT j.*, COALESCE(p.nombre, us.nombre) AS persona, COALESCE(j.cedula, p.cedula, us.cedula) AS cedula, e.nombre AS evento
     FROM asistencia_jornadas j
     LEFT JOIN asistencia_personal p ON p.id = j.personal_id
     LEFT JOIN usuarios us ON us.id = j.usuario_id
     JOIN eventos e ON e.id = j.evento_id
     WHERE j.id = $1`, [jornadaId]);
  return r.rows[0];
}

// La persona debe estar cargada en ese evento y el PIN ser el final de su cédula
async function _validarPersona(db, eventoId, personalId, pin) {
  const r = await db.query('SELECT id, cedula FROM asistencia_personal WHERE id = $1 AND evento_id = $2', [personalId, eventoId]);
  if (!r.rows.length) return { error: 'No está cargada en el personal de este evento' };
  if (!A.pinCoincide(r.rows[0].cedula, pin)) return { error: 'PIN incorrecto' };
  return { cedula: r.rows[0].cedula };
}

// Una marca (entrada o salida) dentro de su propia transacción.
// Devuelve { estado: 'ok' | 'duplicado' | 'error', error?, jornada_id? }
// origen: { ip, dispositivo_id, cuenta_id }
async function _procesarMarca(m, fecha, desfaseSeg, origen) {
  origen = origen || {};
  const foto = m.foto ? A.fotoDesdeDataUrl(m.foto) : null;
  if (m.foto && !foto) return { estado: 'error', error: 'La foto no es válida' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (m.tipo === 'entrada') {
      const ya = await client.query('SELECT id FROM asistencia_jornadas WHERE entrada_client_id = $1', [m.client_id]);
      if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado', jornada_id: ya.rows[0].id }; }
      const persona = await _validarPersona(client, m.evento_id, m.personal_id, m.pin);
      if (persona.error) { await client.query('ROLLBACK'); return { estado: 'error', error: persona.error }; }
      // Solo entre "Iniciar" y "Finalizar" evento (hora en que se marcó)
      const ev = await client.query('SELECT estado, iniciado_at, finalizado_at FROM eventos WHERE id = $1 AND activo = true', [m.evento_id]);
      const e = ev.rows[0];
      if (!e || !e.iniciado_at || e.estado === 'creado' || fecha.getTime() < new Date(e.iniciado_at).getTime()) {
        await client.query('ROLLBACK'); return { estado: 'error', error: 'El evento aún no había iniciado (se marca desde que el administrador lo inicia)' };
      }
      if (e.estado === 'finalizado' && e.finalizado_at && fecha.getTime() > new Date(e.finalizado_at).getTime()) {
        await client.query('ROLLBACK'); return { estado: 'error', error: 'El evento ya finalizó' };
      }
      // Jornadas abiertas de más de 16 h (respecto a esta entrada) → sin salida
      await client.query(
        `UPDATE asistencia_jornadas SET estado = 'sin_salida'
         WHERE cedula = $1 AND estado = 'abierta' AND entrada_at < $2::timestamptz - INTERVAL '16 hours'`,
        [persona.cedula, fecha.toISOString()]);
      const abierta = await client.query(
        `SELECT j.entrada_at, e.nombre FROM asistencia_jornadas j JOIN eventos e ON e.id = j.evento_id
         WHERE j.cedula = $1 AND j.estado = 'abierta'`, [persona.cedula]);
      if (abierta.rows.length) {
        await client.query('ROLLBACK');
        return { estado: 'error', error: `Ya tiene una entrada abierta (${abierta.rows[0].nombre}, ${A.fechaHoraCO(abierta.rows[0].entrada_at)}): debe marcar salida primero` };
      }
      const ins = await client.query(
        `INSERT INTO asistencia_jornadas
           (evento_id, personal_id, cedula, estado, entrada_client_id, entrada_at, entrada_foto, entrada_offline, reloj_desfase_seg, aviso_datos,
            entrada_ip, entrada_dispositivo_id, entrada_cuenta_id)
         VALUES ($1, $2, $3, 'abierta', $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [m.evento_id, m.personal_id, persona.cedula, m.client_id, fecha.toISOString(), foto, !!m.offline, desfaseSeg, A.AVISO_DATOS_VERSION,
         origen.ip || null, origen.dispositivo_id || null, origen.cuenta_id || null]);
      await client.query('COMMIT');
      return { estado: 'ok', jornada_id: ins.rows[0].id, foto };
    }
    // Salida
    const ya = await client.query('SELECT id FROM asistencia_jornadas WHERE salida_client_id = $1', [m.client_id]);
    if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado', jornada_id: ya.rows[0].id }; }
    const persona = await _validarPersona(client, m.evento_id, m.personal_id, m.pin);
    if (persona.error) { await client.query('ROLLBACK'); return { estado: 'error', error: persona.error }; }
    const jr = await client.query(
      'SELECT id, cedula, estado, entrada_at, salida_at FROM asistencia_jornadas WHERE entrada_client_id = $1 FOR UPDATE',
      [m.jornada_client_id]);
    const j = jr.rows[0];
    if (!j || j.cedula !== persona.cedula) { await client.query('ROLLBACK'); return { estado: 'error', error: 'No se encontró la entrada de esta salida' }; }
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
              reloj_desfase_seg = CASE WHEN ABS(COALESCE($6::int, 0)) > ABS(COALESCE(reloj_desfase_seg, 0)) THEN $6::int ELSE reloj_desfase_seg END,
              salida_ip = $7, salida_dispositivo_id = $8, salida_cuenta_id = $9
       WHERE id = $1`,
      [j.id, m.client_id, fecha.toISOString(), foto, !!m.offline, desfaseSeg, origen.ip || null, origen.dispositivo_id || null, origen.cuenta_id || null]);
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

  let dispositivoId = null;
  try { dispositivoId = await _dispositivo(req, req.kiosco.id, req.body.dispositivo); }
  catch (err) { console.error('ERROR registrando dispositivo de asistencia', err.message); }
  const origen = { ip: req.ip || null, dispositivo_id: dispositivoId, cuenta_id: req.kiosco.id };
  const resultados = [];
  for (const m0 of marcas) {
    const m = m0 && typeof m0 === 'object' ? m0 : {};
    const client_id = RE_CLIENT_ID.test(String(m.client_id || '')) ? String(m.client_id) : null;
    if (!client_id) { resultados.push({ client_id: m.client_id, estado: 'error', error: 'Identificador de marca inválido' }); continue; }
    const tipo = m.tipo === 'entrada' || m.tipo === 'salida' ? m.tipo : null;
    const evento_id = idValido(m.evento_id), personal_id = idValido(m.personal_id);
    const pin = typeof m.pin === 'string' ? m.pin : '';
    const jornada_client_id = tipo === 'salida' && RE_CLIENT_ID.test(String(m.jornada_client_id || '')) ? String(m.jornada_client_id) : null;
    if (!tipo || !evento_id || !personal_id || !A.pinValido(pin) || (tipo === 'salida' && !jornada_client_id)) {
      resultados.push({ client_id, estado: 'error', error: 'Faltan datos de la marca' });
      continue;
    }
    let fecha = new Date(Date.parse(m.fecha));
    if (isNaN(fecha.getTime())) fecha = new Date(ahora);
    if (corregir) fecha = new Date(fecha.getTime() + desfase);
    if (fecha.getTime() > ahora + 10 * 60000) fecha = new Date(ahora);
    try {
      const r = await _procesarMarca({ client_id, tipo, evento_id, personal_id, pin, jornada_client_id, foto: m.foto, offline: !!m.offline },
        fecha, desfaseSeg, origen);
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
// ADMIN Y SUPERVISOR (nivel 3 o más)
// ══════════════════════════════════════════
// Cuentas de las tablets: sin límite. La contraseña no se puede ver (se
// guarda cifrada de una sola vía): se asigna una nueva cuando se necesite.
const RE_USUARIO_TABLET = /^[a-z0-9._@-]{4,80}$/;
router.get('/cuentas', verificarToken, verificarNivel(3), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.usuario, c.created_at, c.actualizada_at, c.ultimo_ingreso_at, c.sesiones_desde,
              (SELECT COUNT(*)::int FROM asistencia_dispositivos d WHERE d.cuenta_id = c.id) AS dispositivos
       FROM asistencia_cuentas c WHERE c.activo = true ORDER BY c.id`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

function _datosCuenta(body, nueva) {
  const usuario = String((body && body.usuario) || '').trim().toLowerCase();
  const password = typeof (body && body.password) === 'string' ? body.password : '';
  if (!RE_USUARIO_TABLET.test(usuario)) return { error: 'Usuario inválido (4 a 80 caracteres: letras, números, punto, guion o @)' };
  if (nueva && !password) return { error: 'Asigna una contraseña a la cuenta' };
  if (password && password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' };
  return { usuario, password };
}

router.post('/cuentas', verificarToken, verificarNivel(3), async (req, res) => {
  const d = _datosCuenta(req.body, true);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query('INSERT INTO asistencia_cuentas (usuario, password_hash) VALUES ($1, $2) RETURNING id',
      [d.usuario, await bcrypt.hash(d.password, 10)]);
    res.status(201).json({ id: r.rows[0].id, mensaje: 'Cuenta creada' });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una cuenta con ese usuario' });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Editar usuario y, si se escribe, contraseña nueva (cierra la sesión de las
// tablets de esa cuenta: se activan con la contraseña nueva)
router.put('/cuentas/:id', verificarToken, verificarNivel(3), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Solicitud inválida' });
  const d = _datosCuenta(req.body, false);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const r = await pool.query(
      `UPDATE asistencia_cuentas SET usuario = $2, actualizada_at = NOW(),
              password_hash = COALESCE($3, password_hash),
              sesiones_desde = CASE WHEN $3::text IS NULL THEN sesiones_desde ELSE NOW() + INTERVAL '1 second' END
       WHERE id = $1 AND activo = true RETURNING id`,
      [id, d.usuario, d.password ? await bcrypt.hash(d.password, 10) : null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json({ mensaje: d.password ? 'Cuenta actualizada: sus tablets deben activarse con la contraseña nueva' : 'Cuenta actualizada' });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una cuenta con ese usuario' });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Eliminar: la cuenta deja de servir y sus tablets quedan fuera (se conserva
// para el registro de las marcas que hizo)
router.delete('/cuentas/:id', verificarToken, verificarNivel(3), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Solicitud inválida' });
  try {
    const r = await pool.query(
      "UPDATE asistencia_cuentas SET activo = false, sesiones_desde = NOW() + INTERVAL '1 second', actualizada_at = NOW() WHERE id = $1 AND activo = true RETURNING usuario",
      [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json({ mensaje: `Cuenta ${r.rows[0].usuario} eliminada: sus tablets quedaron fuera` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Dispositivos e IP ──
router.get('/dispositivos', verificarToken, verificarNivel(3), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.codigo, d.nombre, d.primera_vez_at, d.ultima_vez_at, d.ultima_ip, d.navegador, c.usuario AS cuenta,
              (SELECT COUNT(*)::int FROM asistencia_jornadas j WHERE j.entrada_dispositivo_id = d.id OR j.salida_dispositivo_id = d.id) AS jornadas
       FROM asistencia_dispositivos d LEFT JOIN asistencia_cuentas c ON c.id = d.cuenta_id
       ORDER BY d.ultima_vez_at DESC`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.put('/dispositivos/:id', verificarToken, verificarNivel(3), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Solicitud inválida' });
  const nombre = String((req.body && req.body.nombre) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  try {
    const r = await pool.query('UPDATE asistencia_dispositivos SET nombre = $2 WHERE id = $1 RETURNING id', [id, nombre || null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json({ mensaje: nombre ? 'Nombre guardado' : 'Nombre quitado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Consolidado: una fila por marca (entrada y salida) con la IP, el
// dispositivo y la cuenta. Señala las IP distintas a la más usada en el
// evento y los dispositivos sin nombre (no registrados por el admin).
// Filtros: evento_id, desde, hasta (fecha de la marca, hora de Colombia)
router.get('/marcas-ip', verificarToken, verificarNivel(3), async (req, res) => {
  const q = req.query, cond = ['1=1'], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (q.evento_id) { const id = idValido(q.evento_id); if (!id) return res.status(400).json({ error: 'Evento inválido' }); cond.push(`m.evento_id = ${p(id)}`); }
  if (q.desde) { if (!fechaValida(q.desde)) return res.status(400).json({ error: 'Fecha "desde" inválida' }); cond.push(`m.fecha >= ${p(A.desdeCO(q.desde, '00:00').toISOString())}`); }
  if (q.hasta) { if (!fechaValida(q.hasta)) return res.status(400).json({ error: 'Fecha "hasta" inválida' }); cond.push(`m.fecha < ${p(new Date(A.desdeCO(q.hasta, '00:00').getTime() + 864e5).toISOString())}`); }
  try {
    const r = await pool.query(
      `WITH m AS (
         SELECT j.id AS jornada_id, j.evento_id, 'Entrada' AS tipo, j.entrada_at AS fecha, j.entrada_offline AS offline,
                j.entrada_ip AS ip, j.entrada_dispositivo_id AS dispositivo_id, j.entrada_cuenta_id AS cuenta_id, j.personal_id, j.usuario_id, j.cedula
         FROM asistencia_jornadas j
         UNION ALL
         SELECT j.id, j.evento_id, 'Salida', j.salida_at, j.salida_offline, j.salida_ip, j.salida_dispositivo_id, j.salida_cuenta_id,
                j.personal_id, j.usuario_id, j.cedula
         FROM asistencia_jornadas j WHERE j.salida_at IS NOT NULL AND j.salida_manual = false
       )
       SELECT m.*, e.nombre AS evento, COALESCE(pe.nombre, us.nombre) AS persona,
              d.nombre AS dispositivo_nombre, d.codigo AS dispositivo_codigo, c.usuario AS cuenta
       FROM m
       JOIN eventos e ON e.id = m.evento_id
       LEFT JOIN asistencia_personal pe ON pe.id = m.personal_id
       LEFT JOIN usuarios us ON us.id = m.usuario_id
       LEFT JOIN asistencia_dispositivos d ON d.id = m.dispositivo_id
       LEFT JOIN asistencia_cuentas c ON c.id = m.cuenta_id
       WHERE ${cond.join(' AND ')}
       ORDER BY m.fecha DESC
       LIMIT 10000`, params);
    // IP más usada en cada evento (la "habitual")
    const conteo = {};
    r.rows.forEach(x => { if (!x.ip) return; const k = x.evento_id + '|' + x.ip; conteo[k] = (conteo[k] || 0) + 1; });
    const habitual = {};
    Object.keys(conteo).forEach(k => {
      const [ev, ip] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      if (!habitual[ev] || conteo[k] > conteo[ev + '|' + habitual[ev]]) habitual[ev] = ip;
    });
    res.json(r.rows.map(x => ({
      jornada_id: x.jornada_id, evento_id: x.evento_id, evento: x.evento, persona: x.persona, cedula: x.cedula,
      tipo: x.tipo, fecha: x.fecha, offline: x.offline, ip: x.ip, cuenta: x.cuenta,
      dispositivo: x.dispositivo_nombre || (x.dispositivo_codigo ? 'Sin nombre · ' + x.dispositivo_codigo.slice(-6).toUpperCase() : null),
      dispositivo_sin_nombre: !!x.dispositivo_codigo && !x.dispositivo_nombre,
      ip_habitual: habitual[String(x.evento_id)] || null,
      ip_distinta: !!x.ip && !!habitual[String(x.evento_id)] && x.ip !== habitual[String(x.evento_id)]
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/cuenta/cerrar-sesiones', verificarToken, verificarNivel(3), async (req, res) => {
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

// Eventos activos (no finalizados) a los que se puede cargar personal
router.get('/eventos', verificarToken, verificarNivel(3), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id, e.nombre, e.estado, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin,
              u.nombre AS ubicacion_nombre,
              (SELECT COUNT(*)::int FROM asistencia_personal p WHERE p.evento_id = e.id) AS personal
       FROM eventos e LEFT JOIN ubicaciones u ON u.id = e.ubicacion_id
       WHERE e.activo = true AND e.estado <> 'finalizado'
       ORDER BY CASE e.estado WHEN 'en_curso' THEN 0 ELSE 1 END, e.fecha_inicio, e.nombre`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Personal cargado, agrupado por evento, con su estado en el evento. Se mide
// por turnos (entrada → salida) y horas laboradas, no por día de calendario:
// un turno que pasa la medianoche es un solo turno.
//   en_turno   tiene un turno abierto en este evento
//   sin_salida tiene un turno sin salida (pendiente de salida manual)
//   completa   marcó al menos un turno completo
//   sin_marcar aún no ha marcado (evento sin finalizar)
//   no_asistio no marcó ningún turno y el evento ya finalizó
// ?evento_id=N → solo ese evento. Sin evento_id → los eventos sin finalizar
// y los finalizados en los últimos 30 días que tengan personal cargado.
router.get('/personal', verificarToken, verificarNivel(3), async (req, res) => {
  const eventoId = req.query.evento_id ? idValido(req.query.evento_id) : null;
  if (req.query.evento_id && !eventoId) return res.status(400).json({ error: 'Evento inválido' });
  try {
    await _vencerJornadas(pool);
    const ev = await pool.query(
      `SELECT e.id, e.nombre, e.estado, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin, e.finalizado_at
       FROM eventos e
       WHERE e.activo = true AND EXISTS (SELECT 1 FROM asistencia_personal p WHERE p.evento_id = e.id)
         AND ${eventoId ? 'e.id = $1' : "(e.estado <> 'finalizado' OR e.finalizado_at > NOW() - INTERVAL '30 days')"}
       ORDER BY CASE e.estado WHEN 'en_curso' THEN 0 WHEN 'creado' THEN 1 ELSE 2 END, e.fecha_inicio DESC, e.nombre`,
      eventoId ? [eventoId] : []);
    const ids = ev.rows.map(e => e.id);
    const r = ids.length ? await pool.query(
      `SELECT p.id, p.evento_id, p.nombre, p.cedula, p.cargado_por, p.created_at,
              COUNT(j.id)::int AS jornadas,
              COUNT(j.id) FILTER (WHERE j.salida_at IS NOT NULL)::int AS turnos_completos,
              COALESCE(SUM(ROUND(EXTRACT(EPOCH FROM (j.salida_at - j.entrada_at)) / 60)) FILTER (WHERE j.salida_at IS NOT NULL), 0)::int AS minutos,
              MIN(j.entrada_at) FILTER (WHERE j.estado = 'abierta') AS en_turno_desde,
              COUNT(j.id) FILTER (WHERE j.estado = 'sin_salida')::int AS sin_salida,
              MAX(j.entrada_at) AS ultima_entrada
       FROM asistencia_personal p
       LEFT JOIN asistencia_jornadas j ON j.personal_id = p.id
       WHERE p.evento_id = ANY($1::int[])
       GROUP BY p.id
       ORDER BY p.nombre`, [ids]) : { rows: [] };
    res.json(ev.rows.map(e => ({
      evento: { id: e.id, nombre: e.nombre, estado: e.estado, fecha_inicio: e.fecha_inicio, fecha_fin: e.fecha_fin, finalizado_at: e.finalizado_at },
      personal: r.rows.filter(p => p.evento_id === e.id).map(p => ({
        id: p.id, nombre: p.nombre, cedula: p.cedula, cargado_por: p.cargado_por, created_at: p.created_at,
        jornadas: p.jornadas, turnos_completos: p.turnos_completos, minutos: p.minutos,
        en_turno_desde: p.en_turno_desde, ultima_entrada: p.ultima_entrada,
        estado: p.en_turno_desde ? 'en_turno' : p.sin_salida ? 'sin_salida' : p.turnos_completos ? 'completa'
          : e.estado === 'finalizado' ? 'no_asistio' : 'sin_marcar'
      }))
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Agrega personal a un evento. No borra ni cambia a quien ya estaba (una
// cédula repetida se ignora), para no perder sus datos de acceso.
router.post('/personal', verificarToken, verificarNivel(3), async (req, res) => {
  const b = req.body || {};
  const eventoId = idValido(b.evento_id);
  if (!eventoId) return res.status(400).json({ error: 'Elige el evento al que se carga el personal' });
  if (!Array.isArray(b.personas) || !b.personas.length) return res.status(400).json({ error: 'El archivo no trae personas' });
  if (b.personas.length > MAX_CARGA) return res.status(400).json({ error: `Máximo ${MAX_CARGA} personas por archivo` });
  const errores = [], validas = [], vistas = {};
  b.personas.forEach((p, i) => {
    const fila = (p && p.fila) || i + 2;
    const nombre = A.normalizarNombre(p && p.nombre);
    const cedula = A.normalizarCedula(p && p.cedula);
    if (!nombre) errores.push(`Fila ${fila}: falta el nombre completo`);
    else if (!cedula) errores.push(`Fila ${fila}: la cédula debe tener solo números (5 a 15 dígitos)`);
    else if (vistas[cedula]) errores.push(`Fila ${fila}: la cédula ${cedula} está repetida en el archivo (fila ${vistas[cedula]})`);
    else { vistas[cedula] = fila; validas.push({ nombre, cedula }); }
  });
  if (errores.length) return res.status(400).json({ error: errores[0], errores });
  try {
    const ev = await pool.query("SELECT id FROM eventos WHERE id = $1 AND activo = true AND estado <> 'finalizado'", [eventoId]);
    if (!ev.rows.length) return res.status(400).json({ error: 'El evento no existe o ya finalizó' });
    const r = await pool.query(
      `INSERT INTO asistencia_personal (evento_id, nombre, cedula, cargado_por)
       SELECT $1, n, c, $4 FROM unnest($2::text[], $3::text[]) AS t(n, c)
       ON CONFLICT (evento_id, cedula) DO NOTHING
       RETURNING cedula`,
      [eventoId, validas.map(v => v.nombre), validas.map(v => v.cedula), req.usuario.nombre]);
    const agregadas = r.rows.length, ya = validas.length - agregadas;
    res.status(201).json({
      agregadas,
      ya_estaban: ya,
      mensaje: (agregadas === 1 ? 'Se agregó 1 persona' : `Se agregaron ${agregadas} personas`) +
        (ya === 1 ? '; 1 ya estaba cargada y no se modificó' : ya > 1 ? `; ${ya} ya estaban cargadas y no se modificaron` : '')
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Quita a alguien cargado por error, solo si todavía no ha marcado
router.delete('/personal/:id', verificarToken, verificarNivel(3), async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Solicitud inválida' });
  try {
    const usado = await pool.query('SELECT 1 FROM asistencia_jornadas WHERE personal_id = $1 LIMIT 1', [id]);
    if (usado.rows.length) return res.status(400).json({ error: 'Esta persona ya marcó asistencia: no se puede quitar' });
    const fin = await pool.query(
      `SELECT 1 FROM asistencia_personal p JOIN eventos e ON e.id = p.evento_id WHERE p.id = $1 AND e.estado = 'finalizado'`, [id]);
    if (fin.rows.length) return res.status(400).json({ error: 'El evento ya finalizó: su personal queda como registro (no asistió)' });
    const r = await pool.query('DELETE FROM asistencia_personal WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    res.json({ mensaje: 'Persona quitada del evento' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/asistencia?evento_id&desde&hasta&q&estado
router.get('/', verificarToken, verificarNivel(3), async (req, res) => {
  const q = req.query, cond = ['1=1'], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (q.evento_id) { const id = idValido(q.evento_id); if (!id) return res.status(400).json({ error: 'Evento inválido' }); cond.push(`j.evento_id = ${p(id)}`); }
  if (q.q) {
    const t = String(q.q).trim().slice(0, 60);
    const dig = t.replace(/\D/g, '');
    if (t) cond.push(`(COALESCE(pe.nombre, us.nombre) ILIKE ${p('%' + t + '%')}` +
      (dig ? ` OR COALESCE(j.cedula, pe.cedula, us.cedula) LIKE ${p('%' + dig + '%')}` : '') + ')');
  }
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
      `SELECT j.id, j.evento_id, e.nombre AS evento, j.personal_id,
              COALESCE(pe.nombre, us.nombre) AS persona, COALESCE(j.cedula, pe.cedula, us.cedula) AS cedula,
              j.estado, j.entrada_at, j.salida_at, j.entrada_offline, j.salida_offline,
              j.salida_manual, j.salida_manual_por, j.salida_manual_motivo, j.salida_manual_at, j.reloj_desfase_seg,
              (j.entrada_foto IS NOT NULL) AS foto_entrada, (j.salida_foto IS NOT NULL) AS foto_salida,
              CASE WHEN j.salida_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (j.salida_at - j.entrada_at)) / 60)::int END AS minutos
       FROM asistencia_jornadas j
       LEFT JOIN asistencia_personal pe ON pe.id = j.personal_id
       LEFT JOIN usuarios us ON us.id = j.usuario_id
       JOIN eventos e ON e.id = j.evento_id
       WHERE ${cond.join(' AND ')}
       ORDER BY j.entrada_at DESC, j.id DESC
       LIMIT 5000`, params);
    let cargadas = null;
    if (q.evento_id) {
      cargadas = (await pool.query('SELECT COUNT(*)::int AS n FROM asistencia_personal WHERE evento_id = $1', [idValido(q.evento_id)])).rows[0].n;
    }
    const filas = r.rows;
    // Turno más corto y más largo (de todas las personas, turnos completos)
    const completos = filas.filter(f => f.minutos !== null && f.minutos !== undefined);
    const turno = x => x ? { minutos: x.minutos, persona: x.persona, cedula: x.cedula, evento: x.evento, entrada_at: x.entrada_at } : null;
    const masCorto = completos.reduce((a, f) => (!a || f.minutos < a.minutos ? f : a), null);
    const masLargo = completos.reduce((a, f) => (!a || f.minutos > a.minutos ? f : a), null);
    res.json({
      jornadas: filas,
      resumen: {
        personas_cargadas: cargadas,
        en_turno: filas.filter(f => f.estado === 'abierta').length,
        sin_salida: filas.filter(f => f.estado === 'sin_salida').length,
        minutos: filas.reduce((s, f) => s + (f.minutos || 0), 0),
        turno_mas_corto: turno(masCorto),
        turno_mas_largo: turno(masLargo)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/:id/foto/:tipo', verificarToken, verificarNivel(3), async (req, res) => {
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
router.post('/:id/salida', verificarToken, verificarNivel(3), async (req, res) => {
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
