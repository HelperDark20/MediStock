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
  // stock_seguridad_grupo_id: id del grupo o null (sin stock de seguridad)
  update: (id, tipo, sufijo, stock_seguridad_grupo_id) => request('PUT', `/api/bodegas/${id}`, { tipo, sufijo, stock_seguridad_grupo_id }),
  delete: (id) => request('DELETE', `/api/bodegas/${id}`)
};

// ── UBICACIONES ──
const Ubicaciones = {
  getAll: () => request('GET', '/api/ubicaciones'),
  // Activas + temporales finalizadas (para los filtros de Reportes)
  getHistoricas: () => request('GET', '/api/ubicaciones?incluir_finalizadas=1'),
  create: (nombre) => request('POST', '/api/ubicaciones', { nombre }),
  createTemporal: (nombre, bodega_ids) => request('POST', '/api/ubicaciones', { nombre, es_temporal: true, bodega_ids }),
  depositosPrestables: () => request('GET', '/api/ubicaciones/depositos-prestables'),
  agregarDepositos: (id, bodega_ids) => request('POST', `/api/ubicaciones/${id}/depositos`, { bodega_ids }),
  devolverDeposito: (id, bodegaId) => request('POST', `/api/ubicaciones/${id}/depositos/${bodegaId}/devolver`),
  finalizar: (id) => request('POST', `/api/ubicaciones/${id}/finalizar`),
  update: (id, nombre) => request('PUT', `/api/ubicaciones/${id}`, { nombre }),
  delete: (id) => request('DELETE', `/api/ubicaciones/${id}`)
};

// ── SKUs ──
const SKUs = {
  getGlobales: () => request('GET', '/api/skus/globales'),
  createGlobal: (data) => request('POST', '/api/skus/globales', data),
  updateGlobal: (id, data) => request('PUT', `/api/skus/globales/${id}`, data),
  deleteGlobal: (id) => request('DELETE', `/api/skus/globales/${id}`),
  getSub: () => request('GET', '/api/skus/sub'),
  createSub: (data) => request('POST', '/api/skus/sub', data),
  deleteSub: (id) => request('DELETE', `/api/skus/sub/${id}`),
  historialSub: (params = {}) => request('GET', `/api/skus/sub/historial?${new URLSearchParams(params)}`),
  cambiosSub: (id) => request('GET', `/api/skus/sub/${id}/cambios`),
  // Devuelve { status, data } sin lanzar en 409: el servidor pide confirmar
  // cuando el cambio de proveedor/lote reemplaza o une el Sub-SKU
  updateSub: async (id, data) => {
    const res = await fetch(`${API_URL}/api/skus/sub/${id}`, { method:'PUT', headers: authHeaders(), body: JSON.stringify(data) });
    const json = await res.json();
    if(!res.ok && res.status !== 409) throw new Error(json.error || 'Error del servidor');
    return { status: res.status, data: json };
  },
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
  destruccion: (data) => request('POST', '/api/movimientos/destruccion', data),
  contingencia: (data) => request('POST', '/api/movimientos/contingencia', data),
  revertir: (id) => request('POST', `/api/movimientos/${id}/revertir`),
  getReporte: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request('GET', `/api/movimientos/reportes${query ? '?' + query : ''}`);
  },
  // Igual que getReporte, pero avisa si el servidor recortó el resultado
  // (tope de filas): { filas, truncado }. Lo usa el Excel del historial.
  getReporteCompleto: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_URL}/api/movimientos/reportes${query ? '?' + query : ''}`, { headers: authHeaders() });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Error del servidor');
    return { filas: data, truncado: res.headers.get('X-Reporte-Truncado') };
  }
};

// ── USUARIOS ──
const Usuarios = {
  getAll: () => request('GET', '/api/usuarios'),
  create: (data) => request('POST', '/api/usuarios', data),
  update: (id, data) => request('PUT', `/api/usuarios/${id}`, data),
  delete: (id) => request('DELETE', `/api/usuarios/${id}`)
};

// ── STOCK SEGURIDAD ──
const StockSeguridad = {
  getAll: () => request('GET', '/api/stock-seguridad'),
  createGrupo: (data) => request('POST', '/api/stock-seguridad/grupos', data),
  updateGrupo: (id, data) => request('PUT', `/api/stock-seguridad/grupos/${id}`, data),
  deleteGrupo: (id) => request('DELETE', `/api/stock-seguridad/grupos/${id}`),
  addItem: (data) => request('POST', '/api/stock-seguridad/items', data),
  updateItem: (id, data) => request('PUT', `/api/stock-seguridad/items/${id}`, data),
  deleteItem: (id) => request('DELETE', `/api/stock-seguridad/items/${id}`)
};

// ── EVENTOS ──
const Eventos = {
  getAll: () => request('GET', '/api/eventos'),
  getOne: (id) => request('GET', `/api/eventos/${id}`),
  getActivo: () => request('GET', '/api/eventos/activo'),
  getActivos: () => request('GET', '/api/eventos/activos'),
  create: (data) => request('POST', '/api/eventos', data),
  update: (id, data) => request('PUT', `/api/eventos/${id}`, data),
  addEnfermero: (id, data) => request('POST', `/api/eventos/${id}/enfermeros`, data),
  updateEnfermero: (id, usuarioId, data) => request('PUT', `/api/eventos/${id}/enfermeros/${usuarioId}`, data),
  removeEnfermero: (id, usuarioId) => request('DELETE', `/api/eventos/${id}/enfermeros/${usuarioId}`),
  iniciar: (id) => request('POST', `/api/eventos/${id}/iniciar`),
  finalizar: (id) => request('POST', `/api/eventos/${id}/finalizar`),
  delete: (id) => request('DELETE', `/api/eventos/${id}`)
};