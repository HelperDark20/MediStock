/* ══════════════════════════════════════════
   HISTORIA CLÍNICA PREHOSPITALARIA — panel de enfermero (enfermero.html)

   JavaScript ES5 a propósito, igual que enfermero-lite.js: debe funcionar en
   Safari de iOS 9 (iPad mini / iPad 2). Sin let/const, funciones flecha,
   template literals, fetch, Array.find/includes ni Object.assign.
   `npm run check:lite` lo valida.

   Se carga ANTES de enfermero-lite.js, que al arrancar llama a
   HCLite.conectar(utilidades) y le pasa su estado (usuario, evento, offline).

   Funcionamiento:
   - Cada HC se diligencia en la tablet y se guarda campo a campo en
     localStorage (nb_hc_U), con o sin conexión.
   - Módulos: 1 Servicio · 2 Paciente · 3 Motivo, antecedentes y
     consentimiento · 4 ABCDE, signos vitales y Glasgow · 5 Examen físico,
     triage y procedimientos · 6 Medicamentos e insumos (descuentan del
     inventario, ligados a la HC) · 7 Evolución, cierre, traslado y
     responsables con sus firmas.
   - Al enviarla se sube a POST /api/hc/enviar, que asigna el consecutivo
     HC-AAAA-NNNN. Sin señal queda "pendiente de envío" y sale con el botón
     Sincronizar. Reenviar la misma HC no la duplica (client_id).
   - Al confirmarse el envío, la HC sale de la lista "en curso". Mientras el
     evento siga activo queda una copia en la tablet para registrar
     NOVEDADES (solo quien la diligenció): tomas de signos (hasta 3 en
     total), procedimientos, consumos y la evolución / cierre. Se guardan con
     o sin conexión y suben con Sincronizar (POST /api/hc/novedad). Cuando el
     evento finaliza, la copia se borra.
   - Modo administrador (hc-editor.html): el mismo editor abre una HC del
     servidor para corregir cualquier dato (con motivo); los consumos que
     agrega descuentan del inventario en el momento.
   Reglas de validación: las mismas de src/utils/hc.js (servidor).
   ══════════════════════════════════════════ */
var HCLite = (function(){
  'use strict';

  var U = null;      // utilidades de enfermero-lite.js (ver conectar)
  var st = null;     // estado compartido del panel (usuario, evento, offline…)
  var hc = null;     // HC abierta en el editor
  var _guardarTimer = null;
  var _firmaCampo = null;

  var NO_REFIERE = 'NO REFIERE INFORMACIÓN';
  var TEXTO_CONSENTIMIENTO = 'Declaro que recibí información clara sobre mi condición de salud, procedimiento realizado, necesidad de traslado y posibles riesgos derivados de aceptar o rechazar la atención brindada.';

  var MODULOS = [
    { n: 1, corto: 'Servicio',       titulo: 'Identificación del servicio' },
    { n: 2, corto: 'Paciente',       titulo: 'Identificación del paciente' },
    { n: 3, corto: 'Motivo',         titulo: 'Motivo de consulta, antecedentes y consentimiento' },
    { n: 4, corto: 'Valoración',     titulo: 'Valoración primaria ABCDE, signos vitales y Glasgow' },
    { n: 5, corto: 'Examen',         titulo: 'Examen físico, triage y procedimientos' },
    { n: 6, corto: 'Medicamentos',   titulo: 'Suministro de medicamentos e insumos' },
    { n: 7, corto: 'Cierre',         titulo: 'Cierre y envío' }
  ];

  var TIPOS_DOC = [['CC','CC'],['TI','TI'],['CE','CE'],['PAS','PAS'],['RC','RC'],['PPT','PPT'],['OTRO','Otro']];
  var TIPOS_ALFANUM = { PAS: true, OTRO: true };
  var SEXOS = [['M','Masculino'],['F','Femenino'],['O','Otro']];
  var RH = [['+','Positivo (+)'],['-','Negativo (−)']];
  var GRUPOS = [['A','A'],['B','B'],['AB','AB'],['O','O']];
  var ESTADOS_CIVILES = [['SOLTERO','Soltero/a'],['CASADO','Casado/a'],['DIVORCIADO','Divorciado/a'],['VIUDO','Viudo/a'],['UNION_LIBRE','Unión libre']];
  // Ubicación del paciente y tipo (obligatorios; mismas listas que src/utils/hc.js).
  // Si es externo (ajeno al evento) el tipo no se pregunta: queda EXTERNO.
  var PROCEDENCIAS = [['INTERNO','Interno (está en el evento)'],['EXTERNO','Externo (ajeno al evento)']];
  var TIPOS_PACIENTE = [['ARTISTA','Artista'],['DEPORTISTA','Deportista'],['DIRECTORES','Directores'],['ESPECTADOR','Espectador'],
    ['LOGISTICA','Logística'],['POLICIA','Policía'],['AUTORIDAD_PMU','Autoridad PMU'],['PROVEEDOR','Proveedor'],
    ['ADMINISTRACION','Administración'],['NOVA','Nova'],['PRODUCTOR','Productor']];
  var ANTECEDENTES = [
    ['patologicos','Patológicos'],['quirurgicos','Quirúrgicos'],['farmacologicos','Farmacológicos'],
    ['alergicos','Alérgicos'],['toxicos','Tóxicos'],['traumaticos','Traumáticos'],
    ['hospitalarios','Hospitalarios'],['otros','Otros']
  ];
  var DECISIONES = [
    ['acepta', 'Acepto la atención'],
    ['rechaza', 'Rechazo la atención'],
    ['urgencia_vital', 'Urgencia vital: sin capacidad de consentir']
  ];
  var RE_NOMBRE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .'\-]*$/;
  var RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  // Menores de esta edad: no se pregunta el estado civil (queda SOLTERO/A)
  var EDAD_ESTADO_CIVIL = 15;
  // Tomas de signos: la de la atención + hasta 2 más (novedades)
  var MAX_TOMAS_EXTRA = 2;
  // Teléfono: nacional o extranjero (puede empezar con +), de 8 a 15 dígitos,
  // sin 5 iguales seguidos (55555) ni 5 en escalera (12345 / 54321)
  var ERROR_TELEFONO = 'escribe un número de mínimo 8 dígitos (nacional o extranjero), sin 5 números iguales o seguidos (55555, 12345)';

  // Módulo 4 — valoración primaria ABCDE
  // "Permeable" se quitó: técnicamente es lo mismo que "Adecuada"
  var VIA_AEREA = [['ADECUADA','Adecuada'],['OBSTRUIDA','Obstruida'],['INSTRUMENTADA','Instrumentada']];
  var RESPIRACION = [['ADECUADA','Adecuada'],['DIFICULTAD','Dificultad respiratoria'],['AUSENTE','Ausente']];
  var CIRCULACION = [['ADECUADA','Adecuada'],['COMPROMETIDA','Comprometida']];
  var NEURO = [['ALERTA','Alerta'],['SOMNOLIENTO','Somnoliento'],['CONFUSO','Confuso'],['INCONSCIENTE','Inconsciente']];
  var ORIENTACION = [['PERSONA','Persona'],['TIEMPO','Tiempo'],['ESPACIO','Espacio']];
  // Signos vitales: campo, nombre, [mínimo, máximo] posibles (igual que el
  // servidor: fuera de ahí es un error de digitación) y [desde, hasta] normal
  // en adultos (fuera de ahí se marca en rojo, sin bloquear)
  var SIGNOS = {
    ta_sis: { nombre: 'TA sistólica', posible: [40, 300], normal: [90, 139], req: true },
    ta_dia: { nombre: 'TA diastólica', posible: [20, 200], normal: [60, 89], req: true },
    fc:     { nombre: 'FC', posible: [20, 300], normal: [60, 100], req: true, unidad: 'lpm' },
    fr:     { nombre: 'FR', posible: [4, 80], normal: [12, 20], req: true, unidad: 'rpm' },
    spo2:   { nombre: 'SpO₂', posible: [30, 100], normal: [94, 100], req: true, unidad: '%' },
    temp:   { nombre: 'Temperatura', posible: [25, 45], normal: [36, 37.9], req: true, unidad: '°C', decimal: true },
    gluco:  { nombre: 'Glucometría', posible: [10, 1000], normal: [70, 180], unidad: 'mg/dL' },
    eva:    { nombre: 'Dolor EVA', posible: [0, 10], normal: [0, 6], unidad: '/10', req: true }
  };
  var GLASGOW = {
    ocular: [['4','Espontánea'],['3','Al estímulo verbal'],['2','Al dolor'],['1','Ninguna']],
    verbal: [['5','Orientado'],['4','Confuso'],['3','Palabras incoherentes'],['2','Sonidos'],['1','Ninguna']],
    motora: [['6','Obedece órdenes'],['5','Localiza el dolor'],['4','Retira al dolor'],['3','Flexión'],['2','Extensión'],['1','Ninguna']]
  };
  // Módulo 5
  var ESTADO_ADECUADO = 'ESTADO ADECUADO';
  var NO_APLICA = 'NO APLICA';
  var SEGMENTOS = [
    ['cabeza','Cabeza'],['cara','Cara'],['cuello','Cuello'],['torax','Tórax'],['campos_pulmonares','Campos pulmonares'],
    ['abdomen','Abdomen'],['pelvis','Pelvis'],['espalda','Espalda'],['eess','Extremidades superiores'],
    ['eeii','Extremidades inferiores'],['osteomuscular','Sistema osteomuscular']
  ];
  var TRIAGE = [['I','I'],['II','II'],['III','III'],['IV','IV'],['V','V']];
  var _examenAbiertos = {};   // segmentos del examen con el campo de hallazgo abierto

  // Módulo 6: vías de administración (las mismas de src/utils/hc.js)
  var VIAS = [['VO','Oral (VO)'],['IV','Intravenosa (IV)'],['IM','Intramuscular (IM)'],['SC','Subcutánea (SC)'],
              ['SL','Sublingual (SL)'],['TOPICA','Tópica'],['INHALADA','Inhalada'],['OTRA','Otra']];
  var MAX_RESULTADOS = 30;

  // Módulo 7 (las mismas de src/utils/hc.js)
  var CONDICIONES = [['ESTABLE','Estable'],['MEJORADO','Mejorado'],['SIN_CAMBIOS','Sin cambios'],['DETERIORADO','Deteriorado'],['FALLECIDO','Fallecido']];
  var DESTINOS = [['ALTA_SITIO','Alta en sitio'],['ENTREGA_FAMILIAR','Entrega a familiar o acudiente'],['TRASLADO','Traslado asistencial'],
                  ['REMISION_IPS','Remisión a IPS'],['RECHAZO_TRASLADO','Rechazo de traslado'],['FALLECIDO_SITIO','Fallecido en el sitio']];
  var AMBULANCIAS = [['TAB','TAB'],['TAM','TAM'],['APH','APH'],['NEONATAL','Neonatal']];
  var TITULOS_FIRMA = { paciente: 'Firma del paciente o acudiente', medico: 'Firma del médico', enfermero: 'Tu firma' };
  // Formulario de consumo del módulo 6 (no se guarda en la HC hasta registrar)
  var _m6 = null;

  // Concentración del medicamento tomada de su nombre:
  // "ACETAMINOFÉN 500 MG TABLETA" → { n: 500, unidad: 'MG', decimal: '.' }
  // "DIPIRONA 1 G/2 ML SOLUCIÓN INYECTABLE" → 1 G · "SALBUTAMOL 100 MCG/DOSIS" → 100 MCG
  // Los porcentajes (0,9 %) no son dosis y se ignoran.
  function concentracion(nombre){
    var m = /(\d+(?:[.,]\d+)?)\s*(MCG|MG|MEQ|ML|UI|G)(?![A-Z])/.exec(String(nombre || '').toUpperCase());
    if(!m) return null;
    return { n: parseFloat(m[1].replace(',', '.')), unidad: m[2], coma: m[1].indexOf(',') >= 0 };
  }

  // ¿Es medicamento? La familia del SKU es texto libre: "MED", "Medicamento",
  // "MEDICAMENTOS", "Fármacos"… Lo demás es insumo. (Igual que
  // esFamiliaMedicamento() de src/utils/hc.js)
  function esMedicamento(item){
    var f = String((item && item.familia) || '').toUpperCase().replace(/^\s+|\s+$/g, '').replace(/Á/g, 'A');
    return f === 'MED' || f.indexOf('MEDICAMENT') === 0 || f.indexOf('FARMAC') === 0;
  }

  // Dosis sugerida = concentración × cantidad (2 tabletas de 500 MG → 1000 MG)
  function dosisSugerida(conc, cantidad){
    if(!conc) return '';
    var total = Math.round(conc.n * (cantidad > 0 ? cantidad : 1) * 100) / 100;
    var txtN = String(total);
    if(conc.coma) txtN = txtN.replace('.', ',');
    return txtN + ' ' + conc.unidad;
  }
  function m6Nuevo(){ return { bodegaId: null, idx: null, q: '', form: {}, ultimo: null, enviando: false, error: '' }; }

  // ══════════════════════════════════════════
  // DATOS EN LA TABLET
  // ══════════════════════════════════════════
  function leerTodas(idUsuario){ return U.leerJSON(U.claveUsuario('hc', idUsuario)) || []; }
  function guardarTodas(lista){ return U.guardarJSON(U.claveUsuario('hc'), lista.length ? lista : null) || !lista.length; }
  function leerEnviadas(){ return U.leerJSON(U.claveUsuario('hcenv')) || []; }
  function guardarEnviadas(env){ return U.guardarJSON(U.claveUsuario('hcenv'), env.length ? env : null); }
  // Novedades de HC ya enviadas (nb_hcnov_U): en curso o pendientes de envío
  function leerNovedades(idUsuario){ return U.leerJSON(U.claveUsuario('hcnov', idUsuario)) || []; }
  function guardarNovedades(lista){ return U.guardarJSON(U.claveUsuario('hcnov'), lista.length ? lista : null) || !lista.length; }
  function buscarNov(lista, novId){
    for(var i = 0; i < lista.length; i++) if(lista[i].nov_id === novId) return i;
    return -1;
  }
  function novedadDe(hcClientId){
    var l = leerNovedades();
    for(var i = 0; i < l.length; i++) if(l[i].client_id === hcClientId) return l[i];
    return null;
  }
  function enviadaDe(hcClientId){
    var env = leerEnviadas();
    for(var i = 0; i < env.length; i++) if(env[i].client_id === hcClientId) return env[i];
    return null;
  }

  // Pendientes de envío / en curso (para avisos del panel y el login).
  // porEnviar incluye las novedades pendientes de envío.
  function contar(idUsuario){
    var lista = leerTodas(idUsuario), porEnviar = 0, novs = leerNovedades(idUsuario), novPend = 0, i;
    for(i = 0; i < lista.length; i++) if(lista[i].estado === 'por_enviar') porEnviar++;
    for(i = 0; i < novs.length; i++) if(novs[i].estado === 'por_enviar') novPend++;
    return { total: lista.length, porEnviar: porEnviar + novPend, enCurso: lista.length - porEnviar, novedades: novPend };
  }

  function buscarHC(lista, clientId){
    for(var i = 0; i < lista.length; i++) if(lista[i].client_id === clientId) return i;
    return -1;
  }

  // Guarda la HC abierta (reemplaza su versión en la lista)
  function guardarHC(){
    if(!hc) return true;
    if(hc.modo === 'admin'){
      // Editor del administrador: los cambios quedan en memoria hasta "Guardar cambios"
      hc.sucio = true;
      var g = U.$('lt-hc-guardado');
      if(g){ g.className = 'lt-hc-guardado'; g.textContent = 'Cambios sin guardar · se guardan con "Guardar cambios" (módulo 7)'; }
      return true;
    }
    hc.actualizada_at = new Date().toISOString();
    if(hc.modo === 'novedad') return guardarNovedadLocal();
    var lista = leerTodas();
    var i = buscarHC(lista, hc.client_id);
    if(i >= 0) lista[i] = hc; else lista.push(hc);
    var ok = guardarTodas(lista);
    var el = U.$('lt-hc-guardado');
    if(el){
      el.className = 'lt-hc-guardado' + (ok ? '' : ' error');
      el.textContent = ok ? 'Guardado en la tablet · ' + U.horaCO(hc.actualizada_at) : 'No hay espacio en la tablet: envía o sincroniza tus HC';
    }
    return ok;
  }

  function guardarNovedadLocal(){
    var lista = leerNovedades();
    var i = buscarNov(lista, hc.nov_id);
    if(i >= 0) lista[i] = hc; else lista.push(hc);
    var ok = guardarNovedades(lista);
    var el = U.$('lt-hc-guardado');
    if(el){
      el.className = 'lt-hc-guardado' + (ok ? '' : ' error');
      el.textContent = ok ? 'Novedad guardada en la tablet · ' + U.horaCO(hc.actualizada_at) : 'No hay espacio en la tablet: sincroniza tus pendientes';
    }
    return ok;
  }

  function guardarPronto(){
    // Editor del administrador: solo marca "sin guardar" (al instante, para
    // que Corregir la clasificación sepa que hay cambios pendientes)
    if(hc && hc.modo === 'admin'){ guardarHC(); return; }
    clearTimeout(_guardarTimer);
    _guardarTimer = setTimeout(guardarHC, 300);
  }

  // Bloques que pueden faltar en HC guardadas con una versión anterior del panel
  function completarEstructura(h){
    var d = h.datos;
    if(!d.valoracion) d.valoracion = { orientado: [] };
    if(!d.valoracion.orientado) d.valoracion.orientado = [];
    if(!d.signos) d.signos = {};
    if(!d.glasgow) d.glasgow = {};
    if(!d.examen) d.examen = {};
    if(!d.procedimientos) d.procedimientos = [];
    if(!d.medicamentos) d.medicamentos = [];
    if(!d.cierre) d.cierre = { traslado: {} };
    if(!d.cierre.traslado) d.cierre.traslado = {};
    if(!d.responsables) d.responsables = {};
    if(d.paciente) d.paciente.nn = false;   // ya no hay paciente NN
    if(!d.signos_tomas) d.signos_tomas = [];
    // Un solo médico en el evento: queda elegido
    var meds = h.servicio.medicos || [];
    if(meds.length === 1 && !d.responsables.medico_id) d.responsables.medico_id = String(meds[0].id);
  }

  function nuevaHC(){
    var ev = st.evento;
    var medicos = [];
    for(var i = 0; i < (ev.medicos || []).length; i++){
      medicos.push({ id: ev.medicos[i].id, nombre: ev.medicos[i].nombre, cedula: ev.medicos[i].cedula });
    }
    return {
      client_id: 'h' + U.nuevoClientId(),
      estado: 'borrador',
      evento_id: ev.id,
      servicio: {
        evento: ev.nombre || '',
        lugar: ev.ubicacion_nombre || '',
        municipio: ev.municipio_nombre || '',
        departamento: ev.municipio_departamento || '',
        medicos: medicos
      },
      inicio_atencion: new Date().toISOString(),   // hora del dispositivo
      paso: 1,
      max_paso: 1,
      datos: {
        paciente: { nn: false },
        acompanante: { tiene: false },
        motivo: {},
        antecedentes: { refiere: false },
        consentimiento: { testigo: {} },
        valoracion: { orientado: [] },
        signos: {},
        glasgow: {},
        examen: {},
        procedimientos: [],
        medicamentos: [],
        cierre: { traslado: {} },
        responsables: {}
      },
      firmas: {},
      precargado: ''
    };
  }

  // ══════════════════════════════════════════
  // UTILIDADES
  // ══════════════════════════════════════════
  function leerCampo(ruta){
    var partes = ruta.split('.'), o = hc.datos;
    for(var i = 0; i < partes.length; i++){
      if(o === null || o === undefined) return undefined;
      o = o[partes[i]];
    }
    return o;
  }

  function fijarCampo(ruta, valor){
    var partes = ruta.split('.'), o = hc.datos;
    for(var i = 0; i < partes.length - 1; i++){
      if(!o[partes[i]] || typeof o[partes[i]] !== 'object') o[partes[i]] = {};
      o = o[partes[i]];
    }
    o[partes[partes.length - 1]] = valor;
  }

  function txt(v){ return typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : ''; }

  // ── Datos de relleno ("NNNNN", "0000000", "1234567"): mismas reglas que
  // src/utils/hc.js. Texto: un solo carácter repetido o 3+ letras iguales
  // seguidas (en la dirección 4+). Teléfono: colombiano de 10 dígitos.
  function secuencia(d, largo){
    var sube = 1, baja = 1;
    for(var i = 1; i < d.length; i++){
      var a = +d.charAt(i - 1), b = +d.charAt(i);
      sube = b === a + 1 ? sube + 1 : 1;
      baja = b === a - 1 ? baja + 1 : 1;
      if(sube >= largo || baja >= largo) return true;
    }
    return false;
  }
  function textoDeRelleno(v, repetidas){
    var s = String(v || '').toUpperCase();
    var solo = s.replace(/[^A-ZÁÉÍÓÚÜÑ0-9]/g, '');
    if(solo.length >= 2 && /^(.)\1*$/.test(solo)) return true;
    return new RegExp('([A-ZÁÉÍÓÚÜÑ])\\1{' + ((repetidas || 3) - 1) + '}').test(s);
  }
  function telefonoValido(v){
    var d = digitos(v);
    return d.length >= 8 && d.length <= 15 && !/(\d)\1{4}/.test(d) && !secuencia(d, 5);
  }
  function documentoDeRelleno(v){
    var d = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(d.length < 3) return false;
    return /^(.)\1*$/.test(d) || (/^\d+$/.test(d) && secuencia(d, d.length));
  }
  function digitos(v){ return String(v === undefined || v === null ? '' : v).replace(/\D/g, ''); }
  function mayus(v){ return txt(v).toUpperCase(); }

  function fechaValida(s){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if(!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if(y < 1900 || y > 2100) return false;
    var f = new Date(Date.UTC(y, mo - 1, d));
    return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d;
  }

  // Igual que calcularEdad() de src/utils/hc.js
  function calcularEdad(nac, atencion){
    if(!fechaValida(nac) || !fechaValida(atencion) || nac > atencion) return null;
    var a = nac.split('-'), b = atencion.split('-');
    var meses = (+b[0] - +a[0]) * 12 + (+b[1] - +a[1]);
    var dias = +b[2] - +a[2];
    if(dias < 0){ meses--; dias += new Date(Date.UTC(+b[0], +b[1] - 1, 0)).getUTCDate(); }
    var anios = Math.floor(meses / 12);
    if(anios >= 1) return anios + (anios === 1 ? ' AÑO' : ' AÑOS');
    if(meses >= 1) return meses + (meses === 1 ? ' MES' : ' MESES') + (dias ? ' ' + dias + (dias === 1 ? ' DÍA' : ' DÍAS') : '');
    return dias + (dias === 1 ? ' DÍA' : ' DÍAS');
  }

  function fechaAtencion(){ return U.fechaCO(hc.inicio_atencion); }

  // Fecha de nacimiento: mínimo un mes antes de la atención (no se acepta la
  // fecha del día, que se ponía por no preguntarla)
  var ERROR_NACIMIENTO = 'La fecha de nacimiento no es válida: el paciente debe tener mínimo un mes de nacido (no se acepta la fecha de hoy)';
  function menorDeUnMes(nac){
    if(!fechaValida(nac)) return false;
    var a = nac.split('-'), b = fechaAtencion().split('-');
    var meses = (+b[0] - +a[0]) * 12 + (+b[1] - +a[1]);
    if(+b[2] < +a[2]) meses--;
    return nac <= fechaAtencion() && meses < 1;
  }
  // Para el selector de fecha: el mismo día del mes anterior
  function maxNacimiento(){
    var b = fechaAtencion().split('-'), y = +b[0], m = +b[1] - 1, d = +b[2];
    if(m < 1){ m = 12; y--; }
    var ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if(d > ult) d = ult;
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  // ¿El navegador tiene selector de fecha? (Safari de iOS sí; si no, se
  // escribe DD/MM/AAAA)
  var _soportaFecha = null;
  function soportaFecha(){
    if(_soportaFecha === null){
      var i = document.createElement('input');
      try { i.setAttribute('type', 'date'); } catch(e){}
      i.value = 'x';
      _soportaFecha = i.type === 'date' && i.value !== 'x';
    }
    return _soportaFecha;
  }
  function isoDesdeDMA(s){
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').replace(/\s/g, ''));
    if(!m) return '';
    var iso = m[3] + '-' + (m[2].length < 2 ? '0' : '') + m[2] + '-' + (m[1].length < 2 ? '0' : '') + m[1];
    return fechaValida(iso) ? iso : '';
  }

  function nombrePaciente(h){
    var p = h.datos.paciente || {};
    var n = mayus((p.nombres || '') + ' ' + (p.apellidos || ''));
    return n || 'Paciente sin nombre aún';
  }

  // Quien diligencia la HC: en la tablet el usuario; en el editor del
  // administrador, el enfermero que la hizo
  function diligencia(){ return hc && hc.diligencia ? hc.diligencia : st.usuario; }
  // Responsable de procedimientos y medicamentos: el médico del evento (uno
  // como máximo) o, si no hay, quien diligencia
  function responsableTexto(){
    var meds = hc.servicio.medicos || [];
    return meds.length ? meds[0].nombre + ' (médico del evento)' : diligencia().nombre + ' (quien diligencia)';
  }
  function esMenorEstadoCivil(){
    var e = edadAnios();
    return e !== null && e < EDAD_ESTADO_CIVIL;
  }

  // ══════════════════════════════════════════
  // PIEZAS DE FORMULARIO (HTML)
  // ══════════════════════════════════════════
  function etiqueta(texto, req){
    return '<label class="lt-label">' + U.escHtml(texto) + (req ? ' <span class="lt-req">*</span>' : '') + '</label>';
  }

  // opts: { req, tipo: 'texto'|'digitos'|'telefono'|'alfanum'|'fecha'|'area', mayus, max, ph, ayuda, filas }
  function campo(ruta, texto, opts){
    opts = opts || {};
    var v = leerCampo(ruta);
    v = v === undefined || v === null ? '' : String(v);
    var attrs = ' data-campo="' + ruta + '"' + (opts.max ? ' maxlength="' + opts.max + '"' : '') +
      (opts.ph ? ' placeholder="' + U.escHtml(opts.ph) + '"' : '') +
      ' autocomplete="off" autocorrect="off" spellcheck="false"';
    var html = '<div class="lt-campo" data-envoltura="' + ruta + '">' + etiqueta(texto, opts.req);
    if(opts.tipo === 'area'){
      html += '<textarea class="lt-input lt-area lt-mayus" autocapitalize="characters" rows="' + (opts.filas || 3) + '"' + attrs + '>' + U.escHtml(v) + '</textarea>';
    } else if(opts.tipo === 'digitos'){
      html += '<input class="lt-input" type="tel" pattern="[0-9]*" data-solo="digitos"' + attrs + ' value="' + U.escHtml(v) + '">';
    } else if(opts.tipo === 'telefono'){
      // Números, espacios y un + al inicio (indicativo de otro país)
      html += '<input class="lt-input" type="tel" data-solo="telefono"' + attrs + ' value="' + U.escHtml(v) + '">';
    } else if(opts.tipo === 'hora'){
      html += '<input class="lt-input lt-hora" type="tel" pattern="[0-9]*" data-solo="hora" maxlength="5" placeholder="HH:MM"' +
        ' data-campo="' + ruta + '" value="' + U.escHtml(v) + '" autocomplete="off">';
    } else if(opts.tipo === 'fecha'){
      if(soportaFecha()){
        html += '<input class="lt-input" type="date"' + (opts.sinMax ? '' : ' max="' + (opts.maxFecha || fechaAtencion()) + '"') + ' min="1900-01-01"' + attrs + ' value="' + U.escHtml(v) + '">';
      } else {
        html += '<input class="lt-input" type="tel" data-fecha-dma="1" placeholder="DD/MM/AAAA" maxlength="10"' +
          ' data-campo="' + ruta + '" value="' + U.escHtml(v ? U.fmtFecha(v) : '') + '">';
      }
    } else {
      html += '<input class="lt-input lt-mayus" type="text" autocapitalize="characters"' + attrs + ' value="' + U.escHtml(v) + '">';
    }
    if(opts.ayuda) html += '<div class="lt-ayuda">' + opts.ayuda + '</div>';
    return html + '</div>';
  }

  // Selección única con botones grandes. opciones: [[valor, texto]]
  function chips(ruta, texto, opciones, req, ayuda){
    var actual = leerCampo(ruta);
    var html = '<div class="lt-campo" data-envoltura="' + ruta + '">' + etiqueta(texto, req) + '<div class="lt-chips">';
    for(var i = 0; i < opciones.length; i++){
      html += '<button type="button" class="lt-chip' + (actual === opciones[i][0] ? ' sel' : '') + '" data-chip="' + ruta +
        '" data-valor="' + U.escHtml(opciones[i][0]) + '">' + U.escHtml(opciones[i][1]) + '</button>';
    }
    html += '</div>' + (ayuda ? '<div class="lt-ayuda">' + ayuda + '</div>' : '') + '</div>';
    return html;
  }

  // Selección múltiple (lista de valores)
  function multiChips(ruta, texto, opciones){
    var actual = leerCampo(ruta) || [];
    var html = '<div class="lt-campo" data-envoltura="' + ruta + '">' + etiqueta(texto) + '<div class="lt-chips">';
    for(var i = 0; i < opciones.length; i++){
      var sel = actual.indexOf(opciones[i][0]) >= 0;
      html += '<button type="button" class="lt-chip lt-chip-multi' + (sel ? ' sel' : '') + '" data-multi="' + ruta +
        '" data-valor="' + U.escHtml(opciones[i][0]) + '">' + (sel ? '✓ ' : '') + U.escHtml(opciones[i][1]) + '</button>';
    }
    return html + '</div></div>';
  }

  // Interruptor SÍ / NO (valor booleano)
  function interruptor(ruta, texto){
    var v = leerCampo(ruta) === true;
    return '<div class="lt-campo lt-interruptor" data-envoltura="' + ruta + '">' +
      '<span class="lt-interruptor-txt">' + U.escHtml(texto) + '</span>' +
      '<span class="lt-segmento">' +
        '<button type="button" class="lt-seg' + (!v ? ' sel' : '') + '" data-bool="' + ruta + '" data-valor="no">NO</button>' +
        '<button type="button" class="lt-seg' + (v ? ' sel' : '') + '" data-bool="' + ruta + '" data-valor="si">SÍ</button>' +
      '</span></div>';
  }

  function seccion(titulo, cuerpo){
    return '<div class="lt-card"><div class="lt-card-title">' + U.escHtml(titulo) + '</div>' + cuerpo + '</div>';
  }

  function fila(dos){   // dos campos lado a lado en pantallas anchas
    return '<div class="lt-fila"><div class="lt-fila-col">' + dos[0] + '</div><div class="lt-fila-col">' + dos[1] + '</div></div>';
  }

  // ══════════════════════════════════════════
  // MÓDULOS
  // ══════════════════════════════════════════
  function dato(et, valor, aviso){
    return '<div class="lt-dato"><span class="lt-dato-et">' + U.escHtml(et) + '</span>' +
      '<span class="lt-dato-v' + (aviso ? ' aviso' : '') + '">' + valor + '</span></div>';
  }

  function modulo1(){
    var s = hc.servicio, medicos = [];
    for(var i = 0; i < (s.medicos || []).length; i++){
      medicos.push(U.escHtml(s.medicos[i].nombre) + ' <span class="lt-gris">· Cédula / RP ' + U.escHtml(s.medicos[i].cedula) + '</span>');
    }
    return seccion('Identificación del servicio',
      '<div class="lt-muted">Estos datos se llenan solos.</div>' +
      dato('Consecutivo HC', hc.consecutivo ? '<strong>' + U.escHtml(hc.consecutivo) + '</strong>' : 'Se asigna al enviar la historia clínica') +
      dato('Fecha', U.fmtFecha(fechaAtencion())) +
      dato('Hora de inicio de la atención', U.horaCO(hc.inicio_atencion)) +
      dato('Lugar de atención', U.escHtml(s.lugar || '—')) +
      dato('Municipio', s.municipio ? U.escHtml(s.municipio) + ' <span class="lt-gris">· ' + U.escHtml(s.departamento) + '</span>'
        : 'Sin municipio: avisa al administrador para que lo registre en la ubicación', !s.municipio) +
      dato('Evento', U.escHtml(s.evento || '—')) +
      dato('Diligencia', U.escHtml(diligencia().nombre) + ' <span class="lt-gris">· CC ' + U.escHtml(diligencia().cedula || '') + '</span>') +
      dato('Médico del evento', medicos.length ? medicos.join('<br>') : 'Sin médico asignado', !medicos.length));
  }

  function modulo2(){
    var p = hc.datos.paciente;
    var alfanum = TIPOS_ALFANUM[p.tipo_doc];
    var edad = calcularEdad(p.fecha_nacimiento, fechaAtencion());
    var req = true;
    var html = seccion('Identificación del paciente',
      '<div class="lt-muted">Todos los datos son obligatorios (menos EPS y ARL). Pídelos al paciente o a su acompañante: no se aceptan datos de relleno como "NNNN" o "0000000".</div>' +
      fila([campo('paciente.nombres', 'Nombres', { req: req, mayus: true, max: 80, ph: 'Ej. PABLO ANDRÉS' }),
            campo('paciente.apellidos', 'Apellidos', { req: req, mayus: true, max: 80, ph: 'Ej. PÉREZ GÓMEZ' })]) +
      chips('paciente.tipo_doc', 'Tipo de documento', TIPOS_DOC, req) +
      campo('paciente.documento', 'Número de documento', {
        req: req, tipo: alfanum ? 'alfanum' : 'digitos', max: alfanum ? 20 : 15,
        ph: alfanum ? 'Letras y números' : 'Solo números',
        ayuda: navigator.onLine !== false && !st.offline && !hc.modo ? 'Si el paciente ya fue atendido antes, se ofrecerá cargar sus datos.' : ''
      }) +
      fila([campo('paciente.fecha_nacimiento', 'Fecha de nacimiento', { req: req, tipo: 'fecha', maxFecha: maxNacimiento() }),
            '<div class="lt-campo"><label class="lt-label">Edad</label><div class="lt-edad" id="lt-hc-edad">' +
            (edad && menorDeUnMes(p.fecha_nacimiento) ? '<span class="lt-error-txt">Mínimo un mes de nacido</span>'
              : edad ? U.escHtml(edad) : '<span class="lt-gris">Se calcula con la fecha de nacimiento</span>') + '</div></div>']) +
      chips('paciente.sexo', 'Sexo', SEXOS, req) +
      fila([chips('paciente.rh', 'RH', RH, true), chips('paciente.grupo', 'Grupo sanguíneo', GRUPOS, true)]) +
      chips('paciente.procedencia', 'Ubicación del paciente', PROCEDENCIAS, true) +
      (p.procedencia === 'INTERNO' ? chips('paciente.tipo_paciente', 'Tipo de paciente', TIPOS_PACIENTE, true) : '') +
      fila([campo('paciente.direccion', 'Dirección', { req: true, max: 150, mayus: true, ph: 'Ej. CALLE 10 # 20-30' }),
            campo('paciente.ciudad', 'Ciudad', { req: true, max: 80, mayus: true })]) +
      campo('paciente.telefono', 'Teléfono', { req: true, tipo: 'telefono', max: 20, ph: 'Ej. 3157778899',
        ayuda: 'Nacional o extranjero (con + y el indicativo), mínimo 8 dígitos.' }) +
      (esMenorEstadoCivil()
        ? '<div class="lt-campo" data-envoltura="paciente.estado_civil_menor"><label class="lt-label">Estado civil</label>' +
          '<div class="lt-dato-v">Soltero/a <span class="lt-gris">· menor de ' + EDAD_ESTADO_CIVIL + ' años: no se pregunta</span></div></div>'
        : chips('paciente.estado_civil', 'Estado civil', ESTADOS_CIVILES, true)) +
      campo('paciente.ocupacion', 'Ocupación', { req: true, max: 80, mayus: true, ph: 'Ej. ESTUDIANTE' }) +
      fila([campo('paciente.eps', 'EPS', { max: 80, mayus: true, ph: NO_APLICA }),
            campo('paciente.arl', 'ARL', { max: 80, mayus: true, ph: NO_APLICA })]) +
      '<div class="lt-muted">Si el paciente no tiene EPS o ARL, deja el campo vacío: se registra "' + NO_APLICA + '".</div>' +
      interruptor('paciente.otra_aseguradora', '¿Tiene otra aseguradora?') +
      (p.otra_aseguradora ? campo('paciente.aseguradora', 'Nombre de la otra aseguradora', { req: true, max: 80, mayus: true }) : ''));

    var a = hc.datos.acompanante;
    // Tarjeta de identidad (menor de edad): el acompañante es obligatorio
    var acompObligatorio = p.tipo_doc === 'TI';
    if(acompObligatorio && !a.tiene) a.tiene = true;
    html += seccion('Contacto de acompañante',
      (acompObligatorio
        ? '<div class="lt-aviso">Paciente con <strong>tarjeta de identidad</strong>: los datos del acompañante son obligatorios.</div>'
        : interruptor('acompanante.tiene', '¿El paciente tiene acompañante?')) +
      (a.tiene ? campo('acompanante.nombre', 'Nombre y apellidos completos', { req: true, max: 120, mayus: true }) +
        fila([campo('acompanante.parentesco', 'Parentesco', { req: true, max: 60, mayus: true, ph: 'Ej. MADRE' }),
              campo('acompanante.telefono', 'Teléfono', { req: true, tipo: 'telefono', max: 20, ph: 'Ej. 3157778899' })]) : ''));
    return html;
  }

  function modulo3(){
    var d = hc.datos, ant = d.antecedentes, c = d.consentimiento, sexo = d.paciente.sexo;
    var html = seccion('Motivo de consulta',
      campo('motivo.relato', 'Motivo de consulta y relato del paciente', {
        req: true, tipo: 'area', filas: 5, max: 4000,
        ph: 'Lo que manifiesta el paciente: síntomas, molestias, qué pasó y desde cuándo…'
      }));

    var cuerpoAnt = interruptor('antecedentes.refiere', '¿El paciente refiere antecedentes?');
    if(ant.refiere){
      cuerpoAnt += '<div class="lt-muted">Llena solo los que apliquen. Los que queden vacíos se registran como "' + NO_REFIERE + '".</div>';
      for(var i = 0; i < ANTECEDENTES.length; i += 2){
        cuerpoAnt += fila([
          campo('antecedentes.' + ANTECEDENTES[i][0], ANTECEDENTES[i][1], { tipo: 'area', filas: 2, max: 1000, ph: NO_REFIERE }),
          campo('antecedentes.' + ANTECEDENTES[i + 1][0], ANTECEDENTES[i + 1][1], { tipo: 'area', filas: 2, max: 1000, ph: NO_REFIERE })
        ]);
      }
    } else {
      cuerpoAnt += '<div class="lt-muted">Todos los antecedentes se registran como "' + NO_REFIERE + '".</div>';
    }
    if(sexo !== 'M'){
      cuerpoAnt += interruptor('antecedentes.gestacion_si', '¿Está en embarazo (gestación)?');
      if(ant.gestacion_si) cuerpoAnt += campo('antecedentes.semanas', 'Semanas de gestación', { req: true, tipo: 'digitos', max: 2, ph: 'Ej. 24' });
    }
    html += seccion('Antecedentes', cuerpoAnt);

    var cuerpoCons = '<div class="lt-consentimiento">' + U.escHtml(TEXTO_CONSENTIMIENTO) + '</div>' +
      '<div class="lt-muted">Lee el texto al paciente o a su acudiente y registra su decisión.</div>' +
      (hc.modo === 'admin'
        ? dato('Decisión', '<strong>' + U.escHtml(textoDe(DECISIONES, c.decision) || '—') + '</strong>') +
          '<div class="lt-ayuda">La decisión del paciente y las firmas no se cambian en la corrección.</div>'
        : chips('consentimiento.decision', 'Decisión', DECISIONES, true));
    if(c.decision === 'rechaza'){
      cuerpoCons += '<div class="lt-aviso">Al rechazar la atención, la historia clínica pasa directo al cierre.</div>' +
        campo('consentimiento.motivo_rechazo', 'Motivo del rechazo', { req: true, tipo: 'area', filas: 3, max: 1000 }) +
        '<div class="lt-campo" data-envoltura="firma.paciente">' + etiqueta('Firma del paciente o acudiente', true) +
          (hc.modo === 'admin'
            ? (hc.firmas.paciente ? '<img class="lt-firma-img" src="' + hc.firmas.paciente + '" alt="Firma">' : '<div class="lt-gris">Sin firma</div>')
            : hc.firmas.paciente
            ? '<img class="lt-firma-img" src="' + hc.firmas.paciente + '" alt="Firma"><button type="button" class="lt-btn-sec" data-hc="firmar" data-firma-campo="paciente">Volver a firmar</button>'
            : '<button type="button" class="lt-btn-sec primario lt-btn-firma" data-hc="firmar" data-firma-campo="paciente">Tomar firma</button>') +
        '</div>' +
        '<div class="lt-subtitulo">Testigo</div>' +
        fila([campo('consentimiento.testigo.nombres', 'Nombre', { req: true, max: 80, mayus: true }),
              campo('consentimiento.testigo.apellidos', 'Apellido', { req: true, max: 80, mayus: true })]) +
        fila([campo('consentimiento.testigo.cedula', 'Cédula', { req: true, tipo: 'digitos', max: 15 }),
              campo('consentimiento.testigo.telefono', 'Teléfono', { req: true, tipo: 'telefono', max: 20 })]);
    } else if(c.decision === 'urgencia_vital'){
      cuerpoCons += '<div class="lt-aviso">Se continúa la atención sin consentimiento por urgencia vital (paciente inconsciente o sin acudiente).</div>';
    }
    html += seccion('Consentimiento informado', cuerpoCons);
    return html;
  }

  // ── Módulo 4: ABCDE, signos vitales y Glasgow ──
  function abc(clave, texto, opciones){
    var v = hc.datos.valoracion;
    return chips('valoracion.' + clave, texto, opciones, true) +
      (v[clave] && v[clave] !== 'ADECUADA'
        ? campo('valoracion.' + clave + '_obs', 'Observaciones de ' + texto.split('. ')[1].toLowerCase(), { tipo: 'area', filas: 2, max: 1000 })
        : '');
  }

  // Edad en años a la fecha de atención (null si no se sabe): los rangos
  // normales de signos vitales son de adultos
  function edadAnios(){
    var p = hc.datos.paciente;
    if(!fechaValida(p.fecha_nacimiento)) return null;
    var a = p.fecha_nacimiento.split('-'), b = fechaAtencion().split('-');
    var anios = +b[0] - +a[0];
    if(+b[1] < +a[1] || (+b[1] === +a[1] && +b[2] < +a[2])) anios--;
    return anios;
  }

  function numeroSigno(v, decimal){
    if(v === undefined || v === null || v === '') return null;
    var s = String(v).replace(/^\s+|\s+$/g, '').replace(',', '.');
    if(!(decimal ? /^\d{1,4}(\.\d)?$/ : /^\d{1,4}$/).test(s)) return NaN;
    return Number(s);
  }

  // '' normal · 'fuera' fuera de lo normal en adultos · 'imposible'
  // base: 'signos' (toma de la atención) o 'signos_tomas.N' (tomas adicionales)
  function estadoSigno(clave, base){
    var def = SIGNOS[clave];
    var n = numeroSigno((leerCampo(base || 'signos') || {})[clave], def.decimal);
    if(n === null) return '';
    if(isNaN(n) || n < def.posible[0] || n > def.posible[1]) return 'imposible';
    var edad = edadAnios();
    if(edad !== null && edad < 14) return '';
    return n < def.normal[0] || n > def.normal[1] ? 'fuera' : '';
  }

  function campoSigno(clave, base){
    base = base || 'signos';
    var def = SIGNOS[clave], v = (leerCampo(base) || {})[clave];
    v = v === undefined || v === null ? '' : String(v);
    var est = estadoSigno(clave, base), ruta = base + '.' + clave;
    var attrs = ' data-signo="' + clave + '" data-signo-base="' + base + '" data-campo="' + ruta + '"';
    return '<div class="lt-campo lt-signo' + (est ? ' ' + est : '') + '" data-envoltura="' + ruta + '">' +
      etiqueta(def.nombre + (def.unidad ? ' (' + def.unidad + ')' : ''), def.req) +
      (def.decimal
        ? '<input class="lt-input" type="number" step="0.1" data-solo="decimal"' + attrs + ' value="' + U.escHtml(v) + '" placeholder="Ej. 36.5">'
        : '<input class="lt-input" type="tel" pattern="[0-9]*" data-solo="digitos" maxlength="4"' + attrs + ' value="' + U.escHtml(v) + '">') +
      '<div class="lt-signo-aviso" data-aviso-signo="' + clave + '">' + textoEstadoSigno(est) + '</div></div>';
  }
  function textoEstadoSigno(est){
    return est === 'fuera' ? 'Fuera del rango normal' : (est === 'imposible' ? 'Valor no válido' : '');
  }

  function totalGlasgow(){
    var g = hc.datos.glasgow;
    var o = parseInt(g.ocular, 10), v = parseInt(g.verbal, 10), m = parseInt(g.motora, 10);
    return o && v && m ? o + v + m : null;
  }

  function avisoGlasgow(){
    var t = totalGlasgow(), neuro = hc.datos.valoracion.neuro;
    if(t === null || !neuro) return '';
    if(neuro === 'INCONSCIENTE' && t >= 13) return 'El paciente está marcado como <strong>inconsciente</strong> pero el Glasgow es ' + t + '/15. Revisa los dos datos.';
    if(neuro === 'ALERTA' && t <= 8) return 'El paciente está marcado como <strong>alerta</strong> pero el Glasgow es ' + t + '/15. Revisa los dos datos.';
    return '';
  }

  function modulo4(){
    var v = hc.datos.valoracion, edad = edadAnios();
    var cuerpoAbcde =
      abc('via_aerea', 'A. Vía aérea', VIA_AEREA) +
      abc('respiracion', 'B. Respiración', RESPIRACION) +
      abc('circulacion', 'C. Circulación', CIRCULACION) +
      chips('valoracion.neuro', 'D. Estado neurológico', NEURO, true) +
      multiChips('valoracion.orientado', 'Orientado en', ORIENTACION) +
      interruptor('valoracion.exposicion_si', 'E. Exposición: ¿hay hallazgos?') +
      (v.exposicion_si ? campo('valoracion.exposicion', 'Hallazgos de la exposición', { req: true, tipo: 'area', filas: 3, max: 1000 })
        : '<div class="lt-muted">Se registra como "' + NO_REFIERE + '".</div>');

    var cuerpoSignos =
      campo('signos.hora', 'Hora de la toma', { req: true, tipo: 'hora', ayuda: 'La hora exacta en que tomaste los signos (formato 24 horas, ej. 14:30).' }) +
      fila([campoSigno('ta_sis'), campoSigno('ta_dia')]) +
      fila([campoSigno('fc'), campoSigno('fr')]) +
      fila([campoSigno('spo2'), campoSigno('temp')]) +
      fila([campoSigno('gluco'), campoSigno('eva')]) +
      (edad !== null && edad < 14 ? '<div class="lt-muted">Paciente pediátrico: los valores no se marcan en rojo (los rangos normales son de adultos).</div>' : '');

    var t = totalGlasgow(), aviso = avisoGlasgow();
    var cuerpoGlasgow =
      chips('glasgow.ocular', 'Respuesta ocular', GLASGOW.ocular, true) +
      chips('glasgow.verbal', 'Respuesta verbal', GLASGOW.verbal, true) +
      chips('glasgow.motora', 'Respuesta motora', GLASGOW.motora, true) +
      '<div class="lt-glasgow-total">Total Glasgow: <strong>' + (t === null ? '—' : t) + '</strong> / 15</div>' +
      (aviso ? '<div class="lt-aviso">' + aviso + '</div>' : '');

    return seccion('Valoración primaria ABCDE', cuerpoAbcde) +
      seccion('Signos vitales' + ((hc.datos.signos_tomas || []).length ? ' · Toma 1 (Inicio)' : ''), cuerpoSignos) +
      (hc.modo === 'admin' ? seccionTomas(1) : '') +
      seccion('Escala de Glasgow', cuerpoGlasgow);
  }

  // ── Tomas adicionales de signos vitales (novedades y editor del admin) ──
  // Hasta 3 en total: con 2 se rotulan Inicio / Final; con 3, Inicio /
  // Durante / Final. previas: tomas que la HC ya tiene antes de estas.
  function etiquetasTomas(total){
    return total <= 1 ? [''] : (total === 2 ? ['Inicio', 'Final'] : ['Inicio', 'Durante', 'Final']);
  }
  function formToma(i, titulo){
    var base = 'signos_tomas.' + i;
    return '<div class="lt-proc">' +
      '<div class="lt-proc-cab"><strong>' + U.escHtml(titulo) + '</strong>' +
        '<button type="button" class="lt-link" data-hc="toma-quitar" data-i="' + i + '">Quitar</button></div>' +
      campo(base + '.hora', 'Hora de la toma', { req: true, tipo: 'hora' }) +
      fila([campoSigno('ta_sis', base), campoSigno('ta_dia', base)]) +
      fila([campoSigno('fc', base), campoSigno('fr', base)]) +
      fila([campoSigno('spo2', base), campoSigno('temp', base)]) +
      fila([campoSigno('gluco', base), campoSigno('eva', base)]) +
      '</div>';
  }
  function seccionTomas(previas){
    var tomas = hc.datos.signos_tomas || [], total = previas + tomas.length, et = etiquetasTomas(total);
    var cuerpo = '<div class="lt-muted">Hasta 3 tomas en total. En el PDF: con 2 tomas, Inicio y Final; con 3, Inicio, Durante y Final.</div>';
    for(var i = 0; i < tomas.length; i++) cuerpo += formToma(i, 'Toma ' + (previas + i + 1) + ' · ' + et[previas + i]);
    cuerpo += total < 1 + MAX_TOMAS_EXTRA
      ? '<button type="button" class="lt-btn-sec primario lt-btn-agregar" data-hc="toma-agregar">+ Agregar toma de signos vitales</button>'
      : '<div class="lt-muted">Ya están las 3 tomas posibles.</div>';
    return seccion('Tomas de signos vitales (' + total + ' de 3)', cuerpo);
  }
  function agregarToma(){
    hc.datos.signos_tomas.push({ hora: horaActual() });
    guardarHC();
    redibujarM6();
  }
  function quitarToma(i){
    hc.datos.signos_tomas.splice(i, 1);
    guardarHC();
    redibujarM6();
  }

  // ── Módulo 5: examen físico, triage y procedimientos ──
  function modulo5(){
    var ex = hc.datos.examen, html = '';
    for(var i = 0; i < SEGMENTOS.length; i++){
      var k = SEGMENTOS[i][0], texto = txt(ex[k]);
      if(texto || _examenAbiertos[k]){
        html += '<div class="lt-examen abierto">' +
          campo('examen.' + k, SEGMENTOS[i][1], { tipo: 'area', filas: 2, max: 1000, ph: 'Describe el hallazgo (si lo dejas vacío queda "' + ESTADO_ADECUADO + '")' }) + '</div>';
      } else {
        html += '<button type="button" class="lt-examen" data-hc="examen-abrir" data-seg="' + k + '">' +
          '<span class="lt-examen-seg">' + SEGMENTOS[i][1] + '</span><span class="lt-examen-ok">' + ESTADO_ADECUADO + '</span>' +
          '<span class="lt-examen-mas">Anotar hallazgo</span></button>';
      }
    }
    var cuerpoExamen = '<div class="lt-muted">Toca solo las partes con hallazgos. Las demás quedan como "' + ESTADO_ADECUADO + '".</div>' + html;

    var cuerpoTriage = chips('triage', 'Clasificación', TRIAGE, true, 'I es la más urgente y V la menos urgente.');

    var cuerpoProc = '<div class="lt-muted">Responsable: <strong>' + U.escHtml(responsableTexto()) + '</strong>.</div>' +
      seccionProcedimientos('No hay procedimientos registrados. Si no se realizó ninguno, continúa.');

    return seccion('Examen físico cefalocaudal', cuerpoExamen) +
      seccion('Triage prehospitalario', cuerpoTriage) +
      seccion('Procedimientos realizados', cuerpoProc);
  }

  // Procedimientos: se escriben en un formulario (hc.datos.proc_form, el que
  // se agrega o edita; el servidor lo ignora) y con "Guardar procedimiento"
  // pasan a la lista, como los medicamentos, con un lápiz para editarlos.
  var _procError = '';
  function seccionProcedimientos(vacio){
    var procs = hc.datos.procedimientos || [], f = hc.datos.proc_form, html = '';
    for(var j = 0; j < procs.length; j++){
      if(f && f.i === j){ html += formProcedimiento(); continue; }
      html += '<div class="lt-med lt-proc-item">' +
        '<div class="lt-med-txt">' +
          '<div class="lt-med-nombre">' + U.escHtml(mayus(procs[j].descripcion) || 'Sin descripción') + '</div>' +
          '<div class="lt-med-meta"><strong>' + U.escHtml(procs[j].hora || '--:--') + '</strong> · Responsable: ' + U.escHtml(responsableTexto()) + '</div>' +
        '</div>' +
        (f ? '' : '<button type="button" class="lt-btn-sec lt-proc-editar" data-hc="proc-editar" data-i="' + j + '" title="Editar procedimiento">' +
          '<img src="/img/iconos/editar.svg" alt="">Editar</button>') +
      '</div>';
    }
    if(!procs.length && !f) html += '<div class="lt-muted">' + vacio + '</div>';
    if(f && !(f.i >= 0 && f.i < procs.length)) html += formProcedimiento();
    if(!f) html += '<button type="button" class="lt-btn-sec primario lt-btn-agregar" data-hc="proc-agregar">+ Agregar procedimiento</button>';
    return html;
  }

  function formProcedimiento(){
    var f = hc.datos.proc_form, nuevo = !(f.i >= 0);
    return '<div class="lt-proc" data-envoltura="proc_form">' +
      '<div class="lt-proc-cab"><strong>' + (nuevo ? 'Nuevo procedimiento' : 'Editar procedimiento') + '</strong></div>' +
      campo('proc_form.hora', 'Hora', { req: true, tipo: 'hora' }) +
      campo('proc_form.descripcion', 'Procedimiento realizado', { req: true, tipo: 'area', filas: 2, max: 500,
        ph: 'Escribe con exactitud el procedimiento. Ej. Inmovilización de muñeca derecha con férula' }) +
      dato('Responsable', U.escHtml(responsableTexto())) +
      (_procError ? '<div class="lt-proc-error">' + U.escHtml(_procError) + '</div>' : '') +
      '<div class="lt-proc-botones">' +
        '<button type="button" class="lt-btn" data-hc="proc-guardar">Guardar procedimiento</button>' +
        '<button type="button" class="lt-btn-sec" data-hc="proc-cancelar">Cancelar</button>' +
        (nuevo ? '' : '<button type="button" class="lt-btn-sec peligro" data-hc="proc-quitar" data-i="' + f.i + '">Eliminar</button>') +
      '</div></div>';
  }

  function horaActual(){
    var d = new Date(new Date().getTime() - 5 * 3600 * 1000);   // hora de Colombia
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function redibujarAqui(enfocar){
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
    var t = enfocar && document.querySelector('[data-campo="' + enfocar + '"]');
    if(t) t.focus();
  }

  function agregarProcedimiento(){
    hc.datos.proc_form = { i: -1, hora: horaActual(), descripcion: '' };
    _procError = '';
    guardarHC();
    redibujarAqui('proc_form.descripcion');
  }

  function editarProcedimiento(i){
    var p = (hc.datos.procedimientos || [])[i];
    if(!p) return;
    hc.datos.proc_form = { i: i, hora: p.hora || '', descripcion: p.descripcion || '' };
    _procError = '';
    guardarHC();
    redibujarAqui('proc_form.descripcion');
  }

  function guardarProcedimiento(){
    var f = hc.datos.proc_form;
    if(!f) return;
    _procError = !RE_HORA.test(f.hora || '') ? 'Escribe la hora del procedimiento (HH:MM)'
      : txt(f.descripcion).length < 3 ? 'Describe el procedimiento realizado' : '';
    if(_procError){ redibujarAqui(); return; }
    var procs = hc.datos.procedimientos, p = {}, k;
    var antes = f.i >= 0 && f.i < procs.length ? procs[f.i] : null;
    if(antes) for(k in antes) if(antes.hasOwnProperty(k)) p[k] = antes[k];
    p.hora = f.hora;
    p.descripcion = mayus(f.descripcion);
    if(antes) procs[f.i] = p; else procs.push(p);
    delete hc.datos.proc_form;
    guardarHC();
    redibujarAqui();
  }

  function cancelarProcedimiento(){
    delete hc.datos.proc_form;
    _procError = '';
    guardarHC();
    redibujarAqui();
  }

  function quitarProcedimiento(i){
    U.modal('Eliminar procedimiento', '¿Eliminar este procedimiento de la historia clínica?',
      [{ texto: 'Cancelar' }, { texto: 'Eliminar', clase: 'peligro', accion: function(){
        hc.datos.procedimientos.splice(i, 1);
        delete hc.datos.proc_form;
        _procError = '';
        guardarHC();
        redibujarAqui();
      } }]);
  }

  // ── Módulo 6: suministro de medicamentos e insumos ──
  // El consumo se registra en el inventario en el momento (o queda en la cola
  // offline) y se anota en la HC con dosis, vía y hora. El documento del
  // paciente sale del módulo 2.
  function eventoDeHC(){
    for(var i = 0; i < (st.eventos || []).length; i++) if(st.eventos[i].id === hc.evento_id) return st.eventos[i];
    return null;
  }

  function bodegasDeHC(){
    if(hc.modo === 'admin') return hc.bodegas || [];   // asignadas a quien la diligenció
    var ev = eventoDeHC();
    return ev ? (ev.bodegas || []) : [];
  }

  function bodegaM6(){
    var b = bodegasDeHC();
    for(var i = 0; i < b.length; i++) if(b[i].id === _m6.bodegaId) return b[i];
    return null;
  }

  // Estado de un consumo de la HC: registrado en el servidor, pendiente en la
  // cola offline o rechazado al sincronizar
  function estadoConsumo(m){
    var c = U.consumoEnCola(m.client_id);
    if(!c) return { clase: '', txt: 'Registrado' };
    if(c.error) return { clase: 'error', txt: 'No registrado: ' + c.error };
    return { clase: 'pendiente', txt: 'Pendiente de sincronizar' };
  }

  function textoVia(m){
    if(!m.es_medicamento) return '';
    var t = m.via;
    for(var i = 0; i < VIAS.length; i++) if(VIAS[i][0] === m.via) t = VIAS[i][1];
    return m.via === 'OTRA' ? m.via_otra : t;
  }

  function modulo6(){
    if(!_m6) _m6 = m6Nuevo();
    var html = seccion('Medicamentos e insumos suministrados',
      listaMedsHtml('Aún no se ha registrado ningún medicamento ni insumo. Si no se suministró nada, continúa con la historia clínica.'));
    return html + '<div class="lt-campo" data-envoltura="m6">' + formularioM6() + '</div>';
  }

  function listaMedsHtml(vacio){
    var meds = hc.datos.medicamentos || [], lista = '';
    for(var i = 0; i < meds.length; i++){
      var m = meds[i], e = estadoConsumo(m);
      lista += '<div class="lt-med' + (e.clase ? ' ' + e.clase : '') + '">' +
        '<div class="lt-med-txt">' +
          '<div class="lt-med-nombre">' + U.escHtml(m.nombre) + '</div>' +
          '<div class="lt-med-meta"><strong>' + m.cantidad + ' ' + U.escHtml(m.unidad || '') + '</strong>' +
            (m.es_medicamento ? ' · Dosis ' + U.escHtml(m.dosis) + ' · ' + U.escHtml(textoVia(m)) + ' · ' + U.escHtml(m.hora) : ' · Insumo') +
            ' · ' + U.escHtml(m.bodega_nombre) + '</div>' +
          '<div class="lt-med-estado">' + U.escHtml(e.txt) + '</div>' +
        '</div>' +
        '<button type="button" class="lt-btn-sec peligro lt-med-quitar" data-hc="m6-quitar" data-id="' + U.escHtml(m.client_id) + '">Quitar</button>' +
      '</div>';
    }
    return meds.length ? lista : '<div class="lt-muted">' + vacio + '</div>';
  }

  function formularioM6(){
    // Recién registrado: registrar otro o seguir con la HC
    if(_m6.ultimo){
      var u = _m6.ultimo;
      return seccion('Registrar consumo',
        '<div class="lt-ok">✓ Registrado: <strong>' + U.escHtml(u.nombre) + '</strong> · ' + u.cantidad + ' ' + U.escHtml(u.unidad || '') +
          (u.pendiente ? '<br><span class="lt-gris">Guardado en la tablet: se subirá al sincronizar.</span>' : '') + '</div>' +
        '<div class="lt-m6-siguiente">' +
          '<button type="button" class="lt-btn-sec primario" data-hc="m6-otro">+ Registrar otro consumo</button>' +
          (hc.modo === 'novedad' ? '' : '<button type="button" class="lt-btn" data-hc="siguiente">Continuar con la historia clínica ›</button>') +
        '</div>');
    }
    var bodegas = bodegasDeHC();
    if(!bodegas.length){
      return seccion('Registrar consumo', '<div class="lt-aviso">No tienes bodegas asignadas en el evento de esta historia clínica: no puedes registrar consumos. Continúa con la historia clínica o contacta al administrador.</div>');
    }
    if(bodegas.length === 1 && !_m6.bodegaId) _m6.bodegaId = bodegas[0].id;
    var b = bodegaM6();

    var paso1 = '<label class="lt-label">Bodega <span class="lt-req">*</span></label><div class="lt-chips">';
    for(var i = 0; i < bodegas.length; i++){
      paso1 += '<button type="button" class="lt-chip' + (bodegas[i].id === _m6.bodegaId ? ' sel' : '') + '" data-hc="m6-bodega" data-id="' + bodegas[i].id + '">' + U.escHtml(bodegas[i].nombre) + '</button>';
    }
    paso1 += '</div>';
    if(!b) return seccion('Registrar consumo', paso1);

    var item = _m6.idx !== null ? st.stock[_m6.idx] : null;
    var cuerpo = paso1;
    if(!item){
      cuerpo += '<label class="lt-label">Buscar medicamento o insumo</label>' +
        '<input class="lt-input" type="text" id="lt-m6-buscar" data-m6="buscar" placeholder="Nombre, SKU, lote…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="' + U.escHtml(_m6.q) + '">' +
        '<div class="lt-resultados" id="lt-m6-res">' + resultadosM6() + '</div>';
      return seccion('Registrar consumo', cuerpo);
    }

    var esMed = esMedicamento(item), f = _m6.form;
    cuerpo += '<div class="lt-card lt-item on">' +
        '<div class="lt-item-name">' + U.escHtml(item.nombre) + '</div>' +
        '<div class="lt-item-sub">' + U.escHtml((item.sku_global || '') + ' · ' + (item.sub_sku || '')) + (item.lote ? ' · Lote ' + U.escHtml(item.lote) : '') +
          ' · Vence ' + U.fmtFecha(item.caducidad) + U.semHtml(item.caducidad) + '</div>' +
        '<div class="lt-item-stock">Disponible en ' + U.escHtml(b.nombre) + ': <strong>' + item.cantidad + '</strong> ' + U.escHtml(item.unidad || '') +
          (st.offline ? ' <span class="lt-pend">según datos descargados</span>' : '') + '</div>' +
        '<div class="lt-item-tipo">' + (esMed ? 'Medicamento: registra dosis, vía y hora' : 'Insumo: solo cantidad') + '</div>' +
        '<button class="lt-link" type="button" data-hc="m6-cambiar">Cambiar producto</button>' +
      '</div>' +
      '<label class="lt-label">Cantidad (' + U.escHtml(item.unidad || 'unidades') + ') <span class="lt-req">*</span></label>' +
      '<input class="lt-input lt-cantidad" type="tel" pattern="[0-9]*" maxlength="5" data-m6="cantidad" data-solo="digitos" value="' + U.escHtml(f.cantidad || '') + '" placeholder="0">';
    if(esMed){
      cuerpo += fila([
          '<label class="lt-label">Dosis administrada <span class="lt-req">*</span></label>' +
            '<input class="lt-input lt-mayus" type="text" autocapitalize="characters" data-m6="dosis" maxlength="60" value="' + U.escHtml(f.dosis || '') + '" placeholder="Ej. 500 mg, 1 g, 10 mL">' +
            (_m6.conc ? '<div class="lt-ayuda">Sugerida según el medicamento (' + U.escHtml(dosisSugerida(_m6.conc, 1)) + ' por ' + U.escHtml((item.unidad || 'unidad').toLowerCase()) + ' × cantidad). Corrígela si administraste otra dosis.</div>' : ''),
          '<label class="lt-label">Hora de administración <span class="lt-req">*</span></label>' +
            '<input class="lt-input lt-hora" type="tel" pattern="[0-9]*" maxlength="5" data-m6="hora" data-solo="hora" value="' + U.escHtml(f.hora || '') + '" placeholder="HH:MM">'
        ]) +
        '<label class="lt-label">Vía de administración <span class="lt-req">*</span></label><div class="lt-chips">';
      for(var v = 0; v < VIAS.length; v++){
        cuerpo += '<button type="button" class="lt-chip' + (f.via === VIAS[v][0] ? ' sel' : '') + '" data-hc="m6-via" data-v="' + VIAS[v][0] + '">' + VIAS[v][1] + '</button>';
      }
      cuerpo += '</div>' + (f.via === 'OTRA'
        ? '<label class="lt-label">¿Cuál vía? <span class="lt-req">*</span></label><input class="lt-input lt-mayus" type="text" autocapitalize="characters" data-m6="via_otra" maxlength="60" value="' + U.escHtml(f.via_otra || '') + '">' : '');
    }
    cuerpo += '<div class="lt-error' + (_m6.error ? ' on' : '') + '" id="lt-m6-error">' + U.escHtml(_m6.error) + '</div>' +
      '<button type="button" class="lt-btn" data-hc="m6-registrar"' + (_m6.enviando ? ' disabled' : '') + '>' + (_m6.enviando ? 'Registrando…' : 'Registrar consumo') + '</button>';
    return seccion('Registrar consumo', cuerpo);
  }

  function resultadosM6(){
    var b = bodegaM6();
    if(!b) return '';
    var q = String(_m6.q || '').toLowerCase().replace(/^\s+|\s+$/g, '');
    if(!q){
      var total = 0;
      for(var k = 0; k < st.stock.length; k++) if(st.stock[k].bodega_nombre === b.nombre && st.stock[k].cantidad > 0) total++;
      return '<div class="lt-vacio">' + (total ? total + ' producto' + (total !== 1 ? 's' : '') + ' con stock en esta bodega. Escribe para buscar.' : 'No hay productos con stock en esta bodega') + '</div>';
    }
    var html = '', n = 0;
    for(var i = 0; i < st.stock.length && n < MAX_RESULTADOS; i++){
      var r = st.stock[i];
      if(r.bodega_nombre !== b.nombre || r.cantidad <= 0) continue;
      if([r.nombre, r.sku_global, r.sub_sku, r.lote, r.proveedor].join(' ').toLowerCase().indexOf(q) === -1) continue;
      n++;
      html += '<button type="button" class="lt-res" data-hc="m6-item" data-idx="' + i + '">' +
        '<span class="lt-res-cant">' + r.cantidad + ' ' + U.escHtml(r.unidad || '') + '</span>' +
        '<span class="lt-res-name">' + U.escHtml(r.nombre) + '</span>' +
        '<span class="lt-res-meta">' + (esMedicamento(r) ? 'Medicamento' : 'Insumo') + ' · ' + U.escHtml(r.sku_global || '') +
        (r.lote ? ' · Lote ' + U.escHtml(r.lote) : '') + ' · Vence ' + U.fmtFecha(r.caducidad) + U.semHtml(r.caducidad) + '</span></button>';
    }
    return html || '<div class="lt-vacio">Sin resultados para "' + U.escHtml(q) + '"</div>';
  }

  function redibujarM6(){
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
  }

  function alEscribirM6(el){
    var campo = el.getAttribute('data-m6');
    var v = campo === 'buscar' ? el.value : enMayusculas(el);
    if(el.getAttribute('data-solo') === 'digitos'){ var dg = digitos(v); if(dg !== v) el.value = dg; v = dg; }
    if(el.getAttribute('data-solo') === 'hora'){
      var d4 = digitos(v).slice(0, 4);
      var hh = d4.length > 2 ? d4.slice(0, 2) + ':' + d4.slice(2) : d4;
      if(hh !== v) el.value = hh;
      v = hh;
    }
    if(campo === 'buscar'){ _m6.q = v; U.$('lt-m6-res').innerHTML = resultadosM6(); return; }
    _m6.form[campo] = v;
    if(campo === 'dosis') _m6.dosisAuto = false;
    if(campo === 'cantidad' && _m6.dosisAuto){
      _m6.form.dosis = dosisSugerida(_m6.conc, parseInt(v, 10) || 1);
      var dz = document.querySelector('[data-m6="dosis"]');
      if(dz) dz.value = _m6.form.dosis;
    }
  }

  function registrarM6(){
    var b = bodegaM6(), item = _m6.idx !== null ? st.stock[_m6.idx] : null, f = _m6.form;
    if(!b || !item) return;
    var esMed = esMedicamento(item);
    var cant = parseInt(digitos(f.cantidad), 10) || 0;
    var err = '';
    if(cant <= 0) err = 'Ingresa la cantidad suministrada';
    else if(cant > item.cantidad) err = 'Solo hay ' + item.cantidad + ' ' + (item.unidad || '') + ' disponibles en esta bodega';
    else if(esMed && !txt(f.dosis)) err = 'Escribe la dosis administrada';
    else if(esMed && !f.via) err = 'Selecciona la vía de administración';
    else if(esMed && f.via === 'OTRA' && !txt(f.via_otra)) err = 'Escribe cuál vía de administración';
    else if(esMed && !RE_HORA.test(f.hora || '')) err = 'Escribe la hora de administración (HH:MM)';
    _m6.error = err;
    if(err){ redibujarM6(); return; }

    var p = hc.datos.paciente;
    var consumo = {
      client_id: U.nuevoClientId(),
      sub_sku_id: item.sub_sku_id,
      bodega_origen_id: b.id,
      bodega_nombre: b.nombre,
      cantidad: cant,
      cedula_paciente: p.documento ? String(p.documento) : '',
      hc_client_id: hc.client_id,
      fecha_atencion: new Date().toISOString(),
      nombre: item.nombre,
      unidad: item.unidad,
      evento_id: hc.evento_id,
      // El editor del administrador registra la dosis con el consumo
      hc_id: hc.servidor_id || null,
      dosis: esMed ? txt(f.dosis) : '', via: esMed ? f.via : '', via_otra: esMed && f.via === 'OTRA' ? mayus(f.via_otra) : '',
      hora: esMed ? f.hora : horaActual()
    };
    var abierta = hc.client_id;
    _m6.enviando = true;
    redibujarM6();
    U.registrarConsumoHC(consumo, function(r){
      if(!hc || hc.client_id !== abierta) return;
      _m6.enviando = false;
      if(r.cancelado){ redibujarM6(); return; }
      if(r.error){ _m6.error = r.error; redibujarM6(); return; }
      var entrada = {
        client_id: consumo.client_id, sub_sku_id: item.sub_sku_id, nombre: item.nombre, lote: item.lote || '',
        unidad: item.unidad || '', familia: item.familia || '', es_medicamento: esMed,
        bodega_id: b.id, bodega_nombre: b.nombre, cantidad: cant,
        dosis: esMed ? txt(f.dosis) : '', via: esMed ? f.via : '', via_otra: esMed && f.via === 'OTRA' ? mayus(f.via_otra) : '',
        hora: esMed ? f.hora : horaActual(), registrado_at: consumo.fecha_atencion
      };
      hc.datos.medicamentos.push(entrada);
      guardarHC();
      _m6.ultimo = { nombre: item.nombre, cantidad: cant, unidad: item.unidad, pendiente: !!r.pendiente };
      _m6.idx = null; _m6.q = ''; _m6.form = {}; _m6.error = '';
      redibujarM6();
      U.toast(r.pendiente ? '✓ Guardado en la tablet (pendiente de sincronizar)' : '✓ Consumo registrado', 'ok');
    });
  }

  function pedirQuitarM6(clientId){
    var meds = hc.datos.medicamentos, m = null, i;
    for(i = 0; i < meds.length; i++) if(meds[i].client_id === clientId) m = meds[i];
    if(!m) return;
    var enCola = U.consumoEnCola(clientId);
    if(!enCola && st.offline){
      U.modal('Necesitas conexión', 'Este consumo ya está registrado en el inventario. Para quitarlo necesitas conexión: el stock se devuelve a la bodega con una reversión.', [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    U.modal('Quitar consumo',
      '¿Quitar <strong>' + m.cantidad + ' ' + U.escHtml(m.unidad || '') + ' de ' + U.escHtml(m.nombre) + '</strong> de esta historia clínica?<br><br>' +
      (enCola ? 'Todavía no se había sincronizado: se borra de la tablet.' : 'El stock vuelve a ' + U.escHtml(m.bodega_nombre) + ' (queda registrado como reversión).'),
      [{ texto: 'Cancelar' }, { texto: 'Quitar', clase: 'peligro', accion: function(){ quitarM6(m); } }]);
  }

  function quitarM6(m){
    var abierta = hc.client_id;
    function sacar(){
      if(!hc || hc.client_id !== abierta) return;
      var meds = hc.datos.medicamentos;
      for(var i = 0; i < meds.length; i++) if(meds[i].client_id === m.client_id){ meds.splice(i, 1); break; }
      _m6.ultimo = null;
      guardarHC();
      redibujarM6();
      U.toast('Consumo quitado de la historia clínica', 'ok');
    }
    if(hc.modo === 'admin'){
      // Editor del administrador: se quita del inventario y de la HC en el momento
      U.api('POST', '/api/hc/' + hc.servidor_id + '/consumos/anular', { client_id: m.client_id }, function(err){
        if(err){ U.modal('No se pudo quitar', U.escHtml(err.message), [{ texto: 'Entendido', clase: 'primario' }]); return; }
        U.devolverLocal({ sub_sku_id: m.sub_sku_id, bodega_nombre: m.bodega_nombre, cantidad: m.cantidad });
        sacar();
      });
      return;
    }
    if(U.quitarConsumoDeCola(m.client_id)){ sacar(); return; }
    U.api('POST', '/api/movimientos/anular-consumo', { client_id: m.client_id }, function(err){
      if(err && err.status !== 404){
        U.modal('No se pudo quitar', U.escHtml(err.sinRed ? 'Sin conexión: intenta de nuevo cuando tengas señal.' : err.message), [{ texto: 'Entendido', clase: 'primario' }]);
        return;
      }
      if(!err) U.devolverLocal({ sub_sku_id: m.sub_sku_id, bodega_nombre: m.bodega_nombre, cantidad: m.cantidad });
      sacar();   // 404: nunca llegó al inventario, basta con quitarlo de la HC
    });
  }

  function moduloProximo(m){
    return seccion(m.titulo,
      '<div class="lt-proximo">Este módulo se construye en una próxima fase del laboratorio. Pulsa <strong>Siguiente</strong> para continuar.</div>');
  }

  // ── Módulo 7: evolución, cierre, traslado y responsables ──
  function textoDe(lista, valor){
    for(var i = 0; i < lista.length; i++) if(lista[i][0] === valor) return lista[i][1];
    return '';
  }

  function bloqueFirma(campo, quien){
    var img = hc.firmas[campo];
    if(hc.modo === 'admin'){
      return '<div class="lt-campo" data-envoltura="firma.' + campo + '">' +
        (img ? '<img class="lt-firma-img" src="' + img + '" alt="Firma">' : '<div class="lt-gris">Sin firma' + (campo === 'medico' ? ' (se toma en Historias clínicas → Firma del médico)' : '') + '</div>') + '</div>';
    }
    return '<div class="lt-campo" data-envoltura="firma.' + campo + '">' +
      (img ? '<img class="lt-firma-img" src="' + img + '" alt="Firma">' +
             '<button type="button" class="lt-btn-sec" data-hc="firmar" data-firma-campo="' + campo + '">Volver a firmar</button>'
           : '<button type="button" class="lt-btn-sec primario lt-btn-firma" data-hc="firmar" data-firma-campo="' + campo + '">Firma ' + quien + '</button>') +
      '</div>';
  }

  // Evolución, destino y traslado (módulo 7 y novedades)
  function htmlCierre(){
    var d = hc.datos, c = d.cierre, t = c.traslado || {}, s = hc.servicio, esRechazo = rechazo();
    var cuerpoEvol =
      campo('cierre.evolucion', 'Evolución y descripción del servicio', { req: true, tipo: 'area', filas: 5, max: 4000,
        ph: 'Cómo evolucionó el paciente y qué servicio se le prestó…' }) +
      chips('cierre.condicion', 'Condición clínica al finalizar la atención', CONDICIONES, true) +
      (esRechazo
        ? '<div class="lt-campo"><label class="lt-label">Destino o disposición final del paciente</label><div class="lt-dato-v"><strong>Rechazo de atención</strong></div>' +
          '<div class="lt-ayuda">El paciente rechazó la atención en el consentimiento informado.</div></div>'
        : chips('cierre.destino', 'Destino o disposición final del paciente', DESTINOS, true));
    if(!esRechazo && c.destino === 'FALLECIDO_SITIO' && c.condicion && c.condicion !== 'FALLECIDO'){
      cuerpoEvol += '<div class="lt-aviso">El destino es <strong>fallecido en el sitio</strong> pero la condición final no es "Fallecido". Revisa los dos datos.</div>';
    }
    var html = seccion('Evolución y descripción del servicio', cuerpoEvol);

    if(!esRechazo && c.destino === 'TRASLADO'){
      html += seccion('Datos del traslado',
        dato('Origen', U.escHtml(s.lugar || '—') + (s.municipio ? ' <span class="lt-gris">· ' + U.escHtml(s.municipio) + '</span>' : '')) +
        campo('cierre.traslado.destino', 'Destino (a dónde se remite el paciente)', { req: true, max: 150, mayus: true, ph: 'Ej. HOSPITAL SAN VICENTE DE PAÚL' }) +
        chips('cierre.traslado.ambulancia', 'Tipo de ambulancia', AMBULANCIAS, true) +
        fila([campo('cierre.traslado.movil', 'Móvil', { req: true, tipo: 'alfanum', max: 30 }),
              campo('cierre.traslado.placa', 'Placa', { req: true, tipo: 'alfanum', max: 10, ph: 'Ej. ABC123' })]) +
        fila([campo('cierre.traslado.conductor', 'Conductor', { req: true, max: 120, mayus: true }),
              campo('cierre.traslado.telefono', 'Número telefónico', { req: true, tipo: 'telefono', max: 20 })]) +
        '<div class="lt-muted">La entrega del paciente en la institución la registra el administrador después. La historia clínica quedará <strong>abierta</strong> hasta entonces.</div>');
    }
    return html;
  }

  function modulo7(){
    var d = hc.datos, c = d.cierre, s = hc.servicio, esRechazo = rechazo();
    var html = htmlCierre();
    if(hc.modo === 'admin' && d.entrega){
      html += seccion('Entrega del paciente',
        fila([campo('entrega.fecha', 'Fecha', { req: true, tipo: 'fecha', sinMax: true }), campo('entrega.hora', 'Hora', { req: true, tipo: 'hora' })]) +
        campo('entrega.institucion', 'Institución', { req: true, max: 150, mayus: true }) +
        chips('entrega.servicio', 'Servicio receptor', [['URGENCIAS', 'Urgencias'], ['OTRO', 'Otro']], true) +
        (d.entrega.servicio === 'OTRO' ? campo('entrega.servicio_otro', '¿Cuál servicio?', { req: true, max: 80, mayus: true }) : '') +
        fila([campo('entrega.recibe_nombre', 'Nombre de quien recibe', { req: true, max: 120, mayus: true }),
              campo('entrega.recibe_cargo', 'Cargo', { req: true, max: 80, mayus: true })]));
    }

    // Responsables de la atención
    var meds = s.medicos || [], idMed = d.responsables.medico_id, med = null;
    for(var i = 0; i < meds.length; i++) if(String(meds[i].id) === String(idMed)) med = meds[i];
    var cuerpoMed;
    if(!meds.length){
      cuerpoMed = '<div class="lt-aviso">Este evento no tiene médico asignado: la atención queda bajo la responsabilidad de quien diligencia la historia clínica.</div>';
    } else {
      var opciones = [];
      for(var j = 0; j < meds.length; j++) opciones.push([String(meds[j].id), meds[j].nombre]);
      cuerpoMed = (meds.length > 1 ? chips('responsables.medico_id', 'Médico responsable', opciones, true) : '') +
        (med
          ? dato('Nombre', U.escHtml(med.nombre)) + dato('Cédula / Registro profesional', U.escHtml(med.cedula)) +
            bloqueFirma('medico', 'del médico') +
            (hc.firmas.medico ? '' : '<div class="lt-ayuda">Si el médico no puede firmar ahora, la historia clínica se envía con la firma médica <strong>pendiente</strong>.</div>')
          : '');
    }
    html += seccion('Responsables de la atención',
      '<div class="lt-subtitulo">Médico</div>' + cuerpoMed +
      '<div class="lt-subtitulo">TAPH / APH / Auxiliar (quien diligencia)</div>' +
      dato('Nombre', U.escHtml(diligencia().nombre)) + dato('Cédula', U.escHtml(diligencia().cedula || '')) +
      bloqueFirma('enfermero', 'de quien diligencia'));

    // Resumen y envío
    var p = d.paciente;
    var edad = calcularEdad(p.fecha_nacimiento, fechaAtencion());
    html += seccion('Resumen',
      dato('Paciente', U.escHtml(nombrePaciente(hc))) +
      dato('Documento', p.tipo_doc ? U.escHtml(p.tipo_doc + ' ' + (p.documento || '')) : '—') +
      dato('Edad', edad ? U.escHtml(edad) : '—') +
      dato('Inicio de la atención', U.fmtFecha(fechaAtencion()) + ' ' + U.horaCO(hc.inicio_atencion)) +
      dato('Consentimiento', U.escHtml(textoDe(DECISIONES, d.consentimiento.decision) || '—')) +
      (esRechazo ? '' : dato('Triage', U.escHtml(d.triage || '—')) +
        dato('Medicamentos e insumos', (d.medicamentos || []).length ? String(d.medicamentos.length) : 'Ninguno')) +
      dato('Destino', U.escHtml(esRechazo ? 'Rechazo de atención' : (textoDe(DESTINOS, c.destino) || '—'))) +
      (hc.modo === 'admin'
        ? '<div class="lt-campo" data-envoltura="motivo"><label class="lt-label">Motivo de la corrección <span class="lt-req">*</span></label>' +
            '<textarea class="lt-input lt-area" rows="2" maxlength="500" data-admin-motivo="1" placeholder="Ej. El paciente aportó su dirección y teléfono por llamada">' + U.escHtml(hc.motivo || '') + '</textarea>' +
            '<div class="lt-ayuda">Queda en el historial de cambios de la historia clínica y en las notas aclaratorias del PDF.</div></div>' +
          '<button type="button" class="lt-btn" data-hc="admin-guardar">Guardar cambios</button>'
        : hc.estado === 'por_enviar'
        ? '<div class="lt-aviso">Esta historia clínica está <strong>pendiente de envío</strong>. Se enviará con el botón <strong>Sincronizar</strong> cuando haya señal.</div>' +
          '<button type="button" class="lt-btn" data-hc="enviar">Intentar enviar ahora</button>'
        : '<div class="lt-muted">Al enviarla, el servidor le asigna su número (HC-AAAA-NNNN). Después ya no se puede modificar desde la tablet.</div>' +
          '<button type="button" class="lt-btn" data-hc="enviar">Enviar historia clínica</button>'));
    return html;
  }

  function rechazo(){ return (hc.datos.consentimiento || {}).decision === 'rechaza'; }

  function validarEntrega(err){
    var e = hc.datos.entrega || {};
    if(!fechaValida(e.fecha)) err('entrega.fecha', 'Entrega: indica la fecha');
    if(!RE_HORA.test(e.hora || '')) err('entrega.hora', 'Entrega: indica la hora (HH:MM)');
    if(txt(e.institucion).length < 3) err('entrega.institucion', 'Entrega: escribe la institución');
    if(!e.servicio) err('entrega.servicio', 'Entrega: selecciona el servicio receptor');
    else if(e.servicio === 'OTRO' && txt(e.servicio_otro).length < 3) err('entrega.servicio_otro', 'Entrega: escribe cuál servicio receptor');
    if(txt(e.recibe_nombre).length < 3) err('entrega.recibe_nombre', 'Entrega: escribe el nombre de quien recibe');
    if(txt(e.recibe_cargo).length < 3) err('entrega.recibe_cargo', 'Entrega: escribe el cargo de quien recibe');
  }
  function moduloOmitido(n){ return rechazo() && n >= 4 && n <= 6; }

  // ══════════════════════════════════════════
  // VALIDACIÓN (mismas reglas que src/utils/hc.js)
  // ══════════════════════════════════════════
  function validar(n){
    var e = [], d = hc.datos;
    function err(campo, msg){ e.push({ campo: campo, msg: msg }); }
    if(n === 2){
      // Todo obligatorio (menos EPS y ARL), sin datos de relleno
      var p = d.paciente;
      var nom = mayus(p.nombres), ape = mayus(p.apellidos), doc = String(p.documento || '');
      if(!p.procedencia) err('paciente.procedencia', 'Indica si el paciente es interno (está en el evento) o externo (ajeno al evento)');
      else if(p.procedencia === 'INTERNO' && !p.tipo_paciente) err('paciente.tipo_paciente', 'Selecciona el tipo de paciente');
      if(nom.length < 2 || !RE_NOMBRE.test(nom) || textoDeRelleno(nom)) err('paciente.nombres', 'Escribe los nombres del paciente (solo letras, sin datos de relleno)');
      if(ape.length < 2 || !RE_NOMBRE.test(ape) || textoDeRelleno(ape)) err('paciente.apellidos', 'Escribe los apellidos del paciente (solo letras, sin datos de relleno)');
      if(!p.tipo_doc) err('paciente.tipo_doc', 'Selecciona el tipo de documento');
      if(doc.length < 3) err('paciente.documento', 'Escribe el número de documento');
      else if(documentoDeRelleno(doc)) err('paciente.documento', 'El número de documento no es válido (parece un dato de relleno)');
      if(!fechaValida(p.fecha_nacimiento)) err('paciente.fecha_nacimiento', 'Indica la fecha de nacimiento');
      else if(!calcularEdad(p.fecha_nacimiento, fechaAtencion())) err('paciente.fecha_nacimiento', 'La fecha de nacimiento no puede ser posterior a hoy');
      else if(menorDeUnMes(p.fecha_nacimiento)) err('paciente.fecha_nacimiento', ERROR_NACIMIENTO);
      if(!p.sexo) err('paciente.sexo', 'Selecciona el sexo');
      if(!p.rh) err('paciente.rh', 'Selecciona el RH');
      if(!p.grupo) err('paciente.grupo', 'Selecciona el grupo sanguíneo');
      if(txt(p.direccion).length < 5 || textoDeRelleno(p.direccion, 4)) err('paciente.direccion', 'Escribe la dirección del paciente (sin datos de relleno)');
      if(txt(p.ciudad).length < 3 || textoDeRelleno(p.ciudad)) err('paciente.ciudad', 'Escribe la ciudad del paciente (sin datos de relleno)');
      if(!telefonoValido(p.telefono)) err('paciente.telefono', 'Teléfono del paciente: ' + ERROR_TELEFONO);
      if(!esMenorEstadoCivil() && !p.estado_civil) err('paciente.estado_civil', 'Selecciona el estado civil');
      if(txt(p.ocupacion).length < 3 || textoDeRelleno(p.ocupacion)) err('paciente.ocupacion', 'Escribe la ocupación del paciente (sin datos de relleno)');
      if(p.otra_aseguradora && !txt(p.aseguradora)) err('paciente.aseguradora', 'Escribe el nombre de la otra aseguradora');
      var a = d.acompanante;
      if(p.tipo_doc === 'TI' && !a.tiene) a.tiene = true;   // TI: acompañante obligatorio
      if(a.tiene){
        if(txt(a.nombre).length < 3 || textoDeRelleno(a.nombre)) err('acompanante.nombre', 'Escribe el nombre completo del acompañante (sin datos de relleno)');
        if(txt(a.parentesco).length < 3 || textoDeRelleno(a.parentesco)) err('acompanante.parentesco', 'Escribe el parentesco del acompañante');
        if(!telefonoValido(a.telefono)) err('acompanante.telefono', 'Teléfono del acompañante: ' + ERROR_TELEFONO);
      }
    }
    if(n === 3){
      if(txt(d.motivo.relato).length < 3) err('motivo.relato', 'Escribe el motivo de consulta y el relato del paciente');
      if(d.paciente.sexo !== 'M' && d.antecedentes.gestacion_si){
        var s = parseInt(digitos(d.antecedentes.semanas), 10);
        if(!(s >= 1 && s <= 45)) err('antecedentes.semanas', 'Indica las semanas de gestación (1 a 45)');
      }
      var c = d.consentimiento;
      if(!c.decision) err('consentimiento.decision', 'Registra la decisión del paciente sobre el consentimiento');
      if(c.decision === 'rechaza'){
        var t = c.testigo || {};
        if(txt(c.motivo_rechazo).length < 3) err('consentimiento.motivo_rechazo', 'Escribe el motivo del rechazo');
        if(!hc.firmas.paciente) err('firma.paciente', 'Falta la firma del paciente o acudiente');
        if(txt(t.nombres).length < 2 || textoDeRelleno(t.nombres)) err('consentimiento.testigo.nombres', 'Escribe el nombre del testigo (sin datos de relleno)');
        if(txt(t.apellidos).length < 2 || textoDeRelleno(t.apellidos)) err('consentimiento.testigo.apellidos', 'Escribe el apellido del testigo (sin datos de relleno)');
        if(digitos(t.cedula).length < 5 || documentoDeRelleno(t.cedula)) err('consentimiento.testigo.cedula', 'Escribe la cédula del testigo');
        if(!telefonoValido(t.telefono)) err('consentimiento.testigo.telefono', 'Teléfono del testigo: ' + ERROR_TELEFONO);
      }
    }
    if(n === 4){
      var v = d.valoracion;
      if(!v.via_aerea) err('valoracion.via_aerea', 'Selecciona el estado de la vía aérea (A)');
      if(!v.respiracion) err('valoracion.respiracion', 'Selecciona el estado de la respiración (B)');
      if(!v.circulacion) err('valoracion.circulacion', 'Selecciona el estado de la circulación (C)');
      if(!v.neuro) err('valoracion.neuro', 'Selecciona el estado neurológico (D)');
      if(v.exposicion_si && txt(v.exposicion).length < 3) err('valoracion.exposicion', 'Describe los hallazgos de la exposición (E)');
      validarSignos('signos', '', err);
      // Tomas adicionales (editor del administrador)
      for(var tk = 0; tk < (d.signos_tomas || []).length; tk++) validarSignos('signos_tomas.' + tk, 'Toma ' + (tk + 2) + ': ', err);
      if(!d.glasgow.ocular) err('glasgow.ocular', 'Selecciona la respuesta ocular (Glasgow)');
      if(!d.glasgow.verbal) err('glasgow.verbal', 'Selecciona la respuesta verbal (Glasgow)');
      if(!d.glasgow.motora) err('glasgow.motora', 'Selecciona la respuesta motora (Glasgow)');
    }
    if(n === 7){
      validarCierre(err);
      if((hc.servicio.medicos || []).length && !d.responsables.medico_id) err('responsables.medico_id', 'Selecciona el médico responsable');
      // En el editor del administrador la firma ya está en la HC (no se edita)
      if(hc.modo !== 'admin' && !hc.firmas.enfermero) err('firma.enfermero', 'Falta tu firma como responsable de la atención');
      if(hc.modo === 'admin' && hc.datos.entrega) validarEntrega(err);
    }
    if(n === 6){
      if(_m6 && _m6.idx !== null) err('m6', 'Registra el producto seleccionado o pulsa "Cambiar producto" para cancelarlo');
      var ms = d.medicamentos || [];
      for(var k = 0; k < ms.length; k++){
        var cola = U.consumoEnCola(ms[k].client_id);
        if(cola && cola.error) err('m6', ms[k].nombre + ' no se pudo registrar (' + cola.error + '): quítalo de la lista');
      }
    }
    if(n === 5){
      if(!d.triage) err('triage', 'Selecciona la clasificación de triage');
      if(d.proc_form) err('proc_form', 'Tienes un procedimiento sin guardar: toca "Guardar procedimiento" o "Cancelar"');
      var procs = d.procedimientos || [];
      for(var i = 0; i < procs.length; i++){
        var p = procs[i], b = 'procedimientos.' + i;
        if(!RE_HORA.test(p.hora || '')) err(b + '.hora', 'Procedimiento ' + (i + 1) + ': escribe la hora (HH:MM)');
        if(txt(p.descripcion).length < 3) err(b + '.descripcion', 'Procedimiento ' + (i + 1) + ': describe el procedimiento realizado');
      }
    }
    return e;
  }

  // Signos vitales de una toma (base 'signos' o 'signos_tomas.N')
  function validarSignos(base, prefijo, err){
    var sg = leerCampo(base) || {};
    if(!RE_HORA.test(sg.hora || '')) err(base + '.hora', prefijo + 'escribe la hora de la toma de signos vitales (HH:MM)');
    for(var clave in SIGNOS){
      if(!SIGNOS.hasOwnProperty(clave)) continue;
      var def = SIGNOS[clave], num = numeroSigno(sg[clave], def.decimal);
      if(num === null){ if(def.req) err(base + '.' + clave, prefijo + 'registra ' + def.nombre); }
      else if(isNaN(num) || num < def.posible[0] || num > def.posible[1]){
        err(base + '.' + clave, prefijo + def.nombre + ': valor no válido (entre ' + def.posible[0] + ' y ' + def.posible[1] + ')');
      }
    }
    var sis = numeroSigno(sg.ta_sis), dia = numeroSigno(sg.ta_dia);
    if(sis && dia && dia >= sis) err(base + '.ta_dia', prefijo + 'la tensión diastólica debe ser menor que la sistólica');
  }

  // Evolución, destino y traslado (módulo 7 y novedades)
  function validarCierre(err){
    var ci = hc.datos.cierre, tr = ci.traslado || {};
    if(txt(ci.evolucion).length < 3) err('cierre.evolucion', 'Escribe la evolución y descripción del servicio');
    if(!ci.condicion) err('cierre.condicion', 'Selecciona la condición clínica al finalizar la atención');
    if(!rechazo()){
      if(!ci.destino) err('cierre.destino', 'Selecciona el destino o disposición final del paciente');
      if(ci.destino === 'TRASLADO'){
        if(txt(tr.destino).length < 3) err('cierre.traslado.destino', 'Traslado: escribe el destino');
        if(!tr.ambulancia) err('cierre.traslado.ambulancia', 'Traslado: selecciona el tipo de ambulancia');
        if(!txt(tr.movil)) err('cierre.traslado.movil', 'Traslado: escribe el número del móvil');
        if(String(tr.placa || '').replace(/[^A-Za-z0-9]/g, '').length < 5) err('cierre.traslado.placa', 'Traslado: escribe la placa');
        if(txt(tr.conductor).length < 3 || textoDeRelleno(tr.conductor)) err('cierre.traslado.conductor', 'Traslado: escribe el nombre del conductor (sin datos de relleno)');
        if(!telefonoValido(tr.telefono)) err('cierre.traslado.telefono', 'Traslado: teléfono — ' + ERROR_TELEFONO);
      }
    }
  }

  function mostrarErrores(errores){
    var cont = U.$('lt-hc-errores');
    var marcados = document.querySelectorAll('#lt-hc-modulo .lt-invalido');
    for(var k = 0; k < marcados.length; k++) marcados[k].className = marcados[k].className.replace(/\s*lt-invalido/g, '');
    if(!errores.length){ cont.innerHTML = ''; U.mostrar('lt-hc-errores', false); return; }
    var html = '<strong>Revisa ' + (errores.length === 1 ? 'este dato' : 'estos ' + errores.length + ' datos') + ':</strong><ul>';
    for(var i = 0; i < errores.length; i++){
      html += '<li>' + U.escHtml(errores[i].msg) + '</li>';
      var env = document.querySelector('#lt-hc-modulo [data-envoltura="' + errores[i].campo + '"]');
      if(env) env.className += ' lt-invalido';
    }
    cont.innerHTML = html + '</ul>';
    U.mostrar('lt-hc-errores', true);
    var y = cont.getBoundingClientRect().top + (window.pageYOffset || 0) - 10;
    window.scrollTo(0, y);
  }

  // ══════════════════════════════════════════
  // EDITOR
  // ══════════════════════════════════════════
  function renderPasos(){
    var html = '';
    for(var i = 0; i < MODULOS.length; i++){
      var m = MODULOS[i];
      var cls = 'lt-paso';
      if(m.n === hc.paso) cls += ' actual';
      else if(m.n <= hc.max_paso) cls += ' hecho';
      if(moduloOmitido(m.n)) cls += ' omitido';
      var habil = m.n <= hc.max_paso && !moduloOmitido(m.n);
      html += '<button type="button" class="' + cls + '" data-hc="paso" data-paso="' + m.n + '"' + (habil ? '' : ' disabled') + '>' +
        '<span class="lt-paso-n">' + m.n + '</span><span class="lt-paso-t">' + m.corto + '</span></button>';
    }
    U.$('lt-hc-pasos').innerHTML = html;
  }

  function renderModulo(){
    if(hc.modo === 'novedad'){ renderNovedad(); return; }
    U.$('lt-hc-anterior').style.display = '';
    var m = MODULOS[hc.paso - 1];
    var html;
    if(hc.paso === 1) html = modulo1();
    else if(hc.paso === 2) html = modulo2();
    else if(hc.paso === 3) html = modulo3();
    else if(hc.paso === 4) html = modulo4();
    else if(hc.paso === 5) html = modulo5();
    else if(hc.paso === 6) html = modulo6();
    else if(hc.paso === 7) html = modulo7();
    else html = moduloProximo(m);
    U.$('lt-hc-modulo').innerHTML = html;
    U.$('lt-hc-titulo').innerHTML = '<span class="lt-hc-paciente">' + U.escHtml(nombrePaciente(hc)) + '</span>' +
      '<span class="lt-hc-sub">' + (hc.consecutivo ? U.escHtml(hc.consecutivo) : 'HC sin número aún') + ' · Inicio ' +
      (hc.modo === 'admin' ? U.fmtFecha(fechaAtencion()) + ' ' : '') + U.horaCO(hc.inicio_atencion) +
      (hc.modo === 'admin' ? ' · Editando como administrador' : '') + '</span>';
    U.$('lt-hc-anterior').style.visibility = hc.paso > 1 ? 'visible' : 'hidden';
    U.$('lt-hc-siguiente').style.display = hc.paso < 7 ? '' : 'none';
    renderPasos();
  }

  function irA(n, sinScroll){
    if(n !== hc.paso) _m6 = null;
    if(n === 4 && !hc.datos.signos.hora) hc.datos.signos.hora = horaActual();
    hc.paso = n;
    if(n > hc.max_paso) hc.max_paso = n;
    if(hc.modo !== 'admin') guardarHC();   // en el editor del admin, navegar no es un cambio
    mostrarErrores([]);
    renderModulo();
    if(!sinScroll) window.scrollTo(0, 0);
  }

  function siguiente(){
    var errores = validar(hc.paso);
    if(errores.length){ mostrarErrores(errores); return; }
    var n = hc.paso + 1;
    while(n < 7 && moduloOmitido(n)) n++;
    irA(n);
  }

  function anterior(){
    var n = hc.paso - 1;
    while(n > 1 && moduloOmitido(n)) n--;
    irA(Math.max(1, n));
  }

  function abrir(clientId){
    var lista = leerTodas();
    var i = buscarHC(lista, clientId);
    if(i < 0){ U.toast('No se encontró la historia clínica en esta tablet', 'error'); renderLista(); return; }
    hc = lista[i];
    completarEstructura(hc);
    _examenAbiertos = {};
    _m6 = null;
    U.mostrar('lt-hc-editor', true);
    U.mostrar('lt-hc-inicio', false);
    U.$('lt-hc-guardado').textContent = hc.actualizada_at ? 'Guardado en la tablet · ' + U.horaCO(hc.actualizada_at) : '';
    U.$('lt-hc-guardado').className = 'lt-hc-guardado';
    mostrarErrores([]);
    renderModulo();
    window.scrollTo(0, 0);
  }

  function cerrarEditor(){
    if(hc){ clearTimeout(_guardarTimer); guardarHC(); }
    hc = null;
    U.mostrar('lt-hc-editor', false);
    U.mostrar('lt-hc-inicio', true);
    renderLista();
    window.scrollTo(0, 0);
  }

  function crear(){
    if(!st.evento){ U.toast('Primero elige el evento', 'error'); return; }
    hc = nuevaHC();
    completarEstructura(hc);
    if(!guardarHC()){
      hc = null;
      U.modal('No hay espacio en la tablet', 'No se pudo crear la historia clínica. Envía o sincroniza las que tienes pendientes e intenta de nuevo.', [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    abrir(hc.client_id);
  }

  // Cuadros de texto: lo escrito queda en MAYÚSCULAS (sin mover el cursor)
  function enMayusculas(el){
    var v = el.value;
    var esTexto = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text');
    if(!esTexto) return v;
    var up = v.toUpperCase();
    if(up === v) return v;
    var ini = el.selectionStart, fin = el.selectionEnd;
    el.value = up;
    try { if(typeof ini === 'number' && document.activeElement === el) el.setSelectionRange(ini, fin); } catch(e){}
    return up;
  }

  // Valor escrito en un campo → HC (con las transformaciones del campo)
  function alEscribir(el){
    var ruta = el.getAttribute('data-campo');
    if(!ruta || !hc) return;
    var v = enMayusculas(el);
    if(el.getAttribute('data-solo') === 'digitos'){
      var limpio = digitos(v);
      if(limpio !== v) el.value = limpio;
      v = limpio;
    }
    if(el.getAttribute('data-solo') === 'telefono'){
      var tel = String(v).replace(/[^\d+ ]/g, '').replace(/(?!^)\+/g, '');
      if(tel !== v) el.value = tel;
      v = tel;
    }
    if(el.getAttribute('data-fecha-dma')) v = isoDesdeDMA(v);
    if(el.getAttribute('data-solo') === 'hora'){
      // 1430 → 14:30 (teclado numérico)
      var dig = digitos(v).slice(0, 4);
      var hhmm = dig.length > 2 ? dig.slice(0, 2) + ':' + dig.slice(2) : dig;
      if(hhmm !== v) el.value = hhmm;
      v = hhmm;
    }
    if(el.getAttribute('data-solo') === 'decimal') v = String(v).replace(',', '.');
    if(ruta === 'paciente.documento' && TIPOS_ALFANUM[hc.datos.paciente.tipo_doc]){
      var alnum = v.toUpperCase().replace(/[^A-Z0-9\-]/g, '');
      if(alnum !== v) el.value = alnum;
      v = alnum;
    }
    fijarCampo(ruta, v);
    if(ruta === 'paciente.fecha_nacimiento'){
      var edad = calcularEdad(v, fechaAtencion());
      U.$('lt-hc-edad').innerHTML = edad && menorDeUnMes(v) ? '<span class="lt-error-txt">Mínimo un mes de nacido</span>'
        : edad ? U.escHtml(edad) : (v ? '<span class="lt-error-txt">Fecha no válida</span>' : '<span class="lt-gris">Se calcula con la fecha de nacimiento</span>');
      var conChips = !!document.querySelector('[data-chip="paciente.estado_civil"]');
      if(conChips === esMenorEstadoCivil()){
        guardarHC();
        var y0 = window.pageYOffset || 0;
        renderModulo();
        window.scrollTo(0, y0);
        return;
      }
    }
    var signo = el.getAttribute('data-signo');
    if(signo){
      // Marca en rojo al escribir, sin redibujar (no pierde el foco)
      var est = estadoSigno(signo, el.getAttribute('data-signo-base'));
      var env = el.parentNode;
      env.className = 'lt-campo lt-signo' + (est ? ' ' + est : '');
      var av = env.querySelector('[data-aviso-signo]');
      if(av) av.textContent = textoEstadoSigno(est);
    }
    if(el.getAttribute('data-redibujar')){
      guardarHC();
      var yy = window.pageYOffset || 0;
      renderModulo();
      window.scrollTo(0, yy);
      return;
    }
    if(ruta === 'paciente.nombres' || ruta === 'paciente.apellidos'){
      var t = U.$('lt-hc-titulo').firstChild;
      if(t) t.textContent = nombrePaciente(hc);
    }
    guardarPronto();
  }

  function alElegir(ruta, valor){
    if(ruta === 'consentimiento.decision' && valor === 'rechaza' && (hc.datos.medicamentos || []).length){
      U.modal('Hay consumos registrados',
        'Esta historia clínica tiene medicamentos o insumos registrados. Si el paciente rechaza la atención, quítalos primero en el módulo 6.',
        [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    var anterior = leerCampo(ruta);
    fijarCampo(ruta, valor);
    if(ruta === 'paciente.procedencia') fijarCampo('paciente.tipo_paciente', valor === 'EXTERNO' ? 'EXTERNO' : '');
    if(ruta === 'paciente.tipo_doc' && TIPOS_ALFANUM[anterior] && !TIPOS_ALFANUM[valor]){
      fijarCampo('paciente.documento', digitos(hc.datos.paciente.documento));   // pasa a solo números
    }
    guardarHC();
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
  }

  function alMarcar(ruta, valor){
    var lista = (leerCampo(ruta) || []).slice();
    var i = lista.indexOf(valor);
    if(i >= 0) lista.splice(i, 1); else lista.push(valor);
    fijarCampo(ruta, lista);
    guardarHC();
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
  }

  function alInterruptor(ruta, valor){
    fijarCampo(ruta, valor === 'si');
    if(ruta === 'paciente.nn'){
      var p = hc.datos.paciente;
      if(valor === 'si'){
        if(!txt(p.nombres)) p.nombres = 'NN';
        if(!txt(p.apellidos)) p.apellidos = 'NN';
      } else {
        // Ya no es NN: no dejar "NN" como si fuera su nombre
        if(mayus(p.nombres) === 'NN') p.nombres = '';
        if(mayus(p.apellidos) === 'NN') p.apellidos = '';
      }
    }
    guardarHC();
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
  }

  // ── Precarga: atención anterior del mismo paciente (solo con conexión) ──
  function consultarPaciente(){
    var p = hc.datos.paciente;
    if(hc.modo || st.offline || !p.tipo_doc || String(p.documento || '').length < 3) return;
    var clave = p.tipo_doc + ':' + p.documento;
    if(hc.precargado === clave) return;
    var abierta = hc.client_id;
    U.api('GET', '/api/hc/paciente?tipo_doc=' + encodeURIComponent(p.tipo_doc) + '&documento=' + encodeURIComponent(p.documento), null, function(err, previa){
      if(err || !previa || !hc || hc.client_id !== abierta) return;
      hc.precargado = clave;
      guardarHC();
      var pp = previa.paciente || {};
      U.modal('Paciente atendido antes',
        'Hay una atención anterior de <strong>' + U.escHtml(((pp.nombres || '') + ' ' + (pp.apellidos || '')).replace(/^\s+|\s+$/g, '')) + '</strong> el ' +
        U.fmtFecha(U.fechaCO(previa.fecha)) + '.<br><br>¿Cargar sus datos de identificación y antecedentes? Revísalos con el paciente.',
        [{ texto: 'No' }, { texto: 'Cargar datos', clase: 'primario', accion: function(){ aplicarPrevia(previa); } }]);
    });
  }

  function aplicarPrevia(previa){
    if(!hc) return;
    var pp = previa.paciente || {}, p = hc.datos.paciente;
    var campos = ['nombres','apellidos','fecha_nacimiento','sexo','rh','grupo','direccion','ciudad','telefono','estado_civil','ocupacion','eps','arl','otra_aseguradora','aseguradora'];
    for(var i = 0; i < campos.length; i++){
      if(pp[campos[i]] !== undefined && pp[campos[i]] !== null && pp[campos[i]] !== '') p[campos[i]] = pp[campos[i]];
    }
    var a = previa.antecedentes || {}, ant = hc.datos.antecedentes, alguno = false;
    for(var j = 0; j < ANTECEDENTES.length; j++){
      var v = a[ANTECEDENTES[j][0]];
      if(v && v !== NO_REFIERE){ ant[ANTECEDENTES[j][0]] = v; alguno = true; }
    }
    if(alguno) ant.refiere = true;
    guardarHC();
    renderModulo();
    U.toast('✓ Datos cargados: revísalos con el paciente', 'ok');
  }

  // ══════════════════════════════════════════
  // FIRMA TÁCTIL (panel a pantalla completa)
  // ══════════════════════════════════════════
  var firma = { canvas: null, ctx: null, trazando: false, puntos: 0, ultimo: null };

  function abrirFirma(campo){
    _firmaCampo = campo;
    U.$('lt-firma-titulo').textContent = TITULOS_FIRMA[campo] || 'Firma';
    U.mostrar('lt-firma', true);
    document.body.style.overflow = 'hidden';
    var c = U.$('lt-firma-canvas');
    var zona = U.$('lt-firma-zona');
    var ratio = window.devicePixelRatio || 1;
    var w = zona.clientWidth, h = zona.clientHeight;
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    firma.canvas = c;
    firma.ctx = c.getContext('2d');
    firma.ctx.scale(ratio, ratio);
    limpiarFirma();
  }

  function limpiarFirma(){
    var c = firma.canvas, ctx = firma.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    ctx.strokeStyle = '#0A1628';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    firma.puntos = 0;
  }

  function puntoDe(e){
    var r = firma.canvas.getBoundingClientRect();
    var t = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function firmaInicio(e){
    e.preventDefault();
    firma.trazando = true;
    firma.ultimo = puntoDe(e);
    firma.ctx.beginPath();
    firma.ctx.arc(firma.ultimo.x, firma.ultimo.y, 1.2, 0, Math.PI * 2);
    firma.ctx.fillStyle = '#0A1628';
    firma.ctx.fill();
    firma.puntos++;
  }
  function firmaMover(e){
    if(!firma.trazando) return;
    e.preventDefault();
    var p = puntoDe(e);
    firma.ctx.beginPath();
    firma.ctx.moveTo(firma.ultimo.x, firma.ultimo.y);
    firma.ctx.lineTo(p.x, p.y);
    firma.ctx.stroke();
    firma.ultimo = p;
    firma.puntos++;
  }
  function firmaFin(){ firma.trazando = false; }

  function cerrarFirma(){
    U.mostrar('lt-firma', false);
    document.body.style.overflow = '';
    _firmaCampo = null;
  }

  // Se guarda reducida (máx. 700 px de ancho) para que pese poco en la tablet
  function guardarFirma(){
    if(firma.puntos < 15){ U.toast('La firma está vacía o es muy corta', 'error'); return; }
    var c = firma.canvas;
    var escala = Math.min(1, 700 / c.width);
    var out = document.createElement('canvas');
    out.width = Math.round(c.width * escala);
    out.height = Math.round(c.height * escala);
    var octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, 0, 0, out.width, out.height);
    var dataUrl = out.toDataURL('image/png');
    var campoFirma = _firmaCampo;
    hc.firmas[campoFirma] = dataUrl;
    hc.firmas[campoFirma + '_at'] = new Date().toISOString();
    cerrarFirma();
    if(!guardarHC()){ U.toast('No hay espacio en la tablet para guardar la firma', 'error'); return; }
    var y = window.pageYOffset || 0;
    renderModulo();
    window.scrollTo(0, y);
    U.toast('✓ Firma guardada', 'ok');
  }

  // ══════════════════════════════════════════
  // ENVÍO Y SINCRONIZACIÓN
  // ══════════════════════════════════════════
  function cuerpoEnvio(h){
    var d = JSON.parse(JSON.stringify(h.datos));
    // Gestación: la tablet usa un interruptor; el servidor espera 'si' / 'no'
    d.antecedentes.gestacion = d.antecedentes.gestacion_si ? 'si' : 'no';
    delete d.antecedentes.gestacion_si;
    var meds = [];
    for(var i = 0; i < (d.medicamentos || []).length; i++){
      var m = d.medicamentos[i];
      meds.push({ client_id: m.client_id, nombre: m.nombre, dosis: m.dosis, via: m.via, via_otra: m.via_otra, hora: m.hora });
    }
    d.medicamentos = meds;
    if(d.consentimiento.decision === 'rechaza'){
      delete d.valoracion; delete d.signos; delete d.glasgow; delete d.examen; delete d.triage; d.procedimientos = [];
    }
    var firmas = {};
    if(h.firmas.paciente) firmas.paciente = h.firmas.paciente;
    if(h.firmas.medico) firmas.medico = h.firmas.medico;
    if(h.firmas.enfermero) firmas.enfermero = h.firmas.enfermero;
    d.cierre = d.cierre || {};
    d.responsables = d.responsables || {};
    if(d.consentimiento.decision === 'rechaza') d.cierre.destino = '';   // el servidor pone "rechazo de atención"
    if(d.cierre.destino !== 'TRASLADO') delete d.cierre.traslado;
    return { client_id: h.client_id, evento_id: h.evento_id, inicio_atencion: h.inicio_atencion, datos: d, firmas: firmas };
  }

  function pedirEnvio(){
    var errores = [];
    for(var n = 2; n <= 7; n++){
      if(moduloOmitido(n)) continue;
      var e = validar(n);
      if(e.length){ errores = e; irA(n); mostrarErrores(e); return; }
    }
    // Consumos de esta HC aún en la tablet: se suben primero (Sincronizar sube
    // los consumos y después la HC)
    var pendientes = 0, meds = hc.datos.medicamentos || [];
    for(var k = 0; k < meds.length; k++) if(U.consumoEnCola(meds[k].client_id)) pendientes++;
    if(pendientes && !st.offline){
      U.modal('Enviar historia clínica',
        'Esta historia clínica tiene <strong>' + pendientes + ' consumo' + (pendientes !== 1 ? 's' : '') + ' guardado' + (pendientes !== 1 ? 's' : '') + ' en la tablet</strong>. ' +
        'Se sincronizarán primero los consumos y después se enviará la historia clínica.<br><br>Después ya no podrás modificarla desde la tablet.',
        [{ texto: 'Cancelar' }, { texto: 'Sincronizar y enviar', clase: 'primario', accion: function(){
          hc.estado = 'por_enviar';
          guardarHC();
          cerrarEditor();
          U.sincronizar();
        } }]);
      return;
    }
    if(hc.estado === 'por_enviar'){ enviarAhora(); return; }
    U.modal('Enviar historia clínica',
      '¿Enviar la historia clínica de <strong>' + U.escHtml(nombrePaciente(hc)) + '</strong>?<br><br>Después ya no podrás modificarla desde la tablet.' +
      (st.offline ? '<br><br>Estás <strong>sin conexión</strong>: quedará pendiente y se enviará con el botón Sincronizar.' : ''),
      [{ texto: 'Cancelar' }, { texto: st.offline ? 'Guardar para enviar' : 'Enviar', clase: 'primario', accion: function(){
        hc.estado = 'por_enviar';
        guardarHC();
        U.renderModo();
        if(st.offline){ U.toast('Pendiente de envío: se enviará al sincronizar', 'ok'); cerrarEditor(); return; }
        enviarAhora();
      } }]);
  }

  function enviarAhora(){
    var h = hc;
    var btns = document.querySelectorAll('[data-hc="enviar"]');
    for(var i = 0; i < btns.length; i++){ btns[i].disabled = true; btns[i].textContent = 'Enviando…'; }
    enviarUna(h, function(res){
      if(res.ok){
        if(hc && hc.client_id === h.client_id) hc = null;
        U.mostrar('lt-hc-editor', false);
        U.mostrar('lt-hc-inicio', true);
        renderLista();
        U.renderModo();
        window.scrollTo(0, 0);
        U.modal('Historia clínica enviada',
          'Quedó registrada con el número <strong class="lt-consecutivo">' + U.escHtml(res.consecutivo) + '</strong>.' +
          (res.estado === 'abierta' ? '<br><br>Quedó <strong>abierta</strong>: el administrador registrará la entrega del paciente en la institución.' : '') +
          '<br><br>Mientras el evento siga activo podrás agregarle <strong>novedades</strong> (signos, procedimientos, medicamentos o la evolución) desde "Enviadas en este evento".',
          [{ texto: 'Aceptar', clase: 'primario' }]);
        return;
      }
      if(hc && hc.client_id === h.client_id) renderModulo();
      if(res.sinRed){
        U.toast('Sin conexión: la HC quedó pendiente y se enviará al sincronizar', 'error');
      } else if(res.sesion){
        U.modal('Tu sesión venció', 'La historia clínica quedó guardada en la tablet como pendiente de envío. Sal, vuelve a ingresar y pulsa Sincronizar.', [{ texto: 'Entendido', clase: 'primario' }]);
      } else {
        U.modal('No se pudo enviar', U.escHtml(res.error) + '<br><br>Corrige el dato y vuelve a enviar.', [{ texto: 'Entendido', clase: 'primario' }]);
      }
    });
  }

  // Envía una HC. cb({ ok, consecutivo } | { sinRed } | { sesion } | { error })
  function enviarUna(h, cb){
    U.api('POST', '/api/hc/enviar', cuerpoEnvio(h), function(err, data){
      var lista = leerTodas();
      var i = buscarHC(lista, h.client_id);
      if(!err){
        if(i >= 0) lista.splice(i, 1);
        guardarTodas(lista);
        var env = leerEnviadas();
        // Copia de la HC (sin firmas) para registrar novedades mientras el
        // evento siga activo; se borra cuando el evento finaliza
        env.unshift({ client_id: h.client_id, consecutivo: data.consecutivo, inicio_atencion: h.inicio_atencion, enviada_at: new Date().toISOString(), evento_id: h.evento_id,
                      copia: { servicio: h.servicio, inicio_atencion: h.inicio_atencion, datos: JSON.parse(JSON.stringify(h.datos)) } });
        env = env.slice(0, 200);
        for(var c = 40; c < env.length; c++) delete env[c].copia;
        guardarEnviadas(env);
        cb({ ok: true, consecutivo: data.consecutivo, estado: data.estado });
        return;
      }
      if(err.sinRed){ cb({ sinRed: true }); return; }
      if(U.sesionVencida(err)){ cb({ sesion: true }); return; }
      // Rechazada por datos: vuelve a borrador para corregirla
      if(err.status === 400 && i >= 0){
        lista[i].estado = 'borrador';
        lista[i].error_envio = err.message;
        guardarTodas(lista);
        if(hc && hc.client_id === h.client_id){ hc.estado = 'borrador'; hc.error_envio = err.message; }
      }
      cb({ error: err.message });
    });
  }

  // Botón Sincronizar: envía las HC pendientes, una tras otra
  function sincronizar(alTerminar){
    var pendientes = [];
    var lista = leerTodas();
    for(var i = 0; i < lista.length; i++) if(lista[i].estado === 'por_enviar') pendientes.push(lista[i]);
    var novPend = contar().novedades;
    var r = { enviadas: 0, errores: 0, sinRed: false, sesion: false, total: pendientes.length + novPend, novedades: 0, errores_nov: 0 };
    function siguiente(n){
      if(n >= pendientes.length || r.sinRed || r.sesion){
        if(r.sinRed || r.sesion){ renderLista(); alTerminar(r); return; }
        // Después de las HC, las novedades pendientes
        sincronizarNovedades(r, function(){ renderLista(); alTerminar(r); });
        return;
      }
      enviarUna(pendientes[n], function(res){
        if(res.ok) r.enviadas++;
        else if(res.sinRed) r.sinRed = true;
        else if(res.sesion) r.sesion = true;
        else r.errores++;
        siguiente(n + 1);
      });
    }
    siguiente(0);
  }

  // ══════════════════════════════════════════
  // LISTA DE HC (pantalla de inicio de la pestaña)
  // ══════════════════════════════════════════
  function renderLista(){
    var cont = U.$('lt-hc-lista');
    if(!cont || !st.usuario) return;
    var lista = leerTodas();
    lista.sort(function(a, b){ return a.inicio_atencion < b.inicio_atencion ? 1 : -1; });
    var html = '';
    if(!lista.length){
      html += '<div class="lt-vacio">No tienes historias clínicas en curso.</div>';
    }
    for(var i = 0; i < lista.length; i++){
      var h = lista[i];
      var otroEvento = st.evento && h.evento_id !== st.evento.id;
      var p = h.datos.paciente || {};
      var badge = h.estado === 'por_enviar' ? '<span class="lt-pend">Pendiente de envío</span>'
        : (h.error_envio ? '<span class="lt-pend error">Revisar</span>' : '<span class="lt-pend borrador">En curso · módulo ' + h.paso + ' de 7</span>');
      html += '<div class="lt-hc-item">' +
        '<div class="lt-hc-item-txt">' +
          '<div class="lt-hc-item-nombre">' + U.escHtml(nombrePaciente(h)) + badge + '</div>' +
          '<div class="lt-hc-item-meta">' + (p.tipo_doc && p.documento ? U.escHtml(p.tipo_doc + ' ' + p.documento) + ' · ' : '') +
            'Inicio ' + U.fmtFecha(U.fechaCO(h.inicio_atencion)) + ' ' + U.horaCO(h.inicio_atencion) +
            (otroEvento ? ' · <strong>Evento ' + U.escHtml(h.servicio.evento) + '</strong>' : '') + '</div>' +
          (h.error_envio ? '<div class="lt-hist-error">' + U.escHtml(h.error_envio) + '</div>' : '') +
        '</div>' +
        '<div class="lt-hc-item-btns">' +
          '<button type="button" class="lt-btn-sec primario" data-hc="abrir" data-id="' + U.escHtml(h.client_id) + '">' + (h.estado === 'por_enviar' ? 'Ver' : 'Continuar') + '</button>' +
          (h.estado === 'borrador' ? '<button type="button" class="lt-btn-sec peligro" data-hc="descartar" data-id="' + U.escHtml(h.client_id) + '">Descartar</button>' : '') +
        '</div></div>';
    }
    var env = leerEnviadas(), hoy = U.fechaCO(), delEvento = [], otrasHoy = [];
    purgarCopias(env);
    var novs = leerNovedades();
    for(var j = 0; j < env.length; j++){
      if(st.evento && env[j].evento_id === st.evento.id) delEvento.push(env[j]);
      else if(U.fechaCO(env[j].enviada_at) === hoy) otrasHoy.push(env[j]);
    }
    if(delEvento.length){
      html += '<div class="lt-subtitulo">Enviadas en este evento</div>' +
        '<div class="lt-muted">Puedes agregar novedades a tus historias clínicas hasta que finalice el evento.</div>';
      for(var k = 0; k < delEvento.length; k++) html += filaEnviada(delEvento[k], novs);
    }
    if(otrasHoy.length){
      html += '<div class="lt-subtitulo">Enviadas hoy en otros eventos</div>';
      for(var k2 = 0; k2 < otrasHoy.length; k2++){
        html += '<div class="lt-hc-env"><strong>' + U.escHtml(otrasHoy[k2].consecutivo) + '</strong> · Inicio ' + U.horaCO(otrasHoy[k2].inicio_atencion) +
          ' · Enviada ' + U.horaCO(otrasHoy[k2].enviada_at) + '</div>';
      }
    }
    cont.innerHTML = html;
  }

  function filaEnviada(e, novs){
    var pend = null, p = e.copia && e.copia.datos ? (e.copia.datos.paciente || {}) : {};
    for(var i = 0; i < novs.length; i++) if(novs[i].client_id === e.client_id) pend = novs[i];
    var nombre = mayus((p.nombres || '') + ' ' + (p.apellidos || ''));
    var badge = '', btn = '';
    if(pend){
      badge = pend.estado === 'por_enviar' ? '<span class="lt-pend">Novedad pendiente de envío</span>'
        : (pend.error_envio ? '<span class="lt-pend error">Novedad: revisar</span>' : '<span class="lt-pend borrador">Novedad en curso</span>');
      btn = '<button type="button" class="lt-btn-sec primario" data-hc="nov-abrir" data-id="' + U.escHtml(pend.nov_id) + '">' + (pend.estado === 'por_enviar' ? 'Ver novedad' : 'Continuar novedad') + '</button>';
    } else if(e.copia){
      btn = '<button type="button" class="lt-btn-sec" data-hc="nov-nueva" data-id="' + U.escHtml(e.client_id) + '">+ Agregar novedad</button>';
    }
    return '<div class="lt-hc-item lt-hc-item-env">' +
      '<div class="lt-hc-item-txt">' +
        '<div class="lt-hc-item-nombre"><strong>' + U.escHtml(e.consecutivo) + '</strong>' + (nombre ? ' · ' + U.escHtml(nombre) : '') + badge + '</div>' +
        '<div class="lt-hc-item-meta">Inicio ' + U.fmtFecha(U.fechaCO(e.inicio_atencion)) + ' ' + U.horaCO(e.inicio_atencion) + ' · Enviada ' + U.horaCO(e.enviada_at) + '</div>' +
        (pend && pend.error_envio ? '<div class="lt-hist-error">' + U.escHtml(pend.error_envio) + '</div>' : '') +
      '</div>' +
      '<div class="lt-hc-item-btns">' + btn + '</div></div>';
  }

  // Las copias (con datos del paciente) se borran cuando su evento ya no
  // está activo (finalizó) y no tienen novedades pendientes
  function purgarCopias(env){
    if(st.offline || !st.eventos) return;
    var activos = {}, cambio = false, i;
    for(i = 0; i < st.eventos.length; i++) activos[st.eventos[i].id] = true;
    for(i = 0; i < env.length; i++){
      if(env[i].copia && !activos[env[i].evento_id] && !novedadDe(env[i].client_id)){ delete env[i].copia; cambio = true; }
    }
    if(cambio) guardarEnviadas(env);
  }

  // ══════════════════════════════════════════
  // NOVEDADES (HC ya enviada, solo quien la diligenció, evento activo)
  // ══════════════════════════════════════════
  function copiaDe(hcClientId){
    var e = enviadaDe(hcClientId);
    return e && e.copia ? e.copia.datos : null;
  }

  function nuevaNovedad(hcClientId){
    var pend = novedadDe(hcClientId);
    if(pend){ abrirNovedad(pend.nov_id); return; }
    var e = enviadaDe(hcClientId);
    if(!e || !e.copia){ U.toast('Esta historia clínica ya no está en la tablet', 'error'); renderLista(); return; }
    var c = e.copia, d = c.datos;
    hc = {
      modo: 'novedad', nov_id: 'n' + U.nuevoClientId(), client_id: e.client_id, consecutivo: e.consecutivo,
      evento_id: e.evento_id, estado: 'borrador', servicio: c.servicio, inicio_atencion: c.inicio_atencion,
      datos: {
        paciente: d.paciente || {}, consentimiento: d.consentimiento || {}, responsables: d.responsables || {},
        signos_tomas: [], procedimientos: [], medicamentos: [],
        cierre: JSON.parse(JSON.stringify(d.cierre || {})), cierre_editado: false
      },
      firmas: {}
    };
    if(!hc.datos.cierre.traslado) hc.datos.cierre.traslado = {};
    if(!guardarHC()){
      hc = null;
      U.modal('No hay espacio en la tablet', 'No se pudo crear la novedad. Sincroniza tus pendientes e intenta de nuevo.', [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    abrirNovedad(hc.nov_id);
  }

  function abrirNovedad(novId){
    var l = leerNovedades(), i = buscarNov(l, novId);
    if(i < 0){ U.toast('No se encontró la novedad en esta tablet', 'error'); renderLista(); return; }
    hc = l[i];
    _m6 = null;
    U.mostrar('lt-hc-editor', true);
    U.mostrar('lt-hc-inicio', false);
    U.$('lt-hc-guardado').textContent = hc.actualizada_at ? 'Novedad guardada en la tablet · ' + U.horaCO(hc.actualizada_at) : '';
    U.$('lt-hc-guardado').className = 'lt-hc-guardado';
    mostrarErrores([]);
    renderModulo();
    window.scrollTo(0, 0);
  }

  function renderNovedad(){
    U.$('lt-hc-modulo').innerHTML = moduloNovedad();
    U.$('lt-hc-titulo').innerHTML = '<span class="lt-hc-paciente">Novedad · ' + U.escHtml(nombrePaciente(hc)) + '</span>' +
      '<span class="lt-hc-sub">' + U.escHtml(hc.consecutivo) + ' · Inicio ' + U.horaCO(hc.inicio_atencion) + '</span>';
    U.$('lt-hc-pasos').innerHTML = '';
    U.$('lt-hc-anterior').style.display = 'none';
    U.$('lt-hc-siguiente').style.display = 'none';
  }

  function moduloNovedad(){
    if(!_m6) _m6 = m6Nuevo();
    var base = copiaDe(hc.client_id) || {}, rech = rechazo(), html = '', i;
    html += seccion('Novedad de la historia clínica',
      '<div class="lt-muted">Registra lo que pasó después de enviar la historia clínica. La novedad queda con tu nombre y la hora, y se agrega a la historia clínica.</div>' +
      dato('Consecutivo', '<strong>' + U.escHtml(hc.consecutivo) + '</strong>') + dato('Paciente', U.escHtml(nombrePaciente(hc))));
    if(!rech){
      html += seccionTomas(1 + (base.signos_tomas || []).length);
      var procBase = base.procedimientos || [], cuerpoP = '';
      if(procBase.length){
        cuerpoP += '<div class="lt-muted">Ya registrados:</div><ul class="lt-lista-previa">';
        for(i = 0; i < procBase.length; i++) cuerpoP += '<li>' + U.escHtml(procBase[i].hora || '') + ' · ' + U.escHtml(mayus(procBase[i].descripcion || '')) + '</li>';
        cuerpoP += '</ul><div class="lt-muted">Nuevos en esta novedad:</div>';
      }
      cuerpoP += '<div class="lt-muted">Responsable: <strong>' + U.escHtml(responsableTexto()) + '</strong>.</div>' +
        seccionProcedimientos('Aún no has agregado procedimientos en esta novedad.');
      html += seccion('Procedimientos', cuerpoP);
      var medBase = base.medicamentos || [], cuerpoM = '';
      if(medBase.length){
        cuerpoM += '<div class="lt-muted">Ya registrados:</div><ul class="lt-lista-previa">';
        for(i = 0; i < medBase.length; i++) cuerpoM += '<li>' + medBase[i].cantidad + ' ' + U.escHtml(medBase[i].unidad || '') + ' · ' + U.escHtml(medBase[i].nombre) + '</li>';
        cuerpoM += '</ul><div class="lt-muted">Nuevos en esta novedad:</div>';
      }
      cuerpoM += listaMedsHtml('Aún no has agregado medicamentos ni insumos en esta novedad.');
      html += seccion('Medicamentos e insumos', cuerpoM) + '<div class="lt-campo" data-envoltura="m6">' + formularioM6() + '</div>';
    }
    var c = hc.datos.cierre;
    html += seccion('Evolución y descripción del servicio',
      interruptor('cierre_editado', '¿Actualizar la evolución, el destino o el traslado?') +
      (hc.datos.cierre_editado ? '' : '<div class="lt-muted">Se conserva lo registrado' + (c.destino ? ' (destino: ' + U.escHtml(textoDe(DESTINOS, c.destino) || c.destino) + ')' : '') + '.</div>'));
    if(hc.datos.cierre_editado) html += htmlCierre();
    html += '<div class="lt-hc-acciones-nov">' +
      '<button type="button" class="lt-btn" data-hc="nov-guardar">' + (hc.estado === 'por_enviar' ? 'Volver a guardar novedad' : 'Guardar novedad') + '</button>' +
      '<button type="button" class="lt-btn-sec peligro" data-hc="nov-descartar">Descartar novedad</button></div>';
    return html;
  }

  function validarNovedad(){
    var e = [], d = hc.datos, i;
    function err(campo, msg){ e.push({ campo: campo, msg: msg }); }
    var previas = 1 + ((copiaDe(hc.client_id) || {}).signos_tomas || []).length;
    for(i = 0; i < d.signos_tomas.length; i++) validarSignos('signos_tomas.' + i, 'Toma ' + (previas + i + 1) + ': ', err);
    if(d.proc_form) err('proc_form', 'Tienes un procedimiento sin guardar: toca "Guardar procedimiento" o "Cancelar"');
    for(i = 0; i < d.procedimientos.length; i++){
      var p = d.procedimientos[i], b = 'procedimientos.' + i;
      if(!RE_HORA.test(p.hora || '')) err(b + '.hora', 'Procedimiento ' + (i + 1) + ': escribe la hora (HH:MM)');
      if(txt(p.descripcion).length < 3) err(b + '.descripcion', 'Procedimiento ' + (i + 1) + ': describe el procedimiento realizado');
    }
    var m6 = validar(6);
    for(i = 0; i < m6.length; i++) e.push(m6[i]);
    if(d.cierre_editado) validarCierre(err);
    if(!e.length && !d.signos_tomas.length && !d.procedimientos.length && !d.medicamentos.length && !d.cierre_editado){
      err('', 'La novedad está vacía: agrega signos vitales, procedimientos, medicamentos o actualiza la evolución');
    }
    return e;
  }

  function pedirGuardarNovedad(){
    var errores = validarNovedad();
    if(errores.length){ mostrarErrores(errores); return; }
    mostrarErrores([]);
    var pendientes = 0, meds = hc.datos.medicamentos;
    for(var k = 0; k < meds.length; k++) if(U.consumoEnCola(meds[k].client_id)) pendientes++;
    U.modal('Guardar novedad',
      '¿Guardar la novedad de <strong>' + U.escHtml(hc.consecutivo) + '</strong> (' + U.escHtml(nombrePaciente(hc)) + ')?<br><br>Queda con tu nombre y la hora, y se agrega a la historia clínica.' +
      (st.offline ? '<br><br>Estás <strong>sin conexión</strong>: se enviará con el botón Sincronizar.'
        : (pendientes ? '<br><br>Tiene consumos guardados en la tablet: se sincronizan primero.' : '')),
      [{ texto: 'Cancelar' }, { texto: st.offline ? 'Guardar para enviar' : 'Guardar', clase: 'primario', accion: function(){
        hc.estado = 'por_enviar';
        hc.creada_at = new Date().toISOString();
        delete hc.error_envio;
        guardarHC();
        U.renderModo();
        if(st.offline){ U.toast('Novedad pendiente de envío: se enviará al sincronizar', 'ok'); cerrarEditor(); return; }
        if(pendientes){ cerrarEditor(); U.sincronizar(); return; }
        enviarNovedadAhora();
      } }]);
  }

  function cuerpoNovedad(n){
    var d = n.datos, procs = [], meds = [], i, cierre = null;
    for(i = 0; i < d.procedimientos.length; i++) procs.push({ hora: d.procedimientos[i].hora, descripcion: d.procedimientos[i].descripcion });
    for(i = 0; i < d.medicamentos.length; i++){
      var m = d.medicamentos[i];
      meds.push({ client_id: m.client_id, nombre: m.nombre, dosis: m.dosis, via: m.via, via_otra: m.via_otra, hora: m.hora });
    }
    if(d.cierre_editado){
      cierre = JSON.parse(JSON.stringify(d.cierre));
      if((d.consentimiento || {}).decision === 'rechaza') cierre.destino = '';
      if(cierre.destino !== 'TRASLADO') delete cierre.traslado;
    }
    return { client_id: n.nov_id, hc_client_id: n.client_id, creada_at: n.creada_at || new Date().toISOString(),
             signos_tomas: d.signos_tomas, procedimientos: procs, medicamentos: meds, cierre: cierre };
  }

  // La copia de la HC queda al día con la novedad aceptada
  function aplicarNovedadACopia(n){
    var env = leerEnviadas();
    for(var i = 0; i < env.length; i++){
      if(env[i].client_id !== n.client_id || !env[i].copia) continue;
      var c = env[i].copia.datos;
      c.signos_tomas = (c.signos_tomas || []).concat(n.datos.signos_tomas);
      c.procedimientos = (c.procedimientos || []).concat(n.datos.procedimientos);
      c.medicamentos = (c.medicamentos || []).concat(n.datos.medicamentos);
      if(n.datos.cierre_editado) c.cierre = n.datos.cierre;
    }
    guardarEnviadas(env);
  }

  // Envía una novedad. cb({ ok } | { sinRed } | { sesion } | { error })
  function enviarNovedad(n, cb){
    U.api('POST', '/api/hc/novedad', cuerpoNovedad(n), function(err){
      var lista = leerNovedades(), i = buscarNov(lista, n.nov_id);
      if(!err){
        if(i >= 0){ lista.splice(i, 1); guardarNovedades(lista); }
        aplicarNovedadACopia(n);
        cb({ ok: true });
        return;
      }
      if(err.sinRed){ cb({ sinRed: true }); return; }
      if(U.sesionVencida(err)){ cb({ sesion: true }); return; }
      if(err.status === 409){ cb({ sinRed: true }); return; }   // se reintenta al sincronizar
      if(i >= 0){
        lista[i].estado = 'borrador';
        lista[i].error_envio = err.message;
        guardarNovedades(lista);
        if(hc && hc.nov_id === n.nov_id){ hc.estado = 'borrador'; hc.error_envio = err.message; }
      }
      cb({ error: err.message });
    });
  }

  function enviarNovedadAhora(){
    var n = hc;
    var btns = document.querySelectorAll('[data-hc="nov-guardar"]');
    for(var i = 0; i < btns.length; i++){ btns[i].disabled = true; btns[i].textContent = 'Enviando…'; }
    enviarNovedad(n, function(res){
      if(res.ok){
        if(hc && hc.nov_id === n.nov_id) hc = null;
        U.mostrar('lt-hc-editor', false);
        U.mostrar('lt-hc-inicio', true);
        renderLista();
        U.renderModo();
        window.scrollTo(0, 0);
        U.modal('Novedad registrada', 'Se agregó a la historia clínica <strong class="lt-consecutivo">' + U.escHtml(n.consecutivo) + '</strong>.', [{ texto: 'Aceptar', clase: 'primario' }]);
        return;
      }
      if(hc && hc.nov_id === n.nov_id) renderModulo();
      if(res.sinRed) U.toast('Sin conexión: la novedad quedó pendiente y se enviará al sincronizar', 'error');
      else if(res.sesion) U.modal('Tu sesión venció', 'La novedad quedó guardada en la tablet como pendiente de envío. Sal, vuelve a ingresar y pulsa Sincronizar.', [{ texto: 'Entendido', clase: 'primario' }]);
      else U.modal('No se pudo guardar la novedad', U.escHtml(res.error) + '<br><br>Corrige el dato y vuelve a guardar.', [{ texto: 'Entendido', clase: 'primario' }]);
    });
  }

  function sincronizarNovedades(r, fin){
    var lista = leerNovedades(), pend = [];
    for(var i = 0; i < lista.length; i++) if(lista[i].estado === 'por_enviar') pend.push(lista[i]);
    function sig(n){
      if(n >= pend.length || r.sinRed || r.sesion){ fin(); return; }
      enviarNovedad(pend[n], function(res){
        if(res.ok) r.novedades++;
        else if(res.sinRed) r.sinRed = true;
        else if(res.sesion) r.sesion = true;
        else r.errores_nov++;
        sig(n + 1);
      });
    }
    sig(0);
  }

  function pedirDescartarNovedad(){
    if(hc.datos.medicamentos.length){
      U.modal('Hay consumos registrados', 'Esta novedad tiene medicamentos o insumos registrados. Quítalos primero (el stock vuelve a la bodega) y después descártala.', [{ texto: 'Entendido', clase: 'primario' }]);
      return;
    }
    var novId = hc.nov_id;
    U.modal('Descartar novedad', '¿Descartar esta novedad? No se agregará nada a la historia clínica.',
      [{ texto: 'Cancelar' }, { texto: 'Descartar', clase: 'peligro', accion: function(){
        var l = leerNovedades(), i = buscarNov(l, novId);
        if(i >= 0){ l.splice(i, 1); guardarNovedades(l); }
        hc = null;
        U.mostrar('lt-hc-editor', false);
        U.mostrar('lt-hc-inicio', true);
        renderLista();
        U.renderModo();
        U.toast('Novedad descartada');
      } }]);
  }

  // ══════════════════════════════════════════
  // MODO ADMINISTRADOR (hc-editor.html)
  // ══════════════════════════════════════════
  // HC del servidor (GET /api/hc/:id/editor) → forma del editor
  function desdeServidor(h){
    var d = JSON.parse(JSON.stringify(h.datos || {}));
    var s = d.servicio || {}, r = d.responsables || {}, p = d.paciente || {}, i, k;
    p.nn = false;
    if(p.eps === NO_APLICA) p.eps = '';
    if(p.arl === NO_APLICA) p.arl = '';
    d.paciente = p;
    var an = d.antecedentes || {};
    an.gestacion_si = an.gestacion === 'si';
    if(an.semanas !== null && an.semanas !== undefined) an.semanas = String(an.semanas);
    d.antecedentes = an;
    var ex = d.examen || {};
    for(k in ex) if(ex.hasOwnProperty(k) && ex[k] === ESTADO_ADECUADO) ex[k] = '';
    if(d.valoracion && d.valoracion.via_aerea === 'PERMEABLE') d.valoracion.via_aerea = 'ADECUADA';
    d.responsables = { medico_id: r.medico ? String(r.medico.id) : '' };
    var procs = [];
    for(i = 0; i < (d.procedimientos || []).length; i++) procs.push({ hora: d.procedimientos[i].hora, descripcion: d.procedimientos[i].descripcion });
    d.procedimientos = procs;
    // Medicamentos: lo registrado en el inventario + la dosis, vía y hora guardadas
    var guardados = {}, meds = [];
    for(i = 0; i < (d.medicamentos || []).length; i++) guardados[d.medicamentos[i].consumo_id] = d.medicamentos[i];
    for(i = 0; i < (h.consumos || []).length; i++){
      var c = h.consumos[i], g = guardados[c.client_id] || {}, esMed = esMedicamento(c);
      meds.push({ client_id: c.client_id, sub_sku_id: c.sub_sku_id, nombre: c.nombre, lote: c.lote || '', unidad: c.unidad || '',
                  familia: c.familia || '', es_medicamento: esMed, bodega_id: c.bodega_id, bodega_nombre: c.bodega || '',
                  cantidad: Number(c.cantidad), dosis: g.dosis || '', via: g.via || '', via_otra: g.via_otra || '', hora: g.hora || '' });
    }
    d.medicamentos = meds;
    if(!d.cierre) d.cierre = {};
    if(d.cierre.destino === 'RECHAZO_ATENCION') d.cierre.destino = '';
    if(!d.cierre.traslado) d.cierre.traslado = {};
    if(!d.signos_tomas) d.signos_tomas = [];
    return {
      modo: 'admin', servidor_id: h.id, client_id: h.client_id, consecutivo: h.consecutivo, estado: h.estado,
      evento_id: h.evento_id,
      servicio: { evento: s.evento ? s.evento.nombre : '', lugar: s.lugar || '', municipio: s.municipio || '', departamento: s.departamento || '',
                  medicos: r.medico ? [{ id: r.medico.id, nombre: r.medico.nombre, cedula: r.medico.cedula }] : [] },
      diligencia: d.enfermero || r.enfermero || { nombre: '—', cedula: '' },
      inicio_atencion: h.inicio_atencion, paso: 1, max_paso: 7, datos: d, firmas: h.firmas || {},
      bodegas: h.bodegas || [], motivo: '', sucio: false
    };
  }

  function abrirAdmin(h){
    hc = desdeServidor(h);
    completarEstructura(hc);
    _examenAbiertos = {};
    _m6 = null;
    U.mostrar('lt-hc-editor', true);
    U.$('lt-hc-guardado').textContent = '';
    mostrarErrores([]);
    renderModulo();
    window.scrollTo(0, 0);
  }

  function pedirGuardarAdmin(){
    for(var n = 2; n <= 7; n++){
      if(moduloOmitido(n)) continue;
      var e = validar(n);
      if(e.length){ irA(n); mostrarErrores(e); return; }
    }
    if(txt(hc.motivo).length < 5){
      mostrarErrores([{ campo: 'motivo', msg: 'Escribe el motivo de la corrección (queda en el historial de cambios)' }]);
      return;
    }
    mostrarErrores([]);
    var h = hc;
    var btns = document.querySelectorAll('[data-hc="admin-guardar"]');
    for(var i = 0; i < btns.length; i++){ btns[i].disabled = true; btns[i].textContent = 'Guardando…'; }
    U.guardarAdmin(h.servidor_id, cuerpoEnvio(h).datos, txt(h.motivo), function(err, data){
      for(var j = 0; j < btns.length; j++){ btns[j].disabled = false; btns[j].textContent = 'Guardar cambios'; }
      if(err){
        U.modal('No se pudo guardar', U.escHtml(err.message), [{ texto: 'Entendido', clase: 'primario' }]);
        return;
      }
      h.sucio = false;
      U.modal('Cambios guardados',
        'La historia clínica <strong>' + U.escHtml(h.consecutivo) + '</strong> quedó actualizada (' + data.cambios + ' cambio' + (data.cambios !== 1 ? 's' : '') + '). Quedó en el historial con el motivo.',
        [{ texto: 'Aceptar', clase: 'primario', accion: function(){ if(U.alGuardarAdmin) U.alGuardarAdmin(h.servidor_id); } }]);
    });
  }

  function salirAdmin(){
    function salir(){
      hc = null;
      U.mostrar('lt-hc-editor', false);
      if(U.alCerrarAdmin) U.alCerrarAdmin();
    }
    if(hc && hc.sucio){
      U.modal('Salir sin guardar', 'Tienes cambios sin guardar en <strong>' + U.escHtml(hc.consecutivo) + '</strong>. ¿Salir y descartarlos?',
        [{ texto: 'Seguir editando' }, { texto: 'Salir sin guardar', clase: 'peligro', accion: salir }]);
      return;
    }
    salir();
  }

  function pedirDescartar(clientId){
    var lista = leerTodas();
    var i = buscarHC(lista, clientId);
    if(i < 0) return;
    U.modal('Descartar historia clínica',
      '¿Descartar la historia clínica de <strong>' + U.escHtml(nombrePaciente(lista[i])) + '</strong>? Se borrará de la tablet y no se podrá recuperar.',
      [{ texto: 'Cancelar' }, { texto: 'Descartar', clase: 'peligro', accion: function(){
        var l = leerTodas(), j = buscarHC(l, clientId);
        if(j >= 0){ l.splice(j, 1); guardarTodas(l); }
        renderLista();
        U.renderModo();
        U.toast('Historia clínica descartada');
      } }]);
  }

  // ══════════════════════════════════════════
  // EVENTOS DE LA INTERFAZ
  // ══════════════════════════════════════════
  function accion(b){
    var a = b.getAttribute('data-hc');
    if(a === 'nueva') crear();
    else if(a === 'abrir') abrir(b.getAttribute('data-id'));
    else if(a === 'descartar') pedirDescartar(b.getAttribute('data-id'));
    else if(a === 'volver'){ if(hc && hc.modo === 'admin') salirAdmin(); else cerrarEditor(); }
    else if(a === 'siguiente') siguiente();
    else if(a === 'anterior') anterior();
    else if(a === 'paso') irA(parseInt(b.getAttribute('data-paso'), 10));
    else if(a === 'firmar') abrirFirma(b.getAttribute('data-firma-campo'));
    else if(a === 'enviar') pedirEnvio();
    else if(a === 'examen-abrir'){
      _examenAbiertos[b.getAttribute('data-seg')] = true;
      var y = window.pageYOffset || 0;
      renderModulo();
      window.scrollTo(0, y);
      var t = document.querySelector('[data-campo="examen.' + b.getAttribute('data-seg') + '"]');
      if(t) t.focus();
    }
    else if(a === 'proc-agregar') agregarProcedimiento();
    else if(a === 'proc-editar') editarProcedimiento(parseInt(b.getAttribute('data-i'), 10));
    else if(a === 'proc-guardar') guardarProcedimiento();
    else if(a === 'proc-cancelar') cancelarProcedimiento();
    else if(a === 'm6-bodega'){ _m6.bodegaId = parseInt(b.getAttribute('data-id'), 10); _m6.idx = null; _m6.q = ''; _m6.form = {}; _m6.error = ''; redibujarM6(); }
    else if(a === 'm6-item'){
      _m6.idx = parseInt(b.getAttribute('data-idx'), 10);
      var it = st.stock[_m6.idx];
      _m6.form = { hora: horaActual() };
      // Dosis sugerida por el nombre (editable); se recalcula con la cantidad
      // mientras el enfermero no la cambie a mano
      _m6.conc = it && esMedicamento(it) ? concentracion(it.nombre) : null;
      _m6.dosisAuto = !!_m6.conc;
      if(_m6.conc) _m6.form.dosis = dosisSugerida(_m6.conc, 1);
      _m6.error = '';
      redibujarM6();
      var c = document.querySelector('[data-m6="cantidad"]');
      if(c && it) c.focus();
    }
    else if(a === 'm6-cambiar'){ _m6.idx = null; _m6.form = {}; _m6.error = ''; redibujarM6(); }
    else if(a === 'm6-via'){ _m6.form.via = b.getAttribute('data-v'); redibujarM6(); }
    else if(a === 'm6-registrar') registrarM6();
    else if(a === 'm6-otro'){ _m6.ultimo = null; redibujarM6(); var bus = U.$('lt-m6-buscar'); if(bus) bus.focus(); }
    else if(a === 'm6-quitar') pedirQuitarM6(b.getAttribute('data-id'));
    else if(a === 'proc-quitar') quitarProcedimiento(parseInt(b.getAttribute('data-i'), 10));
    else if(a === 'toma-agregar') agregarToma();
    else if(a === 'toma-quitar') quitarToma(parseInt(b.getAttribute('data-i'), 10));
    else if(a === 'nov-nueva') nuevaNovedad(b.getAttribute('data-id'));
    else if(a === 'nov-abrir') abrirNovedad(b.getAttribute('data-id'));
    else if(a === 'nov-guardar') pedirGuardarNovedad();
    else if(a === 'nov-descartar') pedirDescartarNovedad();
    else if(a === 'admin-guardar') pedirGuardarAdmin();
  }

  function conectarEventos(){
    var editor = U.$('lt-hc-editor');
    U.on(U.$('lt-tab-hc'), 'click', function(e){
      var b = U.closestData(e.target, 'data-hc');
      if(b && !b.disabled && !U.closestData(e.target, 'data-chip')) accion(b);
    });
    U.on(editor, 'click', function(e){
      var mc = U.closestData(e.target, 'data-multi');
      if(mc){ alMarcar(mc.getAttribute('data-multi'), mc.getAttribute('data-valor')); return; }
      var c = U.closestData(e.target, 'data-chip');
      if(c){ alElegir(c.getAttribute('data-chip'), c.getAttribute('data-valor')); return; }
      var s = U.closestData(e.target, 'data-bool');
      if(s){ alInterruptor(s.getAttribute('data-bool'), s.getAttribute('data-valor')); return; }
    });
    U.on(editor, 'input', function(e){
      if(e.target.getAttribute && e.target.getAttribute('data-admin-motivo')){ if(hc) hc.motivo = e.target.value; return; }
      if(e.target.getAttribute && e.target.getAttribute('data-m6')) alEscribirM6(e.target); else alEscribir(e.target);
    });
    U.on(editor, 'change', function(e){
      if(e.target.getAttribute && e.target.getAttribute('data-admin-motivo')) return;
      if(e.target.getAttribute && e.target.getAttribute('data-m6')){ alEscribirM6(e.target); return; }
      alEscribir(e.target);
      if(e.target.getAttribute('data-campo') === 'paciente.documento') consultarPaciente();
    });

    var c = U.$('lt-firma-canvas');
    U.on(c, 'touchstart', firmaInicio);
    U.on(c, 'touchmove', firmaMover);
    U.on(c, 'touchend', firmaFin);
    U.on(c, 'mousedown', firmaInicio);
    U.on(c, 'mousemove', firmaMover);
    U.on(window, 'mouseup', firmaFin);
    U.on(U.$('lt-firma'), 'click', function(e){
      var b = U.closestData(e.target, 'data-firma');
      if(!b) return;
      var a = b.getAttribute('data-firma');
      if(a === 'borrar') limpiarFirma();
      else if(a === 'cancelar') cerrarFirma();
      else if(a === 'guardar') guardarFirma();
    });
  }

  // ══════════════════════════════════════════
  // API PÚBLICA (la usa enfermero-lite.js)
  // ══════════════════════════════════════════
  return {
    // utilidades: { $, on, mostrar, escHtml, api, sesionVencida, modal, toast,
    //   leerJSON, guardarJSON, claveUsuario, nuevoClientId, fechaCO, horaCO,
    //   fmtFecha, closestData, renderModo, estado }
    conectar: function(utilidades){
      U = utilidades;
      st = utilidades.estado;
      conectarEventos();
    },
    // Editor del administrador: ¿hay cambios sin guardar?
    adminSucio: function(){ return !!(hc && hc.modo === 'admin' && hc.sucio); },
    // Al entrar al panel o cambiar de evento
    mostrarInicio: function(){
      if(hc){ return; }   // con una HC abierta se queda en el editor
      U.mostrar('lt-hc-editor', false);
      U.mostrar('lt-hc-inicio', true);
      renderLista();
    },
    // ¿Hay una HC abierta en el editor? (no recargar la página en ese caso)
    editando: function(){ return !!hc; },
    contar: contar,
    // Historias clínicas con algo por subir: por enviar, o con consumos en la
    // cola de la tablet. consumosSueltos: consumos de la cola sin HC.
    porSincronizar: function(idUsuario, cola){
      var lista = leerTodas(idUsuario), novs = leerNovedades(idUsuario), ids = {}, n = 0, sueltos = 0, i;
      for(i = 0; i < lista.length; i++){
        if(lista[i].estado === 'por_enviar' && !ids[lista[i].client_id]){ ids[lista[i].client_id] = true; n++; }
      }
      for(i = 0; i < novs.length; i++){
        if(novs[i].estado === 'por_enviar' && !ids[novs[i].client_id]){ ids[novs[i].client_id] = true; n++; }
      }
      for(i = 0; i < (cola || []).length; i++){
        var h = cola[i].hc_client_id;
        if(!h) sueltos++;
        else if(!ids[h]){ ids[h] = true; n++; }
      }
      return { hc: n, consumosSueltos: sueltos };
    },
    sincronizar: sincronizar,
    // Editor del administrador (hc-editor.html)
    abrirAdmin: abrirAdmin,
    // Al cerrar sesión: cierra el editor sin perder nada
    salir: function(){
      if(hc && hc.modo !== 'admin'){ clearTimeout(_guardarTimer); guardarHC(); }
      hc = null;
      U.mostrar('lt-hc-editor', false);
      U.mostrar('lt-hc-inicio', true);
    }
  };
})();
