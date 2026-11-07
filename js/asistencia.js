// ══════════════════════════════════════════
// ASISTENCIAS (Admin) — jornadas de entrada/salida marcadas en las tablets
// de /datacontrol. Filtros, resumen, salida manual (con motivo), fotos,
// exportación para nómina (Excel y PDF) y la cuenta de las tablets.
// ══════════════════════════════════════════
let _asisDatos = { jornadas: [], resumen: {} };
let _asisSalidaId = null;

const ASIS_ESTADOS = {
  abierta:    ['En turno', 'abierta'],
  cerrada:    ['Completa', 'ok'],
  sin_salida: ['Sin salida (+16 h)', 'sin'],
};

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
    _asisDatos = await Asistencia.listar(_asisFiltros());
    _asisRenderPersonal();
  } catch(e){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:24px"><p>${escHtml(e.message)}</p></div></td></tr>`;
    return;
  }
  _asisRender();
}

function _asisRender(){
  const { jornadas, resumen } = _asisDatos;
  const st = (ico, num, label) => `<div class="rep-stat"><div class="rep-stat-icon ilustrado"><img src="img/${ico}" alt=""></div><div><div class="rep-stat-num">${num}</div><div class="rep-stat-label">${label}</div></div></div>`;
  document.getElementById('asis-stats').innerHTML =
    (resumen.personas_cargadas !== null && resumen.personas_cargadas !== undefined ? st('modulos/usuarios.png', resumen.personas_cargadas, 'Personal cargado') : st('modulos/usuarios.png', new Set(jornadas.map(j => j.cedula)).size, 'Personas con jornadas')) +
    st('iconos/estado-en-curso.svg', resumen.en_turno || 0, 'En turno ahora') +
    st('iconos/faltante.svg', resumen.sin_salida || 0, 'Sin salida') +
    st('iconos/vencimiento.svg', _asisDur(resumen.minutos || 0), 'Horas del período');
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

function asisLimpiar(){
  ['asis-desde','asis-hasta','asis-estado','asis-q'].forEach(id => document.getElementById(id).value = '');
  asisBuscar();
}

// ── Personal del evento (cargado desde archivo) y su estado de hoy ──
const ASIS_ESTADO_PERSONAL = {
  sin_marcar: ['Sin marcar hoy', 'gris'], en_turno: ['En turno', 'abierta'], completa: ['Completa', 'ok'], sin_salida: ['Sin salida', 'sin']
};
async function _asisRenderPersonal(){
  const card = document.getElementById('asis-personal-card');
  const eventoId = document.getElementById('asis-evento').value;
  if(!eventoId){ card.style.display = 'none'; return; }
  let lista;
  try { lista = await Asistencia.personal(eventoId); } catch(e){ card.style.display = 'none'; return; }
  card.style.display = '';
  const cuenta = {};
  lista.forEach(p => { cuenta[p.estado] = (cuenta[p.estado] || 0) + 1; });
  document.getElementById('asis-personal-titulo').textContent = `Personal del evento (${lista.length})`;
  document.getElementById('asis-personal-resumen').innerHTML = Object.keys(ASIS_ESTADO_PERSONAL).filter(k => cuenta[k])
    .map(k => `<span class="asis-est ${ASIS_ESTADO_PERSONAL[k][1]}">${cuenta[k]} · ${ASIS_ESTADO_PERSONAL[k][0]}</span>`).join('');
  document.getElementById('asis-personal-lista').innerHTML = lista.length ? lista.map(p => `
    <div class="asis-personal-fila">
      <img src="img/avatares/personal.svg" alt="">
      <div class="asis-personal-datos"><b>${escHtml(p.nombre)}</b><div class="asis-sub">CC ${escHtml(p.cedula)}${p.ultima_entrada ? ' · última entrada ' + _asisFechaCO(p.ultima_entrada) : ''}</div></div>
      <span class="asis-est ${ASIS_ESTADO_PERSONAL[p.estado][1]}">${ASIS_ESTADO_PERSONAL[p.estado][0]}</span>
      ${p.jornadas ? '' : `<button class="act-btn danger" title="Quitar del evento (aún no ha marcado)" onclick="asisQuitarPersonal(${p.id})"><img class="btn-ico" src="img/iconos/eliminar.svg" alt=""></button>`}
    </div>`).join('')
    : '<div class="empty-state" style="padding:18px"><img class="empty-ico" src="img/modulos/usuarios.png" alt=""><p>Este evento no tiene personal cargado: usa "Cargar personal"</p></div>';
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
      const nombre = String(filas[i][cN] || '').trim(), cedula = String(filas[i][cC] || '').trim();
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

// ── Cuenta de las tablets ──
async function asisAbrirCuenta(){
  document.getElementById('asis-cuenta-pass').value = '';
  try {
    const c = await Asistencia.cuenta();
    const hay = !!(c && c.existe);
    document.getElementById('asis-cuenta-usuario').value = hay ? c.usuario : 'datacontrol@novabridge.com.co';
    document.getElementById('asis-cuenta-estado').innerHTML = hay
      ? `Cuenta creada. Sesiones válidas desde ${_asisFechaCO(c.sesiones_desde)}. Deja la contraseña vacía para no cambiarla.`
      : 'Aún no hay cuenta: crea el usuario y la contraseña con los que se activan las tablets.';
    document.getElementById('modal-asis-cuenta').classList.add('open');
  } catch(e){ toastError(e.message); }
}
async function asisGuardarCuenta(btn){
  const usuario = document.getElementById('asis-cuenta-usuario').value.trim();
  const password = document.getElementById('asis-cuenta-pass').value;
  await unaVez('asis-cuenta', btn, async () => {
    try {
      const r = await Asistencia.guardarCuenta({ usuario, password });
      closeModal('modal-asis-cuenta');
      toast('✓ ' + r.mensaje, 'success');
    } catch(e){ toastError(e.message); }
  });
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
    persona: j.persona, cedula: j.cedula, rol: j.nivel === 1 ? 'Médico' : 'Enfermero/a', evento: j.evento,
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
const ASIS_COLS_JORNADAS = ['Persona','Cédula','Rol','Evento','Fecha de entrada','Hora de entrada','Fecha de salida','Hora de salida',
  'Minutos','Horas trabajadas','Estado','Motivo salida manual','Salida registrada por','Marcada sin conexión','Reloj de la tablet corregido (min)'];
function _asisFilaJornada(f){
  return [f.persona, f.cedula, f.rol, f.evento, f.fecha_entrada, f.hora_entrada, f.fecha_salida || 'Sin salida', f.hora_salida,
    f.minutos === null || f.minutos === undefined ? '' : f.minutos, f.horas, f.estado, f.motivo, f.registrada_por, f.sin_conexion, f.reloj];
}
function _asisConsolidado(filas){
  const porPersona = {};
  filas.forEach(f => {
    const k = f.cedula;
    if(!porPersona[k]) porPersona[k] = { persona: f.persona, cedula: f.cedula, rol: f.rol, jornadas: 0, completas: 0, sin_salida: 0, minutos: 0 };
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
function asisExportExcel(){
  if(typeof XLSX === 'undefined') return toastError('No se pudo cargar el generador de Excel. Revisa la conexión.');
  const filas = _asisFilasExport();
  if(!filas.length) return toastError('No hay jornadas para exportar');
  const jornadas = [ASIS_COLS_JORNADAS].concat(filas.map(_asisFilaJornada));
  const consolidado = [['Persona','Cédula','Rol','Jornadas','Completas','Sin salida','Minutos','Horas trabajadas']]
    .concat(_asisConsolidado(filas).map(p => [p.persona, p.cedula, p.rol, p.jornadas, p.completas, p.sin_salida, p.minutos, _asisDur(p.minutos)]));
  const anchos = [26, 13, 12, 24, 15, 13, 15, 13, 9, 16, 22, 34, 22, 12, 14].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  // Hoja 1 — igual que el PDF: consolidado para nómina y, debajo, cada jornada
  const hoja1 = [['NOVA BRIDGE SAS — Asistencia de personal'], [_asisTituloPeriodo()],
    [`Generado el ${_asisFechaCO(new Date().toISOString())}`], [],
    ['CONSOLIDADO PARA NÓMINA']].concat(consolidado, [[], ['JORNADAS']], jornadas);
  const ws1 = XLSX.utils.aoa_to_sheet(hoja1);
  ws1['!cols'] = anchos;
  XLSX.utils.book_append_sheet(wb, ws1, 'Asistencia');
  // Hoja 2 — solo la tabla de jornadas, con filtros, para ordenar o cruzar con la nómina
  const ws2 = XLSX.utils.aoa_to_sheet(jornadas);
  ws2['!cols'] = anchos;
  ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: jornadas.length - 1, c: ASIS_COLS_JORNADAS.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws2, 'Jornadas (tabla)');
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
<h2>Consolidado para nómina</h2><table><tr><th>Persona</th><th>Cédula</th><th>Rol</th><th>Jornadas</th><th>Completas</th><th>Sin salida</th><th>Horas trabajadas</th></tr>
${cons.map(p => `<tr><td>${escHtml(p.persona)}</td><td>${escHtml(p.cedula)}</td><td>${p.rol}</td><td class="n">${p.jornadas}</td><td class="n">${p.completas}</td><td class="n">${p.sin_salida}</td><td class="n">${_asisDur(p.minutos)}</td></tr>`).join('')}</table>
<h2>Jornadas</h2><table><tr><th>Persona</th><th>Cédula</th><th>Evento</th><th>Fecha de entrada</th><th>Hora de entrada</th><th>Fecha de salida</th><th>Hora de salida</th><th>Horas</th><th>Estado</th><th>Motivo salida manual</th></tr>
${filas.map(f => `<tr><td>${escHtml(f.persona)}</td><td>${escHtml(f.cedula)}</td><td>${escHtml(f.evento)}</td><td>${f.fecha_entrada}</td><td>${f.hora_entrada}</td><td>${f.fecha_salida || 'Sin salida'}</td><td>${f.hora_salida}</td><td class="n">${f.horas || '—'}</td><td>${escHtml(f.estado)}</td><td>${escHtml(f.motivo)}${f.registrada_por ? ' (' + escHtml(f.registrada_por) + ')' : ''}</td></tr>`).join('')}</table>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
