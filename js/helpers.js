// Devuelve la fecha calendario (YYYY-MM-DD) según la hora de Colombia (UTC-5, sin horario de verano).
// Se usa para cortes de "día" consistentes sin importar la zona horaria del navegador/servidor.
function fechaColombia(fecha){
  const d = fecha ? new Date(fecha) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function getSem(caducidad){
  if(!caducidad) return 'V';
  const diff = (new Date(caducidad)-new Date())/864e5;
  if(diff<0) return 'N';
  if(diff<90) return 'R';
  if(diff<180) return 'A';
  return 'V';
}

function semLabel(s){
  return {V:'Vigente',A:'Por vencer',R:'Crítico',N:'Vencido'}[s]||s;
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
    if(el) el.remove(); // ← eliminar del DOM completamente, no solo ocultar
  }
}