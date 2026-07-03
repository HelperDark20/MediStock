function buildNav(){
  const niv = NIVELES[currentRole];
  const sb = document.getElementById('sb-nav');
  sb.innerHTML = '';
  let lastSection = '';
  NAV_CONFIG.forEach(n=>{
    if(!niv.nav.includes(n.id)) return;
    if(n.section && n.section !== lastSection){
      lastSection = n.section;
      const sec = document.createElement('div');
      sec.className = 'sb-section';
      sec.textContent = n.section;
      sb.appendChild(sec);
    }
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.innerHTML = `<i class="ti ${n.icon}"></i>${n.label}`;
    if(n.id==='inventario'){
      const alerts = S.subSkus.filter(s=>['N','P','R'].includes(getSem(s.caducidad))&&!s.agotado).length;
      if(alerts>0) btn.innerHTML += `<span class="nav-badge">${alerts}</span>`;
    }
    btn.dataset.navId = n.id;
    btn.onclick = ()=>goTo(n.id);
    sb.appendChild(btn);
  });
}

function populateSelects(){
  const opts = S.bodegas.map(b=>`<option value="${b}">${b}</option>`).join('');
  ['mov-origen','mov-destino','reg-ubicacion'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = opts;
  });
  const skuOpts = S.skusGlobales.map(s=>`<option value="${s.id}">${s.codigo} — ${s.nombre}</option>`).join('');
  ['reg-sku-global'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.innerHTML = '<option value="">Seleccionar…</option>' + skuOpts;
  });
}

// ── Fix #6: helper interno que verifica el nivel REAL antes de renderizar ──
// goTo() ya bloquea la navegación, pero las funciones render* podían ser
// llamadas directamente desde la consola del navegador si alguien manipulaba
// currentRole. Este helper centraliza la verificación.
function _nivelPermite(viewId){
  return NIVELES[currentRole]?.nav.includes(viewId) ?? false;
}

function goTo(viewId){
  if(!_nivelPermite(viewId)){
    toast('Sin permiso','error');
    return;
  }
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+viewId)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.navId===viewId));
  const titles = {
    dashboard:'Dashboard', inventario:'Inventario',
    movimientos:'Movimientos', registro:'Registro de entradas',
    sku:'SKUs Globales', usuarios:'Usuarios',
    bodegas:'Ubicaciones y Bodegas', reportes:'Reportes',
    trazabilidad:'Trazabilidad'
  };
  document.getElementById('page-title').textContent = titles[viewId]||viewId;
  const ta = document.getElementById('topbar-actions');
  ta.innerHTML = '';
  if(viewId==='inventario'&&currentRole>=3){
    ta.innerHTML=`<button class="tb-btn primary" onclick="goTo('registro')"><i class="ti ti-plus"></i>Nueva entrada</button>`;
  }
  if(viewId==='sku'&&currentRole===4){
    ta.innerHTML=`<button class="tb-btn primary" onclick="document.getElementById('sku-nombre').focus()"><i class="ti ti-plus"></i>Crear SKU</button>`;
  }
  const renders = {
    dashboard:renderDash, inventario:renderInv,
    movimientos:renderMovimientos, registro:renderRegistro,
    sku:renderSKUs, usuarios:renderUsuarios,
    bodegas:renderBodegas, reportes:renderReportes
  };
  renders[viewId]?.();
}