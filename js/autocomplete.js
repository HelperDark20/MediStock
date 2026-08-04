const AC = { mov:{ selectedId:null, focusIdx:-1 } };

function acFilter(ns){
  if(ns === 'enf'){ _acFilterEnf(); return; }
  if(ns === 'mov'){ _acFilterMov(); return; }
}

function acOpen(ns){
  if(ns === 'enf'){ _acOpenEnf(); return; }
  if(ns === 'mov'){ _acOpenMov(); return; }
}

// ══════════════════════════════════════════
// MOVIMIENTOS — sugerencias filtradas al depósito de origen elegido
// en el Paso 1, orden FEFO (vence más pronto primero) y badge de
// fecha de vencimiento — mismo patrón que el panel de Enfermero.
// ══════════════════════════════════════════
function _fefoSort(a, b){
  if(!a.caducidad && !b.caducidad) return 0;
  if(!a.caducidad) return 1;
  if(!b.caducidad) return -1;
  return new Date(a.caducidad) - new Date(b.caducidad);
}

function _movSinCoincidencias(bodega, motivo){
  return `<div class="ac-no-results">
    <i class="ti ti-search-off" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>
    Sin coincidencias
    <div style="font-size:11px;margin-top:4px;color:#bbb">${motivo}</div>
  </div>`;
}

function _movItemRow(s, idx, bodega, q){
  const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
  const cantBodega = s.stock?.[bodega]||0;
  const sem = getSem(s.caducidad);
  const hilite = q ? (str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>')) : (str => str);
  return `<div class="ac-item" data-id="${s.id}"
    onmousedown="acSelect('mov',${s.id})"
    onmouseover="acHover('mov',${idx})">
    <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
    <div class="ac-item-body">
      <div class="ac-item-name">${hilite(s.nombre)}</div>
      <div class="ac-item-meta">
        <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
        <span>${hilite(s.subSku)}</span>
        ${s.lote&&s.lote!=='—'?`<span>Lote: ${hilite(s.lote)}</span>`:''}
        <span class="enf-sem ${sem}">Vence: ${fmtDate(s.caducidad)}</span>
      </div>
    </div>
    <div class="ac-item-stock">${cantBodega} ${s.unidad}</div>
  </div>`;
}

function _acFilterMov(){
  const q     = (document.getElementById('mov-ac-input').value||'').toLowerCase().trim();
  const drop  = document.getElementById('mov-ac-drop');
  const clear = document.getElementById('mov-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  AC['mov'].focusIdx = -1;

  const bodega = _movOrigenBodegaNombre;
  if(!bodega){ drop.classList.remove('open'); drop.innerHTML=''; return; }
  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const results = S.subSkus.filter(s => {
    if((s.stock?.[bodega]||0) <= 0) return false;
    return s.nombre.toLowerCase().includes(q) ||
           s.subSku.toLowerCase().includes(q) ||
           (s.lote||'').toLowerCase().includes(q) ||
           (s.proveedor||'').toLowerCase().includes(q);
  }).sort(_fefoSort).slice(0, 10);

  if(!results.length){
    drop.innerHTML = _movSinCoincidencias(bodega, `Este ítem no tiene stock en ${escHtml(bodega)}`);
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map((s, idx) => _movItemRow(s, idx, bodega, q)).join('');
  drop.classList.add('open');
}

function _acOpenMov(){
  const drop = document.getElementById('mov-ac-drop');
  const bodega = _movOrigenBodegaNombre;
  if(!bodega) return;

  const q = document.getElementById('mov-ac-input').value||'';
  if(q){ _acFilterMov(); return; }

  const pool = S.subSkus.filter(s => (s.stock?.[bodega]||0) > 0).sort(_fefoSort);

  if(!pool.length){
    drop.innerHTML = _movSinCoincidencias(bodega, `No hay ítems con stock en ${escHtml(bodega)}`);
    drop.classList.add('open');
    return;
  }

  const shown = pool.slice(0, 8);
  drop.innerHTML = shown.map((s, idx) => _movItemRow(s, idx, bodega, '')).join('') +
    (pool.length>8 ? `<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>` : '');
  drop.classList.add('open');
}

// ══════════════════════════════════════════
// ENFERMERO — sin cambios de comportamiento
// ══════════════════════════════════════════
function _acFilterEnf(){
  const q    = (document.getElementById('enf-ac-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('enf-ac-drop');
  const clear = document.getElementById('enf-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  AC['enf'].focusIdx = -1;

  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const bodega = document.getElementById('enf-origen').value;

  let results = S.subSkus.filter(s => {
    if(bodega && (s.stock?.[bodega]||0) <= 0) return false;
    return s.nombre.toLowerCase().includes(q) ||
           s.subSku.toLowerCase().includes(q) ||
           (s.lote||'').toLowerCase().includes(q) ||
           (s.proveedor||'').toLowerCase().includes(q);
  });

  results = results.sort(_fefoSort).slice(0, 10);

  if(!results.length){
    drop.innerHTML='<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados en esta bodega</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((s, idx) => {
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const cantBodega = bodega ? (s.stock?.[bodega]||0) : getTotalStock(s);
    const sem = getSem(s.caducidad);
    return `<div class="ac-item" data-id="${s.id}"
      onmousedown="acSelect('enf',${s.id})"
      onmouseover="acHover('enf',${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(s.nombre)}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
          <span>${hilite(s.subSku)}</span>
          ${s.lote&&s.lote!=='—'?`<span>Lote: ${hilite(s.lote)}</span>`:''}
          <span class="enf-sem ${sem}">Vence: ${fmtDate(s.caducidad)}</span>
        </div>
      </div>
      <div class="ac-item-stock">${cantBodega} ${s.unidad}</div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function _acOpenEnf(){
  const drop = document.getElementById('enf-ac-drop');
  const bodega = document.getElementById('enf-origen').value;
  const pool = S.subSkus
    .filter(s => !bodega || (s.stock?.[bodega]||0) > 0)
    .sort(_fefoSort)
    .slice(0,8);

  drop.innerHTML = pool.map((s,idx)=>{
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const stock = bodega ? (s.stock?.[bodega]||0) : getTotalStock(s);
    const semEnf = getSem(s.caducidad);
    return`<div class="ac-item" data-id="${s.id}" onmousedown="acSelect('enf',${s.id})" onmouseover="acHover('enf',${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${s.nombre}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
          <span>${s.subSku}</span>
          <span class="enf-sem ${semEnf}">Vence: ${fmtDate(s.caducidad)}</span>
        </div>
      </div>
      <div class="ac-item-stock">${stock} ${s.unidad}</div>
    </div>`;
  }).join('')+(S.subSkus.length>8?`<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>`:'');
  drop.classList.add('open');
}

// ══════════════════════════════════════════
// COMPARTIDO: selección, limpieza, hover, teclado
// ══════════════════════════════════════════
function acSelect(ns, id){
  const sub = S.subSkus.find(s=>s.id===parseInt(id));
  if(!sub) return;
  AC[ns].selectedId = sub.id;
  document.getElementById(`${ns}-sku`).value = sub.id;
  document.getElementById(`${ns}-ac-input`).value = sub.nombre;
  document.getElementById(`${ns}-ac-clear`).classList.add('show');
  document.getElementById(`${ns}-ac-drop`).classList.remove('open');
  const pill = document.getElementById(`${ns}-ac-pill`);
  document.getElementById(`${ns}-ac-pill-text`).innerHTML =
    `${sub.nombre} <span style="opacity:.6;font-size:11px">${sub.subSku} · ${getTotalStock(sub)} ${sub.unidad}</span>`;
  pill.classList.add('show');
  if(ns==='mov') updateMovInfo();
  if(ns==='enf') enfOnMedSelect(sub);
}

function acClear(ns){
  AC[ns].selectedId = null;
  document.getElementById(`${ns}-sku`).value = '';
  document.getElementById(`${ns}-ac-input`).value = '';
  document.getElementById(`${ns}-ac-clear`).classList.remove('show');
  document.getElementById(`${ns}-ac-drop`).classList.remove('open');
  document.getElementById(`${ns}-ac-pill`).classList.remove('show');
  const input = document.getElementById(`${ns}-ac-input`);
  if(input && !input.disabled) input.focus();
  if(ns==='mov'){
    document.getElementById('mov-stock-info').textContent='—';
    const tipoWrap = document.getElementById('mov-tipo-wrap');
    if(tipoWrap) tipoWrap.style.display = 'none';
  }
}

function acHover(ns, idx){
  AC[ns].focusIdx = idx;
  document.querySelectorAll(`#${ns}-ac-drop .ac-item`).forEach((el,i)=>el.classList.toggle('focused',i===idx));
}

function acKey(e, ns){
  const drop = document.getElementById(`${ns}-ac-drop`);
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    AC[ns].focusIdx = Math.min(AC[ns].focusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===AC[ns].focusIdx));
    items[AC[ns].focusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    AC[ns].focusIdx = Math.max(AC[ns].focusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===AC[ns].focusIdx));
    items[AC[ns].focusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter'&&AC[ns].focusIdx>=0){
    e.preventDefault();
    acSelect(ns, parseInt(items[AC[ns].focusIdx].dataset.id));
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

document.addEventListener('click', e=>{
  ['mov','enf'].forEach(ns=>{
    const wrap = document.getElementById(`${ns}-ac-wrap`);
    if(wrap&&!wrap.contains(e.target)) document.getElementById(`${ns}-ac-drop`).classList.remove('open');
  });
});