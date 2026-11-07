// ══════════════════════════════════════════
// HISTORIAS CLÍNICAS — módulo del administrador (nivel 4)
//
// Lista las HC que envían las tablets, con filtros; muestra cada una
// completa; registra la entrega del paciente (HC con traslado, que quedan
// abiertas hasta entonces) con la foto o PDF del recibido de la IPS; toma la
// firma del médico si quedó pendiente; permite corregir cualquier dato con
// rastro de cambios (quién, cuándo, motivo, antes → después), y genera la
// versión imprimible con la estructura del formato SIG_08NB_0030 (se guarda
// como PDF desde el diálogo de impresión del navegador).
// API: /api/hc (src/routes/hc.js)
// ══════════════════════════════════════════

// ── Textos de los valores guardados ──
const HC_TXT = {
  tipo_doc: { CC:'CC', TI:'TI', CE:'CE', PAS:'Pasaporte', RC:'RC', PPT:'PPT', OTRO:'Otro' },
  sexo: { M:'Masculino', F:'Femenino', O:'Otro' },
  estado_civil: { SOLTERO:'Soltero/a', CASADO:'Casado/a', DIVORCIADO:'Divorciado/a', VIUDO:'Viudo/a', UNION_LIBRE:'Unión libre' },
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
  accion: { edicion:'Edición', entrega:'Entrega del paciente', firma_medico:'Firma del médico', adjunto:'Archivo adjunto' }
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
    `<button class="tb-btn" onclick="hcAbrirEdicion()"><img class="btn-ico" src="img/iconos/editar.svg" alt="">Editar</button>`,
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
    hcDato('Nombres y apellidos', hcV(`${p.nombres || ''} ${p.apellidos || ''}`.trim()), true) +
    hcDato('Tipo de documento', hcT('tipo_doc', p.tipo_doc)) + hcDato('Número', hcV(p.documento)) +
    hcDato('Fecha de nacimiento', hcFecha(p.fecha_nacimiento)) + hcDato('Edad', hcV(p.edad && p.edad.texto)) +
    hcDato('Sexo', hcT('sexo', p.sexo)) + hcDato('RH', hcT('rh', p.rh)) + hcDato('Grupo sanguíneo', hcV(p.grupo)) +
    hcDato('Dirección', hcV(p.direccion)) + hcDato('Ciudad', hcV(p.ciudad)) + hcDato('Teléfono', hcV(p.telefono)) +
    hcDato('Estado civil', hcT('estado_civil', p.estado_civil)) + hcDato('Ocupación', hcV(p.ocupacion)) +
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
    html += hcSec('Signos vitales',
      hcDato('Hora', hcV(sg.hora)) + hcDato('TA', sg.ta_sis ? `${sg.ta_sis}/${sg.ta_dia} mmHg` : '—') +
      hcDato('FC', sg.fc ? sg.fc + ' lpm' : '—') + hcDato('FR', sg.fr ? sg.fr + ' rpm' : '—') +
      hcDato('SpO₂', sg.spo2 ? sg.spo2 + ' %' : '—') + hcDato('Temperatura', sg.temp ? sg.temp + ' °C' : '—') +
      hcDato('Glucometría', sg.gluco ? sg.gluco + ' mg/dL' : '—') + hcDato('Dolor EVA', sg.eva !== null && sg.eva !== undefined ? sg.eva + '/10' : '—'));
    html += hcSec('Escala de Glasgow',
      hcDato('Respuesta ocular', hcT('ocular', g.ocular)) + hcDato('Respuesta verbal', hcT('verbal', g.verbal)) +
      hcDato('Respuesta motora', hcT('motora', g.motora)) + hcDato('Total', `<span class="hc-grande">${hcV(g.total)}</span> / 15`));
    html += hcSec('Examen físico cefalocaudal', HC_SEGMENTOS.map(([k, t]) => hcDato(t, hcV(d.examen && d.examen[k]))).join(''));
    html += hcSec('Triage prehospitalario', hcDato('Clasificación', `<span class="hc-grande">${hcV(d.triage)}</span>`));
    html += hcSec('Procedimientos realizados', (d.procedimientos || []).length
      ? `<table class="hc-tabla"><thead><tr><th>Hora</th><th>Procedimiento</th><th>Responsable</th></tr></thead><tbody>` +
        d.procedimientos.map(x => `<tr><td>${hcV(x.hora)}</td><td>${hcV(x.descripcion)}</td><td>${hcV(x.responsable && x.responsable.nombre)}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="hc-nada">Ninguno</div>');
    html += hcSec('Medicamentos administrados e insumos', (d.medicamentos || []).length
      ? `<table class="hc-tabla"><thead><tr><th>Hora</th><th>Medicamento / insumo</th><th>Cantidad</th><th>Dosis</th><th>Vía</th><th>Responsable</th></tr></thead><tbody>` +
        d.medicamentos.map(m => `<tr><td>${hcV(m.hora)}</td><td>${hcV(m.nombre)}${m.lote ? `<div class="hc-sub">Lote ${escHtml(m.lote)} · ${escHtml(m.bodega)}</div>` : ''}</td>
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

function hcHtmlCambios(h){
  if(!(h.cambios || []).length) return hcSec('Historial de cambios', '<div class="hc-nada">Sin cambios desde que se recibió de la tablet.</div>');
  const fmt = x => x === null || x === undefined || x === '' ? '<em>vacío</em>' : escHtml(typeof x === 'object' ? JSON.stringify(x) : String(x));
  return hcSec('Historial de cambios', h.cambios.map(c => `
    <div class="hc-cambio">
      <div><strong>${escHtml(hcT('accion', c.accion))}</strong> · ${escHtml(c.usuario_nombre || '—')} · ${hcFechaHora(c.created_at)}</div>
      ${c.motivo ? `<div class="hc-sub">Motivo: ${escHtml(c.motivo)}</div>` : ''}
      <ul>${(c.cambios || []).slice(0, 60).map(x => `<li><code>${escHtml(x.campo)}</code>: ${fmt(x.antes)} → ${fmt(x.despues)}</li>`).join('')}</ul>
    </div>`).join(''));
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
// EDICIÓN (con rastro de cambios)
// Formulario con los datos guardados; al guardar se envía la HC completa con
// los valores editados y el servidor la vuelve a validar y registra el rastro.
// ══════════════════════════════════════════
function hcLeer(o, ruta){ return ruta.split('.').reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o); }
function hcFijar(o, ruta, v){
  const partes = ruta.split('.');
  let x = o;
  partes.slice(0, -1).forEach(k => { if(x[k] === null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; });
  x[partes[partes.length - 1]] = v;
}

// Campo del formulario de edición. tipo: texto | area | fecha | hora | si-no | lista
function hcCampo(d, ruta, etiqueta, tipo, opciones, ancho){
  const v = hcLeer(d, ruta);
  const val = v === null || v === undefined ? '' : String(v);
  let input;
  if(tipo === 'area') input = `<textarea data-ruta="${ruta}" rows="2">${escHtml(val)}</textarea>`;
  else if(tipo === 'si-no') input = `<select data-ruta="${ruta}" data-tipo="bool"><option value="false"${v ? '' : ' selected'}>No</option><option value="true"${v ? ' selected' : ''}>Sí</option></select>`;
  else if(tipo === 'lista') input = `<select data-ruta="${ruta}"><option value="">—</option>${Object.entries(opciones).map(([k, t]) => `<option value="${escHtml(k)}"${String(k) === val ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}</select>`;
  else input = `<input type="${tipo === 'fecha' ? 'date' : tipo === 'hora' ? 'time' : 'text'}" data-ruta="${ruta}" value="${escHtml(val)}">`;
  return `<div class="form-group${ancho ? ' fg-full' : ''}"><label>${etiqueta}</label>${input}</div>`;
}
function hcGrupo(titulo, campos){ return `<div class="hc-ed-grupo"><div class="hc-sec-t">${titulo}</div><div class="form-grid">${campos}</div></div>`; }

function hcAbrirEdicion(){
  const d = JSON.parse(JSON.stringify(_hcActual.datos));
  const rechazo = d.consentimiento && d.consentimiento.decision === 'rechaza';
  const f = (ruta, et, tipo = 'texto', op, ancho) => hcCampo(d, ruta, et, tipo, op, ancho);
  let html = '';
  html += hcGrupo('Identificación del paciente',
    f('paciente.nn', 'Paciente sin identificar (NN)', 'si-no') + f('paciente.nombres', 'Nombres') + f('paciente.apellidos', 'Apellidos') +
    f('paciente.tipo_doc', 'Tipo de documento', 'lista', HC_TXT.tipo_doc) + f('paciente.documento', 'Número de documento') +
    f('paciente.fecha_nacimiento', 'Fecha de nacimiento', 'fecha') + f('paciente.sexo', 'Sexo', 'lista', HC_TXT.sexo) +
    f('paciente.rh', 'RH', 'lista', HC_TXT.rh) + f('paciente.grupo', 'Grupo sanguíneo', 'lista', { A:'A', B:'B', AB:'AB', O:'O' }) +
    f('paciente.direccion', 'Dirección') + f('paciente.ciudad', 'Ciudad') + f('paciente.telefono', 'Teléfono') +
    f('paciente.estado_civil', 'Estado civil', 'lista', HC_TXT.estado_civil) + f('paciente.ocupacion', 'Ocupación') +
    f('paciente.eps', 'EPS') + f('paciente.arl', 'ARL') + f('paciente.otra_aseguradora', '¿Otra aseguradora?', 'si-no') + f('paciente.aseguradora', 'Otra aseguradora'));
  html += hcGrupo('Contacto de acompañante',
    f('acompanante.tiene', '¿Tiene acompañante?', 'si-no') + f('acompanante.nombre', 'Nombre completo') + f('acompanante.parentesco', 'Parentesco') + f('acompanante.telefono', 'Teléfono'));
  html += hcGrupo('Motivo de consulta', f('motivo.relato', 'Motivo y relato', 'area', null, true));
  html += hcGrupo('Antecedentes',
    f('antecedentes.refiere', '¿Refiere antecedentes?', 'si-no') +
    HC_ANTECEDENTES.map(([k, t]) => f('antecedentes.' + k, t, 'area')).join('') +
    f('antecedentes.gestacion', 'Gestación', 'lista', HC_TXT.gestacion) + f('antecedentes.semanas', 'Semanas de gestación'));
  if(rechazo){
    html += hcGrupo('Consentimiento informado (rechazo)',
      f('consentimiento.motivo_rechazo', 'Motivo del rechazo', 'area', null, true) +
      f('consentimiento.testigo.nombres', 'Nombre del testigo') + f('consentimiento.testigo.apellidos', 'Apellido del testigo') +
      f('consentimiento.testigo.cedula', 'Cédula del testigo') + f('consentimiento.testigo.telefono', 'Teléfono del testigo'));
  } else {
    html += hcGrupo('Valoración primaria ABCDE',
      f('valoracion.via_aerea', 'A. Vía aérea', 'lista', HC_TXT.via_aerea) + f('valoracion.via_aerea_obs', 'Observaciones A') +
      f('valoracion.respiracion', 'B. Respiración', 'lista', HC_TXT.respiracion) + f('valoracion.respiracion_obs', 'Observaciones B') +
      f('valoracion.circulacion', 'C. Circulación', 'lista', HC_TXT.circulacion) + f('valoracion.circulacion_obs', 'Observaciones C') +
      f('valoracion.neuro', 'D. Estado neurológico', 'lista', HC_TXT.neuro) +
      `<div class="form-group"><label>Orientado en</label><div class="hc-checks">${Object.entries(HC_TXT.orientado).map(([k, t]) =>
        `<label><input type="checkbox" data-orientado="${k}"${(d.valoracion.orientado || []).indexOf(k) >= 0 ? ' checked' : ''}> ${t}</label>`).join('')}</div></div>` +
      f('valoracion.exposicion_si', 'E. ¿Hallazgos en la exposición?', 'si-no') + f('valoracion.exposicion', 'Hallazgos de la exposición', 'area', null, true));
    html += hcGrupo('Signos vitales',
      f('signos.hora', 'Hora', 'hora') + f('signos.ta_sis', 'TA sistólica') + f('signos.ta_dia', 'TA diastólica') + f('signos.fc', 'FC') +
      f('signos.fr', 'FR') + f('signos.spo2', 'SpO₂') + f('signos.temp', 'Temperatura') + f('signos.gluco', 'Glucometría') + f('signos.eva', 'Dolor EVA (0-10)'));
    html += hcGrupo('Escala de Glasgow',
      f('glasgow.ocular', 'Respuesta ocular', 'lista', HC_TXT.ocular) + f('glasgow.verbal', 'Respuesta verbal', 'lista', HC_TXT.verbal) + f('glasgow.motora', 'Respuesta motora', 'lista', HC_TXT.motora));
    html += hcGrupo('Examen físico cefalocaudal', HC_SEGMENTOS.map(([k, t]) => f('examen.' + k, t, 'area')).join(''));
    html += hcGrupo('Triage prehospitalario', f('triage', 'Clasificación', 'lista', { I:'I', II:'II', III:'III', IV:'IV', V:'V' }));
    if((d.procedimientos || []).length){
      html += hcGrupo('Procedimientos realizados', d.procedimientos.map((x, i) =>
        f(`procedimientos.${i}.hora`, `Procedimiento ${i + 1}: hora`, 'hora') + f(`procedimientos.${i}.descripcion`, `Procedimiento ${i + 1}`, 'area')).join(''));
    }
    if((d.medicamentos || []).length){
      html += hcGrupo('Medicamentos administrados (el producto y la cantidad se corrigen en el inventario)', d.medicamentos.map((m, i) => m.es_medicamento
        ? `<div class="form-group fg-full hc-ed-med"><strong>${escHtml(m.nombre)}</strong> · ${m.cantidad} ${escHtml(m.unidad || '')}</div>` +
          f(`medicamentos.${i}.dosis`, 'Dosis') + f(`medicamentos.${i}.via`, 'Vía', 'lista', HC_TXT.via) +
          f(`medicamentos.${i}.via_otra`, 'Otra vía (cuál)') + f(`medicamentos.${i}.hora`, 'Hora', 'hora')
        : `<div class="form-group fg-full hc-ed-med"><strong>${escHtml(m.nombre)}</strong> · ${m.cantidad} ${escHtml(m.unidad || '')} · insumo</div>`).join(''));
    }
  }
  html += hcGrupo('Evolución y cierre',
    f('cierre.evolucion', 'Evolución y descripción del servicio', 'area', null, true) +
    f('cierre.condicion', 'Condición final', 'lista', HC_TXT.condicion) +
    (rechazo ? '' : f('cierre.destino', 'Destino', 'lista', Object.fromEntries(Object.entries(HC_TXT.destino).filter(([k]) => k !== 'RECHAZO_ATENCION')))));
  if(!rechazo){
    html += hcGrupo('Datos del traslado (solo si el destino es Traslado asistencial)',
      f('cierre.traslado.destino', 'Destino del traslado') + f('cierre.traslado.ambulancia', 'Tipo de ambulancia', 'lista', HC_TXT.ambulancia) +
      f('cierre.traslado.movil', 'Móvil') + f('cierre.traslado.placa', 'Placa') + f('cierre.traslado.conductor', 'Conductor') + f('cierre.traslado.telefono', 'Teléfono'));
  }
  if(d.entrega){
    html += hcGrupo('Entrega del paciente',
      f('entrega.fecha', 'Fecha', 'fecha') + f('entrega.hora', 'Hora', 'hora') + f('entrega.institucion', 'Institución') +
      f('entrega.servicio', 'Servicio receptor', 'lista', HC_TXT.servicio) + f('entrega.servicio_otro', 'Otro servicio (cuál)') +
      f('entrega.recibe_nombre', 'Nombre de quien recibe') + f('entrega.recibe_cargo', 'Cargo'));
  }
  document.getElementById('hc-editar-num').textContent = _hcActual.consecutivo;
  document.getElementById('hc-editar-form').innerHTML = html;
  document.getElementById('hc-editar-motivo').value = '';
  document.getElementById('modal-hc-editar').classList.add('open');
}

async function hcGuardarEdicion(){
  const motivo = document.getElementById('hc-editar-motivo').value.trim();
  if(motivo.length < 5) return toastError('Escribe el motivo de la corrección');
  const d = JSON.parse(JSON.stringify(_hcActual.datos));
  document.querySelectorAll('#hc-editar-form [data-ruta]').forEach(el => {
    const ruta = el.dataset.ruta;
    hcFijar(d, ruta, el.dataset.tipo === 'bool' ? el.value === 'true' : el.value);
  });
  if(d.valoracion){
    d.valoracion.orientado = [...document.querySelectorAll('#hc-editar-form [data-orientado]')].filter(x => x.checked).map(x => x.dataset.orientado);
  }
  if(d.cierre && d.cierre.destino !== 'TRASLADO' && d.cierre.traslado && !Object.values(d.cierre.traslado).some(Boolean)) d.cierre.traslado = null;
  const btn = document.getElementById('hc-editar-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const r = await HistoriasClinicas.editar(_hcActual.id, d, motivo);
    closeModal('modal-hc-editar');
    toast(`✓ Historia clínica actualizada (${r.cambios} cambio${r.cambios !== 1 ? 's' : ''})`, 'success');
    await hcRecargar();
  } catch(err){ toastError(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
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
  .enc{ display:flex; justify-content:space-between; align-items:flex-start; border:1.5px solid #111; padding:8px 10px; margin-bottom:6px }
  .enc h1{ font-size:14px; margin:0 0 2px } .enc .cod{ text-align:right; font-size:10px }
  .enc .num{ font-size:15px; font-weight:bold }
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
  <div><h1>NOVA BRIDGE SAS</h1><div>HISTORIA CLÍNICA PREHOSPITALARIA</div></div>
  <div class="cod"><div>SIG_08NB_0030</div><div class="num">${escHtml(h.consecutivo)}</div><div>${h.estado === 'abierta' ? 'ABIERTA (pendiente de entrega)' : 'CERRADA'}</div></div>
</div>
${hcHtml(h, true)}
<div class="pie">Generada desde MediStock el ${hcFechaHora(new Date().toISOString())}. Recibida en el servidor el ${hcFechaHora(h.recibida_at)}${(h.cambios || []).length ? ` · ${h.cambios.length} registro(s) en el historial de cambios` : ''}.</div>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
