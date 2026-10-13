let _invAlertFilter = null; // null | 'alertas' | 'vencidos'

// ── Filtro de Familia dinámico ──
// Ya no es una lista fija de códigos — se arma con las familias que
// realmente existen en tus SKUs, así que sirve para cualquier familia
// (nueva o vieja) sin importar cómo se haya escrito.
function populateInvFamilias(){
  const sel = document.getElementById('inv-familia');
  if(!sel) return;
  const current = sel.value;
  const familias = [...new Set((S.skusGlobales||[]).map(g=>g.familia).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = '<option value="">Familia</option>' +
    familias.map(f=>`<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
  if(current && familias.includes(current)) sel.value = current;
}

// Aplica todos los filtros activos de Inventario (búsqueda, ubicación,
// depósito, sub-SKU, semáforo, familia, agotados y filtros de alerta del
// dashboard). La usan la tabla y la descarga en PDF, para que el PDF
// muestre exactamente lo mismo que se ve en pantalla.
function _invFilasFiltradas(){
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

    if(showAgotados){
      if(!s.agotado) return;
    } else {
      if(s.agotado) return;
    }

    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const st = getSem(s.caducidad);

    if(_invAlertFilter==='alertas'){
      if(s.agotado) return;
      if(!['P','R','A'].includes(st)) return;
    } else if(_invAlertFilter==='vencidos'){
      if(s.agotado) return;
      if(st!=='N') return;
    } else if(sem && st!==sem){
      return;
    }

    if(fam && skuG?.familia!==fam) return;
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
      if(cantidad === 0 && !(s.stock && Object.prototype.hasOwnProperty.call(s.stock, ubicacion))) return;
      rows.push({s,skuG,st,ubicacion,cantidad});
    });
  });

  // Cuando el filtro activo es de vencimiento (alertas/vencidos desde el
  // dashboard, o el select de semáforo con N/P/R/A) se agrupan las filas
  // por depósito: primero todos los ítems de un depósito, luego los del
  // siguiente, en vez de mezclarlos en el orden natural de S.subSkus.
  const agruparPorDeposito = _invAlertFilter==='alertas' || _invAlertFilter==='vencidos' || ['N','P','R','A'].includes(sem);
  if(agruparPorDeposito){
    rows.sort((a,b)=>
      a.ubicacion.localeCompare(b.ubicacion) ||
      a.s.nombre.localeCompare(b.s.nombre)
    );
  }

  return { rows, sem };
}

function renderInv(){
  populateInvFamilias();
  const { rows } = _invFilasFiltradas();

  const banner = document.getElementById('inv-alert-banner');
  if(banner){
    if(_invAlertFilter==='alertas'){
      banner.className = 'alert-banner show amber';
      banner.innerHTML = `<i class="ti ti-alert-triangle"></i><span style="flex:1">Mostrando ítems en alerta de vencimiento (próximos 180 días)</span><button class="act-btn" onclick="invClearAlertFilter()" title="Quitar filtro"><i class="ti ti-x"></i></button>`;
    } else if(_invAlertFilter==='vencidos'){
      banner.className = 'alert-banner show red';
      banner.innerHTML = `<i class="ti ti-alert-circle"></i><span style="flex:1">Mostrando ítems vencidos — pendientes de destrucción</span><button class="act-btn" onclick="invClearAlertFilter()" title="Quitar filtro"><i class="ti ti-x"></i></button>`;
    } else {
      banner.className = 'alert-banner';
      banner.innerHTML = '';
    }
  }

  const canAct = currentRole>=2;
  const el = document.getElementById('inv-body');
  if(!rows.length){
    el.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="ti ti-search"></i><p>Sin resultados</p></div></td></tr>';
    return;
  }
  el.innerHTML = rows.map(({s,skuG,st,ubicacion,cantidad})=>`
    <tr style="${s.agotado?'opacity:.5;':''}">
      <td data-label="SKU global"><span class="sku-code">${skuG?.codigo||'—'}</span></td>
      <td data-label="Ítem">
        <div style="font-weight:500;font-size:13px">${s.nombre}</div>
        <div class="mrow-meta">${skuG?.codigo||''} · ${s.subSku} · ${ubicacion} · ${fmtDate(s.caducidad)}</div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          ${famBadge(skuG?.familia)}
          ${s.agotado?'<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:#F0F0EE;color:#888;font-family:var(--font-mono);font-weight:700">AGOTADO</span>':''}
        </div>
      </td>
      <td data-label="Sub-SKU"><span class="sub-sku">${s.subSku}</span></td>
      <td data-label="Ubicación"><span class="ubic">${ubicacion}</span></td>
      <td data-label="Cant." style="font-family:var(--font-mono);font-weight:700">${cantidad}<span style="font-size:10px;color:#aaa;font-weight:400;margin-left:3px">${s.unidad}</span></td>
      <td data-label="Caducidad" style="font-size:12px;font-family:var(--font-mono)">${fmtDate(s.caducidad)}</td>
      <td data-label="Estado">${s.agotado?'<span class="sem N">Agotado</span>':`<span class="sem ${st}">${semLabel(st)}</span>`}</td>
      <td data-label="">
        <div class="act-btn-group">
          ${canAct?`<button class="act-btn primary" onclick="quickMov(${s.id},'${ubicacion}')" title="Movimiento"><i class="ti ti-transfer"></i></button>`:''}
          ${currentRole>=4?`<button class="act-btn danger" onclick="confirmDelete(${s.id})" title="Eliminar"><i class="ti ti-trash"></i></button>`:''}
        </div>
      </td>
    </tr>`).join('');
}

function invSetAlertFilter(tipo){
  _invAlertFilter = tipo;
  document.getElementById('inv-sem').value = '';
  const ag = document.getElementById('inv-agotados');
  if(ag) ag.checked = false;
  renderInv();
}

function invClearAlertFilter(){
  _invAlertFilter = null;
  renderInv();
}

function invSemChanged(){
  _invAlertFilter = null;
  renderInv();
}

// ══════════════════════════════════════════
// DESCARGAR PDF DEL INVENTARIO
// Usa los mismos filtros que la tabla y el mismo diseño de los reportes
// (encabezado con logo, indicadores y grupos por ubicación / depósito).
// Se genera con la impresión del navegador → "Guardar como PDF".
// ══════════════════════════════════════════
function _invDescripcionFiltros(){
  const partes = [];
  const sedeId = parseInt(document.getElementById('inv-sede-id')?.value)||0;
  const deposito = document.getElementById('inv-ubicacion').value;
  const subSkuId = parseInt(document.getElementById('inv-subsku-id')?.value)||0;
  const sem = document.getElementById('inv-sem').value;
  const fam = document.getElementById('inv-familia').value;
  const q = (document.getElementById('inv-search').value||'').trim();

  if(sedeId) partes.push(`Ubicación: <b>${escHtml((S.ubicaciones||[]).find(u=>u.id===sedeId)?.nombre||'—')}</b>`);
  if(deposito) partes.push(`Depósito: <b>${escHtml(deposito)}</b>`);
  if(!sedeId && !deposito) partes.push('<b>Todas las ubicaciones y depósitos</b>');
  if(subSkuId) partes.push(`Sub-SKU: <b>${escHtml((S.subSkus||[]).find(s=>s.id===subSkuId)?.subSku||'—')}</b>`);
  if(fam) partes.push(`Familia: <b>${escHtml(fam)}</b>`);
  if(_invAlertFilter==='alertas') partes.push('<b>Solo ítems en alerta de vencimiento</b>');
  else if(_invAlertFilter==='vencidos') partes.push('<b>Solo ítems vencidos</b>');
  else if(sem) partes.push(`Estado: <b>${escHtml(semLabel(sem))}</b>`);
  if(document.getElementById('inv-agotados')?.checked) partes.push('<b>Solo agotados</b>');
  if(q) partes.push(`Búsqueda: <b>“${escHtml(q)}”</b>`);
  return partes.join(' · ');
}

// Inventario · Ubicación · Depósito (solo los filtrados) · Fecha
function _invTituloDocumento(){
  const partes = ['Inventario'];
  const sedeId = parseInt(document.getElementById('inv-sede-id')?.value)||0;
  const deposito = document.getElementById('inv-ubicacion').value;
  let ubNombre = sedeId ? (S.ubicaciones||[]).find(u=>u.id===sedeId)?.nombre : '';
  if(!ubNombre && deposito) ubNombre = (S.bodegasRaw||[]).find(b=>b.nombre===deposito)?.ubicacion_nombre;
  if(ubNombre) partes.push(ubNombre);
  if(deposito) partes.push(deposito);
  partes.push(_repFechaTitulo(fechaColombia()));
  return partes.join(' · ');
}

function invExportPDF(){
  const { rows } = _invFilasFiltradas();
  if(!rows.length){ toastError('No hay ítems para descargar con los filtros actuales'); return; }

  const ubPorDeposito = {};
  (S.bodegasRaw||[]).forEach(b=>{ ubPorDeposito[b.nombre] = b.ubicacion_nombre || 'Sin ubicación'; });

  const filas = rows.map(r => ({ ...r, ubNombre: ubPorDeposito[r.ubicacion] || 'Sin ubicación' }))
    .sort((a,b)=>
      a.ubNombre.localeCompare(b.ubNombre) ||
      a.ubicacion.localeCompare(b.ubicacion) ||
      a.s.nombre.localeCompare(b.s.nombre)
    );

  const counts = { N:0, alerta:0 };
  const productos = new Set(), depositos = new Set(), ubicaciones = new Set();
  filas.forEach(f=>{
    if(!f.s.agotado && f.st==='N') counts.N++;
    if(!f.s.agotado && ['P','R','A'].includes(f.st)) counts.alerta++;
    productos.add(f.s.skuGlobalId);
    depositos.add(f.ubicacion);
    ubicaciones.add(f.ubNombre);
  });

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-list-details', filas.length, 'Líneas de stock'),
    _repStatPill('green','ti-pill', productos.size, 'Productos'),
    _repStatPill('gray','ti-building-warehouse', depositos.size, depositos.size===1?'Depósito':'Depósitos'),
    _repStatPill('amber','ti-bell', counts.alerta, 'En alerta'),
    _repStatPill('maroon','ti-x', counts.N, 'Vencidos')
  ]);

  const grid = '100px 1fr 120px 100px 100px 100px';
  const grupos = [];
  filas.forEach(f=>{
    const key = f.ubNombre + '|' + f.ubicacion;
    let g = grupos[grupos.length-1];
    if(!g || g.key !== key){ g = { key, ubNombre:f.ubNombre, deposito:f.ubicacion, items:[] }; grupos.push(g); }
    g.items.push(f);
  });

  const gruposHtml = grupos.map(g=>{
    const rowsHtml = g.items.map(f=>`<div class="rep-row" style="--rep-grid:${grid}">
        <div class="rep-col-num">${f.s.agotado
          ? '<span class="sem-badge N">Agotado</span>'
          : `<span class="sem-badge ${f.st}">${semLabel(f.st)}</span>`}</div>
        <div><div class="rep-item-name">${escHtml(f.s.nombre)}</div><div class="rep-item-code">${escHtml(f.skuG?.codigo||'')}${f.skuG?.familia?' · '+escHtml(f.skuG.familia):''}</div></div>
        <div class="rep-cell-mono" style="font-size:10px;color:#999">${escHtml(f.s.subSku)}</div>
        <div class="rep-cell-mono" style="font-size:10px;color:#999">${escHtml(f.s.lote||'—')}</div>
        <div class="rep-cell-mono strong">${f.cantidad} ${escHtml(f.s.unidad||'')}</div>
        <div class="rep-cell-mono">${fmtDate(f.s.caducidad)}</div>
      </div>`).join('');
    return `<div class="rep-group">
      <div class="rep-group-head">
        <div class="rep-group-name"><i class="ti ti-building-warehouse"></i> ${escHtml(g.ubNombre)} / ${escHtml(g.deposito)}</div>
        <div class="rep-group-count">${g.items.length} ítem${g.items.length!==1?'s':''}</div>
      </div>
      <div class="rep-cols" style="--rep-grid:${grid}"><div class="rep-col-num">Estado</div><div>Producto</div><div class="rep-col-num">Sub-SKU</div><div class="rep-col-num">Lote</div><div class="rep-col-num">Cantidad</div><div class="rep-col-num">Vencimiento</div></div>
      ${rowsHtml}
    </div>`;
  }).join('');

  let cont = document.getElementById('inv-print');
  if(!cont){
    cont = document.createElement('div');
    cont.id = 'inv-print';
    document.body.appendChild(cont);
  }
  cont.innerHTML = `<table class="inv-print-table">
    <thead><tr><td>
      <div class="rep-header">
        <div>
          <div class="rep-meta">Generado el ${escHtml(new Date().toLocaleString('es-CO',{dateStyle:'long',timeStyle:'short',timeZone:'America/Bogota'}))}</div>
          <div class="rep-title-lg">Nova Bridge — Inventario</div>
          <div class="rep-sub-lg">${_invDescripcionFiltros()}</div>
        </div>
        <div class="rep-logo-mini"><img src="logo.png" alt="Nova Bridge" class="rep-logo-mini-img"></div>
      </div>
    </td></tr></thead>
    <tbody><tr><td>
      ${stats}
      <div class="rep-section-title">Existencias agrupadas por ubicación / depósito</div>
      ${gruposHtml}
    </td></tr></tbody>
  </table>`;

  // El título del documento sale en la línea superior de cada página y es
  // el nombre sugerido del archivo PDF (ver _repTituloDocumento en reportes.js)
  const tituloOriginal = document.title;
  document.title = _invTituloDocumento();
  document.documentElement.classList.add('print-inv');
  document.body.classList.add('print-inv');
  const limpiar = ()=>{
    document.documentElement.classList.remove('print-inv');
    document.body.classList.remove('print-inv');
    document.title = tituloOriginal;
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);

  // Espera a que cargue el logo para que salga en el PDF
  const logo = cont.querySelector('img');
  const imprimir = ()=> window.print();
  if(logo.complete) imprimir();
  else { logo.onload = imprimir; logo.onerror = imprimir; }
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

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : str;

  drop.innerHTML = results.map((u, idx) => {
    const totalDepositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===u.id).length;
    return `<div class="ac-item" data-id="${u.id}" data-nombre="${u.nombre}"
      onmousedown="invSedeSelect(${u.id},'${u.nombre.replace(/'/g,"\\'")}')"
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
    const msg = sedeId ? `Sin depósitos en esta ubicación` : 'Sin depósitos';
    drop.innerHTML = `<div class="ac-no-results"><i class="ti ti-building-warehouse" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>${msg}</div>`;
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : str;

  drop.innerHTML = results.map((b, idx) => `
    <div class="ac-item" data-nombre="${b.nombre}" data-sede-id="${b.ubicacion_id||''}" data-sede-nombre="${b.ubicacion_nombre||''}"
      onmousedown="invDepositoSelect('${b.nombre.replace(/'/g,"\\'")}', ${b.ubicacion_id||'null'}, '${(b.ubicacion_nombre||'').replace(/'/g,"\\'")}')"
      onmouseover="invDepositoHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-building-warehouse"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(b.nombre)}</div>
        ${!sedeId && b.ubicacion_nombre ? `<div class="ac-item-meta">${b.ubicacion_nombre}</div>` : ''}
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
    const ctx = deposito ? ` en ${deposito}` : (sedeId ? ` en esta ubicación` : '');
    drop.innerHTML = `<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados${ctx}</div>`;
    drop.classList.add('open');
    return;
  }

  const hilite = str => q ? str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>') : str;

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
          ${skuG?`<span class="sku-code" style="font-size:9px">${skuG.codigo}</span>`:''}
          <span>${hilite(s.nombre)}</span>
        </div>
      </div>
      <div class="ac-item-stock">${cant} ${s.unidad}</div>
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