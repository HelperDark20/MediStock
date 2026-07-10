// Devuelve la fecha calendario (YYYY-MM-DD) según la hora de Colombia (UTC-5, sin horario de verano).
// Se usa para cortes de "día" consistentes sin importar la zona horaria del navegador/servidor.
function fechaColombia(fecha){
  const d = fecha ? new Date(fecha) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// Semáforo de caducidad:
//  < 0 días          → N (Vencido)
//  0–29 días         → P (Por vencer)
//  30–90 días        → R (Crítico)
//  91–180 días       → A (Alerta)
//  > 180 días / s/f  → V (Vigente)
//
// Fix #10: se compara YYYY-MM-DD vs YYYY-MM-DD en la misma zona horaria (Colombia),
// evitando el desfase de hasta 5h que ocurría al mezclar new Date(YYYY-MM-DD) [UTC]
// con new Date() [hora local del navegador].
function getSem(caducidad){
  if(!caducidad) return 'V';
  // Obtener fecha actual en Colombia como medianoche UTC (para comparación consistente)
  const hoyCO = new Date(fechaColombia() + 'T00:00:00');
  // La caducidad viene como YYYY-MM-DD desde PostgreSQL → también se trata como medianoche
  const cad   = new Date(caducidad.split('T')[0] + 'T00:00:00');
  const diff  = (cad - hoyCO) / 864e5;
  if(diff < 0)   return 'N';
  if(diff < 30)  return 'P';
  if(diff <= 90) return 'R';
  if(diff <= 180) return 'A';
  return 'V';
}

function semLabel(s){
  return {V:'Vigente',A:'Alerta',R:'Crítico',P:'Por vencer',N:'Vencido'}[s]||s;
}

function fmtCOP(n){
  return '$' + Math.round(Number(n)||0).toLocaleString('es-CO');
}

function fmtDate(d){
  if(!d) return '—';
  const [y,m,day] = d.split('T')[0].split('-');
  return `${day}/${m}/${y}`;
}

function formatFecha(input){
  const digits = input.value.replace(/\D/g,'').slice(0,8);
  if(digits.length > 4){
    input.value = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
  } else if(digits.length > 2){
    input.value = `${digits.slice(0,2)}/${digits.slice(2)}`;
  } else {
    input.value = digits;
  }
}

function abrevProv(str){
  if(!str) return '----';
  const words = str.trim().split(/\s+/).filter(Boolean);
  if(words.length===1) return str.replace(/[^a-zA-Z0-9]/g,'').substring(0,4).toUpperCase();
  return words.map(w=>w[0]?.toUpperCase()||'').join('').substring(0,4).padEnd(4,'X');
}

function buildSubSku(prov, lote){
  return `${abrevProv(prov)}-${(lote||'--------').toUpperCase()}`;
}

function getTotalStock(sub){
  return Object.values(sub.stock||{}).reduce((a,v)=>a+v, 0);
}

function getStockEnUbicacion(sub, ub){
  return sub.stock?.[ub]||0;
}

// ── SANITIZACIÓN XSS — Fix #11 ──
// Escapar caracteres HTML antes de insertar datos del servidor en innerHTML.
// Usar en cualquier template literal que incluya nombres, códigos, etc. del backend.
// Ejemplo: `<div>${escHtml(s.nombre)}</div>`
function escHtml(str){
  return String(str == null ? '—' : str).replace(
    /[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

function toast(msg, type='', duracion=2400){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show '+(type||'');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.className='toast', duracion);
}

function toastError(msg){
  toast(msg, 'error', 8000);
}

function closeModal(id){
  document.getElementById(id).classList.remove('open');
}

function showLoading(show){
  let el = document.getElementById('loading-overlay');
  if(show){
    if(!el){
      el = document.createElement('div');
      el.id = 'loading-overlay';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(10,22,40,.7);z-index:999;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;gap:10px;font-family:var(--font-body)';
      el.innerHTML = '<i class="ti ti-loader-2" style="font-size:24px;animation:spin 1s linear infinite"></i> Cargando datos...';
      document.body.appendChild(el);
      const style = document.createElement('style');
      style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    el.style.display = 'flex';
  } else {
    if(el) el.remove();
  }
}

// ── BADGES DE FAMILIA CON COLOR AUTOMÁTICO ──
// Como "familia" es texto libre (para poder crear familias nuevas sin
// tocar código), ya no podemos usar el texto como nombre de clase CSS
// literal. En vez de eso, asignamos un color de una paleta fija según
// un hash simple del texto — así cualquier familia (existente o nueva)
// siempre se ve con un color consistente.
const FAM_COLOR_CLASSES = ['c1','c2','c3','c4','c5','c6','c7','c8'];

function famColorClass(str){
  if(!str) return 'c8';
  let hash = 0;
  for(let i=0;i<str.length;i++){ hash = (hash*31 + str.charCodeAt(i)) >>> 0; }
  return FAM_COLOR_CLASSES[hash % FAM_COLOR_CLASSES.length];
}

function famBadge(familia){
  if(!familia) return '<span class="fam c8">—</span>';
  return `<span class="fam ${famColorClass(familia)}">${escHtml(familia)}</span>`;
}