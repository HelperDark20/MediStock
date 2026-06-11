function renderRegistro(){
  const locked = currentRole<3;
  const msg = document.getElementById('reg-locked-msg');
  const form = document.getElementById('reg-form-wrap');
  if(locked){
    msg.innerHTML='<div class="locked-banner"><i class="ti ti-lock"></i>Solo el Supervisor y Administrador pueden registrar entradas</div>';
    form.style.opacity='.4';
    form.style.pointerEvents='none';
  } else {
    msg.innerHTML='';
    form.style.opacity='1';
    form.style.pointerEvents='auto';
  }
}

function updateRegSKU(){
  const id = parseInt(document.getElementById('reg-sku-global').value)||0;
  const skuG = S.skusGlobales.find(g=>g.id===id);
  const info = document.getElementById('reg-sku-info');
  if(!skuG){ info.style.display='none'; return; }
  info.style.display='block';
  document.getElementById('reg-sku-nombre').textContent = skuG.nombre;
  document.getElementById('reg-sku-familia').innerHTML = `
    <span class="fam ${skuG.familia}">${FAMILIAS[skuG.familia]}</span>
    <span style="font-size:12px;color:#888;margin-left:6px">${skuG.subgrupo}</span>`;

  // Mostrar/ocultar campos según los activados en el SKU Global
  const campos = Array.isArray(skuG.campos) ? skuG.campos : JSON.parse(skuG.campos||'[]');

  const camposConfig = {
    lote:      'reg-lote-wrap',
    caducidad: 'reg-caducidad-wrap',
    invima:    'reg-invima-wrap',
    precio:    'reg-precio-wrap',
    serial:    'reg-serial-wrap',
  };

  Object.entries(camposConfig).forEach(([campo, wrapId])=>{
    const el = document.getElementById(wrapId);
    if(el) el.style.display = campos.includes(campo) ? '' : 'none';
  });

  updateSubSKU();
}

function updateSubSKU(){
  const prov = document.getElementById('reg-proveedor').value;
  const lote = document.getElementById('reg-lote').value;
  const sub = buildSubSku(prov, lote);
  document.getElementById('reg-subsku-preview').textContent = sub;
}

async function registrarEntrada(){
  const skuGId = parseInt(document.getElementById('reg-sku-global').value)||0;
  const prov = document.getElementById('reg-proveedor').value.trim();
  const lote = document.getElementById('reg-lote').value.trim();
  const invima = document.getElementById('reg-invima').value.trim();
  const cad = document.getElementById('reg-caducidad').value;
  const precio = parseFloat(document.getElementById('reg-precio')?.value)||0;
  const serial = document.getElementById('reg-serial')?.value.trim()||'';
  const cant = parseInt(document.getElementById('reg-cantidad').value)||0;
  const unidad = document.getElementById('reg-unidad').value;
  const ubicacion = document.getElementById('reg-ubicacion').value;
  const skuG = S.skusGlobales.find(g=>g.id===skuGId);

  if(!skuG){ toastError('Selecciona un SKU Global'); return; }
  if(cant<=0){ toastError('Ingresa una cantidad válida'); return; }
  if(!ubicacion){ toastError('Selecciona una ubicación'); return; }

  try {
    const subData = await SKUs.createSub({
      sku_global_id: skuGId,
      proveedor: prov,
      lote, invima, caducidad: cad,
      unidad, precio, serial
    });

    const todasBodegas = await Bodegas.getAll();
    const bodegaId = todasBodegas.find(b=>b.nombre===ubicacion)?.id;

    await Movimientos.entrada({
      sub_sku_id: subData.id,
      bodega_destino_id: bodegaId,
      cantidad: cant
    });

    ['reg-proveedor','reg-lote','reg-invima','reg-caducidad',
     'reg-cantidad','reg-precio','reg-serial']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    updateSubSKU();
    await loadState();
    populateSelects();
    toast('✓ Entrada registrada','success');
    setTimeout(()=>goTo('inventario'), 700);
  } catch(err){
    toastError(err.message);
  }
}