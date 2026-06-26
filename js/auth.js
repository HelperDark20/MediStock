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

// FIX: checkSession usa GET /api/auth/me para validar el token server-side
// en vez de decodificar el JWT localmente con atob() sin verificar firma
(async function checkSession(){
  const token = localStorage.getItem('nb_token');
  if(!token) return;

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if(!res.ok){
      // Token inválido o expirado — limpiar y mostrar login
      localStorage.removeItem('nb_token');
      return;
    }

    const data = await res.json();
    const user = data.usuario;

    if(!user || !user.nivel || !user.id){
      localStorage.removeItem('nb_token');
      return;
    }

    currentRole = user.nivel;
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('visible');
    await setupApp(user);

  } catch(e){
    console.error('Error checkSession:', e);
    localStorage.removeItem('nb_token');
  }
})();