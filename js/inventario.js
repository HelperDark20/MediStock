function renderInv(){
  const q=(document.getElementById('inv-search').value||'').toLowerCase();
  const ub=document.getElementById('inv-ubicacion').value;
  const subSkuId=parseInt(document.getElementById('inv-subsku-id')?.value)||0;
  const sem=document.getElementById('inv-sem').value;
  const fam=document.getElementById('inv-familia').value;
  const showAgotados=document.getElementById('inv-agotados')?.checked;

  let rows = [];
  S.subSkus.forEach(s=>{
    if(subSkuId && s.id!==subSkuId) return;
    if(s.agotado&&!showAgotados) return;
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const st = getSem(s.caducidad);
    if(sem&&st!==sem) return;
    if(fam&&skuG?.familia!==fam) return;
    if(q&&!s.nombre.toLowerCase().includes(q)&&!s.subSku.toLowerCase().includes(q)&&!(skuG?.codigo||'').toLowerCase().includes(q)&&!s.lote?.toLowerCase().includes(q)&&!s.proveedor?.toLowerCase().includes(q)) return;
    const stockEntries = ub ? [[ub, s.stock?.[ub]||0]] : Object.entries(s.stock||{});
    stockEntries.forEach(([ubicacion, cantidad])=>{
      // Sin filtro: ocultar cantidad 0. Con filtro: igual, salvo que showAgotados esté activo
      if(cantidad === 0 && !showAgotados) return;
      // Si agotado y no showAgotados ya se filtró arriba, pero si tiene stock 0 en esa bodega específica
      // solo mostrar si el item ya tuvo stock ahí (existe la entrada en stock) y showAgotados activo
      if(cantidad === 0 && !s.stock?.hasOwnProperty(ubicacion)) return;
      rows.push({s,skuG,st,ubicacion,cantidad});
    });
  });

  const canAct = currentRole>=2;
  const el = document.getElementById('inv-body');
  if(!rows.length){
    el.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="ti ti-search"></i><p>Sin resultados</p></div></td></tr>';
    return;
  }
  el.innerHTML = rows.map(({s,skuG,st,ubicacion,cantidad})=>`
    <tr style="${s.agotado?'opacity:.5;':''}">
      <td><span class="sku-code">${skuG?.codigo||'—'}</span></td>
      <td>
        <div style="font-weight:500;font-size:13px">${s.nombre}</div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          <span class="fam ${skuG?.familia||''}">${FAMILIAS[skuG?.familia]||''}</span>
          ${s.agotado?'<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:#F0F0EE;color:#888;font-family:var(--font-mono);font-weight:700">AGOTADO</span>':''}
        </div>
      </td>
      <td><span class="sub-sku">${s.subSku}</span></td>
      <td><span class="ubic">${ubicacion}</span></td>
      <td style="font-family:var(--font-mono);font-weight:700">${cantidad}<span style="font-size:10px;color:#aaa;font-weight:400;margin-left:3px">${s.unidad}</span></td>
      <td style="font-size:12px;font-family:var(--font-mono)">${fmtDate(s.caducidad)}</td>
      <td>${s.agotado?'<span class="sem N">Agotado</span>':`<span class="sem ${st}">${semLabel(st)}</span>`}</td>
      <td>
        <div class="act-btn-group">
          ${canAct?`<button class="act-btn primary" onclick="quickMov(${s.id},'${ubicacion}')" title="Movimiento"><i class="ti ti-transfer"></i></button>`:''}
          ${currentRole>=4?`<button class="act-btn danger" onclick="confirmDelete(${s.id})" title="Eliminar"><i class="ti ti-trash"></i></button>`:''}
        </div>
      </td>
    </tr>`).join('');
}

// ══════════════════════════════════════════
// AUTOCOMPLETE: FILTRO DE UBICACIÓN (Inventario)
// ══════════════════════════════════════════
let _invUbFocusIdx = -1;

function invUbFilter(){
  const q = (document.getElementById('inv-ub-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('inv-ub-drop');
  const clear = document.getElementById('inv-ub-clear');
  clear.classList.toggle('show', q.length > 0);
  _invUbFocusIdx = -1;

  const results = (S.bodegas||[]).filter(b => !q || b.toLowerCase().includes(q));

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results"><i class="ti ti-map-pin-off" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin ubicaciones</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : str;

  drop.innerHTML = results.map((b, idx) => `
    <div class="ac-item" data-val="${b}"
      onmousedown="invUbSelect('${b.replace(/'/g,"\\'")}')"
      onmouseover="invUbHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-map-pin"></i></div>
      <div class="ac-item-body"><div class="ac-item-name">${hilite(b)}</div></div>
    </div>`).join('');
  drop.classList.add('open');
}

function invUbOpen(){
  invUbFilter();
}

function invUbHover(idx){
  _invUbFocusIdx = idx;
  document.querySelectorAll('#inv-ub-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused', i===idx));
}

function invUbKey(e){
  const drop = document.getElementById('inv-ub-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _invUbFocusIdx = Math.min(_invUbFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invUbFocusIdx));
    items[_invUbFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _invUbFocusIdx = Math.max(_invUbFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invUbFocusIdx));
    items[_invUbFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _invUbFocusIdx>=0){
    e.preventDefault();
    invUbSelect(items[_invUbFocusIdx].dataset.val);
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function invUbSelect(nombre){
  document.getElementById('inv-ub-input').value = nombre;
  document.getElementById('inv-ubicacion').value = nombre;
  document.getElementById('inv-ub-clear').classList.add('show');
  document.getElementById('inv-ub-drop').classList.remove('open');
  // El sub-SKU seleccionado puede ya no pertenecer a esta ubicación: se limpia
  invSubClear(false);
  renderInv();
}

function invUbClear(){
  document.getElementById('inv-ub-input').value = '';
  document.getElementById('inv-ubicacion').value = '';
  document.getElementById('inv-ub-clear').classList.remove('show');
  document.getElementById('inv-ub-drop').classList.remove('open');
  invSubClear(false);
  renderInv();
}

// ══════════════════════════════════════════
// AUTOCOMPLETE: FILTRO DE SUB-SKU (Inventario)
// Sugiere solo sub-SKUs existentes en la ubicación seleccionada
// ══════════════════════════════════════════
let _invSubFocusIdx = -1;

function invSubFilter(){
  const q = (document.getElementById('inv-subsku-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('inv-subsku-drop');
  const clear = document.getElementById('inv-subsku-clear');
  clear.classList.toggle('show', q.length > 0);
  _invSubFocusIdx = -1;

  const ub = document.getElementById('inv-ubicacion').value;

  let pool = S.subSkus || [];
  if(ub){
    pool = pool.filter(s => s.stock && Object.prototype.hasOwnProperty.call(s.stock, ub));
  }

  const results = pool.filter(s =>
    !q ||
    s.subSku.toLowerCase().includes(q) ||
    s.nombre.toLowerCase().includes(q)
  ).slice(0, 10);

  if(!results.length){
    drop.innerHTML = `<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados${ub?` en ${ub}`:''}</div>`;
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : str;

  drop.innerHTML = results.map((s, idx) => {
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const cant = ub ? (s.stock?.[ub]||0) : getTotalStock(s);
    return `<div class="ac-item" data-id="${s.id}"
      onmousedown="invSubSelect(${s.id})"
      onmouseover="invSubHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(s.subSku)}</div>
        <div class="ac-item-meta">
          ${skuG?`<span class="sku-code" style="font-size:9px">${skuG.codigo}</span>`:''}
          <span>${hilite(s.nombre)}</span>
        </div>
      </div>
      <div class="ac-item-stock">${cant} ${s.unidad}</div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function invSubOpen(){
  invSubFilter();
}

function invSubHover(idx){
  _invSubFocusIdx = idx;
  document.querySelectorAll('#inv-subsku-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused', i===idx));
}

function invSubKey(e){
  const drop = document.getElementById('inv-subsku-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _invSubFocusIdx = Math.min(_invSubFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invSubFocusIdx));
    items[_invSubFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _invSubFocusIdx = Math.max(_invSubFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invSubFocusIdx));
    items[_invSubFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _invSubFocusIdx>=0){
    e.preventDefault();
    invSubSelect(parseInt(items[_invSubFocusIdx].dataset.id));
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function invSubSelect(id){
  const sub = S.subSkus.find(s=>s.id===parseInt(id));
  if(!sub) return;
  document.getElementById('inv-subsku-input').value = sub.subSku;
  document.getElementById('inv-subsku-id').value = sub.id;
  document.getElementById('inv-subsku-clear').classList.add('show');
  document.getElementById('inv-subsku-drop').classList.remove('open');
  renderInv();
}

function invSubClear(rerender = true){
  document.getElementById('inv-subsku-input').value = '';
  document.getElementById('inv-subsku-id').value = '';
  document.getElementById('inv-subsku-clear').classList.remove('show');
  document.getElementById('inv-subsku-drop').classList.remove('open');
  if(rerender) renderInv();
}

document.addEventListener('click', e=>{
  const ubWrap = document.getElementById('inv-ub-wrap');
  if(ubWrap && !ubWrap.contains(e.target)) document.getElementById('inv-ub-drop')?.classList.remove('open');
  const subWrap = document.getElementById('inv-subsku-wrap');
  if(subWrap && !subWrap.contains(e.target)) document.getElementById('inv-subsku-drop')?.classList.remove('open');
});