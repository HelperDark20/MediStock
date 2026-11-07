// NOTA: la ubicación de los enfermeros (Nivel 2) ya NO se asigna aquí.
// Ahora se asigna de forma temporal desde el módulo "Eventos", donde el
// administrador define ubicación + depósitos habilitados + personal
// (enfermeros y médicos) para la duración del evento.
//
// Nivel 1 = Médico: no tiene contraseña ni acceso a la app. Se asigna a los
// eventos desde "Agregar personal" y sus datos (nombre y cédula, que hace
// también de registro profesional) salen en la historia clínica. La fecha de nacimiento de los
// usuarios ya no se pide.

const NIVEL_MEDICO = 1;

// Muestra/oculta los campos según el nivel elegido. prefijo: 'u' (crear) o
// 'edit-u' (editar)
function usuarioNivelCambio(prefijo){
  const esMedico = parseInt(document.getElementById(`${prefijo}-nivel`).value) === NIVEL_MEDICO;
  document.getElementById(`${prefijo}-medico-hint`).style.display = esMedico ? '' : 'none';
  const etiqueta = document.getElementById(`${prefijo}-cedula-label`);
  if(etiqueta) etiqueta.textContent = esMedico ? 'Cédula / Registro profesional' : 'Número de cédula';
  if(prefijo === 'edit-u') _editSubtitulo();
  document.getElementById(`${prefijo}-pass-wrap`).style.display = esMedico ? 'none' : '';
  if(prefijo === 'edit-u') _editPassLabel();
}

// Al pasar un médico a otro nivel la contraseña es obligatoria (no tenía)
function _editPassLabel(){
  const id = parseInt(document.getElementById('edit-u-id').value);
  const u = S.usuarios.find(x => x.id === id);
  const eraMedico = u && u.nivel === NIVEL_MEDICO;
  document.getElementById('edit-u-pass-label').innerHTML = eraMedico
    ? 'Contraseña <span style="font-weight:400;color:#c0392b">(obligatoria: este usuario no tenía acceso a la app)</span>'
    : 'Nueva contraseña <span style="font-weight:400;color:#aaa">(opcional)</span>';
  document.getElementById('edit-u-pass').placeholder = eraMedico ? 'Ej. NB2026*Carlos' : 'Dejar vacío para no cambiar';
}

// Subtítulo del modal de edición: la cédula del médico es su registro profesional
function _editSubtitulo(){
  const id = parseInt(document.getElementById('edit-u-id').value);
  const u = S.usuarios.find(x => x.id === id);
  if(!u) return;
  const esMedico = parseInt(document.getElementById('edit-u-nivel').value) === NIVEL_MEDICO;
  document.getElementById('modal-edit-user-sub').textContent = `${esMedico ? 'Cédula / Registro profesional' : 'CC'}: ${u.cedula}`;
}

async function crearUsuario(){
  const nombre   = document.getElementById('u-nombre').value.trim();
  const cedula   = document.getElementById('u-cedula').value.trim();
  const nivel    = parseInt(document.getElementById('u-nivel').value);
  const genero   = document.getElementById('u-genero').value;
  const esMedico = nivel === NIVEL_MEDICO;
  const password = esMedico ? '' : document.getElementById('u-pass').value.trim();

  if(!nombre || !cedula || (!esMedico && !password)){
    toast(esMedico ? 'Completa nombre y cédula' : 'Completa nombre, cédula y contraseña','error');
    return;
  }
  try {
    await Usuarios.create({ nombre, cedula, nivel, genero, password: password || null, ubicacion_id: null });
    ['u-nombre','u-cedula','u-pass'].forEach(id => document.getElementById(id).value='');
    S.usuarios = await Usuarios.getAll();
    renderUsuarios();
    toast(esMedico ? '✓ Médico creado (sin acceso a la app)' : '✓ Usuario creado','success');
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
  usuarioNivelCambio('edit-u');

  document.getElementById('modal-edit-user').classList.add('open');
}

async function guardarEdicionUsuario(){
  const id       = parseInt(document.getElementById('edit-u-id').value);
  const nombre   = document.getElementById('edit-u-nombre').value.trim();
  const nivel    = parseInt(document.getElementById('edit-u-nivel').value);
  const esMedico = nivel === NIVEL_MEDICO;
  const password = esMedico ? '' : document.getElementById('edit-u-pass').value.trim();
  const anterior = S.usuarios.find(x => x.id === id);

  if(!nombre){ toast('El nombre no puede estar vacío','error'); return; }
  if(!esMedico && anterior && anterior.nivel === NIVEL_MEDICO && !password){
    toast('Asigna una contraseña: este usuario no tenía acceso a la app','error');
    return;
  }
  // FIX: no se envía ubicacion_id — el formulario no la edita y enviarla en null la borraba
  const datos = { nombre, nivel, password: password || null };
  try {
    await Usuarios.update(id, datos);
    closeModal('modal-edit-user');
    S.usuarios = await Usuarios.getAll();
    renderUsuarios();
    toast('✓ Usuario actualizado','success');
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
  el.innerHTML = S.usuarios.map(u=>{
    const esMedico = u.nivel === NIVEL_MEDICO;
    const extra = esMedico
      ? ` · Cédula / Registro profesional · <span style="color:#999">sin acceso a la app</span>`
      : ` · ${escHtml(u.genero||'—')}`;
    return `
    <div class="user-card">
      <div class="user-avatar n${u.nivel}">
        ${escHtml((u.nombre||'').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase())}
      </div>
      <div class="user-info">
        <div class="user-name">${escHtml(u.nombre)}</div>
        <div class="user-cedula">CC: ${escHtml(u.cedula)}${extra}</div>
      </div>
      <div class="user-card-meta">
        <span class="nivel-badge n${u.nivel}">N${u.nivel} · ${NIVELES[u.nivel]?.label}</span>
        ${currentRole===4?`
          <div class="act-btn-group">
            <button class="act-btn primary" onclick="abrirEdicionUsuario(${u.id})" title="Editar">
              <i class="ti ti-pencil"></i>
            </button>
            <button class="act-btn danger" onclick="confirmDeleteUser(${u.id})" title="Eliminar">
              <i class="ti ti-trash"></i>
            </button>
          </div>`:''}
      </div>
    </div>`;
  }).join('');
}
