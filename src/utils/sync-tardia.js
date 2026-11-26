// ══════════════════════════════════════════
// SINCRONIZACIÓN TARDÍA DE UN EVENTO FINALIZADO
// El administrador la habilita con un motivo y por unas horas cuando quedó
// información en las tablets que no se pudo subir (p. ej. atenciones
// registradas sin conexión después del cierre). Mientras esté abierta, el
// servidor acepta lo que llega por SINCRONIZAR (atenciones fugaces y
// consumos guardados en la tablet) aunque la atención sea posterior al
// cierre. El evento sigue finalizado: no reaparece en las tablets y no se
// puede registrar nada nuevo en línea.
// ══════════════════════════════════════════

// Condición SQL: el evento con alias "e" tiene una ventana abierta
const SQL_VENTANA_ABIERTA = `EXISTS (SELECT 1 FROM evento_sync_tardia vst
  WHERE vst.evento_id = e.id AND vst.cerrada_at IS NULL AND vst.hasta > NOW())`;

// Opciones de duración (horas) que ofrece el panel admin
const HORAS_PERMITIDAS = [6, 12, 24, 48, 72];

// Fecha y hora de Colombia para los mensajes (dd/mm/aaaa h:mm a. m.)
function fechaHoraCO(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

module.exports = { SQL_VENTANA_ABIERTA, HORAS_PERMITIDAS, fechaHoraCO };
