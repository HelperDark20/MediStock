// Asistencia de personal (/datacontrol): PIN, fechas en hora de Colombia y
// cálculo de jornadas. La tablet repite estas reglas para trabajar sin
// conexión (js/lite/datacontrol-lite.js): si se cambia una, cambiar la otra.

// Una jornada (entrada → salida) dura como máximo 16 horas. Pasado ese
// plazo sin salida queda "sin salida" y la salida la registra el administrador.
const MAX_JORNADA_MS = 16 * 3600 * 1000;
// La salida manual del administrador admite hasta 24 h después de la entrada
const MAX_SALIDA_MANUAL_MS = 24 * 3600 * 1000;
// Reloj de la tablet: diferencia con el servidor que se tolera sin corregir
const TOLERANCIA_RELOJ_MS = 2 * 60 * 1000;
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;

// PIN = últimos 4 dígitos de la cédula (decisión del cliente). La protección
// contra la suplantación es la foto de cada marca.
function pinValido(pin) { return typeof pin === 'string' && /^\d{4}$/.test(pin); }
function pinDeCedula(cedula) { return String(cedula || '').slice(-4); }
function pinCoincide(cedula, pin) { return pinValido(pin) && pinDeCedula(cedula) === pin; }

// Cédula del archivo de personal: solo dígitos (se quitan puntos, comas,
// guiones y espacios). Entre 5 y 15 dígitos.
function normalizarCedula(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\s.,'-]/g, '');
  return /^\d{5,15}$/.test(s) ? s : null;
}
// Nombre completo: espacios simples, cada nombre y apellido con la primera
// letra en mayúscula y el resto en minúscula (Carlos David Murcia Rodriguez),
// máx. 120 caracteres
function nombrePropio(s) {
  return String(s).toLocaleLowerCase('es').replace(/(^|[\s'-])(\p{L})/gu, (m, sep, letra) => sep + letra.toLocaleUpperCase('es'));
}
function normalizarNombre(v) {
  const s = nombrePropio(String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim()).slice(0, 120);
  return s.length >= 3 ? s : null;
}

// Versión del aviso de protección de datos que muestra la tablet; queda
// guardada en cada marca como evidencia de qué texto se mostró
const AVISO_DATOS_VERSION = 'ley1581-v2-2026-11-09';

// Fecha AAAA-MM-DD en hora de Colombia
function fechaCO(d) {
  return new Date(new Date(d).getTime() - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10);
}
// "AAAA-MM-DD" + "HH:MM" en hora de Colombia → Date
function desdeCO(fecha, hora) {
  return new Date(`${fecha}T${hora}:00-05:00`);
}
// Fecha y hora legibles en Colombia: 11/07/2026 18:02
function fechaHoraCO(d) {
  const iso = new Date(new Date(d).getTime() - COLOMBIA_OFFSET_MS).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}
// Minutos trabajados → "9 h 08 min"
function textoDuracion(min) {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} h ${m < 10 ? '0' : ''}${m} min`;
}
function minutosEntre(desde, hasta) {
  return Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60000);
}

// Foto que manda la tablet (data URL JPEG o PNG, máx. ~200 KB) → Buffer
const MAX_FOTO = 200 * 1024;
function fotoDesdeDataUrl(v) {
  if (typeof v !== 'string' || v.length > MAX_FOTO * 1.4) return null;
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+=*)$/.exec(v);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_FOTO) return null;
  const esJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const esPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  return esJpeg || esPng ? buf : null;
}
function mimeFoto(buf) {
  return buf && buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
}

// Un evento no se puede finalizar (ni eliminar) mientras tenga personal en
// turno. Devuelve el mensaje de error, o null si no hay nadie en turno.
// (Los turnos de más de 16 h ya no cuentan: quedan "sin salida".)
async function bloqueoPorTurnosAbiertos(db, eventoId, accion) {
  const r = await db.query(
    `SELECT COALESCE(p.nombre, us.nombre) AS persona
     FROM asistencia_jornadas j
     LEFT JOIN asistencia_personal p ON p.id = j.personal_id
     LEFT JOIN usuarios us ON us.id = j.usuario_id
     WHERE j.evento_id = $1 AND j.estado = 'abierta' AND j.entrada_at > NOW() - INTERVAL '16 hours'
     ORDER BY 1`, [eventoId]);
  const n = r.rows.length;
  if (!n) return null;
  const nombres = r.rows.slice(0, 5).map(x => x.persona).join(', ') + (n > 5 ? ` y ${n - 5} más` : '');
  return `No se puede ${accion} el evento: ${n === 1 ? 'hay 1 persona' : `hay ${n} personas`} en turno (${nombres}). ` +
    'Deben marcar salida en la tablet, o registra la salida en Asistencias → "Registrar salida".';
}

module.exports = {
  bloqueoPorTurnosAbiertos,
  MAX_JORNADA_MS, MAX_SALIDA_MANUAL_MS, TOLERANCIA_RELOJ_MS, AVISO_DATOS_VERSION,
  pinValido, pinDeCedula, pinCoincide, normalizarCedula, normalizarNombre, nombrePropio,
  fechaCO, desdeCO, fechaHoraCO, textoDuracion, minutosEntre,
  fotoDesdeDataUrl, mimeFoto
};
