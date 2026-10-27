const pool = require('./db');

// Cambios de esquema que el servidor aplica al arrancar. Todos son
// idempotentes (IF NOT EXISTS): repetirlos no hace nada. Se ejecutan aquí
// para no depender de que alguien corra el SQL a mano en cada entorno.
//
// Modo offline del panel de enfermero:
//   client_id       — id único que genera la tablet para cada consumo; evita
//                     registrar dos veces el mismo consumo si se reintenta.
//   es_offline      — el consumo se registró sin conexión y se sincronizó después.
//   sincronizado_at — cuándo llegó al servidor (created_at también lo refleja;
//                     la hora real de atención va en fecha_atencion).
//
// Ubicaciones temporales:
//   ubicaciones.es_temporal    — ubicación creada para un evento (ej. un teatro).
//   ubicaciones.finalizada_at  — cuándo se finalizó; queda inactiva pero sigue
//                                disponible en los filtros de Reportes.
//   bodegas.ubicacion_origen_id — sede permanente a la que vuelve un depósito
//                                prestado a una ubicación temporal (NULL = en casa).
//
// Ubicación del movimiento:
//   movimientos.ubicacion_origen_id / ubicacion_destino_id — ubicación en la que
//   estaba cada depósito AL MOMENTO del movimiento. Antes los reportes la
//   calculaban con la ubicación actual del depósito, así que al devolver un
//   depósito prestado sus consumos "se mudaban" a la sede de origen. Un
//   trigger las llena en cada INSERT; los movimientos anteriores se completan
//   con la ubicación actual de su depósito (la única que se conocía).
const MIGRACIONES = [
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS client_id TEXT',
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS es_offline BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS sincronizado_at TIMESTAMPTZ',
  'CREATE UNIQUE INDEX IF NOT EXISTS movimientos_client_id_key ON movimientos (client_id) WHERE client_id IS NOT NULL',

  'ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS es_temporal BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS finalizada_at TIMESTAMPTZ',
  'ALTER TABLE bodegas ADD COLUMN IF NOT EXISTS ubicacion_origen_id INTEGER REFERENCES ubicaciones(id)',

  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS ubicacion_origen_id INTEGER',
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS ubicacion_destino_id INTEGER',
  `CREATE OR REPLACE FUNCTION movimientos_fijar_ubicacion() RETURNS trigger AS $$
   BEGIN
     IF NEW.bodega_origen_id IS NOT NULL AND NEW.ubicacion_origen_id IS NULL THEN
       SELECT ubicacion_id INTO NEW.ubicacion_origen_id FROM bodegas WHERE id = NEW.bodega_origen_id;
     END IF;
     IF NEW.bodega_destino_id IS NOT NULL AND NEW.ubicacion_destino_id IS NULL THEN
       SELECT ubicacion_id INTO NEW.ubicacion_destino_id FROM bodegas WHERE id = NEW.bodega_destino_id;
     END IF;
     RETURN NEW;
   END
   $$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS movimientos_fijar_ubicacion ON movimientos',
  `CREATE TRIGGER movimientos_fijar_ubicacion BEFORE INSERT ON movimientos
   FOR EACH ROW EXECUTE PROCEDURE movimientos_fijar_ubicacion()`,
  `UPDATE movimientos m SET ubicacion_origen_id = b.ubicacion_id
   FROM bodegas b WHERE m.bodega_origen_id = b.id AND m.ubicacion_origen_id IS NULL`,
  `UPDATE movimientos m SET ubicacion_destino_id = b.ubicacion_id
   FROM bodegas b WHERE m.bodega_destino_id = b.id AND m.ubicacion_destino_id IS NULL`,
  'CREATE INDEX IF NOT EXISTS movimientos_ubicacion_origen_idx ON movimientos (ubicacion_origen_id)',
];

// Lo informa GET /api/health, para comprobar tras desplegar que se aplicaron
const estado = { migraciones: 'pendiente' };

async function aplicarMigraciones() {
  try {
    for (const sql of MIGRACIONES) await pool.query(sql);
    estado.migraciones = 'ok';
    console.log('Migraciones de base de datos al día');
  } catch (err) {
    estado.migraciones = 'error: ' + err.message;
    // No se detiene el servidor (el resto de la app sigue funcionando), pero
    // el registro de consumos usa estas columnas y FALLARÁ hasta corregirlo.
    // Se ve en GET /api/health y en el log.
    console.error('ERROR aplicando migraciones (los consumos fallarán hasta corregirlo):', err.message);
  }
}

module.exports = { aplicarMigraciones, estado };
