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
  seguridad: { titulo: 'Stock de seguridad por depósito' },
  cedula:    { titulo: 'Consumos por cédula de paciente' },
  pacientes: { titulo: 'Pacientes atendidos por ubicación' },
  top:       { titulo: 'Top ítems más consumidos' }
};

let _repMovimientosCache = null;
let _repCacheKey = null;
let _repCedulaDebounce = null;

function _repStatPill(tono, icon, num, label){
  return `<div class="rep-stat">
    <div class="rep-stat-icon ${tono}"><i class="ti ${icon}"></i></div>
    <div><div class="rep-stat-num">${num}</div><div class="rep-stat-label">${label}</div></div>
  </div>`;
}
function _repStatsHtml(pills){
  return `<div class="rep-stats">${pills.join('')}</div>`;
}

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
  const esSeguridad = tipo === 'seguridad';

  document.getElementById('rep-cedula-wrap').style.display      = esCedula ? '' : 'none';
  document.getElementById('rep-fecha-desde-wrap').style.display = (esCedula || esVencidos || esSeguridad) ? 'none' : '';
  document.getElementById('rep-fecha-hasta-wrap').style.display = (esCedula || esVencidos || esSeguridad) ? 'none' : '';
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

  document.getElementById('rep-meta-fecha').textContent =
    `Generado el ${new Date().toLocaleString('es-CO',{dateStyle:'long',timeStyle:'short'})}`;
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

    if(tipo === 'seguridad'){
      const depNombre = document.getElementById('rep-deposito').value;
      if(printSub) printSub.textContent = `${depNombre||'Selecciona un depósito'} · Generado el ${new Date().toLocaleDateString('es-CO')}`;
      _repRenderSeguridad(depNombre);
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

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-package', totalUnidades.toLocaleString('es-CO'), 'Unidades consumidas'),
    _repStatPill('green','ti-coin', fmtCOP(totalValor), 'Gasto total'),
    _repStatPill('amber','ti-building-warehouse', depositosConMov, 'Depósitos con movimiento'),
    _repStatPill('red','ti-alert-triangle', itemsSinPrecio, 'Ítems sin precio')
  ]);

  let gruposHtml = '';
  if(!entries.length){
    gruposHtml = '<div class="empty-state"><i class="ti ti-report"></i><p>Sin consumos registrados en este período</p></div>';
  } else {
    entries.forEach(u=>{
      const deps = Object.entries(u.depositos).sort((a,b)=>b[1].valor-a[1].valor);
      const rows = deps.map(([depNombre, dep])=>`
        <div class="rep-row" style="--rep-grid:1fr 140px 160px 80px">
          <div class="rep-item-name">${escHtml(depNombre)}</div>
          <div class="rep-cell-mono strong">${dep.unidades.toLocaleString('es-CO')}</div>
          <div class="rep-cell-mono strong">${fmtCOP(dep.valor)}</div>
          <div class="rep-cell-mono" style="color:#888">${totalValor?((dep.valor/totalValor)*100).toFixed(1):'0.0'}%</div>
        </div>`).join('');
      gruposHtml += `
        <div class="rep-group">
          <div class="rep-group-head">
            <div class="rep-group-name"><i class="ti ti-map-pin"></i> ${escHtml(u.nombre)}</div>
            <div class="rep-group-count">${fmtCOP(u.valor)} · ${u.unidades.toLocaleString('es-CO')} u.</div>
          </div>
          <div class="rep-cols" style="--rep-grid:1fr 140px 160px 80px"><div>Depósito</div><div>Unidades</div><div>Valor</div><div>%</div></div>
          ${rows}
        </div>`;
    });
  }

  document.getElementById('rep-contenido').innerHTML = `
    ${stats}
    <div class="rep-section-title">Consumos y gastos por ubicación / depósito</div>
    ${gruposHtml}`;
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

  let totalValor = 0;
  const rows = filtrados.map(m=>{
    const precio = Number(m.precio)||0;
    const valor  = precio * m.cantidad;
    totalValor += valor;
    return `<div class="rep-row" style="--rep-grid:100px 1fr 100px 110px 1fr 130px">
      <div class="rep-cell-mono" style="font-size:11px">${new Date(m.created_at).toLocaleDateString('es-CO',{day:'2-digit',month:'short'})}</div>
      <div><div class="rep-item-name">${escHtml(m.nombre||'—')}</div><div class="rep-item-code">${escHtml(m.sku_global_codigo||'')}</div></div>
      <div class="rep-cell-mono strong">${m.cantidad} ${escHtml(m.unidad||'')}</div>
      <div class="rep-cell-mono">${fmtCOP(valor)}</div>
      <div style="font-size:11px;color:#666">${escHtml(m.origen_ubicacion_nombre||'—')} — ${escHtml(m.origen_nombre||'—')}</div>
      <div style="font-size:11px">${escHtml(m.usuario_nombre||'—')}</div>
    </div>`;
  }).join('');

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-id', escHtml(cedula), 'Cédula consultada'),
    _repStatPill('green','ti-package', filtrados.length, 'Consumos registrados'),
    _repStatPill('amber','ti-coin', fmtCOP(totalValor), 'Valor total consumido')
  ]);

  contenido.innerHTML = `
    ${stats}
    <div class="rep-section-title">Historial de consumos — Cédula ${escHtml(cedula)}</div>
    <div class="rep-group">
      <div class="rep-cols" style="--rep-grid:100px 1fr 100px 110px 1fr 130px"><div>Fecha</div><div>Ítem</div><div>Cantidad</div><div>Valor</div><div>Ubicación/Depósito</div><div>Usuario</div></div>
      ${rows}
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
  const diasConAtencion = new Set(Object.values(porFechaUbicacion).map(d=>d.fecha)).size;

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-users', totalGeneral, 'Pacientes distintos atendidos'),
    _repStatPill('green','ti-calendar', diasConAtencion, 'Días con atención registrada'),
    _repStatPill('amber','ti-alert-triangle', sinCedula, 'Consumos sin cédula')
  ]);

  const resumenEntries = Object.entries(totalPorUbicacion).sort((a,b)=>b[1].size-a[1].size);
  const resumenRows = resumenEntries.length
    ? resumenEntries.map(([ub,set])=>`<div class="rep-row" style="--rep-grid:1fr 160px"><div class="rep-item-name">${escHtml(ub)}</div><div class="rep-cell-mono strong">${set.size}</div></div>`).join('')
    : '<div class="empty-state"><i class="ti ti-users"></i><p>Sin datos</p></div>';

  const porUb = {};
  Object.values(porFechaUbicacion).forEach(d=>{
    if(!porUb[d.ubNombre]) porUb[d.ubNombre] = [];
    porUb[d.ubNombre].push(d);
  });

  let detalleHtml = '';
  const ubs = Object.keys(porUb).sort();
  if(!ubs.length){
    detalleHtml = '<div class="empty-state"><i class="ti ti-users"></i><p>Sin pacientes registrados (con cédula) en este período</p></div>';
  } else {
    ubs.forEach(ub=>{
      const dias = porUb[ub].sort((a,b)=>b.fecha.localeCompare(a.fecha));
      const rows = dias.map(d=>`<div class="rep-row" style="--rep-grid:130px 1fr"><div class="rep-cell-mono">${fmtDate(d.fecha)}</div><div class="rep-cell-mono strong">${d.cedulas.size} paciente${d.cedulas.size!==1?'s':''}</div></div>`).join('');
      detalleHtml += `<div class="rep-group">
        <div class="rep-group-head"><div class="rep-group-name"><i class="ti ti-map-pin"></i> ${escHtml(ub)}</div><div class="rep-group-count">${dias.length} día${dias.length!==1?'s':''}</div></div>
        <div class="rep-cols" style="--rep-grid:130px 1fr"><div>Fecha</div><div>Pacientes atendidos</div></div>
        ${rows}
      </div>`;
    });
  }

  document.getElementById('rep-contenido').innerHTML = `
    ${stats}
    <div class="rep-section-title">Total de pacientes atendidos por ubicación</div>
    <div class="rep-group"><div class="rep-cols" style="--rep-grid:1fr 160px"><div>Ubicación</div><div>Pacientes distintos</div></div>${resumenRows}</div>
    <div class="rep-section-title">Detalle diario por ubicación</div>
    ${detalleHtml}`;
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
  const totalUnidades = top.reduce((a,it)=>a+it.unidades,0);

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-list-numbers', top.length, 'Ítems en el ranking'),
    _repStatPill('green','ti-coin', fmtCOP(totalValor), 'Valor total del top'),
    _repStatPill('amber','ti-package', totalUnidades.toLocaleString('es-CO'), 'Unidades totales')
  ]);

  const rows = top.length
    ? top.map((it,idx)=>`
      <div class="rep-row" style="--rep-grid:36px 1fr 110px 120px 130px 1fr">
        <div class="rep-cell-mono" style="color:#aaa">${idx+1}</div>
        <div><div class="rep-item-name">${escHtml(it.nombre)}</div><div class="rep-item-code">${escHtml(it.codigo)} · ${escHtml(it.subSku)}</div></div>
        <div class="rep-cell-mono strong">${it.unidades.toLocaleString('es-CO')} ${escHtml(it.unidad)}</div>
        <div class="rep-cell-mono">${fmtCOP(it.precio)}</div>
        <div class="rep-cell-mono strong">${fmtCOP(it.valor)}</div>
        <div style="font-size:10px;color:#666">
          <div>${[...it.ubicaciones].map(escHtml).join(', ')||'—'}</div>
          <div style="color:#aaa;margin-top:2px">${[...it.depositos].map(escHtml).join(', ')||'—'}</div>
        </div>
      </div>`).join('')
    : '<div class="empty-state"><i class="ti ti-pill"></i><p>Sin consumos en este período</p></div>';

  document.getElementById('rep-contenido').innerHTML = `
    ${stats}
    <div class="rep-section-title">Top ítems más consumidos — de mayor a menor cantidad</div>
    <div class="rep-group">
      <div class="rep-cols" style="--rep-grid:36px 1fr 110px 120px 130px 1fr"><div>#</div><div>Ítem</div><div>Unidades</div><div>Costo unit.</div><div>Costo total</div><div>Ubic. / Dep.</div></div>
      ${rows}
    </div>`;
}

// ══════════════════════════════════════════
// REPORTE — STOCK DE SEGURIDAD POR DEPÓSITO
// ══════════════════════════════════════════
function _tokenizeBodega(nombre){
  return (nombre||'').toUpperCase().split(/[\s\-]+/).filter(Boolean);
}

// Encuentra el grupo cuyo patrón de tokens está contenido en el nombre
// del depósito. Si varios matchean, se queda con el más específico
// (el que tiene más tokens en su patrón).
function _repBuscarGrupoSeguridad(bodegaNombre){
  const tokens = new Set(_tokenizeBodega(bodegaNombre));
  const candidatos = (S.stockSeguridad||[]).filter(g =>
    (g.patron_tokens||[]).every(t => tokens.has(String(t).toUpperCase()))
  );
  if(!candidatos.length) return null;
  candidatos.sort((a,b)=> (b.patron_tokens||[]).length - (a.patron_tokens||[]).length);
  return candidatos[0];
}

function _repCompararSeguridad(bodegaNombre, grupo){
  // Suma la cantidad actual de cada SKU Global en este depósito
  // (agregando todos sus sub-SKUs/lotes juntos).
  const actualPorNombre = {};
  (S.subSkus||[]).forEach(s=>{
    const cant = s.stock?.[bodegaNombre] || 0;
    if(!cant) return;
    const key = (s.nombre||'').trim().toUpperCase();
    actualPorNombre[key] = (actualPorNombre[key]||0) + cant;
  });

  const esperadosNombres = new Set(grupo.items.map(it=>it.item_nombre.trim().toUpperCase()));

  const faltantes = [], diferencias = [], completos = [];
  grupo.items.forEach(it=>{
    const key = it.item_nombre.trim().toUpperCase();
    const actual = actualPorNombre[key] || 0;
    if(actual === 0){
      faltantes.push({ nombre: it.item_nombre, esperado: it.cantidad_esperada, actual: 0 });
    } else if(actual !== it.cantidad_esperada){
      diferencias.push({ nombre: it.item_nombre, esperado: it.cantidad_esperada, actual });
    } else {
      completos.push({ nombre: it.item_nombre, esperado: it.cantidad_esperada, actual });
    }
  });

  const sobrantes = Object.entries(actualPorNombre)
    .filter(([nombre]) => !esperadosNombres.has(nombre))
    .map(([nombre, cantidad]) => ({ nombre, cantidad }));

  return { faltantes, diferencias, completos, sobrantes };
}

function _repRenderSeguridad(depNombre){
  const contenido = document.getElementById('rep-contenido');
  if(!depNombre){
    contenido.innerHTML = '<div class="empty-state"><i class="ti ti-shield-check"></i><p>Selecciona un depósito para ver su stock de seguridad</p></div>';
    return;
  }
  const grupo = _repBuscarGrupoSeguridad(depNombre);
  if(!grupo){
    contenido.innerHTML = `<div class="empty-state"><i class="ti ti-alert-triangle"></i><p>No hay una lista de stock de seguridad definida para <strong>${escHtml(depNombre)}</strong></p></div>`;
    return;
  }
  const { faltantes, diferencias, completos, sobrantes } = _repCompararSeguridad(depNombre, grupo);

  const stats = _repStatsHtml([
    _repStatPill('blue','ti-list-check', grupo.items.length, 'Ítems en la lista'),
    _repStatPill('red','ti-alert-circle', faltantes.length, 'Faltantes'),
    _repStatPill('amber','ti-scale', diferencias.length, 'Con diferencia'),
    _repStatPill('gray','ti-package', sobrantes.length, 'Sobrantes')
  ]);

  const filaCompare = (it) => {
    const delta = it.actual - it.esperado;
    const deltaTxt = delta>0?`+${delta}`:`${delta}`;
    return `<div class="rep-row" style="--rep-grid:1fr 100px 100px 100px">
      <div class="rep-item-name">${escHtml(it.nombre)}</div>
      <div class="rep-cell-mono">${it.esperado}</div>
      <div class="rep-cell-mono strong">${it.actual}</div>
      <div class="rep-cell-mono" style="color:${delta<0?'var(--red2)':'var(--amber)'}">${deltaTxt}</div>
    </div>`;
  };

  const faltantesHtml = faltantes.length
    ? `<div class="rep-group"><div class="rep-group-head tono-red"><div class="rep-group-name">Faltantes</div></div><div class="rep-cols" style="--rep-grid:1fr 100px 100px 100px"><div>Ítem</div><div>Esperado</div><div>Actual</div><div></div></div>${faltantes.map(filaCompare).join('')}</div>`
    : '<div class="empty-state"><i class="ti ti-circle-check"></i><p>Sin faltantes</p></div>';

  const diferenciasHtml = diferencias.length
    ? `<div class="rep-group"><div class="rep-group-head tono-amber"><div class="rep-group-name">Con diferencia</div></div><div class="rep-cols" style="--rep-grid:1fr 100px 100px 100px"><div>Ítem</div><div>Esperado</div><div>Actual</div><div>Diferencia</div></div>${diferencias.map(filaCompare).join('')}</div>`
    : '<div class="empty-state"><i class="ti ti-circle-check"></i><p>Sin diferencias de cantidad</p></div>';

  const sobrantesHtml = sobrantes.length
    ? '<div class="rep-list-simple">' + sobrantes.map(s=>`<div class="rep-list-row"><div class="rep-list-dot warn"></div><div><div class="rep-list-name">${escHtml(s.nombre)}</div><div class="rep-list-meta">${s.cantidad} unidades — fuera de la lista de seguridad</div></div></div>`).join('') + '</div>'
    : '<div class="empty-state"><i class="ti ti-circle-check"></i><p>Sin sobrantes</p></div>';

  const completosHtml = completos.length
    ? '<div class="rep-list-simple">' + completos.map(it=>`<div class="rep-list-row"><div class="rep-list-dot ok"></div><div><div class="rep-list-name">${escHtml(it.nombre)}</div><div class="rep-list-meta">${it.actual} unidades — cantidad correcta</div></div></div>`).join('') + '</div>'
    : '<div class="empty-state"><i class="ti ti-alert-triangle"></i><p>Ninguno completo</p></div>';

  document.getElementById('rep-contenido').innerHTML = `
    ${stats}
    <div class="rep-section-title">Faltantes — sin existencias en el depósito</div>
    ${faltantesHtml}
    <div class="rep-section-title">Con diferencia de cantidad</div>
    ${diferenciasHtml}
    <div class="rep-section-title">Sobrantes — fuera de la lista de seguridad</div>
    ${sobrantesHtml}
    <div class="rep-section-title">Completos (${completos.length})</div>
    ${completosHtml}`;
}

function _repExportSeguridadExcel(depNombre){
  if(!depNombre){ toastError('Selecciona un depósito primero'); return; }
  const grupo = _repBuscarGrupoSeguridad(depNombre);
  if(!grupo){ toastError('No hay lista de stock de seguridad para este depósito'); return; }
  const { faltantes, diferencias, completos, sobrantes } = _repCompararSeguridad(depNombre, grupo);

  const aoa = [
    ['Nova Bridge — Stock de seguridad'],
    [`Depósito: ${depNombre} · Grupo: ${grupo.nombre}`],
    [],
    ['FALTANTES'], ['Ítem','Esperado','Actual']
  ];
  faltantes.forEach(it=>aoa.push([it.nombre, it.esperado, it.actual]));
  aoa.push([]); aoa.push(['CON DIFERENCIA DE CANTIDAD']); aoa.push(['Ítem','Esperado','Actual','Diferencia']);
  diferencias.forEach(it=>aoa.push([it.nombre, it.esperado, it.actual, it.actual-it.esperado]));
  aoa.push([]); aoa.push(['SOBRANTES (fuera de lista)']); aoa.push(['Ítem','Cantidad actual']);
  sobrantes.forEach(s=>aoa.push([s.nombre, s.cantidad]));
  aoa.push([]); aoa.push(['COMPLETOS']); aoa.push(['Ítem','Cantidad']);
  completos.forEach(it=>aoa.push([it.nombre, it.actual]));

  _repDescargarExcel(aoa, `Stock_Seguridad_${depNombre.replace(/\s+/g,'_')}`);
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

  const counts = {N:0,P:0,R:0,A:0};
  const ubicacionesSet = new Set();
  filas.forEach(f=>{ counts[f.sem]++; ubicacionesSet.add(f.ubNombre); });

  const stats = _repStatsHtml([
    _repStatPill('maroon','ti-x', counts.N, 'Vencidos'),
    _repStatPill('orange','ti-alert-circle', counts.R, 'Críticos'),
    _repStatPill('amber','ti-bell', counts.A, 'Alertas'),
    _repStatPill('red','ti-clock', counts.P, 'Por vencer'),
    _repStatPill('blue','ti-map-pin', ubicacionesSet.size, 'Ubicaciones')
  ]);

  let gruposHtml = '';
  if(!filas.length){
    gruposHtml = '<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Sin ítems vencidos o por vencer</p></div>';
  } else {
    const grupos = [];
    let grupoActual = null;
    filas.forEach(f=>{
      const key = f.ubNombre + '|' + f.bodegaNombre;
      if(!grupoActual || grupoActual.key !== key){
        grupoActual = { key, ubNombre:f.ubNombre, bodegaNombre:f.bodegaNombre, items:[] };
        grupos.push(grupoActual);
      }
      grupoActual.items.push(f);
    });

    grupos.forEach(g=>{
      const rows = g.items.map(f=>{
        const diff = f.s.caducidad ? Math.round((new Date(f.s.caducidad.split('T')[0]+'T00:00:00') - new Date(fechaColombia()+'T00:00:00')) / 864e5) : null;
        const diasTxt = diff!==null ? (diff<0 ? `Vencido hace ${Math.abs(diff)}d` : `${diff}d`) : '';
        return `<div class="rep-row" style="--rep-grid:110px 1fr 100px 100px 100px 130px">
          <div><span class="sem-badge ${f.sem}">${semLabelLocal[f.sem]}</span></div>
          <div><div class="rep-item-name">${escHtml(f.s.nombre)}</div><div class="rep-item-code">${escHtml(f.skuG?.codigo||'')}</div></div>
          <div class="rep-cell-mono strong">${f.cantidad} ${escHtml(f.s.unidad)}</div>
          <div class="rep-cell-mono">${fmtDate(f.s.caducidad)}</div>
          <div class="rep-cell-mono" style="color:${diff<0?'var(--maroon)':'#888'}">${diasTxt}</div>
          <div class="rep-cell-mono" style="font-size:10px;color:#999">${escHtml(f.s.subSku)}</div>
        </div>`;
      }).join('');
      gruposHtml += `<div class="rep-group">
        <div class="rep-group-head">
          <div class="rep-group-name"><i class="ti ti-building-warehouse"></i> ${escHtml(g.ubNombre)} / ${escHtml(g.bodegaNombre)}</div>
          <div class="rep-group-count">${g.items.length} ítem${g.items.length!==1?'s':''}</div>
        </div>
        <div class="rep-cols" style="--rep-grid:110px 1fr 100px 100px 100px 130px"><div>Estado</div><div>Producto</div><div>Cantidad</div><div>Vencimiento</div><div>Restante</div><div>Lote</div></div>
        ${rows}
      </div>`;
    });
  }

  const existenciasAlmacen = _repExistenciasAlmacen(filas);
  let almacenHtml = '';
  if(!existenciasAlmacen.length){
    almacenHtml = '<div class="empty-state"><i class="ti ti-building-warehouse"></i><p>No hay ítems vencidos para cruzar con Almacén</p></div>';
  } else {
    almacenHtml = '<div class="rep-list-simple">' + existenciasAlmacen.map(v=>
      v.existencias.length
        ? v.existencias.map(e=>`<div class="rep-list-row"><div class="rep-list-dot ok"></div><div><div class="rep-list-name">${escHtml(v.nombre)} — ${escHtml(e.subSku)}</div><div class="rep-list-meta">${e.cantidad} ${escHtml(e.unidad)} · ${escHtml(e.bodegaNombre)}</div></div></div>`).join('')
        : `<div class="rep-list-row"><div class="rep-list-dot no"></div><div><div class="rep-list-name">${escHtml(v.nombre)}</div><div class="rep-list-meta">No hay existencias en Almacén</div></div></div>`
    ).join('') + '</div>';
  }

  document.getElementById('rep-contenido').innerHTML = `
    ${stats}
    <div class="rep-section-title">Ítems vencidos y por vencer — agrupados por ubicación / depósito</div>
    ${gruposHtml}
    <div class="rep-section-title">Existencias en ALMACÉN para reemplazo de vencidos</div>
    ${almacenHtml}`;
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
    } else if(tipo === 'seguridad'){
      _repExportSeguridadExcel(document.getElementById('rep-deposito').value);
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