// Puntos de atención de un evento (CARPA 1, PUERTA 3…)

// Nombre normalizado: sin espacios de más, en MAYÚSCULAS y hasta 80 caracteres
function normalizarPunto(nombre) {
  return String(nombre || '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80);
}

// Médico responsable de las historias clínicas que diligencia un enfermero:
// el médico de su punto de atención. Si el punto no tiene médico, nadie (la
// atención queda a cargo del enfermero). Un enfermero sin punto (eventos
// anteriores a los puntos) toma el médico del evento si hay exactamente uno.
//   medicos: médicos del evento [{ id, nombre, cedula }]
//   asignacion: { punto_id, medico_id } del enfermero (medico_id = el del punto)
function medicoDelPunto(medicos, asignacion) {
  const a = asignacion || {};
  if (a.punto_id) return a.medico_id ? (medicos.find(m => m.id === a.medico_id) || null) : null;
  return medicos.length === 1 ? medicos[0] : null;
}

module.exports = { normalizarPunto, medicoDelPunto };
