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
const clasificador = require('../utils/clasificador-hc');
const {
  normalizarHC, normalizarMedicamentos, estadoInicial, normalizarEntrega, diferencias,
  firmaValida, TIPOS_DOC, responsableProcedimientos, MAX_TOMAS_EXTRA,
  signosNovedad, procedimientosNovedad, cierreNovedad, hcConfidencial
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

// Consumos registrados en el inventario para una HC (sin los anulados)
async function _consumosDeHC(db, clientId) {
  const r = await db.query(
    `SELECT m.client_id, m.sub_sku_id, m.cantidad, COALESCE(m.fecha_atencion, m.created_at) AS fecha,
            g.nombre, g.familia, s.lote, s.unidad, b.nombre AS bodega, m.bodega_origen_id AS bodega_id
     FROM movimientos m
     JOIN sub_skus s ON s.id = m.sub_sku_id
     JOIN skus_globales g ON g.id = s.sku_global_id
     LEFT JOIN bodegas b ON b.id = m.bodega_origen_id
     WHERE m.hc_client_id = $1 AND m.tipo = 'consumo' AND m.revertido = false
     ORDER BY m.id`,
    [clientId]
  );
  return r.rows;
}

// Medicamentos guardados en la HC → forma en que los manda la tablet
function _medsComoTablet(lista) {
  return (lista || []).map(m => ({ client_id: m.consumo_id, nombre: m.nombre, dosis: m.dosis, via: m.via, via_otra: m.via_otra, hora: m.hora }));
}

// Estado de la HC según el cierre: abierta mientras haya traslado sin entrega
function _estadoSegunCierre(datos) {
  return datos.cierre && datos.cierre.destino === 'TRASLADO' && !datos.entrega ? 'abierta' : 'cerrada';
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

    // Médico del evento (máximo uno): responsable de la atención, de los
    // procedimientos y de los medicamentos. Sin médico, quien diligencia.
    const medicos = await pool.query(
      `SELECT us.id, us.nombre, us.cedula FROM evento_usuarios eu
       JOIN usuarios us ON us.id = eu.usuario_id
       WHERE eu.evento_id = $1 AND us.nivel = 1`,
      [evento.id]
    );

    const fechaAtencion = _fechaCO(inicio);
    const lugar = [evento.ubicacion_nombre, evento.municipio_nombre].filter(Boolean).join(' — ');
    const { datos, firmas, errores } = normalizarHC(body, fechaAtencion, {
      medicos: medicos.rows,
      enfermero: { id: req.usuario.id, nombre: req.usuario.nombre, cedula: req.usuario.cedula },
      lugar
    });

    // Módulo 6: lo que salió del inventario para esta HC + dosis y vía
    const movs = await _consumosDeHC(pool, clientId);
    const meds = normalizarMedicamentos(movs, body.datos && body.datos.medicamentos,
      { id: req.usuario.id, nombre: req.usuario.nombre }, datos.responsables.medico);
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
    // Ubicación dentro del evento asignada al enfermero (para el reporte): se
    // guarda como estaba al atender, aunque después la cambien
    const ubic = await pool.query('SELECT ubicacion FROM evento_usuarios WHERE evento_id = $1 AND usuario_id = $2', [evento.id, req.usuario.id]);
    datos.servicio.ubicacion_asignada = (ubic.rows[0] && ubic.rows[0].ubicacion) || '';

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
      clasificador.pronto();   // clasificación para el reporte (en segundo plano)
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

// GET /api/hc/paciente?tipo_doc=CC&documento=123 — solo enfermero (nivel 2)
// asignado a un evento en curso (protección de datos de salud, Ley 1581).
// Identificación y antecedentes de la última atención del paciente, para
// precargarlos en una HC nueva. No incluye la atención en sí (motivo,
// valoración, etc.) ni firmas.
router.get('/paciente', verificarToken, verificarNivel(2), async (req, res) => {
  if (req.usuario.nivel !== 2) return res.status(403).json({ error: 'Solo el personal de enfermería en un evento consulta pacientes' });
  try {
    const ev = await pool.query(
      `SELECT 1 FROM evento_usuarios eu JOIN eventos e ON e.id = eu.evento_id
       WHERE eu.usuario_id = $1 AND e.estado = 'en_curso' AND e.activo = true LIMIT 1`, [req.usuario.id]);
    if (!ev.rows.length) return res.status(403).json({ error: 'Necesitas estar asignado a un evento en curso' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
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
// firma_pendiente), pagina (desde 1). El supervisor (nivel 3) solo busca por
// consecutivo y ve CONFIDENCIAL en el nombre y el documento.
router.get('/', verificarToken, verificarNivel(3), async (req, res) => {
  const supervisor = req.usuario.nivel === 3;
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
    cond.push(supervisor ? `h.consecutivo ILIKE ${p(like)}`
      : `(h.paciente_documento ILIKE ${p(like)} OR h.paciente_nombre ILIKE ${p(like)} OR h.consecutivo ILIKE ${p(like)})`);
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
    res.json({ total: total.rows[0].n, pagina, por_pagina: POR_PAGINA, filas: supervisor ? filas.rows.map(hcConfidencial) : filas.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ══════════════════════════════════════════
// REPORTE DE ATENCIONES (Excel) — una fila por historia clínica
// ══════════════════════════════════════════
const TXT_TIPO = { ARTISTA: 'Artista', DEPORTISTA: 'Deportista', DIRECTORES: 'Directores', ESPECTADOR: 'Espectador', LOGISTICA: 'Logística',
  POLICIA: 'Policía', AUTORIDAD_PMU: 'Autoridad PMU', PROVEEDOR: 'Proveedor', ADMINISTRACION: 'Administración', NOVA: 'Nova',
  PRODUCTOR: 'Productor', EXTERNO: 'Externo' };
const TXT_SEXO = { M: 'Masculino', F: 'Femenino', O: 'Otro' };

const { jornada: _jornada, edadReporte: _edadReporte, rangoEdad: _rangoEdad, hora12: _hora12 } = require('../utils/hc-reporte');
function _fechaDMA(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }

// GET /api/hc/reporte?evento_id&desde&hasta — filas del reporte (el Excel lo
// arma el navegador). Nombre e ID salen como CONFIDENCIAL.
router.get('/reporte', verificarToken, verificarNivel(3), async (req, res) => {
  const q = req.query, cond = [], params = [];
  const p = v => { params.push(v); return '$' + params.length; };
  if (q.evento_id) {
    const e = idValido(q.evento_id);
    if (!e) return res.status(400).json({ error: 'Evento inválido' });
    cond.push(`h.evento_id = ${p(e)}::int`);
  }
  if (q.desde) {
    if (!fechaValida(q.desde)) return res.status(400).json({ error: 'Fecha "desde" inválida' });
    cond.push(`h.inicio_atencion >= ${p(new Date(_inicioDiaCO(q.desde)).toISOString())}::timestamptz`);
  }
  if (q.hasta) {
    if (!fechaValida(q.hasta)) return res.status(400).json({ error: 'Fecha "hasta" inválida' });
    cond.push(`h.inicio_atencion < ${p(new Date(_inicioDiaCO(q.hasta) + 864e5).toISOString())}::timestamptz`);
  }
  try {
    const r = await pool.query(
      `SELECT h.id, h.consecutivo, h.inicio_atencion, h.datos, h.clasificacion,
              e.nombre AS evento_nombre, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin,
              e.hora_inicio, e.hora_fin, eu.ubicacion AS ubicacion_actual
       FROM historias_clinicas h
       LEFT JOIN eventos e ON e.id = h.evento_id
       LEFT JOIN evento_usuarios eu ON eu.evento_id = h.evento_id AND eu.usuario_id = h.usuario_id
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY h.inicio_atencion, h.id
       LIMIT 20000`, params);
    let pendientes = 0;
    const filas = r.rows.map(h => {
      const d = h.datos || {}, pac = d.paciente || {}, s = d.servicio || {}, c = h.clasificacion;
      if (!c) pendientes++;
      const fecha = _fechaCO(new Date(h.inicio_atencion));
      const horaSeg = new Date(new Date(h.inicio_atencion).getTime() - COLOMBIA_OFFSET_MS).toISOString().slice(11, 19);
      const hora = horaSeg.slice(0, 5);
      const edad = _edadReporte(pac.edad);
      return {
        consecutivo: h.consecutivo,
        evento: (s.evento && s.evento.nombre) || h.evento_nombre || '',
        fecha: _fechaDMA(fecha),
        // Horas en 12 h con segundos: 06:00:00 PM
        hora_inicial: _hora12(h.hora_inicio),
        hora_final: _hora12(h.hora_fin),
        hora_atencion: _hora12(horaSeg),
        jornada: _jornada(fecha, hora, h),
        ubicacion: s.ubicacion_asignada || h.ubicacion_actual || '',
        nombre: 'CONFIDENCIAL',
        id: 'CONFIDENCIAL',
        edad: edad.texto,
        rango_edad: _rangoEdad(edad.anios),
        ubicacion_paciente: pac.procedencia === 'INTERNO' ? 'Interno' : pac.procedencia === 'EXTERNO' ? 'Externo' : '',
        diagnostico: c ? c.diagnostico : 'Pendiente de clasificar',
        categoria: c ? c.categoria : '',
        procedimiento: c ? (c.procedimientos || []).join(' + ') : '',
        genero: TXT_SEXO[pac.sexo] || '',
        tipo: TXT_TIPO[pac.tipo_paciente] || '',
        traslado: d.cierre && d.cierre.destino === 'TRASLADO' ? 'SI' : 'NO',
        triage: c ? c.triage : ''
      };
    });
    res.json({ filas, pendientes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Catálogos de la clasificación (para que el admin corrija una HC)
router.get('/catalogos', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const d = await pool.query('SELECT nombre, categoria, origen FROM hc_diagnosticos ORDER BY nombre');
    const p = await pool.query('SELECT nombre, origen FROM hc_procedimientos_catalogo ORDER BY nombre');
    res.json({ diagnosticos: d.rows, procedimientos: p.rows, ia: clasificador.proveedor() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/hc/:id/clasificacion — { diagnostico, procedimientos: [], triage }
// El admin corrige la clasificación (queda marcada como corregida a mano)
router.put('/:id/clasificacion', verificarToken, verificarNivel(4), async (req, res) => {
  const b = req.body || {};
  const triage = ['I', 'II', 'III', 'IV', 'V'].indexOf(b.triage) >= 0 ? b.triage : null;
  const procs = Array.isArray(b.procedimientos) ? b.procedimientos.map(x => String(x || '').trim().slice(0, 100)).filter(Boolean).slice(0, 4) : [];
  if (!triage || !procs.length || !b.diagnostico) return res.status(400).json({ error: 'Elige el diagnóstico, al menos un procedimiento y el nivel de triage' });
  try {
    const d = await pool.query('SELECT nombre, categoria FROM hc_diagnosticos WHERE clave = $1', [require('../data/hc-catalogos').clave(b.diagnostico)]);
    if (!d.rows.length) return res.status(400).json({ error: 'Ese diagnóstico no está en el catálogo' });
    const r = await pool.query('SELECT clasificacion FROM historias_clinicas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    const antes = r.rows[0].clasificacion;
    const c = { diagnostico: d.rows[0].nombre, categoria: d.rows[0].categoria, procedimientos: procs, triage,
                corregida_por: req.usuario.nombre, corregida_at: new Date().toISOString(), modelo: antes && antes.modelo, version: antes && antes.version };
    // El triage corregido pasa a la HC y la IA ya no lo cambia
    await clasificador.guardarClasificacion(pool, req.params.id, c, ', triage_fijo = true');
    res.json({ mensaje: 'Clasificación corregida', clasificacion: c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/hc/:id/clasificacion/rehacer — volver a clasificar con la IA
router.post('/:id/clasificacion/rehacer', verificarToken, verificarNivel(4), async (req, res) => {
  if (!clasificador.proveedor()) return res.status(400).json({ error: 'La IA no está configurada (falta OPENAI_API_KEY)' });
  try {
    // La IA vuelve a definir también el triage (aunque se hubiera corregido)
    await pool.query('UPDATE historias_clinicas SET triage_fijo = false WHERE id = $1', [req.params.id]);
    await clasificador.reclasificar(pool, req.params.id);
    res.json({ mensaje: 'Se volverá a clasificar en unos segundos' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/hc/:id — HC completa, sus adjuntos (sin el contenido) y el rastro.
// El supervisor la ve sin los datos que identifican al paciente ni adjuntos.
router.get('/:id', verificarToken, verificarNivel(3), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM historias_clinicas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    const adj = await pool.query(
      `SELECT id, tipo, nombre, mime, tamano, subido_por_nombre, created_at
       FROM hc_adjuntos WHERE hc_id = $1 ORDER BY id`, [req.params.id]);
    const cambios = await pool.query(
      `SELECT id, usuario_nombre, accion, motivo, cambios, created_at
       FROM hc_cambios WHERE hc_id = $1 ORDER BY id DESC`, [req.params.id]);
    const hc = { ...r.rows[0], adjuntos: adj.rows, cambios: cambios.rows };
    delete hc.triage_enfermero;
    if (req.usuario.nivel === 3) return res.json({ ...hcConfidencial(hc), adjuntos: [] });
    res.json(hc);
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

// ══════════════════════════════════════════
// EDITAR HISTORIAS CLÍNICAS (página aparte del administrador, hc-editor.html)
// El editor es el mismo de la tablet (js/lite/hc-lite.js en modo admin):
// manda la HC completa en la forma de la tablet y aquí se vuelve a validar
// con las mismas reglas. Todo cambio queda en el rastro con el motivo.
// ══════════════════════════════════════════

// GET /api/hc/:id/editor — la HC + sus consumos registrados + los depósitos
// que tuvo asignados quien la diligenció en ese evento (para agregar
// medicamentos o insumos) + el médico del evento
router.get('/:id/editor', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT h.*, e.nombre AS evento_nombre_actual, e.estado AS evento_estado
       FROM historias_clinicas h LEFT JOIN eventos e ON e.id = h.evento_id WHERE h.id = $1`, [req.params.id]);
    const hc = r.rows[0];
    if (!hc) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    const consumos = await _consumosDeHC(pool, hc.client_id);
    // Depósitos asignados al enfermero en el evento + los que ya usó la HC
    const bod = await pool.query(
      `SELECT DISTINCT b.id, b.nombre FROM bodegas b
       WHERE b.id IN (SELECT bodega_id FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2)
          OR b.id = ANY($3::int[])
       ORDER BY b.nombre`,
      [hc.evento_id, hc.usuario_id, consumos.map(c => c.bodega_id).filter(Boolean)]);
    const cambios = await pool.query(
      'SELECT id, usuario_nombre, accion, motivo, cambios, created_at FROM hc_cambios WHERE hc_id = $1 ORDER BY id DESC', [hc.id]);
    delete hc.triage_enfermero;
    res.json({ ...hc, consumos, bodegas: bod.rows, cambios: cambios.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Valida una HC editada (forma de la tablet) contra la guardada.
// Devuelve { datos, errores }. Lo que no se edita se conserva: servicio,
// enfermero, decisión del consentimiento, médico y firmas.
async function _normalizarEdicion(hc, entrada, db) {
  const antes = hc.datos;
  entrada = { ...(entrada || {}) };
  entrada.consentimiento = { ...(entrada.consentimiento || {}), decision: antes.consentimiento && antes.consentimiento.decision };
  const enf = antes.enfermero || {};
  const lugar = (antes.cierre && antes.cierre.traslado && antes.cierre.traslado.origen) ||
    [antes.servicio && antes.servicio.lugar, antes.servicio && antes.servicio.municipio].filter(Boolean).join(' — ');
  const medico = antes.responsables && antes.responsables.medico;
  const { datos, errores } = normalizarHC({ datos: entrada, firmas: hc.firmas }, antes.servicio.fecha, {
    medicos: medico ? [medico] : [],
    enfermero: enf,
    lugar
  });
  const movs = await _consumosDeHC(db, hc.client_id);
  const meds = normalizarMedicamentos(movs, entrada.medicamentos, enf, datos.responsables.medico);
  datos.medicamentos = meds.lista;
  errores.push(...meds.errores);
  datos.servicio = antes.servicio;
  datos.enfermero = antes.enfermero;
  // La firma del enfermero ya está en la HC: no se vuelve a pedir
  for (let i = errores.length - 1; i >= 0; i--) if (/Falta tu firma/.test(errores[i])) errores.splice(i, 1);
  datos.responsables = { ...datos.responsables, medico_firma_pendiente: !!(antes.responsables && antes.responsables.medico_firma_pendiente) };
  if (antes.responsables && antes.responsables.medico_firma_tomada) datos.responsables.medico_firma_tomada = antes.responsables.medico_firma_tomada;
  datos.entrega = null;
  if (antes.entrega) {
    const e = normalizarEntrega(entrada.entrega || antes.entrega, errores);
    datos.entrega = { ...e, adjunto_id: antes.entrega.adjunto_id, registrada_por: antes.entrega.registrada_por, registrada_at: antes.entrega.registrada_at };
  }
  return { datos, errores };
}

// Guarda la HC con su rastro (transacción). Falla con 409 si cambió mientras
// tanto (entrega, firma, novedad u otra corrección).
async function _guardarConRastro(hc, datos, usuario, accion, motivo, extraCambios) {
  const cambios = diferencias(hc.datos, datos).concat(extraCambios || []);
  if (!cambios.length) return { sinCambios: true };
  const estado = _estadoSegunCierre(datos);
  const p = datos.paciente;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vigente = await client.query(
      'SELECT 1 FROM historias_clinicas WHERE id = $1 AND estado = $2 AND datos = $3::jsonb FOR UPDATE',
      [hc.id, hc.estado, JSON.stringify(hc.datos)]);
    if (!vigente.rows.length) { await client.query('ROLLBACK'); return { conflicto: true }; }
    await client.query(
      `UPDATE historias_clinicas SET datos = $2, estado = $3, paciente_tipo_doc = $4, paciente_documento = $5,
              paciente_nombre = $6, actualizada_at = NOW() WHERE id = $1`,
      [hc.id, JSON.stringify(datos), estado, p.tipo_doc || null, p.documento || null, `${p.nombres} ${p.apellidos}`.trim()]);
    // Los consumos de la HC siguen al documento corregido del paciente
    await client.query("UPDATE movimientos SET cedula_paciente = $2 WHERE hc_client_id = $1 AND tipo = 'consumo'", [hc.client_id, p.documento || null]);
    if (estado !== hc.estado) cambios.push({ campo: 'estado', antes: hc.estado, despues: estado });
    await _registrarCambio(client, hc.id, usuario, accion, motivo, cambios);
    await client.query('COMMIT');
    return { cambios: cambios.length, estado };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// PUT /api/hc/:id — { datos (forma de la tablet), motivo }. El administrador
// corrige cualquier campo; se vuelve a validar completa y queda en el rastro.
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const motivo = typeof (req.body && req.body.motivo) === 'string' ? req.body.motivo.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (motivo.length < 5) return res.status(400).json({ error: 'Escribe el motivo de la corrección' });
  const editados = req.body && req.body.datos;
  if (!editados || typeof editados !== 'object') return res.status(400).json({ error: 'Faltan los datos de la historia clínica' });
  try {
    const r = await pool.query('SELECT * FROM historias_clinicas WHERE id = $1', [req.params.id]);
    const hc = r.rows[0];
    if (!hc) return res.status(404).json({ error: 'Historia clínica no encontrada' });
    const { datos, errores } = await _normalizarEdicion(hc, editados, pool);
    if (errores.length) return res.status(400).json({ error: errores[0], errores });
    const g = await _guardarConRastro(hc, datos, req.usuario, 'edicion', motivo);
    if (g.sinCambios) return res.status(400).json({ error: 'No hay cambios para guardar' });
    if (g.conflicto) return res.status(409).json({ error: 'La historia clínica cambió mientras la editabas (entrega, firma, novedad u otra corrección). Vuelve a abrirla y repite el cambio.' });
    // Si el administrador cambió el triage, queda el suyo (la IA no lo cambia)
    if (datos.triage !== hc.datos.triage) await pool.query('UPDATE historias_clinicas SET triage_fijo = true WHERE id = $1', [hc.id]);
    clasificador.reclasificar(pool, hc.id).catch(e => console.error('Reclasificar HC', e.message));
    res.json({ mensaje: 'Historia clínica actualizada', cambios: g.cambios, estado: g.estado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/hc/:id/consumos — el administrador agrega un medicamento o
// insumo administrado: descuenta del depósito (de los asignados a quien
// diligenció la HC en ese evento) y queda en la HC con dosis, vía y hora.
// body: { client_id, sub_sku_id, bodega_origen_id, cantidad, dosis, via, via_otra, hora }
router.post('/:id/consumos', verificarToken, verificarNivel(4), async (req, res) => {
  const b = req.body || {};
  const clientId = _clientIdValido(b.client_id);
  const subSku = idValido(b.sub_sku_id), bodega = idValido(b.bodega_origen_id);
  const cantidad = Number(b.cantidad);
  if (!clientId || !subSku || !bodega || !Number.isInteger(cantidad) || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan datos del consumo o la cantidad no es un entero positivo' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM historias_clinicas WHERE id = $1 FOR UPDATE', [req.params.id]);
    const hc = r.rows[0];
    if (!hc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Historia clínica no encontrada' }); }
    if (hc.datos.consentimiento && hc.datos.consentimiento.decision === 'rechaza') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'El paciente rechazó la atención: la historia clínica no lleva medicamentos' });
    }
    const ya = await client.query('SELECT 1 FROM movimientos WHERE client_id = $1', [clientId]);
    if (ya.rows.length) { await client.query('ROLLBACK'); return res.json({ mensaje: 'Este consumo ya estaba registrado', duplicado: true }); }
    const asignado = await client.query(
      `SELECT 1 FROM evento_usuario_bodegas WHERE evento_id = $1 AND usuario_id = $2 AND bodega_id = $3
       UNION SELECT 1 FROM movimientos WHERE hc_client_id = $4 AND bodega_origen_id = $3 AND tipo = 'consumo'`,
      [hc.evento_id, hc.usuario_id, bodega, hc.client_id]);
    if (!asignado.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Ese depósito no estaba asignado a quien diligenció la historia clínica en ese evento' }); }
    const desc = await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3 AND cantidad >= $1 RETURNING cantidad',
      [cantidad, subSku, bodega]);
    if (!desc.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Stock insuficiente en el depósito' }); }
    await client.query(
      `INSERT INTO movimientos (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, cedula_paciente,
                                client_id, es_offline, fecha_atencion, hc_client_id)
       VALUES ($1, 'consumo', $2, $3, $4, $5, $6, $7, false, NOW(), $8)`,
      [subSku, bodega, cantidad, req.usuario.id, req.usuario.nombre, hc.datos.paciente && hc.datos.paciente.documento || null, clientId, hc.client_id]);
    // La HC queda con el consumo (dosis, vía y hora) de una vez
    const movs = await _consumosDeHC(client, hc.client_id);
    const enviados = _medsComoTablet(hc.datos.medicamentos).concat([{ client_id: clientId, dosis: b.dosis, via: b.via, via_otra: b.via_otra, hora: b.hora }]);
    const meds = normalizarMedicamentos(movs, enviados, hc.datos.enfermero || {}, hc.datos.responsables && hc.datos.responsables.medico);
    const nuevo = meds.lista.find(m => m.consumo_id === clientId);
    const errNuevo = meds.errores.filter(e => nuevo && e.indexOf(nuevo.nombre) === 0);
    if (errNuevo.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: errNuevo[0], errores: errNuevo }); }
    // Los demás conservan lo que ya tenían; el nuevo entra con sus datos
    const lista = (hc.datos.medicamentos || []).filter(m => movs.some(x => x.client_id === m.consumo_id)).concat([nuevo]);
    const datos = { ...hc.datos, medicamentos: lista };
    await client.query('UPDATE historias_clinicas SET datos = $2, actualizada_at = NOW() WHERE id = $1', [hc.id, JSON.stringify(datos)]);
    await _registrarCambio(client, hc.id, req.usuario, 'consumo', 'Medicamento o insumo agregado desde "Editar historias clínicas"',
      [{ campo: 'medicamentos', antes: null, despues: [nuevo.nombre, `${nuevo.cantidad} ${(nuevo.unidad || '').toLowerCase()}`.trim(), nuevo.dosis, nuevo.via].filter(Boolean).join(' · ') }]);
    await client.query('COMMIT');
    clasificador.reclasificar(pool, hc.id).catch(e => console.error('Reclasificar HC', e.message));
    res.status(201).json({ mensaje: 'Consumo registrado en la historia clínica', medicamento: nuevo });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.json({ mensaje: 'Este consumo ya estaba registrado', duplicado: true });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/hc/:id/consumos/anular — { client_id }. El administrador quita un
// medicamento o insumo de la HC: el stock vuelve al depósito (reversión).
router.post('/:id/consumos/anular', verificarToken, verificarNivel(4), async (req, res) => {
  const clientId = _clientIdValido(req.body && req.body.client_id);
  if (!clientId) return res.status(400).json({ error: 'Identificador de consumo inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM historias_clinicas WHERE id = $1 FOR UPDATE', [req.params.id]);
    const hc = r.rows[0];
    if (!hc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Historia clínica no encontrada' }); }
    const m = await client.query("SELECT * FROM movimientos WHERE client_id = $1 AND hc_client_id = $2 AND tipo = 'consumo' FOR UPDATE", [clientId, hc.client_id]);
    const mov = m.rows[0];
    if (!mov) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ese consumo no pertenece a esta historia clínica' }); }
    if (!mov.revertido) {
      await client.query(
        `INSERT INTO stock (sub_sku_id, bodega_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (sub_sku_id, bodega_id) DO UPDATE SET cantidad = stock.cantidad + $3`,
        [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad]);
      await client.query('UPDATE movimientos SET revertido = true, revertido_at = NOW(), revertido_por = $1 WHERE id = $2', [req.usuario.id, mov.id]);
      await client.query(
        `INSERT INTO movimientos (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, movimiento_original_id)
         VALUES ($1, 'reversion', $2, $3, $4, $5, $6)`,
        [mov.sub_sku_id, mov.bodega_origen_id, mov.cantidad, req.usuario.id, req.usuario.nombre, mov.id]);
    }
    const quitado = (hc.datos.medicamentos || []).find(x => x.consumo_id === clientId);
    const datos = { ...hc.datos, medicamentos: (hc.datos.medicamentos || []).filter(x => x.consumo_id !== clientId) };
    await client.query('UPDATE historias_clinicas SET datos = $2, actualizada_at = NOW() WHERE id = $1', [hc.id, JSON.stringify(datos)]);
    await _registrarCambio(client, hc.id, req.usuario, 'consumo', 'Medicamento o insumo quitado desde "Editar historias clínicas" (el stock volvió al depósito)',
      [{ campo: 'medicamentos', antes: quitado ? `${quitado.cantidad} ${quitado.unidad || ''} ${quitado.nombre}`.replace(/\s+/g, ' ') : clientId, despues: null }]);
    await client.query('COMMIT');
    clasificador.reclasificar(pool, hc.id).catch(e => console.error('Reclasificar HC', e.message));
    res.json({ mensaje: 'Consumo quitado: el stock volvió al depósito' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════
// NOVEDADES (tablet): el enfermero que diligenció la HC, mientras el evento
// no haya finalizado, agrega tomas de signos (hasta 3 en total),
// procedimientos y consumos, y puede rehacer la evolución y el cierre
// (traslado incluido). Se hace con o sin conexión; el client_id evita
// aplicarla dos veces. Queda en el rastro como "Novedad".
// body: { client_id, hc_client_id, creada_at, signos_tomas: [], procedimientos: [],
//         medicamentos: [{ client_id, dosis, via, via_otra, hora }], cierre: {...} | null }
// ══════════════════════════════════════════
router.post('/novedad', verificarToken, verificarNivel(2), async (req, res) => {
  const b = req.body || {};
  const clientId = _clientIdValido(b.client_id), hcClientId = _clientIdValido(b.hc_client_id);
  if (!clientId || !hcClientId) return res.status(400).json({ error: 'Identificador de la novedad inválido' });
  let creada = new Date(b.creada_at);
  if (isNaN(creada.getTime()) || creada.getTime() > Date.now() + TOLERANCIA_RELOJ_MS) creada = new Date();
  try {
    const ya = await pool.query('SELECT hc_id FROM hc_novedades WHERE client_id = $1', [clientId]);
    if (ya.rows.length) {
      const h = await pool.query('SELECT consecutivo, estado, datos FROM historias_clinicas WHERE id = $1', [ya.rows[0].hc_id]);
      return res.json({ duplicado: true, ...h.rows[0] });
    }
    const r = await pool.query(
      `SELECT h.*, e.estado AS evento_estado, e.finalizado_at FROM historias_clinicas h
       JOIN eventos e ON e.id = h.evento_id WHERE h.client_id = $1`, [hcClientId]);
    const hc = r.rows[0];
    if (!hc) return res.status(404).json({ error: 'La historia clínica no está en el servidor' });
    if (hc.usuario_id !== req.usuario.id) return res.status(403).json({ error: 'Solo quien diligenció la historia clínica puede agregarle novedades' });
    if (hc.evento_estado === 'finalizado' && creada.getTime() > new Date(hc.finalizado_at).getTime()) {
      return res.status(400).json({ error: 'El evento ya finalizó: pide al administrador que registre la novedad' });
    }
    const antes = hc.datos, rechazo = antes.consentimiento && antes.consentimiento.decision === 'rechaza';
    const tomas = Array.isArray(b.signos_tomas) ? b.signos_tomas : [];
    const procs = Array.isArray(b.procedimientos) ? b.procedimientos : [];
    const medsNuevos = Array.isArray(b.medicamentos) ? b.medicamentos : [];
    if (rechazo && (tomas.length || procs.length || medsNuevos.length)) {
      return res.status(400).json({ error: 'El paciente rechazó la atención: solo se puede actualizar la evolución y el cierre' });
    }
    const errores = [];
    const datos = JSON.parse(JSON.stringify(antes));
    // Signos: la toma de la atención + hasta 2 más
    const previas = datos.signos_tomas || [];
    if (previas.length + tomas.length > MAX_TOMAS_EXTRA) errores.push(`Máximo ${MAX_TOMAS_EXTRA + 1} tomas de signos vitales en total (ya tiene ${previas.length + 1})`);
    else datos.signos_tomas = previas.concat(tomas.map((t, i) => signosNovedad(t, errores, `Toma ${previas.length + i + 2} de signos: `)));
    // Procedimientos nuevos (responsable: el médico de la HC o quien diligencia)
    if (procs.length) {
      const nuevos = procedimientosNovedad(procs, responsableProcedimientos(datos.responsables), errores);
      datos.procedimientos = (datos.procedimientos || []).concat(nuevos);
    }
    // Medicamentos: los ya registrados + los de la novedad (con sus datos)
    const movs = await _consumosDeHC(pool, hcClientId);
    const meds = normalizarMedicamentos(movs, _medsComoTablet(antes.medicamentos).concat(medsNuevos),
      datos.enfermero || {}, datos.responsables && datos.responsables.medico);
    datos.medicamentos = meds.lista;
    errores.push(...meds.errores);
    // Evolución y cierre (completo, traslado incluido)
    if (b.cierre && typeof b.cierre === 'object') {
      const lugar = (antes.cierre && antes.cierre.traslado && antes.cierre.traslado.origen) ||
        [antes.servicio && antes.servicio.lugar, antes.servicio && antes.servicio.municipio].filter(Boolean).join(' — ');
      datos.cierre = cierreNovedad(b.cierre, rechazo, lugar, errores);
    }
    if (errores.length) return res.status(400).json({ error: errores[0], errores });

    const cambios = diferencias(antes, datos);
    const estado = _estadoSegunCierre(datos);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const vigente = await client.query('SELECT 1 FROM historias_clinicas WHERE id = $1 AND datos = $2::jsonb FOR UPDATE', [hc.id, JSON.stringify(antes)]);
      if (!vigente.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'La historia clínica cambió en el servidor: intenta de nuevo', reintentar: true }); }
      await client.query('INSERT INTO hc_novedades (client_id, hc_id, usuario_id, creada_at, contenido) VALUES ($1, $2, $3, $4, $5)',
        [clientId, hc.id, req.usuario.id, creada.toISOString(), JSON.stringify(b)]);
      if (cambios.length) {
        await client.query('UPDATE historias_clinicas SET datos = $2, estado = $3, actualizada_at = NOW() WHERE id = $1', [hc.id, JSON.stringify(datos), estado]);
        if (estado !== hc.estado) cambios.push({ campo: 'estado', antes: hc.estado, despues: estado });
        await _registrarCambio(client, hc.id, req.usuario, 'novedad', `Novedad registrada desde la tablet (${_fechaCO(creada)} ${new Date(creada.getTime() - COLOMBIA_OFFSET_MS).toISOString().slice(11, 16)})`, cambios);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.json({ duplicado: true, consecutivo: hc.consecutivo, estado: hc.estado, datos: hc.datos });
      throw err;
    } finally {
      client.release();
    }
    if (cambios.length) clasificador.reclasificar(pool, hc.id).catch(e => console.error('Reclasificar HC', e.message));
    res.status(201).json({ consecutivo: hc.consecutivo, estado, datos, cambios: cambios.length });
  } catch (err) {
    console.error('ERROR registrando novedad de HC', err.message);
    res.status(500).json({ error: 'Error del servidor. La novedad sigue guardada en la tablet: intenta de nuevo.' });
  }
});

module.exports = router;
