// Filtro activo del historial (llega desde el dashboard al tocar un
// consumo). null = sin filtro, comportamiento normal.
let _movFiltro = null; // { ubicacionNombre, mes:'YYYY-MM', mesLabel }

// Estado del ORIGEN elegido en el Paso 1 — fija el depósito contra el
// que se filtran las sugerencias de búsqueda y contra el que se
// registra el movimiento (ya no se re-selecciona por ítem).
let _movOrigenBodegaId = null;
let _movOrigenBodegaNombre = null;

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
  if(!canTraslado && document.getElementById('mov-tipo') && document.getElementById('mov-tipo').value!=='consumo'){
    document.getElementById('mov-tipo').value='consumo';
  }
  const msg = document.getElementById('mov-locked-msg');
  if(msg) msg.innerHTML='';
  movPopulateSedes();
  toggleMovFields();
  renderMovBody();
}

// ══════════════════════════════════════════
// PASO 1 — UBICACIÓN Y DEPÓSITO DE ORIGEN
// ══════════════════════════════════════════
function movPopulateSedes(){
  const opts = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');

  const selOrigen = document.getElementById('mov-origen-sede');
  if(selOrigen){
    const current = selOrigen.value;
    selOrigen.innerHTML = opts;
    if(current) selOrigen.value = current;
  }
  const selDestino = document.getElementById('mov-destino-sede');
  if(selDestino){
    const current = selDestino.value;
    selDestino.innerHTML = opts;
    if(current) selDestino.value = current;
  }
}

function movOrigenSedeChange(){
  const sedeId = parseInt(document.getElementById('mov-origen-sede').value)||0;
  const depSel = document.getElementById('mov-origen-deposito');

  movResetItemSelection();
  _movOrigenBodegaId = null;
  _movOrigenBodegaNombre = null;
  movLockItemSearch(true);

  if(!sedeId){
    depSel.innerHTML = '<option value="">Selecciona primero la ubicación…</option>';
    depSel.disabled = true;
    return;
  }

  const depositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===sedeId);
  depSel.innerHTML = depositos.length
    ? '<option value="">Seleccionar depósito…</option>' + depositos.map(b=>`<option value="${b.id}">${escHtml(b.nombre)}</option>`).join('')
    : '<option value="">Sin depósitos en esta ubicación</option>';
  depSel.disabled = !depositos.length;
}

function movOrigenDepositoChange(){
  const depId = parseInt(document.getElementById('mov-origen-deposito').value)||0;
  movResetItemSelection();

  if(!depId){
    _movOrigenBodegaId = null;
    _movOrigenBodegaNombre = null;
    movLockItemSearch(true);
    return;
  }

  const bodega = (S.bodegasRaw||[]).find(b=>b.id===depId);
  _movOrigenBodegaId = depId;
  _movOrigenBodegaNombre = bodega?.nombre || null;
  movLockItemSearch(false);
}

function movLockItemSearch(lock){
  const wrap  = document.getElementById('mov-item-wrap');
  const input = document.getElementById('mov-ac-input');
  if(!wrap || !input) return;
  wrap.style.opacity = lock ? '.4' : '1';
  wrap.style.pointerEvents = lock ? 'none' : 'auto';
  input.disabled = lock;
  input.placeholder = lock ? 'Selecciona primero un depósito de origen' : 'Buscar por nombre, SKU, lote…';
}

function movResetItemSelection(){
  acClear('mov');
  const tipoWrap = document.getElementById('mov-tipo-wrap');
  if(tipoWrap) tipoWrap.style.display = 'none';
}

// ══════════════════════════════════════════
// PASO 2 — AL SELECCIONAR ÍTEM (llamado desde acSelect en autocomplete.js)
// ══════════════════════════════════════════
function updateMovInfo(){
  const id = parseInt(document.getElementById('mov-sku').value)||0;
  const sub = S.subSkus.find(s=>s.id===id);
  const tipoWrap = document.getElementById('mov-tipo-wrap');

  if(!sub || !_movOrigenBodegaId){
    if(tipoWrap) tipoWrap.style.display = 'none';
    return;
  }

  tipoWrap.style.display = '';

  const stk = sub.stock?.[_movOrigenBodegaNombre] || 0;
  document.getElementById('mov-stock-info').innerHTML = `
    <strong>${escHtml(sub.nombre)}</strong> · ${escHtml(sub.subSku)}<br>
    Stock en <strong>${escHtml(_movOrigenBodegaNombre)}</strong>:
    <strong style="color:var(--blue)">${stk}</strong> ${escHtml(sub.unidad)}
  `;

  toggleMovFields();
}

// ══════════════════════════════════════════
// PASO 3 — TIPO DE MOVIMIENTO Y CAMPOS DINÁMICOS
// ══════════════════════════════════════════
function toggleMovFields(){
  const tipo = document.getElementById('mov-tipo')?.value;
  if(!tipo) return;

  document.getElementById('mov-destino-sede-wrap').style.display = tipo==='traslado'?'':'none';
  document.getElementById('mov-destino-wrap').style.display      = tipo==='traslado'?'':'none';
  document.getElementById('mov-motivo-wrap').style.display       = tipo==='destruccion'?'':'none';
  document.getElementById('mov-paciente-wrap').style.display     = tipo==='consumo'?'':'none';

  const labelCant = document.getElementById('mov-cantidad-label');
  if(labelCant){
    labelCant.textContent = tipo==='traslado' ? 'Cantidad a trasladar'
      : tipo==='consumo' ? 'Cantidad a consumir'
      : 'Cantidad a destruir';
  }

  if(tipo==='traslado') movPopulateSedes();
}

function movDestinoSedeChange(){
  const sedeId = parseInt(document.getElementById('mov-destino-sede').value)||0;
  const depSel = document.getElementById('mov-destino');
  if(!sedeId){
    depSel.innerHTML = '<option value="">Selecciona primero la ubicación…</option>';
    return;
  }
  const depositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===sedeId);
  depSel.innerHTML = depositos.length
    ? '<option value="">Seleccionar depósito…</option>' + depositos.map(b=>`<option value="${b.id}">${escHtml(b.nombre)}</option>`).join('')
    : '<option value="">Sin depósitos en esta ubicación</option>';
}

// ══════════════════════════════════════════
// REGISTRAR MOVIMIENTO
// ══════════════════════════════════════════
async function registrarMovimiento(){
  const id      = parseInt(document.getElementById('mov-sku').value)||0;
  const tipo    = document.getElementById('mov-tipo')?.value;
  const cant    = parseInt(document.getElementById('mov-cantidad').value)||0;
  const motivo  = document.getElementById('mov-motivo')?.value||'';
  const cedula_paciente = document.getElementById('mov-paciente')?.value.trim()||null;

  if(!_movOrigenBodegaId){ toastError('Selecciona la ubicación y depósito de origen'); return; }
  if(!id)     { toastError('Selecciona un ítem'); return; }
  if(!tipo)   { toastError('Selecciona el tipo de movimiento'); return; }
  if(cant<=0) { toastError('Ingresa una cantidad válida'); return; }

  const origenId = _movOrigenBodegaId;

  try {
    if(tipo==='consumo'){
      await Movimientos.consumo({ sub_sku_id:id, bodega_origen_id:origenId, cantidad:cant, cedula_paciente });
    } else if(tipo==='traslado'){
      const destinoId = parseInt(document.getElementById('mov-destino').value)||0;
      if(!destinoId){ toastError('Selecciona el depósito destino'); return; }
      if(origenId===destinoId){ toastError('Origen y destino son iguales'); return; }
      await Movimientos.traslado({ sub_sku_id:id, bodega_origen_id:origenId, bodega_destino_id:destinoId, cantidad:cant });
    } else if(tipo==='destruccion'){
      await Movimientos.destruccion({ sub_sku_id:id, bodega_origen_id:origenId, cantidad:cant, motivo });
    }

    document.getElementById('mov-cantidad').value='';
    if(document.getElementById('mov-paciente')) document.getElementById('mov-paciente').value='';
    if(document.getElementById('mov-motivo'))   document.getElementById('mov-motivo').value='';
    movResetItemSelection();
    await loadState();
    renderMovBody();
    buildNav();
    toast(`✓ ${tipo.charAt(0).toUpperCase()+tipo.slice(1)} registrado`,'success');
  } catch(err){
    toastError(err.message);
  }
}

// ══════════════════════════════════════════
// HISTORIAL (sin cambios de lógica)
// ══════════════════════════════════════════
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
    body.innerHTML='<tr><td colspan="9"><div class="empty-state"><i class="ti ti-history"></i><p>Sin movimientos registrados</p></div></td></tr>';
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
      <td data-label="Cédula" style="font-size:12px;font-family:var(--font-mono)">${m.tipo==='consumo' ? escHtml(m.cedula_paciente||'—') : 'N/A'}</td>
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
// Preselecciona la ubicación/depósito de origen y el ítem, listos para
// completar el tipo de movimiento.
function quickMov(subSkuId, ubicacion){
  const sub = S.subSkus.find(s => s.id === subSkuId);
  if(!sub){ toastError('Ítem no encontrado'); return; }

  const bodega = (S.bodegasRaw||[]).find(b => b.nombre === ubicacion);
  if(!bodega){ toastError('Depósito no encontrado — recarga la página'); return; }

  goTo('movimientos');

  document.getElementById('mov-origen-sede').value = bodega.ubicacion_id;
  movOrigenSedeChange();
  document.getElementById('mov-origen-deposito').value = bodega.id;
  movOrigenDepositoChange();

  acSelect('mov', sub.id);
}