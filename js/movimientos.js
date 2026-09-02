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
    const contTip = m.es_contingencia
      ? `Cargado por ${escHtml(m.cargado_por_nombre||'—')} · Atención: ${m.fecha_atencion?new Date(m.fecha_atencion).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}`
      : '';
    return `
    <tr ${m.revertido?'style="opacity:.55"':''} ${puedeRevertir?`class="mov-row-clickable" onclick="confirmRevertirMovimiento(${m.id})" title="Clic para revertir este movimiento"`:''}>
      <td data-label="Fecha" style="font-size:11px;font-family:var(--font-mono);color:#888">
        ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
      </td>
      <td data-label="Ítem" style="font-weight:500">
        ${escHtml(m.nombre||'—')}
        <div class="mrow-meta">
          <span class="mov-tipo ${m.tipo}" style="font-size:8px">${m.tipo==='reversion'?'Reversión':escHtml(m.tipo)}</span>
          ${escHtml(m.origen_nombre||'—')} → ${escHtml(m.destino_nombre||'—')}
        </div>
        <div class="mrow-meta">
          ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} · ${escHtml(m.usuario_nombre||'—')}${m.tipo==='consumo'&&m.cedula_paciente?' · Pac: '+escHtml(m.cedula_paciente):''}
        </div>
      </td>
      <td data-label="Sub-SKU"><span class="sub-sku" style="font-size:9px">${escHtml((m.sub_sku||'').split('-').slice(0,2).join('-'))}</span></td>
      <td data-label="Tipo">
        <span class="mov-tipo ${m.tipo}">${m.tipo==='reversion'?'Reversión':escHtml(m.tipo)}</span>
        ${m.revertido?'<span class="mov-tipo" style="background:#F0F0EE;color:#888;margin-left:4px">Revertido</span>':''}
        ${m.es_contingencia?`<span class="mov-tipo" style="background:var(--amber-bg);color:var(--amber);margin-left:4px" title="${contTip}">Contingencia</span>`:''}
        ${m.movimiento_original_id?`<div style="font-size:10px;color:#aaa;margin-top:2px">de mov. #${m.movimiento_original_id}</div>`:''}
        ${m.es_contingencia?`<div style="font-size:10px;color:#aaa;margin-top:2px">${contTip}</div>`:''}
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

// ══════════════════════════════════════════
// CONTINGENCIAS — el Administrador carga movimientos que el enfermero
// registró en papel durante una falla de conectividad.
//
// usuario_id/nombre en el movimiento siguen siendo del enfermero que
// atendió; se guarda aparte quién hizo la carga (cargado_por) y la
// fecha real de atención (fecha_atencion), sin tocar created_at (hora
// real de inserción, ancla de auditoría).
// ══════════════════════════════════════════
let _contOrigenBodegaId = null;
let _contOrigenBodegaNombre = null;
let _contUsuarioId = null;
let _contFocusIdx = -1;
let _contEnfFocusIdx = -1;

function abrirContingencia(){
  document.getElementById('cont-enf-input').value = '';
  document.getElementById('cont-usuario-id').value = '';
  document.getElementById('cont-enf-drop').classList.remove('open');
  _contUsuarioId = null;

  // Valor por defecto = ahora, en hora local, y tope máximo = ahora
  // (no se puede registrar una atención "futura").
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset()*60000);
  const isoLocal = local.toISOString().slice(0,16);
  document.getElementById('cont-fecha-atencion').value = isoLocal;
  document.getElementById('cont-fecha-atencion').max = isoLocal;

  const opts = '<option value="">Seleccionar ubicación…</option>' +
    S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  document.getElementById('cont-origen-sede').innerHTML = opts;
  document.getElementById('cont-origen-sede').value = '';
  document.getElementById('cont-destino-sede').innerHTML = opts;
  document.getElementById('cont-destino-sede').value = '';
  document.getElementById('cont-origen-deposito').innerHTML = '<option value="">Selecciona primero la ubicación…</option>';
  document.getElementById('cont-origen-deposito').disabled = true;
  document.getElementById('cont-destino').innerHTML = '<option value="">Selecciona primero la ubicación…</option>';

  _contOrigenBodegaId = null;
  _contOrigenBodegaNombre = null;
  contAcClear();

  const wrap = document.getElementById('cont-item-wrap');
  wrap.style.opacity = '.4';
  wrap.style.pointerEvents = 'none';
  const acInput = document.getElementById('cont-ac-input');
  acInput.disabled = true;
  acInput.placeholder = 'Selecciona primero un depósito de origen';

  document.getElementById('cont-tipo-wrap').style.display = 'none';
  document.getElementById('cont-tipo').value = 'consumo';
  document.getElementById('cont-cantidad').value = '';
  document.getElementById('cont-motivo').value = '';
  document.getElementById('cont-paciente').value = '';

  document.getElementById('modal-contingencia').classList.add('open');
}

// ── AUTOCOMPLETE: ENFERMERO QUE ATENDIÓ ──
function contEnfFilter(){
  const drop = document.getElementById('cont-enf-drop');
  const q = (document.getElementById('cont-enf-input').value||'').toLowerCase().trim();
  _contEnfFocusIdx = -1;
  const pool = (S.usuarios||[]).filter(u => u.nivel === 2);
  const results = pool.filter(u => !q || u.nombre.toLowerCase().includes(q)).slice(0, 8);

  if(!results.length){
    drop.innerHTML = '<div class="ac-no-results">Sin enfermeros disponibles</div>';
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map((u, idx) => `
    <div class="ac-item" data-id="${u.id}" data-nombre="${escHtml(u.nombre)}"
      onmousedown="contEnfSelect(${u.id},'${(u.nombre||'').replace(/'/g,"\\'")}')"
      onmouseover="_contEnfFocusIdx=${idx};document.querySelectorAll('#cont-enf-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===${idx}))">
      <div class="ac-item-icon"><i class="ti ti-stethoscope"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta">CC: ${escHtml(u.cedula||'')}</div>
      </div>
    </div>`).join('');
  drop.classList.add('open');
}

function contEnfKey(e){
  const drop = document.getElementById('cont-enf-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _contEnfFocusIdx = Math.min(_contEnfFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_contEnfFocusIdx));
    items[_contEnfFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _contEnfFocusIdx = Math.max(_contEnfFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_contEnfFocusIdx));
    items[_contEnfFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _contEnfFocusIdx>=0){
    e.preventDefault();
    const item = items[_contEnfFocusIdx];
    contEnfSelect(parseInt(item.dataset.id), item.dataset.nombre);
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function contEnfSelect(id, nombre){
  _contUsuarioId = id;
  document.getElementById('cont-usuario-id').value = id;
  document.getElementById('cont-enf-input').value = nombre;
  document.getElementById('cont-enf-drop').classList.remove('open');
}

function contEnfClear(){
  _contUsuarioId = null;
  document.getElementById('cont-usuario-id').value = '';
  document.getElementById('cont-enf-input').value = '';
  document.getElementById('cont-enf-drop').classList.remove('open');
  document.getElementById('cont-enf-input').focus();
}

document.addEventListener('click', e=>{
  const enfWrap = document.getElementById('cont-enf-wrap');
  if(enfWrap && !enfWrap.contains(e.target)) document.getElementById('cont-enf-drop')?.classList.remove('open');
  const acWrap = document.getElementById('cont-ac-wrap');
  if(acWrap && !acWrap.contains(e.target)) document.getElementById('cont-ac-drop')?.classList.remove('open');
});

// ── ORIGEN: UBICACIÓN Y DEPÓSITO (mismo patrón que Movimientos normal) ──
function contOrigenSedeChange(){
  const sedeId = parseInt(document.getElementById('cont-origen-sede').value)||0;
  const depSel = document.getElementById('cont-origen-deposito');

  contAcClear();
  document.getElementById('cont-tipo-wrap').style.display = 'none';
  _contOrigenBodegaId = null;
  _contOrigenBodegaNombre = null;

  const wrap = document.getElementById('cont-item-wrap');
  const input = document.getElementById('cont-ac-input');
  wrap.style.opacity = '.4';
  wrap.style.pointerEvents = 'none';
  input.disabled = true;
  input.placeholder = 'Selecciona primero un depósito de origen';

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

function contOrigenDepositoChange(){
  const depId = parseInt(document.getElementById('cont-origen-deposito').value)||0;
  contAcClear();
  document.getElementById('cont-tipo-wrap').style.display = 'none';

  const wrap = document.getElementById('cont-item-wrap');
  const input = document.getElementById('cont-ac-input');

  if(!depId){
    _contOrigenBodegaId = null;
    _contOrigenBodegaNombre = null;
    wrap.style.opacity = '.4';
    wrap.style.pointerEvents = 'none';
    input.disabled = true;
    input.placeholder = 'Selecciona primero un depósito de origen';
    return;
  }

  const bodega = (S.bodegasRaw||[]).find(b=>b.id===depId);
  _contOrigenBodegaId = depId;
  _contOrigenBodegaNombre = bodega?.nombre || null;
  wrap.style.opacity = '1';
  wrap.style.pointerEvents = 'auto';
  input.disabled = false;
  input.placeholder = 'Buscar por nombre, SKU, lote…';
}

// ── AUTOCOMPLETE: ÍTEM (mismo patrón FEFO que Movimientos normal) ──
function _contItemRow(s, idx, bodega, q){
  const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
  const cantBodega = s.stock?.[bodega]||0;
  const sem = getSem(s.caducidad);
  const hilite = q ? (str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>')) : (str => str);
  return `<div class="ac-item" data-id="${s.id}"
    onmousedown="contAcSelect(${s.id})"
    onmouseover="_contFocusIdx=${idx};document.querySelectorAll('#cont-ac-drop .ac-item').forEach((el,i)=>el.classList.toggle('focused',i===${idx}))">
    <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
    <div class="ac-item-body">
      <div class="ac-item-name">${hilite(escHtml(s.nombre))}</div>
      <div class="ac-item-meta">
        <span class="sku-code" style="font-size:9px">${escHtml(skuG?.codigo||'')}</span>
        <span>${hilite(escHtml(s.subSku))}</span>
        <span class="enf-sem ${sem}">Vence: ${fmtDate(s.caducidad)}</span>
      </div>
    </div>
    <div class="ac-item-stock">${cantBodega} ${escHtml(s.unidad)}</div>
  </div>`;
}

function contAcFilter(){
  const q     = (document.getElementById('cont-ac-input').value||'').toLowerCase().trim();
  const drop  = document.getElementById('cont-ac-drop');
  const clear = document.getElementById('cont-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  _contFocusIdx = -1;

  const bodega = _contOrigenBodegaNombre;
  if(!bodega || !q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const results = S.subSkus.filter(s => {
    if((s.stock?.[bodega]||0) <= 0) return false;
    return s.nombre.toLowerCase().includes(q) ||
           s.subSku.toLowerCase().includes(q) ||
           (s.lote||'').toLowerCase().includes(q) ||
           (s.proveedor||'').toLowerCase().includes(q);
  }).sort(_fefoSort).slice(0, 10);

  if(!results.length){
    drop.innerHTML = `<div class="ac-no-results">Sin coincidencias con stock en ${escHtml(bodega)}</div>`;
    drop.classList.add('open');
    return;
  }

  drop.innerHTML = results.map((s, idx) => _contItemRow(s, idx, bodega, q)).join('');
  drop.classList.add('open');
}

function contAcOpen(){
  const bodega = _contOrigenBodegaNombre;
  if(!bodega) return;
  const q = document.getElementById('cont-ac-input').value||'';
  if(q){ contAcFilter(); return; }

  const drop = document.getElementById('cont-ac-drop');
  const pool = S.subSkus.filter(s => (s.stock?.[bodega]||0) > 0).sort(_fefoSort);
  if(!pool.length){
    drop.innerHTML = `<div class="ac-no-results">No hay ítems con stock en ${escHtml(bodega)}</div>`;
    drop.classList.add('open');
    return;
  }
  const shown = pool.slice(0, 8);
  drop.innerHTML = shown.map((s, idx) => _contItemRow(s, idx, bodega, '')).join('') +
    (pool.length>8 ? `<div class="ac-no-results" style="padding:8px;font-size:11px">Escribe para filtrar más resultados</div>` : '');
  drop.classList.add('open');
}

function contAcKey(e){
  const drop = document.getElementById('cont-ac-drop');
  const items = drop.querySelectorAll('.ac-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){
    e.preventDefault();
    _contFocusIdx = Math.min(_contFocusIdx+1, items.length-1);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_contFocusIdx));
    items[_contFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    _contFocusIdx = Math.max(_contFocusIdx-1, 0);
    items.forEach((el,i)=>el.classList.toggle('focused',i===_contFocusIdx));
    items[_contFocusIdx]?.scrollIntoView({block:'nearest'});
  } else if(e.key==='Enter' && _contFocusIdx>=0){
    e.preventDefault();
    contAcSelect(parseInt(items[_contFocusIdx].dataset.id));
  } else if(e.key==='Escape'){
    drop.classList.remove('open');
  }
}

function contAcSelect(id){
  const sub = S.subSkus.find(s=>s.id===parseInt(id));
  if(!sub) return;
  document.getElementById('cont-sku').value = sub.id;
  document.getElementById('cont-ac-input').value = sub.nombre;
  document.getElementById('cont-ac-clear').classList.add('show');
  document.getElementById('cont-ac-drop').classList.remove('open');
  const stk = sub.stock?.[_contOrigenBodegaNombre] || 0;
  document.getElementById('cont-ac-pill-text').innerHTML =
    `${escHtml(sub.nombre)} <span style="opacity:.6;font-size:11px">${escHtml(sub.subSku)} · ${stk} ${escHtml(sub.unidad)}</span>`;
  document.getElementById('cont-ac-pill').classList.add('show');
  document.getElementById('cont-tipo-wrap').style.display = '';
  document.getElementById('cont-stock-info').innerHTML = `
    <strong>${escHtml(sub.nombre)}</strong> · ${escHtml(sub.subSku)}<br>
    Stock en <strong>${escHtml(_contOrigenBodegaNombre)}</strong>:
    <strong style="color:var(--blue)">${stk}</strong> ${escHtml(sub.unidad)}`;
  contToggleFields();
}

function contAcClear(){
  const skuInput = document.getElementById('cont-sku');
  if(skuInput) skuInput.value = '';
  const input = document.getElementById('cont-ac-input');
  if(input) input.value = '';
  document.getElementById('cont-ac-clear')?.classList.remove('show');
  document.getElementById('cont-ac-drop')?.classList.remove('open');
  document.getElementById('cont-ac-pill')?.classList.remove('show');
  const tipoWrap = document.getElementById('cont-tipo-wrap');
  if(tipoWrap) tipoWrap.style.display = 'none';
  const stockInfo = document.getElementById('cont-stock-info');
  if(stockInfo) stockInfo.textContent = '—';
}

// ── TIPO DE MOVIMIENTO Y CAMPOS DINÁMICOS (mismo patrón que Movimientos) ──
function contToggleFields(){
  const tipo = document.getElementById('cont-tipo')?.value;
  if(!tipo) return;

  document.getElementById('cont-destino-sede-wrap').style.display = tipo==='traslado'?'':'none';
  document.getElementById('cont-destino-wrap').style.display      = tipo==='traslado'?'':'none';
  document.getElementById('cont-motivo-wrap').style.display       = tipo==='destruccion'?'':'none';
  document.getElementById('cont-paciente-wrap').style.display     = tipo==='consumo'?'':'none';

  const labelCant = document.getElementById('cont-cantidad-label');
  if(labelCant){
    labelCant.textContent = tipo==='traslado' ? 'Cantidad a trasladar'
      : tipo==='consumo' ? 'Cantidad a consumir'
      : 'Cantidad a destruir';
  }

  if(tipo==='traslado'){
    const opts = '<option value="">Seleccionar ubicación…</option>' +
      S.ubicaciones.map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
    document.getElementById('cont-destino-sede').innerHTML = opts;
  }
}

function contDestinoSedeChange(){
  const sedeId = parseInt(document.getElementById('cont-destino-sede').value)||0;
  const depSel = document.getElementById('cont-destino');
  if(!sedeId){
    depSel.innerHTML = '<option value="">Selecciona primero la ubicación…</option>';
    return;
  }
  const depositos = (S.bodegasRaw||[]).filter(b=>b.ubicacion_id===sedeId);
  depSel.innerHTML = depositos.length
    ? '<option value="">Seleccionar depósito…</option>' + depositos.map(b=>`<option value="${b.id}">${escHtml(b.nombre)}</option>`).join('')
    : '<option value="">Sin depósitos en esta ubicación</option>';
}

// ── REGISTRAR CONTINGENCIA ──
async function registrarContingencia(){
  const usuario_id = _contUsuarioId;
  const fechaInput  = document.getElementById('cont-fecha-atencion').value;
  const tipo        = document.getElementById('cont-tipo')?.value;
  const sub_sku_id  = parseInt(document.getElementById('cont-sku').value)||0;
  const cantidad    = parseInt(document.getElementById('cont-cantidad').value)||0;
  const motivo      = document.getElementById('cont-motivo')?.value||'';
  const cedula_paciente = document.getElementById('cont-paciente')?.value.trim()||null;

  if(!usuario_id)         { toastError('Selecciona el enfermero que atendió'); return; }
  if(!fechaInput)         { toastError('Ingresa la fecha y hora de la atención'); return; }
  if(!_contOrigenBodegaId){ toastError('Selecciona la ubicación y depósito de origen'); return; }
  if(!sub_sku_id)         { toastError('Selecciona un ítem'); return; }
  if(!tipo)               { toastError('Selecciona el tipo de movimiento'); return; }
  if(cantidad<=0)         { toastError('Ingresa una cantidad válida'); return; }

  const fecha_atencion = new Date(fechaInput).toISOString();
  if(new Date(fecha_atencion).getTime() > Date.now()){
    toastError('La fecha de atención no puede ser futura');
    return;
  }

  const payload = {
    usuario_id, fecha_atencion, tipo,
    sub_sku_id, bodega_origen_id: _contOrigenBodegaId,
    cantidad, cedula_paciente, motivo
  };

  if(tipo==='traslado'){
    const destinoId = parseInt(document.getElementById('cont-destino').value)||0;
    if(!destinoId){ toastError('Selecciona el depósito destino'); return; }
    if(destinoId===_contOrigenBodegaId){ toastError('Origen y destino son iguales'); return; }
    payload.bodega_destino_id = destinoId;
  }

  try {
    await Movimientos.contingencia(payload);
    closeModal('modal-contingencia');
    await loadState();
    renderMovBody();
    buildNav();
    toast('✓ Contingencia registrada','success');
  } catch(err){
    toastError(err.message);
  }
}