let _delType = null;
let _delId = null;

function confirmDelete(id){
  _delType='sub'; _delId=id;
  const sub = S.subSkus.find(s=>s.id===id);
  document.getElementById('modal-title').textContent='Eliminar Sub-SKU';
  document.getElementById('modal-sub').textContent=`¿Eliminar "${sub?.subSku}"? Esta acción no se puede deshacer.`;
  document.getElementById('modal-ok-btn').onclick = doDelete;
  document.getElementById('modal-confirm').classList.add('open');
}

function confirmDeleteSKU(id){
  _delType='global'; _delId=id;
  const s = S.skusGlobales.find(g=>g.id===id);
  document.getElementById('modal-title').textContent='Eliminar SKU Global';
  document.getElementById('modal-sub').textContent=`¿Eliminar "${s?.codigo} — ${s?.nombre}"? Se eliminarán también todos sus Sub-SKUs.`;
  document.getElementById('modal-ok-btn').onclick = doDelete;
  document.getElementById('modal-confirm').classList.add('open');
}

function confirmDeleteUser(id){
  _delType='user'; _delId=id;
  const u = S.usuarios.find(u=>u.id===id);
  document.getElementById('modal-title').textContent='Eliminar usuario';
  document.getElementById('modal-sub').textContent=`¿Eliminar al usuario "${u?.nombre}"?`;
  document.getElementById('modal-ok-btn').onclick = doDelete;
  document.getElementById('modal-confirm').classList.add('open');
}

async function doDelete(){
  try {
    if(_delType==='sub'){
      const sub = S.subSkus.find(s=>s.id===_delId);
      if(sub) await SKUs.deleteSub(_delId);
    } else if(_delType==='global'){
      await SKUs.deleteGlobal(_delId);
    } else if(_delType==='user'){
      await Usuarios.delete(_delId);
    }
    closeModal('modal-confirm');
    await loadState();
    populateSelects();
    renderAll();
    toast('Eliminado correctamente');
  } catch(err){
    toast(err.message,'error');
    closeModal('modal-confirm');
  }
}