// ── AUTOCOMPLETE SKU GLOBAL EN TRAZABILIDAD ──
let _trazAcFocusIdx = -1;

function trazAcFilter(){
  const q    = (document.getElementById('traz-ac-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('traz-ac-drop');
  const clear = document.getElementById('traz-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  _trazAcFocusIdx = -1;

  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const results = S.skusGlobales.filter(g =>
    g.nombre.toLowerCase().includes(q) ||
    g.codigo.toLowerCase().includes(q)
  ).slice(0, 10);

  if(!results.length){
    drop.innerHTML='<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((g, idx) => `
    <div class="ac-item" data-id="${g.id}"
      onmousedown="trazAcSelect(${g.id})"
      onmouseover="_trazAcFocusIdx=${idx};document.querySelectorAll('#traz-ac-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===${idx}))">
      <div class="ac-item-icon"><i class="ti ti-tag"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(escHtml(g.nombre))}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${hilite(escHtml(g.codigo))}</span>
          <span style="font-size:9px;color:#aaa">${escHtml(g.familia||'')}</span>
        </div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function trazAcKey(e){
  const drop  = document.getElementById('traz-ac-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _trazAcFocusIdx = Math.min(_trazAcFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_trazAcFocusIdx));
    items[_trazAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _trazAcFocusIdx = Math.max(_trazAcFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_trazAcFocusIdx));
    items[_trazAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _trazAcFocusIdx>=0){
    e.preventDefault();
    trazAcSelect(parseInt(items[_trazAcFocusIdx].dataset.id));
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function trazAcSelect(id){
  const skuG = S.skusGlobales.find(g => g.id === parseInt(id));
  if(!skuG) return;
  document.getElementById('traz-ac-input').value = `${skuG.codigo} — ${skuG.nombre}`;
  document.getElementById('traz-global').value   = skuG.id;
  document.getElementById('traz-ac-clear').classList.add('show');
  document.getElementById('traz-ac-drop').classList.remove('open');
  updateTrazSubs();
}

function trazAcClear(){
  document.getElementById('traz-ac-input').value = '';
  document.getElementById('traz-global').value   = '';
  document.getElementById('traz-ac-clear').classList.remove('show');
  document.getElementById('traz-ac-drop').classList.remove('open');
  document.getElementById('traz-sub').innerHTML  = '<option value="">Todos los Sub-SKUs</option>';
  document.getElementById('traz-result').innerHTML =
    '<div class="empty-state"><i class="ti ti-timeline"></i><p>Selecciona un SKU para ver su trazabilidad completa</p></div>';
  document.getElementById('traz-ac-input').focus();
}

document.addEventListener('click', e=>{
  const wrap = document.getElementById('traz-ac-wrap');
  if(wrap && !wrap.contains(e.target)) document.getElementById('traz-ac-drop').classList.remove('open');
});

// ── ACTUALIZAR SUB-SKUs ──
async function updateTrazSubs(){
  const gId = parseInt(document.getElementById('traz-global').value)||0;
  const sel = document.getElementById('traz-sub');
  sel.innerHTML='<option value="">Todos los Sub-SKUs</option>';

  document.getElementById('traz-ubicacion').innerHTML = '<option value="">Todas las ubicaciones</option>';
  document.getElementById('traz-deposito').innerHTML  = '<option value="">Todos los depósitos</option>';

  if(!gId){ await renderTrazabilidad(); return; }

  S.subSkus.filter(s=>s.skuGlobalId===gId).forEach(s=>{
    const totalStock = getTotalStock(s);
    const ubicaciones = Object.entries(s.stock||{})
      .filter(([,v])=>v>0)
      .map(([bodega, cant])=>`${escHtml(bodega)}: ${cant}`)
      .join(' · ');
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = totalStock > 0
      ? `${s.subSku} — ${Object.entries(s.stock||{}).filter(([,v])=>v>0).map(([b,c])=>`${b}: ${c}`).join(' · ')}`
      : `${s.subSku} — Sin stock`;
    sel.appendChild(o);
  });

  updateTrazFiltros();
  await renderTrazabilidad();
}

// ── RENDER TRAZABILIDAD ──
async function renderTrazabilidad(){
  const gId = parseInt(document.getElementById('traz-global').value)||0;
  const sId = parseInt(document.getElementById('traz-sub').value)||0;
  const result = document.getElementById('traz-result');

  if(!gId){
    result.innerHTML='<div class="empty-state"><i class="ti ti-timeline"></i><p>Selecciona un SKU Global para ver su trazabilidad</p></div>';
    return;
  }

  try {
    result.innerHTML='<div class="empty-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i><p>Cargando trazabilidad...</p></div>';
    const skuG = S.skusGlobales.find(g=>g.id===gId);
    const params = { sku_global: skuG?.codigo };
    if(sId) params.sub_sku_id = sId;
    const depositoFiltro = document.getElementById('traz-deposito').value;
    if(depositoFiltro) params.bodega = depositoFiltro;
    const movs = await Movimientos.getAll(params);
    const subs = S.subSkus.filter(s=>s.skuGlobalId===gId&&(!sId||s.id===sId));
    const tipoIcon = {
      compra:'ti-shopping-cart', asignacion:'ti-arrow-right',
      traslado:'ti-transfer', consumo:'ti-minus-circle', destruccion:'ti-trash'
    };

    // Fix #11: escHtml en todos los campos de texto del servidor
    result.innerHTML=`
      <div class="card" style="margin-bottom:16px">
        <div class="card-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--blue)">${escHtml(skuG?.codigo)}</div>
              <div style="font-size:15px;font-weight:600;margin-top:4px">${escHtml(skuG?.nombre)}</div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                <span style="font-size:11px;font-weight:600;color:var(--ink)">${escHtml(skuG?.familia||'')}</span>
                <span style="font-size:11px;color:#888">${escHtml(skuG?.subgrupo||'')}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;color:#888;font-family:var(--font-mono)">
                Sub-SKUs activos: ${subs.filter(s=>!s.agotado).length}
              </div>
              <div style="font-size:12px;font-weight:700;margin-top:4px">
                Stock total: ${subs.reduce((a,s)=>a+getTotalStock(s),0)} ${escHtml(subs[0]?.unidad||'')}
              </div>
            </div>
          </div>
        </div>
      </div>
      ${movs.length===0
        ? '<div class="empty-state"><i class="ti ti-timeline"></i><p>Sin movimientos registrados</p></div>'
        : `<div class="sec-title" style="margin-bottom:14px">
             Línea de tiempo (${movs.length} evento${movs.length!==1?'s':''})
           </div>
           <div class="timeline">
             ${movs.map(m=>{
               const nivel = m.usuario_nivel||0;
               return`<div class="tl-item">
                 <div class="tl-dot ${m.tipo}"></div>
                 <div class="tl-card">
                   <div class="tl-header">
                     <div class="tl-tipo ${m.tipo}">
                       <i class="ti ${tipoIcon[m.tipo]||'ti-arrow-right'}" style="margin-right:4px"></i>
                       ${escHtml(m.tipo.toUpperCase())}
                     </div>
                     <div class="tl-fecha">
                       ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                     </div>
                   </div>
                   <div class="tl-desc">
                     ${m.tipo==='compra'
                       ?`Entrada de <strong>${m.cantidad}</strong> unidades → <strong>${escHtml(m.destino_nombre||'—')}</strong>`
                       :m.tipo==='consumo'
                       ?`Consumo de <strong>${m.cantidad}</strong> unidades desde <strong>${escHtml(m.origen_nombre||'—')}</strong>`
                       :m.tipo==='traslado'
                       ?`Traslado de <strong>${m.cantidad}</strong> unidades de <strong>${escHtml(m.origen_nombre||'—')}</strong> a <strong>${escHtml(m.destino_nombre||'—')}</strong>`
                       :`Baja de <strong>${m.cantidad}</strong> unidades desde <strong>${escHtml(m.origen_nombre||'—')}</strong>${m.motivo?' · Motivo: '+escHtml(m.motivo):''}`}
                   </div>
                   <div class="tl-user">
                     <div class="tl-user-dot n${nivel}"></div>
                     <strong>${escHtml(m.usuario_nombre||'—')}</strong>
                     <span class="nivel-badge n${nivel}" style="font-size:9px">
                       ${NIVELES[nivel]?.label||''}
                     </span>
                   </div>
                 </div>
               </div>`;
             }).join('')}
           </div>`
      }`;
  } catch(err){
    result.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error cargando trazabilidad</p></div>';
    toast(err.message,'error');
  }
}

// ── FILTROS UBICACIÓN Y DEPÓSITO EN TRAZABILIDAD ──
function updateTrazFiltros(){
  const gId = parseInt(document.getElementById('traz-global').value)||0;
  const ubSel = document.getElementById('traz-ubicacion');
  const depSel = document.getElementById('traz-deposito');
  ubSel.innerHTML  = '<option value="">Todas las ubicaciones</option>';
  depSel.innerHTML = '<option value="">Todos los depósitos</option>';
  if(!gId) return;

  const subs = S.subSkus.filter(s => s.skuGlobalId === gId);
  const bodegasConStock = new Set();
  subs.forEach(s => Object.keys(s.stock||{}).forEach(b => bodegasConStock.add(b)));

  const ubicacionesVistas = new Set();
  ;(S.bodegasRaw||[]).forEach(b => {
    if(bodegasConStock.has(b.nombre) && b.ubicacion_nombre){
      ubicacionesVistas.add(JSON.stringify({id: b.ubicacion_id, nombre: b.ubicacion_nombre}));
    }
  });

  [...ubicacionesVistas].map(s=>JSON.parse(s)).forEach(u => {
    ubSel.innerHTML += `<option value="${u.id}">${escHtml(u.nombre)}</option>`;
  });
}

function updateTrazDepositos(){
  const ubId  = parseInt(document.getElementById('traz-ubicacion').value)||0;
  const gId   = parseInt(document.getElementById('traz-global').value)||0;
  const depSel = document.getElementById('traz-deposito');
  depSel.innerHTML = '<option value="">Todos los depósitos</option>';

  if(!ubId){ renderTrazabilidad(); return; }

  const subs = S.subSkus.filter(s => s.skuGlobalId === gId);
  const bodegasConStock = new Set();
  subs.forEach(s => Object.keys(s.stock||{}).forEach(b => bodegasConStock.add(b)));

  ;(S.bodegasRaw||[])
    .filter(b => b.ubicacion_id === ubId && bodegasConStock.has(b.nombre))
    .forEach(b => {
      depSel.innerHTML += `<option value="${escHtml(b.nombre)}">${escHtml(b.nombre)}</option>`;
    });

  renderTrazabilidad();
}