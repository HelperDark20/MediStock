function renderAll(){
  renderDash();
  renderInv();
  renderMovBody();
  renderSKUs();
  renderUsuarios();
  renderBodegas();
}

document.querySelectorAll('.modal-overlay').forEach(el=>
  el.addEventListener('click', e=>{ if(e.target===el) el.classList.remove('open'); })
);