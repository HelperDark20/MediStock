function renderMovimientos(){
  const canTraslado = currentRole>=3;
  const canDestruccion = currentRole>=3;
  const optTraslado = document.getElementById('opt-traslado');
  const optDestruccion = document.getElementById('opt-destruccion');
  if(optTraslado) optTraslado.disabled = !canTraslado;
  if(optDestruccion) optDestruccion.disabled = !canDestruccion;
  if(!canTraslado && document.getElementById('mov-tipo').value!=='consumo'){
    document.getElementById('mov-tipo').value='consumo';
  }
  const msg = document.getElementById('mov-locked-msg');
  if(currentRole===2){
    msg.innerHTML='<div class="alert-strip A" style="margin-bottom:12px"><i class="ti ti-info-circle"></i><div class="alert-text"><div class="alert-name">Modo Enfermero/a</div><div class="alert-meta">Solo puedes registrar consumos</div></div></div>';
  } else msg.innerHTML='';
  toggleMovFields();
  renderMovBody();
}

function toggleMovFields(){
  const tipo = document.getElementById('mov-tipo').value;
  document.getElementById('mov-destino-wrap').style.display = tipo==='traslado'?'':'none';
  document.getElementById('mov-motivo-wrap').style.display = tipo==='destruccion'?'':'none';
  document.getElementById('mov-paciente-wrap').style.display = tipo==='consumo'?'':'none';
}

function updateMovInfo(){
  const id = parseInt(document.getElementById('mov-sku').value)||0;
  const sub = S.subSkus.find(s=>s.id===id);
  if(!sub){
    document.getElementById('mov-stock-info').textContent='Selecciona un ítem para ver el stock disponible';
    return;
  }

  const bodegasConStock = Object.entries(sub.stock||{})
    .filter(([,cantidad])=>cantidad>0)
    .map(([nombre])=>nombre);

  const origenSel = document.getElementById('mov-origen');
  const destinoSel = document.getElementById('mov-destino');

  origenSel.innerHTML = bodegasConStock.length
    ? bodegasConStock.map(b=>`<option value="${b}">${b}</option>`).join('')
    : '<option value="">Sin stock disponible</option>';

  destinoSel.innerHTML = S.bodegas
    .map(b=>`<option value="${b}">${b}</option>`).join('');

  const origen = origenSel.value;
  const stk = origen ? (sub.stock?.[origen]||0) : 0;
  document.getElementById('mov-stock-info').innerHTML=`
    <strong>${sub.nombre}</strong> · ${sub.subSku}<br>
    Stock en <strong>${origen}</strong>:
    <strong style="color:var(--blue)">${stk}</strong> ${sub.unidad}
    ${bodegasConStock.length>1?`<br><span style="font-size:11px;color:#888">También disponible en: ${bodegasConStock.filter(b=>b!==origen).join(', ')}</span>`:''}
  `;

  origenSel.onchange = ()=>{
    const nuevoOrigen = origenSel.value;
    const nuevoStk = sub.stock?.[nuevoOrigen]||0;
    document.getElementById('mov-stock-info').innerHTML=`
      <strong>${sub.nombre}</strong> · ${sub.subSku}<br>
      Stock en <strong>${nuevoOrigen}</strong>:
      <strong style="color:var(--blue)">${nuevoStk}</strong> ${sub.unidad}
    `;
  };
}

async function registrarMovimiento(){
  const id = parseInt(document.getElementById('mov-sku').value)||0;
  const tipo = document.getElementById('mov-tipo').value;
  const cant = parseInt(document.getElementById('mov-cantidad').value)||0;
  const origenNombre = document.getElementById('mov-origen').value;
  const destinoNombre = document.getElementById('mov-destino').value;
  const motivo = document.getElementById('mov-motivo')?.value||'';
  const cedula_paciente = document.getElementById('mov-paciente')?.value.trim()||null;

  if(!id){ toastError('Selecciona un ítem'); return; }
  if(cant<=0){ toastError('Ingresa una cantidad válida'); return; }

  try {
    const todasBodegas = await Bodegas.getAll();
    const origenId  = todasBodegas.find(b=>b.nombre===origenNombre)?.id;
    const destinoId = todasBodegas.find(b=>b.nombre===destinoNombre)?.id;

    // FIX: validar que se encontraron las bodegas antes de continuar
    if(!origenId){
      toastError('Bodega origen no encontrada — recarga la página');
      return;
    }
    if(tipo==='traslado' && !destinoId){
      toastError('Bodega destino no encontrada — recarga la página');
      return;
    }

    if(tipo==='consumo'){
      await Movimientos.consumo({ sub_sku_id:id, bodega_origen_id:origenId, cantidad:cant, cedula_paciente });
    } else if(tipo==='traslado'){
      if(origenId===destinoId){ toastError('Origen y destino son iguales'); return; }
      await Movimientos.traslado({ sub_sku_id:id, bodega_origen_id:origenId, bodega_destino_id:destinoId, cantidad:cant });
    } else if(tipo==='destruccion'){
      await Movimientos.destruccion({ sub_sku_id:id, bodega_origen_id:origenId, cantidad:cant, motivo });
    }

    document.getElementById('mov-cantidad').value='';
    if(document.getElementById('mov-paciente')) document.getElementById('mov-paciente').value='';
    acClear('mov');
    await loadState();
    renderMovBody();
    buildNav();
    toast(`✓ ${tipo.charAt(0).toUpperCase()+tipo.slice(1)} registrado`,'success');
  } catch(err){
    toastError(err.message);
  }
}

function renderMovBody(){
  const body = document.getElementById('mov-body');
  if(!S.movimientos.length){
    body.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="ti ti-history"></i><p>Sin movimientos registrados</p></div></td></tr>';
    return;
  }
  body.innerHTML = S.movimientos.map(m=>`
    <tr>
      <td style="font-size:11px;font-family:var(--font-mono);color:#888">
        ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
      </td>
      <td><span class="sku-code">${m.sku_global_codigo||'—'}</span></td>
      <td><span class="sub-sku" style="font-size:9px">${(m.sub_sku||'').split('-').slice(0,2).join('-')}</span></td>
      <td><span class="mov-tipo ${m.tipo}">${m.tipo}</span></td>
      <td style="font-size:12px;color:#666">${m.origen_nombre||'—'} → ${m.destino_nombre||'—'}</td>
      <td style="font-family:var(--font-mono);font-weight:600">${m.cantidad}</td>
      <td style="font-size:12px">
        <div style="font-weight:500">${m.usuario_nombre||'—'}</div>
      </td>
      <td>
        <span class="nivel-badge n${m.usuario_nivel||0}" style="font-size:9px">
          ${NIVELES[m.usuario_nivel||0]?.label||'—'}
        </span>
      </td>
    </tr>`).join('');
}

function quickMov(subId, ubicacion){
  goTo('movimientos');
  setTimeout(()=>{
    acSelect('mov', subId);
    document.getElementById('mov-origen').value = ubicacion;
    updateMovInfo();
  },100);
}