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
      const deps = (p.bodegas||[]).map(b=>escHtml(b.nombre)).join(', ') || 'sin depósitos';
      return `<div class="evt-personal-row">
        <i class="ti ti-user" style="font-size:12px;color:#888"></i>
        <span><strong>${escHtml(p.nombre)}</strong> — ${deps}</span>
      </div>`;
    }).join('') || '<div class="evt-personal-row" style="color:#aaa">Sin personal asignado</div>';

    const estadoBadge = {
      creado:     '<span class="evt-badge creado">Programado</span>',
      en_curso:   '<span class="evt-badge en_curso">● En curso</span>',
      finalizado: '<span class="evt-badge finalizado">Finalizado</span>'
    }[e.estado] || '';

    let accion = '';
    if(e.estado === 'creado' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px" onclick="event.stopPropagation();iniciarEvento(${e.id})"><i class="ti ti-player-play"></i>Iniciar evento</button>`;
    } else if(e.estado === 'en_curso' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px;background:var(--red2)" onclick="event.stopPropagation();confirmFinalizarEvento(${e.id},'${(e.nombre||'').replace(/'/g,"\\'")}')"><i class="ti ti-player-stop"></i>Finalizar evento</button>`;
    }

    return `<div class="card evt-card" style="margin-bottom:0;cursor:pointer" onclick="abrirDetalleEvento(${e.id})">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--ink)">${escHtml(e.nombre)}</div>
          ${estadoBadge}
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:10px">
          <i class="ti ti-map-pin" style="margin-right:3px"></i>${escHtml(e.ubicacion_nombre||'—')}
        </div>
        <div style="margin-bottom:8px">${personalHTML}</div>
        <div style="font-size:11px;color:#aaa;font-family:var(--font-mono)">
          <i class="ti ti-calendar" style="margin-right:3px"></i>
          ${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)}
        </div>
        ${accion}
      </div>
    </div>`;
  }).join('');
}

// ── CREAR EVENTO (solo datos base) ──
function abrirCrearEvento(){
  document.getElementById('evt-nombre').value = '';
  document.getElementById('evt-fecha-inicio').value = '';
  document.getElementById('evt-fecha-fin').value = '';
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

  try {
    const nuevo = await Eventos.create({ nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id });
    closeModal('modal-crear-evento');
    S.eventos = await Eventos.getAll();
    renderEventos();
    buildNav();
    toast('✓ Evento creado — agrega los enfermeros','success');
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
    document.getElementById('evtdet-ubicacion').innerHTML = S.ubicaciones
      .map(u=>`<option value="${u.id}" ${u.id===evento.ubicacion_id?'selected':''}>${escHtml(u.nombre)}</option>`).join('');
    document.getElementById('evtdet-ubicacion-warn').style.display = 'none';

    document.getElementById('evtdet-enf-input').value = '';
    document.getElementById('evtdet-enf-drop').classList.remove('open');

    evtDetRenderEnfermeros();
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

  try {
    const actualizado = await Eventos.update(id, { nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id });
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

// ── LISTA DE ENFERMEROS DENTRO DEL DETALLE ──
function evtDetRenderEnfermeros(){
  const el = document.getElementById('evtdet-enfermeros-list');
  if(!el) return;
  const personal = _evtDetalleEvento?.personal || [];

  if(!personal.length){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Aún no has agregado enfermeros a este evento</div>';
    return;
  }

  el.innerHTML = personal.map(p => {
    const deps = (p.bodegas||[]).map(b=>escHtml(b.nombre)).join(', ') || '<span style="color:var(--red2)">Sin depósitos asignados</span>';
    return `<div class="user-card" style="margin-bottom:8px">
      <div class="user-avatar n2">${escHtml((p.nombre||'').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase())}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(p.nombre)}</div>
        <div class="user-cedula">${deps}</div>
      </div>
      <div class="act-btn-group">
        <button class="act-btn primary" title="Editar depósitos" onclick="evtAbrirAsignarDepositos(${p.id},'${(p.nombre||'').replace(/'/g,"\\'")}')"><i class="ti ti-building-warehouse"></i></button>
        <button class="act-btn danger" title="Quitar del evento" onclick="evtDetEnfRemove(${p.id},'${(p.nombre||'').replace(/'/g,"\\'")}')"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

// ── AUTOCOMPLETE PARA AGREGAR ENFERMERO ──
function evtDetEnfFilter(){
  const drop = document.getElementById('evtdet-enf-drop');
  const q = (document.getElementById('evtdet-enf-input').value||'').toLowerCase().trim();
  const yaAsignados = new Set((_evtDetalleEvento?.personal||[]).map(p=>p.id));
  const pool = (S.usuarios||[]).filter(u => u.nivel === 2 && !yaAsignados.has(u.id));
  const results = pool.filter(u => !q || u.nombre.toLowerCase().includes(q)).slice(0, 8);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results">Sin enfermeros disponibles</div>';
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map(u => `
    <div class="ac-item" onmousedown="evtDetEnfSelect(${u.id},'${(u.nombre||'').replace(/'/g,"\\'")}')">
      <div class="ac-item-icon"><i class="ti ti-stethoscope"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta">CC: ${escHtml(u.cedula||'')}</div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

async function evtDetEnfSelect(usuarioId, nombre){
  document.getElementById('evtdet-enf-input').value = '';
  document.getElementById('evtdet-enf-drop').classList.remove('open');
  try {
    await Eventos.addEnfermero(_evtDetalleId, { usuario_id: usuarioId, bodega_ids: [] });
    _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
    evtDetRenderEnfermeros();
    S.eventos = await Eventos.getAll();
    renderEventos();
    toast(`✓ ${nombre} agregado — asígnale sus depósitos`,'success');
    evtAbrirAsignarDepositos(usuarioId, nombre);
  } catch(err){
    toastError(err.message);
  }
}

function evtDetEnfRemove(usuarioId, nombre){
  document.getElementById('modal-title').textContent = 'Quitar enfermero';
  document.getElementById('modal-sub').textContent = `¿Quitar a "${nombre}" de este evento? Perderá acceso a sus depósitos de inmediato.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Eventos.removeEnfermero(_evtDetalleId, usuarioId);
      closeModal('modal-confirm');
      _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
      evtDetRenderEnfermeros();
      S.eventos = await Eventos.getAll();
      renderEventos();
      buildNav();
      toast('Enfermero removido del evento');
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
  _evtAsignarUsuarioId = usuarioId;
  const persona = (_evtDetalleEvento?.personal||[]).find(p=>p.id===usuarioId);
  _evtAsignarSeleccion = new Set((persona?.bodegas||[]).map(b=>b.id));

  document.getElementById('evtasig-usuario-id').value = usuarioId;
  document.getElementById('evtasig-sub').textContent = `Selecciona los depósitos que puede usar ${nombre} durante este evento.`;

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
    await Eventos.updateEnfermero(_evtDetalleId, _evtAsignarUsuarioId, { bodega_ids: [..._evtAsignarSeleccion] });
    closeModal('modal-asignar-depositos');
    _evtDetalleEvento = await Eventos.getOne(_evtDetalleId);
    evtDetRenderEnfermeros();
    S.eventos = await Eventos.getAll();
    renderEventos();
    toast('✓ Depósitos actualizados','success');
  } catch(err){
    toastError(err.message);
  }
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
  document.getElementById('modal-sub').textContent = `¿Finalizar el evento "${nombre}"? Los enfermeros asignados perderán acceso a sus depósitos de este evento de inmediato.`;
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