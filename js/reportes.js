// ══════════════════════════════════════════
// REPORTES (Nivel 4)
//
// 4 tipos de reporte, seleccionables desde un dropdown:
//   1. consumos  — unidades y gasto por ubicación/depósito, rango de fechas
//   2. cedula    — historial completo de consumos de un paciente (sin límite de fecha)
//   3. pacientes — pacientes distintos atendidos por ubicación (diario + total del rango)
//   4. top       — ítems más consumidos, de mayor a menor gasto, con ubicaciones/depósitos
//
// Todos (excepto "cedula") usan /api/movimientos/reportes con filtros de fecha/
// ubicación/depósito. "cedula" ignora fechas — siempre trae el histórico completo
// de esa cédula, tal como se pidió.
// ══════════════════════════════════════════

const REP_TITULOS = {
  consumos:  { titulo: 'Consumos y gastos por ubicación / depósito' },
  vencidos:  { titulo: 'Vencidos y por vencer — cruce con existencias en Almacén' },
  cedula:    { titulo: 'Consumos por cédula de paciente' },
  pacientes: { titulo: 'Pacientes atendidos por ubicación' },
  top:       { titulo: 'Top ítems más consumidos' }
};

let _repMovimientosCache = null;
let _repCacheKey = null;
let _repCedulaDebounce = null;

function renderReportes(){
  const tipoSel = document.getElementById('rep-tipo-reporte');
  if(!tipoSel) return;

  if(!document.getElementById('rep-fecha-desde').value){
    const hoy = fechaColombia();
    const hace30 = new Date(hoy+'T00:00:00');
    hace30.setDate(hace30.getDate()-30);
    document.getElementById('rep-fecha-desde').value = hace30.toISOString().slice(0,10);
    document.getElementById('rep-fecha-hasta').value = hoy;
  }

  populateRepUbicaciones();
  populateRepDepositos();
  repCambiarTipo();
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

function repCedulaInput(){
  clearTimeout(_repCedulaDebounce);
  _repCedulaDebounce = setTimeout(()=>actualizarReporte(), 400);
}

// ── CAMBIO DE TIPO DE REPORTE: muestra/oculta filtros relevantes ──
function repCambiarTipo(){
  const tipo = document.getElementById('rep-tipo-reporte').value;
  const esCedula = tipo === 'cedula';
  const esVencidos = tipo === 'vencidos';

  document.getElementById('rep-cedula-wrap').style.display      = esCedula ? '' : 'none';
  document.getElementById('rep-fecha-desde-wrap').style.display = (esCedula || esVencidos) ? 'none' : '';
  document.getElementById('rep-fecha-hasta-wrap').style.display = (esCedula || esVencidos) ? 'none' : '';
  document.getElementById('rep-ubicacion-wrap').style.display   = esCedula ? 'none' : '';
  document.getElementById('rep-deposito-wrap').style.display    = (esCedula || tipo==='pacientes') ? 'none' : '';

  document.getElementById('rep-filtros-title').textContent = `Filtros — ${REP_TITULOS[tipo].titulo}`;
  actualizarReporte();
}

// ── OBTENER CONSUMOS DESDE EL BACKEND (con caché simple por combinación de filtros) ──
async function _repFetchConsumos(){
  const fecha_inicio = document.getElementById('rep-fecha-desde').value || '';
  const fecha_fin    = document.getElementById('rep-fecha-hasta').value || '';
  const ubicacion_id = document.getElementById('rep-ubicacion').value || '';
  const bodega       = document.getElementById('rep-deposito').value || '';

  const key = JSON.stringify({ fecha_inicio, fecha_fin, ubicacion_id, bodega });
  if(_repCacheKey === key && _repMovimientosCache) return _repMovimientosCache;

  const params = { tipo: 'consumo' };
  if(fecha_inicio) params.fecha_inicio = fecha_inicio;
  if(fecha_fin)    params.fecha_fin    = fecha_fin;
  if(ubicacion_id) params.ubicacion_id = ubicacion_id;
  if(bodega)       params.bodega       = bodega;

  const data = await Movimientos.getReporte(params);
  _repCacheKey = key;
  _repMovimientosCache = data;
  return data;
}

// ── DISPATCHER PRINCIPAL ──
async function actualizarReporte(){
  const tipo = document.getElementById('rep-tipo-reporte')?.value;
  if(!tipo) return;
  const contenido = document.getElementById('rep-contenido');
  contenido.innerHTML = '<div class="empty-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i><p>Cargando reporte...</p></div>';

  const fDesde = document.getElementById('rep-fecha-desde').value;
  const fHasta = document.getElementById('rep-fecha-hasta').value;
  const meta = REP_TITULOS[tipo];
  const ubSel  = document.getElementById('rep-ubicacion');
  const ubLabel  = ubSel.value ? ubSel.options[ubSel.selectedIndex].textContent : 'Todas las ubicaciones';
  const depSel = document.getElementById('rep-deposito');
  const depLabel = depSel.value || 'Todos los depósitos';

  document.getElementById('rep-print-titulo').textContent = `Nova Bridge — ${meta.titulo}`;
  const printSub = document.getElementById('rep-print-sub');

  try {
    if(tipo === 'cedula'){
      const cedula = (document.getElementById('rep-cedula').value||'').replace(/\D/g,'').trim();
      if(printSub) printSub.textContent = cedula ? `Cédula ${cedula} · Generado el ${new Date().toLocaleDateString('es-CO')}` : '';
      if(!cedula){
        contenido.innerHTML = '<div class="empty-state"><i class="ti ti-id"></i><p>Ingresa la cédula de un paciente para ver su historial de consumos</p></div>';
        return;
      }
      const movs = await Movimientos.getReporte({ tipo:'consumo', cedula_paciente: cedula });
      _repRenderCedula(movs, cedula);
      return;
    }

    if(tipo === 'vencidos'){
      if(printSub) printSub.textContent = `${ubLabel} · ${depLabel} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
      _repRenderVencidos();
      return;
    }

    const movs = await _repFetchConsumos();

    if(tipo === 'consumos'){
      if(printSub) printSub.textContent = `${fDesde||'—'} a ${fHasta||'—'} · ${ubLabel} · ${depLabel} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
      _repRenderConsumos(movs);
    } else if(tipo === 'pacientes'){
      if(printSub) printSub.textContent = `${fDesde||'—'} a ${fHasta||'—'} · ${ubLabel} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
      _repRenderPacientes(movs);
    } else if(tipo === 'top'){
      if(printSub) printSub.textContent = `${fDesde||'—'} a ${fHasta||'—'} · ${ubLabel} · ${depLabel} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
      _repRenderTop(movs);
    }
  } catch(err){
    contenido.innerHTML = '<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error cargando el reporte</p></div>';
    toastError(err.message);
  }
}

// ══════════════════════════════════════════
// REPORTE 1 — CONSUMOS Y GASTOS POR UBICACIÓN/DEPÓSITO
// ══════════════════════════════════════════
function _repAgruparConsumos(movs){
  const porUbicacion = {};
  let totalUnidades = 0, totalValor = 0, itemsSinPrecio = 0;

  movs.forEach(m=>{
    const ubId      = m.origen_ubicacion_id ?? 'sin_ub';
    const ubNombre  = m.origen_ubicacion_nombre || 'Sin ubicación';
    const depNombre = m.origen_nombre || 'Sin depósito';
    const precio    = Number(m.precio)||0;
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

function _repRenderConsumos(movs){
  const { porUbicacion, totalUnidades, totalValor, itemsSinPrecio } = _repAgruparConsumos(movs);
  const depositosConMov = Object.values(porUbicacion).reduce((a,u)=>a+Object.keys(u.depositos).length,0);
  const entries = Object.values(porUbicacion).sort((a,b)=>b.valor-a.valor);

  let filas = '';
  if(!entries.length){
    filas = '<tr><td colspan="4"><div class="empty-state"><i class="ti ti-report"></i><p>Sin consumos registrados en este período</p></div></td></tr>';
  } else {
    entries.forEach(u=>{
      filas += `<tr style="background:var(--cream)">
        <td data-label="Ubicación" style="font-weight:700">${escHtml(u.nombre)}</td>
        <td data-label="Unidades" style="font-family:var(--font-mono);font-weight:700">${u.unidades.toLocaleString('es-CO')}</td>
        <td data-label="Valor" style="font-family:var(--font-mono);font-weight:700">${fmtCOP(u.valor)}</td>
        <td data-label="%" style="font-family:var(--font-mono);font-weight:700">${totalValor?((u.valor/totalValor)*100).toFixed(1):'0.0'}%</td>
      </tr>`;
      Object.entries(u.depositos).sort((a,b)=>b[1].valor-a[1].valor).forEach(([depNombre, dep])=>{
        filas += `<tr>
          <td data-label="Depósito" style="padding-left:28px;color:#666">${escHtml(depNombre)}</td>
          <td data-label="Unidades" style="font-family:var(--font-mono)">${dep.unidades.toLocaleString('es-CO')}</td>
          <td data-label="Valor" style="font-family:var(--font-mono)">${fmtCOP(dep.valor)}</td>
          <td data-label="%" style="font-family:var(--font-mono);color:#888">${totalValor?((dep.valor/totalValor)*100).toFixed(1):'0.0'}%</td>
        </tr>`;
      });
    });
    filas += `<tr style="border-top:2px solid var(--ink)">
      <td data-label="Total">TOTAL</td>
      <td data-label="Unidades" style="font-family:var(--font-mono);font-weight:800">${totalUnidades.toLocaleString('es-CO')}</td>
      <td data-label="Valor" style="font-family:var(--font-mono);font-weight:800">${fmtCOP(totalValor)}</td>
      <td data-label="%" style="font-family:var(--font-mono);font-weight:800">100%</td>
    </tr>`;
  }

  document.getElementById('rep-contenido').innerHTML = `
    <div class="grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-package"></i></div><div class="stat-label">Unidades consumidas</div><div class="stat-val blue">${totalUnidades.toLocaleString('es-CO')}</div><div class="stat-sub">en el período filtrado</div></div>
      <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-coin"></i></div><div class="stat-label">Gasto total</div><div class="stat-val">${fmtCOP(totalValor)}</div><div class="stat-sub">valorado al costo de compra</div></div>
      <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-building-warehouse"></i></div><div class="stat-label">Depósitos con movimiento</div><div class="stat-val amber">${depositosConMov}</div><div class="stat-sub">en el período filtrado</div></div>
      <div class="stat-card"><div class="stat-card-accent red"></div><div class="stat-icon red"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Ítems sin precio</div><div class="stat-val red">${itemsSinPrecio}</div><div class="stat-sub">no se pudo calcular su gasto</div></div>
    </div>
    <div class="sec-header"><div class="sec-title">Consumos y gastos por ubicación / depósito</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ubicación / Depósito</th><th>Unidades consumidas</th><th>Valor (COP)</th><th>% del total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════
// REPORTE 2 — CONSUMOS POR CÉDULA DE PACIENTE
// ══════════════════════════════════════════
function _repRenderCedula(movs, cedula){
  const contenido = document.getElementById('rep-contenido');
  const filtrados = movs.filter(m => !cedula || (m.cedula_paciente||'') === cedula);

  if(!filtrados.length){
    contenido.innerHTML = `<div class="empty-state"><i class="ti ti-id-off"></i><p>Sin consumos registrados para la cédula ${escHtml(cedula)}</p></div>`;
    return;
  }

  let totalUnidades = 0, totalValor = 0;
  const filas = filtrados.map(m=>{
    const precio = Number(m.precio)||0;
    const valor  = precio * m.cantidad;
    totalUnidades += m.cantidad;
    totalValor     += valor;
    return `<tr>
      <td data-label="Fecha" style="font-size:12px;font-family:var(--font-mono)">${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
      <td data-label="SKU"><span class="sku-code">${escHtml(m.sku_global_codigo||'—')}</span></td>
      <td data-label="Ítem">${escHtml(m.nombre||'—')}</td>
      <td data-label="Cantidad" style="font-family:var(--font-mono)">${m.cantidad} ${escHtml(m.unidad||'')}</td>
      <td data-label="Valor" style="font-family:var(--font-mono)">${fmtCOP(valor)}</td>
      <td data-label="Ubicación / Depósito" style="font-size:12px;color:#666">${escHtml(m.origen_ubicacion_nombre||'—')} — ${escHtml(m.origen_nombre||'—')}</td>
      <td data-label="Usuario" style="font-size:12px">${escHtml(m.usuario_nombre||'—')}</td>
    </tr>`;
  }).join('');

  contenido.innerHTML = `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-id"></i></div><div class="stat-label">Cédula consultada</div><div class="stat-val blue" style="font-size:20px">${escHtml(cedula)}</div></div>
      <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-package"></i></div><div class="stat-label">Consumos registrados</div><div class="stat-val">${filtrados.length.toLocaleString('es-CO')}</div><div class="stat-sub">${totalUnidades.toLocaleString('es-CO')} unidades en total</div></div>
      <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-coin"></i></div><div class="stat-label">Valor total consumido</div><div class="stat-val amber">${fmtCOP(totalValor)}</div></div>
    </div>
    <div class="sec-header"><div class="sec-title">Historial de consumos — Cédula ${escHtml(cedula)}</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>SKU</th><th>Ítem</th><th>Cantidad</th><th>Valor</th><th>Ubicación / Depósito</th><th>Usuario</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════
// REPORTE 3 — PACIENTES ATENDIDOS POR UBICACIÓN
// (cuenta cédulas DISTINTAS; consumos sin cédula no se cuentan)
// ══════════════════════════════════════════
function _repAgruparPacientes(movs){
  const conCedula = movs.filter(m => m.cedula_paciente);
  const porFechaUbicacion = {};
  const totalPorUbicacion = {};

  conCedula.forEach(m=>{
    const fecha = fechaColombia(m.created_at);
    const ubNombre = m.origen_ubicacion_nombre || 'Sin ubicación';
    const key = `${fecha}|${ubNombre}`;
    if(!porFechaUbicacion[key]) porFechaUbicacion[key] = { fecha, ubNombre, cedulas: new Set() };
    porFechaUbicacion[key].cedulas.add(m.cedula_paciente);

    if(!totalPorUbicacion[ubNombre]) totalPorUbicacion[ubNombre] = new Set();
    totalPorUbicacion[ubNombre].add(m.cedula_paciente);
  });

  const totalGeneral = new Set(conCedula.map(m=>m.cedula_paciente)).size;
  return { porFechaUbicacion, totalPorUbicacion, totalGeneral, sinCedula: movs.length - conCedula.length };
}

function _repRenderPacientes(movs){
  const { porFechaUbicacion, totalPorUbicacion, totalGeneral, sinCedula } = _repAgruparPacientes(movs);
  const detalle = Object.values(porFechaUbicacion).sort((a,b)=> b.fecha.localeCompare(a.fecha) || a.ubNombre.localeCompare(b.ubNombre));

  const filasDetalle = detalle.length
    ? detalle.map(d=>`<tr>
        <td data-label="Fecha" style="font-family:var(--font-mono);font-size:12px">${fmtDate(d.fecha)}</td>
        <td data-label="Ubicación">${escHtml(d.ubNombre)}</td>
        <td data-label="Pacientes atendidos" style="font-family:var(--font-mono);font-weight:700">${d.cedulas.size}</td>
      </tr>`).join('')
    : '<tr><td colspan="3"><div class="empty-state"><i class="ti ti-users"></i><p>Sin pacientes registrados (con cédula) en este período</p></div></td></tr>';

  const resumenEntries = Object.entries(totalPorUbicacion).sort((a,b)=>b[1].size-a[1].size);
  const filasResumen = resumenEntries.length
    ? resumenEntries.map(([ub, set])=>`<tr>
        <td data-label="Ubicación" style="font-weight:600">${escHtml(ub)}</td>
        <td data-label="Pacientes distintos atendidos" style="font-family:var(--font-mono);font-weight:700">${set.size}</td>
      </tr>`).join('') +
      `<tr style="border-top:2px solid var(--ink)"><td data-label="Total">TOTAL (pacientes distintos, todas las ubicaciones)</td><td data-label="Total" style="font-family:var(--font-mono);font-weight:800">${totalGeneral}</td></tr>`
    : '<tr><td colspan="2"><div class="empty-state"><i class="ti ti-users"></i><p>Sin datos</p></div></td></tr>';

  document.getElementById('rep-contenido').innerHTML = `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-users"></i></div><div class="stat-label">Pacientes distintos atendidos</div><div class="stat-val blue">${totalGeneral}</div><div class="stat-sub">en el rango de fechas seleccionado</div></div>
      <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-calendar"></i></div><div class="stat-label">Días con atención registrada</div><div class="stat-val">${new Set(Object.values(_repAgruparPacientes(movs).porFechaUbicacion).map(d=>d.fecha)).size}</div></div>
      <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Consumos sin cédula</div><div class="stat-val amber">${sinCedula}</div><div class="stat-sub">no se cuentan como paciente</div></div>
    </div>

    <div class="sec-header"><div class="sec-title">Total de pacientes atendidos por ubicación (rango completo)</div></div>
    <div class="table-wrap" style="margin-bottom:20px">
      <table>
        <thead><tr><th>Ubicación</th><th>Pacientes distintos atendidos</th></tr></thead>
        <tbody>${filasResumen}</tbody>
      </table>
    </div>

    <div class="sec-header"><div class="sec-title">Detalle diario por ubicación</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Ubicación</th><th>Pacientes atendidos</th></tr></thead>
        <tbody>${filasDetalle}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════
// REPORTE 4 — TOP ÍTEMS MÁS CONSUMIDOS
// ══════════════════════════════════════════
function _repTopItemsDetallado(movs, limite=30){
  const porItem = {};
  movs.forEach(m=>{
    const precio = Number(m.precio)||0;
    const key = m.sub_sku_id;
    if(!porItem[key]){
      porItem[key] = {
        codigo: m.sku_global_codigo || '—',
        nombre: m.nombre || '—',
        subSku: m.sub_sku || '—',
        unidad: m.unidad || '',
        precio,
        unidades: 0,
        valor: 0,
        ubicaciones: new Set(),
        depositos: new Set()
      };
    }
    porItem[key].unidades += m.cantidad;
    porItem[key].valor    += precio * m.cantidad;
    if(m.origen_ubicacion_nombre) porItem[key].ubicaciones.add(m.origen_ubicacion_nombre);
    if(m.origen_nombre) porItem[key].depositos.add(m.origen_nombre);
  });
  return Object.values(porItem).sort((a,b)=>b.unidades-a.unidades).slice(0, limite);
}

function _repRenderTop(movs){
  const top = _repTopItemsDetallado(movs, 30);
  const totalValor = top.reduce((a,it)=>a+it.valor,0);

  const filas = top.length
    ? top.map((it,idx)=>`<tr>
        <td data-label="#" style="font-family:var(--font-mono);color:#aaa">${idx+1}</td>
        <td data-label="SKU"><span class="sku-code">${escHtml(it.codigo)}</span></td>
        <td data-label="Ítem">
          <div style="font-weight:600">${escHtml(it.nombre)}</div>
          <div style="font-size:11px;color:#aaa">${escHtml(it.subSku)}</div>
        </td>
        <td data-label="Unidades" style="font-family:var(--font-mono);font-weight:700">${it.unidades.toLocaleString('es-CO')} ${escHtml(it.unidad)}</td>
        <td data-label="Costo unitario" style="font-family:var(--font-mono)">${fmtCOP(it.precio)}</td>
        <td data-label="Costo total" style="font-family:var(--font-mono);font-weight:700">${fmtCOP(it.valor)}</td>
        <td data-label="Ubicaciones" style="font-size:11px;color:#666">${[...it.ubicaciones].map(escHtml).join(', ')||'—'}</td>
        <td data-label="Depósitos" style="font-size:11px;color:#666">${[...it.depositos].map(escHtml).join(', ')||'—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8"><div class="empty-state"><i class="ti ti-pill"></i><p>Sin consumos en este período</p></div></td></tr>';

  document.getElementById('rep-contenido').innerHTML = `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-list-numbers"></i></div><div class="stat-label">Ítems en el ranking</div><div class="stat-val blue">${top.length}</div></div>
      <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-coin"></i></div><div class="stat-label">Valor total del top</div><div class="stat-val">${fmtCOP(totalValor)}</div></div>
      <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-package"></i></div><div class="stat-label">Unidades totales</div><div class="stat-val amber">${top.reduce((a,it)=>a+it.unidades,0).toLocaleString('es-CO')}</div></div>
    </div>
    <div class="sec-header"><div class="sec-title">Top ítems más consumidos — de mayor a menor gasto</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>SKU</th><th>Ítem</th><th>Unidades</th><th>Costo unitario</th><th>Costo total</th><th>Ubicaciones</th><th>Depósitos</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════
// REPORTE — VENCIDOS Y POR VENCER (basado en stock actual, agrupado
// por ubicación/depósito) + cruce con existencias en ALMACÉN
// ══════════════════════════════════════════
function _repAgruparVencidos(){
  const ubFiltro  = document.getElementById('rep-ubicacion').value || '';
  const depFiltro = document.getElementById('rep-deposito').value || '';

  const filas = [];
  (S.subSkus||[]).forEach(s=>{
    if(s.agotado) return;
    const sem = getSem(s.caducidad);
    if(!['N','P','R','A'].includes(sem)) return;
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    Object.entries(s.stock||{}).forEach(([bodegaNombre, cantidad])=>{
      if(!cantidad) return;
      const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
      const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
      const ubId = bodega?.ubicacion_id ?? 'sin_ub';
      if(ubFiltro && String(ubId) !== String(ubFiltro)) return;
      if(depFiltro && bodegaNombre !== depFiltro) return;
      filas.push({ s, skuG, sem, bodegaNombre, ubNombre, ubId, cantidad });
    });
  });

  const ordenSem = {N:0, P:1, R:2, A:3};
  filas.sort((a,b)=>
    a.ubNombre.localeCompare(b.ubNombre) ||
    a.bodegaNombre.localeCompare(b.bodegaNombre) ||
    ordenSem[a.sem]-ordenSem[b.sem] ||
    a.s.nombre.localeCompare(b.s.nombre)
  );
  return filas;
}

// Para cada ítem VENCIDO (sem === 'N'), busca existencias del mismo
// SKU Global (cualquier lote/proveedor) en los depósitos de la
// ubicación "ALMACEN" — para facilitar el reemplazo al destruir.
function _repExistenciasAlmacen(filas){
  const vencidosUnicos = {};
  filas.filter(f=>f.sem==='N').forEach(f=>{
    if(!vencidosUnicos[f.s.skuGlobalId]) vencidosUnicos[f.s.skuGlobalId] = { skuG: f.skuG, nombre: f.s.nombre };
  });

  const bodegaNombresAlmacen = new Set(
    (S.bodegasRaw||[])
      .filter(b => (b.ubicacion_nombre||'').toUpperCase().trim() === 'ALMACEN')
      .map(b => b.nombre)
  );

  return Object.values(vencidosUnicos).map(v=>{
    const existencias = [];
    (S.subSkus||[]).filter(s=>s.skuGlobalId===v.skuG?.id).forEach(s=>{
      Object.entries(s.stock||{}).forEach(([bodegaNombre, cantidad])=>{
        if(cantidad>0 && bodegaNombresAlmacen.has(bodegaNombre)){
          existencias.push({ subSku: s.subSku, cantidad, unidad: s.unidad, bodegaNombre });
        }
      });
    });
    return { nombre: v.nombre, skuG: v.skuG, existencias };
  }).sort((a,b)=>a.nombre.localeCompare(b.nombre));
}

function _repRenderVencidos(){
  const filas = _repAgruparVencidos();
  const semLabelLocal = {N:'Vencido', P:'Por vencer', R:'Crítico', A:'Alerta'};

  let filasHtml = '';
  if(!filas.length){
    filasHtml = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-alert-circle"></i><p>Sin ítems vencidos o por vencer</p></div></td></tr>';
  } else {
    let ubActual = null, depActual = null;
    filas.forEach(f=>{
      const nuevaUb  = f.ubNombre !== ubActual;
      const nuevoDep = f.bodegaNombre !== depActual;
      if(nuevaUb){
        filasHtml += `<tr style="background:var(--ink)"><td colspan="5" style="color:#fff;font-weight:700;font-family:var(--font-mono);font-size:12px">${escHtml(f.ubNombre)}</td></tr>`;
      }
      if(nuevaUb || nuevoDep){
        filasHtml += `<tr style="background:var(--cream)"><td colspan="5" style="padding-left:20px;font-weight:700;color:var(--ink2)"><i class="ti ti-building-warehouse" style="margin-right:5px"></i>${escHtml(f.bodegaNombre)}</td></tr>`;
      }
      const diff = f.s.caducidad ? Math.round((new Date(f.s.caducidad.split('T')[0]+'T00:00:00') - new Date(fechaColombia()+'T00:00:00')) / 864e5) : null;
      filasHtml += `<tr>
        <td data-label="Ítem" style="padding-left:28px">
          <div style="font-weight:500">${escHtml(f.s.nombre)}</div>
          <div style="font-size:11px;color:#aaa">${escHtml(f.skuG?.codigo||'')} · ${escHtml(f.s.subSku)}</div>
        </td>
        <td data-label="Cantidad" style="font-family:var(--font-mono);font-weight:700">${f.cantidad} ${escHtml(f.s.unidad)}</td>
        <td data-label="Caducidad" style="font-family:var(--font-mono);font-size:12px">${fmtDate(f.s.caducidad)}</td>
        <td data-label="Estado"><span class="sem ${f.sem}">${semLabelLocal[f.sem]}</span></td>
        <td data-label="Días" style="font-size:11px;color:#888">${diff!==null?(diff<0?'Vencido hace '+Math.abs(diff)+'d':'Faltan '+diff+'d'):''}</td>
      </tr>`;
      ubActual = f.ubNombre; depActual = f.bodegaNombre;
    });
  }

  const existenciasAlmacen = _repExistenciasAlmacen(filas);
  let almacenHtml = '';
  if(!existenciasAlmacen.length){
    almacenHtml = '<div class="empty-state"><i class="ti ti-building-warehouse"></i><p>No hay ítems vencidos para cruzar con Almacén</p></div>';
  } else {
    almacenHtml = existenciasAlmacen.map(v=>{
      return v.existencias.length
        ? v.existencias.map(e=>`
          <div class="alert-strip ok" style="margin-bottom:4px">
            <i class="ti ti-circle-check"></i>
            <div class="alert-text">
              <div class="alert-name">${escHtml(v.nombre)} — ${escHtml(e.subSku)}</div>
              <div class="alert-meta">${e.cantidad} ${escHtml(e.unidad)} · ${escHtml(e.bodegaNombre)}</div>
            </div>
          </div>`).join('')
        : `<div class="alert-strip R" style="margin-bottom:4px">
            <i class="ti ti-alert-circle"></i>
            <div class="alert-text">
              <div class="alert-name">${escHtml(v.nombre)}</div>
              <div class="alert-meta">No hay existencias en Almacén</div>
            </div>
          </div>`;
    }).join('');
  }

  document.getElementById('rep-contenido').innerHTML = `
    <div class="sec-header"><div class="sec-title">Ítems vencidos y por vencer — agrupados por ubicación / depósito</div></div>
    <div class="table-wrap" style="margin-bottom:24px">
      <table>
        <thead><tr><th>Ítem</th><th>Cantidad</th><th>Caducidad</th><th>Estado</th><th>Días</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>
    <div class="sec-header"><div class="sec-title">Existencias en ALMACÉN para reemplazo de vencidos</div></div>
    <div>${almacenHtml}</div>
  `;
}

function _repExportVencidosExcel(){
  const filas = _repAgruparVencidos();
  const existenciasAlmacen = _repExistenciasAlmacen(filas);
  const semLabelLocal = {N:'Vencido', P:'Por vencer', R:'Crítico', A:'Alerta'};

  const aoa = [
    ['Nova Bridge — Vencidos y por vencer'],
    [`Generado el ${new Date().toLocaleDateString('es-CO')}`],
    [],
    ['Ubicación','Depósito','Ítem','Sub-SKU','Cantidad','Caducidad','Estado']
  ];
  filas.forEach(f=>{
    aoa.push([f.ubNombre, f.bodegaNombre, f.s.nombre, f.s.subSku, f.cantidad, fmtDate(f.s.caducidad), semLabelLocal[f.sem]]);
  });
  aoa.push([]);
  aoa.push(['Existencias en ALMACÉN para reemplazo de vencidos']);
  aoa.push(['Ítem','Sub-SKU','Cantidad','Depósito']);
  existenciasAlmacen.forEach(v=>{
    if(v.existencias.length){
      v.existencias.forEach(e=> aoa.push([v.nombre, e.subSku, e.cantidad, e.bodegaNombre]));
    } else {
      aoa.push([v.nombre, '—', 'No hay existencias', '—']);
    }
  });

  _repDescargarExcel(aoa, `Reporte_Vencidos_${fechaColombia()}`);
}

// ══════════════════════════════════════════
// EXPORTAR A EXCEL — dispatcher según tipo activo
// ══════════════════════════════════════════
async function repExportExcel(){
  if(typeof XLSX === 'undefined'){
    toastError('No se pudo cargar el módulo de Excel. Verifica tu conexión e intenta de nuevo.');
    return;
  }
  const tipo = document.getElementById('rep-tipo-reporte').value;
  try {
    if(tipo === 'cedula'){
      const cedula = (document.getElementById('rep-cedula').value||'').replace(/\D/g,'').trim();
      if(!cedula){ toastError('Ingresa una cédula primero'); return; }
      const movs = await Movimientos.getReporte({ tipo:'consumo', cedula_paciente: cedula });
      _repExportCedulaExcel(movs, cedula);
    } else if(tipo === 'vencidos'){
      _repExportVencidosExcel();
    } else {
      const movs = await _repFetchConsumos();
      if(tipo === 'consumos') _repExportConsumosExcel(movs);
      else if(tipo === 'pacientes') _repExportPacientesExcel(movs);
      else if(tipo === 'top') _repExportTopExcel(movs);
    }
  } catch(err){
    toastError(err.message);
  }
}

function _repDescargarExcel(aoa, nombreArchivo){
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:20},{wch:24},{wch:24},{wch:16},{wch:16},{wch:16},{wch:16},{wch:24},{wch:24}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
  toast('✓ Excel generado', 'success');
}

function _repExportConsumosExcel(movs){
  const { porUbicacion, totalUnidades, totalValor } = _repAgruparConsumos(movs);
  const desde = document.getElementById('rep-fecha-desde').value||'—';
  const hasta = document.getElementById('rep-fecha-hasta').value||'—';

  const aoa = [
    ['Nova Bridge — Consumos y gastos por ubicación / depósito'],
    [`Rango: ${desde} a ${hasta}`],
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

  _repDescargarExcel(aoa, `Reporte_Consumos_${desde}_a_${hasta}`);
}

function _repExportCedulaExcel(movs, cedula){
  const filtrados = movs.filter(m => (m.cedula_paciente||'') === cedula);
  const aoa = [
    ['Nova Bridge — Consumos por cédula de paciente'],
    [`Cédula: ${cedula}`],
    [],
    ['Fecha', 'SKU', 'Ítem', 'Cantidad', 'Unidad', 'Valor (COP)', 'Ubicación', 'Depósito', 'Usuario']
  ];
  filtrados.forEach(m=>{
    const valor = (Number(m.precio)||0) * m.cantidad;
    aoa.push([
      new Date(m.created_at).toLocaleString('es-CO'),
      m.sku_global_codigo||'', m.nombre||'', m.cantidad, m.unidad||'',
      valor, m.origen_ubicacion_nombre||'', m.origen_nombre||'', m.usuario_nombre||''
    ]);
  });
  _repDescargarExcel(aoa, `Reporte_Cedula_${cedula}`);
}

function _repExportPacientesExcel(movs){
  const { porFechaUbicacion, totalPorUbicacion } = _repAgruparPacientes(movs);
  const desde = document.getElementById('rep-fecha-desde').value||'—';
  const hasta = document.getElementById('rep-fecha-hasta').value||'—';

  const aoa = [
    ['Nova Bridge — Pacientes atendidos por ubicación'],
    [`Rango: ${desde} a ${hasta}`],
    [],
    ['Total por ubicación (rango completo)'],
    ['Ubicación', 'Pacientes distintos atendidos']
  ];
  Object.entries(totalPorUbicacion).sort((a,b)=>b[1].size-a[1].size).forEach(([ub,set])=>{
    aoa.push([ub, set.size]);
  });
  aoa.push([]);
  aoa.push(['Detalle diario']);
  aoa.push(['Fecha', 'Ubicación', 'Pacientes atendidos']);
  Object.values(porFechaUbicacion).sort((a,b)=> a.fecha.localeCompare(b.fecha) || a.ubNombre.localeCompare(b.ubNombre)).forEach(d=>{
    aoa.push([d.fecha, d.ubNombre, d.cedulas.size]);
  });

  _repDescargarExcel(aoa, `Reporte_Pacientes_${desde}_a_${hasta}`);
}

function _repExportTopExcel(movs){
  const top = _repTopItemsDetallado(movs, 100);
  const desde = document.getElementById('rep-fecha-desde').value||'—';
  const hasta = document.getElementById('rep-fecha-hasta').value||'—';

  const aoa = [
    ['Nova Bridge — Top ítems más consumidos'],
    [`Rango: ${desde} a ${hasta}`],
    [],
    ['#','SKU','Ítem','Sub-SKU','Unidades','Costo unitario','Costo total','Ubicaciones','Depósitos']
  ];
  top.forEach((it,idx)=>{
    aoa.push([idx+1, it.codigo, it.nombre, it.subSku, it.unidades, it.precio, it.valor, [...it.ubicaciones].join(', '), [...it.depositos].join(', ')]);
  });

  _repDescargarExcel(aoa, `Reporte_Top_Items_${desde}_a_${hasta}`);
}

// ══════════════════════════════════════════
// EXPORTAR A PDF (impresión del navegador)
// ══════════════════════════════════════════
function repExportPDF(){
  window.print();
}