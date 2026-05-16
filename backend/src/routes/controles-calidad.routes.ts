/**
 * Control de calidad — 3 tipos de registros:
 *  - analitico (analítica de materia prima: pH, sólidos, viscosidad)
 *  - limpieza (limpieza de depósitos)
 *  - mantenimiento (mantenimiento de equipos)
 *
 * Cada registro queda firmado por el operario al guardarlo (firmado_por_id
 * = usuario logueado, firmado_at = NOW()). Edición posterior requiere admin.
 */

import { Router } from 'express';
import { pool } from '../db/pool';
import { adminOnly } from '../middleware/auth';

const router = Router();

const TIPOS = ['analitico', 'limpieza', 'mantenimiento'] as const;
type Tipo = typeof TIPOS[number];

// GET /api/controles-calidad?tipo=analitico
router.get('/', async (req, res) => {
  try {
    const tipo = String(req.query.tipo ?? '').trim();
    const params: string[] = [];
    let where = '';
    if (tipo && (TIPOS as readonly string[]).includes(tipo)) {
      params.push(tipo);
      where = `WHERE tipo = $1`;
    }
    const { rows } = await pool.query(
      `SELECT cc.*, p.codigo AS producto_codigo, u.nombre AS firmado_por_nombre_actual
       FROM controles_calidad cc
       LEFT JOIN productos p ON p.id = cc.producto_id
       LEFT JOIN usuarios u  ON u.id = cc.firmado_por_id
       ${where}
       ORDER BY cc.fecha DESC, cc.created_at DESC
       LIMIT 500`,
      params
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/controles-calidad — crea un registro (firmado por el usuario logueado)
router.post('/', async (req, res) => {
  try {
    const body = req.body ?? {};
    const tipo: Tipo = body.tipo;
    if (!(TIPOS as readonly string[]).includes(tipo)) {
      return res.status(400).json({ error: `tipo inválido (esperado: ${TIPOS.join('|')})` });
    }

    const fecha = body.fecha || null;
    const user = (req as any).user as { id?: string; nombre?: string } | undefined;

    // Cargar nombre del usuario firmante (snapshot — no se pierde si el user se
    // elimina después: el campo firmado_por_nombre queda en el registro).
    let firmadoPorNombre: string | null = body.firmado_por_nombre ?? null;
    if (user?.id && !firmadoPorNombre) {
      const { rows: [u] } = await pool.query(`SELECT nombre FROM usuarios WHERE id = $1`, [user.id]);
      firmadoPorNombre = u?.nombre ?? null;
    }

    const num = (v: any) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);

    const { rows: [registro] } = await pool.query(
      `INSERT INTO controles_calidad (
         tipo, fecha,
         lote_codigo, metodo, producto_id, producto_nombre,
         ph_spec, ph_valor, solidos_spec, solidos_valor, viscosidad_spec, viscosidad_valor,
         deposito_equipo, accion,
         resultado, observaciones,
         firmado_por_id, firmado_por_nombre, firmado_at,
         created_by_id
       )
       VALUES ($1, COALESCE($2::DATE, CURRENT_DATE),
               $3, $4, $5, $6,
               $7, $8::NUMERIC, $9, $10::NUMERIC, $11, $12::NUMERIC,
               $13, $14,
               $15, $16,
               $17, $18, NOW(),
               $17)
       RETURNING *`,
      [
        tipo, fecha,
        body.lote_codigo || null,
        body.metodo || null,
        body.producto_id || null,
        body.producto_nombre || null,
        body.ph_spec || null,        num(body.ph_valor),
        body.solidos_spec || null,   num(body.solidos_valor),
        body.viscosidad_spec || null,num(body.viscosidad_valor),
        body.deposito_equipo || null,
        body.accion || null,
        body.resultado || null,
        body.observaciones || null,
        user?.id ?? null,
        firmadoPorNombre,
      ]
    );

    return res.status(201).json(registro);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/controles-calidad/:id — solo admin
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const b = req.body ?? {};
    const num = (v: any) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
    const { rows: [r] } = await pool.query(
      `UPDATE controles_calidad SET
         fecha = COALESCE($1::DATE, fecha),
         lote_codigo = $2, metodo = $3, producto_id = $4, producto_nombre = $5,
         ph_spec = $6, ph_valor = $7::NUMERIC, solidos_spec = $8, solidos_valor = $9::NUMERIC,
         viscosidad_spec = $10, viscosidad_valor = $11::NUMERIC,
         deposito_equipo = $12, accion = $13,
         resultado = $14, observaciones = $15,
         updated_at = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        b.fecha || null,
        b.lote_codigo || null, b.metodo || null, b.producto_id || null, b.producto_nombre || null,
        b.ph_spec || null, num(b.ph_valor),
        b.solidos_spec || null, num(b.solidos_valor),
        b.viscosidad_spec || null, num(b.viscosidad_valor),
        b.deposito_equipo || null, b.accion || null,
        b.resultado || null, b.observaciones || null,
        req.params.id,
      ]
    );
    if (!r) return res.status(404).json({ error: 'Registro no encontrado' });
    return res.json(r);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/controles-calidad/:id — solo admin
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM controles_calidad WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Registro no encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
