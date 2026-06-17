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
    // Usar siempre el nivel devuelto por el servidor tras autenticación real,
    // nunca un payload JWT decodificado localmente sin verificar firma
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

(async function checkSession(){
  const token = localStorage.getItem('nb_token');
  if(!token) return;
  try {
    // ADVERTENCIA: atob() solo decodifica el payload pero NO verifica la firma del JWT.
    // El nivel que se asigna aquí controla únicamente qué UI se muestra en el cliente.
    // La seguridad real recae en el backend (verificarToken + verificarNivel).
    // Un atacante que manipule localStorage solo verá una UI diferente;
    // todas las llamadas API seguirán siendo rechazadas por el servidor.
    const parts = token.split('.');
    if(parts.length !== 3) throw new Error('Token malformado');
    const payload = JSON.parse(atob(parts[1]));
    if(!payload.exp || !payload.nivel || !payload.id) throw new Error('Payload inválido');
    const ahora = Math.floor(Date.now()/1000);
    if(payload.exp < ahora){
      localStorage.removeItem('nb_token');
      return;
    }
    currentRole = payload.nivel;
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('visible');
    await setupApp(payload);
  } catch(e){
    console.error('Error checkSession:', e);
    localStorage.removeItem('nb_token');
  }
})();