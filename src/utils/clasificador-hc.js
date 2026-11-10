// Clasificación de cada historia clínica para el reporte (Excel):
// diagnóstico + categoría, procedimiento(s) estandarizado(s) y nivel de
// triage (I–V). La hace una IA (OpenAI) con los catálogos del cliente
// (src/data/hc-catalogos.js) y las definiciones de triage.
//
// - Se clasifica UNA vez por HC y el resultado queda guardado en
//   historias_clinicas.clasificacion (el Excel sale al instante y siempre
//   igual). Si la HC cambia (novedad o edición del admin) se vuelve a
//   clasificar.
// - Un trabajo en segundo plano toma las HC pendientes (también las
//   anteriores a esta función) de a una; varios procesos del hosting pueden
//   correrlo a la vez sin repetir trabajo (FOR UPDATE SKIP LOCKED).
// - A la IA solo se envía el texto clínico: motivo de consulta,
//   procedimientos y medicamentos/insumos. Nunca nombre ni documento.
// - Si la IA propone un diagnóstico o procedimiento que no está en el
//   catálogo, se agrega (origen 'ia') para que las siguientes HC usen el
//   mismo nombre.
//
// Configuración (variables de entorno):
//   OPENAI_API_KEY   clave de OpenAI (sin ella la clasificación queda pendiente)
//   OPENAI_MODEL     modelo (por defecto gpt-4o-mini)
//   CLASIFICADOR     'simulado' = sin IA, por palabras clave (laboratorio y pruebas
//                    automáticas; no gasta créditos)
const https = require('https');
const pool = require('../config/db');
const { DIAGNOSTICOS, PROCEDIMIENTOS, TRIAGE, clave } = require('../data/hc-catalogos');

const MAX_INTENTOS = 5;
const VERSION = 'v1';

// ── Catálogos en la base ──
async function cargarCatalogos(db) {
  db = db || pool;
  await db.query(
    `INSERT INTO hc_diagnosticos (nombre, clave, categoria)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (clave) DO NOTHING`,
    [DIAGNOSTICOS.map(d => d[0]), DIAGNOSTICOS.map(d => clave(d[0])), DIAGNOSTICOS.map(d => d[1])]);
  await db.query(
    `INSERT INTO hc_procedimientos_catalogo (nombre, clave)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (clave) DO NOTHING`,
    [PROCEDIMIENTOS, PROCEDIMIENTOS.map(clave)]);
}

async function _catalogos() {
  const d = await pool.query('SELECT nombre, clave, categoria FROM hc_diagnosticos ORDER BY nombre');
  const p = await pool.query('SELECT nombre, clave FROM hc_procedimientos_catalogo ORDER BY nombre');
  return { diagnosticos: d.rows, procedimientos: p.rows };
}

// Texto clínico de la HC que se envía a la IA (sin datos que identifiquen)
function entradaDeHC(datos) {
  const d = datos || {};
  return {
    motivo_consulta: (d.motivo && d.motivo.relato) || '',
    procedimientos_realizados: (d.procedimientos || []).map(p => p.descripcion).filter(Boolean),
    medicamentos_insumos: (d.medicamentos || []).map(m => [m.nombre, m.es_medicamento && m.via ? 'vía ' + m.via : ''].filter(Boolean).join(' ')),
    rechazo_atencion: !!(d.consentimiento && d.consentimiento.decision === 'rechaza')
  };
}

// ── Proveedor: OpenAI ──
function _promptSistema(cat) {
  return [
    'Eres un clasificador clínico de atenciones prehospitalarias en eventos masivos en Colombia.',
    'Con el texto de UNA atención responde SOLO un JSON con esta forma:',
    '{"diagnostico": "...", "categoria": "...", "procedimientos": ["..."], "triage": "I|II|III|IV|V"}',
    '',
    'Reglas:',
    '- diagnostico: elige el MÁS parecido de la tabla DIAGNÓSTICOS según el motivo de consulta. Usa el nombre exactamente como está en la tabla.',
    '  Si ninguno corresponde, crea un diagnóstico corto (2 a 5 palabras, español, primera letra en mayúscula) y asígnale una categoría (de las existentes si alguna sirve).',
    '- categoria: la de la tabla para ese diagnóstico (el diagnóstico define la categoría).',
    '- procedimientos: con base en los procedimientos realizados (y los medicamentos administrados) elige los más parecidos de la tabla PROCEDIMIENTOS, con el nombre exacto.',
    '  Si alguno no está, créalo en pocas palabras. Si no hubo procedimientos ni medicamentos, usa "Toma de signos vitales". Máximo 4.',
    '- triage: nivel según el motivo de consulta y las definiciones de TRIAGE (no copies el que haya puesto el enfermero).',
    '',
    'DIAGNÓSTICOS (diagnóstico | categoría):',
    cat.diagnosticos.map(d => `${d.nombre} | ${d.categoria}`).join('\n'),
    '',
    'PROCEDIMIENTOS:',
    cat.procedimientos.map(p => p.nombre).join('\n'),
    '',
    'TRIAGE:',
    TRIAGE.map(([n, t]) => `${n}: ${t}`).join('\n')
  ].join('\n');
}

function _openai(cuerpo) {
  return new Promise((resolve, reject) => {
    const datos = JSON.stringify(cuerpo);
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos), Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      timeout: 60000
    }, res => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300 && j) return resolve(j);
        reject(new Error(`OpenAI ${res.statusCode}: ${(j && j.error && j.error.message) || t.slice(0, 200)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('OpenAI: tiempo de espera agotado')));
    req.on('error', reject);
    req.write(datos);
    req.end();
  });
}

async function _clasificarOpenAI(entrada, cat) {
  const r = await _openai({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: _promptSistema(cat) },
      { role: 'user', content: JSON.stringify(entrada) }
    ]
  });
  const texto = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  let j;
  try { j = JSON.parse(texto); } catch (e) { throw new Error('La IA no respondió un JSON válido'); }
  return { ...j, modelo: r.model || process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

// ── Proveedor simulado (laboratorio): palabras clave sobre el catálogo ──
function _clasificarSimulado(entrada, cat) {
  const motivo = clave(entrada.motivo_consulta);
  // El diagnóstico del catálogo con más palabras presentes en el motivo
  let mejor = null, puntos = 0;
  cat.diagnosticos.forEach(d => {
    const palabras = d.clave.split(' ').filter(w => w.length > 2);
    const n = palabras.filter(w => motivo.indexOf(w) >= 0).length;
    if (n > puntos || (n === puntos && n && d.clave.length > mejor.clave.length)) { mejor = d; puntos = n; }
  });
  const diag = mejor || { nombre: 'Malestar general', categoria: 'Infecciones y cuadros generales' };
  const procs = [];
  const texto = clave(entrada.procedimientos_realizados.join(' '));
  cat.procedimientos.forEach(p => {
    const palabras = p.clave.split(' ').filter(w => w.length > 3);
    if (palabras.length && palabras.every(w => texto.indexOf(w) >= 0)) procs.push(p.nombre);
  });
  if (!procs.length) procs.push(entrada.medicamentos_insumos.length ? 'Toma de signos vitales + Medicamento' : 'Toma de signos vitales');
  const triage = /paro|inconsciente|hemorragia masiva|no respira/.test(motivo) ? 'I'
    : /dolor toracico|precordial|convuls/.test(motivo) ? 'II'
    : /fiebre|abdominal|fractura/.test(motivo) ? 'III'
    : /esguince|herida|contusion|trauma|caida/.test(motivo) ? 'IV' : 'V';
  return { diagnostico: diag.nombre, categoria: diag.categoria, procedimientos: procs.slice(0, 4), triage, modelo: 'simulado' };
}

function proveedor() {
  if (process.env.CLASIFICADOR === 'simulado') return 'simulado';
  return process.env.OPENAI_API_KEY ? 'openai' : null;
}

// Valida la respuesta, la ajusta al catálogo y agrega lo nuevo
async function _normalizar(r, cat) {
  const limpio = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  let diagnostico = limpio(r.diagnostico, 80), categoria = limpio(r.categoria, 60);
  if (!diagnostico) throw new Error('La IA no definió el diagnóstico');
  const enCatalogo = cat.diagnosticos.find(d => d.clave === clave(diagnostico));
  let nuevoDiag = false;
  if (enCatalogo) { diagnostico = enCatalogo.nombre; categoria = enCatalogo.categoria; }
  else {
    if (!categoria) categoria = 'Infecciones y cuadros generales';
    diagnostico = diagnostico.charAt(0).toUpperCase() + diagnostico.slice(1);
    await pool.query(`INSERT INTO hc_diagnosticos (nombre, clave, categoria, origen) VALUES ($1, $2, $3, 'ia') ON CONFLICT (clave) DO NOTHING`,
      [diagnostico, clave(diagnostico), categoria]);
    nuevoDiag = true;
  }
  const procedimientos = [];
  (Array.isArray(r.procedimientos) ? r.procedimientos : [r.procedimientos]).slice(0, 4).forEach(p => {
    let nombre = limpio(p, 100);
    if (!nombre) return;
    const ya = cat.procedimientos.find(x => x.clave === clave(nombre));
    if (ya) nombre = ya.nombre;
    else {
      nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
      pool.query(`INSERT INTO hc_procedimientos_catalogo (nombre, clave, origen) VALUES ($1, $2, 'ia') ON CONFLICT (clave) DO NOTHING`, [nombre, clave(nombre)])
        .catch(e => console.error('Catálogo de procedimientos:', e.message));
    }
    if (procedimientos.indexOf(nombre) < 0) procedimientos.push(nombre);
  });
  if (!procedimientos.length) procedimientos.push('Toma de signos vitales');
  const triage = ['I', 'II', 'III', 'IV', 'V'].indexOf(String(r.triage || '').toUpperCase().trim()) >= 0 ? String(r.triage).toUpperCase().trim() : null;
  if (!triage) throw new Error('La IA no definió un nivel de triage válido');
  return { diagnostico, categoria, procedimientos, triage, diagnostico_nuevo: nuevoDiag, modelo: r.modelo || null, version: VERSION };
}

async function clasificarDatos(datos) {
  const prov = proveedor();
  if (!prov) throw new Error('Sin proveedor de IA configurado (OPENAI_API_KEY)');
  const cat = await _catalogos();
  const entrada = entradaDeHC(datos);
  const r = prov === 'simulado' ? _clasificarSimulado(entrada, cat) : await _clasificarOpenAI(entrada, cat);
  return _normalizar(r, cat);
}

// ── Trabajo en segundo plano ──
// Toma una HC pendiente (sin clasificación o marcada para reclasificar) con
// un "turno" de 5 minutos para que otro proceso no la tome al mismo tiempo.
async function _tomarPendiente() {
  const r = await pool.query(
    `UPDATE historias_clinicas SET clasificacion_intentos = clasificacion_intentos + 1, clasificada_at = NOW()
     WHERE id = (
       SELECT id FROM historias_clinicas
       WHERE clasificacion IS NULL AND clasificacion_intentos < $1
         AND (clasificada_at IS NULL OR clasificada_at < NOW() - INTERVAL '5 minutes')
       ORDER BY id DESC LIMIT 1 FOR UPDATE SKIP LOCKED)   -- las más recientes primero; las anteriores se van clasificando después
     RETURNING id, datos`, [MAX_INTENTOS]);
  return r.rows[0] || null;
}

let _corriendo = false, _timer = null;
async function procesarPendientes(max) {
  if (_corriendo || !proveedor()) return 0;
  _corriendo = true;
  let n = 0;
  try {
    for (let i = 0; i < (max || 20); i++) {
      const hc = await _tomarPendiente();
      if (!hc) break;
      try {
        const c = await clasificarDatos(hc.datos);
        await pool.query('UPDATE historias_clinicas SET clasificacion = $2, clasificada_at = NOW(), clasificacion_error = NULL WHERE id = $1', [hc.id, JSON.stringify(c)]);
        n++;
      } catch (err) {
        console.error('Clasificación de HC', hc.id, err.message);
        await pool.query('UPDATE historias_clinicas SET clasificacion_error = $2 WHERE id = $1', [hc.id, err.message.slice(0, 300)]);
        if (/OpenAI (401|429)|tiempo de espera|ENOTFOUND|ECONN/.test(err.message)) break;   // no insistir si el proveedor falla
      }
    }
  } catch (err) {
    console.error('Clasificación de HC:', err.message);
  } finally {
    _corriendo = false;
  }
  return n;
}

// Marca una HC para (re)clasificar y la procesa en un momento
async function reclasificar(db, hcId) {
  await (db || pool).query('UPDATE historias_clinicas SET clasificacion = NULL, clasificacion_intentos = 0, clasificada_at = NULL, clasificacion_error = NULL WHERE id = $1', [hcId]);
  pronto();
}
function pronto() {
  if (!proveedor()) return;
  clearTimeout(_timer);
  _timer = setTimeout(() => { procesarPendientes(20).catch(() => {}); }, 1500);
}

// Al arrancar: cada minuto revisa si hay pendientes (HC anteriores, fallos)
function iniciar() {
  if (!proveedor()) { console.log('Clasificación de HC: sin OPENAI_API_KEY, queda pendiente'); return; }
  console.log(`Clasificación de HC activa (${proveedor()})`);
  pronto();
  setInterval(() => { procesarPendientes(20).catch(() => {}); }, 60000).unref();
}

module.exports = { cargarCatalogos, clasificarDatos, procesarPendientes, reclasificar, pronto, iniciar, entradaDeHC, proveedor };
