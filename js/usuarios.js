async function crearUsuario(){
  const nombre = document.getElementById('u-nombre').value.trim();
  const cedula = document.getElementById('u-cedula').value.trim();
  const nivel = parseInt(document.getElementById('u-nivel').value);
  const genero = document.getElementById('u-genero').value;
  const fecha_nacimiento = document.getElementById('u-nacimiento').value;
  const password = document.getElementById('u-pass').value.trim();
  if(!nombre||!cedula||!password){
    toast('Completa nombre, cédula y contraseña','error');
    return;
  }
  try {
    await Usuarios.create({ nombre, cedula, nivel, genero, fecha_nacimiento, password });
    ['u-nombre','u-cedula','u-nacimiento','u-pass'].forEach(id=>{
      document.getElementById(id).value='';
    });
    S.usuarios = await Usuarios.getAll();
    renderUsuarios();
    toast('✓ Usuario creado','success');
  } catch(err){
    toast(err.message,'error');
  }
}

function renderUsuarios(){
  const el = document.getElementById('users-list');
  if(!S.usuarios.length){
    el.innerHTML='<div class="empty-state"><i class="ti ti-users"></i><p>Sin usuarios registrados</p></div>';
    return;
  }
  el.innerHTML = S.usuarios.map(u=>`
    <div class="user-card">
      <div class="user-avatar n${u.nivel}">
        ${u.nombre.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
      </div>
      <div class="user-info">
        <div class="user-name">${u.nombre}</div>
        <div class="user-cedula">CC: ${u.cedula} · ${u.genero||'—'}</div>
      </div>
      <span class="nivel-badge n${u.nivel}">N${u.nivel} · ${NIVELES[u.nivel]?.label}</span>
      ${currentRole===4?`
        <button class="act-btn danger" style="margin-left:6px" onclick="confirmDeleteUser(${u.id})">
          <i class="ti ti-trash"></i>
        </button>`:''}
    </div>`).join('');
}