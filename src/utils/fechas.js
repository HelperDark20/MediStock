// Fecha 'YYYY-MM-DD' que existe en el calendario (año de 4 dígitos entre
// 1900 y 2100). Una fecha mal digitada (ej. "028-92-30") llegaba a la base
// de datos y fallaba con error 500; ahora se rechaza con un mensaje claro.
function fechaValida(txt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(txt || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d;
}

module.exports = { fechaValida };
