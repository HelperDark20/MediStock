// ══════════════════════════════════════════
// REPORTES (Nivel 4) — Consumos y gastos por ubicación/depósito
//
// Fase 1: consumo + gasto (unidades y valor COP) agrupado por
// Ubicación → Depósito, filtrable por mes/ubicación/depósito.
// El "gasto" se calcula con el precio guardado en cada sub-SKU
// (mismo campo que usa dashboard.js para valorar el inventario).
//
// Próximas fases (pendiente, fuera de este alcance):
//   - Reporte de compras / traslados / destrucciones
//   - Reporte de consumos y gastos por usuario
// ══════════════════════════════════════════

function renderReportes(){
  const mesInput = document.getElementById('rep-mes');
  if(!mesInput) return;
  if(!mesInput.value) mesInput.value = fechaColombia().slice(0,7);

  populateRepUbicaciones();
  populateRepDepositos();
  actualizarReporte();
}

function populateRepUbicaciones(){
  const sel = document.getElementById('rep-ubicacion');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas las ubicaciones</option>' +
    (S.ubicaciones||[]).map(u=>`<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  if(current) sel.value = current;
}

function populateRepDepositos(){
  const sel  = document.getElementById('rep-deposito');
  if(!sel) return;
  const ubId = parseInt(document.getElementById('rep-ubicacion').value)||0;
  const current = sel.value;
  let pool = S.bodegasRaw||[];
  if(ubId) pool = pool.filter(b=>b.ubicacion_id===ubId);
  sel.innerHTML = '<option value="">Todos los depósitos</option>' +
    pool.map(b=>`<option value="${escHtml(b.nombre)}">${escHtml(b.nombre)}</option>`).join('');
  if(current && pool.some(b=>b.nombre===current)) sel.value = current;
  else sel.value = '';
}

function repUbicacionChange(){
  populateRepDepositos();
  actualizarReporte();
}

// ── OBTIENE MOVIMIENTOS DE CONSUMO SEGÚN LOS FILTROS ACTIVOS ──
function _repGetConsumosFiltrados(){
  const mes      = document.getElementById('rep-mes').value;
  const ubId     = parseInt(document.getElementById('rep-ubicacion').value)||0;
  const deposito = document.getElementById('rep-deposito').value;

  return (S.movimientos||[]).filter(m=>{
    if(m.tipo!=='consumo') return false;
    if(!m.created_at) return false;
    if(mes && fechaColombia(m.created_at).slice(0,7)!==mes) return false;
    if(deposito && m.origen_nombre!==deposito) return false;
    if(ubId && !deposito){
      const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===m.origen_nombre);
      if(!bodega || bodega.ubicacion_id!==ubId) return false;
    }
    return true;
  });
}

// ── PRECIO ACTUAL DE UN SUB-SKU (mismo criterio que el dashboard) ──
function _repPrecioDe(subSkuId){
  const sub = (S.subSkus||[]).find(s=>s.id===subSkuId);
  return sub ? (Number(sub.precio)||0) : 0;
}

// ── AGRUPA CONSUMOS: UBICACIÓN → DEPÓSITO ──
function _repAgrupar(movs){
  const porUbicacion = {};
  let totalUnidades = 0, totalValor = 0, itemsSinPrecio = 0;

  movs.forEach(m=>{
    const bodega    = (S.bodegasRaw||[]).find(b=>b.nombre===m.origen_nombre);
    const ubId      = bodega?.ubicacion_id ?? 'sin_ub';
    const ubNombre  = bodega?.ubicacion_nombre || 'Sin ubicación';
    const depNombre = m.origen_nombre || 'Sin depósito';
    const precio    = _repPrecioDe(m.sub_sku_id);
    const valor     = precio * m.cantidad;

    if(!precio) itemsSinPrecio++;

    if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, unidades:0, valor:0, depositos:{} };
    if(!porUbicacion[ubId].depositos[depNombre]) porUbicacion[ubId].depositos[depNombre] = { unidades:0, valor:0 };

    porUbicacion[ubId].unidades += m.cantidad;
    porUbicacion[ubId].valor    += valor;
    porUbicacion[ubId].depositos[depNombre].unidades += m.cantidad;
    porUbicacion[ubId].depositos[depNombre].valor    += valor;

    totalUnidades += m.cantidad;
    totalValor     += valor;
  });

  return { porUbicacion, totalUnidades, totalValor, itemsSinPrecio };
}

// ── TOP ÍTEMS MÁS CONSUMIDOS DENTRO DEL FILTRO ACTIVO ──
function _repTopItems(movs, limite=10){
  const porItem = {};
  movs.forEach(m=>{
    const precio = _repPrecioDe(m.sub_sku_id);
    const key = m.sub_sku_id;
    if(!porItem[key]){
      porItem[key] = {
        codigo: m.sku_global_codigo || '—',
        nombre: m.nombre || '—',
        unidades: 0,
        valor: 0
      };
    }
    porItem[key].unidades += m.cantidad;
    porItem[key].valor    += precio * m.cantidad;
  });
  return Object.values(porItem).sort((a,b)=>b.valor-a.valor).slice(0, limite);
}

// ── RENDER PRINCIPAL: stats + tabla agrupada + top ítems ──
function actualizarReporte(){
  const body    = document.getElementById('rep-body');
  const topBody = document.getElementById('rep-top-body');
  if(!body) return;

  const movs = _repGetConsumosFiltrados();
  const { porUbicacion, totalUnidades, totalValor, itemsSinPrecio } = _repAgrupar(movs);

  // ── Encabezado legible para impresión/PDF ──
  const mesInput = document.getElementById('rep-mes').value;
  const mesLabel = mesInput
    ? new Date(mesInput+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'})
    : 'Todos los meses';
  const ubSel  = document.getElementById('rep-ubicacion');
  const ubLabel  = ubSel.value ? ubSel.options[ubSel.selectedIndex].textContent : 'Todas las ubicaciones';
  const depSel = document.getElementById('rep-deposito');
  const depLabel = depSel.value || 'Todos los depósitos';
  const printSub = document.getElementById('rep-print-sub');
  if(printSub){
    printSub.textContent = `${mesLabel} · ${ubLabel} · ${depLabel} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
  }

  // ── Stat cards ──
  const stats = document.getElementById('rep-stats');
  if(stats){
    const depositosConMov = Object.values(porUbicacion).reduce((a,u)=>a+Object.keys(u.depositos).length,0);
    stats.innerHTML = `
      <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-package"></i></div><div class="stat-label">Unidades consumidas</div><div class="stat-val blue">${totalUnidades.toLocaleString('es-CO')}</div><div class="stat-sub">en el período filtrado</div></div>
      <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-coin"></i></div><div class="stat-label">Gasto total</div><div class="stat-val">${fmtCOP(totalValor)}</div><div class="stat-sub">valorado al costo de compra</div></div>
      <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-building-warehouse"></i></div><div class="stat-label">Depósitos con movimiento</div><div class="stat-val amber">${depositosConMov}</div><div class="stat-sub">en el período filtrado</div></div>
      <div class="stat-card"><div class="stat-card-accent red"></div><div class="stat-icon red"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Ítems sin precio</div><div class="stat-val red">${itemsSinPrecio}</div><div class="stat-sub">no se pudo calcular su gasto</div></div>
    `;
  }

  // ── Tabla agrupada Ubicación → Depósito ──
  const entries = Object.values(porUbicacion).sort((a,b)=>b.valor-a.valor);
  if(!entries.length){
    body.innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="ti ti-report"></i><p>Sin consumos registrados en este período</p></div></td></tr>';
  } else {
    let rows = '';
    entries.forEach(u=>{
      rows += `<tr style="background:var(--cream)">
        <td data-label="Ubicación" style="font-weight:700">${escHtml(u.nombre)}</td>
        <td data-label="Unidades" style="font-family:var(--font-mono);font-weight:700">${u.unidades.toLocaleString('es-CO')}</td>
        <td data-label="Valor" style="font-family:var(--font-mono);font-weight:700">${fmtCOP(u.valor)}</td>
        <td data-label="%" style="font-family:var(--font-mono);font-weight:700">${totalValor?((u.valor/totalValor)*100).toFixed(1):'0.0'}%</td>
      </tr>`;
      Object.entries(u.depositos).sort((a,b)=>b[1].valor-a[1].valor).forEach(([depNombre, dep])=>{
        rows += `<tr>
          <td data-label="Depósito" style="padding-left:28px;color:#666">${escHtml(depNombre)}</td>
          <td data-label="Unidades" style="font-family:var(--font-mono)">${dep.unidades.toLocaleString('es-CO')}</td>
          <td data-label="Valor" style="font-family:var(--font-mono)">${fmtCOP(dep.valor)}</td>
          <td data-label="%" style="font-family:var(--font-mono);color:#888">${totalValor?((dep.valor/totalValor)*100).toFixed(1):'0.0'}%</td>
        </tr>`;
      });
    });
    rows += `<tr style="border-top:2px solid var(--ink)">
      <td data-label="Total">TOTAL</td>
      <td data-label="Unidades" style="font-family:var(--font-mono);font-weight:800">${totalUnidades.toLocaleString('es-CO')}</td>
      <td data-label="Valor" style="font-family:var(--font-mono);font-weight:800">${fmtCOP(totalValor)}</td>
      <td data-label="%" style="font-family:var(--font-mono);font-weight:800">100%</td>
    </tr>`;
    body.innerHTML = rows;
  }

  // ── Top ítems más consumidos ──
  if(topBody){
    const top = _repTopItems(movs);
    topBody.innerHTML = top.length
      ? top.map(it=>`<tr>
          <td data-label="SKU"><span class="sku-code">${escHtml(it.codigo)}</span></td>
          <td data-label="Ítem">${escHtml(it.nombre)}</td>
          <td data-label="Unidades" style="font-family:var(--font-mono)">${it.unidades.toLocaleString('es-CO')}</td>
          <td data-label="Valor" style="font-family:var(--font-mono)">${fmtCOP(it.valor)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4"><div class="empty-state"><i class="ti ti-pill"></i><p>Sin ítems en este período</p></div></td></tr>';
  }
}

// ══════════════════════════════════════════
// EXPORTAR A EXCEL (.xlsx real, vía SheetJS)
// ══════════════════════════════════════════
function repExportExcel(){
  if(typeof XLSX === 'undefined'){
    toastError('No se pudo cargar el módulo de Excel. Verifica tu conexión e intenta de nuevo.');
    return;
  }

  const movs = _repGetConsumosFiltrados();
  const { porUbicacion, totalUnidades, totalValor } = _repAgrupar(movs);
  const mesInput = document.getElementById('rep-mes').value || 'todos';

  const aoa = [
    ['Nova Bridge — Reporte de consumos y gastos'],
    [`Mes: ${mesInput}`],
    [],
    ['Ubicación', 'Depósito', 'Unidades consumidas', 'Valor (COP)']
  ];

  Object.values(porUbicacion).sort((a,b)=>b.valor-a.valor).forEach(u=>{
    aoa.push([u.nombre, 'TODOS LOS DEPÓSITOS', u.unidades, u.valor]);
    Object.entries(u.depositos).sort((a,b)=>b[1].valor-a[1].valor).forEach(([depNombre, dep])=>{
      aoa.push(['', depNombre, dep.unidades, dep.valor]);
    });
  });

  aoa.push([]);
  aoa.push(['TOTAL', '', totalUnidades, totalValor]);

  const top = _repTopItems(movs, 20);
  if(top.length){
    aoa.push([]);
    aoa.push(['Top ítems más consumidos']);
    aoa.push(['SKU', 'Ítem', 'Unidades', 'Valor (COP)']);
    top.forEach(it => aoa.push([it.codigo, it.nombre, it.unidades, it.valor]));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:24},{wch:24},{wch:18},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `Reporte_Consumos_${mesInput}.xlsx`);
  toast('✓ Excel generado', 'success');
}

// ══════════════════════════════════════════
// EXPORTAR A PDF (impresión del navegador — usa la hoja
// de estilos @media print de css/styles.css, que aísla
// #view-reportes y oculta filtros/sidebar/topbar)
// ══════════════════════════════════════════
function repExportPDF(){
  window.print();
}
