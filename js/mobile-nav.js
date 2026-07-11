// ══════════════════════════════════════════
// NAV MÓVIL — barra inferior de tabs, visible solo <768px.
// Reutiliza NAV_CONFIG / NIVELES de constants.js, no duplica nada.
// Muestra hasta 4 accesos directos por rol + "Más" con el resto.
// ══════════════════════════════════════════

const MOBILE_NAV_PRIMARY = ['dashboard','inventario','movimientos','eventos'];

function buildMobileNav(){
  const wrap = document.getElementById('mobile-bottom-nav');
  if(!wrap) return;
  const niv = NIVELES[currentRole];
  if(!niv){ wrap.innerHTML=''; return; }

  const disponibles = NAV_CONFIG.filter(n => niv.nav.includes(n.id));

  // Prioriza dashboard/inventario/movimientos/eventos si el rol los tiene;
  // si no llega a 4, completa con lo que sigue en NAV_CONFIG.
  let primarios = MOBILE_NAV_PRIMARY
    .map(id => disponibles.find(n => n.id === id))
    .filter(Boolean);
  disponibles.forEach(n => {
    if(primarios.length < 4 && !primarios.includes(n)) primarios.push(n);
  });
  primarios = primarios.slice(0, 4);

  const resto = disponibles.filter(n => !primarios.includes(n));

  wrap.innerHTML = primarios.map(n => `
    <button class="mnav-item" data-nav-id="${n.id}" onclick="goTo('${n.id}')">
      <i class="ti ${n.icon}"></i>
      <span>${n.label}</span>
    </button>`).join('') +
    (resto.length ? `
    <button class="mnav-item" onclick="abrirMasMovil()">
      <i class="ti ti-dots"></i>
      <span>Más</span>
    </button>` : '');

  wrap.dataset.resto = JSON.stringify(resto.map(n=>({id:n.id,icon:n.icon,label:n.label})));
  syncMobileNavActive();
}

function abrirMasMovil(){
  const wrap = document.getElementById('mobile-bottom-nav');
  const resto = JSON.parse(wrap.dataset.resto||'[]');
  document.getElementById('mnav-mas-list').innerHTML = resto.map(n=>`
    <button class="mnav-mas-item" onclick="closeModal('modal-mas-movil');goTo('${n.id}')">
      <i class="ti ${n.icon}"></i>${n.label}
    </button>`).join('');
  document.getElementById('modal-mas-movil').classList.add('open');
}

function syncMobileNavActive(){
  const active = document.querySelector('.nav-item.active')?.dataset.navId;
  document.querySelectorAll('.mnav-item[data-nav-id]').forEach(b=>{
    b.classList.toggle('active', b.dataset.navId===active);
  });
}