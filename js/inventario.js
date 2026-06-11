function renderInv(){
  const q=(document.getElementById('inv-search').value||'').toLowerCase();
  const ub=document.getElementById('inv-ubicacion').value;
  const sem=document.getElementById('inv-sem').value;
  const fam=document.getElementById('inv-familia').value;
  const showAgotados=document.getElementById('inv-agotados')?.checked;

  let rows = [];
  S.subSkus.forEach(s=>{
    if(s.agotado&&!showAgotados) return;
    const skuG = S.skusGlobales.find(g=>g.id===s.skuGlobalId);
    const st = getSem(s.caducidad);
    if(sem&&st!==sem) return;
    if(fam&&skuG?.familia!==fam) return;
    if(q&&!s.nombre.toLowerCase().includes(q)&&!s.subSku.toLowerCase().includes(q)&&!(skuG?.codigo||'').toLowerCase().includes(q)&&!s.lote?.toLowerCase().includes(q)&&!s.proveedor?.toLowerCase().includes(q)) return;
    const stockEntries = ub ? [[ub, s.stock?.[ub]||0]] : Object.entries(s.stock||{});
    stockEntries.forEach(([ubicacion, cantidad])=>{
      if(!ub&&cantidad===0) return;
      rows.push({s,skuG,st,ubicacion,cantidad});
    });
  });

  const canAct = currentRole>=2;
  const el = document.getElementById('inv-body');
  if(!rows.length){
    el.innerHTML='<tr><td colspan="8"><div class="empty-state"><i class="ti ti-search"></i><p>Sin resultados</p></div></td></tr>';
    return;
  }
  el.innerHTML = rows.map(({s,skuG,st,ubicacion,cantidad})=>`
    <tr style="${s.agotado?'opacity:.5;':''}">
      <td><span class="sku-code">${skuG?.codigo||'—'}</span></td>
      <td>
        <div style="font-weight:500;font-size:13px">${s.nombre}</div>
        <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">
          <span class="fam ${skuG?.familia||''}">${FAMILIAS[skuG?.familia]||''}</span>
          ${s.agotado?'<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:#F0F0EE;color:#888;font-family:var(--font-mono);font-weight:700">AGOTADO</span>':''}
        </div>
      </td>
      <td><span class="sub-sku">${s.subSku}</span></td>
      <td><span class="ubic">${ubicacion}</span></td>
      <td style="font-family:var(--font-mono);font-weight:700">${cantidad}<span style="font-size:10px;color:#aaa;font-weight:400;margin-left:3px">${s.unidad}</span></td>
      <td style="font-size:12px;font-family:var(--font-mono)">${fmtDate(s.caducidad)}</td>
      <td>${s.agotado?'<span class="sem N">Agotado</span>':`<span class="sem ${st}">${semLabel(st)}</span>`}</td>
      <td>
        <div class="act-btn-group">
          ${canAct?`<button class="act-btn primary" onclick="quickMov(${s.id},'${ubicacion}')" title="Movimiento"><i class="ti ti-transfer"></i></button>`:''}
          ${currentRole>=4?`<button class="act-btn danger" onclick="confirmDelete(${s.id})" title="Eliminar"><i class="ti ti-trash"></i></button>`:''}
        </div>
      </td>
    </tr>`).join('');
}