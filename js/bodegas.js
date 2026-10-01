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
    renderBodegas();
    populateBodegaUbicaciones();
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
function populateBodegaUbicaciones(){
  const sel = document.getElementById('b-ubicacion');
  if(!sel) return;
  sel.innerHTML = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
}

// ── RENDER PRINCIPAL ──
function renderBodegas(){
  populateBodegaUbicaciones();
  const el = document.getElementById('bodegas-list');

  if(!S.ubicaciones.length){
    el.innerHTML = `<div class="empty-state"><i class="ti ti-map-pin"></i><p>No hay ubicaciones registradas</p></div>`;
    return;
  }

  // Agrupar depósitos por ubicacion_nombre
  const bodegasPorUbicacion = {};
  S.ubicaciones.forEach(u => { bodegasPorUbicacion[u.nombre] = []; });
  (S.bodegasRaw||[]).forEach(b => {
    const uNombre = b.ubicacion_nombre || 'GENERAL';
    if(!bodegasPorUbicacion[uNombre]) bodegasPorUbicacion[uNombre] = [];
    bodegasPorUbicacion[uNombre].push(b);
  });

  const icons = { BTQ:'ti-briefcase-medical', ENF:'ti-stethoscope', MEC:'ti-heart-rate-monitor', ALM:'ti-building-warehouse' };

  el.innerHTML = S.ubicaciones.map(u => {
    const depositos = bodegasPorUbicacion[u.nombre] || [];
    const depositosHTML = depositos.length
      ? depositos.map(b => {
          const prefix = b.nombre.split('-')[0];
          return `<div class="deposito-card">
            <div class="deposito-icon"><i class="ti ${icons[prefix]||'ti-map-pin'}"></i></div>
            <div class="deposito-info">
              <div class="deposito-name">${escHtml(b.nombre)}</div>
            </div>
            ${currentRole===4?`
              <div class="act-btn-group">
                <button class="act-btn primary" title="Editar nombre" onclick="abrirEditarBodega(${b.id})">
                  <i class="ti ti-pencil"></i>
                </button>
                <button class="act-btn danger" title="Eliminar" onclick="confirmDeleteBodega(${b.id})">
                  <i class="ti ti-trash"></i>
                </button>
              </div>`:''}
          </div>`;
        }).join('')
      : `<div style="padding:10px 14px;font-size:12px;color:#aaa;font-style:italic">Sin depósitos registrados</div>`;

    return `<div class="ubicacion-card">
      <div class="ubicacion-header">
        <div class="ubicacion-icon"><i class="ti ti-map-pin"></i></div>
        <div class="ubicacion-info">
          <div class="ubicacion-name">${escHtml(u.nombre)}</div>
          <div class="ubicacion-sub">${depositos.length} depósito${depositos.length!==1?'s':''}</div>
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
      <div class="depositos-list">${depositosHTML}</div>
    </div>`;
  }).join('');
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