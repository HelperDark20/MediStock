/* ══════════════════════════════════════════
   PANEL ENFERMERO — enfermero.html  (con modo offline)

   Es el panel de TODOS los enfermeros (la app principal redirige aquí al
   nivel 2) y funciona en navegadores antiguos (Safari de iOS 9 en
   adelante). Por eso este archivo está escrito en JavaScript ES5 a propósito:
     - var y function (sin let/const ni funciones flecha)
     - sin template literals, ?. ni ??
     - XMLHttpRequest en lugar de fetch
     - sin Array.find / includes, Object.entries ni Intl con zona horaria
   No lo conviertas a sintaxis moderna: las tablets con iOS 9 dejarían de
   funcionar. `npm run check:lite` valida la sintaxis ES5.

   Flujo: login → evento en curso (elegir si hay varios; sin evento no se
   puede continuar) → Historias clínicas (js/lite/hc-lite.js): lista + editor
   por módulos. Los consumos ya no se registran por fuera de la HC: el
   formulario de consumo (bodega → producto → cantidad) queda oculto hasta que
   el módulo 6 de la HC lo reutilice.

   MODO OFFLINE (solo consumos):
   - Se activa a mano ("Trabajar offline") o se ofrece cuando un registro
     falla por falta de red.
   - Los consumos se guardan en el dispositivo (localStorage) con un id único
     (client_id) y la hora del dispositivo como hora real de atención.
   - Se suben SOLO con el botón "Sincronizar" (no hay reintentos
     automáticos: en conciertos la red es intermitente y solo los saturaría).
   - POST /api/movimientos/sincronizar es seguro de repetir: los client_id
     ya registrados se ignoran.
   - Al sincronizarse, los consumos (y las cédulas) se borran del dispositivo.

   Datos guardados en el dispositivo (U = id del usuario):
     nb_token            sesión (compartida con la app principal)
     nb_ultimo_usuario   usuario de la última sesión, para abrir sin señal
     nb_paquete_U        eventos + stock de sus bodegas + historial (sin cédulas)
     nb_modo_U           'offline' mientras el modo offline está activo
     nb_cola_U           consumos pendientes de sincronizar
     nb_evento_U         evento elegido cuando tiene varios en curso
     nb_hc_U             historias clínicas en curso / pendientes de envío
     nb_hcenv_U          consecutivos de las HC ya enviadas (sin datos del paciente)
   ══════════════════════════════════════════ */
(function(){
  'use strict';

  var TOKEN_KEY = 'nb_token';   // el mismo de la app principal
  var COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;  // UTC-5, Colombia no tiene horario de verano
  var MAX_RESULTADOS = 40;
  var LOTE_SINCRONIZAR = 50;                  // consumos por envío
  var HORAS_AVISO_PENDIENTES = 12;            // pendientes más viejos que esto → aviso

  var st = {
    usuario: null,
    offline: false,
    eventos: [],
    evento: null,
    stock: [],          // filas de /api/skus/stock de las bodegas de sus eventos
    bodega: null,       // { id, nombre }
    item: null,         // fila de stock seleccionada
    historial: [],      // consumos de hoy ya registrados en el servidor
    preparadoAt: null,  // cuándo se descargaron los datos que usa el modo offline
    sincronizando: false
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

  function buscarPor(lista, campo, valor){
    for(var i = 0; i < lista.length; i++){ if(lista[i][campo] === valor) return lista[i]; }
    return null;
  }

  function plural(n, uno, varios){ return n + ' ' + (n === 1 ? uno : varios); }

  // ── Almacenamiento ──
  // localStorage/sessionStorage lanzan error en modo privado de Safari antiguo
  function guardar(k, v){
    try { if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch(e){ return false; }
  }
  function leer(k){
    try { return localStorage.getItem(k); } catch(e){ return null; }
  }
  function guardarJSON(k, v){ return guardar(k, v === null ? null : JSON.stringify(v)); }
  function leerJSON(k){
    var v = leer(k);
    if(!v) return null;
    try { return JSON.parse(v); } catch(e){ return null; }
  }
  function almacenamientoDisponible(){
    return guardar('nb_prueba', '1') && guardar('nb_prueba', null);
  }

  function claveUsuario(nombre, idUsuario){
    return 'nb_' + nombre + '_' + (idUsuario || (st.usuario ? st.usuario.id : ''));
  }

  function leerCola(idUsuario){ return leerJSON(claveUsuario('cola', idUsuario)) || []; }
  function guardarCola(cola){
    return guardarJSON(claveUsuario('cola'), cola.length ? cola : null) || !cola.length;
  }

  // id único por consumo; el servidor ignora los repetidos
  function nuevoClientId(){
    var r = function(){ return Math.floor((1 + Math.random()) * 0x100000000).toString(36).slice(1, 9); };
    return 'c' + new Date().getTime().toString(36) + r() + r();
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

  function fechaHoraCO(fecha){
    return fmtFecha(fechaCO(fecha)) + ' ' + horaCO(fecha);
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

  // ── Ventana modal ──
  // botones: [{ texto, clase, accion }] — accion se ejecuta tras cerrar
  var _modalAcciones = [];
  function modal(titulo, cuerpoHtml, botones){
    $('lt-modal-titulo').textContent = titulo;
    $('lt-modal-cuerpo').innerHTML = cuerpoHtml;
    _modalAcciones = botones;
    var html = '';
    for(var i = 0; i < botones.length; i++){
      html += '<button type="button" class="lt-btn-sec ' + (botones[i].clase || '') + '" data-boton="' + i + '">' + escHtml(botones[i].texto) + '</button>';
    }
    $('lt-modal-botones').innerHTML = html;
    mostrar('lt-modal', true);
  }
  function cerrarModal(){ mostrar('lt-modal', false); }

  // ── API ──
  function api(metodo, ruta, cuerpo, cb){
    var x = new XMLHttpRequest();
    x.open(metodo, ruta, true);
    x.setRequestHeader('Content-Type', 'application/json');
    var token = leer(TOKEN_KEY);
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
      err.sinRed = x.status === 0;
      cb(err);
    };
    x.ontimeout = function(){ /* onreadystatechange llega con status 0 */ };
    x.send(cuerpo ? JSON.stringify(cuerpo) : null);
  }

  function sesionVencida(err){ return err && (err.status === 401 || err.status === 403); }

  // Para consultas: si la sesión venció, vuelve al login (los consumos
  // pendientes NO se borran: quedan guardados a nombre del usuario)
  function apiSesion(metodo, ruta, cuerpo, cb){
    api(metodo, ruta, cuerpo, function(err, data){
      if(sesionVencida(err)){
        salirSinBorrar(textoSesionVencida());
        return;
      }
      cb(err, data);
    });
  }

  function textoSesionVencida(){
    var n = st.usuario ? leerCola(st.usuario.id).length : 0;
    var h = st.usuario ? HCLite.contar(st.usuario.id) : { total: 0 };
    var partes = [];
    if(n) partes.push(plural(n, 'consumo pendiente', 'consumos pendientes'));
    if(h.total) partes.push(plural(h.total, 'historia clínica', 'historias clínicas'));
    return partes.length
      ? 'Tu sesión venció. Ingresa de nuevo: tus ' + partes.join(' y ') + ' siguen guardados en esta tablet.'
      : 'Tu sesión venció. Ingresa de nuevo.';
  }

  // Lo pendiente de este usuario en la tablet: consumos sin sincronizar e
  // historias clínicas en curso o pendientes de envío
  function pendientesTablet(idUsuario){
    var n = leerCola(idUsuario).length;
    var h = HCLite.contar(idUsuario);
    return { consumos: n, hc: h.total, hcPorEnviar: h.porEnviar, hcEnCurso: h.enCurso, porSubir: n + h.porEnviar };
  }

  // ── Pantallas ──
  function pantallaLogin(msg){
    cerrarModal();
    mostrar('lt-app', false);
    mostrar('lt-login', true);
    errorEn('lt-login-error', msg || '');
    $('lt-pass').value = '';
    avisoPendientesLogin();
  }

  // En el login se avisa si quedaron consumos sin sincronizar en esta tablet
  function avisoPendientesLogin(){
    var u = leerJSON('nb_ultimo_usuario');
    var p = u ? pendientesTablet(u.id) : { consumos: 0, hc: 0 };
    var el = $('lt-login-pendientes');
    var partes = [];
    if(p.consumos) partes.push(plural(p.consumos, 'consumo sin sincronizar', 'consumos sin sincronizar'));
    if(p.hc) partes.push(plural(p.hc, 'historia clínica sin enviar', 'historias clínicas sin enviar'));
    if(partes.length){
      el.innerHTML = 'En esta tablet hay <strong>' + partes.join(' y ') + '</strong> de ' +
        escHtml(u.nombre) + '. Debe ingresar con su usuario para terminarlas y pulsar <strong>Sincronizar</strong>.';
      if(u.cedula && !$('lt-cedula').value) $('lt-cedula').value = u.cedula;
    }
    mostrar('lt-login-pendientes', !!partes.length);
  }

  function estado(html){
    $('lt-state').innerHTML = html || '';
    mostrar('lt-state', !!html);
    if(html){ mostrar('lt-elegir', false); mostrar('lt-panel', false); }
  }

  // Cierra la sesión pero conserva en la tablet los consumos pendientes
  function salirSinBorrar(msg){
    guardar(TOKEN_KEY, null);
    st.item = null;
    pantallaLogin(msg);
  }

  function cerrarSesion(){
    var id = st.usuario ? st.usuario.id : null;
    HCLite.salir();
    var p = id ? pendientesTablet(id) : null;
    if(id && !p.consumos && !p.hc){
      // Sin pendientes: no queda nada de este usuario en la tablet
      guardar(claveUsuario('paquete', id), null);
      guardar(claveUsuario('modo', id), null);
      guardar(claveUsuario('evento', id), null);
    }
    st.usuario = null; st.evento = null; st.offline = false;
    salirSinBorrar('');
  }

  // Q4 del cliente: no compartir la tablet con consumos sin sincronizar
  function pedirSalir(){
    var p = pendientesTablet(st.usuario.id);
    if(!p.consumos && !p.hc){ cerrarSesion(); return; }
    var partes = [];
    if(p.consumos) partes.push(plural(p.consumos, 'consumo pendiente', 'consumos pendientes'));
    if(p.hcEnCurso) partes.push(plural(p.hcEnCurso, 'historia clínica en curso', 'historias clínicas en curso'));
    if(p.hcPorEnviar) partes.push(plural(p.hcPorEnviar, 'historia clínica pendiente de envío', 'historias clínicas pendientes de envío'));
    var botones = [
      { texto: 'Cancelar' },
      { texto: 'Salir de todos modos', clase: 'peligro', accion: cerrarSesion }
    ];
    if(p.porSubir) botones.push({ texto: 'Sincronizar ahora', clase: 'primario', accion: sincronizar });
    modal('Tienes información sin terminar en la tablet',
      'Tienes <strong>' + partes.join(', ') + '</strong> en esta tablet.' +
      '<ul><li><strong>No compartas esta tablet con otro enfermero</strong> hasta terminarlas y sincronizarlas.</li>' +
      '<li>Si sales, quedan guardadas a tu nombre y tendrás que volver a ingresar con tu usuario para terminarlas.</li></ul>',
      botones);
  }

  // ── Inicio de sesión ──
  function iniciar(usuario){
    if(Number(usuario.nivel) !== 2){
      guardar(TOKEN_KEY, null);
      pantallaLogin('En este panel solo está disponible el registro de consumos para enfermeros.');
      if(almacenamientoDisponible()){
        // Desde un dispositivo moderno, los demás niveles usan la app principal
        if(typeof String.prototype.replaceAll === 'function'){ window.location.replace('/'); }
      }
      return;
    }
    st.usuario = usuario;
    guardarJSON('nb_ultimo_usuario', { id: usuario.id, nombre: usuario.nombre, cedula: usuario.cedula, nivel: usuario.nivel });
    $('lt-nombre').textContent = usuario.nombre || 'Enfermero/a';
    $('lt-avatar').textContent = String(usuario.nombre || 'EN').split(' ')
      .slice(0, 2).map(function(w){ return w.charAt(0); }).join('').toUpperCase();
    mostrar('lt-login', false);
    mostrar('lt-app', true);
    if(leer(claveUsuario('modo')) === 'offline') entrarOffline();
    else cargarEventos();
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
      guardar(TOKEN_KEY, data.token);
      iniciar(data.usuario);
    });
  }

  // ══════════════════════════════════════════
  // EN LÍNEA: eventos, stock e historial desde el servidor
  // ══════════════════════════════════════════
  function cargarEventos(){
    st.offline = false;
    estado('Cargando tus eventos…');
    apiSesion('GET', '/api/eventos/activos', null, function(err, eventos){
      if(err){
        if(err.sinRed && hayPaquete()){ ofrecerOfflineSinRed(); return; }
        estado(escHtml(err.message) + '<button class="lt-btn" type="button" data-accion="reintentar">Reintentar</button>');
        return;
      }
      st.eventos = eventos || [];
      if(!st.eventos.length){
        guardar(claveUsuario('paquete'), null);
        estado('No tienes un evento activo asignado.<br>Contacta al administrador para que te asigne a un evento.' +
          '<button class="lt-btn" type="button" data-accion="reintentar">Volver a consultar</button>' +
          (leerCola(st.usuario.id).length ? '<button class="lt-btn" type="button" data-accion="sincronizar">Sincronizar consumos pendientes</button>' : ''));
        return;
      }
      cargarStock(function(){ elegirEventoInicial(); });
    });
  }

  // Stock de TODAS las bodegas de sus eventos en curso: así, en modo
  // offline, también puede cambiar de evento sin conexión
  function cargarStock(despues){
    estado('Cargando inventario…');
    apiSesion('GET', '/api/skus/stock', null, function(err, filas){
      if(err){
        if(err.sinRed && hayPaquete()){ ofrecerOfflineSinRed(); return; }
        estado(escHtml(err.message) + '<button class="lt-btn" type="button" data-accion="reintentar">Reintentar</button>');
        return;
      }
      var nombres = {};
      for(var e = 0; e < st.eventos.length; e++){
        var bods = st.eventos[e].bodegas || [];
        for(var i = 0; i < bods.length; i++) nombres[bods[i].nombre] = true;
      }
      st.stock = [];
      for(var j = 0; j < (filas || []).length; j++){
        var f = filas[j];
        if(f.sub_sku_id && f.bodega_nombre && nombres[f.bodega_nombre]){
          f.cantidad = Number(f.cantidad) || 0;
          st.stock.push(f);
        }
      }
      st.preparadoAt = new Date().toISOString();
      estado('');
      guardarPaquete();
      cargarHistorial();
      despues();
    });
  }

  function cargarHistorial(){
    api('GET', '/api/movimientos?mios=1&limit=300', null, function(err, movs){
      if(err) return;   // el historial no es crítico
      var hoy = fechaCO();
      st.historial = [];
      for(var i = 0; i < (movs || []).length; i++){
        var m = movs[i];
        var fecha = m.fecha_real || m.created_at;
        if(m.tipo === 'consumo' && fecha && fechaCO(fecha) === hoy){
          st.historial.push({
            nombre: m.nombre || m.sku_global_codigo, cantidad: m.cantidad, unidad: m.unidad,
            origen_nombre: m.origen_nombre, fecha: fecha, cedula_paciente: m.cedula_paciente
          });
        }
      }
      guardarPaquete();
      renderHistorial();
    });
  }

  // Guarda en la tablet lo necesario para trabajar offline.
  // El historial se guarda SIN cédulas: solo las de consumos pendientes
  // quedan en la tablet, y se borran al sincronizar.
  function guardarPaquete(){
    var historial = [];
    for(var i = 0; i < st.historial.length; i++){
      var h = st.historial[i];
      historial.push({ nombre: h.nombre, cantidad: h.cantidad, unidad: h.unidad, origen_nombre: h.origen_nombre, fecha: h.fecha });
    }
    return guardarJSON(claveUsuario('paquete'), {
      preparado_at: st.preparadoAt, eventos: st.eventos, stock: st.stock, historial: historial
    });
  }

  function hayPaquete(){
    var p = leerJSON(claveUsuario('paquete'));
    return !!(p && p.eventos && p.eventos.length);
  }

  function elegirEventoInicial(){
    if(st.eventos.length === 1){ aplicarEvento(st.eventos[0]); return; }
    var elegido = buscarPor(st.eventos, 'id', parseInt(leer(claveUsuario('evento')), 10));
    if(elegido) aplicarEvento(elegido);
    else mostrarEleccion();
  }

  // ══════════════════════════════════════════
  // MODO OFFLINE
  // ══════════════════════════════════════════
  function entrarOffline(){
    var p = leerJSON(claveUsuario('paquete'));
    if(!p || !p.eventos || !p.eventos.length){
      guardar(claveUsuario('modo'), null);
      estado('No hay datos descargados en esta tablet para trabajar offline.<br>Conéctate a una red para cargar tus eventos.' +
        '<button class="lt-btn" type="button" data-accion="reintentar">Reintentar con conexión</button>');
      return;
    }
    st.offline = true;
    st.eventos = p.eventos;
    st.stock = p.stock || [];
    st.historial = p.historial || [];
    st.preparadoAt = p.preparado_at;
    guardar(claveUsuario('modo'), 'offline');
    estado('');
    elegirEventoInicial();
  }

  // Sin red al abrir o al cargar: si hay datos descargados, se ofrece offline
  function ofrecerOfflineSinRed(){
    var p = leerJSON(claveUsuario('paquete'));
    estado('Sin conexión con el servidor.<br>Puedes trabajar offline con los datos descargados el ' + fechaHoraCO(p.preparado_at) + '.' +
      '<button class="lt-btn" type="button" data-accion="offline">Trabajar offline</button>' +
      '<button class="lt-btn" type="button" data-accion="reintentar">Reintentar con conexión</button>');
  }

  function puedeAbrirSinSenal(){
    var ac = window.applicationCache;
    if(ac && typeof ac.status === 'number') return ac.status === 1 || ac.status === 4;   // IDLE / UPDATEREADY
    if(navigator.serviceWorker) return !!navigator.serviceWorker.controller;
    return null;   // el navegador no permite saberlo
  }

  // Botón "Trabajar offline": avisos del cliente y descarga de datos frescos
  function pedirOffline(){
    if(!almacenamientoDisponible()){
      modal('No se puede trabajar offline',
        'Este navegador no permite guardar datos (¿está en <strong>navegación privada</strong>?). Ábrelo en una pestaña normal e inténtalo de nuevo.',
        [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    var bodegas = [];
    var bods = (st.evento && st.evento.bodegas) || [];
    for(var i = 0; i < bods.length; i++) bodegas.push(escHtml(bods[i].nombre));
    var guardada = puedeAbrirSinSenal();
    modal('Trabajar offline',
      'Se descargarán ahora tus eventos y el inventario de tus bodegas. Después podrás registrar consumos sin conexión.' +
      '<ul>' +
      '<li><strong>No compartas esta tablet con otro enfermero</strong> mientras tengas consumos sin sincronizar.</li>' +
      '<li>Mientras trabajes offline, <strong>nadie más debe registrar consumos en ' + (bodegas.length ? bodegas.join(', ') : 'tus bodegas') + '</strong>, para evitar consumos dobles.</li>' +
      '<li>Si el inventario cambia después de este momento, la tablet no se enterará hasta que vuelvas a estar en línea.</li>' +
      '<li>Las cédulas de los pacientes quedan guardadas en la tablet hasta que sincronices.</li>' +
      '<li>Al terminar la jornada, con conexión, pulsa <strong>Sincronizar</strong>.</li>' +
      '</ul>' +
      (guardada === false ? '<p style="color:#C0392B;margin-top:10px">La app todavía se está guardando en este dispositivo para abrir sin señal. Espera unos segundos con conexión antes de cerrarla.</p>' : ''),
      [
        { texto: 'Cancelar' },
        { texto: 'Descargar datos y trabajar offline', clase: 'primario', accion: prepararOffline }
      ]);
  }

  function prepararOffline(){
    estado('Descargando datos para trabajar offline…');
    apiSesion('GET', '/api/eventos/activos', null, function(err, eventos){
      if(err){ estadoErrorPreparar(err); return; }
      st.eventos = eventos || [];
      if(!st.eventos.length){ cargarEventos(); return; }
      cargarStock(function(){
        if(!guardarPaquete()){
          estado('No hay espacio para guardar los datos en esta tablet.<button class="lt-btn" type="button" data-accion="reintentar">Volver</button>');
          return;
        }
        guardar(claveUsuario('modo'), 'offline');
        st.offline = true;
        elegirEventoInicial();
        toast('Modo offline activado', 'ok');
      });
    });
  }

  function estadoErrorPreparar(err){
    estado('Necesitas conexión para descargar los datos antes de trabajar offline.<br>' + escHtml(err.message) +
      '<button class="lt-btn" type="button" data-accion="reintentar">Volver</button>');
  }

  // Volver a en línea: requiere no tener pendientes
  function volverEnLinea(){
    if(leerCola(st.usuario.id).length){
      var ps = HCLite.porSincronizar(st.usuario.id, leerCola(st.usuario.id));
      modal('Primero sincroniza', 'Tienes <strong>' + plural(ps.hc || 1, 'historia clínica pendiente', 'historias clínicas pendientes') + ' por sincronizar</strong>. Sincronízalas antes de volver al modo en línea.',
        [{ texto: 'Cancelar' }, { texto: 'Sincronizar', clase: 'primario', accion: sincronizar }]);
      return;
    }
    guardar(claveUsuario('modo'), null);
    cargarEventos();
  }

  // ── Sincronizar (solo con el botón) ──
  // Primero los consumos y después las historias clínicas pendientes de envío:
  // el servidor exige que los consumos de una HC estén registrados en el
  // inventario antes de aceptarla.
  function sincronizar(){
    if(st.sincronizando) return;
    var nc = leerCola(st.usuario.id).length, nh = HCLite.contar(st.usuario.id).porEnviar;
    if(!nc && !nh){ toast('No hay nada pendiente de sincronizar', 'ok'); return; }
    st.sincronizando = true;
    renderModo();
    sincronizarConsumos(function(rc){
      if(rc.sesion){ st.sincronizando = false; renderModo(); salirSinBorrar(textoSesionVencida()); return; }
      if(rc.sinRed || !nh){ terminarSincronizacion(rc, null); return; }
      HCLite.sincronizar(function(rh){
        if(rh.sesion){ st.sincronizando = false; renderModo(); salirSinBorrar(textoSesionVencida()); return; }
        terminarSincronizacion(rc, rh);
      });
    });
  }

  // Resumen del envío de historias clínicas para los avisos de sincronización
  function resumenHC(r){
    if(!r || !r.total) return '';
    var t = r.enviadas ? (r.enviadas === 1 ? 'Se envió' : 'Se enviaron') + ' <strong>' + plural(r.enviadas, 'historia clínica', 'historias clínicas') + '</strong>. ' : '';
    if(r.sinRed) t += 'Sin conexión: quedan historias clínicas pendientes de envío. ';
    if(r.errores) t += '<strong>' + plural(r.errores, 'historia clínica fue rechazada', 'historias clínicas fueron rechazadas') + '</strong>: ábrela en "Mis historias clínicas" para ver el motivo y corregirla. ';
    return t;
  }

  function terminarSincronizacion(rc, rh){
    st.sincronizando = false;
    renderModo();
    renderHistorial();
    HCLite.mostrarInicio();
    var quedanConsumos = leerCola(st.usuario.id).length;
    var quedanHC = HCLite.contar(st.usuario.id).porEnviar;
    var incompleto = rc.sinRed || rc.errores || quedanConsumos || quedanHC || (rh && rh.errores);
    var t = '';
    if(rc.ok) t += 'Se subieron <strong>' + plural(rc.ok, 'consumo', 'consumos') + '</strong>. ';
    if(rc.errores) t += '<strong>' + plural(rc.errores, 'consumo no se pudo registrar', 'consumos no se pudieron registrar') + '</strong>: ábrelos en el módulo 6 de su historia clínica para ver el motivo. ';
    if(rc.sinRed) t += 'Sin conexión: lo pendiente sigue guardado en la tablet; sincroniza cuando tengas señal. ';
    else if(rc.error) t += escHtml(rc.error) + ' ';
    t += resumenHC(rh);
    if(!incompleto) t += 'Los datos de los pacientes se borraron de esta tablet.';
    modal(incompleto ? 'Sincronización incompleta' : 'Sincronización completa', t,
      !incompleto && st.offline
        ? [{ texto: 'Seguir offline' }, { texto: 'Volver a en línea', clase: 'primario', accion: volverEnLinea }]
        : [{ texto: 'Aceptar', clase: 'primario' }]);
  }

  // Sube la cola de consumos. cb({ total, ok, errores, sinRed, sesion, error })
  function sincronizarConsumos(cb){
    var cola = leerCola(st.usuario.id);
    var res = { total: cola.length, ok: 0, errores: 0 };
    if(!cola.length){ cb(res); return; }
    var lotes = [];
    for(var i = 0; i < cola.length; i += LOTE_SINCRONIZAR) lotes.push(cola.slice(i, i + LOTE_SINCRONIZAR));

    function siguiente(n){
      if(n >= lotes.length){ cb(res); return; }
      var envio = [];
      for(var k = 0; k < lotes[n].length; k++){
        var c = lotes[n][k];
        envio.push({ client_id: c.client_id, sub_sku_id: c.sub_sku_id, bodega_origen_id: c.bodega_origen_id,
                     cantidad: c.cantidad, cedula_paciente: c.cedula_paciente, fecha_atencion: c.fecha_atencion,
                     hc_client_id: c.hc_client_id || null });
      }
      api('POST', '/api/movimientos/sincronizar', { consumos: envio }, function(err, data){
        if(err){
          if(sesionVencida(err)) res.sesion = true;
          else if(err.sinRed) res.sinRed = true;
          else res.error = err.message;
          cb(res);
          return;
        }
        aplicarResultados(data.resultados || []);
        siguiente(n + 1);
      });
    }

    function aplicarResultados(resultados){
      var porId = {};
      for(var r = 0; r < resultados.length; r++) porId[resultados[r].client_id] = resultados[r];
      var actual = leerCola(st.usuario.id), resto = [];
      for(var q = 0; q < actual.length; q++){
        var item = actual[q], r2 = porId[item.client_id];
        if(r2 && (r2.estado === 'ok' || r2.estado === 'duplicado')){
          res.ok++;
          // Ya está en el servidor: pasa al historial sin cédula y sale de la tablet
          st.historial.unshift({ nombre: item.nombre, cantidad: item.cantidad, unidad: item.unidad,
                                 origen_nombre: item.bodega_nombre, fecha: item.fecha_atencion });
        } else {
          if(r2 && r2.estado === 'error'){ res.errores++; item.error = r2.error; }
          resto.push(item);
        }
      }
      guardarCola(resto);
      guardarPaquete();
    }

    siguiente(0);
  }

  // ══════════════════════════════════════════
  // CONSUMOS DE LA HISTORIA CLÍNICA (módulo 6, js/lite/hc-lite.js)
  // ══════════════════════════════════════════
  // Registra un consumo: en línea va directo al servidor; offline (o si se
  // cae la red y el enfermero acepta) queda en la cola y sale con Sincronizar.
  // cb({ ok: true, pendiente }) | cb({ error }) | cb({ cancelado: true })
  function registrarConsumoHC(consumo, cb){
    if(st.offline){
      cb(encolarConsumo(consumo) ? { ok: true, pendiente: true } : { error: 'No hay espacio para guardar en esta tablet. El consumo NO se registró: sincroniza los pendientes.' });
      return;
    }
    api('POST', '/api/movimientos/consumo', {
      client_id: consumo.client_id, sub_sku_id: consumo.sub_sku_id, bodega_origen_id: consumo.bodega_origen_id,
      cantidad: consumo.cantidad, cedula_paciente: consumo.cedula_paciente, hc_client_id: consumo.hc_client_id
    }, function(err){
      if(!err){ descontarLocal(consumo); guardarPaquete(); cb({ ok: true }); return; }
      if(err.sinRed){
        // Mismo client_id: si el envío sí había llegado, al sincronizar se ignora el repetido
        modal('Sin conexión',
          'No se pudo enviar el consumo. ¿Quieres <strong>guardarlo en esta tablet y pasar a modo offline</strong>?' +
          '<ul><li>Lo subirás después con el botón <strong>Sincronizar</strong>.</li>' +
          '<li>No compartas esta tablet con otro enfermero hasta sincronizar.</li></ul>',
          [
            { texto: 'No, intentar después', accion: function(){ cb({ cancelado: true }); } },
            { texto: 'Guardar y trabajar offline', clase: 'primario', accion: function(){
              if(!almacenamientoDisponible()){ cb({ error: 'Este navegador no permite guardar datos (¿navegación privada?). El consumo NO se registró.' }); return; }
              st.offline = true;
              guardar(claveUsuario('modo'), 'offline');
              var ok = encolarConsumo(consumo);
              renderModo();
              cb(ok ? { ok: true, pendiente: true } : { error: 'No hay espacio para guardar en esta tablet. El consumo NO se registró.' });
            } }
          ]);
        return;
      }
      if(sesionVencida(err)){ cb({ error: 'Tu sesión venció y el consumo NO se registró. Sal, vuelve a ingresar y regístralo de nuevo.' }); return; }
      cb({ error: err.message + ' — el consumo NO se registró.' });
    });
  }

  function encolarConsumo(consumo){
    var cola = leerCola(st.usuario.id);
    cola.push(consumo);
    if(!guardarCola(cola)) return false;
    descontarLocal(consumo);
    guardarPaquete();
    renderModo();
    return true;
  }

  // Consumo todavía en la cola (sin sincronizar), o null
  function consumoEnCola(clientId){ return buscarPor(leerCola(st.usuario.id), 'client_id', clientId); }

  // Quita de la cola un consumo no sincronizado y devuelve el stock local
  function quitarConsumoDeCola(clientId){
    var cola = leerCola(st.usuario.id), resto = [], quitado = null;
    for(var i = 0; i < cola.length; i++){
      if(cola[i].client_id === clientId) quitado = cola[i]; else resto.push(cola[i]);
    }
    if(!quitado) return false;
    guardarCola(resto);
    devolverLocal(quitado);   // al encolarlo se había descontado del stock local
    guardarPaquete();
    renderModo();
    return true;
  }

  function devolverLocal(consumo){
    for(var i = 0; i < st.stock.length; i++){
      var f = st.stock[i];
      if(f.sub_sku_id === consumo.sub_sku_id && f.bodega_nombre === consumo.bodega_nombre){ f.cantidad += consumo.cantidad; break; }
    }
    guardarPaquete();
  }

  // Un consumo que el servidor rechazó (p. ej. stock insuficiente) se puede
  // descartar para que el administrador lo cargue como contingencia
  function pedirDescartar(clientId){
    var cola = leerCola(st.usuario.id);
    var item = buscarPor(cola, 'client_id', clientId);
    if(!item) return;
    modal('Descartar consumo',
      '¿Descartar <strong>' + item.cantidad + ' ' + escHtml(item.unidad || '') + ' de ' + escHtml(item.nombre) + '</strong> (' + fechaHoraCO(item.fecha_atencion) + ')?' +
      '<br><br>No se registrará en el sistema. Anota los datos y entrégalos al administrador para que lo cargue como contingencia.',
      [{ texto: 'Cancelar' }, { texto: 'Descartar', clase: 'peligro', accion: function(){
        var resto = [];
        for(var i = 0; i < cola.length; i++) if(cola[i].client_id !== clientId) resto.push(cola[i]);
        guardarCola(resto);
        renderModo(); renderHistorial();
      } }]);
  }

  // ── Barra de estado (en línea / offline) ──
  function renderModo(){
    var el = $('lt-modo');
    if(!st.usuario){ el.innerHTML = ''; return; }
    var cola = leerCola(st.usuario.id);
    var n = cola.length;
    // Lo que se muestra son las historias clínicas con algo por subir (por
    // enviar, o con consumos guardados en la tablet); los consumos son parte
    // de su HC. Solo se cuentan aparte consumos sin HC (versiones anteriores).
    var ps = HCLite.porSincronizar(st.usuario.id, cola);
    var masViejo = null;
    for(var i = 0; i < n; i++){ if(!masViejo || cola[i].fecha_atencion < masViejo) masViejo = cola[i].fecha_atencion; }
    var viejos = masViejo && (new Date().getTime() - new Date(masViejo).getTime()) > HORAS_AVISO_PENDIENTES * 3600 * 1000;
    var total = ps.hc + ps.consumosSueltos;
    var btnSync = total ? '<button type="button" class="lt-btn-sec primario" data-accion="sincronizar"' + (st.sincronizando ? ' disabled' : '') + '>' +
      (st.sincronizando ? 'Sincronizando…' : 'Sincronizar (' + total + ')') + '</button>' : '';
    var aviso = viejos ? '<div class="lt-modo-detalle"><strong>Tienes información sin sincronizar desde el ' + fechaHoraCO(masViejo) + '.</strong> Sincroniza apenas tengas conexión.</div>' : '';
    var partes = [];
    if(ps.hc) partes.push(plural(ps.hc, 'historia clínica pendiente', 'historias clínicas pendientes') + ' por sincronizar');
    if(ps.consumosSueltos) partes.push(plural(ps.consumosSueltos, 'consumo pendiente', 'consumos pendientes'));
    var html;
    if(st.offline){
      html = '<div class="lt-modo-titulo">● Modo offline</div>' +
        '<div class="lt-modo-detalle">Datos descargados el ' + fechaHoraCO(st.preparadoAt) + ' · ' +
        (partes.length ? '<strong>' + partes.join(' y ') + '</strong>' : 'nada pendiente de sincronizar') + '</div>' +
        '<div class="lt-modo-detalle">No compartas esta tablet hasta sincronizar.</div>' + aviso +
        '<div class="lt-modo-botones">' + btnSync +
        '<button type="button" class="lt-btn-sec" data-accion="en-linea">Volver a en línea</button></div>';
      el.className = 'lt-modo offline' + (viejos ? ' alerta' : '');
    } else {
      html = '<div class="lt-modo-titulo">● En línea</div>' +
        (partes.length ? '<div class="lt-modo-detalle"><strong>' + partes.join(' y ') + '</strong>: pulsa Sincronizar.</div>' : '') + aviso +
        '<div class="lt-modo-botones">' + btnSync +
        '<button type="button" class="lt-btn-sec" data-accion="pedir-offline">Trabajar offline</button></div>';
      el.className = 'lt-modo online' + (viejos ? ' alerta' : '');
    }
    el.innerHTML = html;
  }

  // ══════════════════════════════════════════
  // EVENTO, BODEGA Y PRODUCTO
  // ══════════════════════════════════════════
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
    guardar(claveUsuario('evento'), String(evento.id));
    mostrar('lt-elegir', false);
    $('lt-evento-txt').innerHTML = 'Evento: <strong>' + escHtml(evento.nombre) + '</strong> · ' + escHtml(evento.ubicacion_nombre || '');
    $('lt-cambiar-evento').style.display = st.eventos.length > 1 ? '' : 'none';
    $('lt-actualizar').style.display = st.offline ? 'none' : '';

    var bodegas = evento.bodegas || [];
    var opciones = '<option value="">Seleccionar bodega…</option>';
    for(var i = 0; i < bodegas.length; i++){
      opciones += '<option value="' + bodegas[i].id + '">' + escHtml(bodegas[i].nombre) + '</option>';
    }
    $('lt-bodega').innerHTML = opciones;
    st.bodega = null;
    if(bodegas.length === 1){ $('lt-bodega').value = String(bodegas[0].id); st.bodega = bodegas[0]; }
    quitarItem();
    estado('');
    mostrar('lt-panel', true);
    renderModo();
    renderHistorial();
    HCLite.mostrarInicio();
    // Sin bodegas puede diligenciar historias clínicas, pero no registrar consumos
    if(!bodegas.length){
      errorEn('lt-consumo-error', 'No tienes bodegas asignadas en este evento: no puedes registrar consumos. Contacta al administrador.');
    }
    actualizarPaso2();
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
    if(!res.length){
      cont.innerHTML = '<div class="lt-vacio">Sin resultados para "' + escHtml(q) + '"</div>';
      return;
    }
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
      escHtml(st.item.unidad || '') + semHtml(st.item.caducidad) + (st.offline ? ' <span class="lt-pend">según datos descargados</span>' : '');
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

  // ══════════════════════════════════════════
  // REGISTRAR CONSUMO
  // ══════════════════════════════════════════
  function registrar(){
    errorEn('lt-consumo-error', '');
    if(!st.bodega){ errorEn('lt-consumo-error', 'Selecciona una bodega primero'); return; }
    if(!st.item){ errorEn('lt-consumo-error', 'Selecciona un medicamento o insumo'); return; }
    var cant = parseInt(soloDigitos($('lt-cantidad').value), 10) || 0;
    if(cant <= 0){ errorEn('lt-consumo-error', 'Ingresa una cantidad válida'); return; }
    if(cant > st.item.cantidad){ errorEn('lt-consumo-error', 'Solo hay ' + st.item.cantidad + ' ' + (st.item.unidad || '') + ' disponibles en esta bodega'); return; }
    // Cédula obligatoria: solo números, mínimo 5 dígitos (misma regla que el servidor)
    var cedula = String($('lt-paciente').value || '').replace(/[\s.\-]/g, '');
    if(!/^\d{5,15}$/.test(cedula)){ errorEn('lt-consumo-error', 'Ingresa la cédula del paciente (solo números, mínimo 5 dígitos)'); return; }

    var consumo = {
      client_id: nuevoClientId(),
      sub_sku_id: st.item.sub_sku_id,
      bodega_origen_id: st.bodega.id,
      bodega_nombre: st.bodega.nombre,
      cantidad: cant,
      cedula_paciente: cedula,
      fecha_atencion: new Date().toISOString(),   // hora del dispositivo = hora real de atención
      nombre: st.item.nombre,
      unidad: st.item.unidad,
      evento_id: st.evento.id
    };

    if(st.offline){ guardarOffline(consumo); return; }

    var btn = $('lt-registrar');
    btn.disabled = true; btn.textContent = 'Registrando…';
    api('POST', '/api/movimientos/consumo', {
      client_id: consumo.client_id,
      sub_sku_id: consumo.sub_sku_id,
      bodega_origen_id: consumo.bodega_origen_id,
      cantidad: consumo.cantidad,
      cedula_paciente: consumo.cedula_paciente
    }, function(err){
      btn.disabled = false; btn.textContent = 'Registrar consumo';
      if(err){
        if(err.sinRed){ ofrecerGuardarOffline(consumo); return; }
        if(sesionVencida(err)){
          errorEn('lt-consumo-error', 'Tu sesión venció y el consumo NO se registró. Sal, vuelve a ingresar y regístralo de nuevo.');
        } else {
          errorEn('lt-consumo-error', err.message + ' — el consumo NO se registró.');
        }
        return;
      }
      descontarLocal(consumo);
      st.historial.unshift({ nombre: consumo.nombre, cantidad: consumo.cantidad, unidad: consumo.unidad,
                             origen_nombre: consumo.bodega_nombre, fecha: consumo.fecha_atencion,
                             cedula_paciente: consumo.cedula_paciente });
      guardarPaquete();
      limpiarFormulario();
      renderHistorial();
      toast('✓ Consumo registrado', 'ok');
    });
  }

  // Q1 del cliente (híbrido): si el envío falla por red, se ofrece guardarlo
  // en la tablet y pasar a modo offline. Se usa el MISMO client_id: si el
  // envío sí había llegado al servidor, al sincronizar se ignora el repetido.
  function ofrecerGuardarOffline(consumo){
    modal('Sin conexión',
      'No se pudo enviar el consumo. ¿Quieres <strong>guardarlo en esta tablet y pasar a modo offline</strong>?' +
      '<ul><li>Lo subirás después con el botón <strong>Sincronizar</strong>.</li>' +
      '<li>No compartas esta tablet con otro enfermero hasta sincronizar.</li>' +
      '<li>Nadie más debe registrar consumos en tus bodegas mientras trabajes offline.</li></ul>',
      [
        { texto: 'No, reintentar después' },
        { texto: 'Guardar y trabajar offline', clase: 'primario', accion: function(){
          if(!almacenamientoDisponible()){ errorEn('lt-consumo-error', 'Este navegador no permite guardar datos (¿navegación privada?). El consumo NO se registró.'); return; }
          st.offline = true;
          guardar(claveUsuario('modo'), 'offline');
          guardarOffline(consumo);
          aplicarEvento(st.evento);
        } }
      ]);
  }

  function guardarOffline(consumo){
    var cola = leerCola(st.usuario.id);
    cola.push(consumo);
    if(!guardarCola(cola)){
      errorEn('lt-consumo-error', 'No hay espacio para guardar en esta tablet. El consumo NO se registró: sincroniza los pendientes.');
      return;
    }
    descontarLocal(consumo);
    guardarPaquete();
    limpiarFormulario();
    renderModo();
    renderHistorial();
    toast('✓ Guardado en la tablet (pendiente de sincronizar)', 'ok');
  }

  function descontarLocal(consumo){
    for(var i = 0; i < st.stock.length; i++){
      var f = st.stock[i];
      if(f.sub_sku_id === consumo.sub_sku_id && f.bodega_nombre === consumo.bodega_nombre){ f.cantidad -= consumo.cantidad; break; }
    }
  }

  function limpiarFormulario(){
    $('lt-cantidad').value = '';
    $('lt-paciente').value = '';
    quitarItem();
  }

  // ── Mis consumos de hoy: pendientes primero, luego los registrados ──
  function renderHistorial(){
    var cont = $('lt-historial');
    var cola = st.usuario ? leerCola(st.usuario.id) : [];
    var hoy = fechaCO();
    var html = '';
    for(var p = cola.length - 1; p >= 0; p--){
      var c = cola[p];
      html += '<div class="lt-hist">' +
        '<span class="lt-hist-cant">' + c.cantidad + ' ' + escHtml(c.unidad || '') + '</span>' +
        '<div class="lt-hist-name">' + escHtml(c.nombre) + (c.error ? '<span class="lt-pend error">No registrado</span>' : '<span class="lt-pend">Pendiente</span>') + '</div>' +
        '<div class="lt-hist-meta">' + escHtml(c.bodega_nombre || '—') + ' · ' +
        (fechaCO(c.fecha_atencion) === hoy ? horaCO(c.fecha_atencion) : fechaHoraCO(c.fecha_atencion)) +
        (c.cedula_paciente ? ' · Pac: ' + escHtml(c.cedula_paciente) : '') + '</div>' +
        (c.error ? '<div class="lt-hist-error">' + escHtml(c.error) + ' <button type="button" class="lt-link" data-descartar="' + escHtml(c.client_id) + '">Descartar</button></div>' : '') +
        '</div>';
    }
    for(var i = 0; i < st.historial.length; i++){
      var m = st.historial[i];
      if(fechaCO(m.fecha) !== hoy) continue;
      html += '<div class="lt-hist">' +
        '<span class="lt-hist-cant">' + m.cantidad + ' ' + escHtml(m.unidad || '') + '</span>' +
        '<div class="lt-hist-name">' + escHtml(m.nombre || '—') + '</div>' +
        '<div class="lt-hist-meta">' + escHtml(m.origen_nombre || '—') + ' · ' + horaCO(m.fecha) +
        (m.cedula_paciente ? ' · Pac: ' + escHtml(m.cedula_paciente) : '') + '</div>' +
        '</div>';
    }
    cont.innerHTML = html || '<div class="lt-vacio">Sin consumos registrados hoy</div>';
  }

  // ══════════════════════════════════════════
  // GUARDAR LA APP EN EL DISPOSITIVO (abrir sin señal)
  // ══════════════════════════════════════════
  // Safari de iOS 9–12: AppCache (atributo manifest de enfermero.html).
  // Navegadores modernos (sin AppCache): Service Worker. Cuando hay una
  // versión nueva se recarga, salvo que esté a mitad de un registro.
  function prepararAppSinSenal(){
    var ac = window.applicationCache;
    if(ac && typeof ac.status === 'number'){
      on(ac, 'updateready', function(){
        try { ac.swapCache(); } catch(e){}
        if(!st.item && !HCLite.editando()) window.location.reload();
      });
      return;
    }
    if(navigator.serviceWorker){
      var habiaControlador = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('/sw-enfermero.js', { scope: '/enfermero' })['catch'](function(){});
      on(navigator.serviceWorker, 'controllerchange', function(){
        if(habiaControlador && !st.item && !HCLite.editando()) window.location.reload();
      });
    }
  }

  // ── Eventos de la interfaz ──
  function closestData(el, attr){
    while(el && el !== document.body){
      if(el.getAttribute && el.getAttribute(attr) !== null) return el;
      el = el.parentNode;
    }
    return null;
  }

  function accionBoton(accion){
    if(accion === 'recargar') window.location.reload();
    else if(accion === 'offline') entrarOffline();
    else if(accion === 'pedir-offline') pedirOffline();
    else if(accion === 'en-linea') volverEnLinea();
    else if(accion === 'sincronizar') sincronizar();
    else cargarEventos();
  }

  function conectar(){
    // Historia clínica (js/lite/hc-lite.js): utilidades y estado compartidos
    HCLite.conectar({
      $: $, on: on, mostrar: mostrar, escHtml: escHtml, api: api, sesionVencida: sesionVencida,
      modal: modal, toast: toast, leerJSON: leerJSON, guardarJSON: guardarJSON, claveUsuario: claveUsuario,
      nuevoClientId: nuevoClientId, fechaCO: fechaCO, horaCO: horaCO, fmtFecha: fmtFecha,
      closestData: closestData, renderModo: renderModo, estado: st,
      // módulo 6
      registrarConsumoHC: registrarConsumoHC, consumoEnCola: consumoEnCola,
      quitarConsumoDeCola: quitarConsumoDeCola, devolverLocal: devolverLocal,
      sincronizar: sincronizar, fechaHoraCO: fechaHoraCO, semHtml: semHtml
    });
    on($('lt-login-form'), 'submit', enviarLogin);
    on($('lt-logout'), 'click', function(){ if(st.usuario) pedirSalir(); else cerrarSesion(); });
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
      if(b) accionBoton(b.getAttribute('data-accion'));
    });
    on($('lt-modo'), 'click', function(e){
      var b = closestData(e.target, 'data-accion');
      if(b && !b.disabled) accionBoton(b.getAttribute('data-accion'));
    });
    on($('lt-historial'), 'click', function(e){
      var b = closestData(e.target, 'data-descartar');
      if(b) pedirDescartar(b.getAttribute('data-descartar'));
    });
    on($('lt-modal-botones'), 'click', function(e){
      var b = closestData(e.target, 'data-boton');
      if(!b) return;
      var boton = _modalAcciones[parseInt(b.getAttribute('data-boton'), 10)];
      cerrarModal();
      if(boton && boton.accion) boton.accion();
    });
  }

  // ── Arranque ──
  function arrancar(){
    conectar();
    prepararAppSinSenal();
    if(!leer(TOKEN_KEY)){ pantallaLogin(''); return; }

    // En modo offline se entra directo, sin consultar al servidor: con red
    // intermitente esa consulta podría quedarse colgada.
    var ultimo = leerJSON('nb_ultimo_usuario');
    if(ultimo && leer(claveUsuario('modo', ultimo.id)) === 'offline'){
      iniciar(ultimo);
      return;
    }

    mostrar('lt-app', true);
    estado('Verificando sesión…');
    api('GET', '/api/auth/me', null, function(err, data){
      if(err){
        if(err.sinRed){
          if(ultimo && leerJSON(claveUsuario('paquete', ultimo.id))){
            st.usuario = ultimo;
            iniciar(ultimo);   // cargarEventos fallará sin red y ofrecerá offline
            return;
          }
          estado('Sin conexión con el servidor.<button class="lt-btn" type="button" data-accion="recargar">Reintentar</button>');
          return;
        }
        guardar(TOKEN_KEY, null);
        pantallaLogin('');
        return;
      }
      iniciar(data.usuario);
    });
  }

  arrancar();
})();
