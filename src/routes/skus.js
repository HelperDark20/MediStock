const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verificarToken, verificarNivel } = require('../middlewares/auth');

// GET /api/skus/globales
router.get('/globales', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, codigo, nombre, familia, subgrupo, campos, precio, unidad FROM skus_globales WHERE activo = true ORDER BY codigo'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/skus/globales — nivel 4
router.post('/globales', verificarToken, verificarNivel(4), async (req, res) => {
  const { codigo, nombre, familia, subgrupo, precio, campos, unidad } = req.body;
  if (!codigo || !nombre || !familia || !subgrupo || !unidad) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  try {
    const existe = await pool.query(
      'SELECT id FROM skus_globales WHERE codigo = $1', [codigo]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Este SKU ya existe' });
    }
    const result = await pool.query(
      `INSERT INTO skus_globales (codigo, nombre, familia, subgrupo, precio, campos, unidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [codigo, nombre, familia, subgrupo, precio || 0, JSON.stringify(campos || []), unidad.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('ERROR POST /skus/globales:', err.message, err.detail);
    res.status(500).json({ error: 'Error al crear el SKU. Intenta de nuevo.' });
  }
});

// PUT /api/skus/globales/:id — nivel 4 — editar nombre, familia, subgrupo y campos.
// El código y la unidad NO se editan: el código identifica al SKU en filtros
// y reportes, y la unidad ya se copió a cada sub-SKU registrado.
// Los ítems de Stock de Seguridad referencian al SKU Global por NOMBRE, así
// que si el nombre cambia se actualizan en la misma transacción.
router.put('/globales/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, familia, subgrupo, campos } = req.body;
  if (!nombre || !String(nombre).trim() || !familia || !String(familia).trim() || !subgrupo || !String(subgrupo).trim()) {
    return res.status(400).json({ error: 'Nombre, familia y subgrupo son obligatorios' });
  }
  const CAMPOS_VALIDOS = ['proveedor', 'lote', 'caducidad', 'invima'];
  if (!Array.isArray(campos) || campos.some(c => !CAMPOS_VALIDOS.includes(c))) {
    return res.status(400).json({ error: 'Campos inválidos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT nombre FROM skus_globales WHERE id = $1 AND activo = true FOR UPDATE', [req.params.id]
    );
    if (!actual.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SKU Global no encontrado' });
    }
    const nombreAnterior = actual.rows[0].nombre;
    const nombreNuevo = String(nombre).trim();

    const result = await client.query(
      `UPDATE skus_globales SET nombre = $1, familia = $2, subgrupo = $3, campos = $4
       WHERE id = $5 RETURNING *`,
      [nombreNuevo, String(familia).trim(), String(subgrupo).trim(), JSON.stringify(campos), req.params.id]
    );

    let itemsSeguridad = 0;
    if (nombreAnterior.trim().toUpperCase() !== nombreNuevo.toUpperCase()) {
      const upd = await client.query(
        'UPDATE stock_seguridad_items SET item_nombre = $1 WHERE UPPER(TRIM(item_nombre)) = UPPER(TRIM($2))',
        [nombreNuevo, nombreAnterior]
      );
      itemsSeguridad = upd.rowCount;
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], items_seguridad_actualizados: itemsSeguridad });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el SKU' });
  } finally {
    client.release();
  }
});

// DELETE /api/skus/globales/:id — nivel 4
router.delete('/globales/:id', verificarToken, verificarNivel(4), async (req, res) => {
  // FIX: ambos UPDATE en una transacción para no dejar el SKU a medio desactivar
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE skus_globales SET activo = false WHERE id = $1', [req.params.id]);
    await client.query('UPDATE sub_skus SET activo = false WHERE sku_global_id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ mensaje: 'SKU Global desactivado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// GET /api/skus/sub
router.get('/sub', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, g.codigo as sku_global, g.nombre as nombre_global,
              g.familia, g.subgrupo
       FROM sub_skus s
       JOIN skus_globales g ON s.sku_global_id = g.id
       WHERE s.activo = true
       ORDER BY g.codigo, s.sub_sku`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── Código del Sub-SKU: [proveedor abreviado]-[LOTE]-[identificador adicional].
// Devuelve '' si no hay ninguna parte (el llamador pone un GEN-xxxx).
function _abrevProv(str) {
  if (!str || !String(str).trim()) return null;
  const words = String(str).trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return String(str).replace(/[^a-zA-Z0-9]/g,'').substring(0,4).toUpperCase();
  return words.map(w => w[0]?.toUpperCase() || '').join('').substring(0,4).padEnd(4,'X');
}

function _codigoSubSku(proveedor, lote, manual) {
  const partes = [];
  if (proveedor) partes.push(_abrevProv(proveedor));
  if (lote)      partes.push(String(lote).toUpperCase());
  if (manual)    partes.push(String(manual).toUpperCase());
  return partes.filter(Boolean).join('-');
}

// El identificador adicional no se guarda aparte: es lo que queda del código
// después del proveedor y el lote (o el GEN-xxxx de los que no tienen ninguno).
// Tolera códigos antiguos cuya abreviatura de proveedor no sigue la regla
// actual (toma el primer segmento). Si el código no se puede leer, '' (el
// código nuevo se arma solo con proveedor y lote).
function _parteManual(sub) {
  let resto = sub.sub_sku || '';
  if (sub.proveedor && String(sub.proveedor).trim()) {
    const abrev = _abrevProv(sub.proveedor);
    if (resto === abrev) return '';
    if (resto.startsWith(abrev + '-')) resto = resto.slice(abrev.length + 1);
    else if (resto.includes('-')) resto = resto.slice(resto.indexOf('-') + 1);
    else return '';
  }
  if (sub.lote && String(sub.lote).trim()) {
    const lote = String(sub.lote).toUpperCase();
    if (resto === lote) return '';
    if (resto.startsWith(lote + '-')) return resto.slice(lote.length + 1);
    return '';
  }
  return resto;
}

// POST /api/skus/sub — nivel 3 y 4
// FIX: la unidad de medida ya NO se recibe del cliente — se toma del
// SKU Global, que es ahora la única fuente de verdad para ese dato.
router.post('/sub', verificarToken, verificarNivel(3), async (req, res) => {
  const { sku_global_id, proveedor, lote, invima, caducidad, precio, sub_sku_manual } = req.body;

  if (!sku_global_id) {
    return res.status(400).json({ error: 'Falta el SKU Global' });
  }
  if (precio === undefined || precio === null || isNaN(precio) || Number(precio) <= 0) {
    return res.status(400).json({ error: 'El precio unitario es obligatorio y debe ser mayor a 0' });
  }

  let unidad;
  try {
    const skuGlobal = await pool.query(
      'SELECT unidad FROM skus_globales WHERE id = $1 AND activo = true',
      [sku_global_id]
    );
    if (!skuGlobal.rows.length) {
      return res.status(404).json({ error: 'SKU Global no encontrado' });
    }
    unidad = skuGlobal.rows[0].unidad;
    if (!unidad) {
      return res.status(400).json({ error: 'Este SKU Global no tiene unidad de medida definida. Asígnasela primero en SKUs Globales.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error del servidor' });
  }

  const sub_sku = _codigoSubSku(proveedor, lote, sub_sku_manual) ||
    'GEN-' + Date.now().toString(36).toUpperCase().slice(-4);

  try {
    const existe = await pool.query(
      'SELECT * FROM sub_skus WHERE sub_sku = $1 AND sku_global_id = $2 AND activo = true',
      [sub_sku, sku_global_id]
    );
    if (existe.rows.length > 0) {
      return res.json({ ...existe.rows[0], ya_existe: true });
    }
    const result = await pool.query(
      `INSERT INTO sub_skus (sku_global_id, sub_sku, proveedor, lote, invima, caducidad, unidad, precio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [sku_global_id, sub_sku, proveedor||null, lote||null, invima||null, caducidad||null, unidad, precio||0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ══════════════════════════════════════════
// EDICIÓN DE SUB-SKUs (solo Administrador)
// Corrige errores de registro: precio, INVIMA y vencimiento se cambian en el
// mismo Sub-SKU. Si cambia el proveedor o el lote, cambia su código: se crea
// un Sub-SKU nuevo (o, si ese código ya existe en el mismo producto, se une a
// él) que recibe TODO el stock y TODO el historial de movimientos, y el
// anterior queda inactivo. Cada cambio queda en sub_sku_cambios.
// El producto (SKU Global) y la unidad no se cambian aquí.
// ══════════════════════════════════════════

const _txt = v => (v === undefined || v === null ? '' : String(v).trim());

// GET /api/skus/sub/historial?q=&limit=&offset= — más recientes primero
router.get('/sub/historial', verificarToken, verificarNivel(4), async (req, res) => {
  const q = _txt(req.query.q);
  const limit = Math.min(parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 50, 200);
  const offset = parseInt(req.query.offset) > 0 ? parseInt(req.query.offset) : 0;
  try {
    const params = [];
    let filtro = '';
    if (q) {
      params.push(`%${q}%`);
      filtro = `AND (s.sub_sku ILIKE $1 OR g.nombre ILIKE $1 OR g.codigo ILIKE $1 OR s.lote ILIKE $1 OR s.proveedor ILIKE $1)`;
    }
    params.push(limit + 1, offset);
    const result = await pool.query(`
      SELECT s.id, s.sub_sku, s.proveedor, s.lote, s.invima,
             to_char(s.caducidad, 'YYYY-MM-DD') AS caducidad,
             s.unidad, s.precio, g.codigo AS sku_global, g.nombre,
             COALESCE(s.created_at, (SELECT MIN(m.created_at) FROM movimientos m WHERE m.sub_sku_id = s.id)) AS creado,
             (SELECT COALESCE(SUM(st.cantidad), 0) FROM stock st JOIN bodegas b ON b.id = st.bodega_id AND b.activo = true
              WHERE st.sub_sku_id = s.id) AS stock_total,
             (SELECT COUNT(*) FROM sub_sku_cambios c WHERE c.sub_sku_id = s.id) AS total_cambios
      FROM sub_skus s
      JOIN skus_globales g ON g.id = s.sku_global_id
      WHERE s.activo = true ${filtro}
      ORDER BY s.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ filas: result.rows.slice(0, limit), hay_mas: result.rows.length > limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/skus/sub/:id/cambios — bitácora de cambios, más recientes primero
router.get('/sub/:id/cambios', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, usuario_nombre, cambios, nota, created_at FROM sub_sku_cambios
       WHERE sub_sku_id = $1 ORDER BY created_at DESC, id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/skus/sub/:id — editar
// body: { precio, invima, caducidad ('YYYY-MM-DD' | ''), proveedor, lote, confirmar? }
// Si cambia el código y no viene confirmar:true → 409 con lo que va a pasar
// (reemplazar o unir) para que el cliente lo muestre y confirme.
router.put('/sub/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const precio = Number(req.body.precio);
  if (!(precio > 0)) return res.status(400).json({ error: 'El precio unitario debe ser mayor a 0' });
  const caducidad = _txt(req.body.caducidad);
  if (caducidad && !/^\d{4}-\d{2}-\d{2}$/.test(caducidad)) {
    return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
  }
  const nuevo = {
    precio,
    invima: _txt(req.body.invima),
    caducidad,
    proveedor: _txt(req.body.proveedor),
    lote: _txt(req.body.lote)
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT s.*, to_char(s.caducidad, 'YYYY-MM-DD') AS cad_txt
       FROM sub_skus s WHERE s.id = $1 AND s.activo = true FOR UPDATE`,
      [req.params.id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sub-SKU no encontrado' });
    }
    const viejo = r.rows[0];
    const antes = {
      precio: Number(viejo.precio), invima: _txt(viejo.invima), caducidad: viejo.cad_txt || '',
      proveedor: _txt(viejo.proveedor), lote: _txt(viejo.lote)
    };
    const cambios = {};
    for (const campo of Object.keys(nuevo)) {
      if (antes[campo] !== nuevo[campo]) cambios[campo] = { antes: antes[campo] || null, despues: nuevo[campo] || null };
    }
    if (!Object.keys(cambios).length) {
      await client.query('ROLLBACK');
      return res.json({ mensaje: 'Sin cambios', sub_sku_id: viejo.id, accion: 'ninguna' });
    }

    let codigoNuevo = viejo.sub_sku;
    if (cambios.proveedor || cambios.lote) {
      codigoNuevo = _codigoSubSku(nuevo.proveedor, nuevo.lote, _parteManual(viejo)) ||
        'GEN-' + Date.now().toString(36).toUpperCase().slice(-4);
    }

    // Mismo código: se corrige en el mismo Sub-SKU
    if (codigoNuevo === viejo.sub_sku) {
      await client.query(
        `UPDATE sub_skus SET precio = $1, invima = $2, caducidad = $3, proveedor = $4, lote = $5 WHERE id = $6`,
        [nuevo.precio, nuevo.invima || null, nuevo.caducidad || null, nuevo.proveedor || null, nuevo.lote || null, viejo.id]
      );
      await client.query(
        'INSERT INTO sub_sku_cambios (sub_sku_id, usuario_id, usuario_nombre, cambios) VALUES ($1, $2, $3, $4)',
        [viejo.id, req.usuario.id, req.usuario.nombre, JSON.stringify(cambios)]
      );
      await client.query('COMMIT');
      return res.json({ mensaje: 'Sub-SKU actualizado', sub_sku_id: viejo.id, accion: 'editar' });
    }

    // Cambia el código: reemplazar por uno nuevo, o unir al que ya existe
    const destinoR = await client.query(
      `SELECT s.*, to_char(s.caducidad, 'YYYY-MM-DD') AS cad_txt FROM sub_skus s
       WHERE s.sku_global_id = $1 AND s.sub_sku = $2 AND s.activo = true AND s.id <> $3 FOR UPDATE`,
      [viejo.sku_global_id, codigoNuevo, viejo.id]
    );
    const destino = destinoR.rows[0] || null;

    if (req.body.confirmar !== true) {
      const stock = await client.query('SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE sub_sku_id = $1', [viejo.id]);
      const movs = await client.query('SELECT COUNT(*) AS total FROM movimientos WHERE sub_sku_id = $1', [viejo.id]);
      await client.query('ROLLBACK');
      return res.status(409).json({
        requiere_confirmacion: true,
        accion: destino ? 'unir' : 'reemplazar',
        codigo_actual: viejo.sub_sku,
        codigo_nuevo: codigoNuevo,
        stock_total: Number(stock.rows[0].total),
        movimientos: Number(movs.rows[0].total),
        destino: destino ? {
          id: destino.id, sub_sku: destino.sub_sku, precio: Number(destino.precio),
          lote: destino.lote, proveedor: destino.proveedor, caducidad: destino.cad_txt, invima: destino.invima
        } : null
      });
    }

    let destinoId;
    if (destino) {
      destinoId = destino.id;   // conserva sus propios datos
    } else {
      const ins = await client.query(
        `INSERT INTO sub_skus (sku_global_id, sub_sku, proveedor, lote, invima, caducidad, unidad, precio, serial)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [viejo.sku_global_id, codigoNuevo, nuevo.proveedor || null, nuevo.lote || null, nuevo.invima || null,
         nuevo.caducidad || null, viejo.unidad, nuevo.precio, viejo.serial || null]
      );
      destinoId = ins.rows[0].id;
    }

    // Todo el stock, el historial y la bitácora pasan al destino
    await client.query(
      `INSERT INTO stock (sub_sku_id, bodega_id, cantidad)
       SELECT $1, bodega_id, cantidad FROM stock WHERE sub_sku_id = $2
       ON CONFLICT (sub_sku_id, bodega_id) DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
      [destinoId, viejo.id]
    );
    await client.query('DELETE FROM stock WHERE sub_sku_id = $1', [viejo.id]);
    await client.query('UPDATE movimientos SET sub_sku_id = $1 WHERE sub_sku_id = $2', [destinoId, viejo.id]);
    await client.query('UPDATE sub_sku_cambios SET sub_sku_id = $1 WHERE sub_sku_id = $2', [destinoId, viejo.id]);
    await client.query('UPDATE sub_skus SET activo = false WHERE id = $1', [viejo.id]);

    const nota = destino
      ? `Se unió ${viejo.sub_sku} (stock e historial). Se conservaron los datos de ${destino.sub_sku}.`
      : `Reemplaza a ${viejo.sub_sku} (stock e historial trasladados).`;
    await client.query(
      'INSERT INTO sub_sku_cambios (sub_sku_id, usuario_id, usuario_nombre, cambios, nota) VALUES ($1, $2, $3, $4, $5)',
      [destinoId, req.usuario.id, req.usuario.nombre,
       JSON.stringify({ ...cambios, sub_sku: { antes: viejo.sub_sku, despues: codigoNuevo } }), nota]
    );
    await client.query('COMMIT');
    res.json({
      mensaje: destino ? `${viejo.sub_sku} se unió a ${codigoNuevo}` : `${viejo.sub_sku} reemplazado por ${codigoNuevo}`,
      sub_sku_id: destinoId, accion: destino ? 'unir' : 'reemplazar'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error del servidor al modificar el Sub-SKU' });
  } finally {
    client.release();
  }
});

// GET /api/skus/stock
router.get('/stock', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
              s.id             AS sub_sku_id,
              s.sku_global_id,
              s.sub_sku,
              s.proveedor,
              s.lote,
              s.invima,
              s.caducidad,
              s.unidad,
              s.precio,
              s.serial,
              g.codigo         AS sku_global,
              g.nombre,
              g.familia,
              g.subgrupo,
              b.nombre         AS bodega_nombre,
              COALESCE(st.cantidad, 0) AS cantidad
       FROM sub_skus s
       JOIN skus_globales g  ON s.sku_global_id = g.id
       LEFT JOIN stock st    ON st.sub_sku_id = s.id
       LEFT JOIN bodegas b   ON st.bodega_id = b.id AND b.activo = true
       WHERE s.activo = true
       ORDER BY g.codigo, b.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/skus/sub/:id — nivel 4
router.delete('/sub/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    await pool.query('UPDATE sub_skus SET activo = false WHERE id = $1', [req.params.id]);
    res.json({ mensaje: 'Sub-SKU desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;