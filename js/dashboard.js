// Instancias de Chart.js — se guardan para destruirlas antes de recrear
let _valorChart   = null;
let _consumoChart = null;
let _dashValorModo = 'dona'; // 'dona' | 'barra'

// Paleta de colores para las ubicaciones
const DASH_COLORS = [
  '#2196D3','#1A6B3C','#B7680A','#C0392B','#6B3FA0',
  '#0D7FC2','#1E8048','#E08C1A','#E74C3C','#8B5EC8'
];

// ── RENDER PRINCIPAL ──
function renderDash(){
  const subs      = S.subSkus;
  const totalSKUs = S.skusGlobales.length;
  const totalUnits = subs.reduce((a,s)=>a+getTotalStock(s),0);

  const exps      = subs.filter(s=>getSem(s.caducidad)==='N' && !s.agotado);
  const porVencer = subs.filter(s=>getSem(s.caducidad)==='P' && !s.agotado);
  const warns     = subs.filter(s=>['P','R','A'].includes(getSem(s.caducidad)) && !s.agotado);

  // ── Stat cards ──
  document.getElementById('dash-stats').innerHTML=`
    <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-tag"></i></div><div class="stat-label">SKUs Globales</div><div class="stat-val blue">${totalSKUs}</div><div class="stat-sub">medicamentos registrados</div></div>
    <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-package"></i></div><div class="stat-label">Unidades totales</div><div class="stat-val">${totalUnits.toLocaleString('es-CO')}</div><div class="stat-sub">todas las ubicaciones</div></div>
    <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Alertas</div><div class="stat-val amber">${warns.length}</div><div class="stat-sub">próximos 180 días</div></div>
    <div class="stat-card"><div class="stat-card-accent red"></div><div class="stat-icon red"><i class="ti ti-alert-circle"></i></div><div class="stat-label">Vencidos</div><div class="stat-val red">${exps.length}</div><div class="stat-sub">requieren baja</div></div>
  `;

  // ── Alertas de vencimiento ──
  const seen = new Set();
  const alertItems = [
    ...exps.map(s=>({s,t:'R'})),
    ...porVencer.map(s=>({s,t:'R'})),
    ...subs.filter(s=>getSem(s.caducidad)==='R'&&!s.agotado).map(s=>({s,t:'A'})),
    ...subs.filter(s=>getSem(s.caducidad)==='A'&&!s.agotado).map(s=>({s,t:'A'})),
  ].filter(x=>!seen.has(x.s.id)&&seen.add(x.s.id)).slice(0,5);

  const al = document.getElementById('dash-alerts');
  if(!alertItems.length){
    al.innerHTML='<div class="alert-strip ok"><i class="ti ti-circle-check"></i><div class="alert-text"><div class="alert-name">Sin alertas activas</div><div class="alert-meta">Todos los medicamentos están vigentes</div></div></div>';
  } else {
    al.innerHTML = alertItems.map(({s,t})=>{
      const diff = s.caducidad ? Math.round((new Date(s.caducidad+' 00:00:00')-new Date())/864e5) : null;
      const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
      return `<div class="alert-strip ${t}">
        <i class="ti ti-alert-triangle"></i>
        <div class="alert-text">
          <div class="alert-name">${escHtml(s.nombre)}</div>
          <div class="alert-meta">${skuG?.codigo||''} · ${s.subSku} · ${getTotalStock(s)} ${s.unidad} · ${semLabel(getSem(s.caducidad))}</div>
        </div>
        <div class="alert-days">${diff!==null?(diff<0?'Vencido':diff+'d'):''}</div>
      </div>`;
    }).join('');
  }

  // ── Gráficos ──
  renderValorChart();
  renderConsumoChart();
}

// ══════════════════════════════════════════
// VALOR DEL INVENTARIO — Chart.js
// ══════════════════════════════════════════
function calcValorInventario(){
  const porUbicacion = {};
  let total = 0;
  (S.subSkus||[]).forEach(s=>{
    const precio = Number(s.precio)||0;
    if(!precio) return;
    Object.entries(s.stock||{}).forEach(([bodegaNombre, cantidad])=>{
      if(!cantidad) return;
      const valor = precio * cantidad;
      total += valor;
      const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
      const ubId     = bodega?.ubicacion_id ?? 'sin_ub';
      const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
      if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, valor:0 };
      porUbicacion[ubId].valor += valor;
    });
  });
  return { total, porUbicacion };
}

function renderValorChart(){
  const { total, porUbicacion } = calcValorInventario();
  document.getElementById('dash-valor-total').textContent = fmtCOP(total);

  const canvas = document.getElementById('dash-valor-chart');
  if(!canvas) return;

  const entries  = Object.entries(porUbicacion).sort((a,b)=>b[1].valor-a[1].valor);
  const labels   = entries.map(([,u])=>u.nombre);
  const valores  = entries.map(([,u])=>u.valor);
  const colores  = labels.map((_,i)=>DASH_COLORS[i % DASH_COLORS.length]);

  // Leyenda
  const legend = document.getElementById('dash-valor-legend');
  if(legend){
    legend.innerHTML = labels.length
      ? labels.map((l,i)=>`
          <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--ink)">
            <span style="width:10px;height:10px;border-radius:50%;background:${colores[i]};flex-shrink:0"></span>
            ${escHtml(l)}
          </div>`).join('')
      : '';
  }

  if(!labels.length){
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';

  // Destruir instancia previa para evitar conflictos
  if(_valorChart){ _valorChart.destroy(); _valorChart = null; }

  const isDona = _dashValorModo === 'dona';

  _valorChart = new Chart(canvas, {
    type: isDona ? 'doughnut' : 'bar',
    data: {
      labels,
      datasets:[{
        data: valores,
        backgroundColor: colores,
        borderWidth: 0,
        borderRadius: isDona ? 0 : 6,
      }]
    },
    options:{
      responsive: true,
      maintainAspectRatio: false,
      plugins:{
        legend:{ display: false },
        tooltip:{
          callbacks:{
            label: ctx => ` ${fmtCOP(ctx.raw)}`
          }
        }
      },
      ...(isDona ? {} : {
        scales:{
          x:{ grid:{ display:false }, ticks:{ font:{ size:11 } } },
          y:{ grid:{ color:'#f0ede6' }, ticks:{ callback: v=>fmtCOP(v), font:{ size:10 } } }
        }
      })
    }
  });
}

function dashValorToggle(modo){
  _dashValorModo = modo;
  document.querySelectorAll('.dash-valor-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.modo === modo);
  });
  renderValorChart();
}

// ══════════════════════════════════════════
// CONSUMO MENSUAL — Chart.js
// ══════════════════════════════════════════
function calcConsumoMensual(mesYYYYMM){
  const porUbicacion = {};
  let totalGeneral = 0;
  (S.movimientos||[]).forEach(m=>{
    if(m.tipo!=='consumo'||!m.created_at) return;
    if(fechaColombia(m.created_at).slice(0,7)!==mesYYYYMM) return;
    const bodegaNombre = m.origen_nombre;
    if(!bodegaNombre) return;
    const bodega   = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
    const ubId     = bodega?.ubicacion_id ?? 'sin_ub';
    const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
    if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, total:0 };
    porUbicacion[ubId].total += m.cantidad;
    totalGeneral += m.cantidad;
  });
  return { totalGeneral, porUbicacion };
}

function renderConsumoChart(){
  const mesInput = document.getElementById('dash-consumo-mes');
  if(!mesInput) return;
  if(!mesInput.value) mesInput.value = fechaColombia().slice(0,7);
  const mes = mesInput.value;

  const { totalGeneral, porUbicacion } = calcConsumoMensual(mes);
  const totalEl = document.getElementById('dash-consumo-total');
  if(totalEl) totalEl.textContent = totalGeneral.toLocaleString('es-CO');

  // Chips de ubicación (filtro visual — decorativo por ahora)
  const chips = document.getElementById('dash-consumo-chips');
  if(chips){
    const entries = Object.entries(porUbicacion).sort((a,b)=>b[1].total-a[1].total);
    chips.innerHTML = entries.map(([,u])=>`
      <span class="dash-chip active">${escHtml(u.nombre)}: ${u.total.toLocaleString('es-CO')} u.</span>
    `).join('');
  }

  const canvas = document.getElementById('dash-consumo-chart');
  if(!canvas) return;

  const entries = Object.entries(porUbicacion).sort((a,b)=>b[1].total-a[1].total);
  const labels  = entries.map(([,u])=>u.nombre);
  const valores = entries.map(([,u])=>u.total);
  const colores = labels.map((_,i)=>DASH_COLORS[i % DASH_COLORS.length]);

  if(!labels.length){
    canvas.style.display = 'none';
    // Limpiar chips también
    if(chips) chips.innerHTML = '<span style="font-size:12px;color:#aaa">Sin consumos este mes</span>';
    if(_consumoChart){ _consumoChart.destroy(); _consumoChart = null; }
    return;
  }
  canvas.style.display = '';

  if(_consumoChart){ _consumoChart.destroy(); _consumoChart = null; }

  _consumoChart = new Chart(canvas, {
    type: 'bar',
    data:{
      labels,
      datasets:[{
        data: valores,
        backgroundColor: colores,
        borderWidth: 0,
        borderRadius: 6,
      }]
    },
    options:{
      responsive: true,
      maintainAspectRatio: false,
      plugins:{
        legend:{ display:false },
        tooltip:{
          callbacks:{
            label: ctx => ` ${ctx.raw.toLocaleString('es-CO')} unidades`
          }
        }
      },
      scales:{
        x:{ grid:{ display:false }, ticks:{ font:{ size:11 } } },
        y:{ grid:{ color:'#f0ede6' }, ticks:{ stepSize:1, font:{ size:10 } } }
      }
    }
  });
}

function dashConsumoMesChange(){
  renderConsumoChart();
}