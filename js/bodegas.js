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
    S.ubicaciones.map(u=>`<option value="${u.id}">${u.nombre}</option>`).join('');
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
              <div class="deposito-name">${b.nombre}</div>
            </div>
            ${currentRole===4?`
              <button class="act-btn danger" onclick="confirmDeleteBodega(${b.id},'${b.nombre}')">
                <i class="ti ti-trash"></i>
              </button>`:''}
          </div>`;
        }).join('')
      : `<div style="padding:10px 14px;font-size:12px;color:#aaa;font-style:italic">Sin depósitos registrados</div>`;

    return `<div class="ubicacion-card">
      <div class="ubicacion-header">
        <div class="ubicacion-icon"><i class="ti ti-map-pin"></i></div>
        <div class="ubicacion-info">
          <div class="ubicacion-name">${u.nombre}</div>
          <div class="ubicacion-sub">${depositos.length} depósito${depositos.length!==1?'s':''}</div>
        </div>
        ${currentRole===4?`
          <button class="act-btn danger" onclick="confirmDeleteUbicacion(${u.id},'${u.nombre}')">
            <i class="ti ti-trash"></i>
          </button>`:''}
      </div>
      <div class="depositos-list">${depositosHTML}</div>
    </div>`;
  }).join('');
}

// ── CONFIRMACIONES ELIMINACIÓN ──
function confirmDeleteBodega(id, nombre){
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

function confirmDeleteUbicacion(id, nombre){
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