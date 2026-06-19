// ── PANEL ENFERMERO ──
AC['enf'] = { selectedId: null, focusIdx: -1 };

function initEnfermeroPanel(user){
  const av = document.getElementById('enf-avatar');
  av.textContent = (user.nombre||'EN').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('enf-nombre').textContent = user.nombre||'Enfermero/a';
  document.getElementById('enfermero-panel').classList.add('active');

  // Filtrar bodegas según ubicación asignada
  const ubicacionId = user.ubicacion_id || null;
  let bodegasFiltradas = S.bodegasRaw || [];
  if(ubicacionId){
    bodegasFiltradas = bodegasFiltradas.filter(b => b.ubicacion_id === ubicacionId);
  }

  // Poblar select de bodega (paso 1)
  const sel = document.getElementById('enf-origen');
  sel.innerHTML = '<option value="">Seleccionar bodega…</option>' +
    bodegasFiltradas.map(b=>`<option value="${b.nombre}">${b.nombre}</option>`).join('');

  // Guardar bodegas permitidas para filtrar autocomplete
  window._enfBodegasPermitidas = new Set(bodegasFiltradas.map(b => b.nombre));

  renderEnfHistorial();
}

// Al cambiar de bodega: habilitar buscador y limpiar selección anterior
function enfOnBodegaChange(){
  const bodega = document.getElementById('enf-origen').value;
  const busquedaWrap = document.getElementById('enf-busqueda-wrap');
  const medCard = document.getElementById('enf-med-card');

  // Limpiar medicamento seleccionado
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

  // Mostrar stock solo de la bodega seleccionada
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

// Filtro del autocomplete: solo muestra items con stock > 0 en la bodega seleccionada
// Se sobreescribe acFilter para 'enf' con esta lógica
const _originalAcFilter = acFilter;
function acFilter(ns){
  if(ns !== 'enf'){ _originalAcFilter(ns); return; }

  const q    = (document.getElementById('enf-ac-input').value||'').toLowerCase().trim();
  const drop = document.getElementById('enf-ac-drop');
  const clear = document.getElementById('enf-ac-clear');
  clear.classList.toggle('show', q.length > 0);
  AC['enf'].focusIdx = -1;

  if(!q){ drop.classList.remove('open'); drop.innerHTML=''; return; }

  const bodega = document.getElementById('enf-origen').value;

  // Filtrar sub-SKUs que tengan stock > 0 en la bodega seleccionada
  const results = S.subSkus.filter(s => {
    if(bodega && (s.stock?.[bodega]||0) <= 0) return false;
    return s.nombre.toLowerCase().includes(q) ||
           s.subSku.toLowerCase().includes(q) ||
           (s.lote||'').toLowerCase().includes(q) ||
           (s.proveedor||'').toLowerCase().includes(q);
  }).slice(0, 10);

  if(!results.length){
    drop.innerHTML='<div class="ac-no-results"><i class="ti ti-search" style="display:block;font-size:22px;margin-bottom:6px;opacity:.3"></i>Sin resultados en esta bodega</div>';
    drop.classList.add('open');
    return;
  }

  const hilite = str => str.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark>$1</mark>');

  drop.innerHTML = results.map((s, idx) => {
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const cantBodega = bodega ? (s.stock?.[bodega]||0) : getTotalStock(s);
    return `<div class="ac-item" data-id="${s.id}"
      onmousedown="acSelect('enf',${s.id})"
      onmouseover="acHover('enf',${idx})">
      <div class="ac-item-icon"><i class="ti ti-pill"></i></div>
      <div class="ac-item-body">
        <div class="ac-item-name">${hilite(s.nombre)}</div>
        <div class="ac-item-meta">
          <span class="sku-code" style="font-size:9px">${skuG?.codigo||''}</span>
          <span>${hilite(s.subSku)}</span>
          ${s.lote&&s.lote!=='—'?`<span>Lote: ${hilite(s.lote)}</span>`:''}
        </div>
      </div>
      <div class="ac-item-stock">${cantBodega} ${s.unidad}</div>
    </div>`;
  }).join('');
  drop.classList.add('open');
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
  const hoy = new Date().toISOString().split('T')[0];
  const consumosHoy = S.movimientos.filter(m=>
    m.tipo==='consumo' && m.created_at?.startsWith(hoy)
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