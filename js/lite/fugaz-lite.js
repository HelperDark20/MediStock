/* ══════════════════════════════════════════
   ATENCIÓN DE PACIENTES FUGACES — panel de enfermero (enfermero.html)

   Pacientes que no quieren ir al punto de atención y se atienden donde
   están. Registro corto: tipo y número de documento, nombre completo,
   motivo, procedimiento e insumos. Sin medicamentos ni suturas: solo
   insumos de los botiquines tipo 1 ("BTQ I-…") asignados al enfermero en
   el evento.

   La atención se guarda completa de una vez (con sus insumos) en
   POST /api/fugaces. Sin conexión queda en la tablet y sale con el botón
   Sincronizar (POST /api/fugaces/sincronizar; es seguro repetir).

   ES5 a propósito (iPad con iOS 9): ver la nota de enfermero-lite.js.

   Datos en el dispositivo (U = id del usuario):
     nb_fug_U     atenciones guardadas sin conexión (por enviar)
     nb_fugenv_U  resumen de las enviadas (nombre y hora) por evento
   ══════════════════════════════════════════ */
var FugazLite = (function(){
  'use strict';

  var U = null, st = null;
  var TIPOS_DOC = [['CC','CC'],['TI','TI'],['CE','CE'],['PAS','PAS'],['RC','RC'],['PPT','PPT'],['OTRO','Otro']];
  var TIPOS_ALFANUM = { PAS: true, OTRO: true };
  var MAX_RESULTADOS = 40;
  var MAX_INSUMOS = 30;
  var LOTE = 20;

  var f = null;        // atención abierta en el formulario
  var pick = null;     // selector de insumo { bodegaId, q, idx, cantidad }

  // ── Utilidades ──
  function txt(v){ return String(v === undefined || v === null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function digitos(v){ return String(v || '').replace(/\D/g, ''); }
  function mayus(v){ return txt(v).toUpperCase(); }

  // Botiquín tipo 1: "BTQ I-01 CALLE SABOR", "BTQ I-02 AC"… (no BTQ II)
  function esBotiquinTipo1(nombre){
    return /^BTQ ?I-/.test(String(nombre || '').toUpperCase().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''));
  }
  function esMedicamento(item){
    var fam = String((item && item.familia) || '').toUpperCase().replace(/^\s+|\s+$/g, '').replace(/Á/g, 'A');
    return fam === 'MED' || fam.indexOf('MEDICAMENT') === 0 || fam.indexOf('FARMAC') === 0;
  }
  function esSutura(item){
    return /SUTUR/.test(String((item && item.nombre) || '').toUpperCase()) || /SUTUR/.test(String((item && item.familia) || '').toUpperCase());
  }
  function insumoPermitido(item){ return !esMedicamento(item) && !esSutura(item); }

  function textoDeRelleno(v){
    var s = String(v || '').toUpperCase();
    var solo = s.replace(/[^A-ZÁÉÍÓÚÜÑ0-9]/g, '');
    if(solo.length >= 2 && /^(.)\1*$/.test(solo)) return true;
    return /([A-ZÁÉÍÓÚÜÑ])\1\1/.test(s);
  }
  function secuencia(d){
    if(d.length < 3) return false;
    var sube = true, baja = true;
    for(var i = 1; i < d.length; i++){
      if(+d.charAt(i) !== +d.charAt(i - 1) + 1) sube = false;
      if(+d.charAt(i) !== +d.charAt(i - 1) - 1) baja = false;
    }
    return sube || baja;
  }
  function documentoDeRelleno(v){
    var d = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(d.length < 3) return false;
    return /^(.)\1*$/.test(d) || (/^\d+$/.test(d) && secuencia(d));
  }

  // ── Almacenamiento ──
  function leerPendientes(idUsuario){ return U.leerJSON(U.claveUsuario('fug', idUsuario)) || []; }
  function guardarPendientes(lista){ return U.guardarJSON(U.claveUsuario('fug'), lista); }
  function leerEnviadas(){ return U.leerJSON(U.claveUsuario('fugenv')) || []; }
  function guardarEnviadas(lista){ U.guardarJSON(U.claveUsuario('fugenv'), lista); }

  function botiquines(){
    var b = (st.evento && st.evento.bodegas) || [], out = [];
    for(var i = 0; i < b.length; i++) if(esBotiquinTipo1(b[i].nombre)) out.push(b[i]);
    return out;
  }
  function botiquinSel(){
    var b = botiquines();
    for(var i = 0; i < b.length; i++) if(b[i].id === pick.bodegaId) return b[i];
    return null;
  }
  // Ya agregado al formulario (para no pasarse del disponible)
  function yaAgregado(subSkuId, bodegaId){
    var n = 0;
    for(var i = 0; i < f.insumos.length; i++){
      if(f.insumos[i].sub_sku_id === subSkuId && f.insumos[i].bodega_origen_id === bodegaId) n += f.insumos[i].cantidad;
    }
    return n;
  }

  // ══════════════════════════════════════════
  // LISTA (pantalla de inicio de Historias clínicas)
  // ══════════════════════════════════════════
  function renderLista(){
    var cont = U.$('lt-fug-lista');
    if(!cont || !st.usuario) return;
    var pend = leerPendientes(st.usuario.id), env = leerEnviadas(), html = '';
    var evId = st.evento ? st.evento.id : null;
    for(var i = 0; i < pend.length; i++){
      var a = pend[i];
      html += '<div class="lt-hc-item">' +
        '<div class="lt-hc-item-txt">' +
          '<div class="lt-hc-item-nombre">' + U.escHtml(a.nombre) +
            (a.error ? '<span class="lt-pend error">Revisar</span>' : '<span class="lt-pend">Pendiente de envío</span>') + '</div>' +
          '<div class="lt-hc-item-meta">' + U.escHtml(a.tipo_doc + ' ' + a.documento) + ' · ' + U.fmtFecha(U.fechaCO(a.fecha_atencion)) + ' ' + U.horaCO(a.fecha_atencion) + '</div>' +
          (a.error ? '<div class="lt-hist-error">' + U.escHtml(a.error) + '</div>' : '') +
        '</div>' +
        '<div class="lt-hc-item-btns">' +
          (a.error ? '<button type="button" class="lt-btn-sec primario" data-fug="corregir" data-id="' + U.escHtml(a.client_id) + '">Corregir</button>' +
                     '<button type="button" class="lt-btn-sec peligro" data-fug="descartar" data-id="' + U.escHtml(a.client_id) + '">Descartar</button>' : '') +
        '</div></div>';
    }
    var n = 0;
    for(var j = 0; j < env.length; j++){
      var e = env[j];
      if(e.evento_id !== evId) continue;
      n++;
      html += '<div class="lt-hc-item lt-hc-item-env">' +
        '<div class="lt-hc-item-txt">' +
          '<div class="lt-hc-item-nombre">' + U.escHtml(e.nombre) + '<span class="lt-pend ok">Enviada</span></div>' +
          '<div class="lt-hc-item-meta">' + U.fmtFecha(U.fechaCO(e.fecha_atencion)) + ' ' + U.horaCO(e.fecha_atencion) +
            (e.insumos ? ' · ' + e.insumos + ' insumo' + (e.insumos !== 1 ? 's' : '') : ' · sin insumos') + '</div>' +
        '</div></div>';
    }
    cont.innerHTML = html || '<div class="lt-vacio">No has registrado atenciones fugaces en este evento.</div>';
  }

  // Resumen de las enviadas: se guarda solo nombre, hora e insumos, y se
  // borra cuando el evento ya no está en curso
  function anotarEnviada(a){
    var env = leerEnviadas(), activos = {}, out = [];
    for(var i = 0; i < (st.eventos || []).length; i++) activos[st.eventos[i].id] = true;
    for(var j = 0; j < env.length; j++){
      if(env[j].client_id === a.client_id) continue;
      if(st.offline || activos[env[j].evento_id]) out.push(env[j]);
    }
    out.unshift({ client_id: a.client_id, evento_id: a.evento_id, nombre: a.nombre, fecha_atencion: a.fecha_atencion, insumos: a.insumos.length });
    guardarEnviadas(out.slice(0, 300));
  }

  // ══════════════════════════════════════════
  // FORMULARIO
  // ══════════════════════════════════════════
  function nueva(){
    if(!st.evento){ U.toast('Elige primero el evento', 'error'); return; }
    f = { client_id: U.nuevoClientId(), evento_id: st.evento.id, tipo_doc: '', documento: '', nombre: '', motivo: '', procedimiento: '', insumos: [], error: '' };
    pick = { bodegaId: null, q: '', idx: null, cantidad: '' };
    abrirEditor();
  }

  // Una pendiente que el servidor rechazó: se corrige y se vuelve a enviar
  function corregir(clientId){
    var pend = leerPendientes(st.usuario.id);
    for(var i = 0; i < pend.length; i++){
      if(pend[i].client_id !== clientId) continue;
      f = JSON.parse(JSON.stringify(pend[i]));
      f.corrigiendo = true;
      pick = { bodegaId: null, q: '', idx: null, cantidad: '' };
      abrirEditor();
      return;
    }
  }

  function abrirEditor(){
    U.mostrar('lt-hc-inicio', false);
    U.mostrar('lt-hc-editor', false);
    U.mostrar('lt-fug-editor', true);
    render();
    window.scrollTo(0, 0);
  }

  function cerrar(){
    f = null; pick = null;
    U.mostrar('lt-fug-editor', false);
    U.mostrar('lt-hc-inicio', true);
    renderLista();
  }

  function pedirCerrar(){
    if(f && (txt(f.documento) || txt(f.nombre) || txt(f.motivo) || txt(f.procedimiento) || f.insumos.length) && !f.corrigiendo){
      U.modal('Salir sin guardar', '¿Salir de la atención fugaz sin guardarla? Se pierde lo que escribiste.',
        [{ texto: 'Seguir aquí' }, { texto: 'Salir sin guardar', clase: 'peligro', accion: cerrar }]);
      return;
    }
    cerrar();
  }

  function campoTexto(clave, etiqueta, opts){
    opts = opts || {};
    var v = f[clave] || '';
    var attrs = ' data-fug-campo="' + clave + '" maxlength="' + (opts.max || 120) + '"' + (opts.ph ? ' placeholder="' + U.escHtml(opts.ph) + '"' : '');
    return '<label class="lt-label">' + etiqueta + ' <span class="lt-req">*</span></label>' +
      (opts.area
        ? '<textarea class="lt-input lt-area lt-mayus" autocapitalize="characters" rows="' + (opts.filas || 3) + '"' + attrs + '>' + U.escHtml(v) + '</textarea>'
        : '<input class="lt-input' + (opts.mayus ? ' lt-mayus' : '') + '" type="' + (opts.tel ? 'tel' : 'text') + '"' + (opts.tel ? ' pattern="[0-9]*"' : '') +
          (opts.mayus ? ' autocapitalize="characters"' : '') + ' autocomplete="off" autocorrect="off" spellcheck="false"' + attrs + ' value="' + U.escHtml(v) + '">');
  }

  function render(){
    var cont = U.$('lt-fug-cuerpo');
    if(!cont || !f) return;
    var html = '<div class="lt-aviso">Paciente que se atiende donde está (no va al punto de atención). <strong>Solo insumos del botiquín tipo 1 (BTQ I)</strong>: no se registran medicamentos ni suturas.</div>';

    var chips = '<div class="lt-chips">';
    for(var i = 0; i < TIPOS_DOC.length; i++){
      chips += '<button type="button" class="lt-chip' + (f.tipo_doc === TIPOS_DOC[i][0] ? ' sel' : '') + '" data-fug="tipo" data-v="' + TIPOS_DOC[i][0] + '">' + TIPOS_DOC[i][1] + '</button>';
    }
    chips += '</div>';
    html += '<div class="lt-card"><div class="lt-card-title">Paciente</div>' +
      '<label class="lt-label">Tipo de documento <span class="lt-req">*</span></label>' + chips +
      campoTexto('documento', 'Número de documento', { max: 20, tel: !TIPOS_ALFANUM[f.tipo_doc], mayus: !!TIPOS_ALFANUM[f.tipo_doc], ph: 'Ej. 1006166884' }) +
      campoTexto('nombre', 'Nombre completo', { max: 120, mayus: true, ph: 'NOMBRES Y APELLIDOS' }) +
      '</div>';

    html += '<div class="lt-card"><div class="lt-card-title">Atención</div>' +
      campoTexto('motivo', 'Motivo', { area: true, max: 1000 }) +
      campoTexto('procedimiento', 'Procedimiento realizado', { area: true, max: 1000, ph: 'Ej. CURACIÓN DE HERIDA, VALORACIÓN, CRIOTERAPIA' }) +
      '</div>';

    html += '<div class="lt-card"><div class="lt-card-title">Administración de insumos</div>' + listaInsumos() + selector() + '</div>';

    html += '<div class="lt-error' + (f.error ? ' on' : '') + '">' + U.escHtml(f.error) + '</div>' +
      '<button type="button" class="lt-btn lt-fug-guardar" data-fug="guardar"' + (f.enviando ? ' disabled' : '') + '>' +
        (f.enviando ? 'Guardando…' : 'Guardar atención fugaz') + '</button>';
    cont.innerHTML = html;
  }

  function redibujar(){
    var y = window.pageYOffset || 0;
    render();
    window.scrollTo(0, y);
  }

  function listaInsumos(){
    if(!f.insumos.length) return '<div class="lt-muted">Si no usaste insumos, déjalo vacío.</div>';
    var html = '';
    for(var i = 0; i < f.insumos.length; i++){
      var m = f.insumos[i];
      html += '<div class="lt-med">' +
        '<div class="lt-med-txt">' +
          '<div class="lt-med-nombre">' + U.escHtml(m.nombre) + '</div>' +
          '<div class="lt-med-meta"><strong>' + m.cantidad + ' ' + U.escHtml(m.unidad || '') + '</strong> · ' + U.escHtml(m.bodega_nombre) + '</div>' +
        '</div>' +
        '<button type="button" class="lt-btn-sec peligro lt-med-quitar" data-fug="quitar" data-i="' + i + '">Quitar</button>' +
      '</div>';
    }
    return html;
  }

  function selector(){
    var bs = botiquines();
    if(!bs.length){
      return '<div class="lt-aviso">No tienes botiquines tipo 1 (BTQ I) asignados en este evento: puedes guardar la atención sin insumos. Si necesitas uno, contacta al administrador.</div>';
    }
    if(f.insumos.length >= MAX_INSUMOS) return '';
    if(bs.length === 1 && !pick.bodegaId) pick.bodegaId = bs[0].id;
    var html = '<div class="lt-subtitulo">Agregar insumo</div><label class="lt-label">Botiquín</label><div class="lt-chips">';
    for(var i = 0; i < bs.length; i++){
      html += '<button type="button" class="lt-chip' + (bs[i].id === pick.bodegaId ? ' sel' : '') + '" data-fug="botiquin" data-id="' + bs[i].id + '">' + U.escHtml(bs[i].nombre) + '</button>';
    }
    html += '</div>';
    var b = botiquinSel();
    if(!b) return html;
    var item = pick.idx !== null ? st.stock[pick.idx] : null;
    if(!item){
      return html + '<label class="lt-label">Buscar insumo</label>' +
        '<input class="lt-input" type="text" id="lt-fug-buscar" data-fug-buscar="1" placeholder="Nombre, SKU, lote…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="' + U.escHtml(pick.q) + '">' +
        '<div class="lt-resultados" id="lt-fug-res">' + resultados() + '</div>';
    }
    var disp = item.cantidad - yaAgregado(item.sub_sku_id, b.id);
    return html + '<div class="lt-card lt-item on">' +
        '<div class="lt-item-name">' + U.escHtml(item.nombre) + '</div>' +
        '<div class="lt-item-sub">' + U.escHtml((item.sku_global || '') + ' · ' + (item.sub_sku || '')) + (item.lote ? ' · Lote ' + U.escHtml(item.lote) : '') +
          ' · Vence ' + U.fmtFecha(item.caducidad) + U.semHtml(item.caducidad) + '</div>' +
        '<div class="lt-item-stock">Disponible en ' + U.escHtml(b.nombre) + ': <strong>' + disp + '</strong> ' + U.escHtml(item.unidad || '') +
          (st.offline ? ' <span class="lt-pend">según datos descargados</span>' : '') + '</div>' +
        '<button class="lt-link" type="button" data-fug="cambiar">Cambiar insumo</button>' +
      '</div>' +
      '<label class="lt-label">Cantidad (' + U.escHtml(item.unidad || 'unidades') + ') <span class="lt-req">*</span></label>' +
      '<input class="lt-input lt-cantidad" type="tel" pattern="[0-9]*" maxlength="4" data-fug-cantidad="1" value="' + U.escHtml(pick.cantidad) + '" placeholder="0">' +
      '<div class="lt-error' + (pick.error ? ' on' : '') + '">' + U.escHtml(pick.error || '') + '</div>' +
      '<button type="button" class="lt-btn-sec primario" data-fug="agregar">+ Agregar insumo</button>';
  }

  function resultados(){
    var b = botiquinSel();
    if(!b) return '';
    var q = String(pick.q || '').toLowerCase().replace(/^\s+|\s+$/g, ''), html = '', n = 0, total = 0;
    for(var i = 0; i < st.stock.length; i++){
      var r = st.stock[i];
      if(r.bodega_nombre !== b.nombre || r.cantidad <= 0 || !insumoPermitido(r)) continue;
      total++;
      if(!q || n >= MAX_RESULTADOS) continue;
      if([r.nombre, r.sku_global, r.sub_sku, r.lote, r.proveedor].join(' ').toLowerCase().indexOf(q) === -1) continue;
      n++;
      html += '<button type="button" class="lt-res" data-fug="item" data-idx="' + i + '">' +
        '<span class="lt-res-cant">' + r.cantidad + ' ' + U.escHtml(r.unidad || '') + '</span>' +
        '<span class="lt-res-name">' + U.escHtml(r.nombre) + '</span>' +
        '<span class="lt-res-meta">Insumo · ' + U.escHtml(r.sku_global || '') + (r.lote ? ' · Lote ' + U.escHtml(r.lote) : '') +
        ' · Vence ' + U.fmtFecha(r.caducidad) + U.semHtml(r.caducidad) + '</span></button>';
    }
    if(!q) return '<div class="lt-vacio">' + (total ? total + ' insumo' + (total !== 1 ? 's' : '') + ' con stock en este botiquín. Escribe para buscar.' : 'No hay insumos con stock en este botiquín') + '</div>';
    return html || '<div class="lt-vacio">Sin resultados para "' + U.escHtml(q) + '"</div>';
  }

  function agregar(){
    var b = botiquinSel(), item = pick.idx !== null ? st.stock[pick.idx] : null;
    if(!b || !item) return;
    var cant = parseInt(digitos(pick.cantidad), 10) || 0;
    var disp = item.cantidad - yaAgregado(item.sub_sku_id, b.id);
    pick.error = cant <= 0 ? 'Ingresa la cantidad usada'
      : cant > disp ? 'Solo hay ' + disp + ' ' + (item.unidad || '') + ' disponibles en este botiquín' : '';
    if(pick.error){ redibujar(); return; }
    f.insumos.push({ sub_sku_id: item.sub_sku_id, bodega_origen_id: b.id, bodega_nombre: b.nombre,
      nombre: item.nombre, unidad: item.unidad || '', cantidad: cant });
    pick.idx = null; pick.q = ''; pick.cantidad = ''; pick.error = '';
    redibujar();
  }

  function validar(){
    var alfa = !!TIPOS_ALFANUM[f.tipo_doc];
    var doc = alfa ? mayus(f.documento).replace(/[^A-Z0-9-]/g, '') : digitos(f.documento);
    var nom = mayus(f.nombre).replace(/\s+/g, ' ');
    if(!f.tipo_doc) return 'Selecciona el tipo de documento del paciente';
    if(doc.length < (alfa ? 3 : 5)) return 'Escribe el número de documento del paciente';
    if(documentoDeRelleno(doc)) return 'El número de documento del paciente no es válido (parece un dato de relleno)';
    if(nom.length < 5 || nom.indexOf(' ') < 0 || !/^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'-]*$/.test(nom) || textoDeRelleno(nom)) return 'Escribe el nombre completo del paciente: nombres y apellidos, solo letras';
    if(txt(f.motivo).length < 3 || textoDeRelleno(f.motivo)) return 'Escribe el motivo de la atención';
    if(txt(f.procedimiento).length < 3 || textoDeRelleno(f.procedimiento)) return 'Escribe el procedimiento realizado';
    if(pick && pick.idx !== null) return 'Tienes un insumo sin agregar: pulsa "+ Agregar insumo" o "Cambiar insumo"';
    return '';
  }

  function paraEnviar(a){
    var ins = [];
    for(var i = 0; i < a.insumos.length; i++){
      ins.push({ sub_sku_id: a.insumos[i].sub_sku_id, bodega_origen_id: a.insumos[i].bodega_origen_id, cantidad: a.insumos[i].cantidad });
    }
    return { client_id: a.client_id, evento_id: a.evento_id, tipo_doc: a.tipo_doc, documento: a.documento, nombre: a.nombre,
      motivo: a.motivo, procedimiento: a.procedimiento, insumos: ins, fecha_atencion: a.fecha_atencion };
  }

  function descontar(a){
    for(var i = 0; i < a.insumos.length; i++) U.descontarLocal(a.insumos[i]);
    U.guardarPaquete();
  }

  function guardar(){
    f.error = validar();
    if(f.error){ redibujar(); return; }
    var alfa = !!TIPOS_ALFANUM[f.tipo_doc];
    var a = {
      client_id: f.client_id, evento_id: f.evento_id, tipo_doc: f.tipo_doc,
      documento: alfa ? mayus(f.documento).replace(/[^A-Z0-9-]/g, '') : digitos(f.documento),
      nombre: mayus(f.nombre).replace(/\s+/g, ' '), motivo: mayus(f.motivo), procedimiento: mayus(f.procedimiento),
      insumos: f.insumos, fecha_atencion: f.fecha_atencion || new Date().toISOString()
    };
    if(st.offline){ encolar(a); return; }
    f.enviando = true;
    redibujar();
    U.api('POST', '/api/fugaces', paraEnviar(a), function(err){
      if(!f || f.client_id !== a.client_id) return;
      f.enviando = false;
      if(!err){
        // Corrigiendo una pendiente: sus insumos ya se habían descontado en
        // la tablet; se devuelven y se descuentan los corregidos
        if(f.corrigiendo){ quitarPendiente(a.client_id, true); U.renderModo(); }
        descontar(a);
        anotarEnviada(a);
        U.toast('✓ Atención fugaz guardada', 'ok');
        cerrar();
        return;
      }
      if(err.sinRed){
        U.modal('Sin conexión',
          'No se pudo enviar la atención. ¿Quieres <strong>guardarla en esta tablet y pasar a modo offline</strong>? La subirás con el botón <strong>Sincronizar</strong>.',
          [{ texto: 'No, intentar después', accion: redibujar },
           { texto: 'Guardar y trabajar offline', clase: 'primario', accion: function(){
             st.offline = true;
             U.guardarModo('offline');
             encolar(a);
           } }]);
        return;
      }
      if(U.sesionVencida(err)){ f.error = 'Tu sesión venció y la atención NO se guardó. Sal, vuelve a ingresar y regístrala de nuevo.'; redibujar(); return; }
      f.error = err.message + ' — la atención NO se guardó.';
      redibujar();
    });
  }

  function encolar(a){
    if(f.corrigiendo) quitarPendiente(a.client_id, true);
    var pend = leerPendientes(st.usuario.id);
    pend.push(a);
    if(!guardarPendientes(pend)){
      f.error = 'No hay espacio para guardar en esta tablet. La atención NO se guardó: sincroniza los pendientes.';
      redibujar();
      return;
    }
    descontar(a);
    U.renderModo();
    U.toast('Atención guardada en la tablet: se subirá al sincronizar', 'ok');
    cerrar();
  }

  // devolver: true → devuelve al stock local lo que se había descontado
  function quitarPendiente(clientId, devolver){
    var pend = leerPendientes(st.usuario.id), resto = [];
    for(var i = 0; i < pend.length; i++){
      if(pend[i].client_id !== clientId){ resto.push(pend[i]); continue; }
      if(devolver) for(var j = 0; j < pend[i].insumos.length; j++) U.devolverLocal(pend[i].insumos[j]);
    }
    guardarPendientes(resto);
  }

  function pedirDescartar(clientId){
    U.modal('Descartar atención fugaz', '¿Descartar esta atención? Se borra de la tablet y no se registra.',
      [{ texto: 'Cancelar' }, { texto: 'Descartar', clase: 'peligro', accion: function(){
        quitarPendiente(clientId, true);
        renderLista();
        U.renderModo();
      } }]);
  }

  // ══════════════════════════════════════════
  // SINCRONIZAR (lo llama enfermero-lite.js)
  // cb({ total, enviadas, errores, sinRed, sesion, error })
  // ══════════════════════════════════════════
  function sincronizar(cb){
    var pend = leerPendientes(st.usuario.id), envio = [], res = { total: 0, enviadas: 0, errores: 0 };
    for(var i = 0; i < pend.length && envio.length < LOTE; i++) if(!pend[i].error) envio.push(paraEnviar(pend[i]));
    res.total = envio.length;
    if(!envio.length){ cb(res); return; }
    U.api('POST', '/api/fugaces/sincronizar', { atenciones: envio }, function(err, data){
      if(err){
        if(U.sesionVencida(err)) res.sesion = true;
        else if(err.sinRed) res.sinRed = true;
        else res.error = err.message;
        cb(res);
        return;
      }
      var porId = {}, r = (data && data.resultados) || [];
      for(var k = 0; k < r.length; k++) porId[r[k].client_id] = r[k];
      var actual = leerPendientes(st.usuario.id), resto = [];
      for(var q = 0; q < actual.length; q++){
        var a = actual[q], x = porId[a.client_id];
        if(x && (x.estado === 'ok' || x.estado === 'duplicado')){ res.enviadas++; anotarEnviada(a); continue; }
        if(x && x.estado === 'error' && !x.reintentar){ a.error = x.error; res.errores++; }
        resto.push(a);
      }
      guardarPendientes(resto);
      renderLista();
      // Quedan más (lotes de LOTE): seguir
      var quedan = 0;
      for(var z = 0; z < resto.length; z++) if(!resto[z].error) quedan++;
      if(quedan && res.enviadas){
        sincronizar(function(r2){
          res.total += r2.total; res.enviadas += r2.enviadas; res.errores += r2.errores;
          res.sinRed = r2.sinRed; res.sesion = r2.sesion; res.error = r2.error;
          cb(res);
        });
        return;
      }
      cb(res);
    });
  }

  // ══════════════════════════════════════════
  // EVENTOS DE LA INTERFAZ
  // ══════════════════════════════════════════
  function accion(b){
    var a = b.getAttribute('data-fug');
    if(a === 'nueva') nueva();
    else if(a === 'volver') pedirCerrar();
    else if(a === 'corregir') corregir(b.getAttribute('data-id'));
    else if(a === 'descartar') pedirDescartar(b.getAttribute('data-id'));
    if(!f) return;
    if(a === 'tipo'){ f.tipo_doc = b.getAttribute('data-v'); redibujar(); }
    else if(a === 'botiquin'){ pick.bodegaId = parseInt(b.getAttribute('data-id'), 10); pick.idx = null; pick.q = ''; redibujar(); }
    else if(a === 'item'){ pick.idx = parseInt(b.getAttribute('data-idx'), 10); pick.cantidad = ''; pick.error = ''; redibujar(); }
    else if(a === 'cambiar'){ pick.idx = null; pick.error = ''; redibujar(); }
    else if(a === 'agregar') agregar();
    else if(a === 'quitar'){ f.insumos.splice(parseInt(b.getAttribute('data-i'), 10), 1); redibujar(); }
    else if(a === 'guardar') guardar();
  }

  function alEscribir(el){
    if(!f) return;
    if(el.getAttribute('data-fug-buscar')){ pick.q = el.value; var r = U.$('lt-fug-res'); if(r) r.innerHTML = resultados(); return; }
    if(el.getAttribute('data-fug-cantidad')){ var d = digitos(el.value); if(d !== el.value) el.value = d; pick.cantidad = d; return; }
    var c = el.getAttribute('data-fug-campo');
    if(!c) return;
    var v = el.value;
    if(c === 'documento' && !TIPOS_ALFANUM[f.tipo_doc]){ var dg = digitos(v); if(dg !== v) el.value = dg; v = dg; }
    f[c] = v;
  }

  function conectarEventos(){
    U.on(U.$('lt-tab-hc'), 'click', function(e){
      var b = U.closestData(e.target, 'data-fug');
      if(b && !b.disabled) accion(b);
    });
    U.on(U.$('lt-fug-editor'), 'input', function(e){ if(e.target.getAttribute) alEscribir(e.target); });
  }

  return {
    // utilidades: las mismas de HCLite + descontarLocal, devolverLocal,
    // guardarPaquete y guardarModo
    conectar: function(utilidades){
      U = utilidades;
      st = utilidades.estado;
      conectarEventos();
    },
    mostrarInicio: function(){ if(!f) renderLista(); },
    editando: function(){ return !!f; },
    // Pendientes de envío del usuario (para "Sincronizar (n)" y al salir)
    pendientes: function(idUsuario){ return leerPendientes(idUsuario).length; },
    sincronizar: sincronizar,
    salir: function(){ f = null; pick = null; U.mostrar('lt-fug-editor', false); },
    // Para las pruebas
    esBotiquinTipo1: esBotiquinTipo1, insumoPermitido: insumoPermitido
  };
})();
