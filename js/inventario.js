function renderInv(){
  const q=(document.getElementById('inv-search').value||'').toLowerCase();
  const deposito=document.getElementById('inv-ubicacion').value;
  const sedeId=parseInt(document.getElementById('inv-sede-id')?.value)||0;
  const subSkuId=parseInt(document.getElementById('inv-subsku-id')?.value)||0;
  const sem=document.getElementById('inv-sem').value;
  const fam=document.getElementById('inv-familia').value;
  const showAgotados=document.getElementById('inv-agotados')?.checked;

  const bodegasDeSede = sedeId
    ? new Set((S.bodegasRaw||[]).filter(b=>b.ubicacion_id===sedeId).map(b=>b.nombre))
    : null;

  let rows = [];
  S.subSkus.forEach(s=>{
    if(subSkuId && s.id!==subSkuId) return;
    if(s.agotado&&!showAgotados) return;
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const st = getSem(s.caducidad);
    if(sem&&st!==sem) return;
    if(fam&&skuG?.familia!==fam) return;
    if(q&&!s.nombre.toLowerCase().includes(q)&&!s.subSku.toLowerCase().includes(q)&&!(skuG?.codigo||'').toLowerCase().includes(q)&&!s.lote?.toLowerCase().includes(q)&&!s.proveedor?.toLowerCase().includes(q)) return;

    let stockEntries;
    if(deposito){
      stockEntries = [[deposito, s.stock?.[deposito]||0]];
    } else if(bodegasDeSede){
      stockEntries = Object.entries(s.stock||{}).filter(([bodega])=>bodegasDeSede.has(bodega));
    } else {
      stockEntries = Object.entries(s.stock||{});
    }

    stockEntries.forEach(([ubicacion, cantidad])=>{
      if(cantidad === 0 && !showAgotados) return;
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
  // Fix #11: escHtml() en codigo, nombre, subSku, ubicacion, unidad
  el.innerHTML = rows.map(({s,skuG,st,ubicacion,cantidad})=>`
    <tr style="${s.agotado?'opacity:.5;':''}">
      <td><span class="sku-code">${escHtml(skuG?.codigo||'—')}</span></td>
      <td>
        <div style="font-weight:500;font-size:13px">${escHtml(s.nombre)}</div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          <span class="fam ${skuG?.familia||''}">${FAMILIAS[skuG?.familia]||''}</span>
          ${s.agotado?'<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:#F0F0EE;color:#888;font-family:var(--font-mono);font-weight:700">AGOTADO</span>':''}
        </div>
      </td>
      <td><span class="sub-sku">${escHtml(s.subSku)}</span></td>
      <td><span class="ubic">${escHtml(ubicacion)}</span></td>
      <td style="font-family:var(--font-mono);font-weight:700">${cantidad}<span style="font-size:10px;color:#aaa;font-weight:400;margin-left:3px">${escHtml(s.unidad)}</span></td>
      <td style="font-size:12px;font-family:var(--font-mono)">${fmtDate(s.caducidad)}</td>
      <td>${s.agotado?'<span class="sem N">Agotado</span>':`<span class="sem ${st}">${semLabel(st)}</span>`}</td>
      <td>
        <div class="act-btn-group">
          ${canAct?`<button class="act-btn primary" onclick="quickMov(${s.id},'${escHtml(ubicacion)}')" title="Movimiento"><i class="ti ti-transfer"></i></button>`:''}
          ${currentRole>=4?`<button class="act-btn danger" onclick="confirmDelete(${s.id})" title="Eliminar"><i class="ti ti-trash"></i></button>`:''}
        </div>
      </td>
    </tr>`).join('');
}

// ══════════════════════════════════════════
// AUTOCOMPLETE: FILTRO DE UBICACIÓN / SEDE
// ══════════════════════════════════════════
let _invSedeFocusIdx = -1;

function invSedeFilter(){
  const q = (document.getElementById('inv-sede-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('inv-sede-drop');
  const clear = document.getElementById('inv-sede-clear');
  clear.classList.toggle('show', q.length > 0);
  _invSedeFocusIdx = -1;

  const results = (S.ubicaciones||[]).filter(u => !q || u.nombre.toLowerCase().includes(q));

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results"><i class="ti ti-map-pin-off" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin ubicaciones</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : escHtml(str);

  drop.innerHTML = results.map((u, idx) => {
    const totalDepositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===u.id).length;
    return `<div class="ac-item" data-id="${u.id}" data-nombre="${escHtml(u.nombre)}"
      onmousedown="invSedeSelect(${u.id},'${escHtml(u.nombre).replace(/'/g,"\\'")}')"
      onmouseover="invSedeHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-map-pin"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(u.nombre)}</div>
        <div class="ac-item-meta">${totalDepositos} depósito${totalDepositos!==1?'s':''}</div>
      </div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function invSedeOpen(){ invSedeFilter(); }

function invSedeHover(idx){
  _invSedeFocusIdx = idx;
  document.querySelectorAll('#inv-sede-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused', i===idx));
}

function invSedeKey(e){
  const drop = document.getElementById('inv-sede-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _invSedeFocusIdx = Math.min(_invSedeFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invSedeFocusIdx));
    items[_invSedeFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _invSedeFocusIdx = Math.max(_invSedeFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invSedeFocusIdx));
    items[_invSedeFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _invSedeFocusIdx>=0){
    e.preventDefault();
    const item = items[_invSedeFocusIdx];
    invSedeSelect(parseInt(item.dataset.id), item.dataset.nombre);
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function invSedeSelect(id, nombre){
  document.getElementById('inv-sede-input').value = nombre;
  document.getElementById('inv-sede-id').value = id;
  document.getElementById('inv-sede-clear').classList.add('show');
  document.getElementById('inv-sede-drop').classList.remove('open');
  invDepositoClear(false);
  invSubClear(false);
  renderInv();
}

function invSedeClear(){
  document.getElementById('inv-sede-input').value = '';
  document.getElementById('inv-sede-id').value = '';
  document.getElementById('inv-sede-clear').classList.remove('show');
  document.getElementById('inv-sede-drop').classList.remove('open');
  invDepositoClear(false);
  invSubClear(false);
  renderInv();
}

// ══════════════════════════════════════════
// AUTOCOMPLETE: FILTRO DE DEPÓSITO
// ══════════════════════════════════════════
let _invDepositoFocusIdx = -1;

function invDepositoFilter(){
  const q = (document.getElementById('inv-deposito-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('inv-deposito-drop');
  const clear = document.getElementById('inv-deposito-clear');
  clear.classList.toggle('show', q.length > 0);
  _invDepositoFocusIdx = -1;

  const sedeId = parseInt(document.getElementById('inv-sede-id').value)||0;
  let pool = S.bodegasRaw || [];
  if(sedeId) pool = pool.filter(b => b.ubicacion_id === sedeId);

  const results = pool.filter(b => !q || b.nombre.toLowerCase().includes(q));

  if(!results.length){
    const msg = sedeId ? 'Sin depósitos en esta ubicación' : 'Sin depósitos';
    drop.innerHTML = `<div class="ac-no-results"><i class="ti ti-building-warehouse" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>${msg}</div>`;
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : escHtml(str);

  drop.innerHTML = results.map((b, idx) => `
    <div class="ac-item" data-nombre="${escHtml(b.nombre)}" data-sede-id="${b.ubicacion_id||''}" data-sede-nombre="${escHtml(b.ubicacion_nombre||'')}"
      onmousedown="invDepositoSelect('${escHtml(b.nombre).replace(/'/g,"\\'")}', ${b.ubicacion_id||'null'}, '${escHtml(b.ubicacion_nombre||'').replace(/'/g,"\\'")}')"
      onmouseover="invDepositoHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-building-warehouse"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(b.nombre)}</div>
        ${!sedeId && b.ubicacion_nombre ? `<div class="ac-item-meta">${escHtml(b.ubicacion_nombre)}</div>` : ''}
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function invDepositoOpen(){ invDepositoFilter(); }

function invDepositoHover(idx){
  _invDepositoFocusIdx = idx;
  document.querySelectorAll('#inv-deposito-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused', i===idx));
}

function invDepositoKey(e){
  const drop = document.getElementById('inv-deposito-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _invDepositoFocusIdx = Math.min(_invDepositoFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invDepositoFocusIdx));
    items[_invDepositoFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _invDepositoFocusIdx = Math.max(_invDepositoFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused', i===_invDepositoFocusIdx));
    items[_invDepositoFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _invDepositoFocusIdx>=0){
    e.preventDefault();
    const item = items[_invDepositoFocusIdx];
    const sedeIdRaw = item.dataset.sedeId;
    invDepositoSelect(item.dataset.nombre, sedeIdRaw?parseInt(sedeIdRaw):null, item.dataset.sedeNombre);
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function invDepositoSelect(nombre, sedeId, sedeNombre){
  document.getElementById('inv-deposito-input').value = nombre;
  document.getElementById('inv-ubicacion').value = nombre;
  document.getElementById('inv-deposito-clear').classList.add('show');
  document.getElementById('inv-deposito-drop').classList.remove('open');
  if(sedeId){
    document.getElementById('inv-sede-input').value = sedeNombre||'';
    document.getElementById('inv-sede-id').value = sedeId;
    document.getElementById('inv-sede-clear').classList.add('show');
  }
  invSubClear(false);
  renderInv();
}

function invDepositoClear(rerender = true){
  document.getElementById('inv-deposito-input').value = '';
  document.getElementById('inv-ubicacion').value = '';
  document.getElementById('inv-deposito-clear').classList.remove('show');
  document.getElementById('inv-deposito-drop').classList.remove('open');
  if(rerender){ invSubClear(false); renderInv(); }
}

// ══════════════════════════════════════════
// AUTOCOMPLETE: FILTRO DE SUB-SKU
// ══════════════════════════════════════════
let _invSubFocusIdx = -1;

function invSubFilter(){
  const q = (document.getElementById('inv-subsku-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('inv-subsku-drop');
  const clear = document.getElementById('inv-subsku-clear');
  clear.classList.toggle('show', q.length > 0);
  _invSubFocusIdx = -1;

  const deposito = document.getElementById('inv-ubicacion').value;
  const sedeId = parseInt(document.getElementById('inv-sede-id').value)||0;
  const bodegasDeSede = sedeId
    ? new Set((S.bodegasRaw||[]).filter(b=>b.ubicacion_id===sedeId).map(b=>b.nombre))
    : null;

  let pool = S.subSkus || [];
  if(deposito){
    pool = pool.filter(s => s.stock && Object.prototype.hasOwnProperty.call(s.stock, deposito));
  } else if(bodegasDeSede){
    pool = pool.filter(s => s.stock && Object.keys(s.stock).some(b => bodegasDeSede.has(b)));
  }

  const results = pool.filter(s =>
    !q || s.subSku.toLowerCase().includes(q) || s.nombre.toLowerCase().includes(q)
  ).slice(0, 10);

  if(!results.length){
    const ctx = deposito ? ` en ${deposito}` : (sedeId ? ' en esta ubicación' : '');
    drop.innerHTML = `<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados${escHtml(ctx)}</div>`;
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : escHtml(str);

  drop.innerHTML = results.map((s, idx) => {
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    let cant;
    if(deposito) cant = s.stock?.[deposito]||0;
    else if(bodegasDeSede) cant = Object.entries(s.stock||{}).filter(([b])=>bodegasDeSede.has(b)).reduce((a,[,v])=>a+v,0);
    else cant = getTotalStock(s);
    return `<div class="ac-item" data-id="${s.id}"
      onmousedown="invSubSelect(${s.id})"
      onmouseover="invSubHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(s.subSku)}</div>
        <div class="ac-item-meta">
          ${skuG?`<span class="sku-code" style="font-size:9px">${escHtml(skuG.codigo)}</span>`:''}
          <span>${hilite(s.nombre)}</span>
        </div>
      </div>
      <div class="ac-item-stock">${cant} ${escHtml(s.unidad)}</div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function invSubOpen(){ invSubFilter(); }

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
  const sedeWrap = document.getElementById('inv-sede-wrap');
  if(sedeWrap && !sedeWrap.contains(e.target)) document.getElementById('inv-sede-drop')?.classList.remove('open');
  const depositoWrap = document.getElementById('inv-deposito-wrap');
  if(depositoWrap && !depositoWrap.contains(e.target)) document.getElementById('inv-deposito-drop')?.classList.remove('open');
  const subWrap = document.getElementById('inv-subsku-wrap');
  if(subWrap && !subWrap.contains(e.target)) document.getElementById('inv-subsku-drop')?.classList.remove('open');
});