// ── PANEL ENFERMERO ──
AC['enf'] = { selectedId: null, focusIdx: -1 };

function initEnfermeroPanel(user){
  const av = document.getElementById('enf-avatar');
  av.textContent = (user.nombre||'EN').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('enf-nombre').textContent = user.nombre||'Enfermero/a';
  document.getElementById('enfermero-panel').classList.add('active');

  // Filtrar bodegas según ubicación asignada al usuario
  const ubicacionId = user.ubicacion_id || null;
  let bodegasFiltradas = S.bodegasRaw || [];
  if(ubicacionId){
    bodegasFiltradas = bodegasFiltradas.filter(b => b.ubicacion_id === ubicacionId);
  }

  const sel = document.getElementById('enf-origen');
  sel.innerHTML = bodegasFiltradas.map(b=>`<option value="${b.nombre}">${b.nombre}</option>`).join('');

  // Guardar lista de bodegas permitidas para filtrar el autocomplete
  window._enfBodegasPermitidas = new Set(bodegasFiltradas.map(b => b.nombre));

  renderEnfHistorial();
}

function enfOnMedSelect(sub){
  if(!sub) return;
  const card = document.getElementById('enf-med-card');
  card.classList.add('show');
  document.getElementById('enf-med-name').textContent = sub.nombre;
  const skuG = S.skusGlobales.find(g=>g.id===sub.skuGlobalId);
  document.getElementById('enf-med-sub').textContent =
    `${skuG?.codigo||''} · ${sub.subSku} · Cad: ${fmtDate(sub.caducidad)}`;

  // Filtrar por bodegas permitidas de la ubicación asignada
  const permitidas = window._enfBodegasPermitidas;
  const bodegasConStock = Object.entries(sub.stock||{})
    .filter(([bodega, v]) => v > 0 && (!permitidas || permitidas.has(bodega)));

  const stockEl = document.getElementById('enf-med-stock');
  if(!bodegasConStock.length){
    stockEl.innerHTML = '<span style="font-size:12px;color:var(--red)">Sin stock disponible en tu ubicación</span>';
  } else {
    const sem = getSem(sub.caducidad);
    stockEl.innerHTML = bodegasConStock.map(([bodega, cant])=>
      `<div class="enf-stock-chip">
        <i class="ti ti-building-warehouse" style="font-size:12px"></i>
        ${bodega}: <strong>${cant}</strong> ${sub.unidad}
      </div>`
    ).join('') + `<span class="enf-sem ${sem}" style="margin-left:4px">${semLabel(sem)}</span>`;
  }

  const sel = document.getElementById('enf-origen');
  sel.innerHTML = bodegasConStock.length
    ? bodegasConStock.map(([b])=>`<option value="${b}">${b}</option>`).join('')
    : '<option value="">Sin stock</option>';
}

async function enfRegistrarConsumo(){
  const id = parseInt(document.getElementById('enf-sku').value)||0;
  const cant = parseInt(document.getElementById('enf-cantidad').value)||0;
  const origen = document.getElementById('enf-origen').value;
  const paciente = document.getElementById('enf-paciente').value.trim();

  if(!id){ toastError('Selecciona un medicamento'); return; }
  if(cant<=0){ toastError('Ingresa una cantidad válida'); return; }
  if(!origen){ toastError('Selecciona una bodega'); return; }

  const btn = document.getElementById('enf-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i>Registrando...';

  try {
    const todasBodegas = await Bodegas.getAll();
    const origenId = todasBodegas.find(b=>b.nombre===origen)?.id;

    await Movimientos.consumo({
      sub_sku_id: id,
      bodega_origen_id: origenId,
      cantidad: cant,
      cedula_paciente: paciente||null
    });

    // Limpiar formulario
    document.getElementById('enf-cantidad').value = '';
    document.getElementById('enf-paciente').value = '';
    acClear('enf');
    document.getElementById('enf-med-card').classList.remove('show');

    // Recargar datos y historial
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
  const hoy = new Date().toISOString().split('T')[0];
  const consumosHoy = S.movimientos.filter(m=>
    m.tipo==='consumo' &&
    m.created_at?.startsWith(hoy)
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
          ${new Date(m.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}
          ${m.cedula_paciente?` · Pac: ${m.cedula_paciente}`:''}
        </div>
      </div>
      <div class="enf-history-cant">${m.cantidad} ${m.unidad||''}</div>
    </div>`).join('');
}