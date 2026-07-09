// ══════════════════════════════════════════
// EVENTOS — asignación temporal de depósitos POR ENFERMERO
//
// Dentro de un mismo evento, cada enfermero puede tener un subconjunto
// distinto de depósitos (ej: enfermero A usa BTQ-I 13 AC, enfermero B
// usa MEC-A 4 MED). El flujo es:
//   1. El admin elige la ubicación → se carga el pool de depósitos
//      disponibles en esa sede.
//   2. El admin busca y agrega enfermeros uno por uno.
//   3. Por cada enfermero agregado aparece su propio checklist de
//      depósitos (tomado del pool), y el admin marca solo los que
//      ese enfermero puede usar.
// ══════════════════════════════════════════

let _evtDepositosDisponibles = []; // bodegas de la ubicación seleccionada
let _evtEnfermeros = new Map();    // usuarioId -> { nombre, bodegas: Set(bodegaId) }

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

// ── ABRIR MODAL CREAR EVENTO ──
function abrirCrearEvento(){
  document.getElementById('evt-nombre').value = '';
  document.getElementById('evt-fecha-inicio').value = '';
  document.getElementById('evt-fecha-fin').value = '';
  document.getElementById('evt-ubicacion').innerHTML = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  document.getElementById('evt-enf-input').value = '';
  document.getElementById('evt-enf-drop').classList.remove('open');
  _evtDepositosDisponibles = [];
  _evtEnfermeros = new Map();
  evtRenderEnfermeros();
  document.getElementById('modal-crear-evento').classList.add('open');
}

// ── AL CAMBIAR LA UBICACIÓN: cargar pool de depósitos disponibles ──
function evtUbicacionChange(){
  const ubId = parseInt(document.getElementById('evt-ubicacion').value)||0;
  const habiaEnfermeros = _evtEnfermeros.size > 0;

  _evtDepositosDisponibles = ubId
    ? (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===ubId)
    : [];

  // Los depósitos ya no aplican si cambia la sede — se reinicia la selección
  // de enfermeros para evitar dejar depósitos de otra ubicación asignados.
  _evtEnfermeros = new Map();
  evtRenderEnfermeros();

  if(habiaEnfermeros){
    toast('Se reinició la selección de enfermeros al cambiar la ubicación','error');
  }
}

// ── AUTOCOMPLETE DE ENFERMEROS ──
function evtEnfFilter(){
  const ubId = parseInt(document.getElementById('evt-ubicacion').value)||0;
  const drop = document.getElementById('evt-enf-drop');

  if(!ubId){
    drop.innerHTML = '<div class="ac-no-results">Selecciona primero la ubicación del evento</div>';
    drop.classList.add('open');
    return;
  }

  const q = (document.getElementById('evt-enf-input').value||'').toLowerCase().trim();
  const pool = (S.usuarios||[]).filter(u => u.nivel === 2 && !_evtEnfermeros.has(u.id));
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
  if(!_evtDepositosDisponibles.length){
    toastError('Selecciona primero la ubicación del evento');
    return;
  }
  _evtEnfermeros.set(id, { nombre, bodegas: new Set() });
  document.getElementById('evt-enf-input').value = '';
  document.getElementById('evt-enf-drop').classList.remove('open');
  evtRenderEnfermeros();
}

function evtEnfRemove(id){
  _evtEnfermeros.delete(id);
  evtRenderEnfermeros();
}

function evtToggleBodegaEnf(usuarioId, bodegaId, checked){
  const data = _evtEnfermeros.get(usuarioId);
  if(!data) return;
  if(checked) data.bodegas.add(bodegaId);
  else data.bodegas.delete(bodegaId);
}

// ── RENDER: una tarjeta por enfermero con SU checklist de depósitos ──
function evtRenderEnfermeros(){
  const el = document.getElementById('evt-enfermeros-list');
  if(!el) return;

  if(!_evtDepositosDisponibles.length){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Selecciona la ubicación del evento para poder agregar enfermeros</div>';
    return;
  }

  if(!_evtEnfermeros.size){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Aún no has agregado enfermeros a este evento</div>';
    return;
  }

  el.innerHTML = [..._evtEnfermeros.entries()].map(([usuarioId, data]) => `
    <div class="evt-enf-card">
      <div class="evt-enf-card-header">
        <span><i class="ti ti-stethoscope" style="margin-right:6px;color:var(--blue)"></i>${escHtml(data.nombre)}</span>
        <i class="ti ti-x" style="cursor:pointer;color:#aaa" onclick="evtEnfRemove(${usuarioId})"></i>
      </div>
      <div class="evt-checklist">
        ${_evtDepositosDisponibles.map(b => `
          <label class="evt-check-item">
            <input type="checkbox" ${data.bodegas.has(b.id)?'checked':''}
              onchange="evtToggleBodegaEnf(${usuarioId}, ${b.id}, this.checked)">
            <span>${escHtml(b.nombre)}</span>
          </label>`).join('')}
      </div>
    </div>`).join('');
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

  if(!nombre){ toastError('Ingresa el nombre del evento'); return; }
  if(!fechaInicio || !fechaFin){ toastError('Ingresa las fechas del evento'); return; }
  if(fechaFin < fechaInicio){ toastError('La fecha de finalización no puede ser anterior a la de inicio'); return; }
  if(!ubicacion_id){ toastError('Selecciona la ubicación del evento'); return; }
  if(!_evtEnfermeros.size){ toastError('Agrega al menos un enfermero'); return; }

  const asignaciones = [];
  for(const [usuario_id, data] of _evtEnfermeros.entries()){
    if(!data.bodegas.size){
      toastError(`Selecciona al menos un depósito para ${data.nombre}`);
      return;
    }
    asignaciones.push({ usuario_id, bodega_ids: [...data.bodegas] });
  }

  try {
    await Eventos.create({ nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin, ubicacion_id, asignaciones });
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