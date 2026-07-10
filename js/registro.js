// ── ESTADO DEL AUTOCOMPLETE DE SKU GLOBAL EN REGISTRO ──
let _regSkuSeleccionado = null;
let _regAcFocusIdx = -1;

function renderRegistro(){
  const locked = currentRole < 3;
  const msg  = document.getElementById('reg-locked-msg');
  const form = document.getElementById('reg-form-wrap');
  if(locked){
    msg.innerHTML = '<div class="locked-banner"><i class="ti ti-lock"></i>Solo el Supervisor y Administrador pueden registrar entradas</div>';
    form.style.opacity = '.4';
    form.style.pointerEvents = 'none';
  } else {
    msg.innerHTML = '';
    form.style.opacity = '1';
    form.style.pointerEvents = 'auto';
  }
}

// ══════════════════════════════════════════
// AUTOCOMPLETE SKU GLOBAL EN REGISTRO
// ══════════════════════════════════════════
function regAcFilter(){
  const q    = (document.getElementById('reg-ac-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('reg-ac-drop');
  const clear = document.getElementById('reg-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  _regAcFocusIdx = -1;

  if(!q){ drop.classList.remove('open'); drop.innerHTML = ''; return; }

  const results = S.skusGlobales.filter(g =>
    g.nombre.toLowerCase().includes(q) ||
    g.codigo.toLowerCase().includes(q)
  ).slice(0, 10);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((g, idx) => `
    <div class="ac-item" data-id="${g.id}"
      onmousedown="regAcSelect(${g.id})"
      onmouseover="_regAcFocusIdx=${idx};regAcHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-tag"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(g.nombre)}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${hilite(g.codigo)}</span>
          <span style="font-size:9px;color:#aaa">${g.familia||''} · ${g.subgrupo||''}</span>
        </div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function regAcOpen(){
  const q = document.getElementById('reg-ac-input').value||'';
  if(q){ regAcFilter(); return; }
  const drop = document.getElementById('reg-ac-drop');
  const all  = S.skusGlobales.slice(0, 8);
  drop.innerHTML = all.map((g, idx) => `
    <div class="ac-item" data-id="${g.id}"
      onmousedown="regAcSelect(${g.id})"
      onmouseover="_regAcFocusIdx=${idx};regAcHover(${idx})">
      <div class="ac-item-icon"><i class="ti ti-tag"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${g.nombre}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${g.codigo}</span>
          <span style="font-size:9px;color:#aaa">${g.familia||''}</span>
        </div>
      </div>
    </div>`).join('') + (S.skusGlobales.length > 8
      ? '<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>' : '');
  drop.classList.add('open');
}

function regAcHover(idx){
  document.querySelectorAll('#reg-ac-drop .ac-item').forEach((el,i) => el.classList.toggle('focused', i===idx));
}

function regAcKey(e){
  const drop  = document.getElementById('reg-ac-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _regAcFocusIdx = Math.min(_regAcFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_regAcFocusIdx));
    items[_regAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _regAcFocusIdx = Math.max(_regAcFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_regAcFocusIdx));
    items[_regAcFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _regAcFocusIdx>=0){
    e.preventDefault();
    regAcSelect(parseInt(items[_regAcFocusIdx].dataset.id));
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function regAcSelect(id){
  const skuG = S.skusGlobales.find(g => g.id === parseInt(id));
  if(!skuG) return;
  _regSkuSeleccionado = skuG;
  document.getElementById('reg-ac-input').value  = `${skuG.codigo} — ${skuG.nombre}`;
  document.getElementById('reg-sku-global-id').value = skuG.id;
  document.getElementById('reg-ac-clear').classList.add('show');
  document.getElementById('reg-ac-drop').classList.remove('open');
  updateRegSKU(skuG);
}

function regAcClear(){
  _regSkuSeleccionado = null;
  document.getElementById('reg-ac-input').value = '';
  document.getElementById('reg-sku-global-id').value = '';
  document.getElementById('reg-ac-clear').classList.remove('show');
  document.getElementById('reg-ac-drop').classList.remove('open');
  document.getElementById('reg-sku-info').style.display = 'none';
  document.getElementById('reg-subsku-preview').textContent = '—';
  document.getElementById('reg-subsku-hint').textContent = 'Selecciona un SKU Global para continuar';
  document.getElementById('reg-sku-unidad').innerHTML = '';
  ['reg-proveedor-wrap','reg-lote-wrap','reg-invima-wrap','reg-caducidad-wrap',
   'reg-subsku-manual-wrap'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  document.getElementById('reg-precio').value = '';
  document.getElementById('reg-ac-input').focus();
}

document.addEventListener('click', e=>{
  const wrap = document.getElementById('reg-ac-wrap');
  if(wrap && !wrap.contains(e.target)) document.getElementById('reg-ac-drop').classList.remove('open');
});

// ══════════════════════════════════════════
// ACTUALIZAR CAMPOS SEGÚN SKU SELECCIONADO
// ══════════════════════════════════════════
function updateRegSKU(skuG){
  if(!skuG) return;

  const info = document.getElementById('reg-sku-info');
  info.style.display = 'block';
  document.getElementById('reg-sku-nombre').textContent = skuG.nombre;
  document.getElementById('reg-sku-familia').innerHTML = `
    <span style="font-size:12px;font-weight:600;color:var(--ink)">${escHtml(skuG.familia||'')}</span>
    <span style="font-size:12px;color:#888;margin-left:6px">${escHtml(skuG.subgrupo||'')}</span>`;

  // La unidad ya no se pide aquí — se muestra la que trae el SKU Global
  document.getElementById('reg-sku-unidad').innerHTML = skuG.unidad
    ? `<i class="ti ti-ruler-2" style="margin-right:4px"></i>Unidad: <strong>${escHtml(skuG.unidad)}</strong>`
    : `<span style="color:var(--red2)"><i class="ti ti-alert-triangle" style="margin-right:4px"></i>Este SKU no tiene unidad definida — asígnasela en SKUs Globales</span>`;

  document.getElementById('reg-precio').value = '';

  const campos = Array.isArray(skuG.campos) ? skuG.campos : JSON.parse(skuG.campos||'[]');

  const tieneProveedor = campos.includes('proveedor');
  const tieneLote      = campos.includes('lote');

  document.getElementById('reg-proveedor-wrap').style.display = tieneProveedor ? '' : 'none';
  document.getElementById('reg-lote-wrap').style.display      = tieneLote      ? '' : 'none';
  document.getElementById('reg-invima-wrap').style.display    = campos.includes('invima')    ? '' : 'none';
  document.getElementById('reg-caducidad-wrap').style.display = campos.includes('caducidad') ? '' : 'none';
  document.getElementById('reg-subsku-manual-wrap').style.display = '';

  let hintParts = [];
  if(tieneProveedor) hintParts.push('Proveedor (4 letras)');
  if(tieneLote)      hintParts.push('Lote');
  hintParts.push('Identificador adicional (opcional)');
  document.getElementById('reg-subsku-hint').textContent = hintParts.join(' · ');

  updateSubSKU();
}

// ══════════════════════════════════════════
// CONSTRUIR SUB-SKU DINÁMICAMENTE
// ══════════════════════════════════════════
function updateSubSKU(){
  if(!_regSkuSeleccionado) return;

  const campos = Array.isArray(_regSkuSeleccionado.campos)
    ? _regSkuSeleccionado.campos
    : JSON.parse(_regSkuSeleccionado.campos||'[]');

  const tieneProveedor = campos.includes('proveedor');
  const tieneLote      = campos.includes('lote');

  const prov   = tieneProveedor ? (document.getElementById('reg-proveedor').value||'').trim() : '';
  const lote   = tieneLote      ? (document.getElementById('reg-lote').value||'').trim() : '';
  const manual = (document.getElementById('reg-subsku-manual').value||'').trim();

  let partes = [];
  if(tieneProveedor && prov) partes.push(abrevProv(prov));
  if(tieneLote && lote)      partes.push(lote.toUpperCase());
  if(manual)                 partes.push(manual.toUpperCase());

  document.getElementById('reg-subsku-preview').textContent = partes.length
    ? partes.join('-')
    : (tieneProveedor ? 'PROV' : '') + (tieneLote ? '-LOTE' : '') || 'ID-MANUAL';
}

// ══════════════════════════════════════════
// REGISTRAR ENTRADA
// ══════════════════════════════════════════
async function registrarEntrada(){
  const skuG = _regSkuSeleccionado;
  if(!skuG){ toastError('Selecciona un SKU Global'); return; }
  if(!skuG.unidad){ toastError('Este SKU no tiene unidad de medida definida — asígnasela en SKUs Globales'); return; }

  const campos = Array.isArray(skuG.campos) ? skuG.campos : JSON.parse(skuG.campos||'[]');
  const tieneProveedor = campos.includes('proveedor');
  const tieneLote      = campos.includes('lote');

  const prov   = tieneProveedor ? document.getElementById('reg-proveedor').value.trim() : '';
  const lote   = tieneLote      ? document.getElementById('reg-lote').value.trim() : '';
  const manual = document.getElementById('reg-subsku-manual').value.trim();
  const invima = campos.includes('invima')    ? document.getElementById('reg-invima').value.trim() : '';
  const cadRaw = campos.includes('caducidad') ? document.getElementById('reg-caducidad').value.trim() : '';

  let cad = '';
  if(cadRaw && cadRaw.includes('/')){
    const [d, m, y] = cadRaw.split('/');
    if(d && m && y) cad = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  const precio   = parseFloat(document.getElementById('reg-precio')?.value)||0;
  const cant     = parseInt(document.getElementById('reg-cantidad').value)||0;
  const ubicacion = document.getElementById('reg-ubicacion').value;

  if(cant <= 0)  { toastError('Ingresa una cantidad válida'); return; }
  if(!ubicacion) { toastError('Selecciona una ubicación'); return; }
  if(!precio || precio <= 0) { toastError('Ingresa el precio unitario de esta entrada'); return; }

  try {
    const subData = await SKUs.createSub({
      sku_global_id: skuG.id,
      proveedor: prov,
      lote, invima,
      caducidad: cad,
      precio,
      sub_sku_manual: manual
    });

    const todasBodegas = await Bodegas.getAll();
    const bodegaId = todasBodegas.find(b => b.nombre === ubicacion)?.id;

    if(!bodegaId){
      toastError('Bodega destino no encontrada — recarga la página');
      return;
    }

    await Movimientos.entrada({
      sub_sku_id: subData.id,
      bodega_destino_id: bodegaId,
      cantidad: cant
    });

    regAcClear();
    ['reg-lote','reg-invima','reg-cantidad','reg-subsku-manual']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    ['reg-cad-dia','reg-cad-mes','reg-cad-año']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });

    await loadState();
    populateSelects();
    toast('✓ Entrada registrada','success');
    setTimeout(()=>goTo('inventario'), 700);
  } catch(err){
    toastError(err.message);
  }
}