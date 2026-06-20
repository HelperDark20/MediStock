const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/movimientos — todos los niveles
router.get('/', verificarToken, async (req, res) => {
  const { sku_global, sub_sku_id, limit, bodega } = req.query;
  try {
    let query = `
      SELECT m.*,
            g.codigo as sku_global_codigo,
            s.sub_sku,
            g.nombre as nombre,
            s.unidad,
            bo.nombre as origen_nombre,
            bd.nombre as destino_nombre,
            u.nombre as usuario_nombre,
            u.nivel as usuario_nivel,
            u.id as usuario_id
      FROM movimientos m
      JOIN sub_skus s ON m.sub_sku_id = s.id
      JOIN skus_globales g ON s.sku_global_id = g.id
      LEFT JOIN bodegas bo ON m.bodega_origen_id = bo.id
      LEFT JOIN bodegas bd ON m.bodega_destino_id = bd.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (sku_global) {
      params.push(sku_global);
      query += ` AND g.codigo = $${params.length}`;
    }
    if (sub_sku_id) {
      params.push(sub_sku_id);
      query += ` AND m.sub_sku_id = $${params.length}`;
    }
    // Fix #4: bodega usaba el mismo índice $N dos veces.
    // pg no soporta reutilizar parámetros — se pasan dos valores separados.
    if (bodega) {
      params.push(bodega);
      const idx1 = params.length;
      params.push(bodega);
      const idx2 = params.length;
      query += ` AND (bo.nombre = $${idx1} OR bd.nombre = $${idx2})`;
    }

    query += ' ORDER BY m.created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ══════════════════════════════════════════════════════════════════
// Fix #8: POST /api/movimientos/entrada-completa
// Unifica la creación del sub-SKU y el registro de la entrada en
// una ÚNICA transacción de PostgreSQL, eliminando la race condition
// que existía cuando el frontend hacía dos llamadas separadas
// (/api/skus/sub y luego /api/movimientos/entrada).
// ══════════════════════════════════════════════════════════════════
router.post('/entrada-completa', verificarToken, verificarNivel(3), async (req, res) => {
  const {
    // Datos del sub-SKU
    sku_global_id,
    proveedor,
    lote,
    invima,
    caducidad,
    unidad,
    precio,
    sub_sku_manual,
    // Datos de la entrada
    bodega_destino_id,
    cantidad
  } = req.body;

  // Validaciones básicas
  if (!sku_global_id || !unidad || !bodega_destino_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (precio === undefined || precio === null || isNaN(precio) || Number(precio) <= 0) {
    return res.status(400).json({ error: 'El precio unitario es obligatorio y debe ser mayor a 0' });
  }

  // Construir código sub-SKU (misma lógica que el endpoint /skus/sub)
  const abrevProv = (str) => {
    if (!str) return null;
    const words = str.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return str.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    return words.map(w => w[0]?.toUpperCase() || '').join('').substring(0, 4).padEnd(4, 'X');
  };

  let partes = [];
  if (proveedor)      partes.push(abrevProv(proveedor));
  if (lote)           partes.push(lote.toUpperCase());
  if (sub_sku_manual) partes.push(sub_sku_manual.toUpperCase());
  if (!partes.length) partes.push('GEN');

  const sub_sku = partes.join('-');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert del sub-SKU dentro de la misma transacción
    //    Si ya existe, lo reutiliza; si no, lo crea.
    let subSkuId;
    const existente = await client.query(
      'SELECT id FROM sub_skus WHERE sub_sku = $1 AND sku_global_id = $2 AND activo = true',
      [sub_sku, sku_global_id]
    );

    if (existente.rows.length > 0) {
      subSkuId = existente.rows[0].id;
    } else {
      const nuevoSub = await client.query(
        `INSERT INTO sub_skus
           (sku_global_id, sub_sku, proveedor, lote, invima, caducidad, unidad, precio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          sku_global_id,
          sub_sku,
          proveedor || null,
          lote      || null,
          invima    || null,
          caducidad || null,
          unidad,
          precio
        ]
      );
      subSkuId = nuevoSub.rows[0].id;
    }

    // 2. Registrar el movimiento de entrada
    await client.query(
      `INSERT INTO movimientos
         (sub_sku_id, tipo, bodega_destino_id, cantidad, usuario_id)
       VALUES ($1, 'compra', $2, $3, $4)`,
      [subSkuId, bodega_destino_id, cantidad, req.usuario.id]
    );

    // 3. Actualizar stock (upsert)
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [subSkuId, bodega_destino_id, cantidad]
    );

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Entrada registrada correctamente',
      sub_sku_id: subSkuId,
      sub_sku
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/entrada — nivel 3 y 4
// Se mantiene por compatibilidad, pero el frontend ya no lo usa directamente.
router.post('/entrada', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_destino_id, cantidad } = req.body;
  if (!sub_sku_id || !bodega_destino_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO movimientos (sub_sku_id, tipo, bodega_destino_id, cantidad, usuario_id)
       VALUES ($1, 'compra', $2, $3, $4)`,
      [sub_sku_id, bodega_destino_id, cantidad, req.usuario.id]
    );
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [sub_sku_id, bodega_destino_id, cantidad]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Entrada registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/consumo — nivel 2, 3 y 4
router.post('/consumo', verificarToken, verificarNivel(2), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, cantidad, cedula_paciente } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }
    await client.query(
      `INSERT INTO movimientos (sub_sku_id, tipo, bodega_origen_id, cantidad, usuario_id, cedula_paciente)
       VALUES ($1, 'consumo', $2, $3, $4, $5)`,
      [sub_sku_id, bodega_origen_id, cantidad, req.usuario.id, cedula_paciente || null]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Consumo registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/traslado — nivel 3 y 4
router.post('/traslado', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, bodega_destino_id, cantidad } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !bodega_destino_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (bodega_origen_id === bodega_destino_id) {
    return res.status(400).json({ error: 'Origen y destino son iguales' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente en origen' });
    }
    await client.query(
      `INSERT INTO movimientos (sub_sku_id, tipo, bodega_origen_id, bodega_destino_id, cantidad, usuario_id)
       VALUES ($1, 'traslado', $2, $3, $4, $5)`,
      [sub_sku_id, bodega_origen_id, bodega_destino_id, cantidad, req.usuario.id]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub_sku_id, bodega_id)
       DO UPDATE SET cantidad = stock.cantidad + $3`,
      [sub_sku_id, bodega_destino_id, cantidad]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Traslado registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// POST /api/movimientos/destruccion — nivel 3 y 4
router.post('/destruccion', verificarToken, verificarNivel(3), async (req, res) => {
  const { sub_sku_id, bodega_origen_id, cantidad, motivo } = req.body;
  if (!sub_sku_id || !bodega_origen_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stockResult = await client.query(
      'SELECT cantidad FROM stock WHERE sub_sku_id = $1 AND bodega_id = $2',
      [sub_sku_id, bodega_origen_id]
    );
    if (stockResult.rows.length === 0 || stockResult.rows[0].cantidad < cantidad) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuficiente' });
    }
    await client.query(
      `INSERT INTO movimientos (sub_sku_id, tipo, bodega_origen_id, cantidad, motivo, usuario_id)
       VALUES ($1, 'destruccion', $2, $3, $4, $5)`,
      [sub_sku_id, bodega_origen_id, cantidad, motivo, req.usuario.id]
    );
    await client.query(
      'UPDATE stock SET cantidad = cantidad - $1 WHERE sub_sku_id = $2 AND bodega_id = $3',
      [cantidad, sub_sku_id, bodega_origen_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Destrucción registrada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;