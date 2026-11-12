// ══════════════════════════════════════════
// ATENCIÓN DE PACIENTES FUGACES
// Pacientes que no quieren ir al punto de atención y se atienden donde están.
// No se les suministran medicamentos ni suturas: solo insumos de botiquines
// tipo 1 (depósitos "BTQ I-…") asignados al enfermero en el evento.
//
// El registro es corto: tipo y número de documento, nombre completo, motivo,
// procedimiento e insumos. Se guarda completo en una sola transacción (el
// registro y el descuento de inventario), con client_id para que reenviar
// sea seguro (sin conexión la tablet lo guarda y lo sube al sincronizar).
//
//   POST /api/fugaces              — nivel 2: registra una atención (en línea)
//   POST /api/fugaces/sincronizar  — nivel 2: sube las guardadas sin conexión
//   GET  /api/fugaces/mias         — nivel 2: las suyas en un evento
//   GET  /api/fugaces              — nivel 3+: consulta (supervisor: datos del
//                                    paciente CONFIDENCIAL)
// ══════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { idValido } = require('../utils/validar');
const { TIPOS_DOC, textoDeRelleno, documentoDeRelleno, esFamiliaMedicamento, CONFIDENCIAL } = require('../utils/hc');

const TIPOS_DOC_ALFANUMERICOS = ['PAS', 'OTRO'];
const RE_NOMBRE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*$/;
const MAX_INSUMOS = 30;
const MAX_SINCRONIZAR = 50;
const TOLERANCIA_RELOJ_MS = 10 * 60 * 1000;
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;

// Botiquín tipo 1: "BTQ I-01 CALLE SABOR", "BTQ I-02 AC"… (no BTQ II)
function esBotiquinTipo1(nombre) {
  return /^BTQ ?I-/.test(String(nombre || '').toUpperCase().replace(/\s+/g, ' ').trim());
}
// Sutura: por nombre o familia del producto
function esSutura(p) {
  return /SUTUR/.test(String((p && p.nombre) || '').toUpperCase()) || /SUTUR/.test(String((p && p.familia) || '').toUpperCase());
}

const txt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const mayus = (v, max) => txt(v, max).toUpperCase();
const largo = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max).toUpperCase();

function _clientIdValido(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return /^[A-Za-z0-9_-]{8,60}$/.test(s) ? s : null;
}

// Valida y normaliza lo que manda la tablet. Devuelve { datos, errores }
function normalizar(b) {
  const errores = [];
  const d = {
    tipo_doc: TIPOS_DOC.indexOf(String(b.tipo_doc || '').toUpperCase()) >= 0 ? String(b.tipo_doc).toUpperCase() : '',
    documento: '',
    nombre: mayus(b.nombre, 120),
    motivo: largo(b.motivo, 1000),
    procedimiento: largo(b.procedimiento, 1000)
  };
  d.documento = TIPOS_DOC_ALFANUMERICOS.indexOf(d.tipo_doc) >= 0
    ? mayus(b.documento, 20).replace(/[^A-Z0-9-]/g, '')
    : String(b.documento || '').replace(/\D/g, '').slice(0, 15);
  if (!d.tipo_doc) errores.push('Selecciona el tipo de documento del paciente');
  else if (d.documento.length < (TIPOS_DOC_ALFANUMERICOS.indexOf(d.tipo_doc) >= 0 ? 3 : 5)) errores.push('Escribe el número de documento del paciente');
  else if (documentoDeRelleno(d.documento)) errores.push('El número de documento del paciente no es válido (parece un dato de relleno)');
  if (d.nombre.length < 5 || d.nombre.indexOf(' ') < 0 || !RE_NOMBRE.test(d.nombre) || textoDeRelleno(d.nombre)) {
    errores.push('Escribe el nombre completo del paciente: nombres y apellidos, solo letras');
  }
  if (d.motivo.length < 3 || textoDeRelleno(d.motivo)) errores.push('Escribe el motivo de la atención');
  if (d.procedimiento.length < 3 || textoDeRelleno(d.procedimiento)) errores.push('Escribe el procedimiento realizado');

  const insumos = Array.isArray(b.insumos) ? b.insumos : [];
  if (insumos.length > MAX_INSUMOS) errores.push(`Máximo ${MAX_INSUMOS} insumos por atención`);
  d.insumos = [];
  insumos.slice(0, MAX_INSUMOS).forEach((x, i) => {
    const sub = idValido(x && x.sub_sku_id), bod = idValido(x && x.bodega_origen_id);
    const cant = Number(x && x.cantidad);
    if (!sub || !bod || !Number.isInteger(cant) || cant <= 0 || cant > 9999) {
      errores.push(`Insumo ${i + 1}: faltan datos o la cantidad no es válida`);
      return;
    }
    d.insumos.push({ sub_sku_id: sub, bodega_origen_id: bod, cantidad: cant });
  });
  return { datos: d, errores };
}

// Hora de la atención: la de la tablet (sin conexión), nunca en el futuro
function _fecha(v) {
  const f = v ? new Date(v) : null;
  return !f || isNaN(f.getTime()) || f.getTime() > Date.now() + TOLERANCIA_RELOJ_MS ? new Date() : f;
}

// El enfermero debe estar en el evento y éste en curso (sin conexión: si la
// atención fue antes de que se finalizara)
async function _eventoDelEnfermero(client, usuarioId, eventoId, fecha, offline) {
  const r = await client.query(
    `SELECT e.id, e.estado, e.finalizado_at FROM eventos e
     JOIN evento_usuarios eu ON eu.evento_id = e.id AND eu.usuario_id = $2
     WHERE e.id = $1 AND e.activo = true`, [eventoId, usuarioId]);
  if (!r.rows.length) return false;
  const e = r.rows[0];
  if (e.estado === 'en_curso') return true;
  return !!(offline && e.estado === 'finalizado' && e.finalizado_at &&
    fecha.getTime() <= new Date(e.finalizado_at).getTime() + TOLERANCIA_RELOJ_MS);
}

// Registra una atención con sus insumos en una transacción.
//   offline = false: si un insumo no se puede descontar, no se guarda nada
//   offline = true : la atención ya ocurrió; se guarda y el insumo que no
//                    se pudo descontar queda marcado (estado y motivo)
// Devuelve { estado: 'ok' | 'duplicado' | 'error', error, id }
async function registrar(usuario, body, offline) {
  const client_id = _clientIdValido(body && body.client_id);
  if (!client_id) return { estado: 'error', error: 'Identificador de la atención inválido' };
  const evento_id = idValido(body.evento_id);
  if (!evento_id) return { estado: 'error', error: 'Falta el evento de la atención' };
  const { datos, errores } = normalizar(body || {});
  if (errores.length) return { estado: 'error', error: errores.join('. ') };
  const fecha = offline ? _fecha(body.fecha_atencion) : new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ya = await client.query('SELECT id FROM atenciones_fugaces WHERE client_id = $1', [client_id]);
    if (ya.rows.length) { await client.query('ROLLBACK'); return { estado: 'duplicado', id: ya.rows[0].id }; }
    if (!await _eventoDelEnfermero(client, usuario.id, evento_id, fecha, offline)) {
      await client.query('ROLLBACK');
      return { estado: 'error', error: 'No estás asignado a ese evento o ya finalizó' };
    }
    const lista = [];
    for (let i = 0; i < datos.insumos.length; i++) {
      const x = datos.insumos[i];
      const info = await client.query(
        `SELECT b.nombre AS bodega, sg.nombre, sg.familia, COALESCE(ss.unidad, sg.unidad) AS unidad, ss.lote,
                EXISTS (SELECT 1 FROM evento_usuario_bodegas eub
                        WHERE eub.evento_id = $3 AND eub.usuario_id = $4 AND eub.bodega_id = b.id) AS asignada
         FROM sub_skus ss JOIN skus_globales sg ON sg.id = ss.sku_global_id, bodegas b
         WHERE ss.id = $1 AND b.id = $2 AND b.activo = true`,
        [x.sub_sku_id, x.bodega_origen_id, evento_id, usuario.id]);
      const p = info.rows[0];
      const item = { sub_sku_id: x.sub_sku_id, bodega_id: x.bodega_origen_id, cantidad: x.cantidad,
        nombre: p ? p.nombre : '', unidad: p ? p.unidad || '' : '', lote: p ? p.lote || '' : '', bodega: p ? p.bodega : '' };
      let problema = '';
      if (!p) problema = 'El producto o el botiquín no existe';
      else if (!esBotiquinTipo1(p.bodega)) problema = `${p.bodega} no es un botiquín tipo 1 (BTQ I)`;
      else if (!p.asignada) problema = `El botiquín ${p.bodega} no está asignado a ti en este evento`;
      else if (esFamiliaMedicamento(p.familia)) problema = `${p.nombre} es un medicamento: en una atención fugaz solo se usan insumos`;
      else if (esSutura(p)) problema = `${p.nombre} es una sutura: no se usa en una atención fugaz`;
      else {
        const desc = await client.query(
          `UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3 AND cantidad >= $1 RETURNING cantidad`,
          [x.cantidad, x.sub_sku_id, x.bodega_origen_id]);
        if (!desc.rows.length) problema = `Stock insuficiente de ${p.nombre} en ${p.bodega}`;
      }
      if (problema && !offline) { await client.query('ROLLBACK'); return { estado: 'error', error: problema }; }
      if (problema) { item.estado = 'no_descontado'; item.error = problema; }
      else {
        const mov = await client.query(
          `INSERT INTO movimientos
             (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, usuario_nombre, cedula_paciente,
              client_id, es_offline, fecha_atencion, sincronizado_at)
           VALUES ($1, 'consumo', $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 THEN NOW() END) RETURNING id`,
          [x.sub_sku_id, x.bodega_origen_id, x.cantidad, usuario.id, usuario.nombre, datos.documento,
           `${client_id}-${i + 1}`, !!offline, fecha.toISOString()]);
        item.estado = 'ok';
        item.movimiento_id = mov.rows[0].id;
      }
      lista.push(item);
    }
    const ins = await client.query(
      `INSERT INTO atenciones_fugaces
         (client_id, evento_id, usuario_id, usuario_nombre, tipo_doc, documento, nombre, motivo, procedimiento,
          insumos, fecha_atencion, es_offline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [client_id, evento_id, usuario.id, usuario.nombre, datos.tipo_doc, datos.documento, datos.nombre,
       datos.motivo, datos.procedimiento, JSON.stringify(lista), fecha.toISOString(), !!offline]);
    await client.query('COMMIT');
    const fallidos = lista.filter(x => x.estado !== 'ok');
    return { estado: 'ok', id: ins.rows[0].id, insumos_no_descontados: fallidos.map(x => x.error) };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return { estado: 'duplicado' };
    throw err;
  } finally {
    client.release();
  }
}

router.post('/', verificarToken, verificarNivel(2), async (req, res) => {
  if (req.usuario.nivel !== 2) return res.status(403).json({ error: 'Solo los enfermeros registran atenciones fugaces' });
  try {
    const r = await registrar(req.usuario, req.body || {}, false);
    if (r.estado === 'error') return res.status(400).json({ error: r.error });
    if (r.estado === 'duplicado') return res.json({ mensaje: 'Esta atención ya estaba registrada', duplicado: true, id: r.id });
    res.status(201).json({ mensaje: 'Atención fugaz registrada', id: r.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// body: { atenciones: [ ...igual que POST /, con fecha_atencion ] }
// Se responde una por una; es seguro repetir (client_id).
router.post('/sincronizar', verificarToken, verificarNivel(2), async (req, res) => {
  if (req.usuario.nivel !== 2) return res.status(403).json({ error: 'Solo los enfermeros registran atenciones fugaces' });
  const lista = req.body && req.body.atenciones;
  if (!Array.isArray(lista) || !lista.length) return res.status(400).json({ error: 'No hay atenciones para sincronizar' });
  if (lista.length > MAX_SINCRONIZAR) return res.status(400).json({ error: `Máximo ${MAX_SINCRONIZAR} atenciones por envío` });
  const resultados = [];
  for (const a of lista) {
    const client_id = a && a.client_id;
    try {
      const r = await registrar(req.usuario, a || {}, true);
      resultados.push({ client_id, estado: r.estado, error: r.error, insumos_no_descontados: r.insumos_no_descontados });
    } catch (err) {
      console.error('ERROR sincronizando atención fugaz', client_id, err.message);
      resultados.push({ client_id, estado: 'error', error: 'Error del servidor', reintentar: true });
    }
  }
  res.json({ resultados });
});

// Las del enfermero en un evento (lista de la tablet)
router.get('/mias', verificarToken, verificarNivel(2), async (req, res) => {
  const evento_id = idValido(req.query.evento_id);
  if (!evento_id) return res.status(400).json({ error: 'Evento inválido' });
  try {
    const r = await pool.query(
      `SELECT client_id, tipo_doc, documento, nombre, motivo, procedimiento, insumos, fecha_atencion
       FROM atenciones_fugaces WHERE evento_id = $1 AND usuario_id = $2 ORDER BY fecha_atencion DESC LIMIT 200`,
      [evento_id, req.usuario.id]);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

function _inicioDiaCO(f) { return new Date(f + 'T00:00:00Z').getTime() + COLOMBIA_OFFSET_MS; }

// Consulta (administrador y supervisor). Filtros: desde, hasta, evento_id, documento
router.get('/', verificarToken, verificarNivel(3), async (req, res) => {
  const q = req.query, cond = [], params = [];
  const p = v => { params.push(v); return '$' + params.length; };
  const fechaOk = f => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
  if (q.evento_id) {
    const e = idValido(q.evento_id);
    if (!e) return res.status(400).json({ error: 'Evento inválido' });
    cond.push(`f.evento_id = ${p(e)}::int`);
  }
  if (q.desde) {
    if (!fechaOk(q.desde)) return res.status(400).json({ error: 'Fecha "desde" inválida' });
    cond.push(`f.fecha_atencion >= ${p(new Date(_inicioDiaCO(q.desde)).toISOString())}::timestamptz`);
  }
  if (q.hasta) {
    if (!fechaOk(q.hasta)) return res.status(400).json({ error: 'Fecha "hasta" inválida' });
    cond.push(`f.fecha_atencion < ${p(new Date(_inicioDiaCO(q.hasta) + 864e5).toISOString())}::timestamptz`);
  }
  // Buscar por paciente: solo el administrador (el supervisor no ve esos datos)
  if (q.documento && req.usuario.nivel === 4) {
    const t = String(q.documento).trim().toUpperCase().slice(0, 60);
    cond.push(`(f.documento = ${p(t.replace(/[^A-Z0-9-]/g, ''))} OR f.nombre LIKE ${p('%' + t.replace(/[%_\\]/g, '') + '%')})`);
  }
  try {
    const r = await pool.query(
      `SELECT f.id, f.fecha_atencion, f.tipo_doc, f.documento, f.nombre, f.motivo, f.procedimiento, f.insumos,
              f.usuario_nombre, f.es_offline, e.nombre AS evento_nombre, eu.ubicacion
       FROM atenciones_fugaces f
       LEFT JOIN eventos e ON e.id = f.evento_id
       LEFT JOIN evento_usuarios eu ON eu.evento_id = f.evento_id AND eu.usuario_id = f.usuario_id
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY f.fecha_atencion DESC, f.id DESC
       LIMIT 5000`, params);
    const filas = req.usuario.nivel === 4 ? r.rows
      : r.rows.map(x => ({ ...x, nombre: CONFIDENCIAL, documento: CONFIDENCIAL }));
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.esBotiquinTipo1 = esBotiquinTipo1;
router.esSutura = esSutura;
module.exports = router;
