// ══════════════════════════════════════════
// ASISTENCIAS (Admin) — jornadas de entrada/salida marcadas en las tablets
// de /datacontrol. Filtros, resumen, salida manual (con motivo), fotos,
// exportación para nómina (Excel y PDF) y la cuenta de las tablets.
// ══════════════════════════════════════════
let _asisDatos = { jornadas: [], resumen: {} };
let _asisGrupos = [];   // personal cargado por evento (para las tarjetas y el Excel)
let _asisSalidaId = null;

const ASIS_ESTADOS = {
  abierta:    ['En turno', 'abierta'],
  cerrada:    ['Completa', 'ok'],
  // Más de 16 h sin salida, o su evento finalizó con el turno abierto
  sin_salida: ['Sin salida', 'sin'],
};
// Antes "Sin salida (+16 h)": también aplica cuando el evento finalizó con el turno abierto

function _asisFechaCO(iso){
  if(!iso) return '';
  const d = new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString();
  return `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)} ${d.slice(11,16)}`;
}
function _asisDur(min){
  if(min === null || min === undefined) return '—';
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
function _asisHoyCO(){ return new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); }

function _asisEstado(j){
  if(j.salida_manual) return ['Salida manual · ' + (j.salida_manual_por || 'admin'), 'man'];
  return ASIS_ESTADOS[j.estado] || [j.estado, ''];
}

// Filtro de eventos: todos los del panel (también los finalizados, para la nómina)
function _asisLlenarFiltros(){
  const ev = document.getElementById('asis-evento');
  const evActual = ev.value;
  ev.innerHTML = '<option value="">Todos los eventos</option>' + (S.eventos || []).map(e =>
    `<option value="${e.id}">${escHtml(e.nombre)} (${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)})</option>`).join('');
  if(evActual) ev.value = evActual;
  else {
    const enCurso = (S.eventos || []).find(e => e.estado === 'en_curso');
    if(enCurso) ev.value = enCurso.id;
  }
}

async function renderAsistencia(){
  _asisLlenarFiltros();
  await asisBuscar();
}

let _asisTimerQ = null;
function asisBuscarPronto(){ clearTimeout(_asisTimerQ); _asisTimerQ = setTimeout(asisBuscar, 350); }

function _asisFiltros(){
  return {
    evento_id: document.getElementById('asis-evento').value,
    q: document.getElementById('asis-q').value.trim(),
    desde: document.getElementById('asis-desde').value,
    hasta: document.getElementById('asis-hasta').value,
    estado: document.getElementById('asis-estado').value
  };
}

async function asisBuscar(){
  const tbody = document.getElementById('asis-tbody');
  tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:24px"><p>Cargando…</p></div></td></tr>';
  try {
    const f = _asisFiltros();
    const [datos, grupos] = await Promise.all([Asistencia.listar(f), Asistencia.personal(f.evento_id).catch(() => [])]);
    _asisDatos = datos;
    _asisGrupos = grupos;
    _asisRenderPersonal();
  } catch(e){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:24px"><p>${escHtml(e.message)}</p></div></td></tr>`;
    return;
  }
  _asisRender();
}

function _asisRender(){
  const { jornadas, resumen } = _asisDatos;
  const st = (ico, num, label, extra) => `<div class="rep-stat"><div class="rep-stat-icon ilustrado"><img src="img/${ico}" alt=""></div><div><div class="rep-stat-num${extra && extra.dur ? ' dur' : ''}">${num}</div><div class="rep-stat-label">${label}</div>${extra && extra.sub ? `<div class="asis-stat-sub" title="${escHtml(extra.sub)}">${escHtml(extra.sub)}</div>` : ''}</div>${extra && extra.ver ? `<button class="asis-ver" onclick="asisVerPersonas('${extra.ver}')">Ver</button>` : ''}</div>`;
  // Personal cargado: asistieron (al menos un turno) / no asistieron (o sin marcar si el evento sigue)
  const personas = _asisGrupos.reduce((a, g) => a.concat(g.personal.map(p => ({ ...p, evento: g.evento }))), []);
  const asistieron = personas.filter(p => p.jornadas > 0);
  const faltan = personas.filter(p => !p.jornadas);
  const turno = t => t ? { num: _asisDur(t.minutos), sub: `${t.persona} · ${_asisFechaCO(t.entrada_at)}` } : { num: '—', sub: 'Sin turnos completos' };
  const corto = turno(resumen.turno_mas_corto), largo = turno(resumen.turno_mas_largo);
  document.getElementById('asis-stats').innerHTML =
    st('modulos/usuarios.png', personas.length, 'Personal cargado') +
    st('iconos/estado-finalizado.svg', asistieron.length, 'Asistieron', { ver: 'asistieron' }) +
    st('iconos/faltante.svg', faltan.length, _asisEtiquetaFaltan(faltan), { ver: 'faltan' }) +
    st('iconos/estado-en-curso.svg', resumen.en_turno || 0, 'En turno ahora') +
    st('iconos/advertencia.svg', resumen.sin_salida || 0, 'Sin salida') +
    st('iconos/vencimiento.svg', corto.num, 'Turno más corto', { sub: corto.sub, dur: true }) +
    st('iconos/calendario.svg', largo.num, 'Turno más largo', { sub: largo.sub, dur: true });
  const tbody = document.getElementById('asis-tbody');
  if(!jornadas.length){
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:24px"><img class="empty-ico" src="img/iconos/asistencia.svg" alt=""><p>No hay jornadas con esos filtros</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = jornadas.map(j => {
    const [txt, cls] = _asisEstado(j);
    const reloj = j.reloj_desfase_seg && Math.abs(j.reloj_desfase_seg) > 600
      ? `<div class="asis-sub" title="La hora de la tablet estaba desfasada; se corrigió con la del servidor">⚠ Reloj de la tablet corregido (${Math.round(j.reloj_desfase_seg / 60)} min)</div>` : '';
    const offline = (j.entrada_offline || j.salida_offline) ? '<div class="asis-sub">Marcada sin conexión</div>' : '';
    const fotos = ['entrada', 'salida'].map(t => j['foto_' + t]
      ? `<button class="asis-foto" title="Foto de ${t}" onclick="asisVerFoto(${j.id}, '${t}')"><img src="img/iconos/cedula.svg" alt=""><span>${t === 'entrada' ? 'E' : 'S'}</span></button>` : '').join('');
    const accion = !j.salida_at
      ? `<button class="tb-btn asis-btn-salida" onclick="asisAbrirSalida(${j.id})"><img class="btn-ico" src="img/iconos/salir.svg" alt="">Registrar salida</button>` : '';
    return `<tr>
      <td data-label="Fotos"><div class="asis-fotos">${fotos || '<span style="color:#bbb">—</span>'}</div></td>
      <td data-label="Persona"><div class="asis-persona"><img src="img/avatares/personal.svg" alt=""><div><b>${escHtml(j.persona)}</b><div class="asis-sub">CC ${escHtml(j.cedula)}</div></div></div></td>
      <td data-label="Evento">${escHtml(j.evento)}</td>
      <td data-label="Entrada"><span class="asis-chip">${_asisFechaCO(j.entrada_at)}</span></td>
      <td data-label="Salida">${j.salida_at ? `<span class="asis-chip">${_asisFechaCO(j.salida_at)}</span>` : '—'}${j.salida_manual ? `<div class="asis-sub" title="${escHtml(j.salida_manual_motivo || '')}">Motivo: ${escHtml(j.salida_manual_motivo || '')}</div>` : ''}</td>
      <td data-label="Horas"><b>${_asisDur(j.minutos)}</b></td>
      <td data-label="Estado"><span class="asis-est ${cls}">${escHtml(txt)}</span>${reloj}${offline}</td>
      <td data-label="">${accion}</td>
    </tr>`;
  }).join('');
}

// "No asistieron" si su evento ya finalizó; "Sin marcar" si sigue en curso
function _asisEtiquetaFaltan(lista){
  const fin = lista.filter(p => p.estado === 'no_asistio').length;
  if(!lista.length) return _asisGrupos.some(g => g.evento.estado !== 'finalizado') ? 'Sin marcar' : 'No asistieron';
  return fin === lista.length ? 'No asistieron' : (fin ? 'No asistieron / sin marcar' : 'Sin marcar');
}
function asisVerPersonas(tipo){
  const personas = _asisGrupos.reduce((a, g) => a.concat(g.personal.map(p => ({ ...p, evento: g.evento }))), []);
  const lista = personas.filter(p => tipo === 'asistieron' ? p.jornadas > 0 : !p.jornadas);
  const varios = _asisGrupos.length > 1;
  document.getElementById('asis-lista-titulo').textContent = tipo === 'asistieron' ? `Asistieron (${lista.length})` : `${_asisEtiquetaFaltan(lista)} (${lista.length})`;
  document.getElementById('asis-lista-sub').textContent = tipo === 'asistieron'
    ? 'Personal cargado que marcó al menos un turno, con sus turnos y horas laboradas.'
    : 'Personal cargado que no ha marcado ningún turno (al finalizar el evento quedan como "No asistió").';
  document.getElementById('asis-lista-cuerpo').innerHTML = lista.length ? lista.map(p => `
    <div class="asis-personal-fila">
      <img src="img/avatares/personal.svg" alt="">
      <div class="asis-personal-datos"><b>${escHtml(p.nombre)}</b><div class="asis-sub">CC ${escHtml(p.cedula)}${varios ? ' · ' + escHtml(p.evento.nombre) : ''}${p.turnos_completos ? ` · ${p.turnos_completos} turno${p.turnos_completos !== 1 ? 's' : ''} · ${_asisDur(p.minutos)}` : ''}</div></div>
      <span class="asis-est ${ASIS_ESTADO_PERSONAL[p.estado][1]}">${ASIS_ESTADO_PERSONAL[p.estado][0]}</span>
    </div>`).join('') : '<div class="empty-state" style="padding:18px"><p>Nadie en esta lista</p></div>';
  document.getElementById('modal-asis-lista').classList.add('open');
}

function asisLimpiar(){
  ['asis-desde','asis-hasta','asis-estado','asis-q'].forEach(id => document.getElementById(id).value = '');
  asisBuscar();
}

// ── Personal cargado (desde archivo), agrupado por evento ──
// El estado se mide por turnos y horas laboradas en el evento (no por día de
// calendario: un turno que pasa la medianoche es uno solo).
const ASIS_ESTADO_PERSONAL = {
  en_turno: ['En turno', 'abierta'], sin_salida: ['Sin salida', 'sin'], completa: ['Completa', 'ok'],
  sin_marcar: ['Sin marcar', 'gris'], no_asistio: ['No asistió', 'no']
};
function _asisChipsEstado(lista){
  const cuenta = {};
  lista.forEach(p => { cuenta[p.estado] = (cuenta[p.estado] || 0) + 1; });
  return Object.keys(ASIS_ESTADO_PERSONAL).filter(k => cuenta[k])
    .map(k => `<span class="asis-est ${ASIS_ESTADO_PERSONAL[k][1]}">${cuenta[k]} · ${ASIS_ESTADO_PERSONAL[k][0]}</span>`).join('');
}
function _asisFilaPersonal(p, finalizado){
  const turnos = p.turnos_completos ? `${p.turnos_completos} turno${p.turnos_completos !== 1 ? 's' : ''} · ${_asisDur(p.minutos)} laborados` : '';
  const detalle = [`CC ${escHtml(p.cedula)}`, turnos, p.en_turno_desde ? 'en turno desde ' + _asisFechaCO(p.en_turno_desde) : ''].filter(Boolean).join(' · ');
  return `<div class="asis-personal-fila">
      <img src="img/avatares/personal.svg" alt="">
      <div class="asis-personal-datos"><b>${escHtml(p.nombre)}</b><div class="asis-sub">${detalle}</div></div>
      <span class="asis-est ${ASIS_ESTADO_PERSONAL[p.estado][1]}">${ASIS_ESTADO_PERSONAL[p.estado][0]}</span>
      ${p.jornadas || finalizado ? '' : `<button class="act-btn danger" title="Quitar del evento (aún no ha marcado)" onclick="asisQuitarPersonal(${p.id})"><img class="btn-ico" src="img/iconos/eliminar.svg" alt=""></button>`}
    </div>`;
}
async function _asisRenderPersonal(){
  const card = document.getElementById('asis-personal-card');
  const eventoId = document.getElementById('asis-evento').value;
  const grupos = _asisGrupos;
  // "Todos los eventos" sin ningún evento con personal: no se muestra la tarjeta
  if(!eventoId && !grupos.length){ card.style.display = 'none'; return; }
  card.style.display = '';
  const todas = grupos.reduce((a, g) => a.concat(g.personal), []);
  document.getElementById('asis-personal-titulo').textContent = eventoId
    ? `Personal del evento (${todas.length})`
    : `Personal por evento (${grupos.length} evento${grupos.length !== 1 ? 's' : ''} · ${todas.length} personas)`;
  document.getElementById('asis-personal-resumen').innerHTML = _asisChipsEstado(todas);
  const lista = document.getElementById('asis-personal-lista');
  if(!todas.length){
    lista.innerHTML = '<div class="empty-state" style="padding:18px"><img class="empty-ico" src="img/modulos/usuarios.png" alt=""><p>Este evento no tiene personal cargado: usa "Cargar personal"</p></div>';
    return;
  }
  // Un solo evento: la lista directa. Todos: cada evento con su personal debajo.
  lista.innerHTML = grupos.map(g => {
    const fin = g.evento.estado === 'finalizado';
    const cabecera = eventoId ? '' : `<div class="asis-personal-grupo">
        <b>${escHtml(g.evento.nombre)}</b>
        <span class="asis-sub">${fmtDate(g.evento.fecha_inicio)} → ${fmtDate(g.evento.fecha_fin)} · ${g.personal.length} persona${g.personal.length !== 1 ? 's' : ''}${fin ? ' · finalizado' : ''}</span>
        <span class="asis-personal-resumen">${_asisChipsEstado(g.personal)}</span>
      </div>`;
    return cabecera + g.personal.map(p => _asisFilaPersonal(p, fin)).join('');
  }).join('');
}
function asisQuitarPersonal(id){
  document.getElementById('modal-title').textContent = 'Quitar del evento';
  document.getElementById('modal-sub').textContent = 'La persona dejará de poder marcar asistencia en este evento.';
  document.getElementById('modal-ok-btn').onclick = async () => {
    try { await Asistencia.quitarPersonal(id); closeModal('modal-confirm'); toast('✓ Persona quitada del evento', 'success'); _asisRenderPersonal(); }
    catch(e){ toastError(e.message); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── Carga de personal desde archivo (Nombre completo, Cédula) ──
let _asisCargaPersonas = [];
let _asisCargaLectura = 0;
async function asisAbrirCarga(){
  _asisCargaPersonas = [];
  document.getElementById('asis-carga-archivo').value = '';
  document.getElementById('asis-carga-previa').innerHTML = '';
  document.getElementById('asis-carga-btn').disabled = true;
  try {
    const eventos = await Asistencia.eventos();
    const sel = document.getElementById('asis-carga-evento');
    sel.innerHTML = '<option value="">Selecciona el evento…</option>' + eventos.map(e =>
      `<option value="${e.id}">${escHtml(e.nombre)} (${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)}) · ${e.personal} cargad${e.personal === 1 ? 'a' : 'as'}</option>`).join('');
    const filtro = document.getElementById('asis-evento').value;
    if(filtro && eventos.some(e => String(e.id) === filtro)) sel.value = filtro;
    document.getElementById('modal-asis-carga').classList.add('open');
  } catch(e){ toastError(e.message); }
}
function asisDescargarPlantilla(){
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el generador de Excel. Revisa la conexión.');
  const ws = XLSX.utils.aoa_to_sheet([['Nombre completo', 'Cédula']]);
  ws['!cols'] = [{ wch: 40 }, { wch: 18 }];
  const ins = XLSX.utils.aoa_to_sheet([
    ['Cómo llenar la plantilla'], [],
    ['1. En la hoja "Personal", una persona por fila desde la fila 2.'],
    ['2. Nombre completo: nombres y apellidos.'],
    ['3. Cédula: solo números (sin puntos ni espacios). Su PIN serán los últimos 4 dígitos.'],
    ['4. Guarda el archivo y súbelo en Asistencias → Cargar personal, eligiendo el evento.'],
    ['5. Personal de último minuto: sube solo las personas nuevas, no la lista completa.']
  ]);
  ins['!cols'] = [{ wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Personal');
  XLSX.utils.book_append_sheet(wb, ins, 'Instrucciones');
  XLSX.writeFile(wb, 'plantilla_personal_asistencia.xlsx');
}
// Lee el archivo en el navegador: busca la fila con "Nombre" y "Cédula" y toma las de abajo
function asisLeerArchivo(){
  const archivo = document.getElementById('asis-carga-archivo').files[0];
  const previa = document.getElementById('asis-carga-previa');
  const btn = document.getElementById('asis-carga-btn');
  _asisCargaPersonas = []; btn.disabled = true; previa.innerHTML = '';
  if(!archivo) return;
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el lector de Excel. Revisa la conexión.');
  // Cada lectura reemplaza a la anterior (si el evento "change" llega dos veces
  // no se suman las filas): solo cuenta la última
  const lectura = ++_asisCargaLectura;
  const lector = new FileReader();
  lector.onload = () => {
    if(lectura !== _asisCargaLectura) return;
    _asisCargaPersonas = [];
    let filas;
    try {
      const wb = XLSX.read(new Uint8Array(lector.result), { type: 'array' });
      filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } catch(e){ previa.innerHTML = '<div class="asis-carga-error">No se pudo leer el archivo. Usa la plantilla (.xlsx).</div>'; return; }
    const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const iCab = filas.findIndex(f => f.some(c => norm(c).indexOf('nombre') === 0) && f.some(c => norm(c).indexOf('cedula') === 0));
    if(iCab < 0){ previa.innerHTML = '<div class="asis-carga-error">El archivo debe tener las columnas "Nombre completo" y "Cédula" (usa la plantilla).</div>'; return; }
    const cN = filas[iCab].findIndex(c => norm(c).indexOf('nombre') === 0), cC = filas[iCab].findIndex(c => norm(c).indexOf('cedula') === 0);
    for(let i = iCab + 1; i < filas.length; i++){
      // Mismo formato que guarda el servidor: "Carlos David Murcia Rodriguez"
      const nombre = String(filas[i][cN] || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es')
        .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toLocaleUpperCase('es'));
      const cedula = String(filas[i][cC] || '').trim();
      if(!nombre && !cedula) continue;
      _asisCargaPersonas.push({ fila: i + 1, nombre, cedula });
    }
    if(!_asisCargaPersonas.length){ previa.innerHTML = '<div class="asis-carga-error">El archivo no trae personas debajo de los títulos.</div>'; return; }
    previa.innerHTML = `<div class="asis-carga-ok">Se leyeron <b>${_asisCargaPersonas.length}</b> persona${_asisCargaPersonas.length !== 1 ? 's' : ''}: ` +
      _asisCargaPersonas.slice(0, 3).map(p => escHtml(p.nombre)).join(', ') + (_asisCargaPersonas.length > 3 ? '…' : '') + '</div>';
    btn.disabled = false;
  };
  lector.readAsArrayBuffer(archivo);
}
async function asisConfirmarCarga(btn){
  const eventoId = document.getElementById('asis-carga-evento').value;
  if(!eventoId) return toastError('Selecciona el evento al que se carga el personal');
  if(!_asisCargaPersonas.length) return toastError('Elige el archivo con el personal');
  await unaVez('asis-carga', btn, async () => {
    try {
      const r = await Asistencia.cargarPersonal(parseInt(eventoId), _asisCargaPersonas);
      closeModal('modal-asis-carga');
      toast('✓ ' + r.mensaje, 'success');
      document.getElementById('asis-evento').value = eventoId;
      await asisBuscar();
    } catch(e){
      const errs = e.data && e.data.errores;
      document.getElementById('asis-carga-previa').innerHTML = '<div class="asis-carga-error"><b>No se cargó nada.</b> Corrige el archivo y vuelve a subirlo:<ul>' +
        (errs || [e.message]).slice(0, 15).map(x => `<li>${escHtml(x)}</li>`).join('') + (errs && errs.length > 15 ? `<li>… y ${errs.length - 15} más</li>` : '') + '</ul></div>';
    }
  });
}

// ── Fotos ──
async function asisVerFoto(id, tipo){
  try {
    const blob = await Asistencia.foto(id, tipo);
    const url = URL.createObjectURL(blob);
    const j = _asisDatos.jornadas.find(x => x.id === id);
    document.getElementById('asis-foto-titulo').textContent = `${tipo === 'entrada' ? 'Entrada' : 'Salida'} · ${j ? j.persona : ''}`;
    document.getElementById('asis-foto-sub').textContent = j ? _asisFechaCO(tipo === 'entrada' ? j.entrada_at : j.salida_at) + ' · ' + j.evento : '';
    const img = document.getElementById('asis-foto-img');
    if(img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.src = url; img.dataset.url = url;
    document.getElementById('modal-asis-foto').classList.add('open');
  } catch(e){ toastError(e.message); }
}

// ── Salida manual ──
function asisAbrirSalida(id){
  const j = _asisDatos.jornadas.find(x => x.id === id);
  if(!j) return;
  _asisSalidaId = id;
  document.getElementById('asis-salida-sub').textContent = `${j.persona} · ${j.evento} · entrada ${_asisFechaCO(j.entrada_at)}`;
  document.getElementById('asis-salida-fecha').value = _asisHoyCO();
  document.getElementById('asis-salida-hora').value = '';
  document.getElementById('asis-salida-motivo').value = '';
  document.getElementById('modal-asis-salida').classList.add('open');
}
async function asisGuardarSalida(btn){
  const fecha = document.getElementById('asis-salida-fecha').value;
  const hora = document.getElementById('asis-salida-hora').value;
  const motivo = document.getElementById('asis-salida-motivo').value.trim();
  if(!fecha || !/^\d{2}:\d{2}$/.test(hora)) return toastError('Indica la fecha y la hora de salida');
  if(motivo.length < 5) return toastError('Escribe el motivo de la salida manual');
  await unaVez('asis-salida', btn, async () => {
    try {
      await Asistencia.salidaManual(_asisSalidaId, { fecha, hora, motivo });
      closeModal('modal-asis-salida');
      toast('✓ Salida registrada', 'success');
      await asisBuscar();
    } catch(e){ toastError(e.message); }
  });
}

// ── Cuentas de las tablets (sin límite) ──
let _asisCuentas = [];
async function asisAbrirCuenta(){
  asisNuevaCuenta();
  await _asisCargarCuentas();
  document.getElementById('modal-asis-cuenta').classList.add('open');
}
async function _asisCargarCuentas(){
  const cont = document.getElementById('asis-cuentas-lista');
  try {
    _asisCuentas = await Asistencia.cuentas();
    cont.innerHTML = _asisCuentas.length ? _asisCuentas.map(c => `
      <div class="asis-cuenta-fila">
        <div style="flex:1;min-width:0"><b>${escHtml(c.usuario)}</b>
          <div class="asis-sub">Contraseña: ••••••••  · ${c.ultimo_ingreso_at ? 'Última activación ' + _asisFechaCO(c.ultimo_ingreso_at) : 'Aún no se ha usado'} · ${c.dispositivos} tablet${c.dispositivos !== 1 ? 's' : ''}</div></div>
        <button class="act-btn" title="Editar usuario o asignar contraseña nueva" onclick="asisEditarCuenta(${c.id})"><img class="btn-ico" src="img/iconos/editar.svg" alt=""></button>
        <button class="act-btn danger" title="Eliminar cuenta" onclick="asisEliminarCuenta(${c.id})"><img class="btn-ico" src="img/iconos/eliminar.svg" alt=""></button>
      </div>`).join('') : '<div class="empty-state" style="padding:16px"><p>Aún no hay cuentas: crea la primera abajo.</p></div>';
  } catch(e){ cont.innerHTML = `<div class="empty-state" style="padding:16px"><p>${escHtml(e.message)}</p></div>`; }
}
function asisNuevaCuenta(){
  document.getElementById('asis-cuenta-id').value = '';
  document.getElementById('asis-cuenta-usuario').value = '';
  document.getElementById('asis-cuenta-pass').value = '';
  document.getElementById('asis-cuenta-form-t').textContent = 'Nueva cuenta';
  document.getElementById('asis-cuenta-pass-lbl').innerHTML = 'Contraseña <span style="font-weight:400;color:#aaa">(mín. 8 caracteres)</span>';
  document.getElementById('asis-cuenta-guardar').textContent = 'Crear cuenta';
  document.getElementById('asis-cuenta-cancelar-ed').style.display = 'none';
}
function asisEditarCuenta(id){
  const c = _asisCuentas.find(x => x.id === id);
  if(!c) return;
  document.getElementById('asis-cuenta-id').value = id;
  document.getElementById('asis-cuenta-usuario').value = c.usuario;
  document.getElementById('asis-cuenta-pass').value = '';
  document.getElementById('asis-cuenta-form-t').textContent = 'Editar ' + c.usuario;
  document.getElementById('asis-cuenta-pass-lbl').innerHTML = 'Contraseña nueva <span style="font-weight:400;color:#aaa">(vacía = no cambiarla)</span>';
  document.getElementById('asis-cuenta-guardar').textContent = 'Guardar cambios';
  document.getElementById('asis-cuenta-cancelar-ed').style.display = '';
  document.getElementById('asis-cuenta-usuario').focus();
}
async function asisGuardarCuenta(btn){
  const id = document.getElementById('asis-cuenta-id').value;
  const usuario = document.getElementById('asis-cuenta-usuario').value.trim();
  const password = document.getElementById('asis-cuenta-pass').value;
  await unaVez('asis-cuenta', btn, async () => {
    try {
      const r = id ? await Asistencia.editarCuenta(parseInt(id), { usuario, password }) : await Asistencia.crearCuenta({ usuario, password });
      toast('✓ ' + r.mensaje, 'success');
      asisNuevaCuenta();
      await _asisCargarCuentas();
    } catch(e){ toastError(e.message); }
  });
}
function asisEliminarCuenta(id){
  const c = _asisCuentas.find(x => x.id === id);
  if(!c) return;
  document.getElementById('modal-title').textContent = 'Eliminar cuenta de tablets';
  document.getElementById('modal-sub').innerHTML = `¿Eliminar la cuenta <strong>${escHtml(c.usuario)}</strong>? Las tablets activadas con ella dejan de marcar. Las marcas que ya hizo se conservan.`;
  document.getElementById('modal-ok-btn').onclick = async () => {
    try {
      const r = await Asistencia.eliminarCuenta(id);
      closeModal('modal-confirm');
      toast('✓ ' + r.mensaje, 'success');
      await _asisCargarCuentas();
    } catch(e){ toastError(e.message); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── Dispositivos e IP ──
let _asisMarcasIp = [];
async function asisAbrirDispositivos(){
  const sel = document.getElementById('asis-disp-evento');
  sel.innerHTML = '<option value="">Todos los eventos</option>' + (S.eventos || []).map(e => `<option value="${e.id}">${escHtml(e.nombre)}</option>`).join('');
  sel.value = document.getElementById('asis-evento').value;
  document.getElementById('asis-disp-desde').value = document.getElementById('asis-desde').value;
  document.getElementById('asis-disp-hasta').value = document.getElementById('asis-hasta').value;
  document.getElementById('modal-asis-dispositivos').classList.add('open');
  await Promise.all([asisBuscarMarcasIp(), _asisCargarDispositivos()]);
}
async function asisBuscarMarcasIp(){
  const cont = document.getElementById('asis-disp-tabla');
  cont.innerHTML = '<div class="empty-state" style="padding:16px"><p>Cargando…</p></div>';
  try {
    _asisMarcasIp = await Asistencia.marcasIp({
      evento_id: document.getElementById('asis-disp-evento').value,
      desde: document.getElementById('asis-disp-desde').value,
      hasta: document.getElementById('asis-disp-hasta').value
    });
    const raras = _asisMarcasIp.filter(m => m.ip_distinta || m.dispositivo_sin_nombre);
    document.getElementById('asis-disp-resumen').innerHTML =
      `<span class="asis-est gris">${_asisMarcasIp.length} marca${_asisMarcasIp.length !== 1 ? 's' : ''}</span>` +
      (_asisMarcasIp.filter(m => m.ip_distinta).length ? `<span class="asis-est man">${_asisMarcasIp.filter(m => m.ip_distinta).length} desde una IP distinta a la habitual</span>` : '') +
      (_asisMarcasIp.filter(m => m.dispositivo_sin_nombre).length ? `<span class="asis-est sin">${_asisMarcasIp.filter(m => m.dispositivo_sin_nombre).length} desde dispositivos sin nombre</span>` : '') +
      (!raras.length && _asisMarcasIp.length ? '<span class="asis-est ok">Todas desde la IP habitual y tablets registradas</span>' : '');
    cont.innerHTML = _asisMarcasIp.length ? `<table><thead><tr><th>Persona</th><th>Evento</th><th>Marca</th><th>Fecha y hora</th><th>IP</th><th>Dispositivo</th><th>Cuenta</th><th>Observación</th></tr></thead><tbody>` +
      _asisMarcasIp.map(m => `<tr class="${m.ip_distinta || m.dispositivo_sin_nombre ? 'alerta' : ''}">
        <td><b>${escHtml(m.persona || '—')}</b><div class="asis-sub">CC ${escHtml(m.cedula || '')}</div></td>
        <td>${escHtml(m.evento)}</td><td>${m.tipo}</td><td>${_asisFechaCO(m.fecha)}</td>
        <td><code>${escHtml(m.ip || 'Sin registro')}</code></td>
        <td>${escHtml(m.dispositivo || 'Sin registro')}</td><td>${escHtml(m.cuenta || '—')}</td>
        <td>${_asisObsMarca(m)}</td></tr>`).join('') + '</tbody></table>'
      : '<div class="empty-state" style="padding:16px"><p>No hay marcas con esos filtros</p></div>';
  } catch(e){ cont.innerHTML = `<div class="empty-state" style="padding:16px"><p>${escHtml(e.message)}</p></div>`; }
}
function _asisObsMarca(m){
  return [m.ip_distinta ? `IP distinta a la habitual (${m.ip_habitual})` : '', m.dispositivo_sin_nombre ? 'Dispositivo sin nombre' : '',
    m.offline ? 'Marcada sin conexión (IP de la sincronización)' : ''].filter(Boolean).join(' · ') || '—';
}
async function _asisCargarDispositivos(){
  const cont = document.getElementById('asis-disp-lista');
  try {
    const lista = await Asistencia.dispositivos();
    cont.innerHTML = lista.length ? lista.map(d => `
      <div class="asis-disp-fila">
        <input type="text" id="asis-disp-nombre-${d.id}" value="${escHtml(d.nombre || '')}" placeholder="Sin nombre · ${escHtml(d.codigo.slice(-6).toUpperCase())}" maxlength="60">
        <button class="tb-btn" onclick="asisNombrarDispositivo(${d.id})">Guardar nombre</button>
        <div class="asis-sub" style="margin:0">Cuenta ${escHtml(d.cuenta || '—')} · última vez ${_asisFechaCO(d.ultima_vez_at)} · IP ${escHtml(d.ultima_ip || '—')} · ${d.jornadas} marca${d.jornadas !== 1 ? 's' : ''}</div>
      </div>`).join('') : '<div class="empty-state" style="padding:12px"><p>Ninguna tablet ha marcado todavía</p></div>';
  } catch(e){ cont.innerHTML = `<div class="empty-state" style="padding:12px"><p>${escHtml(e.message)}</p></div>`; }
}
async function asisNombrarDispositivo(id){
  try {
    const r = await Asistencia.nombrarDispositivo(id, document.getElementById('asis-disp-nombre-' + id).value);
    toast('✓ ' + r.mensaje, 'success');
    await Promise.all([_asisCargarDispositivos(), asisBuscarMarcasIp()]);
  } catch(e){ toastError(e.message); }
}
function asisExcelMarcasIp(){
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el generador de Excel. Revisa la conexión.');
  if(!_asisMarcasIp.length) return toastError('No hay marcas para exportar');
  const filas = [['Nombre','Cédula','Evento','Marca','Fecha','Hora','IP','IP habitual del evento','Dispositivo','Cuenta','Marcada sin conexión','Observación']]
    .concat(_asisMarcasIp.slice().reverse().map(m => [m.persona || '', m.cedula || '', m.evento, m.tipo, _asisSoloFecha(m.fecha), _asisSoloHora(m.fecha),
      m.ip || 'Sin registro', m.ip_habitual || '', m.dispositivo || 'Sin registro', m.cuenta || '', m.offline ? 'Sí' : 'No', _asisObsMarca(m).replace(/^—$/, '')]));
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [26, 13, 24, 9, 12, 8, 16, 18, 26, 26, 12, 46].map(w => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: filas[0].length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dispositivos e IP');
  XLSX.writeFile(wb, `asistencia_dispositivos_ip_${_asisHoyCO()}.xlsx`);
}
function asisCerrarSesiones(){
  document.getElementById('modal-title').textContent = 'Cerrar sesión de todas las tablets';
  document.getElementById('modal-sub').innerHTML = 'Todas las tablets de asistencia dejarán de marcar hasta que se activen otra vez con la cuenta de Datacontrol. <strong>Las marcas guardadas sin conexión que aún no se subieron no se podrán sincronizar</strong> hasta reactivarlas.';
  document.getElementById('modal-ok-btn').onclick = async () => {
    try {
      const r = await Asistencia.cerrarSesiones();
      closeModal('modal-confirm');
      toast('✓ ' + r.mensaje, 'success');
    } catch(e){ toastError(e.message); }
  };
  document.getElementById('modal-confirm').classList.add('open');
}

// ── Exportar para nómina ──
// Fecha y hora por separado (hora de Colombia)
function _asisSoloFecha(iso){ return iso ? _asisFechaCO(iso).slice(0, 10) : ''; }
function _asisSoloHora(iso){ return iso ? _asisFechaCO(iso).slice(11, 16) : ''; }

// Una fila por jornada, en orden cronológico, con todo lo que muestra el PDF
function _asisFilasExport(){
  return _asisDatos.jornadas.slice().reverse().map(j => ({
    persona: j.persona, cedula: j.cedula, evento: j.evento,
    fecha_entrada: _asisSoloFecha(j.entrada_at), hora_entrada: _asisSoloHora(j.entrada_at),
    fecha_salida: _asisSoloFecha(j.salida_at), hora_salida: _asisSoloHora(j.salida_at),
    minutos: j.minutos,
    horas: j.minutos !== null && j.minutos !== undefined ? _asisDur(j.minutos) : '',
    estado: _asisEstado(j)[0],
    motivo: j.salida_manual ? (j.salida_manual_motivo || '') : '',
    registrada_por: j.salida_manual ? (j.salida_manual_por || '') : '',
    sin_conexion: j.entrada_offline || j.salida_offline ? 'Sí' : 'No',
    reloj: j.reloj_desfase_seg && Math.abs(j.reloj_desfase_seg) > 600 ? Math.round(j.reloj_desfase_seg / 60) : ''
  }));
}
function _asisConsolidado(filas){
  const porPersona = {};
  filas.forEach(f => {
    const k = f.cedula;
    if(!porPersona[k]) porPersona[k] = { persona: f.persona, cedula: f.cedula, jornadas: 0, completas: 0, sin_salida: 0, minutos: 0 };
    const p = porPersona[k];
    p.jornadas++;
    if(f.minutos !== null && f.minutos !== undefined){ p.completas++; p.minutos += f.minutos; }
    else p.sin_salida++;
  });
  return Object.values(porPersona).sort((a, b) => a.persona.localeCompare(b.persona));
}
function _asisTituloPeriodo(){
  const f = _asisFiltros();
  const ev = document.getElementById('asis-evento');
  return [f.evento_id ? ev.options[ev.selectedIndex].text : 'Todos los eventos',
    f.desde || f.hasta ? `${f.desde ? fmtDate(f.desde) : '…'} a ${f.hasta ? fmtDate(f.hasta) : '…'}` : 'Todas las fechas'].join(' · ');
}
// Excel: una sola tabla. Una fila por turno con los totales de la persona
// (Jornadas, Completas, Sin salida) y, al final, el personal cargado que no
// marcó ningún turno ("No asistió" / "Sin marcar"). La columna Evento solo
// cuando se descarga con "Todos los eventos".
function asisExportExcel(){
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el generador de Excel. Revisa la conexión.');
  const filas = _asisFilasExport();
  const todos = !_asisFiltros().evento_id;
  const faltan = _asisGrupos.reduce((a, g) => a.concat(g.personal.filter(p => !p.jornadas).map(p => ({ ...p, evento: g.evento.nombre }))), []);
  if(!filas.length && !faltan.length) return toastError('No hay jornadas ni personal para exportar');
  const totales = {};
  filas.forEach(f => {
    const k = f.cedula + '|' + f.evento;
    const t = totales[k] || (totales[k] = { jornadas: 0, completas: 0, sin_salida: 0 });
    t.jornadas++;
    if(f.minutos !== null && f.minutos !== undefined) t.completas++; else t.sin_salida++;
  });
  const cols = ['Nombre', 'Cédula'].concat(todos ? ['Evento'] : [], ['Jornadas', 'Completas', 'Sin salida', 'Fecha de entrada', 'Hora de entrada',
    'Fecha de salida', 'Hora de salida', 'Minutos', 'Horas trabajadas', 'Estado', 'Motivo salida manual', 'Salida registrada por',
    'Marcada sin conexión', 'Reloj de la tablet corregido (min)']);
  const orden = filas.slice().sort((a, b) => a.persona.localeCompare(b.persona) || (a.fecha_entrada + a.hora_entrada).localeCompare(b.fecha_entrada + b.hora_entrada));
  const tabla = [cols].concat(orden.map(f => {
    const t = totales[f.cedula + '|' + f.evento];
    return [f.persona, f.cedula].concat(todos ? [f.evento] : [], [t.jornadas, t.completas, t.sin_salida, f.fecha_entrada, f.hora_entrada,
      f.fecha_salida || 'Sin salida', f.hora_salida, f.minutos === null || f.minutos === undefined ? '' : f.minutos, f.horas, f.estado,
      f.motivo, f.registrada_por, f.sin_conexion, f.reloj]);
  }), faltan.sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => [p.nombre, p.cedula].concat(todos ? [p.evento] : [],
    [0, 0, 0, '', '', '', '', '', '', ASIS_ESTADO_PERSONAL[p.estado][0], '', '', '', ''])));
  const ws = XLSX.utils.aoa_to_sheet(tabla);
  ws['!cols'] = [26, 13].concat(todos ? [24] : [], [9, 10, 10, 15, 13, 15, 13, 9, 16, 22, 34, 22, 12, 14]).map(w => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tabla.length - 1, c: cols.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
  XLSX.writeFile(wb, `asistencia_${_asisHoyCO()}.xlsx`);
}
function asisExportPDF(){
  const filas = _asisFilasExport();
  if(!filas.length) return toastError('No hay jornadas para exportar');
  const w = window.open('', '_blank');
  if(!w) return toastError('El navegador bloqueó la ventana: permite las ventanas emergentes para este sitio');
  const cons = _asisConsolidado(filas);
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Asistencia de personal</title>
<style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:10.5px;color:#111}h1{font-size:15px;margin:0}
.sub{color:#555;margin:2px 0 12px}h2{font-size:12px;margin:14px 0 6px}table{width:100%;border-collapse:collapse}
th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#eee}td.n{text-align:right}</style></head><body>
<h1>NOVA BRIDGE SAS — Asistencia de personal</h1><div class="sub">${escHtml(_asisTituloPeriodo())} · Generado el ${_asisFechaCO(new Date().toISOString())}</div>
<h2>Consolidado para nómina</h2><table><tr><th>Persona</th><th>Cédula</th><th>Jornadas</th><th>Completas</th><th>Sin salida</th><th>Horas trabajadas</th></tr>
${cons.map(p => `<tr><td>${escHtml(p.persona)}</td><td>${escHtml(p.cedula)}</td><td class="n">${p.jornadas}</td><td class="n">${p.completas}</td><td class="n">${p.sin_salida}</td><td class="n">${_asisDur(p.minutos)}</td></tr>`).join('')}</table>
<h2>Jornadas</h2><table><tr><th>Persona</th><th>Cédula</th><th>Evento</th><th>Fecha de entrada</th><th>Hora de entrada</th><th>Fecha de salida</th><th>Hora de salida</th><th>Horas</th><th>Estado</th><th>Motivo salida manual</th></tr>
${filas.map(f => `<tr><td>${escHtml(f.persona)}</td><td>${escHtml(f.cedula)}</td><td>${escHtml(f.evento)}</td><td>${f.fecha_entrada}</td><td>${f.hora_entrada}</td><td>${f.fecha_salida || 'Sin salida'}</td><td>${f.hora_salida}</td><td class="n">${f.horas || '—'}</td><td>${escHtml(f.estado)}</td><td>${escHtml(f.motivo)}${f.registrada_por ? ' (' + escHtml(f.registrada_por) + ')' : ''}</td></tr>`).join('')}</table>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
