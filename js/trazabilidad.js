async function updateTrazSubs(){
  const gId = parseInt(document.getElementById('traz-global').value)||0;
  const sel = document.getElementById('traz-sub');
  sel.innerHTML='<option value="">Todos los Sub-SKUs</option>';
  if(!gId){ await renderTrazabilidad(); return; }
  S.subSkus.filter(s=>s.skuGlobalId===gId).forEach(s=>{
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.subSku;
    sel.appendChild(o);
  });
  await renderTrazabilidad();
}

async function renderTrazabilidad(){
  const gId = parseInt(document.getElementById('traz-global').value)||0;
  const sId = parseInt(document.getElementById('traz-sub').value)||0;
  const result = document.getElementById('traz-result');

  if(!gId){
    result.innerHTML='<div class="empty-state"><i class="ti ti-timeline"></i><p>Selecciona un SKU Global para ver su trazabilidad</p></div>';
    return;
  }

  try {
    result.innerHTML='<div class="empty-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i><p>Cargando trazabilidad...</p></div>';
    const skuG = S.skusGlobales.find(g=>g.id===gId);
    const params = { sku_global: skuG?.codigo };
    if(sId) params.sub_sku_id = sId;
    const movs = await Movimientos.getAll(params);
    const subs = S.subSkus.filter(s=>s.skuGlobalId===gId&&(!sId||s.id===sId));
    const tipoIcon = {
      compra:'ti-shopping-cart', asignacion:'ti-arrow-right',
      traslado:'ti-transfer', consumo:'ti-minus-circle', destruccion:'ti-trash'
    };

    result.innerHTML=`
      <div class="card" style="margin-bottom:16px">
        <div class="card-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--blue)">${skuG?.codigo}</div>
              <div style="font-size:15px;font-weight:600;margin-top:4px">${skuG?.nombre}</div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                <span class="fam ${skuG?.familia}">${FAMILIAS[skuG?.familia]||''}</span>
                <span style="font-size:11px;color:#888">${skuG?.subgrupo}</span>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;color:#888;font-family:var(--font-mono)">
                Sub-SKUs activos: ${subs.filter(s=>!s.agotado).length}
              </div>
              <div style="font-size:12px;font-weight:700;margin-top:4px">
                Stock total: ${subs.reduce((a,s)=>a+getTotalStock(s),0)} ${subs[0]?.unidad||''}
              </div>
            </div>
          </div>
        </div>
      </div>
      ${movs.length===0
        ? '<div class="empty-state"><i class="ti ti-timeline"></i><p>Sin movimientos registrados</p></div>'
        : `<div class="sec-title" style="margin-bottom:14px">
             Línea de tiempo (${movs.length} evento${movs.length!==1?'s':''})
           </div>
           <div class="timeline">
             ${movs.map(m=>{
               const nivel = m.usuario_nivel||0;
               return`<div class="tl-item">
                 <div class="tl-dot ${m.tipo}"></div>
                 <div class="tl-card">
                   <div class="tl-header">
                     <div class="tl-tipo ${m.tipo}">
                       <i class="ti ${tipoIcon[m.tipo]||'ti-arrow-right'}" style="margin-right:4px"></i>
                       ${m.tipo.toUpperCase()}
                     </div>
                     <div class="tl-fecha">
                       ${new Date(m.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                     </div>
                   </div>
                   <div class="tl-desc">
                     ${m.tipo==='compra'
                       ?`Entrada de <strong>${m.cantidad}</strong> unidades → <strong>${m.destino_nombre||'—'}</strong>`
                       :m.tipo==='consumo'
                       ?`Consumo de <strong>${m.cantidad}</strong> unidades desde <strong>${m.origen_nombre||'—'}</strong>`
                       :m.tipo==='traslado'
                       ?`Traslado de <strong>${m.cantidad}</strong> unidades de <strong>${m.origen_nombre||'—'}</strong> a <strong>${m.destino_nombre||'—'}</strong>`
                       :`Baja de <strong>${m.cantidad}</strong> unidades desde <strong>${m.origen_nombre||'—'}</strong>${m.motivo?' · Motivo: '+m.motivo:''}`}
                   </div>
                   <div class="tl-user">
                     <div class="tl-user-dot n${nivel}"></div>
                     <strong>${m.usuario_nombre||'—'}</strong>
                     <span class="nivel-badge n${nivel}" style="font-size:9px">
                       ${NIVELES[nivel]?.label||''}
                     </span>
                   </div>
                 </div>
               </div>`;
             }).join('')}
           </div>`
      }`;
  } catch(err){
    result.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error cargando trazabilidad</p></div>';
    toast(err.message,'error');
  }
}