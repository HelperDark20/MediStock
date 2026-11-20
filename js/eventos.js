// ══════════════════════════════════════════
// EVENTOS
//
// Flujo:
//   1. La lista muestra los eventos con sus puntos de atención y personal.
//   2. "Crear evento" o click en la tarjeta → VISTA COMPLETA del evento (no
//      es ventana flotante): datos, médicos del evento y puntos de atención,
//      cada uno con su médico responsable (máximo uno; un médico puede cubrir
//      varios puntos) y sus enfermeros con sus depósitos.
//   3. Todo se arma en pantalla y se guarda de una vez ("Crear evento" o
//      "Guardar cambios"). El médico del punto es el responsable de las
//      historias clínicas de sus enfermeros; sin médico, el enfermero.
// ══════════════════════════════════════════

// ── RENDER GRID DE EVENTOS ──
function renderEventos(){
  const el = document.getElementById('eventos-grid');
  if(!el) return;

  if(!S.eventos || !S.eventos.length){
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="ti ti-calendar-event"></i>
      <p>Sin eventos registrados</p>
    </div>`;
    return;
  }

  el.innerHTML = S.eventos.map(e => {
    const personal = e.personal || [];
    const puntos = e.puntos || [];
    const deps = p => {
      const d = p.bodegas || [];
      return d.length ? d.slice(0, 2).map(b => `<span class="evt-dep-chip">${escHtml(b.nombre)}</span>`).join('') +
        (d.length > 2 ? `<span class="evt-dep-chip more">+${d.length - 2}</span>` : '') : '<span class="evt-dep-chip empty">sin depósitos</span>';
    };
    const fila = p => `<div class="evt-personal-row">
        <img class="evt-persona-foto" src="${avatarNivel(p.nivel || 2)}" alt="">
        <div class="evt-personal-body">
          <div class="evt-personal-name">${escHtml(p.nombre)}</div>
          <div class="evt-personal-deps">${deps(p)}</div>
        </div>
      </div>`;
    // Personal agrupado por punto de atención
    let personalHTML = puntos.map(pt => {
      const enfs = personal.filter(p => !p.es_medico && p.punto_id === pt.id);
      return `<div class="evt-punto-bloque">
        <div class="evt-punto-tit"><img src="img/iconos/ubicacion.svg" alt="">${escHtml(pt.nombre)}
          <span class="evt-punto-med ${pt.medico ? '' : 'sin'}">${pt.medico ? escHtml(pt.medico.nombre) : 'sin médico'}</span></div>
        ${enfs.map(fila).join('') || '<div class="evt-personal-row" style="color:#aaa;font-size:11.5px">Sin enfermeros</div>'}
      </div>`;
    }).join('');
    const sinPunto = personal.filter(p => !p.es_medico && !puntos.some(pt => pt.id === p.punto_id));
    if(sinPunto.length) personalHTML += `<div class="evt-punto-bloque"><div class="evt-punto-tit sin">${puntos.length ? 'Sin punto de atención' : 'Personal'}</div>${sinPunto.map(fila).join('')}</div>`;
    const medicos = personal.filter(p => p.es_medico);
    if(medicos.length) personalHTML = `<div class="evt-medicos-linea"><img src="${avatarNivel(1)}" alt="">${medicos.map(m => escHtml(m.nombre)).join(' · ')}</div>` + personalHTML;
    if(!personalHTML) personalHTML = '<div class="evt-personal-row" style="color:#aaa">Sin personal asignado</div>';

    const estadoBadge = {
      creado:     '<span class="evt-badge creado"><img src="img/iconos/estado-programado.svg" alt="">Programado</span>',
      en_curso:   '<span class="evt-badge en_curso"><img src="img/iconos/estado-en-curso.svg" alt="">En curso</span>',
      finalizado: '<span class="evt-badge finalizado"><img src="img/iconos/estado-finalizado.svg" alt="">Finalizado</span>'
    }[e.estado] || '';

    // Puntero de la ubicación del evento: el de sede o el de temporal
    const ubEvt = (S.ubicaciones||[]).find(u => u.id === e.ubicacion_id);
    const puntero = ubEvt && ubEvt.es_temporal ? 'temporales' : 'ubicacion';

    let accion = '';
    if(e.estado === 'creado' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px" onclick="event.stopPropagation();iniciarEvento(${e.id})"><img class="btn-ico" src="img/iconos/iniciar-evento.svg" alt="">Iniciar evento</button>`;
    } else if(e.estado === 'en_curso' && currentRole === 4){
      accion = `<button class="btn-submit" style="margin-top:12px;background:var(--red2)" onclick="event.stopPropagation();confirmFinalizarEvento(${e.id},${jsArg(e.nombre)})"><img class="btn-ico" src="img/iconos/finalizar-evento.svg" alt="">Finalizar evento</button>`;
    }

    return `<div class="card evt-card" style="margin-bottom:0;cursor:${currentRole === 4 ? 'pointer' : 'default'}" onclick="abrirDetalleEvento(${e.id})">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--ink)">${escHtml(e.nombre)}</div>
          ${estadoBadge}
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:10px">
          <img class="evt-mini-ico" src="img/iconos/${puntero}.svg" alt="">${escHtml(e.ubicacion_nombre||'—')}
        </div>
        <div style="margin-bottom:8px">${personalHTML}</div>
        <div style="font-size:11px;color:#aaa;font-family:var(--font-mono)">
          <img class="evt-mini-ico" src="img/iconos/mes.svg" alt="">
          ${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)}${e.hora_inicio ? ` · ${e.hora_inicio}–${e.hora_fin}` : ''}
        </div>
        ${accion}
      </div>
    </div>`;
  }).join('');
}

// ── HORA DEL EVENTO: se escribe en 12 o 24 horas y queda en 24 h ──
// 13 a 23 → p. m. sin preguntar · 00 → a. m. · 1 a 12 → pregunta a. m. o p. m.
// También acepta "6:00 pm", "6pm", "0600". El valor queda en data-valor (HH:MM).
const _pad2 = n => String(n).padStart(2, '0');
function _evtHora12(h, m){ return `${h % 12 || 12}:${_pad2(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`; }
function _evtHoraParse(txt){
  const t = String(txt || '').toLowerCase().replace(/[\s.]/g, '');
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if(!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if(h > 23 || mi > 59) return null;
  if(m[3] && (h < 1 || h > 12)) return null;
  return { h, mi, ampm: m[3] ? m[3][0] : '' };
}
function evtHoraFijar(id, h, mi, normalizar){
  const el = document.getElementById(id), v = `${_pad2(h)}:${_pad2(mi)}`;
  el.dataset.valor = v;
  if(normalizar) el.value = v;
  document.getElementById(id + '-ayuda').innerHTML = `<span class="evt-hora-ok">✓ ${_evtHora12(h, mi)} (${v})</span>`;
  if(id.indexOf('evp-') === 0) _evpMarcar();
}
function evtHoraEscribir(id, alSalir){
  const el = document.getElementById(id), ayuda = document.getElementById(id + '-ayuda');
  el.dataset.valor = '';
  if(id.indexOf('evp-') === 0) _evpMarcar();
  if(!el.value.trim()){ ayuda.innerHTML = ''; return; }
  const p = _evtHoraParse(el.value);
  if(!p){ ayuda.innerHTML = alSalir ? '<span class="evt-hora-error">Escribe la hora así: 18:00 o 6:00 pm</span>' : ''; return; }
  if(p.ampm) return evtHoraFijar(id, p.ampm === 'p' ? (p.h % 12) + 12 : p.h % 12, p.mi, alSalir);
  if(p.h >= 13 || p.h === 0) return evtHoraFijar(id, p.h, p.mi, alSalir);
  // 1 a 12: ¿mañana o tarde/noche?
  ayuda.innerHTML = `<span class="evt-hora-preg">¿${p.h}:${_pad2(p.mi)} de la mañana o de la tarde/noche?</span>
    <button type="button" class="evt-ampm" onmousedown="event.preventDefault()" onclick="evtHoraFijar('${id}', ${p.h % 12}, ${p.mi}, true)">a. m.</button>
    <button type="button" class="evt-ampm" onmousedown="event.preventDefault()" onclick="evtHoraFijar('${id}', ${(p.h % 12) + 12}, ${p.mi}, true)">p. m.</button>`;
}
function evtHoraCargar(id, v){
  const el = document.getElementById(id);
  el.value = v || ''; el.dataset.valor = '';
  document.getElementById(id + '-ayuda').innerHTML = '';
  if(/^\d\d:\d\d$/.test(v || '')){
    el.dataset.valor = v; el.value = v;
    const h = +v.slice(0, 2), mi = +v.slice(3);
    document.getElementById(id + '-ayuda').innerHTML = `<span class="evt-hora-ok">✓ ${_evtHora12(h, mi)} (${v})</span>`;
  }
}
function _evtHorasDe(p){
  const hi = document.getElementById(p + '-hora-inicio').dataset.valor, hf = document.getElementById(p + '-hora-fin').dataset.valor;
  if(!hi || !hf) return { error: 'Indica la hora de inicio y la hora final del evento (si es de 1 a 12, elige a. m. o p. m.)' };
  if(hi === hf) return { error: 'La hora final debe ser distinta a la de inicio' };
  return { hora_inicio: hi, hora_fin: hf };
}

// ══════════════════════════════════════════
// VISTA COMPLETA DEL EVENTO (crear / ver / editar)
// ══════════════════════════════════════════
// Borrador en memoria:
//   puntos:     [{ clave, id|null, nombre, medico_id|null }]
//   medicos:    [{ id, nombre, cedula }]
//   enfermeros: [{ id, nombre, cedula, punto: clave|null, bodegas: [ids] }]
let _evp = null;            // borrador
let _evpOriginal = '';      // firma del borrador al abrir/guardar (cambios sin guardar)
let _evpNuevaClave = 0;
let _evpDepsAbierto = null; // id del enfermero con sus depósitos desplegados
let _evpBuscarEn = null;    // clave del punto donde se busca un enfermero
let _evpMoverId = null;     // enfermero que se está cambiando de punto
let _evpRenombrar = null;   // clave del punto que se está renombrando
let _evpSugerencia = null;  // { evento, puntos } del último evento en la ubicación

const _evpSoloLectura = () => _evp && _evp.estado === 'finalizado';
const _evpEnCurso = () => _evp && _evp.estado === 'en_curso';

function abrirCrearEvento(){ _evpAbrir(null); }

async function abrirDetalleEvento(id){
  if(currentRole !== 4) return;
  try { _evpAbrir(await Eventos.getOne(id)); }
  catch(err){ toastError(err.message); }
}

function _evpAbrir(evento){
  const e = evento || {};
  const personal = e.personal || [];
  _evpNuevaClave = 0; _evpDepsAbierto = null; _evpBuscarEn = null; _evpMoverId = null; _evpRenombrar = null; _evpSugerencia = null;
  _evp = {
    id: e.id || null,
    estado: e.estado || 'creado',
    version: e.version || 0,
    nombreOriginal: e.nombre || '',
    ubicacionOriginal: e.ubicacion_id || null,
    medicosOriginales: personal.filter(p => p.es_medico).map(p => p.id),
    enfermerosOriginales: personal.filter(p => !p.es_medico).map(p => p.id),
    puntos: (e.puntos || []).map(p => ({ clave: 'p' + p.id, id: p.id, nombre: p.nombre, medico_id: p.medico ? p.medico.id : null })),
    medicos: personal.filter(p => p.es_medico).map(p => ({ id: p.id, nombre: p.nombre, cedula: p.cedula })),
    enfermeros: personal.filter(p => !p.es_medico).map(p => ({
      id: p.id, nombre: p.nombre, cedula: p.cedula,
      punto: p.punto_id && (e.puntos || []).some(x => x.id === p.punto_id) ? 'p' + p.punto_id : null,
      bodegas: (p.bodegas || []).map(b => b.id)
    }))
  };
  const ro = _evpSoloLectura() ? ' disabled' : '';
  const ubicaciones = (S.ubicaciones || []).filter(u => u.activo !== false || u.id === e.ubicacion_id);
  document.getElementById('evento-editor').innerHTML = `
    <div id="evp-head"></div>
    <div id="evp-resumen"></div>
    <div class="evp-grid">
      <div>
        <div class="card">
          <div class="card-header"><img class="card-ico" src="img/iconos/calendario.svg" alt=""><span class="card-title">Datos del evento</span></div>
          <div class="card-body"><div class="form-grid">
            <div class="form-group fg-full"><label>Nombre del evento</label>
              <input type="text" id="evp-nombre" maxlength="150" placeholder="Ej. Maratón CAT 2026" value="${escHtml(e.nombre || '')}" oninput="_evpMarcar()"${ro}></div>
            <div class="form-group"><label>Fecha de inicio</label>
              <input type="date" id="evp-fecha-inicio" value="${(e.fecha_inicio || '').split('T')[0]}" oninput="_evpMarcar()"${ro}></div>
            <div class="form-group"><label>Fecha de finalización</label>
              <input type="date" id="evp-fecha-fin" value="${(e.fecha_fin || '').split('T')[0]}" oninput="_evpMarcar()"${ro}></div>
            <div class="form-group"><label>Hora de inicio</label>
              <input type="text" id="evp-hora-inicio" class="evt-hora" placeholder="Ej. 18:00 o 6:00 pm" maxlength="9" autocomplete="off" oninput="evtHoraEscribir('evp-hora-inicio')" onblur="evtHoraEscribir('evp-hora-inicio', true)"${ro}>
              <div class="evt-hora-ayuda" id="evp-hora-inicio-ayuda"></div></div>
            <div class="form-group"><label>Hora final</label>
              <input type="text" id="evp-hora-fin" class="evt-hora" placeholder="Ej. 02:00 o 2:00 am" maxlength="9" autocomplete="off" oninput="evtHoraEscribir('evp-hora-fin')" onblur="evtHoraEscribir('evp-hora-fin', true)"${ro}>
              <div class="evt-hora-ayuda" id="evp-hora-fin-ayuda"></div></div>
            <div class="form-group fg-full"><span class="hint">Las horas aplican a todos los días del evento (si la final es menor, pasa la medianoche). Se usan en el reporte de atenciones: antes (PRE), durante (IN) o después (POST).</span></div>
            <div class="form-group fg-full"><label>Ubicación del evento</label>
              <select id="evp-ubicacion" onchange="evpUbicacionCambio()"${ro}>
                <option value="">Seleccionar ubicación…</option>
                ${ubicaciones.map(u => `<option value="${u.id}" ${u.id === e.ubicacion_id ? 'selected' : ''}>${escHtml(u.nombre)}</option>`).join('')}
              </select></div>
          </div></div>
        </div>
        <div class="card">
          <div class="card-header"><img class="card-ico" src="${avatarNivel(1)}" alt=""><span class="card-title">Médicos del evento</span></div>
          <div class="card-body" id="evp-medicos"></div>
        </div>
      </div>
      <div>
        <div class="evp-sec"><img src="img/iconos/ubicacion.svg" alt=""><span class="t">Puntos de atención</span><span class="s">· cada enfermero en un punto · máximo un médico por punto</span></div>
        <div id="evp-sugerencia"></div>
        <div id="evp-sinpunto"></div>
        <div class="evp-puntos" id="evp-puntos"></div>
      </div>
    </div>`;
  evtHoraCargar('evp-hora-inicio', e.hora_inicio); evtHoraCargar('evp-hora-fin', e.hora_fin);
  document.getElementById('eventos-lista').style.display = 'none';
  document.getElementById('evento-editor').style.display = '';
  document.getElementById('topbar-actions').innerHTML = '';
  _evpOriginal = _evpFirma();
  _evpRenderTodo();
  const cont = document.querySelector('.content'); if(cont) cont.scrollTop = 0;
  if(!_evp.puntos.length && e.ubicacion_id) _evpCargarSugerencia();
}

// Cierra la vista del evento y vuelve a la lista (sin preguntar)
function evpCerrar(){
  _evp = null;
  const ed = document.getElementById('evento-editor'), li = document.getElementById('eventos-lista');
  if(ed){ ed.style.display = 'none'; ed.innerHTML = ''; }
  if(li) li.style.display = '';
}

function evpVolver(){ goTo('eventos'); }

// goTo pregunta antes de salir de la vista con cambios sin guardar.
// Devuelve true si se puede seguir; si no, pregunta y luego llama a continuar.
let _evpSalirOk = false;
function evpPuedeSalir(continuar){
  if(_evpSalirOk || !_evpHayCambios()){ _evpSalirOk = false; return true; }
  _evpConfirmar('Descartar cambios', 'Tienes cambios sin guardar en este evento. ¿Salir sin guardarlos?', 'Salir sin guardar', () => { _evpSalirOk = true; continuar(); });
  return false;
}

// Modal de confirmación genérico
function _evpConfirmar(titulo, texto, _boton, alAceptar){
  document.getElementById('modal-title').textContent = titulo;
  document.getElementById('modal-sub').textContent = texto;
  document.getElementById('modal-ok-btn').onclick = async () => { closeModal('modal-confirm'); await alAceptar(); };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── Lectura de los datos y cambios sin guardar ──
function _evpDatos(){
  const v = id => document.getElementById(id) ? document.getElementById(id).value : '';
  return {
    nombre: v('evp-nombre').trim(),
    fecha_inicio: v('evp-fecha-inicio'),
    fecha_fin: v('evp-fecha-fin'),
    hora_inicio: (document.getElementById('evp-hora-inicio') || {}).dataset ? document.getElementById('evp-hora-inicio').dataset.valor || '' : '',
    hora_fin: (document.getElementById('evp-hora-fin') || {}).dataset ? document.getElementById('evp-hora-fin').dataset.valor || '' : '',
    ubicacion_id: parseInt(v('evp-ubicacion')) || 0
  };
}
function _evpFirma(){
  if(!_evp) return '';
  return JSON.stringify({ d: _evpDatos(), p: _evp.puntos, m: _evp.medicos.map(m => m.id),
    e: _evp.enfermeros.map(x => [x.id, x.punto, x.bodegas.slice().sort((a, b) => a - b)]) });
}
function _evpHayCambios(){ return !!_evp && !_evpSoloLectura() && _evpFirma() !== _evpOriginal; }

// Refresca encabezado y resumen (después de cualquier cambio)
function _evpMarcar(){
  if(!_evp) return;
  _evpRenderHead();
  _evpRenderResumen();
}

function _evpRenderTodo(){
  _evpRenderHead(); _evpRenderResumen(); _evpRenderMedicos(); _evpRenderPuntos(); _evpRenderSugerencia();
}

function _evpRenderHead(){
  const el = document.getElementById('evp-head'); if(!el) return;
  const nuevo = !_evp.id, cambios = _evpHayCambios();
  const badge = nuevo ? '' : ({
    creado: '<span class="evt-badge creado"><img src="img/iconos/estado-programado.svg" alt="">Programado</span>',
    en_curso: '<span class="evt-badge en_curso"><img src="img/iconos/estado-en-curso.svg" alt="">En curso</span>',
    finalizado: '<span class="evt-badge finalizado"><img src="img/iconos/estado-finalizado.svg" alt="">Finalizado</span>'
  }[_evp.estado] || '');
  const bloqueo = cambios ? ' disabled title="Guarda los cambios primero"' : '';
  let acciones = '';
  if(nuevo){
    acciones = `<button class="evp-btn" onclick="evpVolver()">Cancelar</button>
      <button class="evp-btn primario" id="evp-guardar" onclick="evpGuardar()"><img src="img/iconos/crear-evento.svg" alt="">Crear evento</button>`;
  } else if(_evp.estado === 'finalizado'){
    acciones = '<span class="evp-nota">Evento finalizado: solo lectura</span>';
  } else {
    acciones = (_evp.estado === 'creado' ? `<button class="evp-btn peligro" onclick="evpEliminar()"><img src="img/iconos/eliminar.svg" alt="">Eliminar</button>
        <button class="evp-btn" onclick="evpIniciar()"${bloqueo}><img src="img/iconos/iniciar-evento.svg" alt="">Iniciar evento</button>`
      : `<button class="evp-btn peligro" onclick="evpFinalizar()"${bloqueo}><img src="img/iconos/finalizar-evento.svg" alt="">Finalizar evento</button>`) +
      `<button class="evp-btn primario" id="evp-guardar" onclick="evpGuardar()"${cambios ? '' : ' disabled'}>${cambios ? 'Guardar cambios' : 'Sin cambios'}</button>`;
  }
  el.innerHTML = `<div class="evp-head">
    <button class="evp-volver" onclick="evpVolver()">‹ Eventos</button>
    <div class="evp-titulo">${escHtml(nuevo ? 'Nuevo evento' : (_evpDatos().nombre || _evp.nombreOriginal))}</div>${badge}
    <div class="evp-acciones">${acciones}</div></div>`;
}

function _evpRenderResumen(){
  const el = document.getElementById('evp-resumen'); if(!el) return;
  const sinMedico = _evp.puntos.filter(p => !p.medico_id).length;
  const sinPunto = _evp.enfermeros.filter(x => !x.punto).length;
  const sinDeps = _evp.enfermeros.filter(x => !x.bodegas.length).length;
  const pl = (n, s, p) => `<b>${n}</b> ${n === 1 ? s : p}`;
  el.innerHTML = `<div class="evp-resumen">
    <span class="evp-pill">${pl(_evp.puntos.length, 'punto de atención', 'puntos de atención')}</span>
    <span class="evp-pill">${pl(_evp.medicos.length, 'médico', 'médicos')}</span>
    <span class="evp-pill">${pl(_evp.enfermeros.length, 'enfermero', 'enfermeros')}</span>
    ${sinMedico ? `<span class="evp-pill alerta">${sinMedico} ${sinMedico === 1 ? 'punto sin médico' : 'puntos sin médico'}</span>` : ''}
    ${sinPunto ? `<span class="evp-pill alerta">${sinPunto} ${sinPunto === 1 ? 'enfermero sin punto' : 'enfermeros sin punto'}</span>` : ''}
    ${sinDeps ? `<span class="evp-pill alerta">${sinDeps} sin depósitos</span>` : ''}
    ${_evpHayCambios() ? '<span class="evp-pill cambios">Cambios sin guardar</span>' : ''}
  </div>`;
}

// ── MÉDICOS DEL EVENTO ──
function _evpRenderMedicos(){
  const el = document.getElementById('evp-medicos'); if(!el) return;
  const ro = _evpSoloLectura();
  const filas = _evp.medicos.map(m => {
    const puntos = _evp.puntos.filter(p => p.medico_id === m.id);
    // En un evento en curso, un médico que ya estaba no se quita del evento
    // (sus HC pueden seguir en las tablets sin señal); solo de sus puntos
    const fijo = _evpEnCurso() && _evp.medicosOriginales.includes(m.id);
    return `<div class="evp-med">
      <img class="av" src="${avatarNivel(1)}" alt="">
      <div style="flex:1;min-width:0"><div class="evp-med-nom">${escHtml(m.nombre)}</div>
        <div class="evp-med-sub">Cédula / RP ${escHtml(m.cedula || '')}</div>
        <div class="evp-med-puntos">${puntos.length ? puntos.map(p => `<span class="evp-tag">${escHtml(p.nombre)}</span>`).join('') : '<span class="evp-tag gris">Sin punto asignado</span>'}</div></div>
      ${ro ? '' : fijo ? '<span class="evp-fijo" title="El evento está en curso: no se puede quitar del evento, solo de sus puntos">en curso</span>'
        : `<button class="evp-x" title="Quitar del evento" onclick="evpQuitarMedico(${m.id})"><img src="img/iconos/eliminar.svg" alt=""></button>`}
    </div>`;
  }).join('');
  el.innerHTML = (filas || '<div class="evp-vacio-txt">Agrega los médicos que estarán en el evento; luego asigna cada uno a sus puntos de atención.</div>') +
    (ro ? '' : `<div class="ac-wrap evp-buscar-wrap" id="evp-med-wrap">
      <img class="evp-buscar-ico" src="img/iconos/buscar.svg" alt="">
      <input type="text" class="ac-input" id="evp-med-input" placeholder="Buscar médico por nombre o cédula para agregarlo…" autocomplete="off"
        oninput="evpBuscarMedico()" onfocus="evpBuscarMedico()">
      <div class="ac-dropdown" id="evp-med-drop"></div>
    </div>`);
}

function _evpEnEvento(){ return new Set(_evp.medicos.map(m => m.id).concat(_evp.enfermeros.map(x => x.id))); }

function _evpResultados(nivel, q){
  const ya = _evpEnEvento();
  q = (q || '').toLowerCase().trim();
  return (S.usuarios || []).filter(u => u.nivel === nivel && u.activo !== false && !ya.has(u.id) &&
    (!q || u.nombre.toLowerCase().includes(q) || String(u.cedula || '').includes(q))).slice(0, 8);
}

function evpBuscarMedico(){
  const drop = document.getElementById('evp-med-drop');
  const res = _evpResultados(1, document.getElementById('evp-med-input').value);
  drop.innerHTML = res.length ? res.map(u => `
    <div class="ac-item" onmousedown="evpAgregarMedico(${u.id})">
      <div class="ac-item-icon"><img src="${avatarNivel(1)}" alt="" style="width:22px;height:22px"></div>
      <div class="ac-item-body"><div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta"><span>Médico</span><span>Cédula / RP: ${escHtml(u.cedula || '')}</span></div></div>
    </div>`).join('') : '<div class="ac-no-results">Sin médicos disponibles</div>';
  drop.classList.add('open');
}

function evpAgregarMedico(id){
  const u = (S.usuarios || []).find(x => x.id === id); if(!u) return;
  _evp.medicos.push({ id: u.id, nombre: u.nombre, cedula: u.cedula });
  // Si hay puntos sin médico y es el único médico, queda a cargo de ellos
  if(_evp.medicos.length === 1) _evp.puntos.forEach(p => { if(!p.medico_id) p.medico_id = u.id; });
  _evpRenderMedicos(); _evpRenderPuntos(); _evpMarcar();
  const inp = document.getElementById('evp-med-input'); if(inp) inp.focus();
}

function evpQuitarMedico(id){
  _evp.medicos = _evp.medicos.filter(m => m.id !== id);
  _evp.puntos.forEach(p => { if(p.medico_id === id) p.medico_id = null; });
  _evpRenderMedicos(); _evpRenderPuntos(); _evpMarcar();
}

// ── PUNTOS DE ATENCIÓN ──
function _evpDepositosUbicacion(){
  const ub = _evpDatos().ubicacion_id;
  return (S.bodegasRaw || []).filter(b => b.ubicacion_id === ub && b.activo !== false);
}

function _evpRenderPuntos(){
  const el = document.getElementById('evp-puntos'); if(!el) return;
  const ro = _evpSoloLectura();
  const nombre = id => (_evp.enfermeros.find(x => x.id === id) || {}).nombre || '';
  const depsTodos = _evpDepositosUbicacion();
  const nomDep = id => { const b = (S.bodegasRaw || []).find(x => x.id === id); return b ? b.nombre : 'Depósito ' + id; };

  const enfermeroHTML = x => {
    const deps = x.bodegas.map(nomDep).sort();
    let h = `<div class="evp-enf">
      <img class="av" src="${avatarNivel(2)}" alt="">
      <div style="flex:1;min-width:0"><div class="evp-enf-nom">${escHtml(x.nombre)}</div>
        <div class="evp-enf-deps">${deps.length ? deps.map(n => `<span class="evt-dep-chip">${escHtml(n)}</span>`).join('') : '<span class="evt-dep-chip empty" style="color:var(--red2)">sin depósitos</span>'}</div></div>
      ${ro ? '' : `<div class="acc">
        <button title="Depósitos" class="${_evpDepsAbierto === x.id ? 'on' : ''}" onclick="evpToggleDeps(${x.id})"><img src="img/iconos/dep-botiquin.svg" alt=""></button>
        <button title="Cambiar de punto" class="${_evpMoverId === x.id ? 'on' : ''}" onclick="evpMover(${x.id})"><img src="img/iconos/mover.svg" alt=""></button>
        <button title="Quitar del evento" onclick="evpQuitarEnfermero(${x.id})"><img src="img/iconos/eliminar.svg" alt=""></button></div>`}
    </div>`;
    if(_evpMoverId === x.id){
      h += `<div class="evp-panel"><div class="evp-lbl">Mover a</div><div class="evp-chips">${_evp.puntos.filter(p => p.clave !== x.punto)
        .map(p => `<button class="evp-chip" onclick="evpAsignarPunto(${x.id}, ${jsArg(p.clave)})">${escHtml(p.nombre)}</button>`).join('') || '<span class="evp-vacio-txt">No hay otros puntos</span>'}</div></div>`;
    }
    if(_evpDepsAbierto === x.id){
      h += `<div class="evp-panel"><div class="evp-lbl">Depósitos de ${escHtml(x.nombre.split(' ')[0])}</div>` +
        (depsTodos.length ? depsTodos.map(b => {
          const otros = _evp.enfermeros.filter(o => o.id !== x.id && o.bodegas.includes(b.id)).map(o => o.nombre.split(' ')[0]);
          return `<label class="evp-dep"><input type="checkbox" ${x.bodegas.includes(b.id) ? 'checked' : ''} onchange="evpToggleDeposito(${x.id}, ${b.id}, this.checked)">
            <img src="${_bodIcono(b.nombre)}" alt="">${escHtml(b.nombre)}${otros.length ? `<span class="otro">lo usa ${escHtml(otros.join(', '))}</span>` : ''}</label>`;
        }).join('') : `<div class="evp-vacio-txt">${_evpDatos().ubicacion_id ? 'Esta ubicación no tiene depósitos registrados' : 'Elige primero la ubicación del evento'}</div>`) + '</div>';
    }
    return h;
  };

  const tarjetas = _evp.puntos.map(p => {
    const enfs = _evp.enfermeros.filter(x => x.punto === p.clave);
    const med = _evp.medicos.find(m => m.id === p.medico_id);
    const selMed = ro ? (med ? `<div class="evp-medsel"><img src="${avatarNivel(1)}" alt=""><span class="n">${escHtml(med.nombre)}</span></div>`
        : '<div class="evp-medsel vacio"><img src="img/iconos/advertencia.svg" alt=""><span class="n">Sin médico: responde el enfermero</span></div>')
      : `<div class="evp-medsel ${med ? '' : 'vacio'}"><img src="${med ? avatarNivel(1) : 'img/iconos/advertencia.svg'}" alt="">
          <select onchange="evpMedicoPunto(${jsArg(p.clave)}, this.value)">
            <option value="">Sin médico: responde el enfermero</option>
            ${_evp.medicos.map(m => `<option value="${m.id}" ${m.id === p.medico_id ? 'selected' : ''}>${escHtml(m.nombre)}</option>`).join('')}
          </select></div>` + (_evp.medicos.length ? '' : '<div class="evp-ayuda">Agrega médicos en "Médicos del evento" para asignarlos aquí.</div>');
    const titulo = _evpRenombrar === p.clave
      ? `<input type="text" class="evp-renombrar" id="evp-ren-${p.clave}" value="${escHtml(p.nombre)}" maxlength="80"
           onkeydown="if(event.key==='Enter'){evpRenombrarOk(${jsArg(p.clave)})}else if(event.key==='Escape'){evpRenombrarCancelar()}" onblur="evpRenombrarOk(${jsArg(p.clave)})">`
      : `<div class="evp-punto-nom">${escHtml(p.nombre)}</div>`;
    return `<div class="evp-punto">
      <div class="evp-punto-h"><img src="img/iconos/ubicacion.svg" alt="">
        <div style="flex:1;min-width:0">${titulo}<div class="evp-punto-cnt">${enfs.length} ${enfs.length === 1 ? 'enfermero' : 'enfermeros'}</div></div>
        ${ro ? '' : `<div class="evp-ed"><button title="Renombrar" onclick="evpRenombrar(${jsArg(p.clave)})"><img src="img/iconos/editar.svg" alt=""></button>
          <button title="Eliminar punto" onclick="evpEliminarPunto(${jsArg(p.clave)})"><img src="img/iconos/eliminar.svg" alt=""></button></div>`}
      </div>
      <div class="evp-punto-b">
        <div class="evp-lbl">Médico responsable</div>${selMed}
        <div class="evp-lbl" style="margin-top:12px">Enfermeros</div>
        ${enfs.map(enfermeroHTML).join('') || '<div class="evp-vacio-txt" style="padding:4px 0 2px">Aún sin enfermeros</div>'}
        ${ro ? '' : _evpBuscarEn === p.clave ? `<div class="ac-wrap evp-buscar-wrap" id="evp-enf-wrap">
            <img class="evp-buscar-ico" src="img/iconos/buscar.svg" alt="">
            <input type="text" class="ac-input" id="evp-enf-input" placeholder="Buscar enfermero por nombre o cédula…" autocomplete="off"
              oninput="evpBuscarEnfermero()" onfocus="evpBuscarEnfermero()">
            <div class="ac-dropdown" id="evp-enf-drop"></div></div>`
          : `<button class="evp-add" onclick="evpAbrirBuscarEnfermero(${jsArg(p.clave)})">+ Agregar enfermero a ${escHtml(p.nombre)}</button>`}
      </div></div>`;
  }).join('');

  const nuevo = ro ? '' : `<div class="evp-nuevo">
      <div class="evp-lbl" style="margin:0">Nuevo punto de atención</div>
      <input type="text" id="evp-nuevo-punto" maxlength="80" placeholder="Ej. CARPA 1, ENFERMERÍA NORTE, PUERTA 3" onkeydown="if(event.key==='Enter')evpCrearPunto()">
      <button class="evp-add" style="margin:0" onclick="evpCrearPunto()">+ Crear punto</button>
    </div>`;
  el.innerHTML = tarjetas + nuevo || '<div class="evp-vacio-txt">Este evento no tuvo puntos de atención.</div>';

  // Enfermeros sin punto (al quitar un punto, o de eventos anteriores)
  const sin = _evp.enfermeros.filter(x => !x.punto);
  const elSin = document.getElementById('evp-sinpunto');
  elSin.innerHTML = sin.map(x => `<div class="evp-sinpunto">
      <img src="${avatarNivel(2)}" alt="">
      <div style="flex:1"><b>${escHtml(x.nombre)}</b> está en el evento pero sin punto de atención: no podrá diligenciar historias clínicas.</div>
      ${ro ? '' : _evp.puntos.length ? `<select onchange="if(this.value)evpAsignarPunto(${x.id}, this.value)">
        <option value="">Asignar a un punto…</option>
        ${_evp.puntos.map(p => `<option value="${escHtml(p.clave)}">${escHtml(p.nombre)}</option>`).join('')}</select>
        <button class="evp-x" title="Quitar del evento" onclick="evpQuitarEnfermero(${x.id})"><img src="img/iconos/eliminar.svg" alt=""></button>`
        : '<span style="font-size:12px">Crea un punto de atención para asignarlo</span>'}
    </div>`).join('');
}

function evpCrearPunto(){
  const inp = document.getElementById('evp-nuevo-punto');
  const nombre = (inp.value || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if(nombre.length < 2){ toastError('Escribe el nombre del punto de atención'); inp.focus(); return; }
  if(_evp.puntos.some(p => p.nombre === nombre)){ toastError(`Ya existe el punto "${nombre}"`); inp.focus(); return; }
  _evpAgregarPunto(nombre);
  _evpRenderPuntos(); _evpRenderMedicos(); _evpRenderSugerencia(); _evpMarcar();
  const n = document.getElementById('evp-nuevo-punto'); if(n) n.focus();
}
function _evpAgregarPunto(nombre){
  // Con un solo médico en el evento, el punto nuevo queda a su cargo
  _evp.puntos.push({ clave: 'n' + (++_evpNuevaClave), id: null, nombre, medico_id: _evp.medicos.length === 1 ? _evp.medicos[0].id : null });
}

function evpRenombrar(clave){
  _evpRenombrar = clave; _evpRenderPuntos();
  const inp = document.getElementById('evp-ren-' + clave); if(inp){ inp.focus(); inp.select(); }
}
function evpRenombrarCancelar(){ _evpRenombrar = null; _evpRenderPuntos(); }
function evpRenombrarOk(clave){
  if(_evpRenombrar !== clave) return;
  const inp = document.getElementById('evp-ren-' + clave);
  const nombre = ((inp && inp.value) || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const p = _evp.puntos.find(x => x.clave === clave);
  _evpRenombrar = null;
  if(nombre.length < 2) toastError('El nombre del punto debe tener al menos 2 letras');
  else if(_evp.puntos.some(x => x.clave !== clave && x.nombre === nombre)) toastError(`Ya existe el punto "${nombre}"`);
  else if(p) p.nombre = nombre;
  _evpRenderPuntos(); _evpRenderMedicos(); _evpMarcar();
}

function evpEliminarPunto(clave){
  const p = _evp.puntos.find(x => x.clave === clave); if(!p) return;
  const enfs = _evp.enfermeros.filter(x => x.punto === clave);
  const quitar = () => {
    _evp.puntos = _evp.puntos.filter(x => x.clave !== clave);
    enfs.forEach(x => { x.punto = null; });
    _evpRenderPuntos(); _evpRenderMedicos(); _evpRenderSugerencia(); _evpMarcar();
  };
  if(!enfs.length) return quitar();
  _evpConfirmar('Eliminar punto de atención', `"${p.nombre}" tiene ${enfs.length} ${enfs.length === 1 ? 'enfermero' : 'enfermeros'}. Quedarán sin punto hasta que los asignes a otro.`, 'Eliminar punto', quitar);
}

function evpMedicoPunto(clave, valor){
  const p = _evp.puntos.find(x => x.clave === clave); if(!p) return;
  p.medico_id = parseInt(valor) || null;
  _evpRenderPuntos(); _evpRenderMedicos(); _evpMarcar();
}

// ── ENFERMEROS ──
function evpAbrirBuscarEnfermero(clave){
  _evpBuscarEn = clave; _evpRenderPuntos();
  const inp = document.getElementById('evp-enf-input'); if(inp) inp.focus();
}
function evpBuscarEnfermero(){
  const drop = document.getElementById('evp-enf-drop');
  const res = _evpResultados(2, document.getElementById('evp-enf-input').value);
  drop.innerHTML = res.length ? res.map(u => `
    <div class="ac-item" onmousedown="evpAgregarEnfermero(${u.id})">
      <div class="ac-item-icon"><img src="${avatarNivel(2)}" alt="" style="width:22px;height:22px"></div>
      <div class="ac-item-body"><div class="ac-item-name">${escHtml(u.nombre)}</div>
        <div class="ac-item-meta"><span>Enfermero/a</span><span>CC: ${escHtml(u.cedula || '')}</span></div></div>
    </div>`).join('') : '<div class="ac-no-results">Sin enfermeros disponibles</div>';
  drop.classList.add('open');
}
function evpAgregarEnfermero(id){
  const u = (S.usuarios || []).find(x => x.id === id); if(!u || !_evpBuscarEn) return;
  _evp.enfermeros.push({ id: u.id, nombre: u.nombre, cedula: u.cedula, punto: _evpBuscarEn, bodegas: [] });
  _evpBuscarEn = null;
  _evpDepsAbierto = u.id;   // a continuación, sus depósitos
  _evpRenderPuntos(); _evpMarcar();
}
function evpToggleDeps(id){
  _evpDepsAbierto = _evpDepsAbierto === id ? null : id; _evpMoverId = null; _evpRenderPuntos();
}
function evpToggleDeposito(id, bodegaId, marcado){
  const x = _evp.enfermeros.find(e => e.id === id); if(!x) return;
  x.bodegas = x.bodegas.filter(b => b !== bodegaId);
  if(marcado) x.bodegas.push(bodegaId);
  _evpRenderPuntos(); _evpMarcar();
}
function evpMover(id){ _evpMoverId = _evpMoverId === id ? null : id; _evpDepsAbierto = null; _evpRenderPuntos(); }
function evpAsignarPunto(id, clave){
  const x = _evp.enfermeros.find(e => e.id === id); if(!x) return;
  x.punto = clave; _evpMoverId = null;
  _evpRenderPuntos(); _evpMarcar();
}
function evpQuitarEnfermero(id){
  const x = _evp.enfermeros.find(e => e.id === id); if(!x) return;
  const quitar = () => {
    _evp.enfermeros = _evp.enfermeros.filter(e => e.id !== id);
    if(_evpDepsAbierto === id) _evpDepsAbierto = null;
    _evpRenderPuntos(); _evpMarcar();
  };
  // En un evento en curso se confirma también al guardar
  if(_evpEnCurso() && _evp.enfermerosOriginales.includes(id)){
    _evpConfirmar('Quitar enfermero', `¿Quitar a "${x.nombre}" de este evento en curso? Al guardar perderá el acceso a sus depósitos, y lo que tenga sin sincronizar en la tablet (historias clínicas, consumos) ya no se podrá enviar.`, 'Quitar', quitar);
    return;
  }
  quitar();
}

// ── UBICACIÓN: depósitos y sugerencia de puntos ──
function evpUbicacionCambio(){
  const ub = _evpDatos().ubicacion_id;
  const conDeps = _evp.enfermeros.filter(x => x.bodegas.length);
  if(conDeps.length){
    _evp.enfermeros.forEach(x => { x.bodegas = []; });
    toast('Cambiaste la ubicación: vuelve a asignar los depósitos de los enfermeros (los anteriores eran de la otra sede)');
  }
  _evpSugerencia = null;
  _evpRenderPuntos(); _evpRenderSugerencia(); _evpMarcar();
  if(ub && !_evp.puntos.length) _evpCargarSugerencia();
}
async function _evpCargarSugerencia(){
  const ub = _evpDatos().ubicacion_id; if(!ub || _evpSoloLectura()) return;
  try {
    const s = await Eventos.sugerenciaPuntos(ub, _evp.id);
    if(!_evp || _evpDatos().ubicacion_id !== ub) return;
    _evpSugerencia = s && s.puntos && s.puntos.length ? s : null;
    _evpRenderSugerencia();
  } catch(e){ /* la sugerencia es opcional */ }
}
function _evpRenderSugerencia(){
  const el = document.getElementById('evp-sugerencia'); if(!el) return;
  const s = _evpSugerencia;
  const faltan = s ? s.puntos.filter(n => !_evp.puntos.some(p => p.nombre === n)) : [];
  if(!s || !faltan.length || _evpSoloLectura()){ el.innerHTML = ''; return; }
  const ub = (S.ubicaciones || []).find(u => u.id === _evpDatos().ubicacion_id);
  el.innerHTML = `<div class="evp-sug"><img src="img/iconos/ubicacion.svg" alt="">
    <span>Puntos del último evento en <b>${escHtml(ub ? ub.nombre : '')}</b> (${escHtml(s.evento)}):</span>
    ${faltan.map(n => `<span class="ch">${escHtml(n)}</span>`).join('')}
    <button onclick="evpUsarSugerencia()">Usar estos puntos</button></div>`;
}
function evpUsarSugerencia(){
  if(!_evpSugerencia) return;
  _evpSugerencia.puntos.forEach(n => { if(!_evp.puntos.some(p => p.nombre === n)) _evpAgregarPunto(n); });
  _evpRenderPuntos(); _evpRenderMedicos(); _evpRenderSugerencia(); _evpMarcar();
}

document.addEventListener('click', e => {
  [['evp-med-wrap', 'evp-med-drop'], ['evp-enf-wrap', 'evp-enf-drop']].forEach(([w, d]) => {
    const wrap = document.getElementById(w);
    if(wrap && !wrap.contains(e.target)) document.getElementById(d)?.classList.remove('open');
  });
});
window.addEventListener('beforeunload', e => { if(_evpHayCambios()){ e.preventDefault(); e.returnValue = ''; } });

// ── GUARDAR (crear o actualizar todo) ──
function _evpPayload(){
  const d = _evpDatos();
  if(!d.nombre) return { error: 'Ingresa el nombre del evento' };
  if(!d.fecha_inicio || !d.fecha_fin) return { error: 'Ingresa las fechas del evento' };
  if(d.fecha_fin < d.fecha_inicio) return { error: 'La fecha de finalización no puede ser anterior a la de inicio' };
  const horas = _evtHorasDe('evp');
  if(horas.error) return horas;
  if(!d.ubicacion_id) return { error: 'Selecciona la ubicación del evento' };
  const sin = _evp.enfermeros.filter(x => !x.punto);
  if(sin.length) return { error: `Asigna un punto de atención a: ${sin.map(x => x.nombre).join(', ')}` };
  return {
    ...d, ...horas,
    puntos: _evp.puntos.map(p => ({ id: p.id, clave: p.clave, nombre: p.nombre, medico_id: p.medico_id })),
    medicos: _evp.medicos.map(m => m.id),
    enfermeros: _evp.enfermeros.map(x => ({ usuario_id: x.id, punto: x.punto, bodega_ids: x.bodegas }))
  };
}

async function evpGuardar(confirmarQuitar){
  if(!_evp || _evpSoloLectura()) return;
  const datos = _evpPayload();
  if(datos.error){ toastError(datos.error); return; }
  const btn = document.getElementById('evp-guardar'); if(btn) btn.disabled = true;
  try {
    let id = _evp.id, reiniciadas = false;
    if(!id){
      const nuevo = await Eventos.create(datos);
      id = nuevo.id;
    } else {
      const r = await Eventos.guardarEstructura(id, { ...datos, version: _evp.version, confirmar_quitar: !!confirmarQuitar });
      reiniciadas = r.bodegas_reiniciadas;
    }
    S.eventos = await Eventos.getAll();
    renderEventos(); buildNav();
    toast(_evp.id ? (reiniciadas ? '✓ Evento guardado — se reiniciaron los depósitos por el cambio de ubicación' : '✓ Evento guardado') : '✓ Evento creado', 'success');
    _evpAbrir(await Eventos.getOne(id));
  } catch(err){
    if(btn) btn.disabled = false;
    const d = err.data || {};
    if(d.requiere_confirmacion){
      _evpConfirmar('Quitar personal del evento en curso',
        `Vas a quitar a ${d.quitar.join(', ')} de un evento en curso. Perderán el acceso a sus depósitos y lo que tengan sin sincronizar en la tablet ya no se podrá enviar. ¿Guardar de todas formas?`,
        'Guardar y quitar', () => evpGuardar(true));
      return;
    }
    if(d.version_cambiada){
      _evpConfirmar('El evento cambió', err.message + ' Al recargar se pierden tus cambios sin guardar.', 'Recargar el evento', () => abrirDetalleEvento(_evp.id));
      return;
    }
    toastError(err.message);
  }
}

// ── ACCIONES DESDE LA VISTA ──
async function evpIniciar(){ if(_evp && !_evpHayCambios()) { await iniciarEvento(_evp.id); } }
function evpFinalizar(){ if(_evp && !_evpHayCambios()) confirmFinalizarEvento(_evp.id, _evp.nombreOriginal); }

// Es un borrado suave (activo = false): el evento desaparece de la lista
// pero el registro queda en la base de datos. Los movimientos no dependen
// de los eventos, así que reportes, stock y trazabilidad no cambian.
function evpEliminar(){
  if(!_evp || !_evp.id) return;
  const n = _evp.medicosOriginales.length + _evp.enfermerosOriginales.length;
  _evpConfirmar('Eliminar evento',
    `¿Eliminar el evento "${_evp.nombreOriginal}"?` + (n ? ` Se quitará la asignación de ${n} persona${n !== 1 ? 's' : ''} del personal.` : '') +
    ' Los consumos ya registrados y los reportes no se verán afectados.', 'Eliminar', async () => {
      try {
        await Eventos.delete(_evp.id);
        S.eventos = await Eventos.getAll();
        buildNav();
        toast('Evento eliminado');
        goTo('eventos');
      } catch(err){ toastError(err.message); }
    });
}

// ── INICIAR / FINALIZAR (desde la tarjeta o desde la vista) ──
async function iniciarEvento(id){
  try {
    await Eventos.iniciar(id);
    S.eventos = await Eventos.getAll();
    renderEventos();
    buildNav();
    toast('✓ Evento iniciado — los enfermeros asignados ya pueden operar','success');
    if(_evp && _evp.id === id) _evpAbrir(await Eventos.getOne(id));
  } catch(err){ toastError(err.message); }
}

function confirmFinalizarEvento(id, nombre){
  _evpConfirmar('Finalizar evento', `¿Finalizar el evento "${nombre}"? Los enfermeros asignados perderán acceso a sus depósitos de este evento de inmediato. En Asistencias, el personal cargado que no marcó ningún turno quedará como "No asistió".`, 'Finalizar', async () => {
    try {
      await Eventos.finalizar(id);
      S.eventos = await Eventos.getAll();
      renderEventos();
      buildNav();
      toast('Evento finalizado');
      if(_evp && _evp.id === id) _evpAbrir(await Eventos.getOne(id));
    } catch(err){ toastError(err.message); }
  });
}
