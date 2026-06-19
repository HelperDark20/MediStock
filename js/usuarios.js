function poblarSelectsFechaNac(){
  ['u-nac-dia','edit-u-nac-dia'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="">Día</option>' +
      Array.from({length:31},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1}</option>`).join('');
  });
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  ['u-nac-mes','edit-u-nac-mes'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="">Mes</option>' +
      meses.map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('');
  });
  const añoActual = new Date().getFullYear();
  ['u-nac-año','edit-u-nac-año'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="">Año</option>' +
      Array.from({length:80},(_,i)=>`<option value="${añoActual-i}">${añoActual-i}</option>`).join('');
  });
}

// Mostrar/ocultar campo de ubicación según nivel seleccionado
function toggleUbicacionField(){
  const nivel = parseInt(document.getElementById('u-nivel').value);
  const wrap  = document.getElementById('u-ubicacion-wrap');
  if(wrap) wrap.style.display = nivel === 2 ? '' : 'none';
}

function toggleEditUbicacionField(){
  const nivel = parseInt(document.getElementById('edit-u-nivel').value);
  const wrap  = document.getElementById('edit-u-ubicacion-wrap');
  if(wrap) wrap.style.display = nivel === 2 ? '' : 'none';
}

// Poblar select de ubicaciones en el form de crear usuario
function populateUsuarioUbicaciones(){
  ['u-ubicacion','edit-u-ubicacion'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Sin asignación específica</option>' +
      S.ubicaciones.map(u=>`<option value="${u.id}">${u.nombre}</option>`).join('');
    if(current) sel.value = current;
  });
}

async function crearUsuario(){
  poblarSelectsFechaNac();
  const nombre   = document.getElementById('u-nombre').value.trim();
  const cedula   = document.getElementById('u-cedula').value.trim();
  const nivel    = parseInt(document.getElementById('u-nivel').value);
  const genero   = document.getElementById('u-genero').value;
  const dia      = document.getElementById('u-nac-dia').value;
  const mes      = document.getElementById('u-nac-mes').value;
  const año      = document.getElementById('u-nac-año').value;
  const fecha_nacimiento = (dia && mes && año) ? `${año}-${mes}-${dia}` : null;
  const password     = document.getElementById('u-pass').value.trim();
  const ubicacion_id = nivel === 2
    ? (parseInt(document.getElementById('u-ubicacion').value)||null)
    : null;

  if(!nombre||!cedula||!password){
    toast('Completa nombre, cédula y contraseña','error');
    return;
  }
  try {
    await Usuarios.create({ nombre, cedula, nivel, genero, fecha_nacimiento, password, ubicacion_id });
    ['u-nombre','u-cedula','u-pass'].forEach(id => document.getElementById(id).value='');
    ['u-nac-dia','u-nac-mes','u-nac-año'].forEach(id => document.getElementById(id).value='');
    document.getElementById('u-ubicacion-wrap').style.display = 'none';
    S.usuarios = await Usuarios.getAll();
    renderUsuarios();
    toast('✓ Usuario creado','success');
  } catch(err){
    toast(err.message,'error');
  }
}

// ── EDITAR USUARIO ──
function abrirEdicionUsuario(id){
  const u = S.usuarios.find(u => u.id === id);
  if(!u) return;

  document.getElementById('edit-u-id').value    = u.id;
  document.getElementById('edit-u-nombre').value = u.nombre;
  document.getElementById('edit-u-nivel').value  = u.nivel;
  document.getElementById('edit-u-pass').value   = '';
  document.getElementById('modal-edit-user-sub').textContent = `CC: ${u.cedula}`;

  // Poblar ubicaciones y seleccionar la asignada
  populateUsuarioUbicaciones();
  const editUbSel = document.getElementById('edit-u-ubicacion');
  editUbSel.value = u.ubicacion_id || '';

  // Mostrar campo ubicación si es enfermero
  toggleEditUbicacionField();

  document.getElementById('modal-edit-user').classList.add('open');
}

async function guardarEdicionUsuario(){
  const id       = parseInt(document.getElementById('edit-u-id').value);
  const nombre   = document.getElementById('edit-u-nombre').value.trim();
  const nivel    = parseInt(document.getElementById('edit-u-nivel').value);
  const password = document.getElementById('edit-u-pass').value.trim();
  const ubicacion_id = nivel === 2
    ? (parseInt(document.getElementById('edit-u-ubicacion').value)||null)
    : null;

  if(!nombre){ toast('El nombre no puede estar vacío','error'); return; }
  try {
    await Usuarios.update(id, { nombre, nivel, password: password||null, ubicacion_id });
    closeModal('modal-edit-user');
    S.usuarios = await Usuarios.getAll();
    renderUsuarios();
    toast('✓ Usuario actualizado','success');
  } catch(err){
    toast(err.message,'error');
  }
}

function renderUsuarios(){
  populateUsuarioUbicaciones();
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
        <div class="user-cedula">CC: ${u.cedula} · ${u.genero||'—'}${u.ubicacion_nombre ? ` · <span style="color:var(--blue);font-weight:600">${u.ubicacion_nombre}</span>` : ''}</div>
      </div>
      <span class="nivel-badge n${u.nivel}">N${u.nivel} · ${NIVELES[u.nivel]?.label}</span>
      ${currentRole===4?`
        <div class="act-btn-group" style="margin-left:6px">
          <button class="act-btn primary" onclick="abrirEdicionUsuario(${u.id})" title="Editar">
            <i class="ti ti-pencil"></i>
          </button>
          <button class="act-btn danger" onclick="confirmDeleteUser(${u.id})" title="Eliminar">
            <i class="ti ti-trash"></i>
          </button>
        </div>`:''}
    </div>`).join('');
}