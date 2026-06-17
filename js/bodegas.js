function updateBodegaPreview(){
  const tipo = (document.getElementById('b-tipo').value||'').toUpperCase().trim();
  const sufijo = (document.getElementById('b-sufijo').value||'').toUpperCase().trim();
  const preview = tipo && sufijo ? `${tipo}-${sufijo}` : tipo ? `${tipo}-` : sufijo ? `-${sufijo}` : '-';
  document.getElementById('bodega-preview').textContent = preview;
}

async function crearBodega(){
  const tipo = (document.getElementById('b-tipo').value||'').trim().toUpperCase();
  const sufijo = (document.getElementById('b-sufijo').value||'').trim().toUpperCase();
  if(!tipo){ toast('Ingresa el tipo de depósito','error'); return; }
  if(!sufijo){ toast('Ingresa el sufijo de la bodega','error'); return; }
  try {
    await Bodegas.create(tipo, sufijo);
    document.getElementById('b-tipo').value='';
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
  // Íconos por prefijo conocido; cualquier otro usa un pin genérico
  const icons = {
    ALM:'ti-building-warehouse',
    BTQ:'ti-briefcase-medical',
    ENF:'ti-stethoscope',
    MEC:'ti-heart-rate-monitor'
  };
  const labels = {
    ALM:'Almacén',
    BTQ:'Botiquín',
    ENF:'Enfermería',
    MEC:'Médico'
  };
  el.innerHTML = S.bodegas.map(b=>{
    const prefix = b.split('-')[0];
    return`<div class="bodega-card">
      <div class="bodega-icon">
        <i class="ti ${icons[prefix]||'ti-map-pin'}"></i>
      </div>
      <div class="bodega-info">
        <div class="bodega-name">${b}</div>
        <div class="bodega-prefix">${labels[prefix]||prefix}</div>
      </div>
      ${currentRole===4?`
        <button class="act-btn danger" onclick="confirmDeleteBodega('${b}')">
          <i class="ti ti-trash"></i>
        </button>`:''}
    </div>`;
  }).join('');
}