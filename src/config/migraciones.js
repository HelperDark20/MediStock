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
const MIGRACIONES = [
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS client_id TEXT',
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS es_offline BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS sincronizado_at TIMESTAMPTZ',
  'CREATE UNIQUE INDEX IF NOT EXISTS movimientos_client_id_key ON movimientos (client_id) WHERE client_id IS NOT NULL',
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
