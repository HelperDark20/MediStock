// ── PANEL ENFERMERO ──
// NUEVA LÓGICA: la bodega/depósito que puede usar el enfermero ya NO
// depende de un ubicacion_id fijo asignado en su usuario. Depende del
// EVENTO activo ("en_curso") al que esté asignado en este momento.
// Si no tiene ningún evento en curso, queda en estado neutro y no
// puede registrar consumos hasta que el administrador lo asigne a uno.
AC['enf'] = { selectedId: null, focusIdx: -1 };

async function initEnfermeroPanel(user){
  const av = document.getElementById('enf-avatar');
  av.textContent = (user.nombre||'EN').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('enf-nombre').textContent = user.nombre||'Enfermero/a';
  document.getElementById('enfermero-panel').classList.add('active');

  window._enfUserId = user.id;
  window._enfEventoActivo = null;

  // Un enfermero puede estar asignado a varios eventos en curso a la vez
  // (ej. PALMASECA en la mañana y CAÑAVERALEJO en la tarde). Si tiene más
  // de uno, se le pide elegir en cuál va a trabajar.
  let activos = [];
  try {
    activos = await Eventos.getActivos();
  } catch(err){
    console.error('Error obteniendo eventos activos:', err);
  }
  window._enfEventosActivos = activos;

  const sinEvento = document.getElementById('enf-sin-evento');
  const gridWrap  = document.getElementById('enf-grid-wrap');

  if(!activos.length){
    if(sinEvento) sinEvento.style.display = 'block';
    if(gridWrap)  gridWrap.style.display = 'none';
    return;
  }

  if(sinEvento) sinEvento.style.display = 'none';
  if(gridWrap)  gridWrap.style.display = '';

  if(activos.length === 1){
    enfAplicarEvento(activos[0]);
    return;
  }

  // Varios eventos: si ya eligió uno en esta sesión y sigue en curso, se respeta
  const previo = activos.find(e => e.id === _enfLeerEleccion());
  if(previo){
    enfAplicarEvento(previo);
    return;
  }
  _enfMostrarPendienteEleccion();
  enfAbrirElegirEvento();
}

// ── SELECCIÓN DE EVENTO (solo si tiene más de uno en curso) ──
function _enfClaveEleccion(){ return `nb_evento_${window._enfUserId}`; }

function _enfLeerEleccion(){
  try { return parseInt(sessionStorage.getItem(_enfClaveEleccion())) || null; } catch { return null; }
}

function _enfGuardarEleccion(eventoId){
  try { sessionStorage.setItem(_enfClaveEleccion(), String(eventoId)); } catch {}
}

function enfLimpiarEleccion(){
  try { sessionStorage.removeItem(_enfClaveEleccion()); } catch {}
}

function _enfMostrarPendienteEleccion(){
  window._enfEventoActivo = null;
  document.querySelector('#enf-grid-wrap .enf-grid').style.display = 'none';
  document.getElementById('enf-evento-info').innerHTML =
    `<i class="ti ti-calendar-event"></i> Tienes ${window._enfEventosActivos.length} eventos en curso. Elige en cuál vas a trabajar.
     <button class="act-btn primary" style="margin-left:8px;width:auto;padding:0 10px" onclick="enfAbrirElegirEvento()">Elegir evento</button>`;
}

function enfAbrirElegirEvento(){
  const actualId = window._enfEventoActivo?.id;
  document.getElementById('enf-eventos-opciones').innerHTML = (window._enfEventosActivos||[]).map(e => {
    const deps = (e.bodegas||[]).map(b=>escHtml(b.nombre)).join(', ') || '<span style="color:var(--red2)">Sin depósitos asignados</span>';
    return `<div class="user-card" style="margin-bottom:8px;cursor:pointer;${e.id===actualId?'outline:2px solid var(--blue)':''}" onclick="enfElegirEvento(${e.id})">
      <div class="user-avatar n2"><i class="ti ti-calendar-event"></i></div>
      <div class="user-info">
        <div class="user-name">${escHtml(e.nombre)}</div>
        <div class="user-cedula"><i class="ti ti-map-pin"></i> ${escHtml(e.ubicacion_nombre||'—')} · ${deps}</div>
      </div>
      ${e.id===actualId?'<span class="evt-badge en_curso">Actual</span>':''}
    </div>`;
  }).join('');
  document.getElementById('modal-elegir-evento').classList.add('open');
}

function enfElegirEvento(eventoId){
  const evento = (window._enfEventosActivos||[]).find(e => e.id === eventoId);
  if(!evento) return;
  _enfGuardarEleccion(eventoId);
  closeModal('modal-elegir-evento');
  enfAplicarEvento(evento);
  toast(`Trabajando en: ${evento.nombre}`, 'success');
}

function enfAplicarEvento(activo){
  window._enfEventoActivo = activo;
  document.querySelector('#enf-grid-wrap .enf-grid').style.display = '';

  const bodegasFiltradas = (S.bodegasRaw||[]).filter(b =>
    (activo.bodegas||[]).some(eb => eb.id === b.id)
  );

  const sel = document.getElementById('enf-origen');
  sel.innerHTML = '<option value="">Seleccionar bodega…</option>' +
    bodegasFiltradas.map(b=>`<option value="${escHtml(b.nombre)}">${escHtml(b.nombre)}</option>`).join('');
  enfOnBodegaChange();

  window._enfBodegasPermitidas = new Set(bodegasFiltradas.map(b => b.nombre));

  const evtInfo = document.getElementById('enf-evento-info');
  if(evtInfo){
    const cambiar = (window._enfEventosActivos||[]).length > 1
      ? `<button class="act-btn primary" style="margin-left:8px;width:auto;padding:0 10px" onclick="enfAbrirElegirEvento()"><i class="ti ti-switch-horizontal"></i> Cambiar evento</button>`
      : '';
    evtInfo.innerHTML = `<i class="ti ti-calendar-event"></i> Evento activo: <strong>${escHtml(activo.nombre)}</strong> · ${escHtml(activo.ubicacion_nombre||'')}${cambiar}`;
  }

  renderEnfHistorial();
}

function enfOnBodegaChange(){
  const bodega = document.getElementById('enf-origen').value;
  const busquedaWrap = document.getElementById('enf-busqueda-wrap');
  const medCard = document.getElementById('enf-med-card');

  acClear('enf');
  medCard.classList.remove('show');

  if(bodega){
    busquedaWrap.style.opacity = '1';
    busquedaWrap.style.pointerEvents = 'auto';
    document.getElementById('enf-ac-input').focus();
  } else {
    busquedaWrap.style.opacity = '.4';
    busquedaWrap.style.pointerEvents = 'none';
  }
}

function enfOnMedSelect(sub){
  if(!sub) return;

  const bodegaSeleccionada = document.getElementById('enf-origen').value;

  const card = document.getElementById('enf-med-card');
  card.classList.add('show');
  document.getElementById('enf-med-name').textContent = sub.nombre;
  const skuG = S.skusGlobales.find(g=>g.id===sub.skuGlobalId);
  document.getElementById('enf-med-sub').textContent =
    `${skuG?.codigo||''} · ${sub.subSku} · Cad: ${fmtDate(sub.caducidad)}`;

  const stockEl = document.getElementById('enf-med-stock');
  const cantEnBodega = sub.stock?.[bodegaSeleccionada] || 0;

  if(cantEnBodega <= 0){
    stockEl.innerHTML = `<span style="font-size:12px;color:var(--red)">Sin stock en ${bodegaSeleccionada}</span>`;
  } else {
    const sem = getSem(sub.caducidad);
    stockEl.innerHTML = `
      <div class="enf-stock-chip">
        <i class="ti ti-building-warehouse" style="font-size:12px"></i>
        ${bodegaSeleccionada}: <strong>${cantEnBodega}</strong> ${sub.unidad}
      </div>
      <span class="enf-sem ${sem}" style="margin-left:4px">${semLabel(sem)}</span>`;
  }
}

async function enfRegistrarConsumo(){
  const id      = parseInt(document.getElementById('enf-sku').value)||0;
  const cant    = parseInt(document.getElementById('enf-cantidad').value)||0;
  const origen  = document.getElementById('enf-origen').value;
  const paciente= document.getElementById('enf-paciente').value.trim();

  if(!window._enfEventoActivo){ toastError('No tienes un evento activo asignado'); return; }
  if(!origen)  { toastError('Selecciona una bodega primero'); return; }
  if(!id)      { toastError('Selecciona un medicamento'); return; }
  if(cant<=0)  { toastError('Ingresa una cantidad válida'); return; }

  const btn = document.getElementById('enf-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i>Registrando...';

  try {
    const todasBodegas = await Bodegas.getAll();
    const origenId = todasBodegas.find(b=>b.nombre===origen)?.id;

    if(!origenId){
      toastError('Bodega no encontrada — recarga la página');
      return;
    }

    await Movimientos.consumo({
      sub_sku_id: id,
      bodega_origen_id: origenId,
      cantidad: cant,
      cedula_paciente: paciente||null
    });

    document.getElementById('enf-cantidad').value = '';
    document.getElementById('enf-paciente').value = '';
    acClear('enf');
    document.getElementById('enf-med-card').classList.remove('show');

    await loadState();
    renderEnfHistorial();
    toast('✓ Consumo registrado','success');

  } catch(err){
    toastError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i>Registrar consumo';
  }
}

function renderEnfHistorial(){
  const hoyCO = fechaColombia();
  const consumosHoy = S.movimientos.filter(m=>
    m.tipo==='consumo' &&
    String(m.usuario_id) === String(window._enfUserId) &&
    m.created_at && fechaColombia(m.created_at) === hoyCO
  );

  const el = document.getElementById('enf-history-list');
  if(!consumosHoy.length){
    el.innerHTML=`<div class="enf-empty">
      <i class="ti ti-clipboard"></i>
      <p>Sin consumos registrados hoy</p>
    </div>`;
    return;
  }

  el.innerHTML = consumosHoy.map(m=>`
    <div class="enf-history-item">
      <div class="enf-history-dot"></div>
      <div class="enf-history-info">
        <div class="enf-history-name">${m.nombre||m.sku_global_codigo||'—'}</div>
        <div class="enf-history-meta">
          ${m.origen_nombre||'—'} ·
          ${new Date(m.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'})}
          ${m.cedula_paciente?` · Pac: ${m.cedula_paciente}`:''}
        </div>
      </div>
      <div class="enf-history-cant">${m.cantidad} ${m.unidad||''}</div>
    </div>`).join('');
}
