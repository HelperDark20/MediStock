// ── PREVIEWS ──
function updateBodegaPreview(){
  const tipo   = (document.getElementById('b-tipo').value||'').toUpperCase().trim();
  const sufijo = (document.getElementById('b-sufijo').value||'').toUpperCase().trim();
  const preview = tipo && sufijo ? `${tipo}-${sufijo}` : tipo ? `${tipo}-` : sufijo ? `-${sufijo}` : '-';
  document.getElementById('bodega-preview').textContent = preview;
}

// ── CREAR UBICACIÓN (sede) ──
async function crearUbicacion(){
  const nombre = (document.getElementById('ub-nombre').value||'').trim();
  if(!nombre){ toast('Ingresa el nombre de la ubicación','error'); return; }
  try {
    await Ubicaciones.create(nombre);
    document.getElementById('ub-nombre').value = '';
    await loadState();
    populateSelects();
    ubCambiarVista('permanentes');
    toast(`✓ Ubicación ${nombre.toUpperCase()} creada`, 'success');
  } catch(err){
    toast(err.message, 'error');
  }
}

// ── CREAR DEPÓSITO (botiquín, enfermería, etc.) ──
async function crearBodega(){
  const ubicacion_id = parseInt(document.getElementById('b-ubicacion').value)||0;
  const tipo   = (document.getElementById('b-tipo').value||'').trim().toUpperCase();
  const sufijo = (document.getElementById('b-sufijo').value||'').trim().toUpperCase();
  if(!ubicacion_id){ toast('Selecciona una ubicación','error'); return; }
  if(!tipo){   toast('Ingresa el tipo de depósito','error'); return; }
  if(!sufijo){ toast('Ingresa el nombre del depósito','error'); return; }
  try {
    await Bodegas.create(tipo, sufijo, ubicacion_id);
    document.getElementById('b-tipo').value = '';
    document.getElementById('b-sufijo').value = '';
    updateBodegaPreview();
    await loadState();
    populateSelects();
    renderBodegas();
    toast(`✓ ${tipo}-${sufijo} creado`, 'success');
  } catch(err){
    toast(err.message, 'error');
  }
}

// ── POBLAR SELECT DE UBICACIONES EN EL FORM DE DEPÓSITO ──
// Solo sedes permanentes: a una temporal los depósitos se prestan, no se crean
function populateBodegaUbicaciones(){
  const sel = document.getElementById('b-ubicacion');
  if(!sel) return;
  sel.innerHTML = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.filter(u=>!u.es_temporal).map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
}

// ── RENDER PRINCIPAL ──
// Dos vistas: sedes permanentes (con los depósitos que tienen prestados) y
// ubicaciones temporales (activas con su botón Finalizar + finalizadas).
let _ubVista = 'permanentes';

function ubCambiarVista(vista){
  _ubVista = vista;
  document.querySelectorAll('[data-ubvista]').forEach(b=>b.classList.toggle('active', b.dataset.ubvista===vista));
  renderBodegas();
}

const _BOD_ICONS = { BTQ:'ti-briefcase-medical', ENF:'ti-stethoscope', MEC:'ti-heart-rate-monitor', ALM:'ti-building-warehouse' };

function _depositoCardHtml(b, acciones, meta, clase){
  const prefix = b.nombre.split('-')[0];
  return `<div class="deposito-card ${clase||''}">
    <div class="deposito-icon"><i class="ti ${_BOD_ICONS[prefix]||'ti-map-pin'}"></i></div>
    <div class="deposito-info">
      <div class="deposito-name">${escHtml(b.nombre)}</div>
      ${meta?`<div class="deposito-meta">${meta}</div>`:''}
    </div>
    ${acciones||''}
  </div>`;
}

function renderBodegas(){
  populateBodegaUbicaciones();
  const el = document.getElementById('bodegas-list');
  const permanentes = S.ubicaciones.filter(u=>!u.es_temporal);
  const temporales  = S.ubicaciones.filter(u=>u.es_temporal);
  const finalizadas = (S.ubicacionesHistoricas||[]).filter(u=>u.es_temporal && u.finalizada_at)
    .sort((a,b)=>String(b.finalizada_at).localeCompare(String(a.finalizada_at)));

  const cPerm = document.getElementById('ub-count-permanentes');
  const cTemp = document.getElementById('ub-count-temporales');
  if(cPerm) cPerm.textContent = `(${permanentes.length})`;
  if(cTemp) cTemp.textContent = `(${temporales.length})`;

  el.innerHTML = _ubVista === 'temporales'
    ? _renderTemporales(temporales, finalizadas)
    : _renderPermanentes(permanentes);
}

function _renderPermanentes(ubicaciones){
  if(!ubicaciones.length){
    return `<div class="empty-state"><i class="ti ti-map-pin"></i><p>No hay ubicaciones registradas</p></div>`;
  }
  const bodegas = S.bodegasRaw||[];
  return ubicaciones.map(u => {
    const depositos = bodegas.filter(b=>b.ubicacion_id===u.id);
    // Depósitos de esta sede que están prestados a una temporal
    const prestados = bodegas.filter(b=>b.ubicacion_origen_id===u.id);
    const depositosHTML = depositos.map(b => _depositoCardHtml(b, currentRole===4?`
        <div class="act-btn-group">
          <button class="act-btn primary" title="Editar nombre" onclick="abrirEditarBodega(${b.id})">
            <i class="ti ti-pencil"></i>
          </button>
          <button class="act-btn danger" title="Eliminar" onclick="confirmDeleteBodega(${b.id})">
            <i class="ti ti-trash"></i>
          </button>
        </div>`:'')).join('') +
      prestados.map(b => _depositoCardHtml(b, '',
        `<i class="ti ti-clock-pin"></i> Prestado a ${escHtml(b.ubicacion_nombre||'—')}`, 'prestado')).join('');

    return `<div class="ubicacion-card">
      <div class="ubicacion-header">
        <div class="ubicacion-icon"><i class="ti ti-map-pin"></i></div>
        <div class="ubicacion-info">
          <div class="ubicacion-name">${escHtml(u.nombre)}</div>
          <div class="ubicacion-sub">${depositos.length} depósito${depositos.length!==1?'s':''}${prestados.length?` · ${prestados.length} prestado${prestados.length!==1?'s':''}`:''}</div>
        </div>
        ${currentRole===4?`
          <div class="act-btn-group">
            <button class="act-btn primary" title="Editar nombre" onclick="abrirEditarUbicacion(${u.id})">
              <i class="ti ti-pencil"></i>
            </button>
            <button class="act-btn danger" title="Eliminar" onclick="confirmDeleteUbicacion(${u.id})">
              <i class="ti ti-trash"></i>
            </button>
          </div>`:''}
      </div>
      <div class="depositos-list">${depositosHTML || `<div style="padding:10px 14px;font-size:12px;color:#aaa;font-style:italic">Sin depósitos registrados</div>`}</div>
    </div>`;
  }).join('');
}

function _renderTemporales(activas, finalizadas){
  const admin = currentRole===4;
  let html = '';
  if(!activas.length){
    html += `<div class="empty-state"><i class="ti ti-clock-pin"></i><p>No hay ubicaciones temporales activas${admin?' — créala desde "Crear ubicación temporal"':''}</p></div>`;
  }
  html += activas.map(u => {
    const depositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===u.id);
    const eventosAbiertos = (S.eventos||[]).filter(e=>e.ubicacion_id===u.id && e.estado!=='finalizado');
    const depositosHTML = depositos.length
      ? depositos.map(b => _depositoCardHtml(b, admin?`
          <button class="act-btn primary" title="Devolver a ${escHtml(b.ubicacion_origen_nombre||'su origen')}" onclick="confirmDevolverDeposito(${u.id}, ${b.id})">
            <i class="ti ti-arrow-back-up"></i>
          </button>`:'',
          `Origen: ${escHtml(b.ubicacion_origen_nombre||'—')}`)).join('')
      : `<div style="padding:10px 14px;font-size:12px;color:#aaa;font-style:italic">Sin depósitos prestados</div>`;

    return `<div class="ubicacion-card temporal">
      <div class="ubicacion-header">
        <div class="ubicacion-icon"><i class="ti ti-clock-pin"></i></div>
        <div class="ubicacion-info">
          <div class="ubicacion-name">${escHtml(u.nombre)}<span class="ub-badge">TEMPORAL</span></div>
          <div class="ubicacion-sub">${depositos.length} depósito${depositos.length!==1?'s':''} prestado${depositos.length!==1?'s':''}${eventosAbiertos.length?` · ${eventosAbiertos.length} evento${eventosAbiertos.length!==1?'s':''} abierto${eventosAbiertos.length!==1?'s':''}`:''}</div>
        </div>
        ${admin?`
          <div class="act-btn-group" style="flex-wrap:wrap;justify-content:flex-end">
            <button class="ub-finalizar-btn sec" title="Agregar depósitos" onclick="abrirAgregarDepositosTemporal(${u.id})"><i class="ti ti-plus"></i>Depósitos</button>
            <button class="ub-finalizar-btn" title="Devolver todos los depósitos y cerrar la ubicación" onclick="confirmFinalizarTemporal(${u.id})"><i class="ti ti-flag-check"></i>Finalizar</button>
            <button class="act-btn primary" title="Editar nombre" onclick="abrirEditarUbicacion(${u.id})"><i class="ti ti-pencil"></i></button>
          </div>`:''}
      </div>
      <div class="depositos-list">${depositosHTML}</div>
    </div>`;
  }).join('');

  if(finalizadas.length){
    html += `<div class="sec-header" style="margin-top:18px"><div class="sec-title">Temporales finalizadas</div></div>` +
      finalizadas.map(u => `<div class="ubicacion-card temporal finalizada">
        <div class="ubicacion-header">
          <div class="ubicacion-icon"><i class="ti ti-flag-check"></i></div>
          <div class="ubicacion-info">
            <div class="ubicacion-name">${escHtml(u.nombre)}<span class="ub-badge gris">FINALIZADA</span></div>
            <div class="ubicacion-sub">Finalizada el ${new Date(u.finalizada_at).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'})} · sus movimientos siguen en Reportes</div>
          </div>
        </div>
      </div>`).join('');
  }
  return html;
}

// ══════════════════════════════════════════
// UBICACIONES TEMPORALES — crear, agregar depósitos, devolver, finalizar
// ══════════════════════════════════════════
let _tmpPrestables = [];
let _tmpSeleccion = new Set();
let _tmpUbicacionId = null;   // null = creando; id = agregando a una existente

async function _tmpAbrir(ubicacionId){
  _tmpUbicacionId = ubicacionId;
  _tmpSeleccion = new Set();
  const u = ubicacionId ? S.ubicaciones.find(x=>x.id===ubicacionId) : null;
  document.getElementById('tmp-titulo').textContent = u ? `Agregar depósitos a ${u.nombre}` : 'Crear ubicación temporal';
  document.getElementById('tmp-nombre-wrap').style.display = u ? 'none' : '';
  document.getElementById('tmp-confirmar').textContent = u ? 'Agregar depósitos' : 'Crear ubicación temporal';
  document.getElementById('tmp-buscar').value = '';
  document.getElementById('tmp-depositos').innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Cargando depósitos…</div>';
  _tmpActualizarSeleccion();
  document.getElementById('modal-temporal').classList.add('open');
  try {
    _tmpPrestables = await Ubicaciones.depositosPrestables();
    tmpRenderDepositos();
  } catch(err){
    document.getElementById('tmp-depositos').innerHTML = '';
    toastError(err.message);
  }
}

function abrirCrearTemporal(){
  document.getElementById('tmp-nombre').value = (document.getElementById('ub-nombre').value||'').trim();
  _tmpAbrir(null);
}

function abrirAgregarDepositosTemporal(id){ _tmpAbrir(id); }

// Agrupados por sede permanente. Los que están en un evento abierto se
// muestran deshabilitados con el nombre del evento.
function tmpRenderDepositos(){
  const q = (document.getElementById('tmp-buscar').value||'').toLowerCase().trim();
  const lista = _tmpPrestables.filter(b => !q ||
    b.nombre.toLowerCase().includes(q) || (b.ubicacion_nombre||'').toLowerCase().includes(q));
  const cont = document.getElementById('tmp-depositos');
  if(!lista.length){
    cont.innerHTML = `<div style="font-size:12px;color:#aaa;padding:8px 0">${_tmpPrestables.length?'Sin coincidencias':'No hay depósitos disponibles en las sedes permanentes'}</div>`;
    return;
  }
  let html = '', ubActual = null;
  lista.forEach(b => {
    if(b.ubicacion_nombre !== ubActual){
      ubActual = b.ubicacion_nombre;
      html += `<div class="tmp-grupo">${escHtml(ubActual||'—')}</div>`;
    }
    const ocupado = !!b.evento_nombre;
    html += `<label class="evt-check-item ${ocupado?'ocupado':''}" ${ocupado?`title="Asignado al evento ${escHtml(b.evento_nombre)}"`:''}>
      <input type="checkbox" ${ocupado?'disabled':''} ${_tmpSeleccion.has(b.id)?'checked':''} onchange="tmpToggleDeposito(${b.id}, this.checked)">
      <span>${escHtml(b.nombre)}</span>
      ${ocupado?`<span class="tmp-ocupado">En evento: ${escHtml(b.evento_nombre)}</span>`:''}
    </label>`;
  });
  cont.innerHTML = html;
}

function tmpToggleDeposito(id, checked){
  if(checked) _tmpSeleccion.add(id); else _tmpSeleccion.delete(id);
  _tmpActualizarSeleccion();
}

function _tmpActualizarSeleccion(){
  const n = _tmpSeleccion.size;
  document.getElementById('tmp-seleccion').textContent = n
    ? `${n} depósito${n!==1?'s':''} seleccionado${n!==1?'s':''}`
    : 'Ningún depósito seleccionado';
}

async function tmpConfirmar(){
  const ids = [..._tmpSeleccion];
  try {
    if(_tmpUbicacionId){
      if(!ids.length){ toastError('Selecciona al menos un depósito'); return; }
      await Ubicaciones.agregarDepositos(_tmpUbicacionId, ids);
      toast(`✓ ${ids.length} depósito${ids.length!==1?'s':''} agregado${ids.length!==1?'s':''}`, 'success');
    } else {
      const nombre = (document.getElementById('tmp-nombre').value||'').trim();
      if(!nombre){ toastError('Ingresa el nombre de la ubicación temporal'); return; }
      if(!ids.length){ toastError('Selecciona al menos un depósito para la ubicación temporal'); return; }
      await Ubicaciones.createTemporal(nombre, ids);
      document.getElementById('ub-nombre').value = '';
      toast(`✓ Ubicación temporal ${nombre.toUpperCase()} creada`, 'success');
    }
    closeModal('modal-temporal');
    await loadState();
    populateSelects();
    ubCambiarVista('temporales');
  } catch(err){ toastError(err.message); }
}

function confirmDevolverDeposito(ubicacionId, bodegaId){
  const b = (S.bodegasRaw||[]).find(x=>x.id===bodegaId);
  if(!b) return;
  document.getElementById('modal-title').textContent = 'Devolver depósito';
  document.getElementById('modal-sub').textContent =
    `¿Devolver ${b.nombre} a ${b.ubicacion_origen_nombre||'su ubicación de origen'}? Vuelve con todo el stock que tenga. Sus consumos en esta ubicación temporal se conservan en los reportes.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Ubicaciones.devolverDeposito(ubicacionId, bodegaId);
      closeModal('modal-confirm');
      await loadState();
      populateSelects();
      renderBodegas();
      toast(`✓ ${b.nombre} devuelto`, 'success');
    } catch(err){ toastError(err.message); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

function confirmFinalizarTemporal(id){
  const u = S.ubicaciones.find(x=>x.id===id);
  if(!u) return;
  const abiertos = (S.eventos||[]).filter(e=>e.ubicacion_id===id && e.estado!=='finalizado');
  if(abiertos.length){
    toastError(`No se puede finalizar ${u.nombre}: tiene eventos abiertos (${abiertos.map(e=>e.nombre).join(', ')}). Finalízalos o elimínalos primero.`);
    return;
  }
  const n = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===id).length;
  document.getElementById('modal-title').textContent = 'Finalizar ubicación temporal';
  document.getElementById('modal-sub').textContent =
    `¿Finalizar ${u.nombre}? ${n?`Los ${n} depósito${n!==1?'s':''} vuelve${n!==1?'n':''} a su ubicación de origen con el stock que tenga${n!==1?'n':''}. `:''}La ubicación se cierra, pero sus movimientos se pueden seguir consultando en Reportes.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      const r = await Ubicaciones.finalizar(id);
      closeModal('modal-confirm');
      await loadState();
      populateSelects();
      renderBodegas();
      toast(`✓ ${u.nombre} finalizada — ${r.depositos_devueltos} depósito${r.depositos_devueltos!==1?'s':''} devuelto${r.depositos_devueltos!==1?'s':''}`, 'success');
    } catch(err){ toastError(err.message); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── EDITAR NOMBRE DE UBICACIÓN ──
function abrirEditarUbicacion(id){
  const u = (S.ubicaciones||[]).find(x=>x.id===id);
  if(!u) return;
  document.getElementById('edit-ub-id').value = u.id;
  document.getElementById('edit-ub-nombre').value = u.nombre;
  document.getElementById('modal-edit-ubicacion').classList.add('open');
}

async function guardarEdicionUbicacion(){
  const id = parseInt(document.getElementById('edit-ub-id').value)||0;
  const nombre = (document.getElementById('edit-ub-nombre').value||'').trim();
  if(!nombre){ toastError('Ingresa el nombre de la ubicación'); return; }
  try {
    await Ubicaciones.update(id, nombre);
    closeModal('modal-edit-ubicacion');
    await loadState();
    populateSelects();
    renderBodegas();
    toast(`✓ Ubicación renombrada a ${nombre.toUpperCase()}`, 'success');
  } catch(err){ toastError(err.message); }
}

// ── EDITAR NOMBRE DE DEPÓSITO ──
// Los grupos de Stock de Seguridad se asignan por las palabras del nombre
// del depósito (ej. BTQ, ENF). Si el cambio de nombre hace que le
// corresponda otro grupo (o ninguno), se avisa antes de guardar.
let _editBodegaOriginal = null;

function abrirEditarBodega(id){
  const b = (S.bodegasRaw||[]).find(x=>x.id===id);
  if(!b) return;
  _editBodegaOriginal = b;
  const [tipo, ...resto] = b.nombre.split('-');
  document.getElementById('edit-bod-id').value = b.id;
  document.getElementById('edit-bod-tipo').value = tipo;
  document.getElementById('edit-bod-sufijo').value = resto.join('-');
  editBodegaPreview();
  document.getElementById('modal-edit-bodega').classList.add('open');
}

function _editBodegaNombreNuevo(){
  const tipo   = (document.getElementById('edit-bod-tipo').value||'').trim().toUpperCase();
  const sufijo = (document.getElementById('edit-bod-sufijo').value||'').trim().toUpperCase();
  return { tipo, sufijo, nombre: tipo && sufijo ? `${tipo}-${sufijo}` : '' };
}

function editBodegaPreview(){
  const { nombre } = _editBodegaNombreNuevo();
  document.getElementById('edit-bod-preview').textContent = nombre || '-';

  const warn = document.getElementById('edit-bod-warn');
  warn.style.display = 'none';
  if(!nombre || !_editBodegaOriginal || typeof _repBuscarGrupoSeguridad !== 'function') return;
  const antes = _repBuscarGrupoSeguridad(_editBodegaOriginal.nombre);
  const despues = _repBuscarGrupoSeguridad(nombre);
  if((antes?.id||null) !== (despues?.id||null)){
    warn.textContent = `Ojo: con este nombre el depósito pasa de la lista de stock de seguridad "${antes?.nombre||'ninguna'}" a "${despues?.nombre||'ninguna'}".`;
    warn.style.display = 'block';
  }
}

async function guardarEdicionBodega(){
  const id = parseInt(document.getElementById('edit-bod-id').value)||0;
  const { tipo, sufijo, nombre } = _editBodegaNombreNuevo();
  if(!tipo){   toastError('Ingresa el tipo de depósito'); return; }
  if(!sufijo){ toastError('Ingresa el nombre del depósito'); return; }
  try {
    await Bodegas.update(id, tipo, sufijo);
    closeModal('modal-edit-bodega');
    await loadState();
    populateSelects();
    renderBodegas();
    toast(`✓ Depósito renombrado a ${nombre}`, 'success');
  } catch(err){ toastError(err.message); }
}

// ── CONFIRMACIONES ELIMINACIÓN ──
function confirmDeleteBodega(id){
  const nombre = (S.bodegasRaw||[]).find(b=>b.id===id)?.nombre || '';
  _delType='bodega'; _delId=id;
  document.getElementById('modal-title').textContent='Eliminar depósito';
  document.getElementById('modal-sub').textContent=`¿Eliminar el depósito "${nombre}"? Esta acción no se puede deshacer.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Bodegas.delete(id);
      closeModal('modal-confirm');
      await loadState();
      populateSelects();
      renderBodegas();
      toast('Depósito eliminado');
    } catch(err){ toast(err.message,'error'); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

function confirmDeleteUbicacion(id){
  const nombre = (S.ubicaciones||[]).find(u=>u.id===id)?.nombre || '';
  document.getElementById('modal-title').textContent='Eliminar ubicación';
  document.getElementById('modal-sub').textContent=`¿Eliminar la ubicación "${nombre}"? Debes eliminar primero todos sus depósitos.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Ubicaciones.delete(id);
      closeModal('modal-confirm');
      await loadState();
      renderBodegas();
      toast('Ubicación eliminada');
    } catch(err){ toast(err.message,'error'); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}