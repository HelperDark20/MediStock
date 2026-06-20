async function doLogin(){
  const cedula = document.getElementById('l-cedula').value.trim();
  const pass = document.getElementById('l-pass').value.trim();

  if(!cedula || !pass){
    toast('Ingresa tu cédula y contraseña','error');
    return;
  }

  const btn = document.querySelector('.login-btn');
  btn.textContent = 'Ingresando...';
  btn.disabled = true;

  try {
    const data = await Auth.login(cedula, pass);
    // El nivel viene del servidor tras autenticación real —
    // nunca se toma de un payload JWT decodificado localmente
    currentRole = data.usuario.nivel;
    document.getElementById('login-screen').classList.add('out');
    setTimeout(async ()=>{
      document.getElementById('login-screen').style.display='none';
      document.getElementById('app').classList.add('visible');
      await setupApp(data.usuario);
    }, 400);
  } catch(err){
    toast(err.message || 'Error al iniciar sesión','error');
  } finally {
    btn.textContent = 'Ingresar al sistema';
    btn.disabled = false;
  }
}

function doLogout(){
  Auth.logout();
  currentRole = null;
  document.getElementById('enfermero-panel').classList.remove('active');
  document.getElementById('app').classList.remove('visible');
  const ls = document.getElementById('login-screen');
  ls.style.display = 'flex';
  ls.classList.remove('out');
  ['l-cedula','l-pass'].forEach(id=>document.getElementById(id).value='');
}

window.doLogin = doLogin;
window.doLogout = doLogout;

async function setupApp(user){
  const niv = NIVELES[currentRole];

  // Nivel 2 (Enfermero) → panel especial
  if(currentRole === 2){
    await loadState();
    initEnfermeroPanel(user);
    return;
  }

  // Resto de niveles → app normal
  const av = document.getElementById('sb-avatar');
  av.textContent = (user.nombre||'U').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  av.className = 'sb-avatar ' + niv.cls;
  document.getElementById('sb-name').textContent = user.nombre || 'Usuario';
  document.getElementById('sb-nivel').textContent = `NIVEL ${currentRole} · ${niv.label.toUpperCase()}`;
  await loadState();
  buildNav();
  populateSelects();
  goTo('dashboard');
}

// ══════════════════════════════════════════
// RESTAURACIÓN DE SESIÓN — Fix crítico #1
// ══════════════════════════════════════════
// En lugar de decodificar el JWT con atob() (lo que permite que
// cualquier persona con acceso al navegador forje un payload y
// obtenga la UI de un nivel superior), ahora se llama al endpoint
// /api/usuarios/me para que el SERVIDOR valide la firma del token
// y devuelva el nivel real del usuario.
(async function checkSession(){
  const token = localStorage.getItem('nb_token');
  if(!token) return;

  // Comprobación rápida del formato antes de hacer la petición
  const parts = token.split('.');
  if(parts.length !== 3){
    localStorage.removeItem('nb_token');
    return;
  }

  // Verificar expiración local (sin confiar en el nivel del payload)
  // Esto evita llamadas al servidor con tokens claramente expirados,
  // pero NO sustituye la validación de firma del backend.
  try {
    const payload = JSON.parse(atob(parts[1]));
    const ahora = Math.floor(Date.now() / 1000);
    if(!payload.exp || payload.exp < ahora){
      localStorage.removeItem('nb_token');
      return;
    }
  } catch(e){
    localStorage.removeItem('nb_token');
    return;
  }

  // ✅ Validación real: el servidor verifica la firma y devuelve el usuario
  try {
    const usuario = await request('GET', '/api/usuarios/me');

    // Seguridad: nivel debe ser un entero entre 1 y 4
    const nivel = parseInt(usuario.nivel);
    if(!nivel || nivel < 1 || nivel > 4){
      throw new Error('Nivel de usuario inválido');
    }

    currentRole = nivel;
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('visible');
    await setupApp(usuario);
  } catch(e){
    // Token inválido, expirado o usuario desactivado → limpiar sesión
    console.warn('Sesión inválida:', e.message);
    localStorage.removeItem('nb_token');
    // No mostrar error al usuario — simplemente queda en la pantalla de login
  }
})();