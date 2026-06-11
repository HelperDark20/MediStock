function updateSkuSubgrupos(){
  const fam = document.getElementById('sku-familia')?.value||'MED';
  const sel = document.getElementById('sku-subgrupo');
  if(!sel) return;
  sel.innerHTML = (SUBGRUPOS[fam]||[]).map(s=>`<option value="${s}">${s}</option>`).join('');
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
  const nombre = document.getElementById('sku-nombre').value.trim();
  const codigo = document.getElementById('sku-codigo').value.trim().toUpperCase();
  const familia = document.getElementById('sku-familia').value;
  const subgrupo = document.getElementById('sku-subgrupo').value;
  const presentacion = document.getElementById('sku-presentacion').value.trim();
  if(!nombre||!codigo){ toast('Completa nombre y código SKU','error'); return; }
  const campos = [...document.querySelectorAll('.campo-chip input:checked')].map(cb=>cb.value);
  try {
    await SKUs.createGlobal({ codigo, nombre, familia, subgrupo, presentacion, campos });
    ['sku-nombre','sku-codigo','sku-presentacion'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('sku-global-preview').textContent='---';
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
      <td><span class="fam ${s.familia}">${FAMILIAS[s.familia]}</span></td>
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