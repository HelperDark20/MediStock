// ══════════════════════════════════════════
// STOCK DE SEGURIDAD (Nivel 4)
// Gestión de grupos (botiquines/enfermerías) y sus listas de ítems
// esperados, referenciados contra SKUs Globales ya existentes.
// ══════════════════════════════════════════

let _segDetalleGrupoId = null;
let _segItemSeleccionado = null;
let _segAcFocusIdx = -1;

// ── RENDER GRID DE GRUPOS ──
function renderSegStock(){
  const el = document.getElementById('segstock-grid');
  if(!el) return;

  if(!S.stockSeguridad || !S.stockSeguridad.length){
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="ti ti-shield-check"></i>
      <p>Sin grupos de stock de seguridad registrados</p>
    </div>`;
    return;
  }

  el.innerHTML = S.stockSeguridad.map(g => {
    const patron = (g.patron_tokens||[]).join(' · ');
    const nItems = (g.items||[]).length;
    return `<div class="card evt-card" style="margin-bottom:0;cursor:pointer" onclick="segAbrirDetalleGrupo(${g.id})">
      <div class="card-body">
        <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--ink);margin-bottom:4px">${escHtml(g.nombre)}</div>
        <div style="font-size:11px;color:#888;font-family:var(--font-mono);margin-bottom:10px">Patrón: ${escHtml(patron||'—')}</div>
        <div style="font-size:12px;color:#666"><i class="ti ti-list-check" style="margin-right:4px"></i>${nItems} ítem${nItems!==1?'s':''}</div>
      </div>
    </div>`;
  }).join('');
}

// ── CREAR / EDITAR GRUPO ──
function abrirCrearGrupoSeg(){
  document.getElementById('seggrupo-titulo').textContent = 'Nuevo grupo';
  document.getElementById('seggrupo-id').value = '';
  document.getElementById('seggrupo-nombre').value = '';
  document.getElementById('seggrupo-patron').value = '';
  document.getElementById('modal-segstock-grupo').classList.add('open');
}

function segAbrirEditarGrupo(){
  const g = S.stockSeguridad.find(x=>x.id===_segDetalleGrupoId);
  if(!g) return;
  document.getElementById('modal-segstock-detalle').classList.remove('open');
  document.getElementById('seggrupo-titulo').textContent = 'Editar grupo';
  document.getElementById('seggrupo-id').value = g.id;
  document.getElementById('seggrupo-nombre').value = g.nombre;
  document.getElementById('seggrupo-patron').value = (g.patron_tokens||[]).join(', ');
  document.getElementById('modal-segstock-grupo').classList.add('open');
}

async function segGuardarGrupo(){
  const idRaw = document.getElementById('seggrupo-id').value;
  const nombre = document.getElementById('seggrupo-nombre').value.trim();
  const patronRaw = document.getElementById('seggrupo-patron').value.trim();
  const patron_tokens = patronRaw.split(',').map(t=>t.trim().toUpperCase()).filter(Boolean);

  if(!nombre){ toastError('Ingresa el nombre del grupo'); return; }
  if(!patron_tokens.length){ toastError('Ingresa al menos un token de patrón'); return; }

  try {
    if(idRaw){
      await StockSeguridad.updateGrupo(idRaw, { nombre, patron_tokens });
      toast('✓ Grupo actualizado','success');
    } else {
      await StockSeguridad.createGrupo({ nombre, patron_tokens });
      toast('✓ Grupo creado — añade sus ítems','success');
    }
    closeModal('modal-segstock-grupo');
    S.stockSeguridad = await StockSeguridad.getAll();
    renderSegStock();
    if(idRaw) segAbrirDetalleGrupo(parseInt(idRaw));
  } catch(err){
    toastError(err.message);
  }
}

function segConfirmEliminarGrupo(){
  const g = S.stockSeguridad.find(x=>x.id===_segDetalleGrupoId);
  if(!g) return;
  document.getElementById('modal-segstock-detalle').classList.remove('open');
  document.getElementById('modal-title').textContent = 'Eliminar grupo';
  document.getElementById('modal-sub').textContent = `¿Eliminar el grupo "${g.nombre}"? Se eliminará también su lista de ítems.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await StockSeguridad.deleteGrupo(g.id);
      closeModal('modal-confirm');
      S.stockSeguridad = await StockSeguridad.getAll();
      renderSegStock();
      toast('Grupo eliminado');
    } catch(err){
      toastError(err.message);
      closeModal('modal-confirm');
      document.getElementById('modal-segstock-detalle').classList.add('open');
    }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── DETALLE DE GRUPO: LISTA DE ÍTEMS ──
function segAbrirDetalleGrupo(id){
  const g = S.stockSeguridad.find(x=>x.id===id);
  if(!g) return;
  _segDetalleGrupoId = id;
  document.getElementById('segdet-grupo-id').value = id;
  document.getElementById('segdet-nombre').textContent = g.nombre;
  document.getElementById('segdet-patron').textContent = `Patrón: ${(g.patron_tokens||[]).join(' · ')||'—'}`;
  segRenderItems();
  document.getElementById('modal-segstock-detalle').classList.add('open');
}

function segRenderItems(){
  const g = S.stockSeguridad.find(x=>x.id===_segDetalleGrupoId);
  const el = document.getElementById('segdet-items-list');
  if(!g || !el) return;

  const items = (g.items||[]).slice().sort((a,b)=>a.item_nombre.localeCompare(b.item_nombre));

  if(!items.length){
    el.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0">Sin ítems en este grupo — añade el primero abajo</div>';
    return;
  }

  el.innerHTML = items.map(it=>`
    <div class="user-card" style="margin-bottom:8px">
      <div class="user-avatar" style="background:var(--blue)"><i class="ti ti-pill"></i></div>
      <div class="user-info">
        <div class="user-name">${escHtml(it.item_nombre)}</div>
        <div class="user-cedula">Cantidad esperada: <strong>${it.cantidad_esperada}</strong></div>
      </div>
      <div class="act-btn-group">
        <button class="act-btn primary" title="Editar cantidad" onclick="segAbrirEditarItem(${it.id},'${(it.item_nombre||'').replace(/'/g,"\\'")}',${it.cantidad_esperada})"><i class="ti ti-pencil"></i></button>
        <button class="act-btn danger" title="Eliminar ítem" onclick="segConfirmEliminarItem(${it.id},'${(it.item_nombre||'').replace(/'/g,"\\'")}')"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
}

// ── AÑADIR ÍTEM (autocomplete contra SKUs Globales — mismo patrón que Registro/Trazabilidad) ──
function segAbrirAgregarItem(){
  document.getElementById('modal-segstock-detalle').classList.remove('open');
  _segItemSeleccionado = null;
  document.getElementById('segitem-ac-input').value = '';
  document.getElementById('segitem-ac-clear').classList.remove('show');
  document.getElementById('segitem-ac-drop').classList.remove('open');
  document.getElementById('segitem-cantidad').value = '';
  document.getElementById('modal-segstock-item').classList.add('open');
}

function segCancelarItem(){
  closeModal('modal-segstock-item');
  document.getElementById('modal-segstock-detalle').classList.add('open');
}

function segItemAcFilter(){
  const q = (document.getElementById('segitem-ac-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('segitem-ac-drop');
  const clear = document.getElementById('segitem-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  _segAcFocusIdx = -1;

  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const g = S.stockSeguridad.find(x=>x.id===_segDetalleGrupoId);
  const yaAgregados = new Set((g?.items||[]).map(it=>it.item_nombre.trim().toUpperCase()));

  const results = S.skusGlobales.filter(sk =>
    !yaAgregados.has(sk.nombre.trim().toUpperCase()) &&
    (sk.nombre.toLowerCase().includes(q) || sk.codigo.toLowerCase().includes(q))
  ).slice(0, 10);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((sk, idx) => `
    <div class="ac-item" data-nombre="${escHtml(sk.nombre)}"
      onmousedown="segItemAcSelect('${sk.nombre.replace(/'/g,"\\'")}')"
      onmouseover="_segAcFocusIdx=${idx};document.querySelectorAll('#segitem-ac-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===${idx}))">
      <div class="ac-item-icon"><i class="ti ti-tag"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(escHtml(sk.nombre))}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${hilite(escHtml(sk.codigo))}</span>
          <span style="font-size:9px;color:#aaa">${escHtml(sk.familia||'')}</span>
        </div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function segItemAcOpen(){
  const q = document.getElementById('segitem-ac-input').value||'';
  if(q){ segItemAcFilter(); return; }
  const drop = document.getElementById('segitem-ac-drop');
  const g = S.stockSeguridad.find(x=>x.id===_segDetalleGrupoId);
  const yaAgregados = new Set((g?.items||[]).map(it=>it.item_nombre.trim().toUpperCase()));
  const all = S.skusGlobales.filter(sk => !yaAgregados.has(sk.nombre.trim().toUpperCase())).slice(0, 8);
  drop.innerHTML = all.map((sk, idx) => `
    <div class="ac-item" data-nombre="${escHtml(sk.nombre)}"
      onmousedown="segItemAcSelect('${sk.nombre.replace(/'/g,"\\'")}')"
      onmouseover="_segAcFocusIdx=${idx};document.querySelectorAll('#segitem-ac-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===${idx}))">
      <div class="ac-item-icon"><i class="ti ti-tag"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${escHtml(sk.nombre)}</div>
        <div class="ac-item-meta"><span class="sku-code" style="font-size:9px">${escHtml(sk.codigo)}</span></div>
      </div>
    </div>`).join('') + (S.skusGlobales.length > 8
      ? '<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>' : '');
  drop.classList.add('open');
}

function segItemAcKey(e){
  const drop  = document.getElementById('segitem-ac-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _segAcFocusIdx = Math.min(_segAcFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_segAcFocusIdx));
    items[_segAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _segAcFocusIdx = Math.max(_segAcFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_segAcFocusIdx));
    items[_segAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _segAcFocusIdx>=0){
    e.preventDefault();
    segItemAcSelect(items[_segAcFocusIdx].dataset.nombre);
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function segItemAcSelect(nombre){
  _segItemSeleccionado = { nombre };
  document.getElementById('segitem-ac-input').value = nombre;
  document.getElementById('segitem-ac-clear').classList.add('show');
  document.getElementById('segitem-ac-drop').classList.remove('open');
  document.getElementById('segitem-cantidad').focus();
}

function segItemAcClear(){
  _segItemSeleccionado = null;
  document.getElementById('segitem-ac-input').value = '';
  document.getElementById('segitem-ac-clear').classList.remove('show');
  document.getElementById('segitem-ac-drop').classList.remove('open');
  document.getElementById('segitem-ac-input').focus();
}

document.addEventListener('click', e=>{
  const wrap = document.getElementById('segitem-ac-wrap');
  if(wrap && !wrap.contains(e.target)) document.getElementById('segitem-ac-drop')?.classList.remove('open');
});

async function segGuardarItem(){
  if(!_segItemSeleccionado){ toastError('Selecciona un ítem de SKUs Globales'); return; }
  const cantidad = parseInt(document.getElementById('segitem-cantidad').value);
  if(isNaN(cantidad) || cantidad < 0){ toastError('Ingresa una cantidad esperada válida'); return; }

  try {
    await StockSeguridad.addItem({
      grupo_id: _segDetalleGrupoId,
      item_nombre: _segItemSeleccionado.nombre,
      cantidad_esperada: cantidad
    });
    closeModal('modal-segstock-item');
    S.stockSeguridad = await StockSeguridad.getAll();
    renderSegStock();
    segRenderItems();
    document.getElementById('modal-segstock-detalle').classList.add('open');
    toast('✓ Ítem añadido','success');
  } catch(err){
    toastError(err.message);
  }
}

// ── EDITAR CANTIDAD DE UN ÍTEM ──
function segAbrirEditarItem(id, nombre, cantidadActual){
  document.getElementById('segedititem-id').value = id;
  document.getElementById('segedititem-nombre').textContent = nombre;
  document.getElementById('segedititem-cantidad').value = cantidadActual;
  document.getElementById('modal-segstock-editar-item').classList.add('open');
}

async function segGuardarEdicionItem(){
  const id = document.getElementById('segedititem-id').value;
  const cantidad = parseInt(document.getElementById('segedititem-cantidad').value);
  if(isNaN(cantidad) || cantidad < 0){ toastError('Ingresa una cantidad válida'); return; }

  try {
    await StockSeguridad.updateItem(id, { cantidad_esperada: cantidad });
    closeModal('modal-segstock-editar-item');
    S.stockSeguridad = await StockSeguridad.getAll();
    renderSegStock();
    segRenderItems();
    toast('✓ Cantidad actualizada','success');
  } catch(err){
    toastError(err.message);
  }
}

// ── ELIMINAR ÍTEM ──
function segConfirmEliminarItem(id, nombre){
  document.getElementById('modal-title').textContent = 'Eliminar ítem';
  document.getElementById('modal-sub').textContent = `¿Eliminar "${nombre}" de la lista de stock de seguridad de este grupo?`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await StockSeguridad.deleteItem(id);
      closeModal('modal-confirm');
      S.stockSeguridad = await StockSeguridad.getAll();
      renderSegStock();
      segRenderItems();
      toast('Ítem eliminado');
    } catch(err){
      toastError(err.message);
      closeModal('modal-confirm');
    }
  };
  document.getElementById('modal-confirm').classList.add('open');
}