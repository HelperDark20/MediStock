// Asistencia de personal (/datacontrol): PIN, fechas en hora de Colombia y
// cálculo de jornadas. La tablet repite estas reglas para trabajar sin
// conexión (js/lite/datacontrol-lite.js): si se cambia una, cambiar la otra.
const crypto = require('crypto');

// Una jornada (entrada → salida) dura como máximo 16 horas. Pasado ese
// plazo sin salida queda "sin salida" y la salida la registra el administrador.
const MAX_JORNADA_MS = 16 * 3600 * 1000;
// La salida manual del administrador admite hasta 24 h después de la entrada
const MAX_SALIDA_MANUAL_MS = 24 * 3600 * 1000;
// Reloj de la tablet: diferencia con el servidor que se tolera sin corregir
const TOLERANCIA_RELOJ_MS = 2 * 60 * 1000;
const COLOMBIA_OFFSET_MS = 5 * 3600 * 1000;

// PIN de 4 dígitos: se guarda como SHA-256 de "sal:pin". La tablet recibe la
// sal y el hash del personal de sus eventos para validar sin conexión.
function pinValido(pin) { return typeof pin === 'string' && /^\d{4}$/.test(pin); }
function nuevaSal() { return crypto.randomBytes(8).toString('hex'); }
function hashPin(sal, pin) { return crypto.createHash('sha256').update(`${sal}:${pin}`).digest('hex'); }
function pinCoincide(sal, hash, pin) {
  if (!sal || !hash || !pinValido(pin)) return false;
  const a = Buffer.from(hashPin(sal, pin), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

module.exports = {
  MAX_JORNADA_MS, MAX_SALIDA_MANUAL_MS, TOLERANCIA_RELOJ_MS,
  pinValido, nuevaSal, hashPin, pinCoincide,
  fechaCO, desdeCO, fechaHoraCO, textoDuracion, minutosEntre,
  fotoDesdeDataUrl, mimeFoto
};
