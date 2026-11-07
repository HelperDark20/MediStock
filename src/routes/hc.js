// Historia clínica prehospitalaria — rutas del panel de enfermero.
//
//   POST /api/hc/enviar    la tablet envía la HC terminada; el servidor le
//                          asigna el consecutivo HC-AAAA-NNNN
//   GET  /api/hc/paciente  datos y antecedentes de la última atención del
//                          mismo paciente (para precargar, con conexión)
//
// Módulo admin "Historias clínicas" (solo nivel 4):
//   GET  /api/hc                        listado con filtros
//   GET  /api/hc/:id                    HC completa + adjuntos + rastro de cambios
//   PUT  /api/hc/:id                    edición (con motivo; queda en el rastro)
//   POST /api/hc/:id/adjuntos           sube foto o PDF del recibido (máx. 5 MB)
//   GET  /api/hc/:id/adjuntos/:aid      descarga un adjunto
//   POST /api/hc/:id/entrega            entrega del paciente → la HC se cierra
//   POST /api/hc/:id/firma-medico       firma del médico tomada después
//
// La tablet diligencia la HC aunque no tenga señal y la envía al terminar (o
// al sincronizar). Reenviar la misma HC (mismo client_id) no la duplica:
// devuelve el consecutivo que ya tenía.
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { idValido, validarParamsId } = require('../utils/validar');
const { fechaValida } = require('../utils/fechas');
const {
  normalizarHC, normalizarMedicamentos, estadoInicial, normalizarEntrega, aFormaDeEnvio, diferencias,
  firmaValida, TIPOS_DOC
} = require('../utils/hc');

// :id, :aid deben ser ids numéricos (si no, 400 en vez de error 500)
validarParamsId(router, 'id', 'aid');

const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;           // UTC-5, sin horario de verano
const TOLERANCIA_RELOJ_MS = 10 * 60 * 1000;           // reloj de la tablet adelantado
const ANTIGUEDAD_MAXIMA_MS = 60 * 24 * 3600 * 1000;   // una HC de hace más de 60 días no se acepta

function _clientIdValido(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

// Fecha 'YYYY-MM-DD' y año en hora de Colombia
function _fechaCO(fecha) {
  return new Date(fecha.getTime() - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10);
}

function _consecutivo(anio, numero) {
  return `HC-${anio}-${String(numero).padStart(4, '0')}`;
}

async function _hcExistente(clientId) {
  const r = await pool.query(
    'SELECT id, consecutivo, estado FROM historias_clinicas WHERE client_id = $1', [clientId]
  );
  return r.rows[0] || null;
}

// POST /api/hc/enviar — nivel 2+ (el enfermero que la diligenció)
// body: { client_id, evento_id, inicio_atencion (ISO), datos, firmas }
router.post('/enviar', verificarToken, verificarNivel(2), async (req, res) => {
  const body = req.body || {};
  const clientId = _clientIdValido(body.client_id);
  if (!clientId) return res.status(400).json({ error: 'Identificador de la historia clínica inválido' });
  const eventoId = idValido(body.evento_id);
  if (!eventoId) return res.status(400).json({ error: 'Falta el evento de la atención' });

  const inicio = new Date(body.inicio_atencion);
  if (typeof body.inicio_atencion !== 'string' || isNaN(inicio.getTime())) {
    return res.status(400).json({ error: 'La fecha de inicio de la atención no es válida' });
  }
  if (inicio.getTime() > Date.now() + TOLERANCIA_RELOJ_MS) {
    return res.status(400).json({ error: 'La hora de inicio de la atención está en el futuro: revisa la fecha y hora de la tablet' });
  }
  if (inicio.getTime() < Date.now() - ANTIGUEDAD_MAXIMA_MS) {
    return res.status(400).json({ error: 'La atención tiene más de 60 días: entrégala al administrador' });
  }

  try {
    // Reenvío de una HC que ya llegó (p. ej. se cortó la red antes de la respuesta)
    const previa = await _hcExistente(clientId);
    if (previa) return res.json({ ...previa, duplicado: true });

    // El enfermero debe pertenecer al evento (aunque ya haya finalizado: la
    // HC pudo quedar pendiente de envío sin señal)
    const ev = await pool.query(
      `SELECT e.id, e.nombre, e.ubicacion_id, u.nombre AS ubicacion_nombre,
              u.municipio_codigo, m.nombre AS municipio_nombre, m.departamento AS municipio_departamento
       FROM eventos e
       JOIN evento_usuarios eu ON eu.evento_id = e.id AND eu.usuario_id = $2
       LEFT JOIN ubicaciones u ON u.id = e.ubicacion_id
       LEFT JOIN municipios m ON m.codigo = u.municipio_codigo
       WHERE e.id = $1 AND e.activo = true`,
      [eventoId, req.usuario.id]
    );
    if (!ev.rows.length) return res.status(400).json({ error: 'No perteneces a ese evento' });
    const evento = ev.rows[0];

    // Responsables posibles de un procedimiento: los médicos del evento y el
    // enfermero que diligencia la HC
    const medicos = await pool.query(
      `SELECT us.id, us.nombre, us.cedula FROM evento_usuarios eu
       JOIN usuarios us ON us.id = eu.usuario_id
       WHERE eu.evento_id = $1 AND us.nivel = 1`,
      [evento.id]
    );
    const responsables = {};
    medicos.rows.forEach(m => { responsables[String(m.id)] = { id: m.id, nombre: m.nombre, rol: 'MÉDICO' }; });
    responsables[String(req.usuario.id)] = { id: req.usuario.id, nombre: req.usuario.nombre, rol: 'ENFERMERO/A' };

    const fechaAtencion = _fechaCO(inicio);
    const lugar = [evento.ubicacion_nombre, evento.municipio_nombre].filter(Boolean).join(' — ');
    const { datos, firmas, errores } = normalizarHC(body, fechaAtencion, {
      responsables,
      medicos: medicos.rows,
      enfermero: { id: req.usuario.id, nombre: req.usuario.nombre, cedula: req.usuario.cedula },
      lugar
    });

    // Módulo 6: lo que salió del inventario para esta HC + dosis y vía
    const movs = await pool.query(
      `SELECT m.client_id, m.sub_sku_id, m.cantidad, COALESCE(m.fecha_atencion, m.created_at) AS fecha,
              g.nombre, g.familia, s.lote, s.unidad, b.nombre AS bodega
       FROM movimientos m
       JOIN sub_skus s ON s.id = m.sub_sku_id
       JOIN skus_globales g ON g.id = s.sku_global_id
       LEFT JOIN bodegas b ON b.id = m.bodega_origen_id
       WHERE m.hc_client_id = $1 AND m.tipo = 'consumo' AND m.revertido = false
       ORDER BY m.id`,
      [clientId]
    );
    const meds = normalizarMedicamentos(movs.rows, body.datos && body.datos.medicamentos,
      { id: req.usuario.id, nombre: req.usuario.nombre });
    datos.medicamentos = meds.lista;
    errores.push(...meds.errores);
    if (errores.length) return res.status(400).json({ error: errores[0], errores });

    // Datos del servicio tal como estaban al atender: si después se renombra
    // la ubicación o el evento, la HC conserva lo original
    datos.servicio = {
      fecha: fechaAtencion,
      inicio_atencion: inicio.toISOString(),
      evento: { id: evento.id, nombre: evento.nombre },
      lugar: evento.ubicacion_nombre || '',
      municipio_codigo: evento.municipio_codigo || '',
      municipio: evento.municipio_nombre || '',
      departamento: evento.municipio_departamento || ''
    };
    datos.enfermero = { id: req.usuario.id, nombre: req.usuario.nombre, cedula: req.usuario.cedula };

    const p = datos.paciente;
    const anio = Number(fechaAtencion.slice(0, 4));
    const client = await pool.connect();
    let choque = false;
    try {
      await client.query('BEGIN');
      // Siguiente número del año. Avanza en esta misma transacción: si la
      // inserción falla, el número no se pierde (consecutivo sin huecos)
      const n = await client.query(
        `INSERT INTO hc_consecutivos (anio, ultimo) VALUES ($1, 0)
         ON CONFLICT (anio) DO UPDATE SET ultimo = hc_consecutivos.ultimo + 1
         RETURNING ultimo`,
        [anio]
      );
      const numero = n.rows[0].ultimo;
      const consecutivo = _consecutivo(anio, numero);
      const r = await client.query(
        `INSERT INTO historias_clinicas
           (client_id, anio, numero, consecutivo, estado, evento_id, ubicacion_id, usuario_id,
            inicio_atencion, paciente_tipo_doc, paciente_documento, paciente_nombre, datos, firmas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, consecutivo, estado`,
        [clientId, anio, numero, consecutivo, estadoInicial(datos), evento.id, evento.ubicacion_id, req.usuario.id,
         inicio.toISOString(), p.tipo_doc || null, p.documento || null, `${p.nombres} ${p.apellidos}`.trim(),
         JSON.stringify(datos), JSON.stringify(firmas)]
      );
      // Los consumos de la HC quedan con el documento definitivo del paciente
      // (pudo corregirse, o no tenerlo al registrarlos si era NN)
      await client.query(
        "UPDATE movimientos SET cedula_paciente = $2 WHERE hc_client_id = $1 AND tipo = 'consumo'",
        [clientId, p.documento || null]
      );
      await client.query('COMMIT');
      return res.status(201).json(r.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      // Dos envíos simultáneos de la misma HC: el segundo choca con el primero
      if (err.code !== '23505') throw err;
      choque = true;
    } finally {
      client.release();
    }
    // (fuera de la transacción: la conexión ya se liberó)
    const ya = choque && await _hcExistente(clientId);
    if (ya) return res.json({ ...ya, duplicado: true });
    throw new Error('Conflicto al guardar la historia clínica');
  } catch (err) {
    console.error('ERROR enviando historia clínica', clientId, err.message);
    res.status(500).json({ error: 'Error del servidor. La historia clínica sigue guardada en la tablet: intenta de nuevo.' });
  }
});

// GET /api/hc/paciente?tipo_doc=CC&documento=123 — nivel 2+
// Identificación y antecedentes de la última atención del paciente, para
// precargarlos en una HC nueva. No incluye la atención en sí (motivo,
// valoración, etc.) ni firmas.
router.get('/paciente', verificarToken, verificarNivel(2), async (req, res) => {
  const tipo = String(req.query.tipo_doc || '');
  const doc = String(req.query.documento || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (TIPOS_DOC.indexOf(tipo) < 0 || doc.length < 3) {
    return res.status(400).json({ error: 'Tipo y número de documento requeridos' });
  }
  try {
    const r = await pool.query(
      `SELECT inicio_atencion, datos->'paciente' AS paciente, datos->'antecedentes' AS antecedentes
       FROM historias_clinicas
       WHERE paciente_tipo_doc = $1 AND paciente_documento = $2
       ORDER BY inicio_atencion DESC LIMIT 1`,
      [tipo, doc]
    );
    if (!r.rows.length) return res.json(null);
    const fila = r.rows[0];
    const paciente = { ...fila.paciente };
    delete paciente.edad;   // se recalcula con la fecha de la nueva atención
    res.json({ fecha: fila.inicio_atencion, paciente, antecedentes: fila.antecedentes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ══════════════════════════════════════════
// MÓDULO ADMIN — HISTORIAS CLÍNICAS (nivel 4)
// ══════════════════════════════════════════
const MAX_ADJUNTO = 5 * 1024 * 1024;
const TIPOS_ADJUNTO = { 'image/jpeg': true, 'image/png': true, 'application/pdf': true };
const POR_PAGINA = 50;

async function _registrarCambio(client, hcId, usuario, accion, motivo, cambios) {
  await client.query(
    `INSERT INTO hc_cambios (hc_id, usuario_id, usuario_nombre, accion, motivo, cambios)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [hcId, usuario.id, usuario.nombre, accion, motivo || null, JSON.stringify(cambios || [])]
  );
}

// 'YYYY-MM-DD' (Colombia) → instante UTC del inicio de ese día
function _inicioDiaCO(fecha) { return new Date(`${fecha}T00:00:00Z`).getTime() + COLOMBIA_OFFSET_MS; }

// GET /api/hc — listado. Filtros: desde, hasta (AAAA-MM-DD), ubicacion_id,
// evento_id, documento (o nombre), estado (abierta | cerrada |
// firma_pendiente), pagina (desde 1)
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  const q = req.query, cond = [], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (q.desde) {
    if (!fechaValida(q.desde)) return res.status(400).json({ error: 'Fecha "desde" inválida' });
    cond.push(`h.inicio_atencion >= ${p(new Date(_inicioDiaCO(q.desde)).toISOString())}`);
  }
  if (q.hasta) {
    if (!fechaValida(q.hasta)) return res.status(400).json({ error: 'Fecha "hasta" inválida' });
    cond.push(`h.inicio_atencion < ${p(new Date(_inicioDiaCO(q.hasta) + 864e5).toISOString())}`);
  }
  if (q.ubicacion_id) {
    const u = idValido(q.ubicacion_id);
    if (!u) return res.status(400).json({ error: 'Ubicación inválida' });
    cond.push(`h.ubicacion_id = ${p(u)}`);
  }
  if (q.evento_id) {
    const e = idValido(q.evento_id);
    if (!e) return res.status(400).json({ error: 'Evento inválido' });
    cond.push(`h.evento_id = ${p(e)}`);
  }
  const busq = String(q.documento || '').trim().toUpperCase().slice(0, 80);
  if (busq) {
    const like = `%${busq.replace(/[%_\\]/g, '')}%`;
    cond.push(`(h.paciente_documento ILIKE ${p(like)} OR h.paciente_nombre ILIKE ${p(like)} OR h.consecutivo ILIKE ${p(like)})`);
  }
  if (q.estado === 'abierta' || q.estado === 'cerrada') cond.push(`h.estado = ${p(q.estado)}`);
  else if (q.estado === 'firma_pendiente') cond.push(`(h.datos->'responsables'->>'medico_firma_pendiente') = 'true'`);
  const pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  try {
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM historias_clinicas h ${where}`, params);
    const filas = await pool.query(
      `SELECT h.id, h.consecutivo, h.estado, h.inicio_atencion, h.recibida_at, h.paciente_nombre,
              h.paciente_tipo_doc, h.paciente_documento, h.evento_id, h.ubicacion_id,
              h.datos->'servicio'->'evento'->>'nombre' AS evento_nombre,
              h.datos->'servicio'->>'lugar' AS lugar,
              h.datos->'servicio'->>'municipio' AS municipio,
              h.datos->'enfermero'->>'nombre' AS enfermero_nombre,
              h.datos->>'triage' AS triage,
              h.datos->'cierre'->>'destino' AS destino,
              (h.datos->'responsables'->>'medico_firma_pendiente') = 'true' AS firma_medica_pendiente
       FROM historias_clinicas h ${where}
       ORDER BY h.inicio_atencion DESC, h.id DESC
       LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
      params
    );
    res.json({ total: total.rows[0].n, pagina, por_pagina: POR_PAGINA, filas: filas.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/hc/:id — HC completa, sus adjuntos (sin el contenido) y el rastro
router.get('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM historias_clinicas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    const adj = await pool.query(
      `SELECT id, tipo, nombre, mime, tamano, subido_por_nombre, created_at
       FROM hc_adjuntos WHERE hc_id = $1 ORDER BY id`, [req.params.id]);
    const cambios = await pool.query(
      `SELECT id, usuario_nombre, accion, motivo, cambios, created_at
       FROM hc_cambios WHERE hc_id = $1 ORDER BY id DESC`, [req.params.id]);
    res.json({ ...r.rows[0], adjuntos: adj.rows, cambios: cambios.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/hc/:id/adjuntos/:aid — el archivo tal cual se subió
router.get('/:id/adjuntos/:aid', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const r = await pool.query('SELECT nombre, mime, contenido FROM hc_adjuntos WHERE id = $1 AND hc_id = $2', [req.params.aid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Archivo no encontrado' });
    const a = r.rows[0];
    res.set('Content-Type', a.mime);
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre || 'adjunto')}`);
    res.set('Cache-Control', 'private, no-store');
    res.send(Buffer.from(a.contenido));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/hc/:id/adjuntos — cuerpo = el archivo (Content-Type image/jpeg,
// image/png o application/pdf; máx. 5 MB). Nombre en el encabezado
// X-Nombre-Archivo (codificado con encodeURIComponent).
router.post('/:id/adjuntos', verificarToken, verificarNivel(4), async (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TIPOS_ADJUNTO[mime]) return res.status(400).json({ error: 'Solo se aceptan fotos (JPG o PNG) o PDF' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
  if (buf.length > MAX_ADJUNTO) return res.status(400).json({ error: 'El archivo supera el máximo de 5 MB' });
  // El contenido debe coincidir con el tipo declarado (firma de los primeros bytes)
  const firmaOk = mime === 'application/pdf' ? buf.slice(0, 5).toString('latin1') === '%PDF-'
    : mime === 'image/png' ? buf.slice(0, 4).toString('hex') === '89504e47'
    : buf.slice(0, 3).toString('hex') === 'ffd8ff';
  if (!firmaOk) return res.status(400).json({ error: 'El archivo no es una imagen o un PDF válido' });
  let nombre = 'recibido';
  try { nombre = decodeURIComponent(String(req.headers['x-nombre-archivo'] || 'recibido')); } catch (e) {}
  nombre = nombre.replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'recibido';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hc = await client.query('SELECT id FROM historias_clinicas WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!hc.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Historia clínica no encontrada' }); }
    const r = await client.query(
      `INSERT INTO hc_adjuntos (hc_id, tipo, nombre, mime, tamano, contenido, subido_por, subido_por_nombre)
       VALUES ($1, 'recibido_ips', $2, $3, $4, $5, $6, $7) RETURNING id, tipo, nombre, mime, tamano, created_at`,
      [req.params.id, nombre, mime, buf.length, buf, req.usuario.id, req.usuario.nombre]
    );
    await _registrarCambio(client, req.params.id, req.usuario, 'adjunto', null,
      [{ campo: 'adjuntos', antes: null, despues: `${nombre} (${Math.round(buf.length / 1024)} KB)` }]);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/hc/:id/entrega — { fecha, hora, institucion, servicio,
// servicio_otro, recibe_nombre, recibe_cargo, adjunto_id? }. Solo para HC con
// traslado asistencial. El recibido de la IPS (adjunto ya subido) es opcional.
// Cierra la HC.
router.post('/:id/entrega', verificarToken, verificarNivel(4), async (req, res) => {
  const errores = [];
  const entrega = normalizarEntrega(req.body, errores);
  const traeAdjunto = req.body && req.body.adjunto_id !== undefined && req.body.adjunto_id !== null && req.body.adjunto_id !== '';
  const adjuntoId = traeAdjunto ? idValido(req.body.adjunto_id) : null;
  if (traeAdjunto && !adjuntoId) errores.push('El recibido adjunto no es válido');
  if (errores.length) return res.status(400).json({ error: errores[0], errores });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id, estado, datos FROM historias_clinicas WHERE id = $1 FOR UPDATE', [req.params.id]);
    const hc = r.rows[0];
    if (!hc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Historia clínica no encontrada' }); }
    if (!hc.datos.cierre || hc.datos.cierre.destino !== 'TRASLADO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta historia clínica no tiene traslado asistencial' });
    }
    if (hc.datos.entrega) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La entrega ya está registrada: corrígela con "Editar"' });
    }
    if (adjuntoId) {
      const adj = await client.query("SELECT id FROM hc_adjuntos WHERE id = $1 AND hc_id = $2 AND tipo = 'recibido_ips'", [adjuntoId, hc.id]);
      if (!adj.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El recibido no pertenece a esta historia clínica' }); }
    }
    const datos = { ...hc.datos, entrega: { ...entrega, adjunto_id: adjuntoId, registrada_por: req.usuario.nombre, registrada_at: new Date().toISOString() } };
    await client.query(
      `UPDATE historias_clinicas SET datos = $2, estado = 'cerrada', actualizada_at = NOW() WHERE id = $1`,
      [hc.id, JSON.stringify(datos)]
    );
    await _registrarCambio(client, hc.id, req.usuario, 'entrega', null,
      diferencias({ entrega: null, estado: hc.estado }, { entrega: datos.entrega, estado: 'cerrada' }));
    await client.query('COMMIT');
    res.json({ mensaje: 'Entrega registrada: la historia clínica quedó cerrada', estado: 'cerrada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/hc/:id/firma-medico — { firma } (PNG). Firma del médico que no
// alcanzó a firmar en la tablet; queda en el rastro quién la tomó y cuándo.
router.post('/:id/firma-medico', verificarToken, verificarNivel(4), async (req, res) => {
  const firma = req.body && req.body.firma;
  if (!firmaValida(firma)) return res.status(400).json({ error: 'La firma no es válida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT id, datos, firmas FROM historias_clinicas WHERE id = $1 FOR UPDATE', [req.params.id]);
    const hc = r.rows[0];
    if (!hc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Historia clínica no encontrada' }); }
    const resp = hc.datos.responsables || {};
    if (!resp.medico) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Esta historia clínica no tiene médico responsable' }); }
    if (!resp.medico_firma_pendiente) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La firma del médico ya está registrada' }); }
    const datos = { ...hc.datos, responsables: { ...resp, medico_firma_pendiente: false, medico_firma_tomada: { por: req.usuario.nombre, at: new Date().toISOString() } } };
    const firmas = { ...hc.firmas, medico: firma };
    await client.query(
      'UPDATE historias_clinicas SET datos = $2, firmas = $3, actualizada_at = NOW() WHERE id = $1',
      [hc.id, JSON.stringify(datos), JSON.stringify(firmas)]
    );
    await _registrarCambio(client, hc.id, req.usuario, 'firma_medico', null,
      [{ campo: 'firmas.medico', antes: 'pendiente', despues: `firmada por ${resp.medico.nombre}` }]);
    await client.query('COMMIT');
    res.json({ mensaje: 'Firma del médico registrada' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PUT /api/hc/:id — { datos, motivo }. El administrador corrige la HC: se
// vuelve a validar completa con las mismas reglas que al enviarla, se guarda
// y queda en el rastro cada campo cambiado (antes → después) con el motivo.
// No cambia: servicio, enfermero, decisión del consentimiento, médico ni
// firmas (la firma del médico se agrega con /firma-medico).
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const motivo = typeof (req.body && req.body.motivo) === 'string' ? req.body.motivo.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la corrección' });
  const editados = req.body && req.body.datos;
  if (!editados || typeof editados !== 'object') return res.status(400).json({ error: 'Faltan los datos de la historia clínica' });

  // Validaciones antes de tomar la conexión de la transacción
  let hc;
  try {
    const r = await pool.query('SELECT * FROM historias_clinicas WHERE id = $1', [req.params.id]);
    hc = r.rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
  if (!hc) return res.status(404).json({ error: 'Historia clínica no encontrada' });
  const antes = hc.datos;

  const entrada = aFormaDeEnvio({ ...editados, servicio: antes.servicio, enfermero: antes.enfermero, responsables: antes.responsables });
  entrada.consentimiento = { ...(entrada.consentimiento || {}), decision: antes.consentimiento && antes.consentimiento.decision };
  const enf = antes.enfermero || {};
  const responsables = {};
  (antes.procedimientos || []).forEach(p => { if (p.responsable) responsables[String(p.responsable.id)] = p.responsable; });
  if (antes.responsables && antes.responsables.medico) {
    const m = antes.responsables.medico;
    responsables[String(m.id)] = { id: m.id, nombre: m.nombre, rol: 'MÉDICO' };
  }
  responsables[String(enf.id)] = { id: enf.id, nombre: enf.nombre, rol: 'ENFERMERO/A' };
  const lugar = (antes.cierre && antes.cierre.traslado && antes.cierre.traslado.origen) ||
    [antes.servicio && antes.servicio.lugar, antes.servicio && antes.servicio.municipio].filter(Boolean).join(' — ');
  const { datos, errores } = normalizarHC({ datos: entrada, firmas: hc.firmas }, antes.servicio.fecha, {
    responsables,
    medicos: antes.responsables && antes.responsables.medico ? [antes.responsables.medico] : [],
    enfermero: enf,
    lugar
  });
  try {
    const movs = await pool.query(
      `SELECT m.client_id, m.sub_sku_id, m.cantidad, COALESCE(m.fecha_atencion, m.created_at) AS fecha,
              g.nombre, g.familia, s.lote, s.unidad, b.nombre AS bodega
       FROM movimientos m
       JOIN sub_skus s ON s.id = m.sub_sku_id
       JOIN skus_globales g ON g.id = s.sku_global_id
       LEFT JOIN bodegas b ON b.id = m.bodega_origen_id
       WHERE m.hc_client_id = $1 AND m.tipo = 'consumo' AND m.revertido = false
       ORDER BY m.id`,
      [hc.client_id]
    );
    const meds = normalizarMedicamentos(movs.rows, entrada.medicamentos, enf);
    datos.medicamentos = meds.lista;
    errores.push(...meds.errores);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
  // Lo que no se edita aquí se conserva
  datos.servicio = antes.servicio;
  datos.enfermero = antes.enfermero;
  datos.responsables = { ...datos.responsables, medico_firma_pendiente: !!(antes.responsables && antes.responsables.medico_firma_pendiente) };
  if (antes.responsables && antes.responsables.medico_firma_tomada) datos.responsables.medico_firma_tomada = antes.responsables.medico_firma_tomada;
  datos.entrega = null;
  if (antes.entrega) {
    const e = normalizarEntrega(editados.entrega, errores);
    datos.entrega = { ...e, adjunto_id: antes.entrega.adjunto_id, registrada_por: antes.entrega.registrada_por, registrada_at: antes.entrega.registrada_at };
  }
  if (errores.length) return res.status(400).json({ error: errores[0], errores });

  const cambios = diferencias(antes, datos);
  if (!cambios.length) return res.status(400).json({ error: 'No hay cambios para guardar' });
  // Si se quitó el traslado, la HC ya no espera entrega
  let estado = hc.estado;
  if (datos.cierre.destino === 'TRASLADO' && !datos.entrega) estado = 'abierta';
  else estado = 'cerrada';

  const p = datos.paciente;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE historias_clinicas SET datos = $2, estado = $3, paciente_tipo_doc = $4, paciente_documento = $5,
              paciente_nombre = $6, actualizada_at = NOW() WHERE id = $1`,
      [hc.id, JSON.stringify(datos), estado, p.tipo_doc || null, p.documento || null, `${p.nombres} ${p.apellidos}`.trim()]
    );
    // Los consumos de la HC siguen al documento corregido del paciente
    await client.query(
      "UPDATE movimientos SET cedula_paciente = $2 WHERE hc_client_id = $1 AND tipo = 'consumo'",
      [hc.client_id, p.documento || null]
    );
    if (estado !== hc.estado) cambios.push({ campo: 'estado', antes: hc.estado, despues: estado });
    await _registrarCambio(client, hc.id, req.usuario, 'edicion', motivo, cambios);
    await client.query('COMMIT');
    res.json({ mensaje: 'Historia clínica actualizada', cambios: cambios.length, estado });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
