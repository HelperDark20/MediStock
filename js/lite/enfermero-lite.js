/* ══════════════════════════════════════════
   PANEL ENFERMERO COMPATIBLE — enfermero.html

   Funciona en navegadores antiguos (Safari de iOS 9 en adelante), por eso
   este archivo está escrito en JavaScript ES5 a propósito:
     - var y function (sin let/const ni funciones flecha)
     - sin template literals, ?. ni ??
     - XMLHttpRequest en lugar de fetch
     - sin Array.find / includes, Object.entries ni Intl con zona horaria
   No lo conviertas a sintaxis moderna: las tablets con iOS 9 dejarían de
   funcionar. scripts/check-lite.js valida la sintaxis ES5.

   Mismo flujo que el panel enfermero de la app (js/enfermero.js):
   login → evento en curso (elegir si hay varios) → bodega → producto →
   cantidad y cédula → POST /api/movimientos/consumo.
   ══════════════════════════════════════════ */
(function(){
  'use strict';

  var TOKEN_KEY = 'nb_token';   // el mismo de la app principal
  var COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;  // UTC-5, Colombia no tiene horario de verano
  var MAX_RESULTADOS = 40;

  var st = {
    usuario: null,
    eventos: [],
    evento: null,
    stock: [],          // filas de /api/skus/stock de las bodegas del evento
    bodega: null,       // { id, nombre }
    item: null,         // fila de stock seleccionada
    historial: []
  };

  // ── Utilidades ──
  function $(id){ return document.getElementById(id); }

  function on(el, ev, fn){ el.addEventListener(ev, fn, false); }

  function mostrar(id, visible){
    if(visible) $(id).classList.add('on');
    else $(id).classList.remove('on');
  }

  function escHtml(s){
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function soloDigitos(s){ return String(s || '').replace(/\D/g, ''); }

  // localStorage/sessionStorage lanzan error en modo privado de Safari antiguo
  function guardar(storage, k, v){
    try { if(v === null) window[storage].removeItem(k); else window[storage].setItem(k, v); } catch(e){}
  }
  function leer(storage, k){
    try { return window[storage].getItem(k); } catch(e){ return null; }
  }

  function buscarPor(lista, campo, valor){
    for(var i = 0; i < lista.length; i++){ if(lista[i][campo] === valor) return lista[i]; }
    return null;
  }

  // ── Fechas en hora de Colombia (sin Intl, que iOS 9 no soporta) ──
  function fechaCO(fecha){
    var t = fecha ? new Date(fecha).getTime() : new Date().getTime();
    return new Date(t - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10);
  }

  function horaCO(fecha){
    var d = new Date(new Date(fecha).getTime() - COLOMBIA_OFFSET_MS);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    var sufijo = h < 12 ? 'a. m.' : 'p. m.';
    h = h % 12; if(h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + sufijo;
  }

  function fmtFecha(iso){
    if(!iso) return '—';
    var p = String(iso).split('T')[0].split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function diasEntre(isoDesde, isoHasta){
    var a = isoDesde.split('-'), b = isoHasta.split('-');
    var ta = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var tb = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((tb - ta) / 864e5);
  }

  // Mismos umbrales que getSem() en js/helpers.js
  function semaforo(caducidad){
    if(!caducidad) return 'V';
    var diff = diasEntre(fechaCO(), String(caducidad).split('T')[0]);
    if(diff < 0) return 'N';
    if(diff < 30) return 'P';
    if(diff <= 90) return 'R';
    if(diff <= 180) return 'A';
    return 'V';
  }
  var SEM_TXT = { V:'Vigente', A:'Alerta', R:'Crítico', P:'Por vencer', N:'Vencido' };

  function semHtml(caducidad){
    var s = semaforo(caducidad);
    return '<span class="lt-sem ' + s + '">' + SEM_TXT[s] + '</span>';
  }

  // ── Aviso flotante ──
  var _toastTimer = null;
  function toast(msg, tipo){
    var el = $('lt-toast');
    el.textContent = msg;
    el.className = 'lt-toast on' + (tipo ? ' ' + tipo : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function(){ el.className = 'lt-toast'; }, tipo === 'error' ? 4500 : 2600);
  }

  function errorEn(id, msg){
    var el = $(id);
    el.textContent = msg || '';
    mostrar(id, !!msg);
  }

  // ── API ──
  function api(metodo, ruta, cuerpo, cb){
    var x = new XMLHttpRequest();
    x.open(metodo, ruta, true);
    x.setRequestHeader('Content-Type', 'application/json');
    var token = leer('localStorage', TOKEN_KEY);
    if(token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.timeout = 25000;
    x.onreadystatechange = function(){
      if(x.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(x.responseText); } catch(e){}
      if(x.status >= 200 && x.status < 300){ cb(null, data); return; }
      var msg;
      if(x.status === 0) msg = 'Sin conexión con el servidor. Revisa la red e intenta de nuevo.';
      else if(x.status === 429) msg = 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.';
      else msg = (data && data.error) || ('Error del servidor (' + x.status + ')');
      var err = new Error(msg);
      err.status = x.status;
      cb(err);
    };
    x.ontimeout = function(){ /* onreadystatechange llega con status 0 */ };
    x.send(cuerpo ? JSON.stringify(cuerpo) : null);
  }

  // Para llamadas autenticadas: si la sesión venció, vuelve al login
  function apiSesion(metodo, ruta, cuerpo, cb){
    api(metodo, ruta, cuerpo, function(err, data){
      if(err && (err.status === 401 || err.status === 403) && ruta.indexOf('/api/movimientos/consumo') !== 0){
        cerrarSesion('Tu sesión venció. Ingresa de nuevo.');
        return;
      }
      cb(err, data);
    });
  }

  // ── Pantallas ──
  function pantallaLogin(msg){
    mostrar('lt-app', false);
    mostrar('lt-login', true);
    errorEn('lt-login-error', msg || '');
    $('lt-pass').value = '';
  }

  function estado(html){
    $('lt-state').innerHTML = html || '';
    mostrar('lt-state', !!html);
    if(html){ mostrar('lt-elegir', false); mostrar('lt-panel', false); }
  }

  function claveEvento(){ return 'nb_evento_' + (st.usuario ? st.usuario.id : ''); }

  function cerrarSesion(msg){
    guardar('localStorage', TOKEN_KEY, null);
    guardar('sessionStorage', claveEvento(), null);
    st.usuario = null; st.evento = null; st.item = null;
    pantallaLogin(msg);
  }

  // ── Inicio de sesión ──
  function iniciar(usuario){
    if(Number(usuario.nivel) !== 2){
      guardar('localStorage', TOKEN_KEY, null);
      pantallaLogin('En este dispositivo solo está disponible el registro de consumos para enfermeros. Usa un computador o una tablet actualizada para los demás módulos.');
      return;
    }
    st.usuario = usuario;
    $('lt-nombre').textContent = usuario.nombre || 'Enfermero/a';
    $('lt-avatar').textContent = String(usuario.nombre || 'EN').split(' ')
      .slice(0, 2).map(function(w){ return w.charAt(0); }).join('').toUpperCase();
    mostrar('lt-login', false);
    mostrar('lt-app', true);
    cargarEventos();
  }

  function enviarLogin(e){
    e.preventDefault();
    var cedula = soloDigitos($('lt-cedula').value);
    var pass = $('lt-pass').value;
    if(!cedula || !pass){ errorEn('lt-login-error', 'Ingresa tu cédula y contraseña'); return; }
    errorEn('lt-login-error', '');
    var btn = $('lt-login-btn');
    btn.disabled = true; btn.textContent = 'Ingresando…';
    api('POST', '/api/auth/login', { cedula: cedula, password: pass }, function(err, data){
      btn.disabled = false; btn.textContent = 'Ingresar';
      if(err){ errorEn('lt-login-error', err.message); return; }
      guardar('localStorage', TOKEN_KEY, data.token);
      iniciar(data.usuario);
    });
  }

  // ── Eventos en curso ──
  function cargarEventos(){
    estado('Cargando tus eventos…');
    apiSesion('GET', '/api/eventos/activos', null, function(err, eventos){
      if(err){ estado(escHtml(err.message) + '<button class="lt-btn" type="button" data-accion="reintentar">Reintentar</button>'); return; }
      st.eventos = eventos || [];
      if(!st.eventos.length){
        estado('No tienes un evento activo asignado.<br>Contacta al administrador para que te asigne a un evento.' +
          '<button class="lt-btn" type="button" data-accion="reintentar">Volver a consultar</button>');
        return;
      }
      if(st.eventos.length === 1){ aplicarEvento(st.eventos[0]); return; }
      var elegido = buscarPor(st.eventos, 'id', parseInt(leer('sessionStorage', claveEvento()), 10));
      if(elegido) aplicarEvento(elegido);
      else mostrarEleccion();
    });
  }

  function mostrarEleccion(){
    estado('');
    mostrar('lt-panel', false);
    var actual = st.evento ? st.evento.id : null;
    var html = '';
    for(var i = 0; i < st.eventos.length; i++){
      var e = st.eventos[i];
      var deps = [];
      for(var j = 0; j < (e.bodegas || []).length; j++) deps.push(escHtml(e.bodegas[j].nombre));
      html += '<button type="button" class="lt-evt' + (e.id === actual ? ' actual' : '') + '" data-evento="' + e.id + '">' +
        '<span class="lt-evt-name">' + escHtml(e.nombre) + (e.id === actual ? ' (actual)' : '') + '</span>' +
        '<span class="lt-evt-meta">' + escHtml(e.ubicacion_nombre || '—') + ' · ' + (deps.length ? deps.join(', ') : 'Sin depósitos asignados') + '</span>' +
        '</button>';
    }
    $('lt-eventos-lista').innerHTML = html;
    mostrar('lt-elegir', true);
  }

  function aplicarEvento(evento){
    st.evento = evento;
    guardar('sessionStorage', claveEvento(), String(evento.id));
    mostrar('lt-elegir', false);
    $('lt-evento-txt').innerHTML = 'Evento activo: <strong>' + escHtml(evento.nombre) + '</strong> · ' + escHtml(evento.ubicacion_nombre || '');
    $('lt-cambiar-evento').style.display = st.eventos.length > 1 ? '' : 'none';

    var bodegas = evento.bodegas || [];
    var opciones = '<option value="">Seleccionar bodega…</option>';
    for(var i = 0; i < bodegas.length; i++){
      opciones += '<option value="' + bodegas[i].id + '">' + escHtml(bodegas[i].nombre) + '</option>';
    }
    $('lt-bodega').innerHTML = opciones;
    st.bodega = null;
    if(bodegas.length === 1){ $('lt-bodega').value = String(bodegas[0].id); st.bodega = bodegas[0]; }
    quitarItem();
    cargarStock();
    cargarHistorial();
  }

  // ── Stock de las bodegas del evento ──
  function cargarStock(){
    estado('Cargando inventario…');
    apiSesion('GET', '/api/skus/stock', null, function(err, filas){
      if(err){ estado(escHtml(err.message) + '<button class="lt-btn" type="button" data-accion="stock">Reintentar</button>'); return; }
      var nombres = {};
      var bodegas = st.evento.bodegas || [];
      for(var i = 0; i < bodegas.length; i++) nombres[bodegas[i].nombre] = true;
      st.stock = [];
      for(var j = 0; j < (filas || []).length; j++){
        var f = filas[j];
        if(f.sub_sku_id && f.bodega_nombre && nombres[f.bodega_nombre]){
          f.cantidad = Number(f.cantidad) || 0;
          st.stock.push(f);
        }
      }
      estado('');
      mostrar('lt-panel', true);
      if(!bodegas.length){
        estado('Este evento no tiene bodegas asignadas para ti.<br>Contacta al administrador.');
        return;
      }
      actualizarPaso2();
    });
  }

  function actualizarPaso2(){
    if(st.bodega) $('lt-paso2').classList.remove('bloqueado'); else $('lt-paso2').classList.add('bloqueado');
    $('lt-buscar').disabled = !st.bodega;
    renderResultados();
  }

  function cambiarBodega(){
    var id = parseInt($('lt-bodega').value, 10);
    st.bodega = id ? buscarPor(st.evento.bodegas || [], 'id', id) : null;
    quitarItem();
    actualizarPaso2();
    if(st.bodega) $('lt-buscar').focus();
  }

  // ── Búsqueda de productos ──
  function renderResultados(){
    var cont = $('lt-resultados');
    if(!st.bodega){ cont.innerHTML = ''; return; }
    var q = String($('lt-buscar').value || '').toLowerCase().replace(/^\s+|\s+$/g, '');
    // Sin texto no se lista todo (en la tablet vertical empujaba el formulario
    // de consumo fuera de la pantalla): solo se informa cuántos hay
    if(!q){
      var total = 0;
      for(var k = 0; k < st.stock.length; k++){
        if(st.stock[k].bodega_nombre === st.bodega.nombre && st.stock[k].cantidad > 0) total++;
      }
      cont.innerHTML = '<div class="lt-vacio">' + (total
        ? total + ' producto' + (total !== 1 ? 's' : '') + ' con stock en esta bodega. Escribe para buscar.'
        : 'No hay productos con stock en esta bodega') + '</div>';
      return;
    }
    var res = [];
    for(var i = 0; i < st.stock.length && res.length < MAX_RESULTADOS; i++){
      var f = st.stock[i];
      if(f.bodega_nombre !== st.bodega.nombre || f.cantidad <= 0) continue;
      var texto = [f.nombre, f.sku_global, f.sub_sku, f.lote, f.proveedor].join(' ').toLowerCase();
      if(texto.indexOf(q) === -1) continue;
      res.push(f);
    }
    if(!res.length){ cont.innerHTML = '<div class="lt-vacio">Sin resultados para "' + escHtml(q) + '"</div>'; return; }
    var html = '';
    for(var j = 0; j < res.length; j++){
      var r = res[j];
      html += '<button type="button" class="lt-res" data-idx="' + st.stock.indexOf(r) + '">' +
        '<span class="lt-res-cant">' + r.cantidad + ' ' + escHtml(r.unidad || '') + '</span>' +
        '<span class="lt-res-name">' + escHtml(r.nombre) + '</span>' +
        '<span class="lt-res-meta">' + escHtml(r.sku_global || '') + ' · ' + escHtml(r.sub_sku || '') +
        (r.lote ? ' · Lote ' + escHtml(r.lote) : '') + ' · Vence ' + fmtFecha(r.caducidad) + semHtml(r.caducidad) + '</span>' +
        '</button>';
    }
    cont.innerHTML = html;
  }

  function elegirItem(idx){
    st.item = st.stock[idx];
    if(!st.item) return;
    $('lt-item-nombre').textContent = st.item.nombre;
    $('lt-item-sub').textContent = (st.item.sku_global || '') + ' · ' + (st.item.sub_sku || '') +
      (st.item.lote ? ' · Lote ' + st.item.lote : '') + ' · Vence ' + fmtFecha(st.item.caducidad);
    $('lt-item-stock').innerHTML = 'Disponible en ' + escHtml(st.bodega.nombre) + ': <strong>' + st.item.cantidad + '</strong> ' +
      escHtml(st.item.unidad || '') + semHtml(st.item.caducidad);
    mostrar('lt-item', true);
    $('lt-paso2').style.display = 'none';
    $('lt-cantidad').focus();
  }

  function quitarItem(){
    st.item = null;
    mostrar('lt-item', false);
    $('lt-paso2').style.display = '';
    $('lt-buscar').value = '';
    errorEn('lt-consumo-error', '');
    renderResultados();
  }

  // ── Registrar consumo ──
  function registrar(){
    errorEn('lt-consumo-error', '');
    if(!st.bodega){ errorEn('lt-consumo-error', 'Selecciona una bodega primero'); return; }
    if(!st.item){ errorEn('lt-consumo-error', 'Selecciona un medicamento o insumo'); return; }
    var cant = parseInt(soloDigitos($('lt-cantidad').value), 10) || 0;
    if(cant <= 0){ errorEn('lt-consumo-error', 'Ingresa una cantidad válida'); return; }
    if(cant > st.item.cantidad){ errorEn('lt-consumo-error', 'Solo hay ' + st.item.cantidad + ' ' + (st.item.unidad || '') + ' disponibles en esta bodega'); return; }
    var paciente = soloDigitos($('lt-paciente').value);

    var btn = $('lt-registrar');
    btn.disabled = true; btn.textContent = 'Registrando…';
    var item = st.item;
    apiSesion('POST', '/api/movimientos/consumo', {
      sub_sku_id: item.sub_sku_id,
      bodega_origen_id: st.bodega.id,
      cantidad: cant,
      cedula_paciente: paciente || null
    }, function(err){
      btn.disabled = false; btn.textContent = 'Registrar consumo';
      if(err){
        if(err.status === 401 || err.status === 403){
          errorEn('lt-consumo-error', 'Tu sesión venció y el consumo NO se registró. Sal, vuelve a ingresar y regístralo de nuevo.');
        } else {
          errorEn('lt-consumo-error', err.message + ' — el consumo NO se registró.');
        }
        return;
      }
      item.cantidad -= cant;
      st.historial.unshift({
        tipo: 'consumo', nombre: item.nombre, cantidad: cant, unidad: item.unidad,
        origen_nombre: st.bodega.nombre, cedula_paciente: paciente || null,
        created_at: new Date().toISOString()
      });
      renderHistorial();
      $('lt-cantidad').value = '';
      $('lt-paciente').value = '';
      quitarItem();
      toast('✓ Consumo registrado', 'ok');
    });
  }

  // ── Historial de hoy ──
  function cargarHistorial(){
    apiSesion('GET', '/api/movimientos?mios=1&limit=300', null, function(err, movs){
      if(err){ $('lt-historial').innerHTML = '<div class="lt-vacio">No se pudo cargar el historial</div>'; return; }
      var hoy = fechaCO();
      st.historial = [];
      for(var i = 0; i < (movs || []).length; i++){
        var m = movs[i];
        if(m.tipo === 'consumo' && m.created_at && fechaCO(m.created_at) === hoy) st.historial.push(m);
      }
      renderHistorial();
    });
  }

  function renderHistorial(){
    var cont = $('lt-historial');
    if(!st.historial.length){ cont.innerHTML = '<div class="lt-vacio">Sin consumos registrados hoy</div>'; return; }
    var html = '';
    for(var i = 0; i < st.historial.length; i++){
      var m = st.historial[i];
      html += '<div class="lt-hist">' +
        '<span class="lt-hist-cant">' + m.cantidad + ' ' + escHtml(m.unidad || '') + '</span>' +
        '<div class="lt-hist-name">' + escHtml(m.nombre || m.sku_global_codigo || '—') + '</div>' +
        '<div class="lt-hist-meta">' + escHtml(m.origen_nombre || '—') + ' · ' + horaCO(m.created_at) +
        (m.cedula_paciente ? ' · Pac: ' + escHtml(m.cedula_paciente) : '') + '</div>' +
        '</div>';
    }
    cont.innerHTML = html;
  }

  // ── Eventos de la interfaz ──
  function closestData(el, attr){
    while(el && el !== document.body){
      if(el.getAttribute && el.getAttribute(attr) !== null) return el;
      el = el.parentNode;
    }
    return null;
  }

  function conectar(){
    on($('lt-login-form'), 'submit', enviarLogin);
    on($('lt-logout'), 'click', function(){ cerrarSesion(''); });
    on($('lt-bodega'), 'change', cambiarBodega);
    on($('lt-buscar'), 'input', renderResultados);
    on($('lt-item-quitar'), 'click', quitarItem);
    on($('lt-registrar'), 'click', registrar);
    on($('lt-cambiar-evento'), 'click', mostrarEleccion);
    on($('lt-actualizar'), 'click', function(){ cargarEventos(); });

    on($('lt-resultados'), 'click', function(e){
      var b = closestData(e.target, 'data-idx');
      if(b) elegirItem(parseInt(b.getAttribute('data-idx'), 10));
    });
    on($('lt-eventos-lista'), 'click', function(e){
      var b = closestData(e.target, 'data-evento');
      if(!b) return;
      var ev = buscarPor(st.eventos, 'id', parseInt(b.getAttribute('data-evento'), 10));
      if(ev){ aplicarEvento(ev); toast('Trabajando en: ' + ev.nombre, 'ok'); }
    });
    on($('lt-state'), 'click', function(e){
      var b = closestData(e.target, 'data-accion');
      if(!b) return;
      var accion = b.getAttribute('data-accion');
      if(accion === 'recargar') location.reload();
      else if(accion === 'stock') cargarStock();
      else cargarEventos();
    });
  }

  // ── Arranque: si ya hay sesión, se valida con el servidor ──
  function arrancar(){
    conectar();
    if(!leer('localStorage', TOKEN_KEY)){ pantallaLogin(''); return; }
    mostrar('lt-app', true);
    estado('Verificando sesión…');
    api('GET', '/api/auth/me', null, function(err, data){
      if(err){
        if(err.status === 0){ estado('Sin conexión con el servidor.<button class="lt-btn" type="button" data-accion="recargar">Reintentar</button>'); return; }
        guardar('localStorage', TOKEN_KEY, null);
        pantallaLogin('');
        return;
      }
      iniciar(data.usuario);
    });
  }

  arrancar();
})();
