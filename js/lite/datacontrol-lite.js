/* Asistencia de personal en tablets (/datacontrol) — JavaScript ES5 para
   Safari de iOS 12 (iPad antiguos). Sin librerías externas.

   Flujo: la tablet se activa una vez con la cuenta de Datacontrol (la sesión
   no vence) → elige el evento → la persona escribe su cédula y su PIN → foto →
   "Marcar ENTRADA" o "Marcar SALIDA" (según tenga o no una jornada abierta).

   Con y sin conexión: cada marca se guarda primero en la tablet (cola) y
   después se sube. Los datos del evento (personal con la sal y el hash de su
   PIN, jornadas abiertas) se descargan para validar sin señal.

   Reglas (las mismas de src/utils/asistencia.js en el servidor):
   - solo personal asignado al evento; PIN = SHA-256 de "sal:pin";
   - entrada dentro de las fechas del evento (hora de Colombia);
   - jornada = entrada → salida, máximo 16 horas.

   localStorage:
     dc_token     token de la tablet        dc_usuario   cuenta activada
     dc_paquete   datos descargados         dc_cola      marcas por subir
     dc_abiertas  jornadas abiertas         dc_offline   '1' = modo offline
     dc_evento    evento elegido            dc_rechazadas marcas que el servidor no aceptó */
(function(){
  'use strict';

  var MAX_JORNADA_MS = 16 * 3600 * 1000;
  var LOTE = 10;                    // marcas por envío (llevan foto)
  var VOLVER_MS = 5000;             // pantalla de "registrada" → vuelve sola
  var INACTIVIDAD_MS = 60000;       // borra la cédula y el PIN si nadie sigue
  var COLOMBIA_MS = 5 * 3600 * 1000;

  var st = {
    paquete: null, evento: null, cola: [], abiertas: {}, offline: false,
    fase: 'cedula', cedula: '', pin: '', persona: null, accion: null, abierta: null,
    foto: null, stream: null, enviando: false, timerVolver: null, timerInactivo: null, intentos: 0
  };

  // ── Utilidades ──
  function $(id){ return document.getElementById(id); }
  function on(el, ev, fn){ if(el) el.addEventListener(ev, fn, false); }
  function mostrar(id, si){ var el = $(id); if(!el) return; el.className = el.className.replace(/(^|\s)on(\s|$)/g, ' ').replace(/\s+$/, '') + (si ? ' on' : ''); }
  function escHtml(s){ return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function leer(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
  function guardar(k, v){ try { if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch(e){ return false; } }
  function leerJSON(k){ try { return JSON.parse(leer(k) || 'null'); } catch(e){ return null; } }
  function guardarJSON(k, v){ return guardar(k, v === null ? null : JSON.stringify(v)); }
  function nuevoId(){ return 'dc' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 10); }
  function dos(n){ return (n < 10 ? '0' : '') + n; }
  // Hora de Colombia (UTC-5, sin horario de verano)
  function enCO(fecha){ return new Date(new Date(fecha).getTime() - COLOMBIA_MS); }
  function fechaCO(fecha){ var d = enCO(fecha); return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()); }
  function horaCO(fecha){ var d = enCO(fecha); return dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes()); }
  function fechaHoraCO(fecha){ var d = enCO(fecha); return dos(d.getUTCDate()) + '/' + dos(d.getUTCMonth() + 1) + ' ' + horaCO(fecha); }
  function fmtFecha(iso){ var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; }
  function duracion(ms){ var min = Math.round(ms / 60000); return Math.floor(min / 60) + ' h ' + dos(min % 60) + ' min'; }
  // Hora del servidor estimada (reloj de la tablet corregido al descargar)
  function ahora(){ var off = (st.paquete && st.paquete.desfase) || 0; return new Date(new Date().getTime() + off); }

  var _toastTimer;
  function toast(msg, tipo){
    var el = $('dc-toast');
    el.textContent = msg;
    el.className = 'dc-toast on' + (tipo === 'error' ? ' error' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function(){ el.className = 'dc-toast'; }, tipo === 'error' ? 5000 : 2600);
  }
  function error(id, msg){ var el = $(id); el.textContent = msg || ''; mostrar(id, !!msg); }

  var _modalAcciones = [];
  function modal(titulo, html, botones){
    $('dc-modal-tit').textContent = titulo;
    $('dc-modal-cuerpo').innerHTML = html;
    _modalAcciones = botones;
    var b = '';
    for(var i = 0; i < botones.length; i++) b += '<button type="button" class="' + (botones[i].clase || '') + '" data-boton="' + i + '">' + escHtml(botones[i].texto) + '</button>';
    $('dc-modal-botones').innerHTML = b;
    mostrar('dc-modal', true);
  }

  // SHA-256 (ES5) para validar el PIN sin conexión. Entrada ASCII.
  function sha256(ascii){
    function rr(v, n){ return (v >>> n) | (v << (32 - n)); }
    var k = [], h = [], primos = [], i, j;
    for(var c = 2; primos.length < 64; c++){
      var es = true;
      for(i = 0; i < primos.length && primos[i] * primos[i] <= c; i++) if(c % primos[i] === 0){ es = false; break; }
      if(es) primos.push(c);
    }
    for(i = 0; i < 64; i++){
      if(i < 8) h[i] = (Math.pow(primos[i], 1 / 2) * 4294967296) | 0;
      k[i] = (Math.pow(primos[i], 1 / 3) * 4294967296) | 0;
    }
    var bytes = [];
    for(i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 255);
    var bits = bytes.length * 8;
    bytes.push(0x80);
    while(bytes.length % 64 !== 56) bytes.push(0);
    for(i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    for(var off = 0; off < bytes.length; off += 64){
      var w = [];
      for(i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for(i = 16; i < 64; i++){
        var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], cc = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for(i = 0; i < 64; i++){
        var t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
        var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + cc) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var hex = '';
    for(i = 0; i < 8; i++) for(j = 3; j >= 0; j--){ var by = (h[i] >>> (j * 8)) & 255; hex += (by < 16 ? '0' : '') + by.toString(16); }
    return hex;
  }

  // ── API ──
  function api(metodo, ruta, cuerpo, cb){
    var x = new XMLHttpRequest();
    x.open(metodo, ruta, true);
    x.setRequestHeader('Content-Type', 'application/json');
    var token = leer('dc_token');
    if(token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.timeout = 30000;
    x.onreadystatechange = function(){
      if(x.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(x.responseText); } catch(e){}
      if(x.status >= 200 && x.status < 300){ cb(null, data); return; }
      var err = new Error(x.status === 0 ? 'Sin conexión con el servidor' : ((data && data.error) || ('Error del servidor (' + x.status + ')')));
      err.status = x.status;
      err.sinRed = x.status === 0;
      cb(err);
    };
    x.send(cuerpo ? JSON.stringify(cuerpo) : null);
  }
  function sesionCerrada(err){ return err && err.status === 401; }

  // ══════════════════════════════════════════
  // ACTIVACIÓN
  // ══════════════════════════════════════════
  function pantallaActivar(msg){
    detenerCamara(true);
    mostrar('dc-app', false);
    mostrar('dc-activar', true);
    error('dc-activar-error', msg || '');
    $('dc-pass').value = '';
    var u = leer('dc_usuario');
    if(u && !$('dc-usuario').value) $('dc-usuario').value = u;
  }

  function activar(e){
    if(e) e.preventDefault();
    var usuario = $('dc-usuario').value.replace(/^\s+|\s+$/g, ''), pass = $('dc-pass').value;
    if(!usuario || !pass){ error('dc-activar-error', 'Escribe el usuario y la contraseña de la tablet'); return; }
    var btn = $('dc-activar-btn');
    btn.disabled = true; btn.textContent = 'Activando…';
    api('POST', '/api/asistencia/kiosco/login', { usuario: usuario, password: pass }, function(err, r){
      btn.disabled = false; btn.textContent = 'Activar tablet';
      if(err){ error('dc-activar-error', err.message); return; }
      guardar('dc_token', r.token);
      guardar('dc_usuario', r.usuario);
      iniciarApp();
    });
  }

  // Cerrar la sesión de la tablet: solo sin marcas pendientes
  function pedirSalir(){
    if(st.cola.length){
      modal('Hay marcas sin subir', 'Esta tablet tiene <strong>' + st.cola.length + ' marca' + (st.cola.length !== 1 ? 's' : '') +
        '</strong> sin subir. Sincroniza antes de cerrar la sesión.', [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    modal('Cerrar la sesión de la tablet', 'La tablet dejará de marcar asistencia hasta que se active otra vez con la cuenta de Datacontrol.',
      [{ texto: 'Cancelar' }, { texto: 'Cerrar sesión', clase: 'peligro', accion: function(){
        guardar('dc_token', null); guardar('dc_paquete', null); guardar('dc_abiertas', null); guardar('dc_evento', null); guardar('dc_offline', null);
        st.paquete = null; st.evento = null; st.abiertas = {};
        pantallaActivar('');
      } }]);
  }

  // ══════════════════════════════════════════
  // DATOS Y MODO
  // ══════════════════════════════════════════
  function iniciarApp(){
    mostrar('dc-activar', false);
    mostrar('dc-app', true);
    $('dc-cab-usuario').textContent = 'Tablet: ' + (leer('dc_usuario') || '');
    st.paquete = leerJSON('dc_paquete');
    st.cola = leerJSON('dc_cola') || [];
    st.abiertas = leerJSON('dc_abiertas') || {};
    st.offline = leer('dc_offline') === '1';
    renderModo();
    if(st.offline && st.paquete){ elegirEventoInicial(); return; }
    descargar(function(ok){
      if(ok || st.paquete){ elegirEventoInicial(); if(!ok && st.paquete) toast('Sin conexión: se usan los datos guardados en la tablet', 'error'); }
      if(st.cola.length && !st.offline) sincronizar(true);
    });
  }

  // silencioso: actualización de fondo, sin tapar la pantalla de marcar
  function descargar(cb, silencioso){
    if(!silencioso) estado('Descargando los eventos…');
    api('GET', '/api/asistencia/kiosco/datos', null, function(err, d){
      if(err){
        if(sesionCerrada(err)){ pantallaActivar(err.message); return; }
        if(!st.paquete && !silencioso) estado('No se pudieron descargar los eventos. ' + escHtml(err.message) + '<button class="dc-btn" type="button" data-accion="reintentar">Reintentar</button>');
        cb(false);
        return;
      }
      d.descargado_at = new Date().toISOString();
      d.desfase = new Date(d.hora_servidor).getTime() - new Date().getTime();
      st.paquete = d;
      guardarJSON('dc_paquete', d);
      // Jornadas abiertas: las del servidor + lo que la tablet aún no subió
      var ab = {};
      for(var i = 0; i < (d.abiertas || []).length; i++){
        var a = d.abiertas[i];
        ab[a.usuario_id] = { jornada_client_id: a.entrada_client_id, evento_id: a.evento_id, entrada_at: a.entrada_at };
      }
      for(var j = 0; j < st.cola.length; j++) aplicarMarcaLocal(ab, st.cola[j]);
      st.abiertas = ab;
      guardarJSON('dc_abiertas', ab);
      if(st.evento) st.evento = buscarEvento(st.evento.id) || st.evento;
      renderModo();
      cb(true);
    });
  }

  function aplicarMarcaLocal(ab, m){
    if(m.tipo === 'entrada') ab[m.usuario_id] = { jornada_client_id: m.client_id, evento_id: m.evento_id, entrada_at: m.fecha };
    else if(ab[m.usuario_id] && ab[m.usuario_id].jornada_client_id === m.jornada_client_id) delete ab[m.usuario_id];
  }

  function estado(html){
    $('dc-estado').innerHTML = html || '';
    mostrar('dc-estado', !!html);
    if(html){ mostrar('dc-eventos', false); mostrar('dc-marcar', false); mostrar('dc-foto', false); mostrar('dc-ok', false); }
  }

  function renderModo(){
    var el = $('dc-modo'), n = st.cola.length;
    var desc = st.paquete ? 'Datos del ' + fechaHoraCO(st.paquete.descargado_at) : 'Sin datos descargados';
    var botones = (n ? '<button type="button" class="primario" data-accion="sincronizar"' + (st.enviando ? ' disabled' : '') + '>' +
      (st.enviando ? 'Sincronizando…' : 'Sincronizar (' + n + ')') + '</button>' : '') +
      (st.offline ? '<button type="button" data-accion="en-linea">Volver a en línea</button>'
                  : '<button type="button" data-accion="offline">Trabajar offline</button>');
    var rech = leerJSON('dc_rechazadas') || [];
    if(rech.length) botones = '<button type="button" data-accion="ver-rechazadas">Rechazadas (' + rech.length + ')</button>' + botones;
    el.className = 'dc-modo' + (st.offline ? ' offline' : '');
    el.innerHTML = '<span>● ' + (st.offline ? 'Modo offline' : 'En línea') + ' · ' + desc +
      (n ? ' · <strong>' + n + ' marca' + (n !== 1 ? 's' : '') + ' por subir</strong>' : '') + '</span><span class="dc-modo-botones">' + botones + '</span>';
  }

  function pasarOffline(){
    descargar(function(ok){
      if(!ok){ toast('Necesitas conexión para descargar los datos antes de trabajar offline', 'error'); if(st.paquete) elegirEventoInicial(); return; }
      st.offline = true; guardar('dc_offline', '1'); renderModo(); elegirEventoInicial();
      toast('Modo offline: las marcas se guardan en la tablet');
    });
  }
  function volverEnLinea(){
    st.offline = false; guardar('dc_offline', null); renderModo();
    descargar(function(){ elegirEventoInicial(); if(st.cola.length) sincronizar(false); });
  }

  // ══════════════════════════════════════════
  // EVENTOS
  // ══════════════════════════════════════════
  function eventosVisibles(){
    var hoy = fechaCO(ahora()), lista = [], evs = (st.paquete && st.paquete.eventos) || [];
    for(var i = 0; i < evs.length; i++){
      var e = evs[i], tieneAbiertas = false;
      for(var u in st.abiertas) if(st.abiertas.hasOwnProperty(u) && st.abiertas[u].evento_id === e.id) tieneAbiertas = true;
      if((e.fecha_inicio <= hoy && e.fecha_fin >= hoy) || tieneAbiertas) lista.push(e);
    }
    return lista;
  }
  function buscarEvento(id){
    var evs = (st.paquete && st.paquete.eventos) || [];
    for(var i = 0; i < evs.length; i++) if(evs[i].id === id) return evs[i];
    return null;
  }

  function elegirEventoInicial(){
    var guardado = parseInt(leer('dc_evento'), 10), lista = eventosVisibles();
    for(var i = 0; i < lista.length; i++) if(lista[i].id === guardado){ abrirEvento(lista[i]); return; }
    if(lista.length === 1){ abrirEvento(lista[0]); return; }
    renderEventos();
  }

  function renderEventos(){
    detenerCamara();
    var lista = eventosVisibles();
    if(!lista.length){
      estado('No hay eventos vigentes hoy para marcar asistencia.<br>Revisa las fechas del evento en el panel admin.' +
        '<button class="dc-btn" type="button" data-accion="reintentar">Actualizar</button>');
      return;
    }
    estado('');
    var html = '';
    for(var i = 0; i < lista.length; i++){
      var e = lista[i];
      html += '<button type="button" class="dc-evento" data-evento="' + e.id + '"><img src="img/iconos/' + (e.es_temporal ? 'temporales' : 'ubicacion') + '.svg" alt="">' +
        '<div><b>' + escHtml(e.nombre) + '</b><span>' + escHtml(e.ubicacion_nombre || '') + ' · ' + fmtFecha(e.fecha_inicio) + ' → ' + fmtFecha(e.fecha_fin) +
        ' · ' + e.personal.length + ' persona' + (e.personal.length !== 1 ? 's' : '') + '</span></div><span class="dc-evento-flecha">›</span></button>';
    }
    $('dc-eventos-lista').innerHTML = html;
    mostrar('dc-marcar', false); mostrar('dc-foto', false); mostrar('dc-ok', false);
    mostrar('dc-eventos', true);
  }

  function abrirEvento(e){
    st.evento = e;
    guardar('dc_evento', String(e.id));
    $('dc-marcar-evento').textContent = e.nombre + ' — Marcar asistencia';
    reiniciarMarca();
    estado('');
    mostrar('dc-eventos', false); mostrar('dc-foto', false); mostrar('dc-ok', false);
    mostrar('dc-marcar', true);
  }

  // ══════════════════════════════════════════
  // CÉDULA + PIN
  // ══════════════════════════════════════════
  function reiniciarMarca(){
    clearTimeout(st.timerVolver); clearTimeout(st.timerInactivo);
    st.fase = 'cedula'; st.cedula = ''; st.pin = ''; st.persona = null; st.accion = null; st.abierta = null; st.foto = null; st.intentos = 0;
    renderMarca();
    error('dc-marcar-error', '');
  }

  function renderMarca(){
    $('dc-cedula').textContent = st.cedula;
    $('dc-cedula').className = 'dc-campo' + (st.fase === 'cedula' ? ' activo' : '');
    var p = st.persona;
    $('dc-persona').innerHTML = p ? '<img src="img/avatares/' + (p.nivel === 1 ? 'medico' : 'enfermero') + '.svg" alt=""><div><b>' + escHtml(p.nombre) + '</b><span>' +
      (st.abierta ? 'Turno abierto desde ' + fechaHoraCO(st.abierta.entrada_at) + ' · marcará SALIDA' : 'Marcará ENTRADA') + '</span></div>' : '';
    $('dc-pin-wrap').className = st.fase === 'pin' ? '' : 'dc-oculto';
    var puntos = $('dc-pin').getElementsByTagName('i');
    for(var i = 0; i < puntos.length; i++) puntos[i].className = i < st.pin.length ? 'lleno' : '';
  }

  function tecla(t){
    clearTimeout(st.timerInactivo);
    st.timerInactivo = setTimeout(reiniciarMarca, INACTIVIDAD_MS);
    error('dc-marcar-error', '');
    if(st.fase === 'cedula'){
      if(t === 'borrar') st.cedula = st.cedula.slice(0, -1);
      else if(t === 'ok') { buscarPersona(); return; }
      else if(st.cedula.length < 15) st.cedula += t;
    } else {
      if(t === 'borrar'){
        if(!st.pin.length){ st.fase = 'cedula'; st.persona = null; st.abierta = null; }
        else st.pin = st.pin.slice(0, -1);
      } else if(t !== 'ok' && st.pin.length < 4){
        st.pin += t;
        if(st.pin.length === 4){ renderMarca(); validarPin(); return; }
      }
    }
    renderMarca();
  }

  function buscarPersona(){
    if(st.cedula.length < 5){ error('dc-marcar-error', 'Escribe tu número de cédula'); return; }
    var e = st.evento, p = null;
    for(var i = 0; i < e.personal.length; i++) if(e.personal[i].cedula === st.cedula) p = e.personal[i];
    if(!p){ error('dc-marcar-error', 'Esa cédula no está asignada a este evento'); return; }
    // ¿Tiene una jornada abierta (de cualquier evento) de menos de 16 h?
    var ab = st.abiertas[p.id], abierta = null;
    if(ab){
      if(ahora().getTime() - new Date(ab.entrada_at).getTime() <= MAX_JORNADA_MS) abierta = ab;
      else { delete st.abiertas[p.id]; guardarJSON('dc_abiertas', st.abiertas); }
    }
    if(!abierta && !(e.fecha_inicio <= fechaCO(ahora()) && e.fecha_fin >= fechaCO(ahora()))){
      error('dc-marcar-error', 'Este evento ya no admite entradas (terminó el ' + fmtFecha(e.fecha_fin) + ')');
      return;
    }
    if(!p.pin_hash){ error('dc-marcar-error', 'No tienes PIN de asistencia: pídelo al administrador'); return; }
    st.persona = p; st.abierta = abierta; st.accion = abierta ? 'salida' : 'entrada';
    st.fase = 'pin'; st.pin = '';
    renderMarca();
  }

  function validarPin(){
    var p = st.persona;
    if(sha256(p.pin_sal + ':' + st.pin) !== p.pin_hash){
      st.intentos++;
      st.pin = '';
      renderMarca();
      if(st.intentos >= 5){ error('dc-marcar-error', 'Demasiados intentos con PIN incorrecto'); setTimeout(reiniciarMarca, 4000); return; }
      error('dc-marcar-error', 'PIN incorrecto');
      return;
    }
    abrirFoto();
  }

  // ══════════════════════════════════════════
  // FOTO
  // ══════════════════════════════════════════
  function abrirFoto(){
    clearTimeout(st.timerInactivo);
    st.timerInactivo = setTimeout(cancelarMarca, INACTIVIDAD_MS);
    var p = st.persona, salida = st.accion === 'salida';
    var ev = salida ? buscarEvento(st.abierta.evento_id) : st.evento;
    $('dc-foto-persona').innerHTML = '<img src="img/avatares/' + (p.nivel === 1 ? 'medico' : 'enfermero') + '.svg" alt=""><div><b>' + escHtml(p.nombre) + '</b><span>' +
      escHtml(ev ? ev.nombre : '') + ' · ' + (salida ? 'entrada ' + fechaHoraCO(st.abierta.entrada_at) : fechaHoraCO(ahora())) + '</span></div>';
    var btn = $('dc-btn-marcar');
    btn.className = 'dc-btn ' + (salida ? 'azul' : 'verde');
    btn.innerHTML = '<img src="img/iconos/' + (salida ? 'salir' : 'iniciar-evento') + '.svg" alt="">Marcar ' + (salida ? 'SALIDA' : 'ENTRADA');
    st.foto = null;
    $('dc-camara').className = 'dc-camara';
    $('dc-foto-ayuda').textContent = '';
    mostrar('dc-marcar', false);
    mostrar('dc-foto', true);
    iniciarCamara();
  }

  // Cámara directa (Safari de iOS 11+). Si no se puede (por ejemplo la página
  // abierta desde un ícono de la pantalla de inicio en iOS 12), se usa la
  // cámara del sistema con el botón "Tomar foto".
  // Safari de iOS 12 pide permiso cada vez que se abre la cámara y no tiene
  // "Permitir siempre" (llegó en iOS 13): se abre una sola vez y se deja
  // encendida mientras la página siga abierta; las marcas siguientes la reusan.
  function camaraViva(){
    if(!st.stream) return false;
    var t = st.stream.getTracks();
    for(var i = 0; i < t.length; i++) if(t[i].readyState === 'ended') return false;
    return t.length > 0;
  }
  function camaraLista(video){
    video.style.display = 'block';
    var pr = video.play();
    if(pr && pr['catch']) pr['catch'](function(){});
    $('dc-camara-msg').textContent = '';
    $('dc-btn-marcar').disabled = false;
    $('dc-foto-ayuda').textContent = 'Mira a la cámara: la foto se toma al confirmar.';
  }
  function iniciarCamara(){
    var video = $('dc-video');
    var md = navigator.mediaDevices;
    if(camaraViva()){
      if(video.srcObject !== st.stream) video.srcObject = st.stream;
      camaraLista(video);
      return;
    }
    st.stream = null;
    if(!md || !md.getUserMedia){ modoTomarFoto(); return; }
    $('dc-camara-msg').textContent = 'Abriendo la cámara…';
    $('dc-btn-marcar').disabled = true;
    md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }).then(function(stream){
      st.stream = stream;
      video.srcObject = stream;
      camaraLista(video);
    })['catch'](function(){ modoTomarFoto(); });
  }

  function modoTomarFoto(){
    detenerCamara(true);
    $('dc-video').style.display = 'none';
    $('dc-camara-msg').textContent = 'Pulsa "Tomar foto" para abrir la cámara';
    mostrar('dc-btn-tomar', true);
    $('dc-btn-tomar').className = 'dc-btn dc-btn-sec';
    $('dc-btn-marcar').disabled = !st.foto;
    $('dc-foto-ayuda').textContent = 'Toma la foto y luego confirma la marca.';
  }

  // apagar = true: cierra la cámara (al salir o si falló). Si no, solo se
  // oculta y queda encendida para la próxima marca.
  function detenerCamara(apagar){
    if(apagar && st.stream){
      var t = st.stream.getTracks();
      for(var i = 0; i < t.length; i++) t[i].stop();
      st.stream = null;
    }
    var v = $('dc-video');
    if(v && apagar){ v.srcObject = null; }
    if($('dc-btn-tomar')) $('dc-btn-tomar').className = 'dc-btn dc-btn-sec dc-oculto';
  }

  // Foto reducida a 320 px de ancho, JPEG (~20-30 KB): cabe en la tablet sin conexión
  function aJpeg(fuente, ancho, alto, espejo){
    var c = $('dc-canvas'), w = 320, h = Math.round(320 * alto / ancho);
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    if(espejo){ ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(fuente, 0, 0, w, h);
    try { return c.toDataURL('image/jpeg', 0.6); } catch(e){ return null; }
  }

  function capturarVideo(){
    var v = $('dc-video');
    if(!st.stream || !v.videoWidth) return null;
    return aJpeg(v, v.videoWidth, v.videoHeight, true);
  }

  function fotoElegida(){
    var f = $('dc-foto-input').files && $('dc-foto-input').files[0];
    if(!f) return;
    var lector = new FileReader();
    lector.onload = function(){
      var img = new Image();
      img.onload = function(){
        st.foto = aJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height, false);
        $('dc-foto-previa').src = st.foto || '';
        $('dc-camara').className = 'dc-camara' + (st.foto ? ' con-foto' : '');
        $('dc-camara-msg').textContent = '';
        $('dc-btn-marcar').disabled = !st.foto;
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(f);
    $('dc-foto-input').value = '';
  }

  function cancelarMarca(){
    detenerCamara();
    mostrar('dc-foto', false);
    mostrar('dc-marcar', true);
    reiniciarMarca();
  }

  // ══════════════════════════════════════════
  // MARCAR
  // ══════════════════════════════════════════
  function confirmarMarca(){
    if(st.stream) st.foto = capturarVideo() || st.foto;
    if(!st.foto){ toast('Falta la foto', 'error'); return; }
    detenerCamara();
    var p = st.persona, salida = st.accion === 'salida', fecha = new Date().toISOString();
    var m = {
      client_id: nuevoId(), tipo: st.accion, usuario_id: p.id, pin: st.pin, fecha: fecha, foto: st.foto,
      evento_id: salida ? st.abierta.evento_id : st.evento.id
    };
    if(salida) m.jornada_client_id = st.abierta.jornada_client_id;
    st.cola.push(m);
    if(!guardarJSON('dc_cola', st.cola)){
      // Sin espacio: se guarda sin foto antes que perder la marca
      m.foto = null;
      if(!guardarJSON('dc_cola', st.cola)){
        st.cola.pop();
        modal('No hay espacio en la tablet', 'La marca NO se guardó. Sincroniza las marcas pendientes e intenta de nuevo.', [{ texto: 'Entendido', clase: 'primario' }]);
        return;
      }
      toast('Tablet llena: la marca se guardó sin foto. Sincroniza pronto.', 'error');
    }
    aplicarMarcaLocal(st.abiertas, m);
    guardarJSON('dc_abiertas', st.abiertas);
    mostrarRegistrada(m, salida ? st.abierta.entrada_at : null, p);
    renderModo();
    if(!st.offline) sincronizar(true);
  }

  function mostrarRegistrada(m, entradaAt, p){
    var salida = m.tipo === 'salida';
    var html = '<div class="dc-ok-circ' + (salida ? ' salida' : '') + '">' + (salida ? '→' : '✓') + '</div>' +
      '<div class="dc-ok-tit">¡' + (salida ? 'Salida' : 'Entrada') + ' registrada!</div>' +
      '<div class="dc-ok-txt">' + escHtml(p.nombre) + '</div>';
    if(salida){
      html += '<div class="dc-ok-txt">Entrada <span class="dc-chip">' + fechaHoraCO(entradaAt) + '</span> → Salida <span class="dc-chip">' + fechaHoraCO(m.fecha) + '</span></div>' +
        '<div class="dc-ok-dur">' + duracion(new Date(m.fecha).getTime() - new Date(entradaAt).getTime()) + ' trabajadas</div>';
    } else {
      html += '<div class="dc-ok-txt"><span class="dc-chip">' + horaCO(m.fecha) + '</span></div>' +
        '<div class="dc-ok-nota">Recuerda marcar la salida al terminar tu turno (máximo 16 h).</div>';
    }
    if(st.offline) html += '<div class="dc-ok-nota pend">Guardada en la tablet: se subirá al sincronizar.</div>';
    $('dc-ok').innerHTML = html;
    mostrar('dc-foto', false);
    mostrar('dc-ok', true);
    clearTimeout(st.timerInactivo);
    st.timerVolver = setTimeout(volverAMarcar, VOLVER_MS);
  }

  function volverAMarcar(){
    mostrar('dc-ok', false);
    if(st.evento) abrirEvento(st.evento); else renderEventos();
  }

  // Sube la cola por lotes. silencioso: sin avisos si todo va bien.
  function sincronizar(silencioso){
    if(st.enviando || !st.cola.length) { if(!silencioso && !st.cola.length) toast('No hay marcas por subir'); return; }
    st.enviando = true;
    renderModo();
    var subidas = 0, rechazadas = [];
    function lote(){
      if(!st.cola.length){ terminar(false); return; }
      var envio = st.cola.slice(0, LOTE), ahoraMs = new Date().getTime();
      for(var i = 0; i < envio.length; i++) envio[i].offline = ahoraMs - new Date(envio[i].fecha).getTime() > 120000;
      api('POST', '/api/asistencia/kiosco/marcas', { marcas: envio, reloj_tablet: new Date().toISOString() }, function(err, r){
        if(err){
          if(sesionCerrada(err)){ st.enviando = false; pantallaActivar(err.message); return; }
          terminar(true, err);
          return;
        }
        var res = r.resultados || [], quitar = {}, reintentar = false;
        for(var k = 0; k < res.length; k++){
          var x = res[k];
          if(x.estado === 'ok' || x.estado === 'duplicado'){ quitar[x.client_id] = true; subidas++; }
          else if(x.reintentar){ reintentar = true; }
          else { quitar[x.client_id] = true; rechazadas.push({ client_id: x.client_id, error: x.error }); }
        }
        var resto = [], rech = leerJSON('dc_rechazadas') || [];
        for(var q = 0; q < st.cola.length; q++){
          var m = st.cola[q];
          if(!quitar[m.client_id]) { resto.push(m); continue; }
          for(var z = 0; z < rechazadas.length; z++) if(rechazadas[z].client_id === m.client_id){
            rech.push({ nombre: nombrePersona(m.usuario_id), tipo: m.tipo, fecha: m.fecha, error: rechazadas[z].error });
            // Entrada rechazada: la persona ya no tiene esa jornada abierta
            if(m.tipo === 'entrada' && st.abiertas[m.usuario_id] && st.abiertas[m.usuario_id].jornada_client_id === m.client_id) delete st.abiertas[m.usuario_id];
          }
        }
        st.cola = resto;
        guardarJSON('dc_cola', st.cola);
        guardarJSON('dc_rechazadas', rech.slice(-50));
        guardarJSON('dc_abiertas', st.abiertas);
        if(reintentar){ terminar(true, new Error('El servidor no pudo registrar algunas marcas: se reintentará')); return; }
        lote();
      });
    }
    function terminar(conError, err){
      st.enviando = false;
      renderModo();
      if(rechazadas.length) toast(rechazadas.length + ' marca' + (rechazadas.length !== 1 ? 's' : '') + ' rechazada' + (rechazadas.length !== 1 ? 's' : '') + ': ' + rechazadas[0].error, 'error');
      else if(conError && !silencioso) toast(err.sinRed ? 'Sin conexión: las marcas siguen guardadas en la tablet' : err.message, 'error');
      else if(!conError && !silencioso && subidas) toast('✓ Se subieron ' + subidas + ' marca' + (subidas !== 1 ? 's' : ''));
    }
    lote();
  }

  function nombrePersona(id){
    var evs = (st.paquete && st.paquete.eventos) || [];
    for(var i = 0; i < evs.length; i++) for(var j = 0; j < evs[i].personal.length; j++) if(evs[i].personal[j].id === id) return evs[i].personal[j].nombre;
    return 'Persona ' + id;
  }

  function verRechazadas(){
    var rech = leerJSON('dc_rechazadas') || [], html = '<ul>';
    for(var i = rech.length - 1; i >= 0; i--) html += '<li><strong>' + escHtml(rech[i].nombre) + '</strong> · ' + (rech[i].tipo === 'salida' ? 'Salida' : 'Entrada') + ' ' +
      fechaHoraCO(rech[i].fecha) + ' — ' + escHtml(rech[i].error) + '</li>';
    modal('Marcas rechazadas por el servidor', html + '</ul><p>El administrador puede revisarlas en el módulo Asistencias.</p>',
      [{ texto: 'Borrar lista', accion: function(){ guardar('dc_rechazadas', null); renderModo(); } }, { texto: 'Cerrar', clase: 'primario' }]);
  }

  // ══════════════════════════════════════════
  // ARRANQUE
  // ══════════════════════════════════════════
  function closestData(el, attr){
    while(el && el !== document.body){ if(el.getAttribute && el.getAttribute(attr) !== null) return el; el = el.parentNode; }
    return null;
  }

  function prepararSinSenal(){
    var ac = window.applicationCache;
    if(ac && typeof ac.status === 'number'){
      on(ac, 'updateready', function(){ try { ac.swapCache(); } catch(e){} if(!st.persona) window.location.reload(); });
      return;
    }
    if(navigator.serviceWorker){
      var habia = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('/sw-datacontrol.js', { scope: '/datacontrol' })['catch'](function(){});
      on(navigator.serviceWorker, 'controllerchange', function(){ if(habia && !st.persona) window.location.reload(); });
    }
  }

  function conectar(){
    on($('dc-activar-form'), 'submit', activar);
    // Teclado: cada toque cuenta al instante, aunque sean seguidos (Safari
    // hacía zoom con el doble toque). preventDefault evita el zoom y el
    // "click" duplicado; con mouse sigue funcionando el click.
    on($('dc-teclado'), 'touchend', function(e){
      var t = closestData(e.target, 'data-tecla');
      if(!t) return;
      e.preventDefault();
      tecla(t.getAttribute('data-tecla'));
    });
    // Resto de la pantalla: sin zoom por doble toque ni por pellizco
    var ultimoToque = 0;
    on(document, 'touchend', function(e){
      var ahora = new Date().getTime();
      if(ahora - ultimoToque < 350 && !closestData(e.target, 'data-tecla') && e.target.tagName !== 'INPUT') e.preventDefault();
      ultimoToque = ahora;
    });
    on(document, 'gesturestart', function(e){ e.preventDefault(); });
    on(document.body, 'click', function(e){
      var t = closestData(e.target, 'data-tecla');
      if(t){ tecla(t.getAttribute('data-tecla')); return; }
      var ev = closestData(e.target, 'data-evento');
      if(ev){ var x = buscarEvento(parseInt(ev.getAttribute('data-evento'), 10)); if(x) abrirEvento(x); return; }
      var b = closestData(e.target, 'data-boton');
      if(b){ mostrar('dc-modal', false); var acc = _modalAcciones[parseInt(b.getAttribute('data-boton'), 10)]; if(acc && acc.accion) acc.accion(); return; }
      var a = closestData(e.target, 'data-accion');
      if(!a || a.disabled) return;
      var accion = a.getAttribute('data-accion');
      if(accion === 'salir') pedirSalir();
      else if(accion === 'cambiar-evento') renderEventos();
      else if(accion === 'cancelar-marca') cancelarMarca();
      else if(accion === 'tomar-foto') $('dc-foto-input').click();
      else if(accion === 'confirmar-marca') confirmarMarca();
      else if(accion === 'sincronizar') sincronizar(false);
      else if(accion === 'offline') pasarOffline();
      else if(accion === 'en-linea') volverEnLinea();
      else if(accion === 'ver-rechazadas') verRechazadas();
      else if(accion === 'reintentar') descargar(function(){ elegirEventoInicial(); });
    });
    on($('dc-foto-input'), 'change', fotoElegida);
    // Datos frescos cada 10 minutos (en línea) y reintento de la cola
    setInterval(function(){
      if(st.offline || !leer('dc_token') || st.persona) return;
      descargar(function(ok){ if(ok && st.cola.length) sincronizar(true); if(ok && !st.evento) elegirEventoInicial(); }, true);
    }, 10 * 60000);
  }

  conectar();
  prepararSinSenal();
  if(leer('dc_token')) iniciarApp(); else pantallaActivar('');
})();
