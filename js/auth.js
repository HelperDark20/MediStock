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
  document.getElementById('app').classList.remove('visible');
  const ls = document.getElementById('login-screen');
  ls.style.display = 'flex';
  ls.classList.remove('out');
  ['l-cedula','l-pass'].forEach(id=>document.getElementById(id).value='');
}

async function setupApp(user){
  const niv = NIVELES[currentRole];
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
    const payload = JSON.parse(atob(token.split('.')[1]));
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