// Verifica que el panel de enfermero compatible (enfermero.html) siga
// funcionando en navegadores antiguos (Safari de iOS 9):
//   1. la sintaxis de sus scripts es ES5 válido;
//   2. no usa funciones que esos navegadores no tienen.
// Uso: npm run check:lite
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ARCHIVOS = ['js/lite/enfermero-lite.js', 'js/compat-check.js'];

// API ausentes en Safari 9 (iOS 9.3)
const PROHIBIDAS = [
  [/\bfetch\s*\(/, 'fetch (usar XMLHttpRequest)'],
  [/\.find(Index)?\s*\(/, 'Array.find / findIndex'],
  [/\.includes\s*\(/, 'includes'],
  [/\.(startsWith|endsWith|padStart|padEnd|replaceAll)\s*\(/, 'métodos de String de ES2015+'],
  [/\bObject\.(entries|values|assign|fromEntries)\b/, 'Object.entries / values / assign'],
  [/\bArray\.from\b/, 'Array.from'],
  [/\bIntl\b|timeZone\s*:/, 'Intl / timeZone'],
  [/\bURLSearchParams\b/, 'URLSearchParams'],
  [/classList\.toggle\s*\([^,)]+,/, 'classList.toggle con segundo argumento'],
];

let errores = 0;
for (const rel of ARCHIVOS) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  try {
    acorn.parse(codigo, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) {
    console.error(`✗ ${rel}: sintaxis no compatible con ES5 → ${e.message}`);
    errores++;
  }
  // Se ignoran los comentarios para no marcar la documentación
  // (conservando los saltos de línea para que los números de línea coincidan)
  const sinComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))
    .replace(/^[ \t]*\/\/.*$/gm, '');
  sinComentarios.split('\n').forEach((linea, i) => {
    for (const [re, nombre] of PROHIBIDAS) {
      if (re.test(linea)) {
        console.error(`✗ ${rel}:${i + 1}: usa ${nombre}, que no existe en Safari 9`);
        errores++;
      }
    }
  });
}

if (errores) {
  console.error(`\n${errores} problema(s): el panel compatible dejaría de funcionar en las tablets antiguas.`);
  process.exit(1);
}
console.log(`✓ ${ARCHIVOS.length} archivos compatibles con Safari 9 (ES5, sin API modernas)`);
