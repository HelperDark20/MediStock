// ── PANEL ENFERMERO ──
AC['enf'] = { selectedId: null, focusIdx: -1 };

function initEnfermeroPanel(user){
  // Avatar y nombre
  const av = document.getElementById('enf-avatar');
  av.textContent = (user.nombre||'EN').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('enf-nombre').textContent = user.nombre||'Enfermero/a';

  // Mostrar panel
  document.getElementById('enfermero-panel').classList.add('active');

  // Cargar bodegas en select
  const sel = document.getElementById('enf-origen');
  sel.innerHTML = S.bodegas.map(b=>`<option value="${b}">${b}</option>`).join('');

  // Cargar historial del día
  renderEnfHistorial();
}

function enfOnMedSelect(sub){
  if(!sub) return;

  // Mostrar card del medicamento
  const card = document.getElementById('enf-med-card');
  card.classList.add('show');
  document.getElementById('enf-med-name').textContent = sub.nombre;

  const skuG = S.skusGlobales.find(g=>g.id===sub.skuGlobalId);
  document.getElementById('enf-med-sub').textContent =
    `${skuG?.codigo||''} · ${sub.subSku} · Cad: ${fmtDate(sub.caducidad)}`;

  // Mostrar stock por bodega
  const stockEl = document.getElementById('enf-med-stock');
  const bodegasConStock = Object.entries(sub.stock||{}).filter(([,v])=>v>0);
  if(!bodegasConStock.length){
    stockEl.innerHTML = '<span style="font-size:12px;color:var(--red)">Sin stock disponible</span>';
  } else {
    const sem = getSem(sub.caducidad);
    stockEl.innerHTML = bodegasConStock.map(([bodega, cant])=>
      `<div class="enf-stock-chip">
        <i class="ti ti-building-warehouse" style="font-size:12px"></i>
        ${bodega}: <strong>${cant}</strong> ${sub.unidad}
      </div>`
    ).join('') + `<span class="enf-sem ${sem}" style="margin-left:4px">${semLabel(sem)}</span>`;
  }

  // Actualizar origen con solo bodegas con stock
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