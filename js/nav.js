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
    // FIX: se quitó el badge de "Inventario" (contaba alertas con un criterio
    // distinto al del dashboard — resultaba visualmente inconsistente, ej.
    // dashboard mostraba 48 alertas y el nav mostraba 39). El dashboard ya
    // es la única fuente de verdad para ese conteo.
    if(n.id==='eventos'){
      const enCurso = (S.eventos||[]).filter(e=>e.estado==='en_curso').length;
      if(enCurso>0) btn.innerHTML += `<span class="nav-badge">${enCurso}</span>`;
    }
    btn.dataset.navId = n.id;
    btn.onclick = ()=>goTo(n.id);
    sb.appendChild(btn);
  });
  buildMobileNav();
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
    bodegas:'Ubicaciones y Bodegas', eventos:'Eventos', reportes:'Reportes',
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
  if(viewId==='eventos'&&currentRole===4){
    ta.innerHTML=`<button class="tb-btn primary" onclick="abrirCrearEvento()"><i class="ti ti-plus"></i>Crear evento</button>`;
  }
  const renders = {
    dashboard:renderDash, inventario:renderInv,
    movimientos:renderMovimientos, registro:renderRegistro,
    sku:renderSKUs, usuarios:renderUsuarios,
    bodegas:renderBodegas, eventos:renderEventos, reportes:renderReportes
  };
  renders[viewId]?.();
  syncMobileNavActive();
}