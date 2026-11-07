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

// Filtros: eventos (todos los del panel) y personas (médicos y enfermeros)
function _asisLlenarFiltros(){
  const ev = document.getElementById('asis-evento');
  const per = document.getElementById('asis-persona');
  const evActual = ev.value, perActual = per.value;
  ev.innerHTML = '<option value="">Todos los eventos</option>' + (S.eventos || []).map(e =>
    `<option value="${e.id}">${escHtml(e.nombre)} (${fmtDate(e.fecha_inicio)} → ${fmtDate(e.fecha_fin)})</option>`).join('');
  per.innerHTML = '<option value="">Todas las personas</option>' + (S.usuarios || []).filter(u => u.nivel === 1 || u.nivel === 2)
    .map(u => `<option value="${u.id}">${escHtml(u.nombre)}</option>`).join('');
  if(evActual) ev.value = evActual;
  else {
    const enCurso = (S.eventos || []).find(e => e.estado === 'en_curso');
    if(enCurso) ev.value = enCurso.id;
  }
  if(perActual) per.value = perActual;
}

async function renderAsistencia(){
  if(!S.usuarios || !S.usuarios.length){ try { S.usuarios = await Usuarios.getAll(); } catch(e){} }
  _asisLlenarFiltros();
  await asisBuscar();
}

function _asisFiltros(){
  return {
    evento_id: document.getElementById('asis-evento').value,
    usuario_id: document.getElementById('asis-persona').value,
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
    (resumen.personas_asignadas !== null && resumen.personas_asignadas !== undefined ? st('modulos/usuarios.png', resumen.personas_asignadas, 'Personas asignadas') : st('modulos/usuarios.png', new Set(jornadas.map(j => j.usuario_id)).size, 'Personas con jornadas')) +
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
      <td data-label="Persona"><div class="asis-persona"><img src="${avatarNivel(j.nivel)}" alt=""><div><b>${escHtml(j.persona)}</b><div class="asis-sub">CC ${escHtml(j.cedula)}</div></div></div></td>
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
  ['asis-desde','asis-hasta','asis-estado','asis-persona'].forEach(id => document.getElementById(id).value = '');
  asisBuscar();
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
function _asisFilasExport(){
  return _asisDatos.jornadas.slice().reverse().map(j => ({
    persona: j.persona, cedula: j.cedula, rol: j.nivel === 1 ? 'Médico' : 'Enfermero/a', evento: j.evento,
    entrada: _asisFechaCO(j.entrada_at), salida: _asisFechaCO(j.salida_at), minutos: j.minutos,
    horas: j.minutos !== null && j.minutos !== undefined ? _asisDur(j.minutos) : '',
    estado: _asisEstado(j)[0], motivo: j.salida_manual ? (j.salida_manual_motivo || '') : ''
  }));
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
  const j = [['Persona','Cédula','Rol','Evento','Entrada','Salida','Minutos','Horas trabajadas','Estado','Motivo salida manual']]
    .concat(filas.map(f => [f.persona, f.cedula, f.rol, f.evento, f.entrada, f.salida, f.minutos === null ? '' : f.minutos, f.horas, f.estado, f.motivo]));
  const c = [['Persona','Cédula','Rol','Jornadas','Completas','Sin salida','Minutos','Horas trabajadas']]
    .concat(_asisConsolidado(filas).map(p => [p.persona, p.cedula, p.rol, p.jornadas, p.completas, p.sin_salida, p.minutos, _asisDur(p.minutos)]));
  const wb = XLSX.utils.book_new();
  const titulo = [[`Asistencia de personal — ${_asisTituloPeriodo()}`], [`Generado el ${_asisFechaCO(new Date().toISOString())}`], []];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(titulo.concat(c)), 'Consolidado nómina');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(titulo.concat(j)), 'Jornadas');
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
<h2>Jornadas</h2><table><tr><th>Persona</th><th>Evento</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Estado</th><th>Motivo salida manual</th></tr>
${filas.map(f => `<tr><td>${escHtml(f.persona)}</td><td>${escHtml(f.evento)}</td><td>${f.entrada}</td><td>${f.salida || '—'}</td><td class="n">${f.horas || '—'}</td><td>${escHtml(f.estado)}</td><td>${escHtml(f.motivo)}</td></tr>`).join('')}</table>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
