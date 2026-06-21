// ── ESTADO DRILL-DOWN ──
let _dashValorUbicacion  = null;
let _dashConsumoUbicacion = null;
let _dashModoValor = 'dona'; // 'dona' | 'barra'
let _dashFiltroConsumo = 'todas';
let _chartValor  = null;
let _chartConsumo = null;

// Paleta Nova Bridge — debe coincidir con css/styles.css
const NB = {
  blue:   '#2196D3',
  green:  '#1A6B3C',
  amber:  '#B7680A',
  ink:    '#1A2B45',
  orange: '#C2660B',
  gray:   '#888780',
  blueBg: '#E3F4FC',
  gridLine: 'rgba(10,22,40,.05)',
  white:  '#FFFFFF',
};

// Colores por sede — orden estable para que dona y barra sean consistentes
const SEDE_COLS = [NB.blue, NB.green, NB.amber, NB.ink, NB.orange, NB.gray];

// ══════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════
function renderDash(){
  _renderStatCards();
  _renderAlertas();
  renderValorInventario();
  renderConsumoMensual();
}

// ══════════════════════════════════════════
// STAT CARDS
// ══════════════════════════════════════════
function _renderStatCards(){
  const subs      = S.subSkus;
  const totalSKUs = S.skusGlobales.length;
  const totalUnits = subs.reduce((a,s)=>a+getTotalStock(s), 0);
  const exps      = subs.filter(s=>getSem(s.caducidad)==='N' && !s.agotado);
  const warns     = subs.filter(s=>['P','R','A'].includes(getSem(s.caducidad)) && !s.agotado);

  // Delta unidades vs cálculo anterior guardado en sessionStorage
  const prevUnits = parseInt(sessionStorage.getItem('nb_prev_units')||'0');
  const delta = totalUnits - prevUnits;
  sessionStorage.setItem('nb_prev_units', totalUnits);
  const deltaHtml = prevUnits && delta !== 0
    ? `<div class="stat-delta ${delta>0?'green':'red'}">
         <i class="ti ${delta>0?'ti-trending-up':'ti-trending-down'}"></i>
         ${delta>0?'+':''}${delta.toLocaleString('es-CO')} vs carga anterior
       </div>`
    : '';

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-accent blue"></div>
      <div class="stat-icon blue"><i class="ti ti-tag"></i></div>
      <div class="stat-label">SKUs Globales</div>
      <div class="stat-val blue">${totalSKUs}</div>
      <div class="stat-sub">medicamentos registrados</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-accent green"></div>
      <div class="stat-icon green"><i class="ti ti-package"></i></div>
      <div class="stat-label">Unidades totales</div>
      <div class="stat-val">${totalUnits.toLocaleString('es-CO')}</div>
      <div class="stat-sub">todas las ubicaciones</div>
      ${deltaHtml}
    </div>
    <div class="stat-card">
      <div class="stat-card-accent amber"></div>
      <div class="stat-icon amber"><i class="ti ti-alert-triangle"></i></div>
      <div class="stat-label">Alertas</div>
      <div class="stat-val amber">${warns.length}</div>
      <div class="stat-sub">próximos 180 días</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-accent red"></div>
      <div class="stat-icon red"><i class="ti ti-alert-circle"></i></div>
      <div class="stat-label">Vencidos</div>
      <div class="stat-val red">${exps.length}</div>
      <div class="stat-sub">requieren baja inmediata</div>
      ${exps.length>0?`<div class="stat-delta red" style="cursor:pointer" onclick="goTo('inventario')">
        <i class="ti ti-arrow-right"></i> Ver en inventario
      </div>`:''}
    </div>
  `;
}

// ══════════════════════════════════════════
// ALERTAS DE VENCIMIENTO
// ══════════════════════════════════════════
function _renderAlertas(){
  const subs = S.subSkus;
  const alertItems = [
    ...subs.filter(s=>getSem(s.caducidad)==='N'&&!s.agotado).map(s=>({s,t:'N'})),
    ...subs.filter(s=>getSem(s.caducidad)==='P'&&!s.agotado).map(s=>({s,t:'P'})),
    ...subs.filter(s=>getSem(s.caducidad)==='R'&&!s.agotado).map(s=>({s,t:'R'})),
    ...subs.filter(s=>getSem(s.caducidad)==='A'&&!s.agotado).map(s=>({s,t:'A'})),
  ].slice(0,5);

  const al = document.getElementById('dash-alerts');
  if(!alertItems.length){
    al.innerHTML='<div class="alert-strip ok"><i class="ti ti-circle-check"></i><div class="alert-text"><div class="alert-name">Sin alertas activas</div><div class="alert-meta">Todos los medicamentos están vigentes</div></div></div>';
    return;
  }

  al.innerHTML = alertItems.map(({s,t})=>{
    const diff  = s.caducidad ? Math.round((new Date(s.caducidad.split('T')[0]+'T00:00:00') - new Date(fechaColombia()+'T00:00:00')) / 864e5) : null;
    const skuG  = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const cls   = (t==='N'||t==='P') ? 'R' : 'A';
    const badge = t==='N'
      ? `<span class="sem N" style="margin-left:auto">Vencido</span>`
      : `<div class="alert-days">${diff!==null?diff+'d':''}</div>`;
    return `<div class="alert-strip ${cls}">
      <i class="ti ti-alert-triangle"></i>
      <div class="alert-text">
        <div class="alert-name">${escHtml(s.nombre)}</div>
        <div class="alert-meta">${escHtml(skuG?.codigo||'')} · ${escHtml(s.subSku)} · ${getTotalStock(s)} ${escHtml(s.unidad)} · ${semLabel(getSem(s.caducidad))}</div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
// VALOR TOTAL DEL INVENTARIO — Chart.js
// ══════════════════════════════════════════
function _calcValor(){
  const porUbicacion = {};
  let total = 0;
  (S.subSkus||[]).forEach(s=>{
    const precio = Number(s.precio)||0;
    if(!precio) return;
    Object.entries(s.stock||{}).forEach(([bodegaNombre, cantidad])=>{
      if(!cantidad) return;
      const valor = precio * cantidad;
      total += valor;
      const bodega   = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
      const ubId     = bodega?.ubicacion_id ?? 'sin_ub';
      const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
      if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, valor:0, depositos:{} };
      porUbicacion[ubId].valor += valor;
      porUbicacion[ubId].depositos[bodegaNombre] = (porUbicacion[ubId].depositos[bodegaNombre]||0) + valor;
    });
  });
  return { total, porUbicacion };
}

function renderValorInventario(){
  const { total, porUbicacion } = _calcValor();

  // Actualizar total
  document.getElementById('dash-valor-total').textContent = fmtCOP(total);

  const entries = Object.entries(porUbicacion).sort((a,b)=>b[1].valor-a[1].valor);
  if(!entries.length){
    _destroyChart('_chartValor');
    document.getElementById('dash-valor-body').innerHTML =
      `<div class="empty-state" style="padding:24px 0"><i class="ti ti-coin"></i><p>Sin inventario valorado todavía</p></div>`;
    return;
  }

  const labels = entries.map(([,u])=>u.nombre);
  const data   = entries.map(([,u])=>u.valor);
  const colors = entries.map((_,i)=>SEDE_COLS[i % SEDE_COLS.length]);

  // Leyenda HTML
  const totalVal = data.reduce((a,b)=>a+b,0);
  document.getElementById('dash-valor-legend').innerHTML = entries.map(([,u],i)=>`
    <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#666">
      <span style="width:9px;height:9px;border-radius:2px;background:${colors[i]};flex-shrink:0"></span>
      ${escHtml(u.nombre)}: ${fmtCOP(u.valor)} (${Math.round(u.valor/totalVal*100)}%)
    </div>`).join('');

  _destroyChart('_chartValor');
  const ctx = document.getElementById('dash-valor-chart').getContext('2d');

  if(_dashModoValor === 'dona'){
    _chartValor = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:NB.white, hoverOffset:6 }] },
      options: {
        responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label: c=>' '+fmtCOP(c.raw)+' ('+Math.round(c.raw/totalVal*100)+'%)' } }
        }
      }
    });
  } else {
    _chartValor = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels.map(l=>l.length>14?l.slice(0,13)+'…':l), datasets:[{ data, backgroundColor:colors, borderRadius:5, borderSkipped:false }] },
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label: c=>' '+fmtCOP(c.raw) } }
        },
        scales:{
          x:{ ticks:{ callback:v=>_fmtM(v), font:{size:10} }, grid:{ color:NB.gridLine } },
          y:{ ticks:{ font:{size:10} }, grid:{ display:false } }
        }
      }
    });
  }
}

function dashValorToggle(modo){
  _dashModoValor = modo;
  document.querySelectorAll('.dash-valor-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.modo === modo);
  });
  renderValorInventario();
}

// ══════════════════════════════════════════
// CONSUMO MENSUAL — Chart.js
// ══════════════════════════════════════════
function _calcConsumo(mesYYYYMM){
  const porUbicacion = {};
  let totalGeneral = 0;
  (S.movimientos||[]).forEach(m=>{
    if(m.tipo!=='consumo'||!m.created_at) return;
    if(fechaColombia(m.created_at).slice(0,7) !== mesYYYYMM) return;
    const bodegaNombre = m.origen_nombre;
    if(!bodegaNombre) return;
    const bodega   = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
    const ubId     = bodega?.ubicacion_id ?? 'sin_ub';
    const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
    if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, total:0, depositos:{} };
    porUbicacion[ubId].total += m.cantidad;
    porUbicacion[ubId].depositos[bodegaNombre] = (porUbicacion[ubId].depositos[bodegaNombre]||0)+m.cantidad;
    totalGeneral += m.cantidad;
  });
  return { totalGeneral, porUbicacion };
}

function renderConsumoMensual(){
  const mesInput = document.getElementById('dash-consumo-mes');
  if(!mesInput.value) mesInput.value = fechaColombia().slice(0,7);
  const mes = mesInput.value;

  const { totalGeneral, porUbicacion } = _calcConsumo(mes);

  document.getElementById('dash-consumo-total').textContent = totalGeneral.toLocaleString('es-CO');

  const entries = Object.entries(porUbicacion).sort((a,b)=>b[1].total-a[1].total);

  // Chips de filtro
  _buildConsumoChips(entries);

  // Filtrar según selección
  let chartEntries = entries;
  if(_dashFiltroConsumo !== 'todas'){
    chartEntries = entries.filter(([,u])=>u.nombre===_dashFiltroConsumo);
  }

  if(!chartEntries.length){
    _destroyChart('_chartConsumo');
    document.getElementById('dash-consumo-chart-wrap').innerHTML =
      `<div class="empty-state" style="padding:24px 0"><i class="ti ti-chart-bar"></i><p>Sin consumos este mes</p></div>`;
    return;
  }

  // Restaurar canvas si fue reemplazado por empty-state
  const wrap = document.getElementById('dash-consumo-chart-wrap');
  if(!wrap.querySelector('canvas')){
    wrap.innerHTML = `<canvas id="dash-consumo-chart" role="img" aria-label="Consumo mensual por ubicación"></canvas>`;
  }

  const labels = chartEntries.map(([,u])=>u.nombre);
  const data   = chartEntries.map(([,u])=>u.total);
  const colors = chartEntries.map((_,i)=>SEDE_COLS[i % SEDE_COLS.length]);

  _destroyChart('_chartConsumo');
  const ctx = document.getElementById('dash-consumo-chart').getContext('2d');
  _chartConsumo = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderRadius:5, borderSkipped:false }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: c=>' '+c.raw+' unidades' } }
      },
      scales:{
        x:{ ticks:{ font:{size:10}, autoSkip:false }, grid:{ display:false } },
        y:{ ticks:{ font:{size:10}, stepSize: Math.max(1, Math.ceil(Math.max(...data)/5)) }, grid:{ color:NB.gridLine } }
      }
    }
  });
}

function _buildConsumoChips(entries){
  const row = document.getElementById('dash-consumo-chips');
  if(!row) return;
  const nombres = entries.map(([,u])=>u.nombre);
  row.innerHTML = `<span class="dash-chip${_dashFiltroConsumo==='todas'?' active':''}" onclick="dashConsumoFiltrar(this,'todas')">Todas</span>`
    + nombres.map(n=>`<span class="dash-chip${_dashFiltroConsumo===n?' active':''}" onclick="dashConsumoFiltrar(this,'${escHtml(n).replace(/'/g,"\\'")}')">
        ${escHtml(n)}
      </span>`).join('');
}

function dashConsumoFiltrar(el, nombre){
  _dashFiltroConsumo = nombre;
  document.querySelectorAll('.dash-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderConsumoMensual();
}

function dashConsumoMesChange(){
  _dashFiltroConsumo = 'todas';
  renderConsumoMensual();
}

// ══════════════════════════════════════════
// HELPERS INTERNOS
// ══════════════════════════════════════════
function _fmtM(n){
  if(n>=1e9) return '$'+(n/1e9).toFixed(1)+'B';
  if(n>=1e6) return '$'+Math.round(n/1e6)+'M';
  return '$'+Math.round(n).toLocaleString('es-CO');
}

function _destroyChart(name){
  if(window[name]){ window[name].destroy(); window[name]=null; }
}