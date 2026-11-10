// ══════════════════════════════════════════
// HISTORIAS CLÍNICAS — módulo del administrador (nivel 4)
//
// Lista las HC que envían las tablets, con filtros; muestra cada una
// completa; registra la entrega del paciente (HC con traslado, que quedan
// abiertas hasta entonces) con la foto o PDF del recibido de la IPS; toma la
// firma del médico si quedó pendiente y genera la versión imprimible con la
// estructura del formato SIG_08NB_0030 (se guarda como PDF desde el diálogo
// de impresión del navegador). La corrección de datos se hace en la página
// aparte "Editar Historias Clínicas" (hc-editor.html), con rastro de cambios.
// API: /api/hc (src/routes/hc.js)
// ══════════════════════════════════════════

// ── Textos de los valores guardados ──
const HC_TXT = {
  tipo_doc: { CC:'CC', TI:'TI', CE:'CE', PAS:'Pasaporte', RC:'RC', PPT:'PPT', OTRO:'Otro' },
  sexo: { M:'Masculino', F:'Femenino', O:'Otro' },
  estado_civil: { SOLTERO:'Soltero/a', CASADO:'Casado/a', DIVORCIADO:'Divorciado/a', VIUDO:'Viudo/a', UNION_LIBRE:'Unión libre' },
  procedencia: { INTERNO:'Interno', EXTERNO:'Externo' },
  tipo_paciente: { ARTISTA:'Artista', DEPORTISTA:'Deportista', DIRECTORES:'Directores', ESPECTADOR:'Espectador', LOGISTICA:'Logística',
    POLICIA:'Policía', AUTORIDAD_PMU:'Autoridad PMU', PROVEEDOR:'Proveedor', ADMINISTRACION:'Administración', NOVA:'Nova',
    PRODUCTOR:'Productor', EXTERNO:'Externo' },
  decision: { acepta:'Acepta la atención', rechaza:'Rechaza la atención', urgencia_vital:'Urgencia vital: sin capacidad de consentir' },
  via_aerea: { ADECUADA:'Adecuada', PERMEABLE:'Permeable', OBSTRUIDA:'Obstruida', INSTRUMENTADA:'Instrumentada' },
  respiracion: { ADECUADA:'Adecuada', DIFICULTAD:'Dificultad respiratoria', AUSENTE:'Ausente' },
  circulacion: { ADECUADA:'Adecuada', COMPROMETIDA:'Comprometida' },
  neuro: { ALERTA:'Alerta', SOMNOLIENTO:'Somnoliento', CONFUSO:'Confuso', INCONSCIENTE:'Inconsciente' },
  orientado: { PERSONA:'Persona', TIEMPO:'Tiempo', ESPACIO:'Espacio' },
  ocular: { 4:'Espontánea', 3:'Al estímulo verbal', 2:'Al dolor', 1:'Ninguna' },
  verbal: { 5:'Orientado', 4:'Confuso', 3:'Palabras incoherentes', 2:'Sonidos', 1:'Ninguna' },
  motora: { 6:'Obedece órdenes', 5:'Localiza el dolor', 4:'Retira al dolor', 3:'Flexión', 2:'Extensión', 1:'Ninguna' },
  rh: { '+':'POSITIVO', '-':'NEGATIVO' },
  via: { VO:'Oral (VO)', IV:'Intravenosa (IV)', IM:'Intramuscular (IM)', SC:'Subcutánea (SC)', SL:'Sublingual (SL)', TOPICA:'Tópica', INHALADA:'Inhalada', OTRA:'Otra' },
  condicion: { ESTABLE:'Estable', MEJORADO:'Mejorado', SIN_CAMBIOS:'Sin cambios', DETERIORADO:'Deteriorado', FALLECIDO:'Fallecido' },
  destino: { ALTA_SITIO:'Alta en sitio', ENTREGA_FAMILIAR:'Entrega a familiar o acudiente', TRASLADO:'Traslado asistencial',
             REMISION_IPS:'Remisión a IPS', RECHAZO_TRASLADO:'Rechazo de traslado', FALLECIDO_SITIO:'Fallecido en el sitio',
             RECHAZO_ATENCION:'Rechazo de atención' },
  ambulancia: { TAB:'TAB', TAM:'TAM', APH:'APH', NEONATAL:'Neonatal' },
  servicio: { URGENCIAS:'Urgencias', OTRO:'Otro' },
  gestacion: { si:'Sí', no:'No', no_aplica:'No aplica' },
  accion: { edicion:'Edición', entrega:'Entrega del paciente', firma_medico:'Firma del médico', adjunto:'Archivo adjunto',
            novedad:'Novedad (enfermero)', consumo:'Medicamento / insumo (administrador)' }
};
const HC_ANTECEDENTES = [['patologicos','Patológicos'],['quirurgicos','Quirúrgicos'],['farmacologicos','Farmacológicos'],['alergicos','Alérgicos'],
  ['toxicos','Tóxicos'],['traumaticos','Traumáticos'],['hospitalarios','Hospitalarios'],['otros','Otros']];
const HC_SEGMENTOS = [['cabeza','Cabeza'],['cara','Cara'],['cuello','Cuello'],['torax','Tórax'],['campos_pulmonares','Campos pulmonares'],
  ['abdomen','Abdomen'],['pelvis','Pelvis'],['espalda','Espalda'],['eess','Extremidades superiores'],['eeii','Extremidades inferiores'],
  ['osteomuscular','Sistema osteomuscular']];

let _hcFiltros = {};
let _hcActual = null;     // HC abierta en el detalle

const _hcTz = { timeZone: 'America/Bogota' };
function hcFechaHora(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { ..._hcTz, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function hcFecha(iso){ return iso ? String(iso).slice(0,10).split('-').reverse().join('/') : '—'; }
function hcT(grupo, v){ return (HC_TXT[grupo] && HC_TXT[grupo][v]) || v || '—'; }
function hcV(v){ return v === null || v === undefined || v === '' ? '—' : escHtml(v); }

// ══════════════════════════════════════════
// LISTADO
// ══════════════════════════════════════════
function renderHistorias(){
  const selU = document.getElementById('hcf-ubicacion');
  const ubs = (S.ubicacionesHistoricas && S.ubicacionesHistoricas.length ? S.ubicacionesHistoricas : S.ubicaciones) || [];
  const uSel = selU.value;
  selU.innerHTML = '<option value="">Todas</option>' + ubs.map(u => `<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  selU.value = uSel;
  const selE = document.getElementById('hcf-evento');
  const eSel = selE.value;
  selE.innerHTML = '<option value="">Todos</option>' + (S.eventos || []).map(e => `<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('');
  selE.value = eSel;
  hcBuscar(1);
}

function hcLimpiarFiltros(){
  ['hcf-desde','hcf-hasta','hcf-ubicacion','hcf-evento','hcf-estado','hcf-documento'].forEach(id => { document.getElementById(id).value = ''; });
  hcBuscar(1);
}

async function hcBuscar(pagina){
  _hcFiltros = {
    desde: document.getElementById('hcf-desde').value,
    hasta: document.getElementById('hcf-hasta').value,
    ubicacion_id: document.getElementById('hcf-ubicacion').value,
    evento_id: document.getElementById('hcf-evento').value,
    estado: document.getElementById('hcf-estado').value,
    documento: document.getElementById('hcf-documento').value.trim(),
    pagina
  };
  const tbody = document.getElementById('hc-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="color:#aaa">Cargando…</td></tr>';
  try {
    const r = await HistoriasClinicas.listar(_hcFiltros);
    document.getElementById('hc-resumen').innerHTML =
      `<strong>${r.total}</strong>&nbsp;historia${r.total !== 1 ? 's' : ''} clínica${r.total !== 1 ? 's' : ''}`;
    tbody.innerHTML = r.filas.length ? r.filas.map(f => `
      <tr class="hc-fila" onclick="hcAbrir(${f.id})">
        <td><span class="sku-code">${escHtml(f.consecutivo)}</span></td>
        <td style="white-space:nowrap">${hcFechaHora(f.inicio_atencion)}</td>
        <td><strong>${escHtml(f.paciente_nombre || '—')}</strong><div class="hc-sub">${f.paciente_tipo_doc ? escHtml(f.paciente_tipo_doc + ' ' + (f.paciente_documento || '')) : 'Sin documento'}</div></td>
        <td>${escHtml(f.evento_nombre || '—')}<div class="hc-sub">${escHtml(f.lugar || '')}${f.municipio ? ' · ' + escHtml(f.municipio) : ''}</div></td>
        <td>${escHtml(f.enfermero_nombre || '—')}</td>
        <td>${hcBadges(f.estado, f.firma_medica_pendiente)}</td>
      </tr>`).join('')
      : '<tr><td colspan="6"><div class="empty-state" style="padding:24px"><i class="ti ti-clipboard-off"></i><p>No hay historias clínicas con esos filtros</p></div></td></tr>';
    const paginas = Math.ceil(r.total / r.por_pagina);
    document.getElementById('hc-paginas').innerHTML = paginas > 1
      ? `<button class="btn-cancel" ${pagina <= 1 ? 'disabled' : ''} onclick="hcBuscar(${pagina - 1})">‹ Anterior</button>
         <span>Página ${pagina} de ${paginas}</span>
         <button class="btn-cancel" ${pagina >= paginas ? 'disabled' : ''} onclick="hcBuscar(${pagina + 1})">Siguiente ›</button>` : '';
  } catch(err){
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red2)">${escHtml(err.message)}</td></tr>`;
  }
}

function hcBadges(estado, firmaPendiente){
  return `<span class="hc-badge ${estado}">${estado === 'abierta' ? 'Abierta · falta entrega' : 'Cerrada'}</span>` +
    (firmaPendiente ? '<span class="hc-badge pendiente">Firma médica pendiente</span>' : '');
}

// ══════════════════════════════════════════
// DETALLE (también es la base de la versión imprimible)
// ══════════════════════════════════════════
async function hcAbrir(id){
  try {
    _hcActual = await HistoriasClinicas.getOne(id);
    hcRenderDetalle();
    document.getElementById('modal-hc').classList.add('open');
  } catch(err){ toastError(err.message); }
}

async function hcRecargar(){
  if(!_hcActual) return;
  _hcActual = await HistoriasClinicas.getOne(_hcActual.id);
  hcRenderDetalle();
  hcBuscar(_hcFiltros.pagina || 1);
}

function hcRenderDetalle(){
  const h = _hcActual, d = h.datos, r = d.responsables || {};
  const traslado = d.cierre && d.cierre.destino === 'TRASLADO';
  const acciones = [
    traslado && !d.entrega ? `<button class="tb-btn primary" onclick="hcAbrirEntrega()"><i class="ti ti-building-hospital"></i>Registrar entrega</button>` : '',
    r.medico && r.medico_firma_pendiente ? `<button class="tb-btn" onclick="hcAbrirFirmaMedico()"><i class="ti ti-signature"></i>Firma del médico</button>` : '',
    `<button class="tb-btn" onclick="hcImprimir()"><i class="ti ti-printer"></i>Imprimir / PDF</button>`
  ].join('');
  document.getElementById('hc-detalle').innerHTML = `
    <div class="hc-cabecera">
      <div>
        <div class="modal-title" style="margin-bottom:4px">${escHtml(h.consecutivo)}</div>
        <div>${hcBadges(h.estado, r.medico_firma_pendiente)}</div>
        <div class="hc-sub" style="margin-top:6px">Recibida en el servidor el ${hcFechaHora(h.recibida_at)}${h.actualizada_at !== h.recibida_at ? ' · Última modificación ' + hcFechaHora(h.actualizada_at) : ''}</div>
      </div>
      <div class="hc-acciones">${acciones}</div>
    </div>
    ${hcHtml(h, false)}
    ${hcHtmlClasificacion(h)}
    ${hcHtmlAdjuntos(h)}
    ${hcHtmlCambios(h)}
    <div class="modal-actions"><button class="btn-cancel" onclick="closeModal('modal-hc')">Cerrar</button></div>`;
}

function hcSec(titulo, cuerpo){ return `<div class="hc-sec"><div class="hc-sec-t">${titulo}</div>${cuerpo}</div>`; }
function hcDato(et, v, ancho){ return `<div class="hc-dato${ancho ? ' ancho' : ''}"><span>${et}</span><b>${v}</b></div>`; }
function hcFirmaImg(src, quien, nota){
  return `<div class="hc-firma"><div class="hc-firma-caja">${src ? `<img src="${src}" alt="Firma">` : `<em>${nota || 'Sin firma'}</em>`}</div><div class="hc-firma-pie">${quien}</div></div>`;
}

// HTML de la HC completa, con la estructura del formato SIG_08NB_0030
function hcHtml(h, imprimir){
  const d = h.datos, s = d.servicio || {}, p = d.paciente || {}, a = d.acompanante || {}, an = d.antecedentes || {};
  const c = d.consentimiento || {}, v = d.valoracion, sg = d.signos, g = d.glasgow, ci = d.cierre || {}, r = d.responsables || {};
  const rechazo = c.decision === 'rechaza';
  let html = '';
  html += hcSec('Identificación del servicio',
    hcDato('Consecutivo HC', escHtml(h.consecutivo)) + hcDato('Fecha', hcFecha(s.fecha)) +
    hcDato('Hora de inicio de la atención', hcFechaHora(h.inicio_atencion).split(' ').slice(1).join(' ') || '—') +
    hcDato('Lugar de atención', hcV(s.lugar)) + hcDato('Municipio', hcV(s.municipio) + (s.departamento ? ' · ' + escHtml(s.departamento) : '')) +
    hcDato('Evento', hcV(s.evento && s.evento.nombre)));
  html += hcSec('Identificación del paciente',
    (p.nn ? hcDato('Paciente', 'Sin identificar (NN)') : '') +
    hcDato('Ubicación del paciente', hcT('procedencia', p.procedencia)) + hcDato('Tipo de paciente', hcT('tipo_paciente', p.tipo_paciente)) +
    hcDato('Nombres y apellidos', hcV(`${p.nombres || ''} ${p.apellidos || ''}`.trim()), true) +
    hcDato('Tipo de documento', hcT('tipo_doc', p.tipo_doc)) + hcDato('Número', hcV(p.documento)) +
    hcDato('Fecha de nacimiento', hcFecha(p.fecha_nacimiento)) + hcDato('Edad', hcV(p.edad && p.edad.texto)) +
    hcDato('Sexo', hcT('sexo', p.sexo)) + hcDato('RH', hcT('rh', p.rh)) + hcDato('Grupo sanguíneo', hcV(p.grupo)) +
    hcDato('Dirección', hcV(p.direccion)) + hcDato('Ciudad', hcV(p.ciudad)) + hcDato('Teléfono', hcV(p.telefono)) +
    hcDato('Estado civil', p.edad && p.edad.anios < 15 ? 'Soltero/a' : hcT('estado_civil', p.estado_civil)) + hcDato('Ocupación', hcV(p.ocupacion)) +
    hcDato('EPS', hcV(p.eps)) + hcDato('ARL', hcV(p.arl)) + hcDato('Otra aseguradora', p.otra_aseguradora ? hcV(p.aseguradora) : 'No'));
  html += hcSec('Contacto de acompañante', a.tiene
    ? hcDato('Nombre completo', hcV(a.nombre), true) + hcDato('Parentesco', hcV(a.parentesco)) + hcDato('Teléfono', hcV(a.telefono))
    : '<div class="hc-nada">Sin acompañante</div>');
  html += hcSec('Motivo de consulta', `<div class="hc-texto">${hcV(d.motivo && d.motivo.relato)}</div>`);
  html += hcSec('Antecedentes',
    HC_ANTECEDENTES.map(([k, t]) => hcDato(t, hcV(an[k]))).join('') +
    hcDato('Gestación', hcT('gestacion', an.gestacion) + (an.gestacion === 'si' ? ` · ${an.semanas} semanas` : '')));
  if(!rechazo && v){
    html += hcSec('Valoración primaria ABCDE',
      hcDato('A. Vía aérea', hcT('via_aerea', v.via_aerea) + (v.via_aerea_obs ? ' · ' + escHtml(v.via_aerea_obs) : ''), true) +
      hcDato('B. Respiración', hcT('respiracion', v.respiracion) + (v.respiracion_obs ? ' · ' + escHtml(v.respiracion_obs) : ''), true) +
      hcDato('C. Circulación', hcT('circulacion', v.circulacion) + (v.circulacion_obs ? ' · ' + escHtml(v.circulacion_obs) : ''), true) +
      hcDato('D. Estado neurológico', hcT('neuro', v.neuro) + ((v.orientado || []).length ? ' · Orientado en ' + v.orientado.map(o => hcT('orientado', o).toLowerCase()).join(', ') : ''), true) +
      hcDato('E. Exposición', hcV(v.exposicion), true));
    const tomas = [sg].concat(d.signos_tomas || []);
    if(tomas.length === 1){
      html += hcSec('Signos vitales',
        hcDato('Hora', hcV(sg.hora)) + hcDato('TA', sg.ta_sis ? `${sg.ta_sis}/${sg.ta_dia} mmHg` : '—') +
        hcDato('FC', sg.fc ? sg.fc + ' lpm' : '—') + hcDato('FR', sg.fr ? sg.fr + ' rpm' : '—') +
        hcDato('SpO₂', sg.spo2 ? sg.spo2 + ' %' : '—') + hcDato('Temperatura', sg.temp ? sg.temp + ' °C' : '—') +
        hcDato('Glucometría', sg.gluco ? sg.gluco + ' mg/dL' : '—') + hcDato('Dolor EVA', sg.eva !== null && sg.eva !== undefined ? sg.eva + '/10' : '—'));
    } else {
      // 2 tomas: Inicio / Final · 3 tomas: Inicio / Durante / Final
      const et = tomas.length === 2 ? ['Inicio', 'Final'] : ['Inicio', 'Durante', 'Final'];
      const n = (v, u) => v === null || v === undefined || v === '' ? '—' : escHtml(v) + (u ? ' ' + u : '');
      html += hcSec('Signos vitales',
        `<table class="hc-tabla"><thead><tr><th>Toma</th><th>Hora</th><th>TA</th><th>FC</th><th>FR</th><th>SpO₂</th><th>Temp.</th><th>Glucometría</th><th>EVA</th></tr></thead><tbody>` +
        tomas.map((t, i) => `<tr><td><b>${et[i]}</b></td><td>${hcV(t.hora)}</td><td>${t.ta_sis ? `${t.ta_sis}/${t.ta_dia} mmHg` : '—'}</td>
          <td>${n(t.fc, 'lpm')}</td><td>${n(t.fr, 'rpm')}</td><td>${n(t.spo2, '%')}</td><td>${n(t.temp, '°C')}</td><td>${n(t.gluco, 'mg/dL')}</td><td>${t.eva !== null && t.eva !== undefined ? t.eva + '/10' : '—'}</td></tr>`).join('') +
        '</tbody></table>');
    }
    html += hcSec('Escala de Glasgow',
      hcDato('Respuesta ocular', hcT('ocular', g.ocular)) + hcDato('Respuesta verbal', hcT('verbal', g.verbal)) +
      hcDato('Respuesta motora', hcT('motora', g.motora)) + hcDato('Total', `<strong class="hc-grande">${hcV(g.total)} / 15</strong>`));
    html += hcSec('Examen físico cefalocaudal', HC_SEGMENTOS.map(([k, t]) => hcDato(t, hcV(d.examen && d.examen[k]))).join(''));
    html += hcSec('Triage prehospitalario', hcDato('Clasificación', `<strong class="hc-grande">${hcV(d.triage)}</strong>`));
    html += hcSec('Procedimientos realizados', (d.procedimientos || []).length
      ? `<table class="hc-tabla"><thead><tr><th>Hora</th><th>Procedimiento</th><th>Responsable</th></tr></thead><tbody>` +
        d.procedimientos.map(x => `<tr><td>${hcV(x.hora)}</td><td>${hcV(x.descripcion)}</td><td>${hcV(x.responsable && x.responsable.nombre)}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="hc-nada">Ninguno</div>');
    html += hcSec('Medicamentos e insumos administrados', (d.medicamentos || []).length
      ? `<table class="hc-tabla"><thead><tr><th>Hora</th><th>Medicamento / insumo</th><th>Cantidad</th><th>Dosis</th><th>Vía</th><th>Responsable</th></tr></thead><tbody>` +
        d.medicamentos.map(m => `<tr><td>${hcV(m.hora)}</td><td>${hcV(m.nombre)}</td>
          <td>${m.cantidad} ${escHtml(m.unidad || '')}</td><td>${m.es_medicamento ? hcV(m.dosis) : 'Insumo'}</td>
          <td>${m.es_medicamento ? (m.via === 'OTRA' ? hcV(m.via_otra) : hcT('via', m.via)) : '—'}</td><td>${hcV(m.responsable && m.responsable.nombre)}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="hc-nada">Ninguno</div>');
  }
  html += hcSec('Evolución y descripción del servicio',
    `<div class="hc-texto">${hcV(ci.evolucion)}</div>` +
    hcDato('Condición clínica al finalizar', hcT('condicion', ci.condicion)) + hcDato('Destino o disposición final', hcT('destino', ci.destino)));
  if(ci.destino === 'TRASLADO' && ci.traslado){
    const t = ci.traslado;
    html += hcSec('Datos del traslado',
      hcDato('Origen', hcV(t.origen), true) + hcDato('Destino', hcV(t.destino), true) + hcDato('Tipo de ambulancia', hcT('ambulancia', t.ambulancia)) +
      hcDato('Móvil', hcV(t.movil)) + hcDato('Placa', hcV(t.placa)) + hcDato('Conductor', hcV(t.conductor)) + hcDato('Teléfono', hcV(t.telefono)));
    const e = d.entrega;
    html += hcSec('Entrega del paciente', e
      ? hcDato('Fecha', hcFecha(e.fecha)) + hcDato('Hora', hcV(e.hora)) + hcDato('Institución', hcV(e.institucion), true) +
        hcDato('Servicio receptor', e.servicio === 'OTRO' ? hcV(e.servicio_otro) : hcT('servicio', e.servicio)) +
        hcDato('Nombre de quien recibe', hcV(e.recibe_nombre)) + hcDato('Cargo', hcV(e.recibe_cargo)) +
        hcDato('Recibido de la IPS', e.adjunto_id ? 'Adjunto (ver "Archivos adjuntos")' : 'No se adjuntó') +
        `<div class="hc-sub">Registrada por ${escHtml(e.registrada_por || '—')} el ${hcFechaHora(e.registrada_at)}</div>`
      : '<div class="hc-nada">Pendiente: la registra el administrador cuando la institución confirma la recepción.</div>');
  }
  let cons = hcDato('Decisión', hcT('decision', c.decision), true);
  cons = `<div class="hc-texto hc-cita">${escHtml(c.texto || '')}</div>` + cons;
  if(rechazo){
    const t = c.testigo || {};
    cons += hcDato('Motivo del rechazo', hcV(c.motivo_rechazo), true) +
      hcDato('Testigo', hcV(`${t.nombres || ''} ${t.apellidos || ''}`.trim())) + hcDato('Cédula del testigo', hcV(t.cedula)) + hcDato('Teléfono del testigo', hcV(t.telefono)) +
      `<div class="hc-firmas">${hcFirmaImg(h.firmas.paciente, 'Firma del paciente o acudiente')}</div>`;
  }
  html += hcSec('Consentimiento informado', cons);
  html += hcSec('Responsables de la atención',
    `<div class="hc-firmas">
      ${r.medico
        ? hcFirmaImg(h.firmas.medico, `Médico: ${escHtml(r.medico.nombre)}<br>Cédula / RP ${escHtml(r.medico.cedula)}`, 'Firma médica pendiente')
        : hcFirmaImg(null, 'Sin médico asignado al evento', 'La atención queda bajo la responsabilidad de quien diligencia')}
      ${hcFirmaImg(h.firmas.enfermero, `TAPH / APH / Auxiliar: ${escHtml(r.enfermero ? r.enfermero.nombre : (d.enfermero && d.enfermero.nombre) || '—')}<br>Cédula ${escHtml(r.enfermero ? r.enfermero.cedula : '')}`)}
    </div>` +
    (r.medico_firma_tomada ? `<div class="hc-sub">La firma del médico se tomó en el panel de administración (${escHtml(r.medico_firma_tomada.por)}, ${hcFechaHora(r.medico_firma_tomada.at)}).</div>` : ''));
  return html;
}

function hcHtmlAdjuntos(h){
  if(!(h.adjuntos || []).length) return '';
  return hcSec('Archivos adjuntos', h.adjuntos.map(a => `
    <div class="hc-adj"><i class="ti ${a.mime === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-photo'}"></i>
      <span>${escHtml(a.nombre)} · ${Math.max(1, Math.round(a.tamano / 1024))} KB · ${escHtml(a.subido_por_nombre || '')} · ${hcFechaHora(a.created_at)}</span>
      <button class="act-btn primary" title="Ver" onclick="hcVerAdjunto(${a.id})"><i class="ti ti-eye"></i></button></div>`).join(''));
}

// ── Cambios resumidos: una línea por módulo ──
// El rastro guarda cada campo (antes → después). Para leerlo se resume:
//   novedad de la tablet → "ENFERMERA agregó signos vitales (Durante 14:40)"
//   edición del admin    → "Glasgow: ocular Espontánea → Ninguna; total 15 → 3"
const HC_MODULOS = {
  paciente: ['Identificación del paciente', 'la identificación del paciente'], acompanante: ['Acompañante', 'el acompañante'],
  motivo: ['Motivo de consulta', 'el motivo de consulta'], antecedentes: ['Antecedentes', 'los antecedentes'],
  consentimiento: ['Consentimiento', 'el consentimiento'], valoracion: ['Valoración ABCDE', 'la valoración ABCDE'],
  signos: ['Signos vitales', 'los signos vitales'], signos_tomas: ['Signos vitales', 'signos vitales'],
  glasgow: ['Glasgow', 'el Glasgow'], examen: ['Examen físico', 'el examen físico'], triage: ['Triage', 'el triage'],
  procedimientos: ['Procedimientos', 'procedimientos'], medicamentos: ['Medicamentos e insumos', 'medicamentos e insumos'],
  cierre: ['Evolución y cierre', 'la evolución y el cierre'], responsables: ['Responsables', 'los responsables'],
  entrega: ['Entrega del paciente', 'la entrega del paciente'], estado: ['Estado de la HC', 'el estado de la HC'],
  adjuntos: ['Archivos adjuntos', 'archivos adjuntos'], firmas: ['Firmas', 'las firmas']
};
const HC_ETIQUETAS = {
  nombres: 'nombres', apellidos: 'apellidos', tipo_doc: 'tipo de documento', documento: 'documento', fecha_nacimiento: 'fecha de nacimiento',
  rh: 'RH', grupo: 'grupo sanguíneo', direccion: 'dirección', ocupacion: 'ocupación', movil: 'móvil', telefono: 'teléfono', estado_civil: 'estado civil', otra_aseguradora: 'otra aseguradora',
  via_aerea: 'vía aérea', respiracion: 'respiración', circulacion: 'circulación', neuro: 'estado neurológico', orientado: 'orientado en', exposicion_si: 'hallazgos en la exposición',
  via_aerea_obs: 'observaciones vía aérea', respiracion_obs: 'observaciones respiración', circulacion_obs: 'observaciones circulación',
  ta_sis: 'TA sistólica', ta_dia: 'TA diastólica', fc: 'FC', fr: 'FR', spo2: 'SpO₂', temp: 'temperatura', gluco: 'glucometría', eva: 'dolor EVA',
  ocular: 'ocular', verbal: 'verbal', motora: 'motora', total: 'total', relato: 'relato', evolucion: 'evolución', condicion: 'condición',
  destino: 'destino', ambulancia: 'ambulancia', recibe_nombre: 'quien recibe', recibe_cargo: 'cargo de quien recibe', servicio_otro: 'otro servicio',
  medico_firma_pendiente: 'firma médica pendiente', procedencia: 'ubicación del paciente', tipo_paciente: 'tipo de paciente', campos_pulmonares: 'campos pulmonares', eess: 'extremidades superiores',
  eeii: 'extremidades inferiores', torax: 'tórax', gestacion: 'gestación', semanas: 'semanas de gestación', motivo_rechazo: 'motivo del rechazo'
};
function _hcValorCambio(k, v){
  if(v === null || v === undefined || v === '' || v === '[]' || v === '{}') return 'vacío';
  if(v === true) return 'Sí';
  if(v === false) return 'No';
  const t = HC_TXT[k] && HC_TXT[k][v];
  const s = String(t || v);
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}
function _hcEtiquetaCampo(partes){
  const ult = partes[partes.length - 1];
  const base = HC_ETIQUETAS[ult] || ult.replace(/_/g, ' ');
  return partes.length > 2 && !/^\d+$/.test(partes[1]) ? (HC_ETIQUETAS[partes[1]] || partes[1].replace(/_/g, ' ')) + ' ' + base : base;
}
// Texto corto de un elemento de una lista (procedimiento, medicamento, toma)
function _hcItem(modulo, o, i, h){
  if(modulo === 'procedimientos') return `${(o.descripcion || '').trim() || '—'}${o.hora ? ' ' + o.hora : ''}`;
  if(modulo === 'medicamentos'){
    const via = o.via ? (o.via === 'OTRA' ? o.via_otra : hcT('via', o.via)) : '';
    return [o.nombre, o.cantidad !== undefined && o.cantidad !== null ? `${o.cantidad} ${(o.unidad || '').toLowerCase()}`.trim() : '', o.dosis || '', via].filter(Boolean).join(' · ');
  }
  // Toma de signos: rótulo según cuántas tomas tiene hoy la HC
  const total = 1 + ((h.datos && h.datos.signos_tomas) || []).length;
  const et = total === 2 ? ['Inicio', 'Final'] : ['Inicio', 'Durante', 'Final'];
  return `${et[i + 1] || 'Toma ' + (i + 2)}${o.hora ? ' ' + o.hora : ''}`;
}
// "1 Tabletas DESLORATADINA 5 MG TAB (lote F00393A) de MEC-B 2 MED" (formato
// anterior) → "DESLORATADINA 5 MG TAB · 1 tabletas": sin lote ni depósito
function _hcSoloItem(t){
  let x = String(t).replace(/\s*\(lote [^)]*\)/i, '').replace(/ de [^·]*$/, '').trim();
  const m = /^(\d+)\s+(\S+)\s+(.+)$/.exec(x);
  if(m && x.indexOf(' · ') < 0) x = `${m[3]} · ${m[1]} ${m[2].toLowerCase()}`;
  return x;
}
function hcResumenCambios(c, h){
  const porModulo = {}, orden = [];
  (c.cambios || []).forEach(x => {
    const partes = String(x.campo).split('.');
    const m = partes[0];
    if(!porModulo[m]){ porModulo[m] = []; orden.push(m); }
    porModulo[m].push({ partes, antes: x.antes, despues: x.despues });
  });
  const novedad = c.accion === 'novedad';
  const quien = c.usuario_nombre || '—';
  const lineas = [];
  orden.forEach(m => {
    const [titulo, nombre] = HC_MODULOS[m] || [m, m];
    const filas = porModulo[m];
    if(['procedimientos', 'medicamentos', 'signos_tomas'].indexOf(m) >= 0){
      // Listas: elementos agregados, quitados o cambiados
      const items = {}, sueltos = [];
      filas.forEach(f => {
        if(/^\d+$/.test(f.partes[1] || '')){
          const it = items[f.partes[1]] || (items[f.partes[1]] = { antes: {}, despues: {}, cambios: [] });
          const k = f.partes.slice(2).join('.');
          it.antes[k] = f.antes; it.despues[k] = f.despues;
          it.cambios.push(f);
        } else if(typeof f.despues === 'string' && f.despues !== '[]') sueltos.push(_hcSoloItem(f.despues));
        else if(typeof f.antes === 'string' && f.antes !== '[]' && (f.despues === null || f.despues === undefined)) sueltos.push('quitó ' + _hcSoloItem(f.antes));
      });
      const agregados = [], quitados = [], cambiados = [];
      Object.keys(items).sort((a, b) => a - b).forEach(idx => {
        const it = items[idx];
        const vacio = o => Object.values(o).every(v => v === null || v === undefined || v === '');
        if(vacio(it.antes)) agregados.push(_hcItem(m, it.despues, +idx, h));
        else if(vacio(it.despues)) quitados.push(_hcItem(m, it.antes, +idx, h));
        else cambiados.push(`${_hcItem(m, { ...it.antes, ...it.despues }, +idx, h)}: ` +
          it.cambios.map(f => `${_hcEtiquetaCampo(f.partes.slice(1))} ${_hcValorCambio(f.partes[f.partes.length - 1], f.antes)} → ${_hcValorCambio(f.partes[f.partes.length - 1], f.despues)}`).join(', '));
      });
      const partes = [];
      if(agregados.length) partes.push(`agregó ${novedad ? nombre + ' ' : ''}(${agregados.join('; ')})`);
      if(quitados.length) partes.push(`quitó ${novedad ? nombre + ' ' : ''}(${quitados.join('; ')})`);
      if(cambiados.length) partes.push(`cambió ${novedad ? nombre + ' ' : ''}(${cambiados.join('; ')})`);
      sueltos.forEach(t => partes.push(/^quitó /.test(t) ? t : 'agregó ' + t));
      if(partes.length) lineas.push(novedad ? `${quien} ${partes.join('; ')}` : `${titulo}: ${partes.join('; ')}`);
      return;
    }
    // Campos sueltos: "campo antes → después" (las listas como "orientado en" se juntan)
    const grupos = {}, gOrden = [];
    filas.forEach(f => {
      let partes = f.partes;
      if(/^\d+$/.test(partes[partes.length - 1])) partes = partes.slice(0, -1);
      const k = partes.join('.');
      if(!grupos[k]){ grupos[k] = { partes, antes: [], despues: [], lista: partes !== f.partes }; gOrden.push(k); }
      const g = grupos[k];
      if(f.antes !== null && f.antes !== undefined && f.antes !== '[]' && f.antes !== '{}') g.antes.push(f.antes);
      if(f.despues !== null && f.despues !== undefined && f.despues !== '[]' && f.despues !== '{}') g.despues.push(f.despues);
    });
    const textos = gOrden.map(k => {
      const g = grupos[k], ult = g.partes[g.partes.length - 1];
      const v = arr => arr.length ? arr.map(x => _hcValorCambio(ult, x)).join(', ') : 'vacío';
      if(g.lista && !g.antes.length && !g.despues.length) return '';
      if(g.partes.length === 1) return `${v(g.antes)} → ${v(g.despues)}`;
      return `${_hcEtiquetaCampo(g.partes)} ${v(g.antes)} → ${v(g.despues)}`;
    }).filter(Boolean);
    if(!textos.length) return;
    lineas.push(novedad ? `${quien} actualizó ${nombre} (${textos.join('; ')})` : `${titulo}: ${textos.join('; ')}`);
  });
  return lineas;
}
// Los consumos que el administrador agrega o quita en el editor y la edición
// que guarda después son una sola corrección: se juntan en un punto
// "Edición" con el motivo que él escribió (si son seguidos, del mismo usuario
// y dentro de 2 horas)
function _hcAgruparCambios(lista){
  const grupos = [];
  lista.forEach(c => {
    const ult = grupos[grupos.length - 1];
    const deAdmin = c.accion === 'edicion' || c.accion === 'consumo';
    if(deAdmin && ult && ult.deAdmin && ult.usuario_nombre === c.usuario_nombre &&
       Math.abs(new Date(c.created_at) - new Date(ult.ultimo_at)) <= 2 * 3600e3){
      ult.cambios = ult.cambios.concat(c.cambios || []);
      if(c.accion === 'edicion'){ ult.accion = 'edicion'; ult.motivo = c.motivo; }
      ult.ultimo_at = c.created_at;
      return;
    }
    grupos.push({ ...c, deAdmin, accion: deAdmin ? 'edicion' : c.accion, motivo: c.accion === 'consumo' ? '' : c.motivo,
                  cambios: (c.cambios || []).slice(), ultimo_at: c.created_at });
  });
  return grupos;
}
function _hcCambioHtml(c, h, i){
  const lineas = hcResumenCambios(c, h);
  return `<div class="hc-cambio" style="padding:4px 6px;${i ? 'border-top:1px dashed #bbb' : ''}">
      <div><strong>${i !== null ? (i + 1) + '. ' : ''}${escHtml(hcT('accion', c.accion))}</strong> · ${escHtml(c.usuario_nombre || '—')} · ${hcFechaHora(c.created_at)}</div>
      ${c.motivo && c.accion !== 'novedad' ? `<div>Motivo: ${escHtml(c.motivo)}</div>` : ''}
      ${lineas.map(l => `<div class="hc-cambio-l">${escHtml(l)}</div>`).join('')}
    </div>`;
}

// Para el PDF: cada corrección posterior a la recepción, en orden, con quién,
// cuándo, el motivo y lo que cambió (nota aclaratoria, Res. 1995/1999)
function hcNotasAclaratorias(h){
  const lista = _hcAgruparCambios((h.cambios || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id));
  if(!lista.length) return '';
  return hcSec('Notas aclaratorias (correcciones posteriores)', lista.map((c, i) => _hcCambioHtml(c, h, i)).join(''));
}

function hcHtmlCambios(h){
  if(!(h.cambios || []).length) return hcSec('Historial de cambios', '<div class="hc-nada">Sin cambios desde que se recibió de la tablet.</div>');
  const lista = _hcAgruparCambios(h.cambios.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id));
  return hcSec('Historial de cambios', lista.reverse().map(c => _hcCambioHtml(c, h, null)).join(''));
}

async function hcVerAdjunto(aid){
  try {
    const blob = await HistoriasClinicas.descargarAdjunto(_hcActual.id, aid);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch(err){ toastError(err.message); }
}

// ══════════════════════════════════════════
// ENTREGA DEL PACIENTE
// ══════════════════════════════════════════
function hcAbrirEntrega(){
  const t = _hcActual.datos.cierre.traslado || {};
  document.getElementById('hc-entrega-sub').textContent = `${_hcActual.consecutivo} · Trasladado a ${t.destino || '—'}. Al registrar la entrega la historia clínica queda cerrada.`;
  ['hce-fecha','hce-hora','hce-institucion','hce-servicio-otro','hce-recibe-nombre','hce-recibe-cargo','hce-archivo'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('hce-institucion').value = t.destino || '';
  document.getElementById('hce-servicio').value = 'URGENCIAS';
  document.getElementById('hce-servicio-otro-wrap').style.display = 'none';
  document.getElementById('modal-hc-entrega').classList.add('open');
}

async function hcGuardarEntrega(){
  const val = id => document.getElementById(id).value.trim();
  const data = {
    fecha: val('hce-fecha'), hora: val('hce-hora'), institucion: val('hce-institucion'),
    servicio: val('hce-servicio'), servicio_otro: val('hce-servicio-otro'),
    recibe_nombre: val('hce-recibe-nombre'), recibe_cargo: val('hce-recibe-cargo')
  };
  const archivo = document.getElementById('hce-archivo').files[0];
  if(!data.fecha || !data.hora) return toastError('Indica la fecha y la hora de la entrega');
  if(data.institucion.length < 3) return toastError('Escribe la institución');
  if(data.servicio === 'OTRO' && data.servicio_otro.length < 3) return toastError('Escribe cuál servicio receptor');
  if(data.recibe_nombre.length < 3 || data.recibe_cargo.length < 3) return toastError('Escribe el nombre y el cargo de quien recibe');
  // El recibido de la IPS es opcional
  if(archivo && ['image/jpeg','image/png','application/pdf'].indexOf(archivo.type) < 0) return toastError('El recibido debe ser una foto (JPG o PNG) o un PDF');
  if(archivo && archivo.size > 5 * 1024 * 1024) return toastError('El archivo supera el máximo de 5 MB');
  const btn = document.getElementById('hce-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const adj = archivo ? await HistoriasClinicas.subirAdjunto(_hcActual.id, archivo) : null;
    await HistoriasClinicas.entrega(_hcActual.id, { ...data, adjunto_id: adj ? adj.id : null });
    closeModal('modal-hc-entrega');
    toast('✓ Entrega registrada: la historia clínica quedó cerrada', 'success');
    await hcRecargar();
  } catch(err){ toastError(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Registrar entrega y cerrar la HC'; }
}

// ══════════════════════════════════════════
// FIRMA DEL MÉDICO (si quedó pendiente en la tablet)
// ══════════════════════════════════════════
let _hcFirma = { trazando: false, puntos: 0 };
function hcAbrirFirmaMedico(){
  const m = _hcActual.datos.responsables.medico;
  document.getElementById('hc-firma-sub').textContent = `${m.nombre} · Cédula / RP ${m.cedula}. Firme con el mouse o en la pantalla táctil.`;
  document.getElementById('modal-hc-firma').classList.add('open');
  hcFirmaLimpiar();
}
function hcFirmaLimpiar(){
  const c = document.getElementById('hc-firma-canvas'), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#0A1628'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  _hcFirma.puntos = 0;
}
function _hcFirmaPunto(e){
  const c = document.getElementById('hc-firma-canvas'), r = c.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
}
document.addEventListener('DOMContentLoaded', () => {
  const c = document.getElementById('hc-firma-canvas');
  if(!c) return;
  const ctx = c.getContext('2d');
  c.addEventListener('pointerdown', e => { e.preventDefault(); c.setPointerCapture(e.pointerId); _hcFirma.trazando = true; const p = _hcFirmaPunto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); _hcFirma.puntos++; });
  c.addEventListener('pointermove', e => { if(!_hcFirma.trazando) return; const p = _hcFirmaPunto(e); ctx.lineTo(p.x, p.y); ctx.stroke(); _hcFirma.puntos++; });
  ['pointerup','pointercancel','pointerleave'].forEach(ev => c.addEventListener(ev, () => { _hcFirma.trazando = false; }));
});
async function hcGuardarFirmaMedico(){
  if(_hcFirma.puntos < 15) return toastError('La firma está vacía o es muy corta');
  try {
    await HistoriasClinicas.firmaMedico(_hcActual.id, document.getElementById('hc-firma-canvas').toDataURL('image/png'));
    closeModal('modal-hc-firma');
    toast('✓ Firma del médico registrada', 'success');
    await hcRecargar();
  } catch(err){ toastError(err.message); }
}

// ══════════════════════════════════════════
// CLASIFICACIÓN PARA EL REPORTE (IA) — se ve en el detalle de cada HC
// ══════════════════════════════════════════
function hcHtmlClasificacion(h){
  const c = h.clasificacion;
  let cuerpo;
  if(c){
    cuerpo = hcDato('Diagnóstico', escHtml(c.diagnostico)) + hcDato('Categoría', escHtml(c.categoria)) +
      hcDato('Nivel de triage', `<strong>${escHtml(c.triage)}</strong>${h.datos && h.datos.triage ? ` <span class="hc-sub" style="display:inline;padding:0">(el enfermero marcó ${escHtml(h.datos.triage)})</span>` : ''}`) +
      hcDato('Procedimiento', escHtml((c.procedimientos || []).join(' + ')), true) +
      `<div class="hc-sub">${c.corregida_por ? `Corregida por ${escHtml(c.corregida_por)} el ${hcFechaHora(c.corregida_at)}` : `Clasificada por IA${c.modelo ? ' (' + escHtml(c.modelo) + ')' : ''} el ${hcFechaHora(h.clasificada_at)}`}</div>`;
  } else {
    cuerpo = `<div class="hc-nada">${h.clasificacion_error ? 'No se pudo clasificar: ' + escHtml(h.clasificacion_error) : 'Pendiente: la IA la clasifica en unos minutos (si está configurada).'}</div>`;
  }
  return hcSec('Clasificación para el reporte (IA)', cuerpo +
    `<div class="hc-clas-acciones"><button class="tb-btn" onclick="hcAbrirClasificacion()"><img class="btn-ico" src="img/iconos/editar.svg" alt="">Corregir</button>
     <button class="tb-btn" onclick="hcRehacerClasificacion()">Volver a clasificar con IA</button></div>`);
}

let _hcCatalogos = null;
async function hcAbrirClasificacion(){
  try {
    _hcCatalogos = await HistoriasClinicas.catalogos();
    const c = _hcActual.clasificacion || {};
    document.getElementById('hcclas-diagnostico').innerHTML = '<option value="">Elegir…</option>' +
      _hcCatalogos.diagnosticos.map(d => `<option value="${escHtml(d.nombre)}"${d.nombre === c.diagnostico ? ' selected' : ''}>${escHtml(d.nombre)} · ${escHtml(d.categoria)}${d.origen === 'ia' ? ' (nuevo por IA)' : ''}</option>`).join('');
    const sel = new Set(c.procedimientos || []);
    document.getElementById('hcclas-procedimientos').innerHTML = _hcCatalogos.procedimientos.map(p =>
      `<label class="evt-check-item"><input type="checkbox" value="${escHtml(p.nombre)}"${sel.has(p.nombre) ? ' checked' : ''}> <span>${escHtml(p.nombre)}${p.origen === 'ia' ? ' <em>(nuevo por IA)</em>' : ''}</span></label>`).join('');
    document.getElementById('hcclas-triage').value = c.triage || '';
    document.getElementById('modal-hc-clasif').classList.add('open');
  } catch(err){ toastError(err.message); }
}
async function hcGuardarClasificacion(btn){
  const diagnostico = document.getElementById('hcclas-diagnostico').value;
  const procedimientos = [...document.querySelectorAll('#hcclas-procedimientos input:checked')].map(x => x.value);
  const triage = document.getElementById('hcclas-triage').value;
  if(!diagnostico || !procedimientos.length || !triage) return toastError('Elige el diagnóstico, al menos un procedimiento y el nivel de triage');
  if(procedimientos.length > 4) return toastError('Máximo 4 procedimientos');
  await unaVez('hc-clas', btn, async () => {
    try {
      await HistoriasClinicas.corregirClasificacion(_hcActual.id, { diagnostico, procedimientos, triage });
      closeModal('modal-hc-clasif');
      toast('✓ Clasificación corregida', 'success');
      await hcRecargar();
    } catch(err){ toastError(err.message); }
  });
}
async function hcRehacerClasificacion(){
  try {
    const r = await HistoriasClinicas.rehacerClasificacion(_hcActual.id);
    toast('✓ ' + r.mensaje, 'success');
    setTimeout(() => { if(_hcActual) hcRecargar(); }, 6000);
  } catch(err){ toastError(err.message); }
}

// ══════════════════════════════════════════
// REPORTE DE ATENCIONES (solo Excel)
// Una fila por historia clínica, columnas en el orden que pidió el cliente.
// Nombre e ID salen como CONFIDENCIAL. Diagnóstico, categoría, procedimiento
// y triage salen de la clasificación por IA de cada HC.
// ══════════════════════════════════════════
const HC_REPORTE_COLS = [
  ['evento', 'Evento', 28], ['fecha', 'Fecha', 12], ['hora_inicial', 'Hora Inicial', 11], ['hora_final', 'Hora Final', 10],
  ['hora_atencion', 'Hora Atención', 12], ['jornada', 'Jornada Atención', 15], ['ubicacion', 'Ubicación', 22],
  ['nombre', 'Nombre Paciente', 16], ['id', 'ID', 14], ['edad', 'Edad', 10], ['rango_edad', 'Rango Edad', 16],
  ['ubicacion_paciente', 'Ubicación del Paciente', 20], ['diagnostico', 'Diagnóstico', 26], ['categoria', 'Categoría', 28],
  ['procedimiento', 'Procedimiento', 40], ['genero', 'Género', 11], ['tipo', 'Tipo', 16], ['traslado', 'Traslado', 9], ['triage', 'Nivel Triage', 11]
];
function hcAbrirReporte(){
  const sel = document.getElementById('hcrep-evento');
  sel.innerHTML = '<option value="">Todos los eventos</option>' + (S.eventos || []).map(e => `<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('');
  sel.value = document.getElementById('hcf-evento').value;
  document.getElementById('hcrep-desde').value = document.getElementById('hcf-desde').value;
  document.getElementById('hcrep-hasta').value = document.getElementById('hcf-hasta').value;
  document.getElementById('hcrep-aviso').innerHTML = '';
  document.getElementById('modal-hc-reporte').classList.add('open');
}
async function hcDescargarReporte(btn){
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el generador de Excel. Revisa la conexión.');
  const f = { evento_id: document.getElementById('hcrep-evento').value, desde: document.getElementById('hcrep-desde').value, hasta: document.getElementById('hcrep-hasta').value };
  await unaVez('hc-reporte', btn, async () => {
    try {
      const r = await HistoriasClinicas.reporte(f);
      if(!r.filas.length){ toastError('No hay historias clínicas con esos filtros'); return; }
      const tabla = [HC_REPORTE_COLS.map(c => c[1])].concat(r.filas.map(x => HC_REPORTE_COLS.map(c => x[c[0]] === null || x[c[0]] === undefined ? '' : x[c[0]])));
      const ws = XLSX.utils.aoa_to_sheet(tabla);
      ws['!cols'] = HC_REPORTE_COLS.map(c => ({ wch: c[2] }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tabla.length - 1, c: HC_REPORTE_COLS.length - 1 } }) };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Atenciones');
      XLSX.writeFile(wb, `reporte_atenciones_${fechaColombia()}.xlsx`);
      document.getElementById('hcrep-aviso').innerHTML = r.pendientes
        ? `<div class="asis-carga-aviso">Se descargaron ${r.filas.length} atenciones. <b>${r.pendientes}</b> aún no tienen la clasificación de la IA (diagnóstico, categoría, procedimiento y triage): salen como "Pendiente de clasificar". Vuelve a descargar en unos minutos.</div>`
        : `<div class="asis-carga-ok">✓ Se descargaron ${r.filas.length} atenciones.</div>`;
    } catch(err){ toastError(err.message); }
  });
}

// ══════════════════════════════════════════
// IMPRIMIR / PDF — estructura del formato SIG_08NB_0030
// Se abre una ventana con la HC lista para imprimir; en el diálogo de
// impresión se elige "Guardar como PDF".
// ══════════════════════════════════════════
function hcImprimir(){
  const h = _hcActual;
  const w = window.open('', '_blank');
  if(!w) return toastError('El navegador bloqueó la ventana: permite las ventanas emergentes para este sitio');
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escHtml(h.consecutivo)} — Historia clínica prehospitalaria</title>
<style>
  @page{ size:A4; margin:12mm }
  *{ box-sizing:border-box }
  body{ font-family:Arial,Helvetica,sans-serif; font-size:10.5px; color:#111; margin:0 }
  .enc{ display:flex; justify-content:space-between; align-items:center; border:1.5px solid #111; padding:8px 10px; margin-bottom:6px }
  .enc h1{ font-size:14px; margin:0 0 2px } .enc .cod{ text-align:right; font-size:10px }
  .enc .num{ font-size:15px; font-weight:bold }
  /* Logos: no más altos que los datos de la cabecera */
  .enc-lado{ display:flex; align-items:center; gap:10px }
  .enc-logo{ height:60px; width:auto; display:block }
  .hc-sec{ border:1px solid #111; margin-bottom:5px; page-break-inside:avoid }
  .hc-sec-t{ background:#e6e6e6; font-weight:bold; text-transform:uppercase; padding:3px 6px; border-bottom:1px solid #111; font-size:10px }
  .hc-sec > .hc-dato, .hc-sec > div:not(.hc-sec-t){ }
  .hc-dato{ display:inline-block; vertical-align:top; width:33%; padding:3px 6px }
  .hc-dato.ancho{ width:100% }
  .hc-dato span{ display:block; font-size:8.5px; color:#555; text-transform:uppercase }
  .hc-dato b{ font-weight:normal }
  .hc-texto{ padding:4px 6px; white-space:pre-wrap }
  .hc-cita{ font-style:italic }
  .hc-nada{ padding:4px 6px; color:#555 }
  .hc-sub{ font-size:9px; color:#555; padding:0 6px 3px }
  .hc-grande{ font-size:13px; font-weight:bold }
  table.hc-tabla{ width:100%; border-collapse:collapse }
  .hc-tabla th, .hc-tabla td{ border-top:1px solid #999; padding:3px 5px; text-align:left; font-size:9.5px; vertical-align:top }
  .hc-tabla th{ background:#f2f2f2 }
  .hc-firmas{ display:flex; gap:12px; padding:6px }
  .hc-firma{ flex:1 } .hc-firma-caja{ height:70px; border-bottom:1px solid #111; display:flex; align-items:flex-end; justify-content:center }
  .hc-firma-caja img{ max-height:68px; max-width:100% } .hc-firma-caja em{ color:#777; font-size:9px; padding-bottom:4px }
  .hc-firma-pie{ font-size:9px; text-align:center; padding-top:3px }
  .pie{ margin-top:8px; font-size:8.5px; color:#555; text-align:center }
</style></head><body>
<div class="enc">
  <div class="enc-lado"><img class="enc-logo" src="${location.origin}/img/logos/nova.png" alt="NOVA BRIDGE"><div><h1>NOVA BRIDGE SAS</h1><div>HISTORIA CLÍNICA PREHOSPITALARIA</div></div></div>
  <div class="enc-lado"><div class="cod"><div>SIG_08NB_0030</div><div class="num">${escHtml(h.consecutivo)}</div><div>${h.estado === 'abierta' ? 'ABIERTA (pendiente de entrega)' : 'CERRADA'}</div></div>
    <img class="enc-logo" src="${location.origin}/img/logos/minsalud.webp" alt="Ministerio de Salud y Protección Social"></div>
</div>
${hcHtml(h, true)}
${hcNotasAclaratorias(h)}
<div class="pie">Generada desde WMS-HC NOVABRIDGE S.A.S. el ${hcFechaHora(new Date().toISOString())}. Recibida en el servidor el ${hcFechaHora(h.recibida_at)}${(h.cambios || []).length ? ` · ${h.cambios.length} registro(s) en el historial de cambios` : ''}.</div>
</body></html>`);
  w.document.close();
  w.focus();
  const imgs = [...w.document.images];
  Promise.all(imgs.map(i => i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; })))
    .then(() => setTimeout(() => w.print(), 200));
}
