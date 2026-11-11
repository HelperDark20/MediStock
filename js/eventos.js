// ══════════════════════════════════════════
// EVENTOS
//
// Flujo:
//   1. Crear evento → solo nombre, fechas y ubicación (sin enfermeros).
//   2. Click en la tarjeta del evento → abre el detalle, donde se edita
//      el evento y se gestiona la lista de enfermeros asignados.
//   3. Cada enfermero de la lista tiene botón para editar sus depósitos
//      (abre una interfaz aparte con checklist + botón Guardar) y botón
//      para eliminarlo del evento.
// ══════════════════════════════════════════

let _evtDetalleId = null;
let _evtDetalleEvento = null;       // último evento cargado en el modal de detalle
let _evtAsignarUsuarioId = null;
let _evtAsignarSeleccion = new Set();

// ── RENDER GRID DE EVENTOS ──
function renderEventos(){
  const el = document.getElementById('eventos-grid');
  if(!el) return;

  if(!S.eventos || !S.eventos.length){
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="ti ti-calendar-event"></i>
      <p>Sin eventos registrados</p>
    </div>`;
    return;
  }

  el.innerHTML = S.eventos.map(e => {
    const personalHTML = (e.personal||[]).map(p => {
      const deps = p.bodegas||[];
      const visibles = deps.slice(0,2).map(b=>`<span class="evt-dep-chip">${escHtml(b.nombre)}</span>`).join('');
      const extra = deps.length>2 ? `<span class="evt-dep-chip more">+${deps.length-2}</span>` : '';
      // El médico no maneja depósitos: se muestra su rol en lugar de "sin depósitos"
      const depsHtml = p.es_medico ? '<span class="evt-dep-chip">Médico</span>'
        : deps.length ? visibles+extra : '<span class="evt-dep-chip empty">sin depósitos</span>';
      return `<div class="evt-personal-row">
        <img class="evt-persona-foto" src="${avatarNivel(p.nivel || (p.es_medico ? 1 : 2))}" alt="">
        <div class="evt-personal-body">
          <div class="evt-personal-name">${escHtml(p.nombre)}</div>
          <div class="evt-personal-deps">${depsHtml}</div>
        </div>
      </div>`;
    }).join('') || '<div class="evt-personal-row" style="color:#aaa">Sin personal asignado</div>';

    const estadoBadge = {
      creado:     '<span class="evt-badge creado"><img src="img/iconos/estado-programado.svg" alt="">Programado</span>',
      en_curso:   '<span class="evt-badge en_curso"><img src="img/iconos/estado-en-curso.svg" alt="">En curso</span>',
      finalizado: '<span class="evt-badge finalizado"><img src="img/iconos/estado-finalizado.svg" alt="">Finalizado</span>'
    }[e.estado] || '';

    // Puntero de la ubicación del evento: el de sede o el de temporal
    const ubEvt = (S.ubicaciones||[]).find(u => u.id === e.ubicacion_id);
    const puntero = ubEvt && ubEvt.es_temporal ? 'temporales' : 'ubicacion';

    let accion = '';
    if(e.estado === 'creado' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px" onclick="event.stopPropagation();iniciarEvento(${e.id})"><img class="btn-ico" src="img/iconos/iniciar-evento.svg" alt="">Iniciar evento</button>`;
    } else if(e.estado === 'en_curso' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px;background:var(--red2)" onclick="event.stopPropagation();confirmFinalizarEvento(${e.id},${jsArg(e.nombre)})"><img class="btn-ico" src="img/iconos/finalizar-evento.svg" alt="">Finalizar evento</button>`;
    }

    return `<div class="card evt-card" style="margin-bottom:0;cursor:pointer" onclick="abrirDetalleEvento(${e.id})">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--ink)">${escHtml(e.nombre)}</div>
          ${estadoBadge}
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:10px">
          <img class="evt-mini-ico" src="img/iconos/${puntero}.svg" alt="">${escHtml(e.ubicacion_nombre||'—')}
        </div>
        <div style="margin-bottom:8px">${personalHTML}</div>
        <div style="font-size:11px;color:#aaa;font-family:var(--font-mono)">
          <img class="evt-mini-ico" src="img/iconos/mes.svg" alt="">
          ${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)}${e.hora_inicio ? ` · ${e.hora_inicio}–${e.hora_fin}` : ''}
        </div>
        ${accion}
      </div>
    </div>`;
  }).join('');
}

// ── HORA DEL EVENTO: se escribe en 12 o 24 horas y queda en 24 h ──
// 13 a 23 → p. m. sin preguntar · 00 → a. m. · 1 a 12 → pregunta a. m. o p. m.
// También acepta "6:00 pm", "6pm", "0600". El valor queda en data-valor (HH:MM).
const _pad2 = n => String(n).padStart(2, '0');
function _evtHora12(h, m){ return `${h % 12 || 12}:${_pad2(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`; }
function _evtHoraParse(txt){
  const t = String(txt || '').toLowerCase().replace(/[\s.]/g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if(!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if(h > 23 || mi > 59) return null;
  if(m[3] && (h < 1 || h > 12)) return null;
  return { h, mi, ampm: m[3] ? m[3][0] : '' };
}
function evtHoraFijar(id, h, mi, normalizar){
  const el = document.getElementById(id), v = `${_pad2(h)}:${_pad2(mi)}`;
  el.dataset.valor = v;
  if(normalizar) el.value = v;
  document.getElementById(id + '-ayuda').innerHTML = `<span class="evt-hora-ok">✓ ${_evtHora12(h, mi)} (${v})</span>`;
}
function evtHoraEscribir(id, alSalir){
  const el = document.getElementById(id), ayuda = document.getElementById(id + '-ayuda');
  el.dataset.valor = '';
  if(!el.value.trim()){ ayuda.innerHTML = ''; return; }
  const p = _evtHoraParse(el.value);
  if(!p){ ayuda.innerHTML = alSalir ? '<span class="evt-hora-error">Escribe la hora así: 18:00 o 6:00 pm</span>' : ''; return; }
  if(p.ampm) return evtHoraFijar(id, p.ampm === 'p' ? (p.h % 12) + 12 : p.h % 12, p.mi, alSalir);
  if(p.h >= 13 || p.h === 0) return evtHoraFijar(id, p.h, p.mi, alSalir);
  // 1 a 12: ¿mañana o tarde/noche?
  ayuda.innerHTML = `<span class="evt-hora-preg">¿${p.h}:${_pad2(p.mi)} de la mañana o de la tarde/noche?</span>
    <button type="button" class="evt-ampm" onmousedown="event.preventDefault()" onclick="evtHoraFijar('${id}', ${p.h % 12}, ${p.mi}, true)">a. m.</button>
    <button type="button" class="evt-ampm" onmousedown="event.preventDefault()" onclick="evtHoraFijar('${id}', ${(p.h % 12) + 12}, ${p.mi}, true)">p. m.</button>`;
}
function evtHoraCargar(id, v){
  const el = document.getElementById(id);
  el.value = v || ''; el.dataset.valor = '';
  document.getElementById(id + '-ayuda').innerHTML = '';
  if(/^\d\d:\d\d$/.test(v || '')) evtHoraFijar(id, +v.slice(0, 2), +v.slice(3), true);
}
function _evtHorasDe(p){
  const hi = document.getElementById(p + '-hora-inicio').dataset.valor, hf = document.getElementById(p + '-hora-fin').dataset.valor;
  if(!hi || !hf) return { error: 'Indica la hora de inicio y la hora final del evento (si es de 1 a 12, elige a. m. o p. m.)' };
  if(hi === hf) return { error: 'La hora final debe ser distinta a la de inicio' };
  return { hora_inicio: hi, hora_fin: hf };
}

// ── CREAR EVENTO (solo datos base) ──
function abrirCrearEvento(){
  document.getElementById('evt-nombre').value = '';
  document.getElementById('evt-fecha-inicio').value = '';
  document.getElementById('evt-fecha-fin').value = '';
  evtHoraCargar('evt-hora-inicio', ''); evtHoraCargar('evt-hora-fin', '');
  document.getElementById('evt-ubicacion').innerHTML = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  document.getElementById('modal-crear-evento').classList.add('open');
}

async function crearEvento(){
  const nombre       = document.getElementById('evt-nombre').value.trim();
  const fechaInicio  = document.getElementById('evt-fecha-inicio').value;
  const fechaFin     = document.getElementById('evt-fecha-fin').value;
  const ubicacion_id = parseInt(document.getElementById('evt-ubicacion').value)||0;

  if(!nombre){ toastError('Ingresa el nombre del evento'); return; }
  if(!fechaInicio || !fechaFin){ toastError('Ingresa las fechas del evento'); return; }
  if(fechaFin < fechaInicio){ toastError('La fecha de finalización no puede ser anterior a la de inicio'); return; }
  if(!ubicacion_id){ toastError('Selecciona la ubicación del evento'); return; }
  const horas = _evtHorasDe('evt');
  if(horas.error){ toastError(horas.error); return; }

  try {
    const nuevo = await Eventos.create({ nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id, ...horas });
    closeModal('modal-crear-evento');
    S.eventos = await Eventos.getAll();
    renderEventos();
    buildNav();
    toast('✓ Evento creado — agrega el personal','success');
    abrirDetalleEvento(nuevo.id);
  } catch(err){
    toastError(err.message);
  }
}

// ── DETALLE DE EVENTO (editar datos + gestionar enfermeros) ──
async function abrirDetalleEvento(id){
  if(currentRole !== 4) return;
  try {
    const evento = await Eventos.getOne(id);
    _evtDetalleId = id;
    _evtDetalleEvento = evento;

    document.getElementById('evtdet-id').value = evento.id;
    document.getElementById('evtdet-nombre').value = evento.nombre;
    document.getElementById('evtdet-fecha-inicio').value = (evento.fecha_inicio||'').split('T')[0];
    document.getElementById('evtdet-fecha-fin').value = (evento.fecha_fin||'').split('T')[0];
    evtHoraCargar('evtdet-hora-inicio', evento.hora_inicio); evtHoraCargar('evtdet-hora-fin', evento.hora_fin);
    document.getElementById('evtdet-ubicacion').innerHTML = S.ubicaciones
      .map(u=>`<option value="${u.id}" ${u.id===evento.ubicacion_id?'selected':''}>${escHtml(u.nombre)}</option>`).join('');
    document.getElementById('evtdet-ubicacion-warn').style.display = 'none';

    document.getElementById('evtdet-enf-input').value = '';
    document.getElementById('evtdet-enf-drop').classList.remove('open');

    evtDetRenderEnfermeros();
    // Un evento en curso no se puede eliminar (primero hay que finalizarlo)
    document.getElementById('evtdet-eliminar-btn').style.display = evento.estado === 'en_curso' ? 'none' : '';
    document.getElementById('modal-evento-detalle').classList.add('open');
  } catch(err){
    toastError(err.message);
  }
}

function evtDetUbicacionChanged(){
  const nuevaId = parseInt(document.getElementById('evtdet-ubicacion').value)||0;
  const warn = document.getElementById('evtdet-ubicacion-warn');
  const cambia = _evtDetalleEvento && nuevaId !== _evtDetalleEvento.ubicacion_id;
  warn.style.display = (cambia && (_evtDetalleEvento.personal||[]).length) ? 'block' : 'none';
}

async function guardarDetalleEvento(){
  const id = _evtDetalleId;
  const nombre = document.getElementById('evtdet-nombre').value.trim();
  const fechaInicio = document.getElementById('evtdet-fecha-inicio').value;
  const fechaFin = document.getElementById('evtdet-fecha-fin').value;
  const ubicacion_id = parseInt(document.getElementById('evtdet-ubicacion').value)||0;

  if(!nombre){ toastError('Ingresa el nombre del evento'); return; }
  if(!fechaInicio || !fechaFin){ toastError('Ingresa las fechas del evento'); return; }
  if(fechaFin < fechaInicio){ toastError('La fecha de finalización no puede ser anterior a la de inicio'); return; }
  if(!ubicacion_id){ toastError('Selecciona la ubicación del evento'); return; }
  const horas = _evtHorasDe('evtdet');
  if(horas.error){ toastError(horas.error); return; }

  try {
    const actualizado = await Eventos.update(id, { nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id, ...horas });
    S.eventos = await Eventos.getAll();
    renderEventos();
    toast(actualizado.bodegas_reiniciadas
      ? '✓ Evento actualizado — se reiniciaron los depósitos por el cambio de ubicación'
      : '✓ Evento actualizado', 'success');
    await abrirDetalleEvento(id);
  } catch(err){
    toastError(err.message);
  }
}

// ── LISTA DEL PERSONAL (ENFERMEROS Y MÉDICOS) DENTRO DEL DETALLE ──
// Los médicos (nivel 1) no tienen depósitos: solo se asignan para la
// historia clínica (responsable de la atención y firma). Van primero.
function evtDetRenderEnfermeros(){
  const el = document.getElementById('evtdet-enfermeros-list');
  if(!el) return;
  const personal = (_evtDetalleEvento?.personal || []).slice()
    .sort((a, b) => (b.es_medico ? 1 : 0) - (a.es_medico ? 1 : 0));

  if(!personal.length){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Aún no has agregado personal a este evento</div>';
    return;
  }
  const hayMedico = personal.some(p => p.es_medico);

  el.innerHTML = (hayMedico ? '' : `<div style="font-size:12px;color:#B45309;padding:0 0 8px"><i class="ti ti-alert-triangle"></i> Este evento no tiene médico asignado: las historias clínicas saldrán sin médico responsable.</div>`) +
    personal.map(p => {
    const detalle = p.es_medico
      ? `Médico · Cédula / RP: ${escHtml(p.cedula || '')}`
      : ((p.bodegas||[]).map(b=>escHtml(b.nombre)).join(', ') || '<span style="color:var(--red2)">Sin depósitos asignados</span>') +
        `<br>${p.ubicacion ? 'Ubicación: ' + escHtml(p.ubicacion) : '<span style="color:var(--red2)">Sin ubicación asignada</span>'}`;
    return `<div class="user-card" style="margin-bottom:8px">
      <div class="user-avatar foto"><img src="${avatarNivel(p.nivel || (p.es_medico ? 1 : 2))}" alt=""></div>
      <div class="user-info">
        <div class="user-name">${escHtml(p.nombre)}</div>
        <div class="user-cedula">${detalle}</div>
      </div>
      <div class="act-btn-group">
        ${p.es_medico ? '' : `<button class="act-btn primary" title="Editar depósitos y ubicación" onclick="evtAbrirAsignarDepositos(${p.id},${jsArg(p.nombre)})"><i class="ti ti-building-warehouse"></i></button>`}
        <button class="act-btn danger" title="Quitar del evento" onclick="evtDetEnfRemove(${p.id},${jsArg(p.nombre)})"><img class="btn-ico" src="img/iconos/eliminar.svg" alt=""></button>
      </div>
    </div>`;
  }).join('');
}

// ── AUTOCOMPLETE PARA AGREGAR PERSONAL (enfermeros y médicos) ──
function evtDetEnfFilter(){
  const drop = document.getElementById('evtdet-enf-drop');
  const q = (document.getElementById('evtdet-enf-input').value||'').toLowerCase().trim();
  const yaAsignados = new Set((_evtDetalleEvento?.personal||[]).map(p=>p.id));
  const pool = (S.usuarios||[]).filter(u => (u.nivel === 2 || u.nivel === 1) && !yaAsignados.has(u.id));
  const results = pool.filter(u => !q || u.nombre.toLowerCase().includes(q) || String(u.cedula||'').includes(q)).slice(0, 8);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results">Sin enfermeros ni médicos disponibles</div>';
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map(u => `
    <div class="ac-item" onmousedown="evtDetEnfSelect(${u.id},${jsArg(u.nombre)},${u.nivel === 1})">
      <div class="ac-item-icon"><i class="ti ${u.nivel === 1 ? 'ti-stethoscope' : 'ti-user'}"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta"><span>${u.nivel === 1 ? 'Médico' : 'Enfermero/a'}</span><span>CC: ${escHtml(u.cedula||'')}</span></div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

async function evtDetEnfSelect(usuarioId, nombre, esMedico){
  document.getElementById('evtdet-enf-input').value = '';
  document.getElementById('evtdet-enf-drop').classList.remove('open');
  try {
    await Eventos.addEnfermero(_evtDetalleId, { usuario_id: usuarioId, bodega_ids: [] });
    _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
    evtDetRenderEnfermeros();
    S.eventos = await Eventos.getAll();
    renderEventos();
    if(esMedico){
      toast(`✓ ${nombre} agregado como médico del evento`,'success');
      return;
    }
    toast(`✓ ${nombre} agregado — asígnale sus depósitos`,'success');
    evtAbrirAsignarDepositos(usuarioId, nombre);
  } catch(err){
    toastError(err.message);
  }
}

function evtDetEnfRemove(usuarioId, nombre){
  const persona = (_evtDetalleEvento?.personal||[]).find(p => p.id === usuarioId);
  document.getElementById('modal-title').textContent = persona?.es_medico ? 'Quitar médico' : 'Quitar enfermero';
  document.getElementById('modal-sub').textContent = persona?.es_medico
    ? `¿Quitar a "${nombre}" de este evento? Las historias clínicas nuevas ya no lo tendrán como médico responsable.`
    : `¿Quitar a "${nombre}" de este evento? Perderá acceso a sus depósitos de inmediato.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Eventos.removeEnfermero(_evtDetalleId, usuarioId);
      closeModal('modal-confirm');
      _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
      evtDetRenderEnfermeros();
      S.eventos = await Eventos.getAll();
      renderEventos();
      buildNav();
      toast(`${nombre} removido del evento`);
    } catch(err){ toastError(err.message); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

document.addEventListener('click', e=>{
  const wrap = document.getElementById('evtdet-enf-wrap');
  if(wrap && !wrap.contains(e.target)) document.getElementById('evtdet-enf-drop')?.classList.remove('open');
});

// ── ASIGNAR DEPÓSITOS A UN ENFERMERO (interfaz independiente) ──
function evtAbrirAsignarDepositos(usuarioId, nombre){
  document.getElementById('modal-evento-detalle').classList.remove('open');
  _evtAsignarUsuarioId = usuarioId;
  const persona = (_evtDetalleEvento?.personal||[]).find(p=>p.id===usuarioId);
  _evtAsignarSeleccion = new Set((persona?.bodegas||[]).map(b=>b.id));

  document.getElementById('evtasig-usuario-id').value = usuarioId;
  document.getElementById('evtasig-sub').textContent = `Selecciona los depósitos que puede usar ${nombre} durante este evento y dónde estará.`;
  document.getElementById('evtasig-ubicacion').value = (persona && persona.ubicacion) || '';

  const depositos = (S.bodegasRaw||[]).filter(b => b.ubicacion_id === _evtDetalleEvento.ubicacion_id);
  const checklist = document.getElementById('evtasig-checklist');

  checklist.innerHTML = depositos.length
    ? depositos.map(b => `
      <label class="evt-check-item">
        <input type="checkbox" ${_evtAsignarSeleccion.has(b.id)?'checked':''}
          onchange="evtToggleDeposito(${b.id}, this.checked)">
        <span>${escHtml(b.nombre)}</span>
      </label>`).join('')
    : '<div style="font-size:12px;color:#aaa;padding:8px 0">Esta ubicación no tiene depósitos registrados</div>';

  document.getElementById('modal-asignar-depositos').classList.add('open');
}

function evtToggleDeposito(bodegaId, checked){
  if(checked) _evtAsignarSeleccion.add(bodegaId);
  else _evtAsignarSeleccion.delete(bodegaId);
}

async function evtGuardarAsignacion(){
  try {
    const ubicacion = document.getElementById('evtasig-ubicacion').value.trim();
    if(ubicacion.length < 2){ toastError('Escribe la ubicación del enfermero dentro del evento'); return; }
    await Eventos.updateEnfermero(_evtDetalleId, _evtAsignarUsuarioId, { bodega_ids: [..._evtAsignarSeleccion], ubicacion });
    closeModal('modal-asignar-depositos');
    _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
    evtDetRenderEnfermeros();
    S.eventos = await Eventos.getAll();
    renderEventos();
    document.getElementById('modal-evento-detalle').classList.add('open');
    toast('✓ Depósitos y ubicación guardados','success');
  } catch(err){
    toastError(err.message);
    document.getElementById('modal-evento-detalle').classList.add('open');
  }
}

function evtCancelarAsignacion(){
  closeModal('modal-asignar-depositos');
  document.getElementById('modal-evento-detalle').classList.add('open');
}

// ── ELIMINAR EVENTO ──
// Es un borrado suave (activo = false): el evento desaparece de la lista
// pero el registro queda en la base de datos. Los movimientos no dependen
// de los eventos, así que reportes, stock y trazabilidad no cambian.
function confirmEliminarEvento(){
  const evento = _evtDetalleEvento;
  if(!evento) return;
  const nPersonal = (evento.personal||[]).length;
  document.getElementById('modal-title').textContent = 'Eliminar evento';
  document.getElementById('modal-sub').textContent =
    `¿Eliminar el evento "${evento.nombre}"?` +
    (nPersonal ? ` Se quitará la asignación de ${nPersonal} persona${nPersonal!==1?'s':''} del personal.` : '') +
    ' Los consumos ya registrados y los reportes no se verán afectados.';
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Eventos.delete(evento.id);
      closeModal('modal-confirm');
      closeModal('modal-evento-detalle');
      _evtDetalleId = null;
      _evtDetalleEvento = null;
      S.eventos = await Eventos.getAll();
      renderEventos();
      buildNav();
      toast('Evento eliminado');
    } catch(err){ toastError(err.message); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── INICIAR / FINALIZAR ──
async function iniciarEvento(id){
  try {
    await Eventos.iniciar(id);
    S.eventos = await Eventos.getAll();
    renderEventos();
    buildNav();
    toast('✓ Evento iniciado — los enfermeros asignados ya pueden operar','success');
  } catch(err){ toastError(err.message); }
}

function confirmFinalizarEvento(id, nombre){
  document.getElementById('modal-title').textContent = 'Finalizar evento';
  document.getElementById('modal-sub').textContent = `¿Finalizar el evento "${nombre}"? Los enfermeros asignados perderán acceso a sus depósitos de este evento de inmediato. En Asistencias, el personal cargado que no marcó ningún turno quedará como "No asistió".`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Eventos.finalizar(id);
      closeModal('modal-confirm');
      S.eventos = await Eventos.getAll();
      renderEventos();
      buildNav();
      toast('Evento finalizado');
    } catch(err){ toastError(err.message); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}