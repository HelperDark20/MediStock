// ══════════════════════════════════════════
// BUSCADOR DE MUNICIPIOS (DIVIPOLA del DANE)
// Campo con lista desplegable para elegir el municipio de una ubicación.
// La historia clínica toma de ahí el municipio del lugar de atención, por
// eso solo se acepta un municipio de la lista (no texto libre).
//
// Marcado (ID = id del input):
//   <div class="ac-wrap">
//     <i class="ti ti-map-2 ac-icon"></i>
//     <input class="ac-input" id="ID" autocomplete="off"
//       oninput="muniFiltrar('ID')" onfocus="muniFiltrar('ID')"
//       onblur="muniCerrar('ID')" onkeydown="muniTecla(event,'ID')">
//     <div class="ac-dropdown" id="ID-drop"></div>
//   </div>
// El código elegido queda en input.dataset.codigo (muniValor / muniFijar).
// ══════════════════════════════════════════
let _municipios = null;
const _muniFoco = {};

async function municipiosCargar(){
  if(!_municipios){
    const lista = await Ubicaciones.municipios();
    _municipios = lista.map(m => ({ ...m, _busq: _muniNorm(`${m.nombre} ${m.departamento}`) }));
  }
  return _municipios;
}

function _muniNorm(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
}

function muniTexto(m){ return m ? `${m.nombre} — ${m.departamento}` : ''; }

// Código del municipio elegido, o '' si no se eligió de la lista
function muniValor(id){
  const inp = document.getElementById(id);
  return (inp && inp.dataset.codigo) || '';
}

function muniFijar(id, codigo){
  const inp = document.getElementById(id);
  if(!inp) return;
  const m = (_municipios||[]).find(x => x.codigo === codigo);
  inp.dataset.codigo = m ? m.codigo : '';
  inp.value = m ? muniTexto(m) : '';
}

async function muniFiltrar(id){
  const inp = document.getElementById(id);
  const drop = document.getElementById(`${id}-drop`);
  // Escribir invalida la elección anterior hasta que se elija otra
  const m = (_municipios||[]).find(x => x.codigo === inp.dataset.codigo);
  if(m && inp.value !== muniTexto(m)) inp.dataset.codigo = '';
  let lista;
  try { lista = await municipiosCargar(); }
  catch(err){ drop.innerHTML = `<div class="ac-no-results">No se pudo cargar la lista de municipios</div>`; drop.classList.add('open'); return; }

  const q = _muniNorm(inp.dataset.codigo ? '' : inp.value);
  if(!q){ drop.classList.remove('open'); drop.innerHTML = ''; return; }
  const palabras = q.split(/\s+/);
  const res = lista
    .filter(x => palabras.every(p => x._busq.includes(p)))
    .sort((a, b) => (_muniNorm(b.nombre).startsWith(q) ? 1 : 0) - (_muniNorm(a.nombre).startsWith(q) ? 1 : 0)
                    || a.nombre.localeCompare(b.nombre))
    .slice(0, 30);
  _muniFoco[id] = -1;
  drop.innerHTML = res.length
    ? res.map((x, i) => `<div class="ac-item" data-codigo="${x.codigo}" onmousedown="muniElegir('${id}','${x.codigo}')" onmouseover="_muniResaltar('${id}',${i})">
        <div class="ac-item-icon"><i class="ti ti-map-2"></i></div>
        <div class="ac-item-body">
          <div class="ac-item-name">${hiliteHtml(x.nombre, inp.value.trim())}</div>
          <div class="ac-item-meta"><span>${escHtml(x.departamento)}</span><span class="sku-code" style="font-size:9px">${x.codigo}</span></div>
        </div>
      </div>`).join('')
    : `<div class="ac-no-results">Ningún municipio coincide con "${escHtml(inp.value.trim())}"</div>`;
  drop.classList.add('open');
}

function muniElegir(id, codigo){
  muniFijar(id, codigo);
  const drop = document.getElementById(`${id}-drop`);
  drop.classList.remove('open');
  drop.innerHTML = '';
}

function muniCerrar(id){
  // Diferido: deja que el onmousedown de la opción se procese primero
  setTimeout(() => {
    const drop = document.getElementById(`${id}-drop`);
    if(drop) drop.classList.remove('open');
  }, 150);
}

function _muniResaltar(id, idx){
  const items = document.querySelectorAll(`#${id}-drop .ac-item`);
  items.forEach((el, i) => el.classList.toggle('focused', i === idx));
  _muniFoco[id] = idx;
}

function muniTecla(e, id){
  const items = document.querySelectorAll(`#${id}-drop .ac-item`);
  if(!items.length) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); _muniResaltar(id, Math.min((_muniFoco[id] ?? -1) + 1, items.length - 1)); items[_muniFoco[id]].scrollIntoView({block:'nearest'}); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); _muniResaltar(id, Math.max((_muniFoco[id] ?? 0) - 1, 0)); items[_muniFoco[id]].scrollIntoView({block:'nearest'}); }
  else if(e.key === 'Enter'){
    e.preventDefault();
    const idx = (_muniFoco[id] ?? -1) >= 0 ? _muniFoco[id] : 0;
    muniElegir(id, items[idx].dataset.codigo);
  }
}

// Municipio de una ubicación para mostrar en las listas
function muniDeUbicacion(u){
  return u && u.municipio_nombre ? `${u.municipio_nombre} (${u.municipio_departamento})` : '';
}
