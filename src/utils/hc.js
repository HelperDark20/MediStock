// Historia clínica prehospitalaria: normaliza y valida lo que envía la tablet.
//
// La tablet manda un objeto `datos` con un bloque por módulo. Aquí solo se
// conservan los campos conocidos (lo demás se descarta), se recortan los
// textos, se pasan a MAYÚSCULAS los nombres y se completan los valores
// automáticos (edad, "NO REFIERE INFORMACIÓN"). Si falta algo obligatorio se
// devuelve la lista de errores en español para mostrarla tal cual.
//
// Las reglas son las mismas que valida la tablet (js/lite/hc-lite.js): si se
// cambia una, cambiar la otra. Especificación: docs/HC-especificacion.md

const { fechaValida } = require('./fechas');

const NO_REFIERE = 'NO REFIERE INFORMACIÓN';
const NO_APLICA = 'NO APLICA';   // EPS / ARL sin diligenciar
const TEXTO_CONSENTIMIENTO = 'Declaro que recibí información clara sobre mi condición de salud, procedimiento realizado, necesidad de traslado y posibles riesgos derivados de aceptar o rechazar la atención brindada.';

const TIPOS_DOC = ['CC', 'TI', 'CE', 'PAS', 'RC', 'PPT', 'OTRO'];
const TIPOS_DOC_ALFANUMERICOS = ['PAS', 'OTRO'];
const SEXOS = ['M', 'F', 'O'];
const RH = ['+', '-'];
const GRUPOS = ['A', 'B', 'AB', 'O'];
const ESTADOS_CIVILES = ['SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE'];
const DECISIONES = ['acepta', 'rechaza', 'urgencia_vital'];
const ANTECEDENTES = ['patologicos', 'quirurgicos', 'farmacologicos', 'alergicos', 'toxicos', 'traumaticos', 'hospitalarios', 'otros'];

const MAX_FIRMA = 400 * 1024;   // ~400 KB por firma (PNG en base64)

// Módulo 4 — valoración primaria ABCDE
const VIA_AEREA = ['ADECUADA', 'PERMEABLE', 'OBSTRUIDA', 'INSTRUMENTADA'];
const RESPIRACION = ['ADECUADA', 'DIFICULTAD', 'AUSENTE'];
const CIRCULACION = ['ADECUADA', 'COMPROMETIDA'];
const NEURO = ['ALERTA', 'SOMNOLIENTO', 'CONFUSO', 'INCONSCIENTE'];
const ORIENTACION = ['PERSONA', 'TIEMPO', 'ESPACIO'];
// Signos vitales: [campo, mínimo, máximo, obligatorio, nombre]. Fuera de
// [mínimo, máximo] el valor es imposible (error de digitación) y se rechaza.
const SIGNOS = [
  ['ta_sis', 40, 300, true, 'la tensión arterial sistólica'],
  ['ta_dia', 20, 200, true, 'la tensión arterial diastólica'],
  ['fc', 20, 300, true, 'la frecuencia cardiaca'],
  ['fr', 4, 80, true, 'la frecuencia respiratoria'],
  ['spo2', 30, 100, true, 'la saturación (SpO₂)'],
  ['temp', 25, 45, true, 'la temperatura'],
  ['gluco', 10, 1000, false, 'la glucometría'],
  ['eva', 0, 10, false, 'el dolor (EVA)']
];
// Módulo 5
const SEGMENTOS = ['cabeza', 'cara', 'cuello', 'torax', 'campos_pulmonares', 'abdomen', 'pelvis', 'espalda', 'eess', 'eeii', 'osteomuscular'];
const ESTADO_ADECUADO = 'ESTADO ADECUADO';
const TRIAGE = ['I', 'II', 'III', 'IV', 'V'];
// Procedimientos realizados: texto libre (el enfermero escribe con exactitud
// el procedimiento), con hora y responsable
const MAX_PROCEDIMIENTOS = 40;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Utilidades de normalización ──
function txt(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}
// Texto largo: conserva los saltos de línea. Todo el texto libre de la HC
// queda en MAYÚSCULAS.
function txtLargo(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max).toUpperCase();
}
function mayus(v, max) { return txt(v, max).toUpperCase(); }
function enumv(v, lista) { return lista.indexOf(v) >= 0 ? v : ''; }
function bool(v) { return v === true; }
function digitos(v) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : ''; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

// Nombres de persona: letras (con tildes y Ñ), espacios, punto, guion y apóstrofo
const RE_NOMBRE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*$/;

function firmaValida(v) {
  return typeof v === 'string' && v.length <= MAX_FIRMA && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v);
}

// Edad a la fecha de atención: años; en menores de 1 año, meses y días.
// fechaNac y fechaAtencion: 'YYYY-MM-DD'
function calcularEdad(fechaNac, fechaAtencion) {
  if (!fechaValida(fechaNac) || !fechaValida(fechaAtencion) || fechaNac > fechaAtencion) return null;
  const [y1, m1, d1] = fechaNac.split('-').map(Number);
  const [y2, m2, d2] = fechaAtencion.split('-').map(Number);
  let meses = (y2 - y1) * 12 + (m2 - m1);
  let dias = d2 - d1;
  if (dias < 0) {
    meses--;
    dias += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate();   // días del mes anterior
  }
  const anios = Math.floor(meses / 12);
  let texto;
  if (anios >= 1) texto = `${anios} ${anios === 1 ? 'AÑO' : 'AÑOS'}`;
  else if (meses >= 1) texto = `${meses} ${meses === 1 ? 'MES' : 'MESES'}${dias ? ` ${dias} ${dias === 1 ? 'DÍA' : 'DÍAS'}` : ''}`;
  else texto = `${dias} ${dias === 1 ? 'DÍA' : 'DÍAS'}`;
  return { anios, meses: anios >= 1 ? null : meses, dias: anios >= 1 ? null : dias, texto };
}

// ── Módulos ──
function _paciente(p, fechaAtencion, errores) {
  const nn = bool(p.nn);
  const out = {
    nn,
    nombres: mayus(p.nombres, 80),
    apellidos: mayus(p.apellidos, 80),
    tipo_doc: enumv(p.tipo_doc, TIPOS_DOC),
    documento: '',
    fecha_nacimiento: fechaValida(p.fecha_nacimiento) ? p.fecha_nacimiento : '',
    edad: null,
    sexo: enumv(p.sexo, SEXOS),
    rh: enumv(p.rh, RH),
    grupo: enumv(p.grupo, GRUPOS),
    direccion: mayus(p.direccion, 150),
    ciudad: mayus(p.ciudad, 80),
    telefono: digitos(p.telefono).slice(0, 15),
    estado_civil: enumv(p.estado_civil, ESTADOS_CIVILES),
    ocupacion: mayus(p.ocupacion, 80),
    eps: mayus(p.eps, 80) || NO_APLICA,
    arl: mayus(p.arl, 80) || NO_APLICA,
    otra_aseguradora: bool(p.otra_aseguradora),
    aseguradora: ''
  };
  out.documento = TIPOS_DOC_ALFANUMERICOS.indexOf(out.tipo_doc) >= 0
    ? mayus(p.documento, 20).replace(/[^A-Z0-9-]/g, '')
    : digitos(p.documento).slice(0, 15);
  if (out.otra_aseguradora) out.aseguradora = mayus(p.aseguradora, 80);

  if (nn) {
    // Paciente sin identificar: el admin completa los datos después
    if (!out.nombres) out.nombres = 'NN';
    if (!out.apellidos) out.apellidos = 'NN';
  } else {
    if (out.nombres.length < 2 || !RE_NOMBRE.test(out.nombres)) errores.push('Escribe los nombres del paciente (solo letras)');
    if (out.apellidos.length < 2 || !RE_NOMBRE.test(out.apellidos)) errores.push('Escribe los apellidos del paciente (solo letras)');
    if (!out.tipo_doc) errores.push('Selecciona el tipo de documento del paciente');
    else if (TIPOS_DOC_ALFANUMERICOS.indexOf(out.tipo_doc) >= 0) {
      if (out.documento.length < 3) errores.push('Escribe el número de documento del paciente');
    } else if (out.documento.length < 3) {
      errores.push('Escribe el número de documento del paciente (solo números)');
    }
    if (!out.fecha_nacimiento) errores.push('Indica la fecha de nacimiento del paciente');
    if (!out.sexo) errores.push('Selecciona el sexo del paciente');
  }
  if (out.fecha_nacimiento) {
    out.edad = calcularEdad(out.fecha_nacimiento, fechaAtencion);
    if (!out.edad) errores.push('La fecha de nacimiento no puede ser posterior a la fecha de atención');
  }
  if (out.telefono && out.telefono.length < 7) errores.push('El teléfono del paciente debe tener al menos 7 dígitos');
  if (out.otra_aseguradora && !out.aseguradora) errores.push('Escribe el nombre de la otra aseguradora');
  return out;
}

// Paciente con tarjeta de identidad (menor de edad): acompañante obligatorio
function _acompanante(a, tipoDoc, errores) {
  const out = { tiene: bool(a.tiene) || tipoDoc === 'TI', nombre: '', parentesco: '', telefono: '' };
  if (!out.tiene) return out;
  out.nombre = mayus(a.nombre, 120);
  out.parentesco = mayus(a.parentesco, 60);
  out.telefono = digitos(a.telefono).slice(0, 15);
  if (out.nombre.length < 3) errores.push('Escribe el nombre completo del acompañante');
  if (!out.parentesco) errores.push('Escribe el parentesco del acompañante');
  if (out.telefono.length < 7) errores.push('Escribe el teléfono del acompañante (al menos 7 dígitos)');
  return out;
}

function _motivo(m, errores) {
  const out = { relato: txtLargo(m.relato, 4000) };
  if (out.relato.length < 3) errores.push('Escribe el motivo de consulta y el relato del paciente');
  return out;
}

function _antecedentes(a, sexo, errores) {
  const out = { refiere: bool(a.refiere) };
  ANTECEDENTES.forEach(k => {
    const v = out.refiere ? txtLargo(a[k], 1000) : '';
    out[k] = v || NO_REFIERE;
  });
  // Gestación: no aplica en hombres; en mujeres y "otro", sí / no (+ semanas)
  if (sexo === 'M') {
    out.gestacion = 'no_aplica';
    out.semanas = null;
  } else {
    out.gestacion = a.gestacion === 'si' ? 'si' : 'no';
    out.semanas = null;
    if (out.gestacion === 'si') {
      const s = parseInt(digitos(a.semanas), 10);
      if (!(s >= 1 && s <= 45)) errores.push('Indica las semanas de gestación (1 a 45)');
      else out.semanas = s;
    }
  }
  return out;
}

function _consentimiento(c, firmas, errores) {
  const out = { decision: enumv(c.decision, DECISIONES), texto: TEXTO_CONSENTIMIENTO, motivo_rechazo: '', testigo: null };
  if (!out.decision) { errores.push('Registra la decisión del paciente sobre el consentimiento informado'); return out; }
  if (out.decision === 'rechaza') {
    out.motivo_rechazo = txtLargo(c.motivo_rechazo, 1000);
    if (out.motivo_rechazo.length < 3) errores.push('Escribe el motivo del rechazo');
    if (!firmaValida(firmas.paciente)) errores.push('Falta la firma del paciente o acudiente');
    const t = obj(c.testigo);
    out.testigo = {
      nombres: mayus(t.nombres, 80),
      apellidos: mayus(t.apellidos, 80),
      cedula: digitos(t.cedula).slice(0, 15),
      telefono: digitos(t.telefono).slice(0, 15)
    };
    if (out.testigo.nombres.length < 2) errores.push('Escribe el nombre del testigo');
    if (out.testigo.apellidos.length < 2) errores.push('Escribe el apellido del testigo');
    if (out.testigo.cedula.length < 5) errores.push('Escribe la cédula del testigo');
    if (out.testigo.telefono.length < 7) errores.push('Escribe el teléfono del testigo (al menos 7 dígitos)');
  }
  return out;
}

// Número: entero (o con un decimal si `decimal`), acepta coma decimal.
// Devuelve null si está vacío, NaN si no es un número.
function _numero(v, decimal) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().replace(',', '.');
  if (!(decimal ? /^\d{1,4}(\.\d)?$/ : /^\d{1,4}$/).test(s)) return NaN;
  return Number(s);
}

function _valoracion(v, errores) {
  const out = {
    via_aerea: enumv(v.via_aerea, VIA_AEREA),
    respiracion: enumv(v.respiracion, RESPIRACION),
    circulacion: enumv(v.circulacion, CIRCULACION),
    neuro: enumv(v.neuro, NEURO),
    orientado: Array.isArray(v.orientado) ? ORIENTACION.filter(o => v.orientado.indexOf(o) >= 0) : [],
    exposicion_si: bool(v.exposicion_si)
  };
  // Observaciones solo cuando A, B o C no es "Adecuada"
  [['via_aerea', 'A. Vía aérea'], ['respiracion', 'B. Respiración'], ['circulacion', 'C. Circulación']].forEach(([k, nombre]) => {
    if (!out[k]) errores.push(`Selecciona el estado de ${nombre}`);
    out[k + '_obs'] = out[k] && out[k] !== 'ADECUADA' ? txtLargo(v[k + '_obs'], 1000) : '';
  });
  if (!out.neuro) errores.push('Selecciona el estado neurológico (D)');
  out.exposicion = out.exposicion_si ? txtLargo(v.exposicion, 1000) : NO_REFIERE;
  if (out.exposicion_si && out.exposicion.length < 3) errores.push('Describe los hallazgos de la exposición (E)');
  return out;
}

function _signos(s, errores) {
  const out = { hora: RE_HORA.test(s.hora) ? s.hora : '' };
  if (!out.hora) errores.push('Escribe la hora de la toma de signos vitales (HH:MM)');
  SIGNOS.forEach(([k, min, max, req, nombre]) => {
    const n = _numero(s[k], k === 'temp');
    if (n === null) {
      out[k] = null;
      if (req) errores.push(`Registra ${nombre}`);
    } else if (isNaN(n) || n < min || n > max) {
      out[k] = null;
      errores.push(`El valor de ${nombre} no es válido (entre ${min} y ${max})`);
    } else {
      out[k] = n;
    }
  });
  if (out.ta_sis !== null && out.ta_dia !== null && out.ta_dia >= out.ta_sis) {
    errores.push('La tensión diastólica debe ser menor que la sistólica');
  }
  return out;
}

function _glasgow(g, errores) {
  const rango = (v, max) => { const n = parseInt(v, 10); return n >= 1 && n <= max ? n : null; };
  const out = { ocular: rango(g.ocular, 4), verbal: rango(g.verbal, 5), motora: rango(g.motora, 6), total: null };
  if (!out.ocular) errores.push('Selecciona la respuesta ocular (Glasgow)');
  if (!out.verbal) errores.push('Selecciona la respuesta verbal (Glasgow)');
  if (!out.motora) errores.push('Selecciona la respuesta motora (Glasgow)');
  if (out.ocular && out.verbal && out.motora) out.total = out.ocular + out.verbal + out.motora;
  return out;
}

function _examen(e) {
  const out = {};
  SEGMENTOS.forEach(k => { out[k] = txtLargo(e[k], 1000) || ESTADO_ADECUADO; });
  return out;
}

// responsables: personas válidas como responsable { id: { id, nombre, rol } }
function _procedimientos(lista, responsables, errores) {
  if (!Array.isArray(lista)) return [];
  if (lista.length > MAX_PROCEDIMIENTOS) errores.push(`Máximo ${MAX_PROCEDIMIENTOS} procedimientos`);
  return lista.slice(0, MAX_PROCEDIMIENTOS).map((p, i) => {
    p = obj(p);
    const n = i + 1;
    const out = {
      hora: RE_HORA.test(p.hora) ? p.hora : '',
      descripcion: txtLargo(p.descripcion, 500),
      responsable: null
    };
    if (!out.hora) errores.push(`Procedimiento ${n}: escribe la hora (HH:MM)`);
    if (out.descripcion.length < 3) errores.push(`Procedimiento ${n}: describe el procedimiento realizado`);
    const r = responsables[String(p.responsable_id)];
    if (r) out.responsable = { id: r.id, nombre: r.nombre, rol: r.rol };
    else errores.push(`Procedimiento ${n}: elige el responsable`);
    return out;
  });
}

// Módulo 7 — evolución, cierre, traslado y responsables
const CONDICIONES = ['ESTABLE', 'MEJORADO', 'SIN_CAMBIOS', 'DETERIORADO', 'FALLECIDO'];
const DESTINOS = ['ALTA_SITIO', 'ENTREGA_FAMILIAR', 'TRASLADO', 'REMISION_IPS', 'RECHAZO_TRASLADO', 'FALLECIDO_SITIO'];
const AMBULANCIAS = ['TAB', 'TAM', 'APH', 'NEONATAL'];

// lugarOrigen: lugar de atención (sale del evento, no de la tablet)
function _cierre(c, rechazo, lugarOrigen, errores) {
  const out = {
    evolucion: txtLargo(c.evolucion, 4000),
    condicion: enumv(c.condicion, CONDICIONES),
    // Con rechazo de la atención el destino es ese, sin elegir
    destino: rechazo ? 'RECHAZO_ATENCION' : enumv(c.destino, DESTINOS),
    traslado: null
  };
  if (out.evolucion.length < 3) errores.push('Escribe la evolución y descripción del servicio');
  if (!out.condicion) errores.push('Selecciona la condición clínica al finalizar la atención');
  if (!out.destino) errores.push('Selecciona el destino o disposición final del paciente');
  if (out.destino === 'TRASLADO') {
    const t = obj(c.traslado);
    out.traslado = {
      origen: lugarOrigen,
      destino: mayus(t.destino, 150),
      ambulancia: enumv(t.ambulancia, AMBULANCIAS),
      movil: mayus(t.movil, 30).replace(/[^A-Z0-9 -]/g, ''),
      placa: mayus(t.placa, 10).replace(/[^A-Z0-9-]/g, ''),
      conductor: mayus(t.conductor, 120),
      telefono: digitos(t.telefono).slice(0, 15)
    };
    if (out.traslado.destino.length < 3) errores.push('Traslado: escribe el destino (a dónde se remite el paciente)');
    if (!out.traslado.ambulancia) errores.push('Traslado: selecciona el tipo de ambulancia');
    if (!out.traslado.movil) errores.push('Traslado: escribe el número del móvil');
    if (out.traslado.placa.length < 5) errores.push('Traslado: escribe la placa de la ambulancia');
    if (out.traslado.conductor.length < 3) errores.push('Traslado: escribe el nombre del conductor');
    if (out.traslado.telefono.length < 7) errores.push('Traslado: escribe el teléfono (al menos 7 dígitos)');
  }
  return out;
}

// Responsables de la atención (16): el médico del evento (si tiene) y el
// enfermero que diligencia. La firma del enfermero es obligatoria; si el
// médico no alcanzó a firmar, queda "firma médica pendiente".
function _responsables(r, medicos, enfermero, firmasIn, errores) {
  const out = {
    medico: null, medico_firma_pendiente: false,
    enfermero: { id: enfermero.id, nombre: enfermero.nombre, cedula: enfermero.cedula },
    // Evento sin médico: la atención queda bajo la responsabilidad de quien diligencia
    responsable_principal: medicos.length ? 'medico' : 'enfermero'
  };
  if (medicos.length) {
    const m = medicos.find(x => String(x.id) === String(r.medico_id));
    if (!m) errores.push('Selecciona el médico responsable de la atención');
    else {
      out.medico = { id: m.id, nombre: m.nombre, cedula: m.cedula };
      out.medico_firma_pendiente = !firmaValida(firmasIn.medico);
    }
  }
  if (!firmaValida(firmasIn.enfermero)) errores.push('Falta tu firma como responsable de la atención');
  return out;
}

// Módulo 6 — medicamentos e insumos suministrados.
// La lista sale de los consumos REGISTRADOS en el inventario para esta HC
// (movimientos con su hc_client_id, sin anular): eso es lo que salió de la
// bodega. De la tablet se toman solo la dosis, la vía y la hora de cada uno.
//   movs: filas { client_id, sub_sku_id, cantidad, nombre, familia, lote,
//                 unidad, bodega, fecha }
//   enviados: datos.medicamentos de la tablet
//   enfermero: { id, nombre }
const VIAS = ['VO', 'IV', 'IM', 'SC', 'SL', 'TOPICA', 'INHALADA', 'OTRA'];
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;
function _horaCO(fecha) {
  const d = new Date(new Date(fecha).getTime() - COLOMBIA_OFFSET_MS);
  return d.toISOString().slice(11, 16);
}
// ¿La familia del SKU es de medicamentos? Es texto libre: "MED",
// "Medicamento", "MEDICAMENTOS", "Fármacos"… Lo demás es insumo (solo
// cantidad). Igual que esMedicamento() de js/lite/hc-lite.js
function esFamiliaMedicamento(familia) {
  const f = String(familia || '').trim().toUpperCase().replace(/Á/g, 'A');
  return f === 'MED' || f.startsWith('MEDICAMENT') || f.startsWith('FARMAC');
}

function normalizarMedicamentos(movs, enviados, enfermero) {
  const errores = [];
  const porId = {};
  (Array.isArray(enviados) ? enviados : []).forEach(e => { e = obj(e); if (typeof e.client_id === 'string') porId[e.client_id] = e; });
  const registrados = {};
  const lista = movs.map(m => {
    registrados[m.client_id] = true;
    const e = porId[m.client_id] || {};
    const esMed = esFamiliaMedicamento(m.familia);
    const out = {
      consumo_id: m.client_id,
      sub_sku_id: m.sub_sku_id,
      nombre: m.nombre,
      lote: m.lote || '',
      unidad: m.unidad || '',
      familia: m.familia || '',
      es_medicamento: esMed,
      bodega: m.bodega || '',
      cantidad: Number(m.cantidad),
      dosis: esMed ? mayus(e.dosis, 60) : '',
      via: esMed ? enumv(e.via, VIAS) : '',
      via_otra: '',
      hora: RE_HORA.test(e.hora) ? e.hora : _horaCO(m.fecha),
      responsable: { id: enfermero.id, nombre: enfermero.nombre }
    };
    if (esMed) {
      if (!out.dosis) errores.push(`${m.nombre}: escribe la dosis administrada`);
      if (!out.via) errores.push(`${m.nombre}: selecciona la vía de administración`);
      else if (out.via === 'OTRA') {
        out.via_otra = mayus(e.via_otra, 60);
        if (!out.via_otra) errores.push(`${m.nombre}: escribe cuál vía de administración`);
      }
    }
    return out;
  });
  // Consumos que la tablet tiene en la HC pero no llegaron al inventario
  // (pendientes de sincronizar, rechazados por stock o anulados)
  Object.keys(porId).forEach(id => {
    if (!registrados[id]) {
      errores.push(`El consumo de ${txt(porId[id].nombre, 120) || 'un producto'} no está registrado en el inventario: sincroniza los consumos pendientes o quítalo en el módulo 6`);
    }
  });
  return { lista, errores };
}

// Normaliza y valida la HC completa.
//   cuerpo: { datos, firmas } tal como los envía la tablet
//   fechaAtencion: 'YYYY-MM-DD' (hora de Colombia) del inicio de la atención
//   contexto: { responsables } — personas que pueden figurar como responsables
//             de un procedimiento (médicos del evento y el enfermero)
// Devuelve { datos, firmas, errores }
function normalizarHC(cuerpo, fechaAtencion, contexto) {
  const errores = [];
  const d = obj(cuerpo && cuerpo.datos);
  const firmasIn = obj(cuerpo && cuerpo.firmas);
  const responsables = (contexto && contexto.responsables) || {};

  const paciente = _paciente(obj(d.paciente), fechaAtencion, errores);
  const datos = {
    paciente,
    acompanante: _acompanante(obj(d.acompanante), paciente.tipo_doc, errores),
    motivo: _motivo(obj(d.motivo), errores),
    antecedentes: _antecedentes(obj(d.antecedentes), paciente.sexo, errores),
    consentimiento: _consentimiento(obj(d.consentimiento), firmasIn, errores)
  };
  // Si el paciente rechazó la atención, la HC pasa directo al cierre: no hay
  // valoración, examen, triage ni procedimientos
  if (datos.consentimiento.decision === 'rechaza') {
    datos.valoracion = null; datos.signos = null; datos.glasgow = null;
    datos.examen = null; datos.triage = null; datos.procedimientos = [];
  } else {
    datos.valoracion = _valoracion(obj(d.valoracion), errores);
    datos.signos = _signos(obj(d.signos), errores);
    datos.glasgow = _glasgow(obj(d.glasgow), errores);
    datos.examen = _examen(obj(d.examen));
    datos.triage = enumv(d.triage, TRIAGE);
    if (!datos.triage) errores.push('Selecciona la clasificación de triage');
    datos.procedimientos = _procedimientos(d.procedimientos, responsables, errores);
  }
  // Módulo 7: cierre y responsables
  const ctx = contexto || {};
  datos.cierre = _cierre(obj(d.cierre), datos.consentimiento.decision === 'rechaza', ctx.lugar || '', errores);
  datos.responsables = _responsables(obj(d.responsables), ctx.medicos || [], ctx.enfermero || {}, firmasIn, errores);
  // Entrega del paciente en la institución: la registra el administrador
  // después (solo cuando hubo traslado asistencial)
  datos.entrega = null;

  // Solo se guardan las firmas que corresponden a lo diligenciado
  const firmas = {};
  if (datos.consentimiento.decision === 'rechaza' && firmaValida(firmasIn.paciente)) firmas.paciente = firmasIn.paciente;
  if (datos.responsables.medico && firmaValida(firmasIn.medico)) firmas.medico = firmasIn.medico;
  if (firmaValida(firmasIn.enfermero)) firmas.enfermero = firmasIn.enfermero;
  return { datos, firmas, errores };
}

// ── Módulo admin ──
// Entrega del paciente en la institución (14): la registra el administrador
// cuando hubo traslado asistencial. Reemplaza la firma de quien recibe por la
// foto o PDF del recibido de la IPS (adjunto).
const SERVICIOS_RECEPTORES = ['URGENCIAS', 'OTRO'];
function normalizarEntrega(e, errores) {
  e = obj(e);
  const out = {
    fecha: fechaValida(e.fecha) ? e.fecha : '',
    hora: RE_HORA.test(e.hora) ? e.hora : '',
    institucion: mayus(e.institucion, 150),
    servicio: enumv(e.servicio, SERVICIOS_RECEPTORES),
    servicio_otro: '',
    recibe_nombre: mayus(e.recibe_nombre, 120),
    recibe_cargo: mayus(e.recibe_cargo, 80)
  };
  if (!out.fecha) errores.push('Entrega: indica la fecha');
  if (!out.hora) errores.push('Entrega: indica la hora (HH:MM)');
  if (out.institucion.length < 3) errores.push('Entrega: escribe la institución');
  if (!out.servicio) errores.push('Entrega: selecciona el servicio receptor');
  else if (out.servicio === 'OTRO') {
    out.servicio_otro = mayus(e.servicio_otro, 80);
    if (out.servicio_otro.length < 3) errores.push('Entrega: escribe cuál servicio receptor');
  }
  if (out.recibe_nombre.length < 3) errores.push('Entrega: escribe el nombre de quien recibe');
  if (out.recibe_cargo.length < 3) errores.push('Entrega: escribe el cargo de quien recibe');
  return out;
}

// Una HC guardada (datos ya normalizados) → la forma en que la envía la
// tablet, para volver a validarla completa cuando el administrador la edita
function aFormaDeEnvio(d) {
  const e = JSON.parse(JSON.stringify(d || {}));
  e.responsables = { medico_id: d.responsables && d.responsables.medico ? String(d.responsables.medico.id) : '' };
  e.procedimientos = (d.procedimientos || []).map(p => ({
    hora: p.hora, descripcion: p.descripcion, responsable_id: p.responsable ? String(p.responsable.id) : ''
  }));
  e.medicamentos = (d.medicamentos || []).map(m => ({
    client_id: m.consumo_id, nombre: m.nombre, dosis: m.dosis, via: m.via, via_otra: m.via_otra, hora: m.hora
  }));
  return e;
}

// Diferencias entre dos versiones de la HC, campo por campo (para el rastro
// de cambios). No compara lo automático (servicio, enfermero, edad).
const NO_COMPARAR = { servicio: true, enfermero: true, 'paciente.edad': true };
function _aplanar(v, ruta, out) {
  if (NO_COMPARAR[ruta]) return out;
  if (v && typeof v === 'object') {
    const claves = Object.keys(v);
    if (!claves.length) out[ruta] = Array.isArray(v) ? '[]' : '{}';
    claves.forEach(k => _aplanar(v[k], ruta ? `${ruta}.${k}` : k, out));
  } else {
    out[ruta] = v === undefined ? null : v;
  }
  return out;
}
function diferencias(antes, despues) {
  const a = _aplanar(antes, '', {}), b = _aplanar(despues, '', {});
  const rutas = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();
  return rutas
    .filter(r => JSON.stringify(a[r] === undefined ? null : a[r]) !== JSON.stringify(b[r] === undefined ? null : b[r]))
    .map(r => ({ campo: r, antes: a[r] === undefined ? null : a[r], despues: b[r] === undefined ? null : b[r] }));
}

// Estado con que queda la HC al recibirla: abierta si hubo traslado
// asistencial (falta registrar la entrega en la institución), si no cerrada
function estadoInicial(datos) {
  return datos.cierre && datos.cierre.destino === 'TRASLADO' ? 'abierta' : 'cerrada';
}

module.exports = {
  normalizarHC, normalizarMedicamentos, estadoInicial, calcularEdad, firmaValida, VIAS,
  normalizarEntrega, aFormaDeEnvio, diferencias, esFamiliaMedicamento, NO_APLICA,
  CONDICIONES, DESTINOS, AMBULANCIAS,
  NO_REFIERE, ESTADO_ADECUADO, TEXTO_CONSENTIMIENTO, TIPOS_DOC, SEGMENTOS
};
