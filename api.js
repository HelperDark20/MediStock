const API_URL = window.location.origin;

// ── TOKEN ──
function getToken(){ return localStorage.getItem('nb_token'); }
function setToken(t){ localStorage.setItem('nb_token', t); }
function removeToken(){ localStorage.removeItem('nb_token'); }

// ── HEADERS ──
function authHeaders(){
  const token = localStorage.getItem('nb_token');
  if(!token) console.warn('No hay token en localStorage');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// ── REQUEST BASE ──
async function request(method, path, body = null){
  const token = localStorage.getItem('nb_token');
  console.log(`${method} ${path} - Token: ${token ? 'OK' : 'MISSING'}`);
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

// ── AUTH ──
const Auth = {
  async login(cedula, password){
    const data = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cedula, password })
    });
    const json = await data.json();
    if(!data.ok) throw new Error(json.error);
    setToken(json.token);
    return json;
  },
  logout(){ removeToken(); }
};

// ── BODEGAS ──
const Bodegas = {
  getAll: () => request('GET', '/api/bodegas'),
  create: (tipo, sufijo, ubicacion_id) => request('POST', '/api/bodegas', { tipo, sufijo, ubicacion_id }),
  delete: (id) => request('DELETE', `/api/bodegas/${id}`)
};

// ── UBICACIONES ──
const Ubicaciones = {
  getAll: () => request('GET', '/api/ubicaciones'),
  create: (nombre) => request('POST', '/api/ubicaciones', { nombre }),
  delete: (id) => request('DELETE', `/api/ubicaciones/${id}`)
};

// ── SKUs ──
const SKUs = {
  getGlobales: () => request('GET', '/api/skus/globales'),
  createGlobal: (data) => request('POST', '/api/skus/globales', data),
  deleteGlobal: (id) => request('DELETE', `/api/skus/globales/${id}`),
  getSub: () => request('GET', '/api/skus/sub'),
  createSub: (data) => request('POST', '/api/skus/sub', data),
  deleteSub: (id) => request('DELETE', `/api/skus/sub/${id}`),
  getStock: () => request('GET', '/api/skus/stock')
};

// ── MOVIMIENTOS ──
const Movimientos = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request('GET', `/api/movimientos${query ? '?' + query : ''}`);
  },
  // Fix #8: nuevo método que unifica creación de sub-SKU + entrada en una
  // sola transacción atómica en el servidor, eliminando la race condition.
  entradaCompleta: (data) => request('POST', '/api/movimientos/entrada-completa', data),
  // Se mantiene para compatibilidad con flujos que ya tienen el sub_sku_id
  entrada: (data) => request('POST', '/api/movimientos/entrada', data),
  consumo: (data) => request('POST', '/api/movimientos/consumo', data),
  traslado: (data) => request('POST', '/api/movimientos/traslado', data),
  destruccion: (data) => request('POST', '/api/movimientos/destruccion', data)
};

// ── USUARIOS ──
const Usuarios = {
  getAll: () => request('GET', '/api/usuarios'),
  create: (data) => request('POST', '/api/usuarios', data),
  update: (id, data) => request('PUT', `/api/usuarios/${id}`, data),
  delete: (id) => request('DELETE', `/api/usuarios/${id}`)
};