// Validaciones de entrada compartidas por las rutas. Un dato mal formado
// (un id con letras, un nombre que no es texto) llegaba a la base de datos y
// fallaba con error 500; ahora se rechaza antes con un 400 y un mensaje claro.

const MAX_INT = 2147483647;   // tope de una columna INTEGER de PostgreSQL

// Id de la base de datos: entero positivo, como número o como texto ("12").
// Devuelve el número o null si no es válido.
function idValido(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v <= MAX_INT ? v : null;
  if (typeof v === 'string' && /^\d{1,10}$/.test(v)) {
    const n = Number(v);
    return n > 0 && n <= MAX_INT ? n : null;
  }
  return null;
}

// Lista de ids → números sin repetir, o null si alguno no es válido
function idsValidos(lista) {
  if (!Array.isArray(lista)) return null;
  const ids = lista.map(idValido);
  return ids.includes(null) ? null : [...new Set(ids)];
}

// Rechaza con 400 las rutas cuyo parámetro de URL (ej. :id) no es un id
function validarParamsId(router, ...nombres) {
  nombres.forEach(nombre => router.param(nombre, (req, res, next, valor) => {
    if (!idValido(valor)) return res.status(400).json({ error: 'Identificador inválido' });
    next();
  }));
}

// Texto recortado; '' si no es un string (ej. un número o un objeto)
function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

module.exports = { idValido, idsValidos, validarParamsId, texto };
