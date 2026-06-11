function renderDash(){
  const subs = S.subSkus;
  const totalSKUs = S.skusGlobales.length;
  const totalUnits = subs.reduce((a,s)=>a+getTotalStock(s),0);
  const warns = subs.filter(s=>['A','R'].includes(getSem(s.caducidad))&&!s.agotado);
  const exps = subs.filter(s=>getSem(s.caducidad)==='N'&&!s.agotado);

  document.getElementById('dash-stats').innerHTML=`
    <div class="stat-card"><div class="stat-card-accent blue"></div><div class="stat-icon blue"><i class="ti ti-tag"></i></div><div class="stat-label">SKUs Globales</div><div class="stat-val blue">${totalSKUs}</div><div class="stat-sub">medicamentos registrados</div></div>
    <div class="stat-card"><div class="stat-card-accent green"></div><div class="stat-icon green"><i class="ti ti-package"></i></div><div class="stat-label">Unidades totales</div><div class="stat-val">${totalUnits.toLocaleString('es-CO')}</div><div class="stat-sub">todas las ubicaciones</div></div>
    <div class="stat-card"><div class="stat-card-accent amber"></div><div class="stat-icon amber"><i class="ti ti-alert-triangle"></i></div><div class="stat-label">Por vencer</div><div class="stat-val amber">${warns.length}</div><div class="stat-sub">próximos 180 días</div></div>
    <div class="stat-card"><div class="stat-card-accent red"></div><div class="stat-icon red"><i class="ti ti-alert-circle"></i></div><div class="stat-label">Vencidos</div><div class="stat-val red">${exps.length}</div><div class="stat-sub">requieren baja</div></div>
  `;

  const alertItems = [
    ...exps.map(s=>({s,t:'R'})),
    ...warns.filter(s=>getSem(s.caducidad)==='R').map(s=>({s,t:'R'})),
    ...warns.filter(s=>getSem(s.caducidad)==='A').map(s=>({s,t:'A'}))
  ].slice(0,5);

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
          <div class="alert-meta">${skuG?.codigo||''} · ${s.subSku} · ${getTotalStock(s)} ${s.unidad}</div>
        </div>
        <div class="alert-days">${diff!==null?(diff<0?'Vencido':diff+'d'):''}</div>
      </div>`;
    }).join('');
  }

  const mb = document.getElementById('dash-movimientos');
  if(!S.movimientos.length){
    mb.innerHTML='<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px">Sin movimientos</td></tr>';
    return;
  }
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