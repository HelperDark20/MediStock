// ══════════════════════════════════════════
// EVENTOS — asignación temporal de enfermeros a depósitos
//
// Reemplaza la lógica anterior de "ubicación fija asignada al usuario".
// Ahora el Administrador crea un Evento (nombre, fechas, ubicación,
// depósitos habilitados y enfermeros asignados). Mientras el evento
// esté "en_curso", esos enfermeros solo pueden operar sobre los
// depósitos del evento. Al finalizar, vuelven a estado neutro (sin
// depósitos habilitados) hasta que se les asigne un nuevo evento.
// ══════════════════════════════════════════

let _evtBodegasSeleccionadas = new Set();
let _evtEnfermerosSeleccionados = new Map(); // id -> nombre

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
    const personal = (e.personal||[]).map(p=>escHtml(p.nombre)).join(', ') || 'Sin personal asignado';
    const estadoBadge = {
      creado:     '<span class="evt-badge creado">Programado</span>',
      en_curso:   '<span class="evt-badge en_curso">● En curso</span>',
      finalizado: '<span class="evt-badge finalizado">Finalizado</span>'
    }[e.estado] || '';

    let accion = '';
    if(e.estado === 'creado' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px" onclick="iniciarEvento(${e.id})"><i class="ti ti-player-play"></i>Iniciar evento</button>`;
    } else if(e.estado === 'en_curso' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px;background:var(--red2)" onclick="confirmFinalizarEvento(${e.id},'${(e.nombre||'').replace(/'/g,"\\'")}')"><i class="ti ti-player-stop"></i>Finalizar evento</button>`;
    }

    return `<div class="card evt-card" style="margin-bottom:0">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--ink)">${escHtml(e.nombre)}</div>
          ${estadoBadge}
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:10px">
          <i class="ti ti-map-pin" style="margin-right:3px"></i>${escHtml(e.ubicacion_nombre||'—')}
        </div>
        <div style="font-size:12px;color:#666;margin-bottom:6px;line-height:1.5">
          <i class="ti ti-users" style="margin-right:3px"></i>${personal}
        </div>
        <div style="font-size:11px;color:#aaa;font-family:var(--font-mono)">
          <i class="ti ti-calendar" style="margin-right:3px"></i>
          ${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)}
        </div>
        ${accion}
      </div>
    </div>`;
  }).join('');
}

// ── ABRIR MODAL CREAR EVENTO ──
function abrirCrearEvento(){
  document.getElementById('evt-nombre').value = '';
  document.getElementById('evt-fecha-inicio').value = '';
  document.getElementById('evt-fecha-fin').value = '';
  document.getElementById('evt-ubicacion').innerHTML = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  document.getElementById('evt-bodegas-list').innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Selecciona una ubicación primero</div>';
  document.getElementById('evt-enf-input').value = '';
  document.getElementById('evt-enf-chips').innerHTML = '';
  document.getElementById('evt-enf-drop').classList.remove('open');
  _evtBodegasSeleccionadas = new Set();
  _evtEnfermerosSeleccionados = new Map();
  document.getElementById('modal-crear-evento').classList.add('open');
}

// ── DEPÓSITOS SEGÚN UBICACIÓN SELECCIONADA ──
function evtUbicacionChange(){
  const ubId = parseInt(document.getElementById('evt-ubicacion').value)||0;
  const el = document.getElementById('evt-bodegas-list');
  _evtBodegasSeleccionadas = new Set();

  if(!ubId){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Selecciona una ubicación primero</div>';
    return;
  }

  const bodegas = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===ubId);
  if(!bodegas.length){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Esta ubicación no tiene depósitos registrados</div>';
    return;
  }

  el.innerHTML = bodegas.map(b => `
    <label class="evt-check-item">
      <input type="checkbox" onchange="evtToggleBodega(${b.id}, this.checked)">
      <span>${escHtml(b.nombre)}</span>
    </label>`).join('');
}

function evtToggleBodega(id, checked){
  if(checked) _evtBodegasSeleccionadas.add(id);
  else _evtBodegasSeleccionadas.delete(id);
}

// ── AUTOCOMPLETE DE ENFERMEROS ──
function evtEnfFilter(){
  const q = (document.getElementById('evt-enf-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('evt-enf-drop');

  const pool = (S.usuarios||[]).filter(u => u.nivel === 2 && !_evtEnfermerosSeleccionados.has(u.id));
  const results = pool.filter(u => !q || u.nombre.toLowerCase().includes(q)).slice(0, 8);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results">Sin enfermeros disponibles</div>';
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map(u => `
    <div class="ac-item" onmousedown="evtEnfSelect(${u.id},'${(u.nombre||'').replace(/'/g,"\\'")}')">
      <div class="ac-item-icon"><i class="ti ti-stethoscope"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta">CC: ${escHtml(u.cedula||'')}</div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function evtEnfSelect(id, nombre){
  _evtEnfermerosSeleccionados.set(id, nombre);
  document.getElementById('evt-enf-input').value = '';
  document.getElementById('evt-enf-drop').classList.remove('open');
  evtRenderChips();
}

function evtRenderChips(){
  const el = document.getElementById('evt-enf-chips');
  el.innerHTML = [..._evtEnfermerosSeleccionados.entries()].map(([id, nombre]) => `
    <span class="dash-chip active" style="cursor:default">
      ${escHtml(nombre)}
      <i class="ti ti-x" style="margin-left:6px;cursor:pointer" onclick="evtEnfRemove(${id})"></i>
    </span>`).join('');
}

function evtEnfRemove(id){
  _evtEnfermerosSeleccionados.delete(id);
  evtRenderChips();
}

document.addEventListener('click', e=>{
  const wrap = document.getElementById('evt-enf-wrap');
  if(wrap && !wrap.contains(e.target)) document.getElementById('evt-enf-drop')?.classList.remove('open');
});

// ── CREAR EVENTO ──
async function crearEvento(){
  const nombre       = document.getElementById('evt-nombre').value.trim();
  const fechaInicio  = document.getElementById('evt-fecha-inicio').value;
  const fechaFin     = document.getElementById('evt-fecha-fin').value;
  const ubicacion_id = parseInt(document.getElementById('evt-ubicacion').value)||0;
  const usuario_ids  = [..._evtEnfermerosSeleccionados.keys()];
  const bodega_ids   = [..._evtBodegasSeleccionadas];

  if(!nombre){ toastError('Ingresa el nombre del evento'); return; }
  if(!fechaInicio || !fechaFin){ toastError('Ingresa las fechas del evento'); return; }
  if(fechaFin < fechaInicio){ toastError('La fecha de finalización no puede ser anterior a la de inicio'); return; }
  if(!ubicacion_id){ toastError('Selecciona la ubicación del evento'); return; }
  if(!bodega_ids.length){ toastError('Selecciona al menos un depósito'); return; }
  if(!usuario_ids.length){ toastError('Selecciona al menos un enfermero'); return; }

  try {
    await Eventos.create({ nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id, usuario_ids, bodega_ids });
    closeModal('modal-crear-evento');
    S.eventos = await Eventos.getAll();
    renderEventos();
    buildNav();
    toast('✓ Evento creado','success');
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
  document.getElementById('modal-sub').textContent = `¿Finalizar el evento "${nombre}"? Los enfermeros asignados perderán acceso a los depósitos de este evento de inmediato.`;
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
