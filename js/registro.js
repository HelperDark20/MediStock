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

    // Si el lote ya existía, se reutiliza con SU precio: avisar si el digitado es otro
    const precioGuardado = Number(subData.precio)||0;
    if(subData.ya_existe && precioGuardado && precioGuardado !== precio){
      toast(`Este lote ya existía (${subData.sub_sku}) con precio ${fmtCOP(precioGuardado)}; se conservó ese precio.${currentRole===4?' Si es un error, corrígelo en "Modificar Sub-SKUs".':''}`, 'error', 6000);
    }

    const bodegaId = (S.bodegasRaw||[]).find(b => b.nombre === ubicacion)?.id;

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

// ══════════════════════════════════════════
// MODIFICAR SUB-SKUs EXISTENTES (solo Administrador)
// Historial del más reciente al más antiguo + búsqueda. Precio, INVIMA y
// vencimiento se corrigen en el mismo Sub-SKU; si cambia el proveedor o el
// lote, el servidor pide confirmar porque crea uno nuevo (o lo une al que ya
// tiene ese código) con todo el stock y el historial.
// ══════════════════════════════════════════
let _subskuFilas = [];
let _subskuBuscarTimer = null;
let _subskuEditando = null;

const _SUBSKU_CAMPOS = { precio:'Precio', invima:'INVIMA', caducidad:'Vencimiento', proveedor:'Proveedor', lote:'Lote', sub_sku:'Código' };

function abrirModificarSubSkus(){
  document.getElementById('subsku-buscar').value = '';
  document.getElementById('modal-subskus').classList.add('open');
  subskuCargar(false);
}

function subskuBuscarInput(){
  clearTimeout(_subskuBuscarTimer);
  _subskuBuscarTimer = setTimeout(()=>subskuCargar(false), 350);
}

async function subskuCargar(mas){
  const body = document.getElementById('subsku-body');
  const q = (document.getElementById('subsku-buscar').value||'').trim();
  if(!mas){
    _subskuFilas = [];
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i><p>Cargando…</p></div></td></tr>';
  }
  try {
    const r = await SKUs.historialSub({ q, limit: 50, offset: _subskuFilas.length });
    _subskuFilas = _subskuFilas.concat(r.filas);
    document.getElementById('subsku-mas').style.display = r.hay_mas ? '' : 'none';
    subskuRender();
  } catch(err){ toastError(err.message); }
}

function subskuRender(){
  const body = document.getElementById('subsku-body');
  if(!_subskuFilas.length){
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="ti ti-search"></i><p>Sin Sub-SKUs</p></div></td></tr>';
    return;
  }
  body.innerHTML = _subskuFilas.map((s, i)=>`<tr onclick="subskuAbrirEditar(${i})">
    <td data-label="Creado" style="font-size:11px;font-family:var(--font-mono);color:#888">${s.creado?new Date(s.creado).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}):'—'}</td>
    <td data-label="Sub-SKU"><span class="sub-sku">${escHtml(s.sub_sku)}</span>${Number(s.total_cambios)?' <i class="ti ti-history" title="Tiene cambios registrados" style="color:#aaa"></i>':''}</td>
    <td data-label="Ítem"><div style="font-weight:500;font-size:13px">${escHtml(s.nombre)}</div><div class="mrow-meta">${escHtml(s.sku_global)}</div></td>
    <td data-label="Lote" style="font-size:12px;font-family:var(--font-mono)">${escHtml(s.lote||'—')}</td>
    <td data-label="Proveedor" style="font-size:12px">${escHtml(s.proveedor||'—')}</td>
    <td data-label="Vence" style="font-size:12px;font-family:var(--font-mono)">${s.caducidad?fmtDate(s.caducidad):'—'}</td>
    <td data-label="Precio unit." style="font-size:12px;font-family:var(--font-mono)">${fmtCOP(Number(s.precio)||0)}</td>
    <td data-label="Stock" style="font-size:12px;font-family:var(--font-mono)">${Number(s.stock_total)} ${escHtml(s.unidad||'')}</td>
  </tr>`).join('');
}

async function subskuAbrirEditar(i){
  const s = _subskuFilas[i];
  if(!s) return;
  _subskuEditando = s;
  document.getElementById('subed-id').value = s.id;
  document.getElementById('subed-titulo').textContent = `Editar ${s.sub_sku}`;
  document.getElementById('subed-sub').textContent = `${s.nombre} · ${s.sku_global} · ${Number(s.stock_total)} ${s.unidad||''} en stock`;
  document.getElementById('subed-precio').value = Number(s.precio)||'';
  document.getElementById('subed-caducidad').value = s.caducidad||'';
  document.getElementById('subed-invima').value = s.invima||'';
  document.getElementById('subed-proveedor').value = s.proveedor||'';
  document.getElementById('subed-lote').value = s.lote||'';
  _subskuOcultarConfirmacion();
  const cont = document.getElementById('subed-cambios');
  cont.innerHTML = '<div style="font-size:12px;color:#aaa">Cargando…</div>';
  document.getElementById('modal-subsku-editar').classList.add('open');
  try {
    const cambios = await SKUs.cambiosSub(s.id);
    cont.innerHTML = cambios.length ? cambios.map(_subskuCambioHtml).join('')
      : '<div style="font-size:12px;color:#aaa">Sin cambios registrados</div>';
  } catch(err){ cont.innerHTML = ''; toastError(err.message); }
}

function _subskuValorTxt(campo, v){
  if(v === null || v === undefined || v === '') return '—';
  if(campo === 'precio') return fmtCOP(Number(v));
  if(campo === 'caducidad') return fmtDate(v);
  return v;
}

function _subskuCambioHtml(c){
  const lineas = Object.entries(c.cambios||{}).map(([campo, d]) =>
    `<div>${escHtml(_SUBSKU_CAMPOS[campo]||campo)}: ${escHtml(_subskuValorTxt(campo, d.antes))} → <strong>${escHtml(_subskuValorTxt(campo, d.despues))}</strong></div>`).join('');
  return `<div class="subsku-cambio">
    <div class="subsku-cambio-meta">${new Date(c.created_at).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'})} · ${escHtml(c.usuario_nombre||'—')}</div>
    ${lineas}
    ${c.nota?`<div style="color:#888;margin-top:2px">${escHtml(c.nota)}</div>`:''}
  </div>`;
}

function _subskuOcultarConfirmacion(){
  const box = document.getElementById('subed-confirmar');
  box.style.display = 'none';
  box.innerHTML = '';
  const btn = document.getElementById('subed-guardar');
  btn.textContent = 'Guardar cambios';
  btn.onclick = ()=>subskuGuardar(false);
}

async function subskuGuardar(confirmar){
  const id = parseInt(document.getElementById('subed-id').value)||0;
  const precio = parseFloat(document.getElementById('subed-precio').value)||0;
  if(precio <= 0){ toastError('El precio unitario debe ser mayor a 0'); return; }
  const data = {
    precio,
    caducidad: document.getElementById('subed-caducidad').value,
    invima: document.getElementById('subed-invima').value.trim(),
    proveedor: document.getElementById('subed-proveedor').value.trim(),
    lote: document.getElementById('subed-lote').value.trim(),
    confirmar
  };
  const btn = document.getElementById('subed-guardar');
  btn.disabled = true;
  try {
    const { status, data: r } = await SKUs.updateSub(id, data);
    if(status === 409 && r.requiere_confirmacion){
      // Cambia el código: mostrar qué va a pasar y pedir confirmación
      const box = document.getElementById('subed-confirmar');
      const resumen = `${r.stock_total} unidades en stock y ${r.movimientos} movimiento${r.movimientos!==1?'s':''}`;
      box.innerHTML = r.accion === 'unir'
        ? `<i class="ti ti-arrows-join"></i><span style="flex:1">El código pasa de <strong>${escHtml(r.codigo_actual)}</strong> a <strong>${escHtml(r.codigo_nuevo)}</strong>, que <strong>ya existe</strong> (precio ${fmtCOP(r.destino.precio)}, vence ${fmtDate(r.destino.caducidad)}). Se unirán: ${resumen} pasan a ${escHtml(r.codigo_nuevo)}, que conserva sus propios datos, y ${escHtml(r.codigo_actual)} se elimina.</span>`
        : `<i class="ti ti-replace"></i><span style="flex:1">El código pasa de <strong>${escHtml(r.codigo_actual)}</strong> a <strong>${escHtml(r.codigo_nuevo)}</strong>. Se creará ${escHtml(r.codigo_nuevo)} con estos datos, recibirá ${resumen}, y ${escHtml(r.codigo_actual)} se eliminará.</span>`;
      box.style.display = 'flex';
      btn.textContent = r.accion === 'unir' ? 'Confirmar y unir' : 'Confirmar y reemplazar';
      btn.onclick = ()=>subskuGuardar(true);
      return;
    }
    closeModal('modal-subsku-editar');
    toast(r.accion === 'ninguna' ? 'Sin cambios' : `✓ ${r.mensaje}`, r.accion === 'ninguna' ? '' : 'success');
    if(r.accion !== 'ninguna'){
      await loadState();
      populateSelects();
      subskuCargar(false);
    }
  } catch(err){
    toastError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// Si se edita un campo después del aviso de reemplazo/unión, se vuelve a preguntar
document.addEventListener('input', e=>{
  if(e.target?.id?.startsWith('subed-')) _subskuOcultarConfirmacion();
});
