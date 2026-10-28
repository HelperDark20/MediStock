const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
  // Si la base de datos no responde, fallar en 10 s con un error claro en
  // vez de dejar la solicitud colgada
  connectionTimeoutMillis: 10000,
  // Cerrar conexiones inactivas antes de que las corte el servidor de BD
  idleTimeoutMillis: 30000
});

// Sin este manejador, una conexión inactiva que el servidor de BD corta
// (reinicio, red, tiempo de espera) emite 'error' y TUMBA el proceso de
// Node: la app se reinicia y mientras tanto todas las solicitudes fallan.
pool.on('error', err => {
  console.error('Conexión de base de datos inactiva perdida (se reconecta sola):', err.message);
});

module.exports = pool;