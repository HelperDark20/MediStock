// Filtro activo del historial (llega desde el dashboard al tocar un
// consumo). null = sin filtro, comportamiento normal.
let _movFiltro = null; // { ubicacionNombre, mes:'YYYY-MM', mesLabel }

function movClearFiltro(){
  _movFiltro = null;
  renderMovBody();
}
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
    <strong>${escHtml(sub.nombre)}</strong> · ${escHtml(sub.subSku)}<br>
    Stock en <strong>${escHtml(origen)}</strong>:
    <strong style="color:var(--blue)">${stk}</strong> ${escHtml(sub.unidad)}
    ${bodegasConStock.length>1?`<br><span style="font-size:11px;color:#888">También disponible en: ${bodegasConStock.filter(b=>b!==origen).map(b=>escHtml(b)).join(', ')}</span>`:''}
  `;

  origenSel.onchange = ()=>{
    const nuevoOrigen = origenSel.value;
    const nuevoStk = sub.stock?.[nuevoOrigen]||0;
    document.getElementById('mov-stock-info').innerHTML=`
      <strong>${escHtml(sub.nombre)}</strong> · ${escHtml(sub.subSku)}<br>
      Stock en <strong>${escHtml(nuevoOrigen)}</strong>:
      <strong style="color:var(--blue)">${nuevoStk}</strong> ${escHtml(sub.unidad)}
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
  const body   = document.getElementById('mov-body');
  const banner = document.getElementById('mov-alert-banner');

  let movs = S.movimientos;

  if(_movFiltro){
    movs = movs.filter(m=>{
      if(m.tipo!=='consumo') return false;
      if(_movFiltro.mes && (!m.created_at || fechaColombia(m.created_at).slice(0,7)!==_movFiltro.mes)) return false;
      if(_movFiltro.ubicacionNombre){
        const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===m.origen_nombre);
        if(!bodega || bodega.ubicacion_nombre!==_movFiltro.ubicacionNombre) return false;
      }
      return true;
    });
  }

  if(banner){
    if(_movFiltro){
      banner.className = 'alert-banner show amber';
      banner.innerHTML = `<i class="ti ti-filter"></i><span style="flex:1">Mostrando consumos de <strong>${escHtml(_movFiltro.ubicacionNombre||'todas las ubicaciones')}</strong> — ${escHtml(_movFiltro.mesLabel||'')}</span><button class="act-btn" onclick="movClearFiltro()" title="Quitar filtro"><i class="ti ti-x"></i></button>`;
    } else {
      banner.className = 'alert-banner';
      banner.innerHTML = '';
    }
  }

  if(!movs.length){
    body.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="ti ti-history"></i><p>Sin movimientos registrados</p></div></td></tr>';
    return;
  }

  body.innerHTML = movs.map(m=>{
    const puedeRevertir = currentRole===4 && !m.revertido && m.tipo!=='reversion';
    return `
    <tr ${m.revertido?'style="opacity:.55"':''} ${puedeRevertir?`class="mov-row-clickable" onclick="confirmRevertirMovimiento(${m.id})" title="Clic para revertir este movimiento"`:''}>
      <td data-label="Fecha" style="font-size:11px;font-family:var(--font-mono);color:#888">
        ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
      </td>
      <td data-label="Ítem" style="font-weight:500">${escHtml(m.nombre||'—')}</td>
      <td data-label="Sub-SKU"><span class="sub-sku" style="font-size:9px">${escHtml((m.sub_sku||'').split('-').slice(0,2).join('-'))}</span></td>
      <td data-label="Tipo">
        <span class="mov-tipo ${m.tipo}">${m.tipo==='reversion'?'Reversión':escHtml(m.tipo)}</span>
        ${m.revertido?'<span class="mov-tipo" style="background:#F0F0EE;color:#888;margin-left:4px">Revertido</span>':''}
        ${m.movimiento_original_id?`<div style="font-size:10px;color:#aaa;margin-top:2px">de mov. #${m.movimiento_original_id}</div>`:''}
      </td>
      <td data-label="Origen → Destino" style="font-size:12px;color:#666">${escHtml(m.origen_nombre||'—')} → ${escHtml(m.destino_nombre||'—')}</td>
      <td data-label="Cant." style="font-family:var(--font-mono);font-weight:600">${m.cantidad}</td>
      <td data-label="Usuario" style="font-size:12px">
        <div style="font-weight:500">${escHtml(m.usuario_nombre||'—')}</div>
      </td>
      <td data-label="Nivel">
        <span class="nivel-badge n${m.usuario_nivel||0}" style="font-size:9px">
          ${NIVELES[m.usuario_nivel||0]?.label||'—'}
        </span>
      </td>
    </tr>`;
  }).join('');
}

// ── REVERTIR MOVIMIENTO (solo Administrador) ──
function confirmRevertirMovimiento(id){
  const m = S.movimientos.find(x=>x.id===id);
  if(!m) return;
  document.getElementById('modal-title').textContent = 'Revertir movimiento';
  document.getElementById('modal-sub').textContent =
    `¿Revertir este ${m.tipo} de ${m.cantidad} ${m.unidad||''} — ${m.nombre||''}? El stock se ajustará automáticamente. Esta acción no se puede deshacer.`;
  document.getElementById('modal-ok-btn').onclick = async ()=>{
    try {
      await Movimientos.revertir(id);
      closeModal('modal-confirm');
      await loadState();
      renderMovBody();
      buildNav();
      toast('✓ Movimiento revertido — stock actualizado','success');
    } catch(err){
      toastError(err.message);
      closeModal('modal-confirm');
    }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── ACCIÓN "MOVIMIENTO" DESDE INVENTARIO ──
// Lleva al módulo de Movimientos con el ítem y la bodega de origen
// ya preseleccionados, listos para registrar consumo/traslado/destrucción.
function quickMov(subSkuId, ubicacion){
  const sub = S.subSkus.find(s => s.id === subSkuId);
  if(!sub){ toastError('Ítem no encontrado'); return; }

  goTo('movimientos');

  AC.mov.selectedId = sub.id;
  document.getElementById('mov-sku').value = sub.id;
  document.getElementById('mov-ac-input').value = sub.nombre;
  document.getElementById('mov-ac-clear').classList.add('show');
  document.getElementById('mov-ac-pill-text').innerHTML =
    `${escHtml(sub.nombre)} <span style="opacity:.6;font-size:11px">${escHtml(sub.subSku)} · ${getTotalStock(sub)} ${escHtml(sub.unidad)}</span>`;
  document.getElementById('mov-ac-pill').classList.add('show');

  updateMovInfo();

  const origenSel = document.getElementById('mov-origen');
  if(origenSel && ubicacion){
    const tieneOpcion = Array.from(origenSel.options).some(o => o.value === ubicacion);
    if(tieneOpcion){
      origenSel.value = ubicacion;
      origenSel.onchange && origenSel.onchange();
    } else {
      toast(`"${ubicacion}" no tiene stock disponible de este ítem`, 'error');
    }
  }
}