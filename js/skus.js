// Devuelve todos los valores únicos de familia/subgrupo ya registrados en S.skusGlobales
function getFamiliasExistentes(){
  return [...new Set(S.skusGlobales.map(s => s.familia).filter(Boolean))];
}
function getSubgruposExistentes(){
  return [...new Set(S.skusGlobales.map(s => s.subgrupo).filter(Boolean))];
}

// Normaliza un string para comparación: minúsculas sin tildes ni espacios extra
function normalizar(str){
  return (str||'').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Busca si ya existe un valor similar (distinto en mayúsculas/tildes) al escrito
function buscarSimilar(valor, lista){
  const norm = normalizar(valor);
  if(!norm) return null;
  return lista.find(existente => normalizar(existente) === norm) || null;
}

function checkSimilarFamilia(){
  const input = document.getElementById('sku-familia');
  const hint  = document.getElementById('sku-familia-hint');
  const val   = input.value.trim();
  if(!val){ hint.style.display='none'; return; }

  const similar = buscarSimilar(val, getFamiliasExistentes());
  // Solo mostrar alerta si el escrito es diferente en texto (distinta capitalización/tildes)
  if(similar && similar !== val){
    hint.className = 'similar-hint warning';
    hint.style.display = 'block';
    hint.innerHTML = `
      <i class="ti ti-alert-triangle" style="margin-right:4px"></i>
      Ya existe una familia con ese nombre: <strong>${similar}</strong><br>
      <button class="hint-use-btn" onclick="usarFamiliaExistente('${similar.replace(/'/g,"\\'")}')">
        <i class="ti ti-check"></i> Usar "${similar}"
      </button>`;
  } else {
    hint.style.display = 'none';
  }
}

function checkSimilarSubgrupo(){
  const input = document.getElementById('sku-subgrupo');
  const hint  = document.getElementById('sku-subgrupo-hint');
  const val   = input.value.trim();
  if(!val){ hint.style.display='none'; return; }

  const similar = buscarSimilar(val, getSubgruposExistentes());
  if(similar && similar !== val){
    hint.className = 'similar-hint warning';
    hint.style.display = 'block';
    hint.innerHTML = `
      <i class="ti ti-alert-triangle" style="margin-right:4px"></i>
      Ya existe un subgrupo con ese nombre: <strong>${similar}</strong><br>
      <button class="hint-use-btn" onclick="usarSubgrupoExistente('${similar.replace(/'/g,"\\'")}')">
        <i class="ti ti-check"></i> Usar "${similar}"
      </button>`;
  } else {
    hint.style.display = 'none';
  }
}

function usarFamiliaExistente(nombre){
  document.getElementById('sku-familia').value = nombre;
  document.getElementById('sku-familia-hint').style.display = 'none';
}

function usarSubgrupoExistente(nombre){
  document.getElementById('sku-subgrupo').value = nombre;
  document.getElementById('sku-subgrupo-hint').style.display = 'none';
}

function updateGlobalSKU(){
  const nombre = document.getElementById('sku-nombre').value||'';
  const words = nombre.trim().split(/\s+/).filter(Boolean);
  let code = '';
  if(words.length===1){
    code = words[0].replace(/[^a-zA-Z0-9.]/g,'').substring(0,6).toUpperCase();
  } else {
    code = words.map(w=>w.replace(/[^a-zA-Z0-9.]/g,'').substring(0,3).toUpperCase()).filter(Boolean).join('-');
  }
  document.getElementById('sku-codigo').value = code;
  document.getElementById('sku-global-preview').textContent = code||'---';
}

function toggleCampo(label){
  const cb = label.querySelector('input[type=checkbox]');
  cb.checked = !cb.checked;
  label.classList.toggle('active', cb.checked);
  const icon = label.querySelector('i');
  if(icon) icon.className = cb.checked?'ti ti-check':'ti ti-plus';
}

async function crearSKUGlobal(){
  const nombre     = document.getElementById('sku-nombre').value.trim();
  const codigo     = document.getElementById('sku-codigo').value.trim().toUpperCase();
  const familia    = document.getElementById('sku-familia').value.trim();
  const subgrupo   = document.getElementById('sku-subgrupo').value.trim();

  if(!nombre||!codigo){ toast('Completa nombre y código SKU','error'); return; }
  if(!familia){ toast('Ingresa la familia del SKU','error'); return; }
  if(!subgrupo){ toast('Ingresa el subgrupo del SKU','error'); return; }

  const similarFam = buscarSimilar(familia, getFamiliasExistentes());
  if(similarFam && similarFam !== familia){
    toast(`La familia "${familia}" es similar a "${similarFam}" ya existente. Usa el botón "Usar" para unificar.`, 'error', 6000);
    return;
  }
  const similarSub = buscarSimilar(subgrupo, getSubgruposExistentes());
  if(similarSub && similarSub !== subgrupo){
    toast(`El subgrupo "${subgrupo}" es similar a "${similarSub}" ya existente. Usa el botón "Usar" para unificar.`, 'error', 6000);
    return;
  }

  const campos = [...document.querySelectorAll('.campo-chip input:checked')].map(cb=>cb.value);
  try {
    await SKUs.createGlobal({ codigo, nombre, familia, subgrupo, campos });
    ['sku-nombre','sku-codigo','sku-familia','sku-subgrupo'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('sku-global-preview').textContent='---';
    document.getElementById('sku-familia-hint').style.display='none';
    document.getElementById('sku-subgrupo-hint').style.display='none';
    S.skusGlobales = await SKUs.getGlobales();
    populateSelects();
    renderSKUs();
    toast('✓ SKU Global creado','success');
  } catch(err){
    toast(err.message,'error');
  }
}

function renderSKUs(){
  const q = (document.getElementById('sku-search')?.value||'').toLowerCase();
  const list = S.skusGlobales.filter(s=>!q||s.codigo.toLowerCase().includes(q)||s.nombre.toLowerCase().includes(q));
  const body = document.getElementById('sku-body');
  if(!list.length){
    body.innerHTML='<tr><td colspan="5"><div class="empty-state"><i class="ti ti-tag"></i><p>Sin SKUs registrados</p></div></td></tr>';
    return;
  }
  body.innerHTML = list.map(s=>`
    <tr>
      <td><span class="sku-code">${s.codigo}</span></td>
      <td style="font-size:13px;font-weight:500">${s.nombre}
        <div style="font-size:11px;color:#aaa">${s.presentacion||''}</div>
      </td>
      <td><span class="fam-text">${s.familia||'—'}</span></td>
      <td style="font-size:10px;color:#888;font-family:var(--font-mono)">
        ${Array.isArray(s.campos)?s.campos.join(', '):(s.campos||'')}
      </td>
      <td>
        <div class="act-btn-group">
          <button class="act-btn danger" onclick="confirmDeleteSKU(${s.id})">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </td>
    </tr>`).join('');
}