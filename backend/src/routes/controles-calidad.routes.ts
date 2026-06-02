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
import { logger } from '../lib/logger';

const router = Router();

const TIPOS = ['analitico', 'limpieza', 'mantenimiento'] as const;
type Tipo = typeof TIPOS[number];

// GET /api/controles-calidad?tipo=analitico
// GET /api/controles-calidad/lotes-estado — estado QC de cada lote de materia prima
// Devuelve productos (MP) con sus lotes y si el lote tiene/no tiene registro analítico.
// POST /api/controles-calidad/:id/confirmar — marca pendiente como completado, firma quien confirma
router.post('/:id/confirmar', async (req, res) => {
  try {
    const user = (req as any).user as { id?: string; nombre?: string } | undefined;
    let nombre: string | null = req.body?.confirmado_por_nombre ?? null;
    if (user?.id && !nombre) {
      const { rows: [u] } = await pool.query(`SELECT nombre FROM usuarios WHERE id = $1`, [user.id]);
      nombre = u?.nombre ?? null;
    }
    // Permite añadir resultado/observaciones/acción al confirmar (cuando se hace el trabajo)
    const b = req.body ?? {};
    const { rows: [r] } = await pool.query(
      `UPDATE controles_calidad SET
         estado                = 'completado',
         confirmado_por_id     = $1,
         confirmado_por_nombre = $2,
         confirmado_at         = NOW(),
         resultado             = COALESCE($3, resultado),
         accion                = COALESCE($4, accion),
         observaciones         = COALESCE($5, observaciones)
       WHERE id = $6
       RETURNING *`,
      [user?.id ?? null, nombre, b.resultado ?? null, b.accion ?? null, b.observaciones ?? null, req.params.id]
    );
    if (!r) return res.status(404).json({ error: 'No encontrado' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Endpoint debug — devuelve count y muestra de filas en BD
router.get('/_debug', async (_req, res) => {
  try {
    const { rows: counts } = await pool.query(
      `SELECT tipo, COUNT(*)::int AS n FROM controles_calidad GROUP BY tipo ORDER BY tipo`
    );
    const { rows: sample } = await pool.query(
      `SELECT id, tipo, fecha, lote_codigo, deposito_equipo, resultado,
              firmado_por_id, firmado_por_nombre, firmado_at, created_at,
              ${`(SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='controles_calidad' AND column_name='estado'))`} AS has_estado_col
       FROM controles_calidad
       ORDER BY created_at DESC LIMIT 10`
    );
    res.json({ counts, sample });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/lotes-estado', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS producto_id, p.codigo AS producto_codigo, p.nombre AS producto_nombre,
              p.stock_actual, p.unidad_medida,
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'lote_id', l.id,
                    'lote_interno', l.lote_interno,
                    'lote_proveedor', l.lote_proveedor,
                    'fecha_entrada', l.fecha_entrada,
                    'cantidad_actual', l.cantidad_actual,
                    'control_id', (
                      SELECT cc.id FROM controles_calidad cc
                      WHERE cc.tipo = 'analitico'
                        AND cc.producto_id = p.id
                        AND cc.lote_codigo = l.lote_interno
                      ORDER BY cc.created_at DESC LIMIT 1
                    )
                  ) ORDER BY l.fecha_entrada DESC NULLS LAST)
                  FROM lotes l
                  WHERE l.producto_id = p.id AND l.cantidad_actual > 0
                ),
                '[]'::json
              ) AS lotes
       FROM productos p
       WHERE p.tipo = 'materia_prima' AND p.activo = TRUE
         -- Solo MPs clasificadas como "Emulsión" (acepta variantes con/sin acento)
         AND p.subcategoria_mp ILIKE 'emulsi%n'
       ORDER BY p.nombre`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/controles-calidad/:id/valores — valores medidos del registro
router.get('/:id/valores', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT nombre, valor, unidad FROM controles_calidad_valores WHERE control_id = $1 ORDER BY nombre`,
      [req.params.id]
    );
    // Si no hay nada en la tabla nueva, fallback a campos legacy
    if (rows.length === 0) {
      const { rows: [cc] } = await pool.query(
        `SELECT ph_valor, ph_spec, solidos_valor, solidos_spec, viscosidad_valor, viscosidad_spec
         FROM controles_calidad WHERE id = $1`,
        [req.params.id]
      );
      const legacy: { nombre: string; valor: string; unidad: string | null }[] = [];
      if (cc?.ph_valor != null)         legacy.push({ nombre: 'pH',         valor: String(cc.ph_valor), unidad: null });
      if (cc?.solidos_valor != null)    legacy.push({ nombre: 'Sólidos',    valor: String(cc.solidos_valor), unidad: '%' });
      if (cc?.viscosidad_valor != null) legacy.push({ nombre: 'Viscosidad', valor: String(cc.viscosidad_valor), unidad: 'cP' });
      return res.json(legacy);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/', async (req, res) => {
  try {
    const tipo = String(req.query.tipo ?? '').trim();
    const params: string[] = [];
    const conds: string[] = [];
    if (tipo && (TIPOS as readonly string[]).includes(tipo)) {
      params.push(tipo);
      conds.push(`cc.tipo = $${params.length}`);
    }
    // Para analítico: solo registros de MPs con subcategoría 'Emulsión'.
    // Productos sin id (controles legacy con lote_codigo manual) se incluyen siempre.
    if (tipo === 'analitico') {
      conds.push(`(cc.producto_id IS NULL OR EXISTS (
        SELECT 1 FROM productos p
        WHERE p.id = cc.producto_id
          AND p.tipo = 'materia_prima'
          AND p.subcategoria_mp ILIKE 'emulsi%n'
      ))`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT cc.* FROM controles_calidad cc ${where} ORDER BY cc.fecha DESC, cc.created_at DESC LIMIT 500`,
      params
    );

    // Enriquecer con producto_codigo, firmado_por_nombre_actual y specs_valores via queries pequeñas.
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const prodIds = Array.from(new Set(rows.map(r => r.producto_id).filter(Boolean)));
      const userIds = Array.from(new Set(rows.map(r => r.firmado_por_id).filter(Boolean)));
      const prodMap = new Map<string, string>();
      const userMap = new Map<string, string>();
      const valoresMap = new Map<string, { nombre: string; valor: string; unidad: string | null }[]>();
      if (prodIds.length > 0) {
        const { rows: ps } = await pool.query(`SELECT id, codigo FROM productos WHERE id = ANY($1::uuid[])`, [prodIds]);
        for (const p of ps) prodMap.set(p.id, p.codigo);
      }
      if (userIds.length > 0) {
        const { rows: us } = await pool.query(`SELECT id, nombre FROM usuarios WHERE id = ANY($1::uuid[])`, [userIds]);
        for (const u of us) userMap.set(u.id, u.nombre);
      }
      try {
        const { rows: vals } = await pool.query(
          `SELECT control_id, nombre, valor, unidad FROM controles_calidad_valores WHERE control_id = ANY($1::uuid[])`,
          [ids]
        );
        for (const v of vals) {
          const arr = valoresMap.get(v.control_id) ?? [];
          arr.push({ nombre: v.nombre, valor: v.valor, unidad: v.unidad });
          valoresMap.set(v.control_id, arr);
        }
      } catch { /* migración 047 puede no estar aplicada */ }
      for (const r of rows) {
        r.producto_codigo = r.producto_id ? prodMap.get(r.producto_id) : null;
        r.firmado_por_nombre_actual = r.firmado_por_id ? userMap.get(r.firmado_por_id) : null;
        r.valores = valoresMap.get(r.id) ?? [];
      }
    }
    // Fallback: si firmado_por_nombre (snapshot) es NULL, usar el nombre actual del JOIN.
    for (const r of rows) {
      if (!r.firmado_por_nombre && r.firmado_por_nombre_actual) {
        r.firmado_por_nombre = r.firmado_por_nombre_actual;
      }
    }
    logger.info(`[controles-calidad GET] tipo='${tipo}' → ${rows.length} filas (sample tipo: ${rows[0]?.tipo ?? 'n/a'})`);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    logger.error(`[controles-calidad GET] FALLÓ: ${msg}`, { err: (err as Error).stack });
    return res.status(500).json({ error: msg });
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

    const estado: string = body.estado === 'pendiente' ? 'pendiente' : 'completado';

    // Detectar si migración 045 (columna estado) ya se aplicó. Si no, INSERT sin esa columna.
    const { rows: meta } = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='controles_calidad' AND column_name='estado') AS has_estado`
    );
    const hasEstado = !!meta[0]?.has_estado;

    const baseCols = `tipo, fecha,
       lote_codigo, metodo, producto_id, producto_nombre,
       ph_spec, ph_valor, solidos_spec, solidos_valor, viscosidad_spec, viscosidad_valor,
       deposito_equipo, accion,
       resultado, observaciones,
       firmado_por_id, firmado_por_nombre, firmado_at,
       created_by_id`;
    const baseVals = `$1, COALESCE($2::DATE, CURRENT_DATE),
       $3, $4, $5, $6,
       $7, $8::NUMERIC, $9, $10::NUMERIC, $11, $12::NUMERIC,
       $13, $14,
       $15, $16,
       $17, $18, NOW(),
       $17`;
    const baseParams: unknown[] = [
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
    ];

    const sql = hasEstado
      ? `INSERT INTO controles_calidad (${baseCols}, estado) VALUES (${baseVals}, $19) RETURNING *`
      : `INSERT INTO controles_calidad (${baseCols}) VALUES (${baseVals}) RETURNING *`;
    if (hasEstado) baseParams.push(estado);

    let registro: any;
    try {
      const result = await pool.query(sql, baseParams);
      registro = result.rows[0];
    } catch (e) {
      console.error('[controles-calidad POST] INSERT falló:', (e as Error).message, '| sql:', sql, '| params:', baseParams);
      throw e;
    }

    // Guardar valores específicos por spec (pH, sólidos, viscosidad, acidez, densidad…)
    if (Array.isArray(body.specs_valores) && body.specs_valores.length > 0 && registro?.id) {
      try {
        for (const sv of body.specs_valores) {
          if (sv?.nombre == null || sv?.valor == null || sv.valor === '') continue;
          await pool.query(
            `INSERT INTO controles_calidad_valores (control_id, spec_id, nombre, valor, unidad)
             VALUES ($1, $2, $3, $4::NUMERIC, $5)`,
            [registro.id, sv.spec_id ?? null, String(sv.nombre), Number(sv.valor), sv.unidad ?? null]
          );
        }
      } catch (e) {
        console.warn('[controles-calidad POST] guardar valores falló (¿migración 047?):', (e as Error).message);
      }
    }

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
