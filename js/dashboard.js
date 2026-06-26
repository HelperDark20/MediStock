function renderDash(){
  const subs = S.subSkus;
  const totalSKUs = S.skusGlobales.length;
  const totalUnits = subs.reduce((a,s)=>a+getTotalStock(s),0);

  const exps     = subs.filter(s=>getSem(s.caducidad)==='N' && !s.agotado);
  const porVencer = subs.filter(s=>getSem(s.caducidad)==='P' && !s.agotado);
  const warns    = subs.filter(s=>['P','R','A'].includes(getSem(s.caducidad)) && !s.agotado);

  document.getElementById('dash-stats').innerHTML=`
    <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-tag"></i></div><div class="stat-label">SKUs Globales</div><div class="stat-val blue">${totalSKUs}</div><div class="stat-sub">medicamentos registrados</div></div>
    <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-package"></i></div><div class="stat-label">Unidades totales</div><div class="stat-val">${totalUnits.toLocaleString('es-CO')}</div><div class="stat-sub">todas las ubicaciones</div></div>
    <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Alertas</div><div class="stat-val amber">${warns.length}</div><div class="stat-sub">próximos 180 días</div></div>
    <div class="stat-card"><div class="stat-card-accent red"></div><div class="stat-icon red"><i class="ti ti-alert-circle"></i></div><div class="stat-label">Vencidos</div><div class="stat-val red">${exps.length}</div><div class="stat-sub">requieren baja</div></div>
  `;

  // FIX: deduplicar por id para evitar que un ítem aparezca dos veces
  // (ej: sem=R aparece en subs.filter(R) y podría repetirse si se cambia la lógica)
  const seen = new Set();
  const alertItems = [
    ...exps.map(s=>({s, t:'R'})),
    ...porVencer.map(s=>({s, t:'R'})),
    ...subs.filter(s=>getSem(s.caducidad)==='R' && !s.agotado).map(s=>({s, t:'A'})),
    ...subs.filter(s=>getSem(s.caducidad)==='A' && !s.agotado).map(s=>({s, t:'A'})),
  ].filter(x => !seen.has(x.s.id) && seen.add(x.s.id)).slice(0,5);

  const al = document.getElementById('dash-alerts');
  if(!alertItems.length){
    al.innerHTML='<div class="alert-strip ok"><i class="ti ti-circle-check"></i><div class="alert-text"><div class="alert-name">Sin alertas activas</div><div class="alert-meta">Todos los medicamentos están vigentes</div></div></div>';
  } else {
    al.innerHTML = alertItems.map(({s,t})=>{
      const diff = s.caducidad ? Math.round((new Date(s.caducidad)-new Date())/864e5) : null;
      const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
      return `<div class="alert-strip ${t}">
        <i class="ti ti-alert-triangle"></i>
        <div class="alert-text">
          <div class="alert-name">${s.nombre}</div>
          <div class="alert-meta">${skuG?.codigo||''} · ${s.subSku} · ${getTotalStock(s)} ${s.unidad} · ${semLabel(getSem(s.caducidad))}</div>
        </div>
        <div class="alert-days">${diff!==null?(diff<0?'Vencido':diff+'d'):''}</div>
      </div>`;
    }).join('');
  }

  const mb = document.getElementById('dash-movimientos');
  if(!S.movimientos.length){
    mb.innerHTML='<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">Sin movimientos</td></tr>';
  } else {
    mb.innerHTML = S.movimientos.slice(0,6).map(m=>`
      <tr>
        <td><span class="sku-code">${m.sku_global_codigo||'—'}</span></td>
        <td><span class="sub-sku" style="font-size:9px">${(m.sub_sku||'').split('-').slice(0,2).join('-')}</span></td>
        <td><span class="mov-tipo ${m.tipo}">${m.tipo}</span></td>
        <td style="font-size:11px">
          <div>${m.usuario_nombre||'—'}</div>
          <span class="nivel-badge n${m.usuario_nivel||0}" style="font-size:9px">${NIVELES[m.usuario_nivel||0]?.label||''}</span>
        </td>
      </tr>`).join('');
  }

  renderValorInventario();
  renderConsumoMensual();
}

// ══════════════════════════════════════════
// VALOR TOTAL DEL INVENTARIO
// ══════════════════════════════════════════
let _dashValorUbicacion = null;

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
      const ubId = bodega?.ubicacion_id ?? 'sin_ub';
      const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
      if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre: ubNombre, valor: 0, depositos: {} };
      porUbicacion[ubId].valor += valor;
      porUbicacion[ubId].depositos[bodegaNombre] = (porUbicacion[ubId].depositos[bodegaNombre]||0) + valor;
    });
  });
  return { total, porUbicacion };
}

function renderValorInventario(){
  const { total, porUbicacion } = calcValorInventario();
  document.getElementById('dash-valor-total').textContent = fmtCOP(total);
  const body = document.getElementById('dash-valor-body');

  if(_dashValorUbicacion !== null){
    const ub = porUbicacion[_dashValorUbicacion];
    if(!ub){
      body.innerHTML = `<div class="valor-back" onclick="dashValorVolver()"><i class="ti ti-arrow-left"></i> Volver a ubicaciones</div><div class="empty-state" style="padding:24px 0"><i class="ti ti-building-warehouse"></i><p>Sin valor registrado en esta ubicación</p></div>`;
      return;
    }
    const depEntries = Object.entries(ub.depositos).sort((a,b)=>b[1]-a[1]);
    body.innerHTML = `
      <div class="valor-back" onclick="dashValorVolver()"><i class="ti ti-arrow-left"></i> Volver a ubicaciones</div>
      <div class="valor-ub-title">${ub.nombre} <span style="font-weight:500;color:#888;font-size:12px">· ${fmtCOP(ub.valor)}</span></div>
      ${depEntries.map(([nombre,valor])=>`
        <div class="valor-row">
          <span><i class="ti ti-building-warehouse" style="font-size:13px;color:var(--blue);margin-right:6px"></i>${nombre}</span>
          <strong>${fmtCOP(valor)}</strong>
        </div>`).join('')}
    `;
    return;
  }

  const ubEntries = Object.entries(porUbicacion).sort((a,b)=>b[1].valor-a[1].valor);
  if(!ubEntries.length){
    body.innerHTML = `<div class="empty-state" style="padding:24px 0"><i class="ti ti-coin"></i><p>Sin inventario valorado todavía</p></div>`;
    return;
  }
  body.innerHTML = ubEntries.map(([id,u])=>`
    <div class="valor-row clickable" onclick="dashValorSeleccionar('${id}')">
      <span><i class="ti ti-map-pin" style="font-size:13px;color:var(--blue);margin-right:6px"></i>${u.nombre}</span>
      <strong>${fmtCOP(u.valor)}</strong>
    </div>`).join('');
}

function dashValorSeleccionar(id){ _dashValorUbicacion = id; renderValorInventario(); }
function dashValorVolver(){ _dashValorUbicacion = null; renderValorInventario(); }

// ══════════════════════════════════════════
// CONSUMO MENSUAL POR UBICACIÓN
// ══════════════════════════════════════════
let _dashConsumoUbicacion = null;

function calcConsumoMensual(mesYYYYMM){
  const porUbicacion = {};
  let totalGeneral = 0;
  (S.movimientos||[]).forEach(m=>{
    if(m.tipo!=='consumo' || !m.created_at) return;
    if(fechaColombia(m.created_at).slice(0,7) !== mesYYYYMM) return;
    const bodegaNombre = m.origen_nombre;
    if(!bodegaNombre) return;
    const bodega = (S.bodegasRaw||[]).find(b=>b.nombre===bodegaNombre);
    const ubId = bodega?.ubicacion_id ?? 'sin_ub';
    const ubNombre = bodega?.ubicacion_nombre || 'Sin ubicación';
    if(!porUbicacion[ubId]) porUbicacion[ubId] = { nombre: ubNombre, total: 0, depositos: {} };
    porUbicacion[ubId].total += m.cantidad;
    porUbicacion[ubId].depositos[bodegaNombre] = (porUbicacion[ubId].depositos[bodegaNombre]||0) + m.cantidad;
    totalGeneral += m.cantidad;
  });
  return { totalGeneral, porUbicacion };
}

function renderConsumoMensual(){
  const mesInput = document.getElementById('dash-consumo-mes');
  if(!mesInput.value) mesInput.value = fechaColombia().slice(0,7);
  const mes = mesInput.value;

  const { totalGeneral, porUbicacion } = calcConsumoMensual(mes);
  document.getElementById('dash-consumo-total').textContent = totalGeneral.toLocaleString('es-CO');
  const body = document.getElementById('dash-consumo-body');

  if(_dashConsumoUbicacion !== null){
    const ub = porUbicacion[_dashConsumoUbicacion];
    if(!ub){
      body.innerHTML = `<div class="valor-back" onclick="dashConsumoVolver()"><i class="ti ti-arrow-left"></i> Volver a ubicaciones</div><div class="empty-state" style="padding:24px 0"><i class="ti ti-building-warehouse"></i><p>Sin consumos este mes en esta ubicación</p></div>`;
      return;
    }
    const depEntries = Object.entries(ub.depositos).sort((a,b)=>b[1]-a[1]);
    body.innerHTML = `
      <div class="valor-back" onclick="dashConsumoVolver()"><i class="ti ti-arrow-left"></i> Volver a ubicaciones</div>
      <div class="valor-ub-title">${ub.nombre} <span style="font-weight:500;color:#888;font-size:12px">· ${ub.total.toLocaleString('es-CO')} u.</span></div>
      ${depEntries.map(([nombre,cant])=>`
        <div class="valor-row">
          <span><i class="ti ti-building-warehouse" style="font-size:13px;color:var(--blue);margin-right:6px"></i>${nombre}</span>
          <strong>${cant.toLocaleString('es-CO')} u.</strong>
        </div>`).join('')}
    `;
    return;
  }

  const ubEntries = Object.entries(porUbicacion).sort((a,b)=>b[1].total-a[1].total);
  if(!ubEntries.length){
    body.innerHTML = `<div class="empty-state" style="padding:24px 0"><i class="ti ti-chart-bar"></i><p>Sin consumos registrados este mes</p></div>`;
    return;
  }
  body.innerHTML = ubEntries.map(([id,u])=>`
    <div class="valor-row clickable" onclick="dashConsumoSeleccionar('${id}')">
      <span><i class="ti ti-map-pin" style="font-size:13px;color:var(--blue);margin-right:6px"></i>${u.nombre}</span>
      <strong>${u.total.toLocaleString('es-CO')} u.</strong>
    </div>`).join('');
}

function dashConsumoSeleccionar(id){ _dashConsumoUbicacion = id; renderConsumoMensual(); }
function dashConsumoVolver(){ _dashConsumoUbicacion = null; renderConsumoMensual(); }
function dashConsumoMesChange(){ _dashConsumoUbicacion = null; renderConsumoMensual(); }