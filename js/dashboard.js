// Instancias de Chart.js — se guardan para destruirlas antes de recrear
let _valorChart   = null;
let _consumoChart = null;
let _dashValorModo = 'dona'; // 'dona' | 'barra'
// El valor del inventario se muestra oculto (*****) hasta pulsar el ojo; al
// recargar la página vuelve a quedar oculto
let _dashValorVisible = false;

// Paleta de colores para las ubicaciones
// Paleta navy de los íconos (de oscuro a claro). El rojo y el ámbar quedan
// solo para alertas.
const DASH_COLORS = [
  '#3E557C','#5A76A6','#7F9BCB','#B3C6E6','#2C3E5E',
  '#6F8FC4','#98B0DA','#4B6A9E','#D3DFF2','#2196D3'
];
// Recuadro al pasar el mouse: navy con texto blanco
const DASH_TOOLTIP = {
  backgroundColor:'#0A1628', titleColor:'#fff', bodyColor:'#DCE6F5', padding:10, cornerRadius:8,
  displayColors:false, titleFont:{ weight:'700' }
};
// Degradado navy vertical para las barras
function _dashGradiente(c){
  const a = c.chart.chartArea;
  if(!a) return '#5A76A6';
  const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, '#7F9BCB'); g.addColorStop(1, '#3E557C');
  return g;
}
// Valor encima de cada barra (formato: options.plugins.valoresEncima.formato)
const _dashValoresEncima = {
  id:'valoresEncima',
  afterDatasetsDraw(chart, args, opts){
    if(!opts || !opts.formato) return;
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = '#3E557C';
    ctx.font = '700 11px ' + (getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace');
    ctx.textAlign = 'center';
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      ctx.fillText(opts.formato(chart.data.datasets[0].data[i]), bar.x, bar.y - 7);
    });
    ctx.restore();
  }
};
// $26.800.000 → "$26,8 M"
function _dashCOPCorto(n){
  if(n >= 1e6) return '$' + (n / 1e6).toLocaleString('es-CO', { maximumFractionDigits:1 }) + ' M';
  if(n >= 1e3) return '$' + (n / 1e3).toLocaleString('es-CO', { maximumFractionDigits:1 }) + ' mil';
  return fmtCOP(n);
}

// Lista de vencidos: desvanecidos arriba/abajo y "Viendo X de N" según el
// desplazamiento
function _dashAlertasScroll(){
  const lista = document.getElementById('dash-alerts-lista');
  if(!lista) return;
  const desborda = lista.scrollHeight > lista.clientHeight + 2;
  const wrap = lista.parentNode;
  wrap.classList.toggle('con-arriba', desborda && lista.scrollTop > 4);
  wrap.classList.toggle('con-abajo', desborda && lista.scrollTop + lista.clientHeight < lista.scrollHeight - 4);
  const pos = document.getElementById('dash-alerts-pos');
  if(!pos) return;
  if(!desborda){ pos.textContent = ''; return; }
  const limite = lista.scrollTop + lista.clientHeight + 2;
  let vistos = 0;
  for(const it of lista.children){ if(it.offsetTop - lista.offsetTop + it.offsetHeight <= limite) vistos++; }
  pos.textContent = `Viendo ${Math.max(1, vistos)} de ${lista.children.length}`;
}

// ── RENDER PRINCIPAL ──
function renderDash(){
  // Guard: si el elemento no existe la vista no está activa, salir sin error
  const statsEl = document.getElementById('dash-stats');
  if(!statsEl) return;

  const subs      = S.subSkus;
  const totalSKUs = S.skusGlobales.length;
  const totalUnits = subs.reduce((a,s)=>a+getTotalStock(s),0);

  const exps      = subs.filter(s=>getSem(s.caducidad)==='N' && !s.agotado);
  const porVencer = subs.filter(s=>getSem(s.caducidad)==='P' && !s.agotado);
  const warns     = subs.filter(s=>['P','R','A'].includes(getSem(s.caducidad)) && !s.agotado);

  // ── Stat cards ──
  // Alertas y Vencidos son clickeables: llevan al inventario ya filtrado.
  statsEl.innerHTML=`
    <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon ilustrado"><img src="img/iconos/skus.svg" alt=""></div><div class="stat-label">SKUs Globales</div><div class="stat-val blue">${totalSKUs}</div><div class="stat-sub">items registrados</div></div>
    <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon ilustrado"><img src="img/iconos/unidades.svg" alt=""></div><div class="stat-label">Unidades totales</div><div class="stat-val">${totalUnits.toLocaleString('es-CO')}</div><div class="stat-sub">todas las ubicaciones</div></div>
    <div class="stat-card stat-card-clickable" onclick="dashGoInventarioFiltro('alertas')" title="Ver en inventario"><div class="stat-card-accent amber"></div><div class="stat-icon ilustrado"><img src="img/iconos/alertas.svg" alt=""></div><div class="stat-label">Alertas</div><div class="stat-val amber">${warns.length}</div><div class="stat-sub">próximos 180 días <i class="ti ti-arrow-right" style="font-size:11px;margin-left:2px;vertical-align:middle"></i></div></div>
    <div class="stat-card stat-card-clickable" onclick="dashGoInventarioFiltro('vencidos')" title="Ver en inventario"><div class="stat-card-accent red"></div><div class="stat-icon ilustrado"><img src="img/iconos/vencidos.svg" alt=""></div><div class="stat-label">Vencidos</div><div class="stat-val red">${exps.length}</div><div class="stat-sub">requieren baja <i class="ti ti-arrow-right" style="font-size:11px;margin-left:2px;vertical-align:middle"></i></div></div>
  `;

  // ── Alertas de vencimiento — TODOS los vencidos, desglosados por
  // ubicación y depósito para facilitar su localización y destrucción ──
  const al = document.getElementById('dash-alerts');
  if(al){
    const filasVencidas = [];
    exps.forEach(s=>{
      Object.entries(s.stock||{}).forEach(([bodegaNombre, cantidad])=>{
        if(!cantidad) return;
        const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
        filasVencidas.push({
          s, bodegaNombre, cantidad,
          ubicacionNombre: bodega?.ubicacion_nombre || 'Sin ubicación'
        });
      });
    });

    filasVencidas.sort((a,b)=>
      a.ubicacionNombre.localeCompare(b.ubicacionNombre) ||
      a.bodegaNombre.localeCompare(b.bodegaNombre) ||
      a.s.nombre.localeCompare(b.s.nombre)
    );

    const cont = document.getElementById('dash-alerts-cont');
    if(cont){
      cont.textContent = filasVencidas.length + (filasVencidas.length === 1 ? ' vencido' : ' vencidos');
      cont.style.display = filasVencidas.length ? '' : 'none';
    }
    if(!filasVencidas.length){
      al.innerHTML='<div class="alert-strip ok"><i class="ti ti-circle-check"></i><div class="alert-text"><div class="alert-name">Sin ítems vencidos</div><div class="alert-meta">No hay medicamentos vencidos pendientes de destrucción</div></div></div>';
    } else {
      al.innerHTML = `<div class="scroll-wrap"><div class="dash-alerts-scroll scroll-fino" id="dash-alerts-lista">` +
        filasVencidas.map(({s,bodegaNombre,ubicacionNombre,cantidad})=>{
          const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
          const diff = s.caducidad ? Math.round((new Date(s.caducidad.split('T')[0]+'T00:00:00') - new Date(fechaColombia()+'T00:00:00')) / 864e5) : null;
          return `<div class="alert-strip R">
            <i class="ti ti-alert-triangle"></i>
            <div class="alert-text">
              <div class="alert-name">${escHtml(s.nombre)}</div>
              <div class="alert-meta">${escHtml(skuG?.codigo||'')} · ${escHtml(s.subSku)} · ${cantidad} ${escHtml(s.unidad)} · <strong>${escHtml(ubicacionNombre)} — ${escHtml(bodegaNombre)}</strong></div>
            </div>
            <div class="alert-days">${diff!==null?'Vencido hace '+Math.abs(diff)+'d':''}</div>
          </div>`;
        }).join('') + `</div><div class="scroll-fade arriba"></div><div class="scroll-fade abajo"></div></div>
        <div class="dash-alerts-pie"><span id="dash-alerts-pos"></span>
          <span class="sec-link" onclick="dashGoInventarioFiltro('vencidos')">Ver todos en inventario →</span></div>`;
      document.getElementById('dash-alerts-lista').addEventListener('scroll', _dashAlertasScroll);
      requestAnimationFrame(_dashAlertasScroll);
    }
  }

  // ── Gráficos ──
  renderValorChart();
  renderConsumoChart();

  // ── Eventos en curso ──
  renderDashEventos();
}

// ══════════════════════════════════════════
// EVENTOS EN CURSO — panel junto a Alertas
// ══════════════════════════════════════════
function renderDashEventos(){
  const el = document.getElementById('dash-eventos');
  if(!el) return;

  const enCurso = (S.eventos||[]).filter(e=>e.estado==='en_curso');

  if(!enCurso.length){
    el.innerHTML = '<div class="alert-strip ok"><i class="ti ti-calendar-off"></i><div class="alert-text"><div class="alert-name">Sin eventos en curso</div><div class="alert-meta">No hay eventos activos en este momento</div></div></div>';
    return;
  }

  el.innerHTML = enCurso.map(e=>{
    const personal = (e.personal||[]).map(p=>escHtml(p.nombre)).join(', ') || 'Sin personal asignado';
    return `<div class="alert-strip A">
      <i class="ti ti-calendar-event"></i>
      <div class="alert-text">
        <div class="alert-name">${escHtml(e.nombre)}</div>
        <div class="alert-meta">${escHtml(e.ubicacion_nombre||'—')} · ${personal}</div>
      </div>
    </div>`;
  }).join('');
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

function dashValorVer(){
  _dashValorVisible = !_dashValorVisible;
  renderValorChart();
}

function renderValorChart(){
  const totalEl = document.getElementById('dash-valor-total');
  const canvas  = document.getElementById('dash-valor-chart');
  if(!totalEl || !canvas) return;

  const { total, porUbicacion } = calcValorInventario();
  totalEl.textContent = _dashValorVisible ? fmtCOP(total) : '*****';
  const ojo = document.getElementById('dash-valor-ojo');
  if(ojo){
    const txt = _dashValorVisible ? 'Ocultar valor' : 'Mostrar valor';
    ojo.title = txt;
    ojo.setAttribute('aria-label', txt);
    ojo.setAttribute('aria-pressed', _dashValorVisible ? 'true' : 'false');
    ojo.innerHTML = `<i class="ti ${_dashValorVisible ? 'ti-eye-off' : 'ti-eye'}"></i>`;
  }

  const entries  = Object.entries(porUbicacion).sort((a,b)=>b[1].valor-a[1].valor);
  const labels   = entries.map(([,u])=>u.nombre);
  const valores  = entries.map(([,u])=>u.valor);
  const colores  = labels.map((_,i)=>DASH_COLORS[i % DASH_COLORS.length]);
  const isDona   = _dashValorModo === 'dona';

  // Dona: total en el centro (respeta el valor oculto) y leyenda como ranking
  // con el porcentaje de cada sede
  const graf = document.getElementById('dash-valor-graf');
  if(graf) graf.classList.toggle('barra', !isDona);
  const centro = document.getElementById('dash-valor-centro');
  if(centro){
    centro.querySelector('b').textContent = _dashValorVisible ? _dashCOPCorto(total) : '*****';
    centro.querySelector('small').textContent = labels.length + (labels.length === 1 ? ' sede' : ' sedes');
    centro.style.display = labels.length ? '' : 'none';
  }
  const legend = document.getElementById('dash-valor-legend');
  if(legend){
    legend.innerHTML = labels.length
      ? labels.map((l,i)=>{
          const pct = total ? Math.round(valores[i] / total * 100) : 0;
          return `<div class="dash-ley-f">
            <div class="dash-ley-top"><span><i style="background:${colores[i]}"></i>${escHtml(l)}</span><b>${pct}%</b></div>
            <div class="dash-ley-barra"><div style="width:${pct}%;background:${colores[i]}"></div></div>
          </div>`;
        }).join('')
      : '<span style="font-size:12px;color:#aaa">Sin inventario valorado</span>';
  }

  if(!labels.length){
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';

  // Destruir instancia previa para evitar conflictos
  if(_valorChart){ _valorChart.destroy(); _valorChart = null; }

  _valorChart = new Chart(canvas, {
    type: isDona ? 'doughnut' : 'bar',
    data: {
      labels,
      datasets:[ isDona
        ? { data: valores, backgroundColor: colores, borderWidth: labels.length > 1 ? 3 : 1, borderColor: labels.length > 1 ? '#fff' : colores[0],
            borderRadius: labels.length > 1 ? 6 : 0, spacing: labels.length > 1 ? 2 : 0, hoverOffset: 6 }
        : { data: valores, backgroundColor: _dashGradiente, hoverBackgroundColor: '#2196D3', borderWidth: 0, borderRadius: 10, borderSkipped: false, maxBarThickness: 46 }
      ]
    },
    options:{
      responsive: true,
      maintainAspectRatio: false,
      ...(isDona ? { cutout: '68%' } : { layout:{ padding:{ top:18 } } }),
      plugins:{
        legend:{ display: false },
        tooltip:{
          ...DASH_TOOLTIP,
          callbacks:{
            label: ctx => _dashValorVisible ? fmtCOP(ctx.raw) : '*****'
          }
        },
        valoresEncima: !isDona && _dashValorVisible ? { formato: _dashCOPCorto } : false
      },
      ...(isDona ? {} : {
        scales:{
          x:{ grid:{ display:false }, border:{ display:false }, ticks:{ color:'#5A76A6', font:{ size:11, weight:'600' } } },
          y:{ beginAtZero:true, grace:'8%', grid:{ color:'rgba(62,85,124,.07)' }, border:{ display:false }, ticks:{ maxTicksLimit:6, color:'#9DB3DA', callback: v=>_dashValorVisible ? _dashCOPCorto(v) : '', font:{ size:10 } } }
        }
      })
    },
    plugins: [_dashValoresEncima]
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
    const fecha = m.fecha_real || m.created_at;   // hora real de atención (offline/contingencia)
    if(m.tipo!=='consumo'||!fecha) return;
    if(fechaColombia(fecha).slice(0,7)!==mesYYYYMM) return;
    if(!m.origen_nombre) return;
    // Ubicación donde estaba el depósito al consumir (un depósito prestado a
    // una ubicación temporal cuenta para la temporal, aunque ya haya vuelto)
    const ubNombre = m.origen_ubicacion_nombre || 'Sin ubicación';
    const ubId     = ubNombre;
    if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre:ubNombre, total:0 };
    porUbicacion[ubId].total += m.cantidad;
    totalGeneral += m.cantidad;
  });
  return { totalGeneral, porUbicacion };
}

function renderConsumoChart(){
  const mesInput = document.getElementById('dash-consumo-mes');
  const canvas   = document.getElementById('dash-consumo-chart');
  if(!mesInput || !canvas) return;

  if(!mesInput.value) mesInput.value = fechaColombia().slice(0,7);
  const mes = mesInput.value;
  if(document.getElementById('dash-mes-txt')) _dashMesPintar();

  const { totalGeneral, porUbicacion } = calcConsumoMensual(mes);
  const totalEl = document.getElementById('dash-consumo-total');
  if(totalEl) totalEl.textContent = totalGeneral.toLocaleString('es-CO');

  // Chips de ubicación
  const chips = document.getElementById('dash-consumo-chips');

  const entries = Object.entries(porUbicacion).sort((a,b)=>b[1].total-a[1].total);
  const labels  = entries.map(([,u])=>u.nombre);
  const valores = entries.map(([,u])=>u.total);
  const colores = labels.map((_,i)=>DASH_COLORS[i % DASH_COLORS.length]);

  if(chips){
    chips.innerHTML = labels.length
      ? entries.map(([,u])=>`
          <span class="dash-chip active" style="cursor:pointer" title="Ver historial de consumos"
            onclick="dashGoConsumoHistorial(${jsArg(u.nombre)})">
            ${escHtml(u.nombre)}: ${u.total.toLocaleString('es-CO')} u.
          </span>
        `).join('')
      : '<span style="font-size:12px;color:#aaa">Sin consumos este mes</span>';
  }

  if(!labels.length){
    canvas.style.display = 'none';
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
        backgroundColor: _dashGradiente,
        hoverBackgroundColor: '#2196D3',
        borderWidth: 0,
        borderRadius: 10,
        borderSkipped: false,
        maxBarThickness: 46
      }]
    },
    plugins: [_dashValoresEncima],
    options:{
      responsive: true,
      maintainAspectRatio: false,
      layout:{ padding:{ top:18 } },
      onClick: (evt, elements) => {
        if(!elements.length) return;
        dashGoConsumoHistorial(labels[elements[0].index]);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins:{
        legend:{ display:false },
        tooltip:{
          ...DASH_TOOLTIP,
          callbacks:{
            label: ctx => `${ctx.raw.toLocaleString('es-CO')} unidades — clic para ver historial`
          }
        },
        valoresEncima:{ formato: v => v.toLocaleString('es-CO') }
      },
      scales:{
        x:{ grid:{ display:false }, border:{ display:false }, ticks:{ color:'#5A76A6', font:{ size:11, weight:'600' } } },
        y:{ beginAtZero:true, grace:'8%', grid:{ color:'rgba(62,85,124,.07)' }, border:{ display:false }, ticks:{ precision:0, maxTicksLimit:6, color:'#9DB3DA', font:{ size:10 } } }
      }
    }
  });
}

function dashConsumoMesChange(){
  renderConsumoChart();
}

// ── Selector de mes de "Consumo mensual" ──
// El valor sigue en el input oculto #dash-consumo-mes (AAAA-MM). No se puede
// pasar del mes actual: los meses futuros no tienen consumos.
const _MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let _dashMesAnioVista = null;
function _dashMesActual(){
  const el = document.getElementById('dash-consumo-mes');
  if(!el.value) el.value = fechaColombia().slice(0,7);
  return el.value;
}
function _dashMesFijar(valor){
  document.getElementById('dash-consumo-mes').value = valor;
  _dashMesPintar();
  dashConsumoMesChange();
}
function _dashMesPintar(){
  const [y, m] = _dashMesActual().split('-').map(Number);
  const hoy = fechaColombia().slice(0,7);
  document.getElementById('dash-mes-txt').textContent = `${_MESES[m-1]} ${y}`;
  document.getElementById('dash-mes-sig').disabled = _dashMesActual() >= hoy;
}
function dashMesMover(delta){
  const [y, m] = _dashMesActual().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const valor = d.toISOString().slice(0,7);
  if(valor > fechaColombia().slice(0,7)) return;
  _dashMesFijar(valor);
}
function _dashMesGrid(){
  const hoy = fechaColombia().slice(0,7);
  const actual = _dashMesActual();
  const y = _dashMesAnioVista;
  document.getElementById('dash-mes-anio').textContent = y;
  document.getElementById('dash-mes-anio-sig').disabled = y >= Number(hoy.slice(0,4));
  document.getElementById('dash-mes-grid').innerHTML = _MESES.map((nombre, i) => {
    const valor = `${y}-${String(i+1).padStart(2,'0')}`;
    const futuro = valor > hoy;
    return `<button type="button" class="mes-op${valor === actual ? ' sel' : ''}${valor === hoy ? ' hoy' : ''}"${futuro ? ' disabled' : ''} onclick="dashMesElegir('${valor}')">${nombre.slice(0,3)}</button>`;
  }).join('');
}
function dashMesAbrir(){
  const pop = document.getElementById('dash-mes-pop');
  const abierto = pop.style.display !== 'none';
  if(abierto){ _dashMesCerrar(); return; }
  _dashMesAnioVista = Number(_dashMesActual().slice(0,4));
  _dashMesGrid();
  pop.style.display = '';
  document.getElementById('dash-mes-btn').setAttribute('aria-expanded', 'true');
}
function _dashMesCerrar(){
  const pop = document.getElementById('dash-mes-pop');
  if(!pop) return;
  pop.style.display = 'none';
  document.getElementById('dash-mes-btn').setAttribute('aria-expanded', 'false');
}
function dashMesAnio(delta){
  _dashMesAnioVista += delta;
  _dashMesGrid();
}
function dashMesElegir(valor){
  _dashMesCerrar();
  _dashMesFijar(valor);
}
// Cerrar el panel al hacer clic afuera o con Escape
document.addEventListener('click', e => {
  const sel = document.getElementById('dash-mes-sel');
  if(sel && !sel.contains(e.target)) _dashMesCerrar();
});
document.addEventListener('keydown', e => { if(e.key === 'Escape') _dashMesCerrar(); });
// ── Ir al inventario con el filtro de Alertas/Vencidos ya aplicado ──
function dashGoInventarioFiltro(tipo){
  goTo('inventario');
  invSetAlertFilter(tipo);
}
// ── Ir al historial de movimientos filtrado por consumo del mes/ubicación
// seleccionados en el dashboard. ubicacionNombre=null → todas las ubicaciones ──
function dashGoConsumoHistorial(ubicacionNombre){
  const mesInput = document.getElementById('dash-consumo-mes');
  const mes = mesInput?.value || fechaColombia().slice(0,7);
  const mesLabel = new Date(mes+'-02').toLocaleDateString('es-CO',{month:'long',year:'numeric'});
  _movFiltro = { ubicacionNombre, mes, mesLabel };
  goTo('movimientos');
}