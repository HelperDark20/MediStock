const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { verificarToken, verificarNivel } = require('../middlewares/auth');
const { validarParamsId } = require('../utils/validar');


// :id debe ser un id numérico (si no, 400 en vez de error 500)
validarParamsId(router, 'id');
const NIVELES_VALIDOS = [1, 2, 3, 4];
// Nivel 1 = Médico: se asigna a los eventos para la historia clínica
// (responsable y firma), pero no tiene contraseña ni acceso a la app. Su
// cédula hace también de registro profesional (normalmente son el mismo).
const NIVEL_MEDICO = 1;
// Nivel 2 = Enfermero/a: su contraseña es siempre su número de cédula (se
// asigna sola al crearlo o editarlo; supervisores y administradores no)
const NIVEL_ENFERMERO = 2;

// GET /api/usuarios/me — cualquier nivel autenticado
router.get('/me', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.cedula, u.nivel, u.genero, u.ubicacion_id,
              ub.nombre AS ubicacion_nombre
       FROM usuarios u
       LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
       WHERE u.id = $1 AND u.activo = true`,
      [req.usuario.id]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/usuarios — nivel 4
router.get('/', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.cedula, u.nivel, u.genero,
              u.activo, u.ubicacion_id, ub.nombre AS ubicacion_nombre
       FROM usuarios u
       LEFT JOIN ubicaciones ub ON u.ubicacion_id = ub.id
       WHERE u.activo = true ORDER BY u.nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/usuarios — nivel 4
// La fecha de nacimiento ya no se pide (la columna se conserva con lo que
// tenía). El médico (nivel 1) se crea sin contraseña.
router.post('/', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, cedula, nivel, genero, password, ubicacion_id } = req.body;
  const nivelNum = parseInt(nivel);
  const esMedico = nivelNum === NIVEL_MEDICO;
  const esEnfermero = nivelNum === NIVEL_ENFERMERO;
  if (!nombre || !cedula || !nivel || (!esMedico && !esEnfermero && !password)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  // FIX SEGURIDAD: validar que nivel esté en rango permitido
  if (!NIVELES_VALIDOS.includes(nivelNum)) {
    return res.status(400).json({ error: 'Nivel inválido. Debe ser 1, 2, 3 o 4' });
  }
  try {
    const existe = await pool.query('SELECT id, activo FROM usuarios WHERE cedula = $1', [cedula]);
    if (existe.rows.length > 0 && existe.rows[0].activo) {
      return res.status(400).json({ error: 'Esta cédula ya está registrada' });
    }
    const password_hash = esMedico ? null : await bcrypt.hash(esEnfermero ? String(cedula).trim() : password, 10);
    let result;
    if (existe.rows.length > 0 && !existe.rows[0].activo) {
      result = await pool.query(
        `UPDATE usuarios SET nombre=$1, nivel=$2, genero=$3,
        password_hash=$4, ubicacion_id=$5, activo=true
        WHERE cedula=$6
        RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
        [nombre, nivelNum, genero, password_hash, ubicacion_id || null, cedula]
      );
    } else {
      result = await pool.query(
        `INSERT INTO usuarios (nombre, cedula, nivel, genero, password_hash, ubicacion_id)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
        [nombre, cedula, nivelNum, genero, password_hash, ubicacion_id || null]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PUT /api/usuarios/:id — nivel 4
// Pasar a médico (nivel 1) le quita la contraseña y el acceso; pasar de
// médico a otro nivel exige asignarle una contraseña.
router.put('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  const { nombre, nivel, genero, password, ubicacion_id } = req.body;
  // FIX SEGURIDAD: validar nivel si se está cambiando
  if (nivel !== undefined && !NIVELES_VALIDOS.includes(parseInt(nivel))) {
    return res.status(400).json({ error: 'Nivel inválido. Debe ser 1, 2, 3 o 4' });
  }
  try {
    const actual = await pool.query(
      'SELECT nivel, cedula, password_hash IS NOT NULL AS tiene_password FROM usuarios WHERE id = $1 AND activo = true',
      [req.params.id]
    );
    if (!actual.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const nivelFinal = nivel !== undefined ? parseInt(nivel) : actual.rows[0].nivel;
    const esMedico = nivelFinal === NIVEL_MEDICO;
    if (esMedico && parseInt(req.params.id) === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio usuario a Médico: perderías el acceso' });
    }
    const esEnfermero = nivelFinal === NIVEL_ENFERMERO;
    if (!esMedico && !esEnfermero && !password && !actual.rows[0].tiene_password) {
      return res.status(400).json({ error: 'Asigna una contraseña: este usuario no tenía acceso a la app' });
    }
    let password_hash = null;
    if (esEnfermero) {
      password_hash = await bcrypt.hash(String(actual.rows[0].cedula).trim(), 10);
    } else if (password && !esMedico) {
      password_hash = await bcrypt.hash(password, 10);
    }
    // FIX: ubicacion_id solo se modifica si viene en el body. Antes se
    // sobrescribía siempre, y una edición que no la enviaba la dejaba en null.
    const cambiaUbicacion = Object.prototype.hasOwnProperty.call(req.body, 'ubicacion_id');
    const result = await pool.query(
      `UPDATE usuarios SET
        nombre       = COALESCE($1, nombre),
        nivel        = COALESCE($2, nivel),
        genero       = COALESCE($3, genero),
        ubicacion_id = CASE WHEN $7::boolean THEN $4::int ELSE ubicacion_id END,
        password_hash = CASE WHEN $8::boolean THEN NULL
                             WHEN $5::text IS NOT NULL THEN $5::text ELSE password_hash END
       WHERE id = $6 AND activo = true
       RETURNING id, nombre, cedula, nivel, genero, ubicacion_id`,
      [nombre || null, nivel ? parseInt(nivel) : null, genero || null, ubicacion_id || null, password_hash, req.params.id, cambiaUbicacion,
       esMedico]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Un médico no maneja depósitos: se le quitan los de eventos abiertos
    // (los de eventos finalizados quedan como historial)
    if (esMedico) {
      await pool.query(
        `DELETE FROM evento_usuario_bodegas
         WHERE usuario_id = $1
           AND evento_id IN (SELECT id FROM eventos WHERE estado IN ('creado', 'en_curso'))`,
        [req.params.id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/usuarios/:id — nivel 4 (soft delete)
router.delete('/:id', verificarToken, verificarNivel(4), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }
    const result = await pool.query(
      'UPDATE usuarios SET activo = false WHERE id = $1 AND activo = true RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Usuario no encontrado o ya desactivado' });
    }
    res.json({ mensaje: 'Usuario desactivado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;