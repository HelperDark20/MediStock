// ── PREVIEW SKU GLOBAL ──
function updateGlobalSKU(){
  const nombre = (document.getElementById('sku-nombre').value||'').trim();
  const preview = document.getElementById('sku-global-preview');
  if(!nombre){ preview.textContent = '---'; return; }

  const words = nombre.toUpperCase().split(/\s+/).filter(Boolean);
  let codigo = '';
  if(words.length === 1){
    codigo = words[0].replace(/[^A-Z0-9]/g,'').substring(0, 6);
  } else {
    const siglas = words.slice(0, 3).map(w => w.replace(/[^A-Z0-9]/g,'')[0]||'').join('');
    const numeros = nombre.match(/\d+/g);
    codigo = siglas + (numeros ? '-' + numeros.join('') : '');
  }

  preview.textContent = codigo;

  const codigoInput = document.getElementById('sku-codigo');
  if(codigoInput && !codigoInput._manualEdit){
    codigoInput.value = codigo;
  }
}

// Marcar edición manual
document.addEventListener('DOMContentLoaded', () => {
  const codigoInput = document.getElementById('sku-codigo');
  if(codigoInput){
    codigoInput.addEventListener('input', () => { codigoInput._manualEdit = true; });
  }
});

// ── CAMPOS ACTIVABLES ──
function toggleCampo(label){
  const cb = label.querySelector('input[type=checkbox]');
  cb.checked = !cb.checked;
  label.classList.toggle('active', cb.checked);
}

function getCamposSeleccionados(){
  return Array.from(document.querySelectorAll('.campos-toggle input[type=checkbox]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

// ── CREAR SKU GLOBAL ──
async function crearSKUGlobal(){
  const nombre   = (document.getElementById('sku-nombre').value||'').trim();
  const codigo   = (document.getElementById('sku-codigo').value||'').trim().toUpperCase();
  const familia  = (document.getElementById('sku-familia').value||'').trim();
  const subgrupo = (document.getElementById('sku-subgrupo').value||'').trim();
  const campos   = getCamposSeleccionados();

  if(!nombre)  { toast('Ingresa el nombre del ítem','error'); return; }
  if(!codigo)  { toast('Ingresa el código SKU','error'); return; }
  if(!familia) { toast('Ingresa la familia','error'); return; }
  if(!subgrupo){ toast('Ingresa el subgrupo','error'); return; }

  try {
    await SKUs.createGlobal({ codigo, nombre, familia, subgrupo, campos });
    document.getElementById('sku-nombre').value   = '';
    document.getElementById('sku-codigo').value   = '';
    document.getElementById('sku-familia').value  = '';
    document.getElementById('sku-subgrupo').value = '';
    document.getElementById('sku-global-preview').textContent = '---';
    const codigoInput = document.getElementById('sku-codigo');
    if(codigoInput) codigoInput._manualEdit = false;
    document.querySelectorAll('.campos-toggle .campo-chip').forEach(label => {
      const cb = label.querySelector('input[type=checkbox]');
      cb.checked = true;
      label.classList.add('active');
    });
    document.getElementById('sku-familia-hint').style.display  = 'none';
    document.getElementById('sku-subgrupo-hint').style.display = 'none';
    await loadState();
    renderSKUs();
    toast(`✓ SKU ${codigo} creado`, 'success');
  } catch(err){
    toast(err.message, 'error');
  }
}

// ── RENDER LISTA DE SKUs ──
function renderSKUs(){
  const q  = (document.getElementById('sku-search').value||'').toLowerCase();
  const el = document.getElementById('sku-body');

  const rows = S.skusGlobales.filter(g =>
    !q ||
    g.nombre.toLowerCase().includes(q) ||
    g.codigo.toLowerCase().includes(q) ||
    (g.familia||'').toLowerCase().includes(q)
  );

  if(!rows.length){
    el.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-tag"></i><p>Sin SKUs registrados</p></div></td></tr>';
    return;
  }

  el.innerHTML = rows.map(g => {
    const campos = Array.isArray(g.campos) ? g.campos : JSON.parse(g.campos||'[]');
    const camposBadges = campos.map(c =>
      `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--cream2);color:#666;font-family:var(--font-mono)">${c}</span>`
    ).join(' ');
    const subsCount = S.subSkus.filter(s => s.skuGlobalId === g.id).length;
    return `<tr>
      <td><span class="sku-code">${escHtml(g.codigo)}</span></td>
      <td>
        <div style="font-weight:500;font-size:13px">${escHtml(g.nombre)}</div>
        <div style="font-size:11px;color:#aaa;margin-top:2px">${subsCount} sub-SKU${subsCount!==1?'s':''}</div>
      </td>
      <td><span class="fam ${g.familia}">${escHtml(g.familia||'—')}</span></td>
      <td style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">${camposBadges||'—'}</td>
      <td>
        ${currentRole===4?`<button class="act-btn danger" onclick="confirmDeleteSKU(${g.id})" title="Eliminar"><i class="ti ti-trash"></i></button>`:''}
      </td>
    </tr>`;
  }).join('');
}

// ── SUGERENCIA SIMILAR (usado también en registro.js) ──
function buscarSimilar(val, lista){
  if(!val || !lista.length) return null;
  const v = val.toLowerCase();
  const exacto = lista.find(x => x.toLowerCase() === v);
  if(exacto && exacto !== val) return exacto;
  const parcial = lista.find(x => x.toLowerCase().includes(v) || v.includes(x.toLowerCase()));
  if(parcial && parcial !== val) return parcial;
  return null;
}

function getFamiliasExistentes(){
  return [...new Set(S.skusGlobales.map(g => g.familia).filter(Boolean))];
}

function getSubgruposExistentes(){
  return [...new Set(S.skusGlobales.map(g => g.subgrupo).filter(Boolean))];
}

function checkSimilarFamilia(){
  const input = document.getElementById('sku-familia');
  const hint  = document.getElementById('sku-familia-hint');
  const val   = input.value.trim();
  if(!val){ hint.style.display='none'; return; }
  const similar = buscarSimilar(val, getFamiliasExistentes());
  if(similar && similar !== val){
    hint.className = 'similar-hint warning';
    hint.style.display = 'block';
    hint.innerHTML = `<i class="ti ti-alert-triangle" style="margin-right:4px"></i>Ya existe: <strong>${similar}</strong><br>
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
    hint.innerHTML = `<i class="ti ti-alert-triangle" style="margin-right:4px"></i>Ya existe: <strong>${similar}</strong><br>
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