// ══════════════════════════════════════════
// EDITAR HISTORIAS CLÍNICAS (hc-editor.html) — solo administrador
// Listado de todas las HC con filtros y el editor de la tablet
// (js/lite/hc-lite.js) en modo administrador. Este archivo le da al editor
// las mismas utilidades que le da el panel de enfermero, pero contra el
// servidor: los consumos que se agregan o quitan pasan al inventario en el
// momento (POST /api/hc/:id/consumos) y "Guardar cambios" hace PUT /api/hc/:id
// con el motivo.
// ══════════════════════════════════════════
(function(){
  'use strict';
  const TOKEN_KEY = 'nb_token';
  const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;
  const st = { usuario: null, offline: false, eventos: [], evento: null, stock: [] };
  let filtros = {}, pagina = 1;

  const $ = id => document.getElementById(id);
  const on = (el, ev, fn) => el.addEventListener(ev, fn, false);
  const mostrar = (id, v) => $(id).classList[v ? 'add' : 'remove']('on');
  const escHtml = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const leerToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch(e){ return null; } };

  function fechaCO(f){ const t = f ? new Date(f).getTime() : Date.now(); return new Date(t - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10); }
  function horaCO(f){
    const d = new Date(new Date(f).getTime() - COLOMBIA_OFFSET_MS);
    let h = d.getUTCHours(); const m = d.getUTCMinutes(), suf = h < 12 ? 'a. m.' : 'p. m.';
    h = h % 12 || 12;
    return `${h}:${m < 10 ? '0' : ''}${m} ${suf}`;
  }
  function fmtFecha(iso){ if(!iso) return '—'; const p = String(iso).split('T')[0].split('-'); return `${p[2]}/${p[1]}/${p[0]}`; }
  const fechaHoraCO = f => `${fmtFecha(fechaCO(f))} ${horaCO(f)}`;
  function semHtml(cad){
    if(!cad) return '';
    const dias = Math.round((Date.parse(String(cad).split('T')[0]) - Date.parse(fechaCO())) / 864e5);
    const s = dias < 0 ? 'N' : dias < 30 ? 'P' : dias <= 90 ? 'R' : dias <= 180 ? 'A' : 'V';
    return `<span class="lt-sem ${s}">${{ V:'Vigente', A:'Alerta', R:'Crítico', P:'Por vencer', N:'Vencido' }[s]}</span>`;
  }

  // Misma firma que la del panel de enfermero: cb(err, data)
  function api(metodo, ruta, cuerpo, cb){
    fetch(ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + leerToken() },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    }).then(async r => {
      const data = await r.json().catch(() => null);
      if(r.ok){ cb(null, data); return; }
      const err = new Error((data && data.error) || `Error del servidor (${r.status})`);
      err.status = r.status; err.data = data;
      cb(err);
    }).catch(() => { const err = new Error('Sin conexión con el servidor. Revisa la red e intenta de nuevo.'); err.status = 0; err.sinRed = true; cb(err); });
  }
  const apiP = (m, r, c) => new Promise((ok, mal) => api(m, r, c, (e, d) => e ? mal(e) : ok(d)));

  let _modalAcciones = [];
  function modal(titulo, html, botones){
    $('lt-modal-titulo').textContent = titulo;
    $('lt-modal-cuerpo').innerHTML = html;
    _modalAcciones = botones;
    $('lt-modal-botones').innerHTML = botones.map((b, i) => `<button type="button" class="lt-btn-sec ${b.clase || ''}" data-boton="${i}">${escHtml(b.texto)}</button>`).join('');
    mostrar('lt-modal', true);
  }
  let _toastT = null;
  function toast(msg, tipo){
    const el = $('lt-toast');
    el.textContent = msg;
    el.className = 'lt-toast on' + (tipo ? ' ' + tipo : '');
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { el.className = 'lt-toast'; }, tipo === 'error' ? 4500 : 2600);
  }
  function closestData(el, attr){
    while(el && el !== document.body){ if(el.getAttribute && el.getAttribute(attr) !== null) return el; el = el.parentNode; }
    return null;
  }
  function nuevoClientId(){
    const r = () => Math.floor((1 + Math.random()) * 0x100000000).toString(36).slice(1, 9);
    return 'a' + Date.now().toString(36) + r() + r();
  }
  function estado(html){ $('lt-state').innerHTML = html || ''; mostrar('lt-state', !!html); }

  // ── Consumos del editor: directo al servidor ──
  function registrarConsumoHC(c, cb){
    api('POST', `/api/hc/${c.hc_id}/consumos`, {
      client_id: c.client_id, sub_sku_id: c.sub_sku_id, bodega_origen_id: c.bodega_origen_id, cantidad: c.cantidad,
      dosis: c.dosis, via: c.via, via_otra: c.via_otra, hora: c.hora
    }, err => {
      if(err){ cb({ error: err.message + ' — el consumo NO se registró.' }); return; }
      descontarLocal(c);
      cb({ ok: true });
    });
  }
  function descontarLocal(c){
    const f = st.stock.find(x => x.sub_sku_id === c.sub_sku_id && x.bodega_nombre === c.bodega_nombre);
    if(f) f.cantidad -= c.cantidad;
  }
  function devolverLocal(c){
    const f = st.stock.find(x => x.sub_sku_id === c.sub_sku_id && x.bodega_nombre === c.bodega_nombre);
    if(f) f.cantidad += c.cantidad;
  }

  // ── Listado ──
  async function cargarFiltros(){
    const [eventos, ubicaciones] = await Promise.all([
      apiP('GET', '/api/eventos').catch(() => []),
      apiP('GET', '/api/ubicaciones?incluir_finalizadas=1').catch(() => [])
    ]);
    $('hce-evento').innerHTML = '<option value="">Todos</option>' + eventos.map(e => `<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('');
    $('hce-ubicacion').innerHTML = '<option value="">Todas</option>' + ubicaciones.map(u => `<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  }

  async function buscar(p){
    pagina = p || 1;
    filtros = {
      desde: $('hce-desde').value, hasta: $('hce-hasta').value, documento: $('hce-documento').value.trim(),
      evento_id: $('hce-evento').value, ubicacion_id: $('hce-ubicacion').value, estado: $('hce-estado').value, pagina
    };
    const qs = Object.keys(filtros).filter(k => filtros[k]).map(k => `${k}=${encodeURIComponent(filtros[k])}`).join('&');
    $('hce-lista').innerHTML = '<div class="lt-vacio">Cargando…</div>';
    try {
      const r = await apiP('GET', '/api/hc?' + qs);
      $('hce-resumen').textContent = `${r.total} historia${r.total !== 1 ? 's' : ''} clínica${r.total !== 1 ? 's' : ''}`;
      $('hce-lista').innerHTML = r.filas.length ? r.filas.map(f => `
        <div class="lt-hc-item">
          <div class="lt-hc-item-txt">
            <div class="lt-hc-item-nombre">${escHtml(f.paciente_nombre || '—')}
              <span class="lt-pend ${f.estado === 'abierta' ? '' : 'borrador'}">${f.estado === 'abierta' ? 'Abierta · falta entrega' : 'Cerrada'}</span>
              ${f.firma_medica_pendiente ? '<span class="lt-pend error">Firma médica pendiente</span>' : ''}</div>
            <div class="lt-hc-item-meta"><strong>${escHtml(f.consecutivo)}</strong> · ${f.paciente_tipo_doc ? escHtml(f.paciente_tipo_doc + ' ' + (f.paciente_documento || '')) + ' · ' : ''}${fechaHoraCO(f.inicio_atencion)}</div>
            <div class="lt-hc-item-meta">${escHtml(f.evento_nombre || '—')}${f.lugar ? ' · ' + escHtml(f.lugar) : ''} · Diligenció ${escHtml(f.enfermero_nombre || '—')}</div>
          </div>
          <div class="lt-hc-item-btns"><button type="button" class="lt-btn-sec primario" data-editar="${f.id}">Editar</button></div>
        </div>`).join('') : '<div class="lt-vacio">No hay historias clínicas con esos filtros</div>';
      const paginas = Math.ceil(r.total / r.por_pagina);
      $('hce-paginas').innerHTML = paginas > 1
        ? `<button type="button" class="lt-btn-sec" data-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
           <span>Página ${pagina} de ${paginas}</span>
           <button type="button" class="lt-btn-sec" data-pagina="${pagina + 1}" ${pagina >= paginas ? 'disabled' : ''}>Siguiente ›</button>` : '';
    } catch(err){
      $('hce-lista').innerHTML = `<div class="lt-hist-error">${escHtml(err.message)}</div>`;
    }
  }

  async function abrir(id){
    estado('Abriendo la historia clínica…');
    try {
      const [h, stock] = await Promise.all([apiP('GET', `/api/hc/${id}/editor`), apiP('GET', '/api/skus/stock')]);
      st.stock = stock;
      estado('');
      mostrar('lt-hc-inicio', false);
      HCLite.abrirAdmin(h);
    } catch(err){
      estado('');
      modal('No se pudo abrir', escHtml(err.message), [{ texto: 'Entendido', clase: 'primario' }]);
    }
  }

  function volverALista(){
    mostrar('lt-hc-editor', false);
    mostrar('lt-hc-inicio', true);
    buscar(pagina);
    window.scrollTo(0, 0);
  }

  // ── Arranque ──
  async function arrancar(){
    HCLite.conectar({
      $, on, mostrar, escHtml, api, sesionVencida: e => e && (e.status === 401 || e.status === 403),
      modal, toast, leerJSON: () => null, guardarJSON: () => true, claveUsuario: n => 'hce_' + n,
      nuevoClientId, fechaCO, horaCO, fmtFecha, closestData, renderModo: () => {}, estado: st,
      registrarConsumoHC, consumoEnCola: () => null, quitarConsumoDeCola: () => false, devolverLocal,
      sincronizar: () => {}, fechaHoraCO, semHtml,
      guardarAdmin: (id, datos, motivo, cb) => api('PUT', `/api/hc/${id}`, { datos, motivo }, cb),
      alGuardarAdmin: id => abrir(id),
      alCerrarAdmin: volverALista
    });
    on($('lt-modal-botones'), 'click', e => {
      const b = closestData(e.target, 'data-boton');
      if(!b) return;
      const boton = _modalAcciones[parseInt(b.getAttribute('data-boton'), 10)];
      mostrar('lt-modal', false);
      if(boton && boton.accion) boton.accion();
    });
    on($('hce-buscar'), 'click', () => buscar(1));
    on($('hce-limpiar'), 'click', () => {
      ['hce-desde', 'hce-hasta', 'hce-documento', 'hce-evento', 'hce-ubicacion', 'hce-estado'].forEach(id => { $(id).value = ''; });
      buscar(1);
    });
    on($('hce-documento'), 'keydown', e => { if(e.key === 'Enter') buscar(1); });
    on($('hce-lista'), 'click', e => { const b = closestData(e.target, 'data-editar'); if(b) abrir(b.getAttribute('data-editar')); });
    on($('hce-paginas'), 'click', e => { const b = closestData(e.target, 'data-pagina'); if(b && !b.disabled) buscar(parseInt(b.getAttribute('data-pagina'), 10)); });
    on($('hce-cerrar'), 'click', () => { window.location.href = '/'; });

    if(!leerToken()){ estado('Inicia sesión en el WMS como administrador para editar historias clínicas.<a class="lt-btn" href="/">Ir al WMS</a>'); return; }
    try {
      const me = await apiP('GET', '/api/auth/me');
      st.usuario = me.usuario;
      if(!st.usuario || st.usuario.nivel !== 4){ estado('Solo el administrador puede editar historias clínicas.<a class="lt-btn" href="/">Volver al WMS</a>'); return; }
      $('lt-nombre').textContent = st.usuario.nombre;
      $('lt-avatar').textContent = st.usuario.nombre.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
    } catch(err){
      estado(`${escHtml(err.status === 401 || err.status === 403 ? 'Tu sesión venció: inicia sesión de nuevo en el WMS.' : err.message)}<a class="lt-btn" href="/">Ir al WMS</a>`);
      return;
    }
    mostrar('lt-hc-inicio', true);
    await cargarFiltros();
    // Abrir directo una HC (?hc=ID, desde el detalle en el WMS)
    const id = new URLSearchParams(location.search).get('hc');
    if(id && /^\d+$/.test(id)) abrir(id);
    buscar(1);
  }
  arrancar();
})();
