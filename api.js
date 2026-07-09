const API_URL = window.location.origin;

// ── TOKEN ──
function getToken(){ return localStorage.getItem('nb_token'); }
function setToken(t){ localStorage.setItem('nb_token', t); }
function removeToken(){ localStorage.removeItem('nb_token'); }

// ── HEADERS ──
function authHeaders(){
  const token = localStorage.getItem('nb_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// ── REQUEST BASE ──
async function request(method, path, body = null){
  const token = localStorage.getItem('nb_token');
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
  entradaCompleta: (data) => request('POST', '/api/movimientos/entrada-completa', data),
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

// ── EVENTOS ──
const Eventos = {
  getAll: () => request('GET', '/api/eventos'),
  getOne: (id) => request('GET', `/api/eventos/${id}`),
  getActivo: () => request('GET', '/api/eventos/activo'),
  create: (data) => request('POST', '/api/eventos', data),
  update: (id, data) => request('PUT', `/api/eventos/${id}`, data),
  addEnfermero: (id, data) => request('POST', `/api/eventos/${id}/enfermeros`, data),
  updateEnfermero: (id, usuarioId, data) => request('PUT', `/api/eventos/${id}/enfermeros/${usuarioId}`, data),
  removeEnfermero: (id, usuarioId) => request('DELETE', `/api/eventos/${id}/enfermeros/${usuarioId}`),
  iniciar: (id) => request('POST', `/api/eventos/${id}/iniciar`),
  finalizar: (id) => request('POST', `/api/eventos/${id}/finalizar`),
  delete: (id) => request('DELETE', `/api/eventos/${id}`)
};