function updateBodegaPreview(){
  const tipo = document.getElementById('b-tipo').value;
  const sufijo = (document.getElementById('b-sufijo').value||'').toUpperCase();
  document.getElementById('bodega-preview').textContent = `${tipo}-${sufijo||''}`;
}

async function crearBodega(){
  const tipo = document.getElementById('b-tipo').value;
  const sufijo = document.getElementById('b-sufijo').value.trim().toUpperCase();
  if(!sufijo){ toast('Ingresa el sufijo de la bodega','error'); return; }
  try {
    await Bodegas.create(tipo, sufijo);
    document.getElementById('b-sufijo').value='';
    updateBodegaPreview();
    await loadState();
    populateSelects();
    renderBodegas();
    toast(`✓ ${tipo}-${sufijo} creada`,'success');
  } catch(err){
    toast(err.message,'error');
  }
}

function renderBodegas(){
  const el = document.getElementById('bodegas-list');
  const icons = {ALM:'ti-building-warehouse',BTQ:'ti-briefcase-medical',ENF:'ti-stethoscope',MEC:'ti-heart-rate-monitor'};
  el.innerHTML = S.bodegas.map(b=>{
    const prefix = b.split('-')[0];
    return`<div class="bodega-card">
      <div class="bodega-icon">
        <i class="ti ${icons[prefix]||'ti-map-pin'}"></i>
      </div>
      <div class="bodega-info">
        <div class="bodega-name">${b}</div>
        <div class="bodega-prefix">${{ALM:'Almacén',BTQ:'Botiquín',ENF:'Enfermería',MEC:'Médico'}[prefix]||prefix}</div>
      </div>
      ${currentRole===4?`
        <button class="act-btn danger" onclick="confirmDeleteBodega('${b}')">
          <i class="ti ti-trash"></i>
        </button>`:''}
    </div>`;
  }).join('');
}