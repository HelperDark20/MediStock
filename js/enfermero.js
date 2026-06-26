// ── PANEL ENFERMERO ──
AC['enf'] = { selectedId: null, focusIdx: -1 };

function initEnfermeroPanel(user){
  const av = document.getElementById('enf-avatar');
  av.textContent = (user.nombre||'EN').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('enf-nombre').textContent = user.nombre||'Enfermero/a';
  document.getElementById('enfermero-panel').classList.add('active');

  window._enfUserId = user.id;

  const ubicacionId = user.ubicacion_id || null;
  let bodegasFiltradas = S.bodegasRaw || [];
  if(ubicacionId){
    bodegasFiltradas = bodegasFiltradas.filter(b => b.ubicacion_id === ubicacionId);
  }

  const sel = document.getElementById('enf-origen');
  sel.innerHTML = '<option value="">Seleccionar bodega…</option>' +
    bodegasFiltradas.map(b=>`<option value="${b.nombre}">${b.nombre}</option>`).join('');

  window._enfBodegasPermitidas = new Set(bodegasFiltradas.map(b => b.nombre));

  renderEnfHistorial();
}

function enfOnBodegaChange(){
  const bodega = document.getElementById('enf-origen').value;
  const busquedaWrap = document.getElementById('enf-busqueda-wrap');
  const medCard = document.getElementById('enf-med-card');

  acClear('enf');
  medCard.classList.remove('show');

  if(bodega){
    busquedaWrap.style.opacity = '1';
    busquedaWrap.style.pointerEvents = 'auto';
    document.getElementById('enf-ac-input').focus();
  } else {
    busquedaWrap.style.opacity = '.4';
    busquedaWrap.style.pointerEvents = 'none';
  }
}

function enfOnMedSelect(sub){
  if(!sub) return;

  const bodegaSeleccionada = document.getElementById('enf-origen').value;

  const card = document.getElementById('enf-med-card');
  card.classList.add('show');
  document.getElementById('enf-med-name').textContent = sub.nombre;
  const skuG = S.skusGlobales.find(g=>g.id===sub.skuGlobalId);
  document.getElementById('enf-med-sub').textContent =
    `${skuG?.codigo||''} · ${sub.subSku} · Cad: ${fmtDate(sub.caducidad)}`;

  const stockEl = document.getElementById('enf-med-stock');
  const cantEnBodega = sub.stock?.[bodegaSeleccionada] || 0;

  if(cantEnBodega <= 0){
    stockEl.innerHTML = `<span style="font-size:12px;color:var(--red)">Sin stock en ${bodegaSeleccionada}</span>`;
  } else {
    const sem = getSem(sub.caducidad);
    stockEl.innerHTML = `
      <div class="enf-stock-chip">
        <i class="ti ti-building-warehouse" style="font-size:12px"></i>
        ${bodegaSeleccionada}: <strong>${cantEnBodega}</strong> ${sub.unidad}
      </div>
      <span class="enf-sem ${sem}" style="margin-left:4px">${semLabel(sem)}</span>`;
  }
}

async function enfRegistrarConsumo(){
  const id      = parseInt(document.getElementById('enf-sku').value)||0;
  const cant    = parseInt(document.getElementById('enf-cantidad').value)||0;
  const origen  = document.getElementById('enf-origen').value;
  const paciente= document.getElementById('enf-paciente').value.trim();

  if(!origen)  { toastError('Selecciona una bodega primero'); return; }
  if(!id)      { toastError('Selecciona un medicamento'); return; }
  if(cant<=0)  { toastError('Ingresa una cantidad válida'); return; }

  const btn = document.getElementById('enf-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i>Registrando...';

  try {
    const todasBodegas = await Bodegas.getAll();
    const origenId = todasBodegas.find(b=>b.nombre===origen)?.id;

    if(!origenId){
      toastError('Bodega no encontrada — recarga la página');
      return;
    }

    await Movimientos.consumo({
      sub_sku_id: id,
      bodega_origen_id: origenId,
      cantidad: cant,
      cedula_paciente: paciente||null
    });

    document.getElementById('enf-cantidad').value = '';
    document.getElementById('enf-paciente').value = '';
    acClear('enf');
    document.getElementById('enf-med-card').classList.remove('show');

    await loadState();
    renderEnfHistorial();
    toast('✓ Consumo registrado','success');

  } catch(err){
    toastError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i>Registrar consumo';
  }
}

function renderEnfHistorial(){
  const hoyCO = fechaColombia();
  const consumosHoy = S.movimientos.filter(m=>
    m.tipo==='consumo' &&
    String(m.usuario_id) === String(window._enfUserId) &&
    m.created_at && fechaColombia(m.created_at) === hoyCO
  );

  const el = document.getElementById('enf-history-list');
  if(!consumosHoy.length){
    el.innerHTML=`<div class="enf-empty">
      <i class="ti ti-clipboard"></i>
      <p>Sin consumos registrados hoy</p>
    </div>`;
    return;
  }

  el.innerHTML = consumosHoy.map(m=>`
    <div class="enf-history-item">
      <div class="enf-history-dot"></div>
      <div class="enf-history-info">
        <div class="enf-history-name">${m.nombre||m.sku_global_codigo||'—'}</div>
        <div class="enf-history-meta">
          ${m.origen_nombre||'—'} ·
          ${new Date(m.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'})}
          ${m.cedula_paciente?` · Pac: ${m.cedula_paciente}`:''}
        </div>
      </div>
      <div class="enf-history-cant">${m.cantidad} ${m.unidad||''}</div>
    </div>`).join('');
}