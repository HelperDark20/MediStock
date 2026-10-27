const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// Ubicaciones PERMANENTES: las sedes de siempre.
// Ubicaciones TEMPORALES: se crean para un evento fuera de sede (ej. un
// teatro) y reciben depósitos prestados de las permanentes. Mientras están
// activas funcionan como cualquier ubicación (eventos, consumos, reportes).
// Al finalizarlas, cada depósito vuelve a su sede con el stock que le quede
// y la temporal queda inactiva, visible solo en los filtros de Reportes.

const ESTADOS_EVENTO_ABIERTO = "('creado','en_curso')";

// Una temporal finalizada no bloquea el nombre: el mismo teatro puede
// volver a usarse en otro evento más adelante.
async function _nombreOcupado(nombreUpper, excluirId = null) {
  const r = await pool.query(
    `SELECT id FROM ubicaciones
     WHERE UPPER(nombre) = $1 AND ($2::int IS NULL OR id <> $2)
       AND NOT (es_temporal AND finalizada_at IS NOT NULL)`,
    [nombreUpper, excluirId]
  );
  return r.rows.length > 0;
}

function _idsValidos(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map(v => parseInt(v)).filter(n => n > 0))];
}

// Bloquea la fila de la temporal y comprueba que siga activa
async function _temporalActiva(client, id) {
  const r = await client.query(
    'SELECT * FROM ubicaciones WHERE id = $1 AND activo = true AND es_temporal = true FOR UPDATE',
    [id]
  );
  return r.rows[0] || null;
}

// Mueve depósitos de sedes permanentes a una temporal. Cada depósito debe
// estar en su sede (no prestado ya) y no estar asignado a un evento abierto.
// Lanza { status, error } si alguno no se puede mover; no mueve ninguno.
async function _prestarDepositos(client, temporalId, bodegaIds) {
  const disponibles = await client.query(
    `SELECT b.id, b.nombre FROM bodegas b
     JOIN ubicaciones u ON u.id = b.ubicacion_id
     WHERE b.id = ANY($1::int[]) AND b.activo = true AND b.ubicacion_origen_id IS NULL
       AND u.activo = true AND u.es_temporal = false
     FOR UPDATE OF b`,
    [bodegaIds]
  );
  if (disponibles.rows.length !== bodegaIds.length) {
    throw { status: 400, error: 'Alguno de los depósitos ya no está disponible (fue prestado o eliminado). Recarga e intenta de nuevo.' };
  }
  const enEvento = await client.query(
    `SELECT DISTINCT b.nombre AS bodega, e.nombre AS evento
     FROM evento_usuario_bodegas eub
     JOIN eventos e ON e.id = eub.evento_id
     JOIN bodegas b ON b.id = eub.bodega_id
     WHERE eub.bodega_id = ANY($1::int[]) AND e.activo = true AND e.estado IN ${ESTADOS_EVENTO_ABIERTO}`,
    [bodegaIds]
  );
  if (enEvento.rows.length) {
    const detalle = enEvento.rows.map(r => `${r.bodega} (evento ${r.evento})`).join(', ');
    throw { status: 400, error: `Estos depósitos están asignados a un evento abierto: ${detalle}` };
  }
  await client.query(
    `UPDATE bodegas SET ubicacion_origen_id = ubicacion_id, ubicacion_id = $1
     WHERE id = ANY($2::int[])`,
    [temporalId, bodegaIds]
  );
}

// GET /api/ubicaciones — todos los niveles. Solo las activas (permanentes y
// temporales en curso). Con ?incluir_finalizadas=1 también trae las
// temporales finalizadas, para los filtros de Reportes.
router.get('/', verificarToken, async (req, res) => {
  const incluirFinalizadas = req.query.incluir_finalizadas === '1';
  try {
    const result = await pool.query(`
      SELECT u.*,
             COUNT(b.id) FILTER (WHERE b.activo = true) AS total_depositos
      FROM ubicaciones u
      LEFT JOIN bodegas b ON b.ubicacion_id = u.id
      WHERE u.activo = true ${incluirFinalizadas ? 'OR (u.es_temporal AND u.finalizada_at IS NOT NULL)' : ''}
      GROUP BY u.id
      ORDER BY u.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/ubicaciones/depositos-prestables — nivel 4 — depósitos de las
// sedes permanentes que se pueden prestar a una temporal. Los que están en
// un evento abierto vienen con evento_nombre (se muestran deshabilitados).
router.get('/depositos-prestables', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.nombre, b.ubicacion_id, u.nombre AS ubicacion_nombre,
             (SELECT e.nombre FROM evento_usuario_bodegas eub
              JOIN eventos e ON e.id = eub.evento_id
              WHERE eub.bodega_id = b.id AND e.activo = true AND e.estado IN ${ESTADOS_EVENTO_ABIERTO}
              ORDER BY e.fecha_inicio LIMIT 1) AS evento_nombre
      FROM bodegas b
      JOIN ubicaciones u ON u.id = b.ubicacion_id
      WHERE b.activo = true AND b.ubicacion_origen_id IS NULL
        AND u.activo = true AND u.es_temporal = false
      ORDER BY u.nombre, b.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/ubicaciones — nivel 4
// body: { nombre, es_temporal?, bodega_ids? } — bodega_ids solo para temporales
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre } = req.body;
  const esTemporal = req.body.es_temporal === true;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const nombreUpper = String(nombre).trim().toUpperCase();
  const bodegaIds = esTemporal ? _idsValidos(req.body.bodega_ids) : [];

  const client = await pool.connect();
  try {
    if (await _nombreOcupado(nombreUpper)) {
      return res.status(400).json({ error: 'Esta ubicación ya existe' });
    }
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO ubicaciones (nombre, es_temporal) VALUES ($1, $2) RETURNING *', [nombreUpper, esTemporal]
    );
    if (bodegaIds.length) await _prestarDepositos(client, result.rows[0].id, bodegaIds);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.error });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/ubicaciones/:id/depositos — nivel 4 — presta más depósitos a
// una temporal activa. body: { bodega_ids: [...] }
router.post('/:id/depositos', verificarToken, verificarNivel(4), async (req, res) => {
  const bodegaIds = _idsValidos(req.body.bodega_ids);
  if (!bodegaIds.length) return res.status(400).json({ error: 'Selecciona al menos un depósito' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await _temporalActiva(client, req.params.id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ubicación temporal no encontrada o ya finalizada' });
    }
    await _prestarDepositos(client, req.params.id, bodegaIds);
    await client.query('COMMIT');
    res.json({ mensaje: 'Depósitos agregados' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.error });
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/ubicaciones/:id/depositos/:bodegaId/devolver — nivel 4 — devuelve
// un depósito prestado a su sede de origen (con el stock que tenga).
router.post('/:id/depositos/:bodegaId/devolver', verificarToken, verificarNivel(4), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await _temporalActiva(client, req.params.id)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ubicación temporal no encontrada o ya finalizada' });
    }
    const bodega = await client.query(
      `SELECT id, nombre FROM bodegas
       WHERE id = $1 AND ubicacion_id = $2 AND ubicacion_origen_id IS NOT NULL FOR UPDATE`,
      [req.params.bodegaId, req.params.id]
    );
    if (!bodega.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ese depósito no está prestado a esta ubicación' });
    }
    const enEvento = await client.query(
      `SELECT e.nombre FROM evento_usuario_bodegas eub
       JOIN eventos e ON e.id = eub.evento_id
       WHERE eub.bodega_id = $1 AND e.activo = true AND e.estado IN ${ESTADOS_EVENTO_ABIERTO} LIMIT 1`,
      [req.params.bodegaId]
    );
    if (enEvento.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No se puede devolver: está asignado al evento abierto "${enEvento.rows[0].nombre}". Quítalo del evento o finaliza el evento primero.` });
    }
    await client.query(
      'UPDATE bodegas SET ubicacion_id = ubicacion_origen_id, ubicacion_origen_id = NULL WHERE id = $1',
      [req.params.bodegaId]
    );
    await client.query('COMMIT');
    res.json({ mensaje: `${bodega.rows[0].nombre} devuelto a su ubicación de origen` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/ubicaciones/:id/finalizar — nivel 4 — devuelve todos los
// depósitos a su origen y cierra la temporal. No se permite con eventos
// creados o en curso en esa ubicación.
router.post('/:id/finalizar', verificarToken, verificarNivel(4), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const temporal = await _temporalActiva(client, req.params.id);
    if (!temporal) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ubicación temporal no encontrada o ya finalizada' });
    }
    const abiertos = await client.query(
      `SELECT nombre FROM eventos
       WHERE ubicacion_id = $1 AND activo = true AND estado IN ${ESTADOS_EVENTO_ABIERTO}
       ORDER BY fecha_inicio`,
      [req.params.id]
    );
    if (abiertos.rows.length) {
      await client.query('ROLLBACK');
      const nombres = abiertos.rows.map(r => `"${r.nombre}"`).join(', ');
      return res.status(400).json({ error: `No se puede finalizar: tiene eventos abiertos (${nombres}). Finalízalos o elimínalos primero.` });
    }
    const devueltos = await client.query(
      `UPDATE bodegas SET ubicacion_id = ubicacion_origen_id, ubicacion_origen_id = NULL
       WHERE ubicacion_id = $1 AND ubicacion_origen_id IS NOT NULL RETURNING id`,
      [req.params.id]
    );
    await client.query(
      'UPDATE ubicaciones SET activo = false, finalizada_at = NOW() WHERE id = $1', [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ mensaje: `Ubicación ${temporal.nombre} finalizada`, depositos_devueltos: devueltos.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// PUT /api/ubicaciones/:id — nivel 4 — renombrar. Todo lo demás (depósitos,
// eventos, usuarios) referencia la ubicación por id, así que no se rompe nada.
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const nombreUpper = String(nombre).trim().toUpperCase();
  try {
    if (await _nombreOcupado(nombreUpper, parseInt(req.params.id) || 0)) {
      return res.status(400).json({ error: 'Ya existe una ubicación con ese nombre' });
    }
    const result = await pool.query(
      'UPDATE ubicaciones SET nombre = $1 WHERE id = $2 AND activo = true RETURNING *', [nombreUpper, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ubicación no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/ubicaciones/:id — nivel 4
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const ub = await pool.query('SELECT es_temporal FROM ubicaciones WHERE id = $1', [req.params.id]);
    // Verificar que no tenga depósitos activos
    const depositos = await pool.query(
      'SELECT COUNT(*) FROM bodegas WHERE ubicacion_id = $1 AND activo = true', [req.params.id]
    );
    if (parseInt(depositos.rows[0].count) > 0) {
      return res.status(400).json({
        error: ub.rows[0]?.es_temporal
          ? 'Esta ubicación temporal tiene depósitos prestados. Usa "Finalizar" para devolverlos.'
          : 'Elimina primero todos los depósitos de esta ubicación'
      });
    }
    // Una temporal con movimientos se finaliza (sigue en Reportes); si se
    // eliminara, desaparecería de los filtros
    if (ub.rows[0]?.es_temporal) {
      const movs = await pool.query(
        'SELECT 1 FROM movimientos WHERE ubicacion_origen_id = $1 OR ubicacion_destino_id = $1 LIMIT 1', [req.params.id]
      );
      if (movs.rows.length) {
        return res.status(400).json({ error: 'Esta ubicación temporal ya tiene movimientos. Usa "Finalizar" para cerrarla y conservarla en los reportes.' });
      }
    }
    // Sus depósitos prestados a una temporal deben poder volver a casa
    const prestados = await pool.query(
      'SELECT COUNT(*) FROM bodegas WHERE ubicacion_origen_id = $1 AND activo = true', [req.params.id]
    );
    if (parseInt(prestados.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Esta ubicación tiene depósitos prestados a una ubicación temporal. Espera a que vuelvan.' });
    }
    await pool.query('UPDATE ubicaciones SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Ubicación eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
