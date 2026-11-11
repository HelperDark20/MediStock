// Cálculos del reporte de atenciones (src/routes/hc.js GET /api/hc/reporte)

// Jornada de la atención respecto a las horas del evento: PRE (antes del
// inicio), IN (durante) o POST (después del fin). Las horas aplican a todos
// los días del evento; si la final es menor que la inicial el evento pasa la
// medianoche (una atención a la 1:00 del día siguiente es IN).
function jornada(fecha, hora, ev) {
  if (!ev || !/^\d\d:\d\d$/.test(ev.hora_inicio || '') || !/^\d\d:\d\d$/.test(ev.hora_fin || '')) return '';
  const min = hm => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
  const t = min(hora), a = min(ev.hora_inicio), b = min(ev.hora_fin);
  const antesDelEvento = ev.fecha_inicio && fecha < ev.fecha_inicio;
  const despuesDelEvento = ev.fecha_fin && fecha > ev.fecha_fin;
  if (a < b) {   // mismo día
    if (antesDelEvento) return 'PRE';
    if (despuesDelEvento) return 'POST';
    return t < a ? 'PRE' : (t <= b ? 'IN' : 'POST');
  }
  // Pasa la medianoche: la madrugada pertenece a la jornada del día anterior
  if (t <= b) {
    if (antesDelEvento || fecha === ev.fecha_inicio) return 'PRE';
    const ayer = new Date(new Date(fecha + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    return ev.fecha_fin && ayer > ev.fecha_fin ? 'POST' : 'IN';
  }
  if (antesDelEvento) return 'PRE';
  if (despuesDelEvento) return 'POST';
  if (t >= a) return 'IN';
  // Entre el fin de la madrugada y el inicio de la noche: lo más cercano
  return fecha > ev.fecha_inicio && (t - b) < (a - t) ? 'POST' : 'PRE';
}

// Edad: años; en menores de 1 año, meses (o días si no alcanza un mes)
function edadReporte(edad) {
  if (!edad) return { texto: '', anios: null };
  if (edad.anios >= 1) return { texto: edad.anios, anios: edad.anios };
  if (edad.meses >= 1) return { texto: `${edad.meses} ${edad.meses === 1 ? 'mes' : 'meses'}`, anios: 0 };
  return { texto: `${edad.dias || 0} ${edad.dias === 1 ? 'día' : 'días'}`, anios: 0 };
}
function rangoEdad(anios) {
  if (anios === null || anios === undefined) return '';
  if (anios <= 5) return 'Primera infancia';
  if (anios <= 11) return 'Infancia';
  if (anios <= 17) return 'Adolescencia';
  if (anios <= 26) return 'Juventud';
  if (anios <= 59) return 'Adultez';
  return 'Persona mayor';
}

// "18:05" o "18:05:09" (24 h) → "06:05:09 PM"
function hora12(hms) {
  const m = /^(\d\d):(\d\d)(?::(\d\d))?$/.exec(String(hms || ''));
  if (!m) return '';
  const h = +m[1];
  return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]}:${m[3] || '00'} ${h < 12 ? 'AM' : 'PM'}`;
}

module.exports = { jornada, edadReporte, rangoEdad, hora12 };
