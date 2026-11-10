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

  // Stock de seguridad asignado directamente a cada depósito (máximo uno).
  // Reemplaza la asignación por patrón de palabras del nombre del depósito.
  'ALTER TABLE bodegas ADD COLUMN IF NOT EXISTS stock_seguridad_grupo_id INTEGER REFERENCES stock_seguridad_grupos(id)',

  // Edición de Sub-SKUs: fecha de creación (los existentes quedan sin ella)
  // y bitácora de quién cambió qué y cuándo.
  'ALTER TABLE sub_skus ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ',
  'ALTER TABLE sub_skus ALTER COLUMN created_at SET DEFAULT NOW()',
  `CREATE TABLE IF NOT EXISTS sub_sku_cambios (
     id SERIAL PRIMARY KEY,
     sub_sku_id INTEGER NOT NULL REFERENCES sub_skus(id),
     usuario_id INTEGER,
     usuario_nombre TEXT,
     cambios JSONB NOT NULL DEFAULT '{}'::jsonb,
     nota TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS sub_sku_cambios_sub_sku_idx ON sub_sku_cambios (sub_sku_id)',

  // Municipios de Colombia (DIVIPOLA del DANE) para la ubicación: la historia
  // clínica toma de ahí el municipio del lugar de atención. Los datos se
  // cargan desde src/data/municipios.json (ver _cargarMunicipios).
  `CREATE TABLE IF NOT EXISTS municipios (
     codigo TEXT PRIMARY KEY,
     nombre TEXT NOT NULL,
     departamento TEXT NOT NULL
   )`,
  'ALTER TABLE ubicaciones ADD COLUMN IF NOT EXISTS municipio_codigo TEXT REFERENCES municipios(codigo)',

  // Nivel 1 = Médico (antes "Auditor"): personal que se asigna a los eventos
  // para la historia clínica, sin contraseña ni acceso a la app. Su cédula
  // hace también de registro profesional.
  'ALTER TABLE usuarios ALTER COLUMN password_hash DROP NOT NULL',

  // Historia clínica prehospitalaria (panel de enfermero). La tablet la
  // diligencia (también sin conexión) y la envía al terminar; el servidor le
  // asigna el consecutivo HC-AAAA-NNNN al recibirla (sin huecos: el contador
  // avanza en la misma transacción que la inserción).
  //   client_id — id que genera la tablet; reenviar la misma HC no la duplica
  //   datos     — contenido de los módulos (paciente, motivo, antecedentes…)
  //   firmas    — imágenes PNG (data URL) de las firmas tomadas en la tablet
  //   paciente_* — copiados de datos para buscar y filtrar
  `CREATE TABLE IF NOT EXISTS historias_clinicas (
     id SERIAL PRIMARY KEY,
     client_id TEXT NOT NULL UNIQUE,
     anio INTEGER NOT NULL,
     numero INTEGER NOT NULL,
     consecutivo TEXT NOT NULL UNIQUE,
     estado TEXT NOT NULL CHECK (estado IN ('abierta', 'cerrada')),
     evento_id INTEGER REFERENCES eventos(id),
     ubicacion_id INTEGER REFERENCES ubicaciones(id),
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
     inicio_atencion TIMESTAMPTZ NOT NULL,
     paciente_tipo_doc TEXT,
     paciente_documento TEXT,
     paciente_nombre TEXT,
     datos JSONB NOT NULL,
     firmas JSONB NOT NULL DEFAULT '{}'::jsonb,
     recibida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (anio, numero)
   )`,
  'CREATE INDEX IF NOT EXISTS hc_paciente_idx ON historias_clinicas (paciente_tipo_doc, paciente_documento)',
  'CREATE INDEX IF NOT EXISTS hc_evento_idx ON historias_clinicas (evento_id)',
  'CREATE INDEX IF NOT EXISTS hc_inicio_idx ON historias_clinicas (inicio_atencion)',
  // Último número usado por año (el primero del año es 0000)
  'CREATE TABLE IF NOT EXISTS hc_consecutivos (anio INTEGER PRIMARY KEY, ultimo INTEGER NOT NULL)',
  // Rastro de cambios de las HC (módulo admin "Historias clínicas"): toda
  // edición, entrega del paciente, firma médica tomada después o archivo
  // adjunto queda registrado con quién, cuándo, motivo y valores antes/después
  `CREATE TABLE IF NOT EXISTS hc_cambios (
     id SERIAL PRIMARY KEY,
     hc_id INTEGER NOT NULL REFERENCES historias_clinicas(id),
     usuario_id INTEGER,
     usuario_nombre TEXT,
     accion TEXT NOT NULL,
     motivo TEXT,
     cambios JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS hc_cambios_hc_idx ON hc_cambios (hc_id)',
  // Archivos de la HC: foto o PDF del recibido de la IPS (máx. 5 MB)
  `CREATE TABLE IF NOT EXISTS hc_adjuntos (
     id SERIAL PRIMARY KEY,
     hc_id INTEGER NOT NULL REFERENCES historias_clinicas(id),
     tipo TEXT NOT NULL,
     nombre TEXT,
     mime TEXT NOT NULL,
     tamano INTEGER NOT NULL,
     contenido BYTEA NOT NULL,
     subido_por INTEGER,
     subido_por_nombre TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS hc_adjuntos_hc_idx ON hc_adjuntos (hc_id)',

  // Consumos registrados dentro de una HC (módulo 6): id de la HC en la tablet
  'ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS hc_client_id TEXT',
  'CREATE INDEX IF NOT EXISTS movimientos_hc_client_id_idx ON movimientos (hc_client_id) WHERE hc_client_id IS NOT NULL',

  // Asistencia de personal (/datacontrol)
  //   usuarios.pin_asistencia_*  — PIN de 4 dígitos (SHA-256 de "sal:pin")
  //   asistencia_cuentas         — cuenta de las tablets; sesiones_desde
  //                                invalida los tokens emitidos antes
  //   asistencia_jornadas        — una fila por jornada (entrada → salida)
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_asistencia_salt TEXT',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_asistencia_hash TEXT',
  `CREATE TABLE IF NOT EXISTS asistencia_cuentas (
     id SERIAL PRIMARY KEY,
     usuario TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     activo BOOLEAN NOT NULL DEFAULT true,
     sesiones_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS asistencia_jornadas (
     id SERIAL PRIMARY KEY,
     evento_id INTEGER NOT NULL REFERENCES eventos(id),
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
     estado TEXT NOT NULL CHECK (estado IN ('abierta', 'cerrada', 'sin_salida')),
     entrada_client_id TEXT NOT NULL UNIQUE,
     entrada_at TIMESTAMPTZ NOT NULL,
     entrada_recibida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     entrada_foto BYTEA,
     entrada_offline BOOLEAN NOT NULL DEFAULT false,
     salida_client_id TEXT UNIQUE,
     salida_at TIMESTAMPTZ,
     salida_recibida_at TIMESTAMPTZ,
     salida_foto BYTEA,
     salida_offline BOOLEAN NOT NULL DEFAULT false,
     salida_manual BOOLEAN NOT NULL DEFAULT false,
     salida_manual_por TEXT,
     salida_manual_motivo TEXT,
     salida_manual_at TIMESTAMPTZ,
     reloj_desfase_seg INTEGER,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Personal de cada evento para la asistencia: lo carga el admin desde un
  // archivo (nombre completo y cédula). El PIN es el final de la cédula.
  `CREATE TABLE IF NOT EXISTS asistencia_personal (
     id SERIAL PRIMARY KEY,
     evento_id INTEGER NOT NULL REFERENCES eventos(id),
     nombre TEXT NOT NULL,
     cedula TEXT NOT NULL,
     cargado_por TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (evento_id, cedula)
   )`,
  // Las jornadas pasan a ser del personal cargado (usuario_id queda para las
  // jornadas anteriores); cedula = quién marcó, para la regla de una sola
  // jornada abierta aunque la persona esté cargada en varios eventos
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS personal_id INTEGER REFERENCES asistencia_personal(id)',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS cedula TEXT',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS aviso_datos TEXT',
  'ALTER TABLE asistencia_jornadas ALTER COLUMN usuario_id DROP NOT NULL',
  'DROP INDEX IF EXISTS asistencia_una_abierta',
  "CREATE UNIQUE INDEX IF NOT EXISTS asistencia_una_abierta_cedula ON asistencia_jornadas (cedula) WHERE estado = 'abierta'",
  'CREATE INDEX IF NOT EXISTS asistencia_personal_idx ON asistencia_jornadas (personal_id)',
  'CREATE INDEX IF NOT EXISTS asistencia_evento_idx ON asistencia_jornadas (evento_id, entrada_at)',
  'CREATE INDEX IF NOT EXISTS asistencia_entrada_idx ON asistencia_jornadas (entrada_at)',
  // Asistencia v3: varias cuentas de tablets (se crean, editan y eliminan;
  // eliminar = activo false para conservar el rastro) y cada marca guarda la
  // IP, el dispositivo (identificador propio de cada tablet, con nombre que
  // le pone el admin) y la cuenta con que se hizo. Solo identifica: no bloquea.
  'ALTER TABLE asistencia_cuentas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
  'ALTER TABLE asistencia_cuentas ADD COLUMN IF NOT EXISTS ultimo_ingreso_at TIMESTAMPTZ',
  'ALTER TABLE asistencia_cuentas DROP CONSTRAINT IF EXISTS asistencia_cuentas_usuario_key',
  "CREATE UNIQUE INDEX IF NOT EXISTS asistencia_cuentas_usuario_activa ON asistencia_cuentas (usuario) WHERE activo = true",
  `CREATE TABLE IF NOT EXISTS asistencia_dispositivos (
     id SERIAL PRIMARY KEY,
     codigo TEXT NOT NULL UNIQUE,
     nombre TEXT,
     cuenta_id INTEGER REFERENCES asistencia_cuentas(id),
     primera_vez_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     ultima_vez_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     ultima_ip TEXT,
     navegador TEXT
   )`,
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS entrada_ip TEXT',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS salida_ip TEXT',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS entrada_dispositivo_id INTEGER REFERENCES asistencia_dispositivos(id)',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS salida_dispositivo_id INTEGER REFERENCES asistencia_dispositivos(id)',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS entrada_cuenta_id INTEGER REFERENCES asistencia_cuentas(id)',
  'ALTER TABLE asistencia_jornadas ADD COLUMN IF NOT EXISTS salida_cuenta_id INTEGER REFERENCES asistencia_cuentas(id)',

  // Novedades de la HC desde la tablet (signos, procedimientos, consumos,
  // evolución): el client_id evita aplicar dos veces la misma
  `CREATE TABLE IF NOT EXISTS hc_novedades (
     id SERIAL PRIMARY KEY,
     client_id TEXT NOT NULL UNIQUE,
     hc_id INTEGER NOT NULL REFERENCES historias_clinicas(id),
     usuario_id INTEGER REFERENCES usuarios(id),
     creada_at TIMESTAMPTZ,
     recibida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     contenido JSONB
   )`,

  // Registro de las migraciones que deben correr UNA sola vez
  'CREATE TABLE IF NOT EXISTS migraciones_aplicadas (nombre TEXT PRIMARY KEY, aplicada_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
];

// Migraciones de datos que corren una sola vez (quedan anotadas en
// migraciones_aplicadas). Repetirlas en cada arranque desharía cambios
// hechos después por los usuarios.
const MIGRACIONES_UNICAS = [
  {
    // Jornadas de asistencia anteriores al personal cargado: la cédula sale del usuario
    nombre: 'asistencia_cedula_desde_usuario',
    sql: `UPDATE asistencia_jornadas j SET cedula = us.cedula
          FROM usuarios us WHERE us.id = j.usuario_id AND j.cedula IS NULL`
  },
  {
    // Los antiguos auditores (nivel 1) pasan a ser médicos: pierden el acceso
    nombre: 'nivel1_medicos_sin_acceso',
    sql: 'UPDATE usuarios SET password_hash = NULL WHERE nivel = 1'
  },
  {
    // Cada depósito recibe el grupo que le correspondía por patrón: el más
    // específico (más palabras) cuyas palabras están todas en el nombre del
    // depósito — la misma regla que usaba el reporte. Así nada cambia el
    // día del despliegue; después se ajusta desde Ubicaciones.
    nombre: 'stock_seguridad_por_patron_a_deposito',
    sql: `UPDATE bodegas b SET stock_seguridad_grupo_id = (
            SELECT g.id FROM stock_seguridad_grupos g
            WHERE g.activo = true
              AND cardinality(g.patron_tokens) > 0
              AND g.patron_tokens::text[] <@ regexp_split_to_array(UPPER(b.nombre), '[[:space:]-]+')
            ORDER BY cardinality(g.patron_tokens) DESC, g.nombre
            LIMIT 1)
          WHERE b.activo = true AND b.stock_seguridad_grupo_id IS NULL`
  },
  {
    // Personal ya cargado en MAYÚSCULAS → "Carlos David Murcia Rodriguez".
    // En JavaScript (no initcap de Postgres) para que las tildes y la ñ
    // queden bien sin depender de la configuración regional de la base.
    nombre: 'asistencia_personal_nombre_propio',
    fn: async (client) => {
      const { normalizarNombre } = require('../utils/asistencia');
      const r = await client.query('SELECT id, nombre FROM asistencia_personal');
      for (const p of r.rows) {
        const n = normalizarNombre(p.nombre);
        if (n && n !== p.nombre) await client.query('UPDATE asistencia_personal SET nombre = $2 WHERE id = $1', [p.id, n]);
      }
    }
  },
];

// Lo informa GET /api/health, para comprobar tras desplegar que se aplicaron
const estado = { migraciones: 'pendiente' };

async function _aplicarUnaVez({ nombre, sql, fn }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ON CONFLICT: si dos procesos arrancan a la vez, solo uno la aplica
    const r = await client.query(
      'INSERT INTO migraciones_aplicadas (nombre) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nombre', [nombre]
    );
    if (r.rows.length) { if (fn) await fn(client); else await client.query(sql); }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Carga (o completa) la lista de municipios. Solo inserta los que falten,
// así que en cada arranque normal no hace nada.
async function _cargarMunicipios() {
  const lista = require('../data/municipios.json');
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM municipios');
  if (r.rows[0].n >= lista.length) return;
  await pool.query(
    `INSERT INTO municipios (codigo, nombre, departamento)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (codigo) DO NOTHING`,
    [lista.map(m => m[0]), lista.map(m => m[1]), lista.map(m => m[2])]
  );
}

// Texto del error aunque venga sin mensaje (p. ej. AggregateError de conexión)
function _textoError(err) {
  if (!err) return 'desconocido';
  return err.message || err.code ||
    (Array.isArray(err.errors) && err.errors.map(e => e.message || e.code).filter(Boolean).join('; ')) || String(err);
}

// Al reiniciar el hosting arrancan varios procesos a la vez: si uno no logra
// conectarse a la base o choca con otro, se reintenta (todo es idempotente)
const INTENTOS_MIGRACION = 4;
async function aplicarMigraciones() {
  for (let intento = 1; intento <= INTENTOS_MIGRACION; intento++) {
    try {
      for (const sql of MIGRACIONES) await pool.query(sql);
      await _cargarMunicipios();
      for (const m of MIGRACIONES_UNICAS) await _aplicarUnaVez(m);
      estado.migraciones = 'ok';
      console.log('Migraciones de base de datos al día');
      return;
    } catch (err) {
      const texto = _textoError(err);
      if (intento < INTENTOS_MIGRACION) {
        console.error(`Migraciones: intento ${intento} falló (${texto}); se reintenta`);
        await new Promise(r => setTimeout(r, 3000 * intento));
        continue;
      }
      estado.migraciones = 'error: ' + texto;
      // No se detiene el servidor (el resto de la app sigue funcionando), pero
      // el registro de consumos usa estas columnas y FALLARÁ hasta corregirlo.
      // Se ve en GET /api/health y en el log.
      console.error('ERROR aplicando migraciones (los consumos fallarán hasta corregirlo):', texto);
    }
  }
}

module.exports = { aplicarMigraciones, estado };
