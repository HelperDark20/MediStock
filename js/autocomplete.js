const AC = { mov:{ selectedId:null, focusIdx:-1 } };

function acFilter(ns){
  const q = (document.getElementById(`${ns}-ac-input`).value||'').toLowerCase().trim();
  const drop = document.getElementById(`${ns}-ac-drop`);
  const clear = document.getElementById(`${ns}-ac-clear`);
  clear.classList.toggle('show', q.length>0);
  AC[ns].focusIdx = -1;
  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const results = S.subSkus.filter(s=>!s.agotado&&(
    s.nombre.toLowerCase().includes(q)||
    s.subSku.toLowerCase().includes(q)||
    (s.lote||'').toLowerCase().includes(q)||
    (s.proveedor||'').toLowerCase().includes(q)
  )).slice(0,10);

  if(!results.length){
    drop.innerHTML='<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = (str)=>str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((s,idx)=>{
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const total = getTotalStock(s);
    const ubicaciones = Object.entries(s.stock||{}).filter(([,v])=>v>0).map(([k])=>k).join(', ');
    return`<div class="ac-item" data-id="${s.id}" onmousedown="acSelect('${ns}',${s.id})" onmouseover="acHover('${ns}',${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(s.nombre)}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
          <span>${hilite(s.subSku)}</span>
          ${s.lote&&s.lote!=='—'?`<span>Lote: ${hilite(s.lote)}</span>`:''}
          <span style="background:var(--cream2);color:#666;padding:1px 6px;border-radius:4px;font-size:9px">${ubicaciones}</span>
        </div>
      </div>
      <div class="ac-item-stock">${total} ${s.unidad}</div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function acOpen(ns){
  const q = document.getElementById(`${ns}-ac-input`).value||'';
  if(q){ acFilter(ns); return; }
  const drop = document.getElementById(`${ns}-ac-drop`);
  const all = S.subSkus.filter(s=>!s.agotado).slice(0,8);
  drop.innerHTML = all.map((s,idx)=>{
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const ubicaciones = Object.entries(s.stock||{}).filter(([,v])=>v>0).map(([k])=>k).join(', ');
    return`<div class="ac-item" data-id="${s.id}" onmousedown="acSelect('${ns}',${s.id})" onmouseover="acHover('${ns}',${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${s.nombre}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
          <span>${s.subSku}</span>
          <span style="background:var(--cream2);color:#666;padding:1px 6px;border-radius:4px;font-size:9px">${ubicaciones}</span>
        </div>
      </div>
      <div class="ac-item-stock">${getTotalStock(s)} ${s.unidad}</div>
    </div>`;
  }).join('')+(S.subSkus.length>8?`<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>`:'');
  drop.classList.add('open');
}

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
  document.getElementById(`${ns}-ac-input`).focus();
  if(ns==='mov') document.getElementById('mov-stock-info').textContent='Selecciona un ítem para ver el stock disponible';
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