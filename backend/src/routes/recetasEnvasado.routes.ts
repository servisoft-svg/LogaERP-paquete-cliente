// Recetas de envasado — 4 bloques fijos (Líquido + Envase + Etiqueta + Caja opcional).
// Sustituye al uso anterior de la tabla `recetas` para envasados; deja la
// receta genérica para producción de líquidos.

import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { adminOnly } from '../middleware/auth';
import { logger } from '../lib/logger';

const router = Router();

const SELECT_FULL = `
  re.id, re.nombre, re.codigo,
  re.producto_envasado_id,
  pe.codigo  AS producto_envasado_codigo,
  pe.nombre  AS producto_envasado_nombre,
  pe.unidad_medida AS producto_envasado_unidad,
  re.liquido_id, re.liquido_cantidad, re.liquido_unidad,
  pl.codigo  AS liquido_codigo, pl.nombre AS liquido_nombre,
  pl.unidad_medida AS liquido_unidad_default,
  pl.stock_actual AS liquido_stock,
  re.envase_id, re.envases_por_bote,
  pv.codigo  AS envase_codigo, pv.nombre AS envase_nombre,
  pv.stock_actual AS envase_stock,
  re.etiqueta_id, re.etiquetas_por_bote,
  pt.codigo  AS etiqueta_codigo, pt.nombre AS etiqueta_nombre,
  pt.stock_actual AS etiqueta_stock,
  re.lleva_caja, re.caja_id,
  pc.codigo  AS caja_codigo, pc.nombre AS caja_nombre,
  pc.unidades_por_envase AS caja_uds,
  pc.stock_actual AS caja_stock,
  re.peso_envase_vacio_kg, re.unidades_por_caja,
  re.peso_caja_vacia_kg, re.cajas_por_pale, re.peso_pale_vacio_kg,
  re.extras,
  re.activa, re.created_at, re.updated_at
`;

const FROM_FULL = `
  FROM recetas_envasado re
  JOIN productos pe ON pe.id = re.producto_envasado_id
  JOIN productos pl ON pl.id = re.liquido_id
  JOIN productos pv ON pv.id = re.envase_id
  LEFT JOIN productos pt ON pt.id = re.etiqueta_id
  LEFT JOIN productos pc ON pc.id = re.caja_id
`;

// ── GET /api/recetas-envasado ──────────────────────────────
// Devuelve las fórmulas del nuevo modelo + las legacy de `recetas` con
// tipo_receta='envasado' (mapeadas a la misma estructura, marcadas legacy=true).
router.get('/', async (_req, res) => {
  try {
    const { rows: nuevas } = await pool.query(`SELECT ${SELECT_FULL}, FALSE AS legacy ${FROM_FULL}
                                                WHERE re.activa = TRUE
                                                ORDER BY re.nombre ASC`);

    // Legacy: cada `recetas` con tipo_receta='envasado' activa.
    // Mapeo de ingredientes → liquido / envase / etiqueta / caja / extras:
    //   liquido  = primer ingrediente cuyo producto.tipo='producto_fabricado'
    //   envase   = primer material_embalaje con subcategoria_me='Bote' o nombre /bote|garrafa|bidon/i
    //   etiqueta = primer material_embalaje con subcategoria_me='Etiqueta' o nombre /etiqueta/i
    //   caja     = primer material_embalaje con subcategoria_me in ('Caja','Palé') o nombre /caja|palé/i
    //   extras   = el resto
    const { rows: legacy } = await pool.query(`
      WITH recetas_env AS (
        SELECT r.id, r.nombre,
               r.producto_id AS producto_envasado_id,
               pe.codigo  AS producto_envasado_codigo,
               pe.nombre  AS producto_envasado_nombre,
               pe.unidad_medida AS producto_envasado_unidad,
               r.created_at, r.updated_at
        FROM recetas r
        JOIN productos pe ON pe.id = r.producto_id
        WHERE r.tipo_receta = 'envasado' AND r.activa = TRUE
      ),
      ings AS (
        SELECT ir.receta_id, ir.materia_prima_id, ir.cantidad, ir.unidad_medida,
               p.tipo AS prod_tipo, p.subcategoria_me, p.nombre AS prod_nombre,
               p.codigo AS prod_codigo, p.stock_actual AS prod_stock,
               p.unidades_por_envase AS prod_uds,
               ROW_NUMBER() OVER (PARTITION BY ir.receta_id,
                 CASE
                   WHEN p.tipo = 'producto_fabricado' THEN 'liq'
                   WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me = 'Bote' OR p.nombre ~* 'bote|bid|garrafa') THEN 'env'
                   WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me = 'Etiqueta' OR p.nombre ~* 'etiqueta') THEN 'eti'
                   WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me IN ('Caja','Palé') OR p.nombre ~* 'caja|pal[eé]') THEN 'caj'
                   ELSE 'ext'
                 END
                 ORDER BY ir.cantidad DESC NULLS LAST
               ) AS rn,
               CASE
                 WHEN p.tipo = 'producto_fabricado' THEN 'liq'
                 WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me = 'Bote' OR p.nombre ~* 'bote|bid|garrafa') THEN 'env'
                 WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me = 'Etiqueta' OR p.nombre ~* 'etiqueta') THEN 'eti'
                 WHEN p.tipo = 'material_embalaje' AND (p.subcategoria_me IN ('Caja','Palé') OR p.nombre ~* 'caja|pal[eé]') THEN 'caj'
                 ELSE 'ext'
               END AS rol
        FROM ingredientes_receta ir
        JOIN productos p ON p.id = ir.materia_prima_id
        WHERE ir.receta_id IN (SELECT id FROM recetas_env)
      )
      SELECT re.id, re.nombre, NULL::TEXT AS codigo,
             re.producto_envasado_id, re.producto_envasado_codigo, re.producto_envasado_nombre,
             re.producto_envasado_unidad,
             liq.materia_prima_id AS liquido_id,
             COALESCE(liq.cantidad, 0) AS liquido_cantidad,
             COALESCE(liq.unidad_medida, 'kg') AS liquido_unidad,
             liq.prod_codigo AS liquido_codigo,
             liq.prod_nombre AS liquido_nombre,
             liq.unidad_medida AS liquido_unidad_default,
             liq.prod_stock AS liquido_stock,
             env.materia_prima_id AS envase_id,
             COALESCE(env.cantidad, 1)::INT AS envases_por_bote,
             env.prod_codigo AS envase_codigo,
             env.prod_nombre AS envase_nombre,
             env.prod_stock  AS envase_stock,
             eti.materia_prima_id AS etiqueta_id,
             COALESCE(eti.cantidad, 1)::INT AS etiquetas_por_bote,
             eti.prod_codigo AS etiqueta_codigo,
             eti.prod_nombre AS etiqueta_nombre,
             eti.prod_stock  AS etiqueta_stock,
             (caj.materia_prima_id IS NOT NULL) AS lleva_caja,
             caj.materia_prima_id AS caja_id,
             caj.prod_codigo AS caja_codigo,
             caj.prod_nombre AS caja_nombre,
             caj.prod_uds    AS caja_uds,
             caj.prod_stock  AS caja_stock,
             0::NUMERIC AS peso_envase_vacio_kg,
             1::INT     AS unidades_por_caja,
             0::NUMERIC AS peso_caja_vacia_kg,
             0::INT     AS cajas_por_pale,
             0::NUMERIC AS peso_pale_vacio_kg,
             COALESCE((
               SELECT json_agg(json_build_object('producto_id', materia_prima_id, 'cantidad_por_bote', cantidad))
               FROM ings WHERE receta_id = re.id AND rol = 'ext'
             ), '[]'::json) AS extras,
             TRUE AS activa,
             re.created_at, re.updated_at,
             TRUE AS legacy
      FROM recetas_env re
      LEFT JOIN ings liq ON liq.receta_id = re.id AND liq.rol = 'liq' AND liq.rn = 1
      LEFT JOIN ings env ON env.receta_id = re.id AND env.rol = 'env' AND env.rn = 1
      LEFT JOIN ings eti ON eti.receta_id = re.id AND eti.rol = 'eti' AND eti.rn = 1
      LEFT JOIN ings caj ON caj.receta_id = re.id AND caj.rol = 'caj' AND caj.rn = 1
      ORDER BY re.nombre ASC
    `);

    res.json([...nuevas, ...legacy]);
  } catch (err) {
    logger.error('[recetas-envasado.list]', { err });
    res.status(500).json({ error: 'Error listando recetas de envasado' });
  }
});

// ── GET /api/recetas-envasado/:id ─────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL}
                                            WHERE re.id = $1`, [req.params.id]);
    if (!r) return res.status(404).json({ error: 'No encontrada' });
    res.json(r);
  } catch (err) {
    logger.error('[recetas-envasado.get]', { err });
    res.status(500).json({ error: 'Error' });
  }
});

// Validación del payload
function validar(b: Record<string, unknown>): string | null {
  if (!b.nombre || typeof b.nombre !== 'string' || !String(b.nombre).trim())
    return 'nombre obligatorio';
  if (!b.producto_envasado_id) return 'producto_envasado_id obligatorio';
  if (!b.liquido_id) return 'liquido_id obligatorio';
  if (b.liquido_cantidad == null || Number(b.liquido_cantidad) <= 0)
    return 'liquido_cantidad > 0 obligatorio';
  if (!b.envase_id) return 'envase_id obligatorio';
  if (b.lleva_caja && !b.caja_id) return 'caja_id obligatorio cuando lleva_caja=true';
  return null;
}

// ── POST /api/recetas-envasado ────────────────────────────
router.post('/', adminOnly, async (req, res) => {
  const e = validar(req.body); if (e) return res.status(400).json({ error: e });
  try {
    const {
      nombre, codigo,
      producto_envasado_id,
      liquido_id, liquido_cantidad, liquido_unidad = 'kg',
      envase_id, envases_por_bote = 1,
      etiqueta_id, etiquetas_por_bote = 1,
      lleva_caja = false, caja_id,
      peso_envase_vacio_kg = 0,
      unidades_por_caja    = 1,
      peso_caja_vacia_kg   = 0,
      cajas_por_pale       = 0,
      peso_pale_vacio_kg   = 0,
      extras = [],
    } = req.body;
    const extrasNorm = Array.isArray(extras)
      ? extras.filter((e: any) => e?.producto_id && Number(e?.cantidad_por_bote) > 0)
              .map((e: any) => ({ producto_id: e.producto_id, cantidad_por_bote: Number(e.cantidad_por_bote) }))
      : [];
    const { rows: [r] } = await pool.query(
      `INSERT INTO recetas_envasado (
         nombre, codigo, producto_envasado_id,
         liquido_id, liquido_cantidad, liquido_unidad,
         envase_id, envases_por_bote,
         etiqueta_id, etiquetas_por_bote,
         lleva_caja, caja_id,
         peso_envase_vacio_kg, unidades_por_caja,
         peso_caja_vacia_kg, cajas_por_pale, peso_pale_vacio_kg,
         extras
       ) VALUES ($1,$2,$3,$4,$5::NUMERIC,$6,$7,$8::INT,$9,$10::INT,$11,$12,
                 $13::NUMERIC,$14::INT,$15::NUMERIC,$16::INT,$17::NUMERIC,
                 $18::JSONB)
       RETURNING id`,
      [String(nombre).trim(), codigo ?? null, producto_envasado_id,
       liquido_id, liquido_cantidad, liquido_unidad,
       envase_id, envases_por_bote,
       etiqueta_id ?? null, etiquetas_por_bote,
       !!lleva_caja, lleva_caja ? caja_id : null,
       Number(peso_envase_vacio_kg) || 0, Number(unidades_por_caja) || 1,
       Number(peso_caja_vacia_kg) || 0, Number(cajas_por_pale) || 0, Number(peso_pale_vacio_kg) || 0,
       JSON.stringify(extrasNorm)]
    );
    const { rows: [full] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL} WHERE re.id = $1`, [r.id]);
    res.status(201).json(full);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e?.code === '23505') return res.status(409).json({ error: 'Código duplicado' });
    logger.error('[recetas-envasado.create]', { err });
    res.status(500).json({ error: 'Error creando receta' });
  }
});

// ── PUT /api/recetas-envasado/:id ─────────────────────────
router.put('/:id', adminOnly, async (req, res) => {
  const e = validar(req.body); if (e) return res.status(400).json({ error: e });
  try {
    const {
      nombre, codigo,
      producto_envasado_id,
      liquido_id, liquido_cantidad, liquido_unidad,
      envase_id, envases_por_bote,
      etiqueta_id, etiquetas_por_bote,
      lleva_caja, caja_id, activa,
      peso_envase_vacio_kg,
      unidades_por_caja,
      peso_caja_vacia_kg,
      cajas_por_pale,
      peso_pale_vacio_kg,
      extras = [],
    } = req.body;
    const extrasNorm = Array.isArray(extras)
      ? extras.filter((e: any) => e?.producto_id && Number(e?.cantidad_por_bote) > 0)
              .map((e: any) => ({ producto_id: e.producto_id, cantidad_por_bote: Number(e.cantidad_por_bote) }))
      : [];
    const { rows: [r] } = await pool.query(
      `UPDATE recetas_envasado SET
         nombre = $1, codigo = $2,
         producto_envasado_id = $3,
         liquido_id = $4, liquido_cantidad = $5::NUMERIC, liquido_unidad = $6,
         envase_id  = $7, envases_por_bote = $8::INT,
         etiqueta_id = $9, etiquetas_por_bote = $10::INT,
         lleva_caja = $11, caja_id = $12,
         peso_envase_vacio_kg = COALESCE($16::NUMERIC, peso_envase_vacio_kg),
         unidades_por_caja    = COALESCE($17::INT,     unidades_por_caja),
         peso_caja_vacia_kg   = COALESCE($18::NUMERIC, peso_caja_vacia_kg),
         cajas_por_pale       = COALESCE($19::INT,     cajas_por_pale),
         peso_pale_vacio_kg   = COALESCE($20::NUMERIC, peso_pale_vacio_kg),
         extras = $15::JSONB,
         activa = COALESCE($13, activa),
         updated_at = now()
       WHERE id = $14
       RETURNING id`,
      [String(nombre).trim(), codigo ?? null,
       producto_envasado_id, liquido_id, liquido_cantidad, liquido_unidad ?? 'kg',
       envase_id, envases_por_bote ?? 1,
       etiqueta_id ?? null, etiquetas_por_bote ?? 1,
       !!lleva_caja, lleva_caja ? caja_id : null,
       activa, req.params.id,
       JSON.stringify(extrasNorm),
       peso_envase_vacio_kg != null ? Number(peso_envase_vacio_kg) : null,
       unidades_por_caja    != null ? Number(unidades_por_caja)    : null,
       peso_caja_vacia_kg   != null ? Number(peso_caja_vacia_kg)   : null,
       cajas_por_pale       != null ? Number(cajas_por_pale)       : null,
       peso_pale_vacio_kg   != null ? Number(peso_pale_vacio_kg)   : null]
    );
    if (!r) {
      // Fallback: si el id es de una receta legacy (recetas tipo='envasado'),
      // creamos una nueva fila en recetas_envasado con los datos editados y
      // desactivamos la receta legacy. La sustitución es transparente para el
      // usuario.
      const { rows: [legacy] } = await pool.query(
        `SELECT id, nombre FROM recetas WHERE id = $1 AND tipo_receta = 'envasado'`,
        [req.params.id]
      );
      if (!legacy) return res.status(404).json({ error: 'No encontrada' });
      const { rows: [nueva] } = await pool.query(
        `INSERT INTO recetas_envasado (
           nombre, producto_envasado_id,
           liquido_id, liquido_cantidad, liquido_unidad,
           envase_id, envases_por_bote,
           etiqueta_id, etiquetas_por_bote,
           lleva_caja, caja_id, extras
         ) VALUES ($1,$2,$3,$4::NUMERIC,$5,$6,$7::INT,$8,$9::INT,$10,$11,$12::JSONB)
         RETURNING id`,
        [String(nombre).trim(), producto_envasado_id,
         liquido_id, liquido_cantidad, liquido_unidad ?? 'kg',
         envase_id, envases_por_bote ?? 1,
         etiqueta_id ?? null, etiquetas_por_bote ?? 1,
         !!lleva_caja, lleva_caja ? caja_id : null,
         JSON.stringify(extrasNorm)]
      );
      // Desactivar la legacy
      await pool.query(`UPDATE recetas SET activa = FALSE WHERE id = $1`, [legacy.id]);
      const { rows: [full] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL} WHERE re.id = $1`, [nueva.id]);
      return res.json(full);
    }
    const { rows: [full] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL} WHERE re.id = $1`, [r.id]);
    res.json(full);
  } catch (err) {
    logger.error('[recetas-envasado.update]', { err });
    res.status(500).json({ error: 'Error actualizando receta' });
  }
});

// ── DELETE /api/recetas-envasado/:id — soft delete ──────
// Soporta IDs de recetas_envasado (nuevas) y recetas (legacy tipo='envasado').
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { rowCount: rcNew } = await pool.query(
      `UPDATE recetas_envasado SET activa = FALSE WHERE id = $1`, [req.params.id]
    );
    if (rcNew && rcNew > 0) return res.json({ ok: true });
    // Fallback: receta legacy
    const { rowCount: rcLegacy } = await pool.query(
      `UPDATE recetas SET activa = FALSE WHERE id = $1 AND tipo_receta = 'envasado'`,
      [req.params.id]
    );
    if (rcLegacy && rcLegacy > 0) return res.json({ ok: true });
    res.status(404).json({ error: 'No encontrada' });
  } catch (err) {
    res.status(500).json({ error: 'Error desactivando receta' });
  }
});

// ── POST /api/recetas-envasado/simular ─────────────────────
// Body: { config (receta inline o id), cantidad_botes }
// Devuelve necesidades de MP/embalajes para cantidad_botes + warnings de stock.
router.post('/simular', async (req: Request, res: Response) => {
  try {
    const { cantidad_botes } = req.body ?? {};
    if (cantidad_botes == null || Number(cantidad_botes) <= 0) {
      return res.status(400).json({ error: 'cantidad_botes > 0 obligatorio' });
    }
    let cfg = req.body?.config as Record<string, unknown> | undefined;
    if (req.body?.receta_id) {
      const { rows: [r] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL} WHERE re.id = $1`, [req.body.receta_id]);
      if (!r) return res.status(404).json({ error: 'Receta no encontrada' });
      cfg = r;
    }
    if (!cfg) return res.status(400).json({ error: 'config o receta_id obligatorio' });

    // El input `cantidad_botes` representa UNIDADES PE A FABRICAR (legacy name).
    // Si el PE es "caja con N botes" (lleva_caja=true + caja.unidades_por_envase>1),
    // cada PE contiene N envases. El multiplicador M agrupa esa relación:
    //   PE = 1 caja → consume 1 caja + M envases + M etiquetas + M × liquido kg.
    // Si el PE es un bote suelto (sin caja), M=1 → comportamiento legacy.
    const N = Number(cantidad_botes);
    const llevaCaja     = !!cfg.lleva_caja;
    const cajaUds       = Number(cfg.caja_uds ?? 1);
    const M = (llevaCaja && cajaUds > 1) ? cajaUds : Number(cfg.envases_por_bote ?? 1);
    const totalEnvases  = N * M; // total botes/frascos individuales producidos
    const liquidoCant   = cfg.liquido_id ? Number(cfg.liquido_cantidad ?? 0) * totalEnvases : 0;
    const envasesUd     = cfg.envase_id ? totalEnvases : 0;
    // Etiqueta = etiquetas_por_bote × N (por unidad PE/caja, no por envase individual).
    // 1 etiqueta/caja por defecto. Para etiquetar cada bote, poner = M.
    const etiquetasUd   = cfg.etiqueta_id ? Number(cfg.etiquetas_por_bote ?? 1) * N : 0;
    const cajasUd       = llevaCaja ? N : 0; // 1 caja por unidad PE
    const sobranBotes   = 0; // sin botes "sobrantes" — el PE define exactamente cuántos
    const peOrigenId    = cfg.pe_origen_id as string | undefined;

    // Stock check (consulta directa por id)
    const ids = [cfg.liquido_id, cfg.envase_id, cfg.etiqueta_id, cfg.caja_id, peOrigenId]
      .filter((x): x is string => typeof x === 'string');
    const { rows: stocks } = await pool.query<{ id: string; stock_actual: string; nombre: string; unidad_medida: string }>(
      `SELECT id, stock_actual, nombre, unidad_medida
       FROM productos WHERE id = ANY($1::UUID[])`, [ids]);
    const stockOf = (id: unknown): number => {
      const r = stocks.find(s => s.id === id);
      return r ? parseFloat(r.stock_actual) : 0;
    };

    const items: any[] = [];
    if (cfg.liquido_id) items.push({
      rol: 'liquido', id: cfg.liquido_id, nombre: cfg.liquido_nombre,
      codigo: cfg.liquido_codigo, unidad: cfg.liquido_unidad ?? cfg.liquido_unidad_default,
      cantidad: liquidoCant, stock: stockOf(cfg.liquido_id),
    });
    if (cfg.envase_id) items.push({
      rol: 'envase',  id: cfg.envase_id,  nombre: cfg.envase_nombre,
      codigo: cfg.envase_codigo, unidad: 'ud',
      cantidad: envasesUd, stock: stockOf(cfg.envase_id),
    });
    if (peOrigenId) {
      const pep = stocks.find(s => s.id === peOrigenId);
      items.push({
        rol: 'pe_origen', id: peOrigenId, nombre: pep?.nombre ?? 'PE origen',
        codigo: '', unidad: pep?.unidad_medida ?? 'ud',
        cantidad: N, stock: stockOf(peOrigenId),
      });
    }
    if (cfg.etiqueta_id) items.push({
      rol: 'etiqueta', id: cfg.etiqueta_id, nombre: cfg.etiqueta_nombre,
      codigo: cfg.etiqueta_codigo, unidad: 'ud',
      cantidad: etiquetasUd, stock: stockOf(cfg.etiqueta_id),
    });
    if (llevaCaja && cfg.caja_id) items.push({
      rol: 'caja', id: cfg.caja_id, nombre: cfg.caja_nombre,
      codigo: cfg.caja_codigo, unidad: 'ud',
      cantidad: cajasUd, stock: stockOf(cfg.caja_id),
    });

    // Extras (cinta, film, sellos, tapones…)
    const extras = Array.isArray(cfg.extras) ? cfg.extras as Array<{ producto_id: string; cantidad_por_bote: number }> : [];
    if (extras.length > 0) {
      const extraIds = extras.map(e => e.producto_id);
      const { rows: extraProds } = await pool.query<{ id: string; nombre: string; codigo: string; stock_actual: string; unidad_medida: string }>(
        `SELECT id, nombre, codigo, stock_actual, unidad_medida FROM productos WHERE id = ANY($1::UUID[])`, [extraIds]
      );
      for (const e of extras) {
        const p = extraProds.find(x => x.id === e.producto_id);
        if (!p) continue;
        items.push({
          rol: 'extra', id: p.id, nombre: p.nombre, codigo: p.codigo,
          unidad: p.unidad_medida ?? 'ud',
          cantidad: Number(e.cantidad_por_bote) * totalEnvases,
          stock: parseFloat(p.stock_actual),
        });
      }
    }

    // Para cada item, calcular el plan FEFO de lotes que se consumirán.
    const itemIds = items.map(it => it.id).filter((x): x is string => typeof x === 'string');
    const { rows: lotesAll } = await pool.query<{
      producto_id: string; lote_interno: string; lote_proveedor: string | null;
      cantidad_actual: string; precio_compra: string | null;
      fecha_caducidad: string | null; fecha_entrada: string;
    }>(
      `SELECT producto_id, lote_interno, lote_proveedor, cantidad_actual,
              precio_compra, fecha_caducidad, fecha_entrada
       FROM lotes
       WHERE producto_id = ANY($1::UUID[]) AND estado = 'aprobado' AND cantidad_actual > 0
       ORDER BY producto_id, fecha_caducidad ASC NULLS LAST, fecha_entrada ASC`,
      [itemIds]
    );
    for (const it of items) {
      const lotes = lotesAll.filter(l => l.producto_id === it.id);
      let restante = it.cantidad;
      const plan: Array<{ lote_interno: string; lote_proveedor: string | null;
        cantidad_a_usar: number; precio_compra: number | null;
        fecha_caducidad: string | null; fecha_entrada: string }> = [];
      for (const l of lotes) {
        if (restante <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, restante);
        plan.push({
          lote_interno: l.lote_interno,
          lote_proveedor: l.lote_proveedor,
          cantidad_a_usar: usar,
          precio_compra: l.precio_compra != null ? parseFloat(l.precio_compra) : null,
          fecha_caducidad: l.fecha_caducidad,
          fecha_entrada: l.fecha_entrada,
        });
        restante -= usar;
      }
      (it as any).lotes_fefo = plan;
    }

    const insuficientes = items.filter(it => it.stock < it.cantidad).length;
    res.json({
      cantidad_botes: N,
      total_envases: totalEnvases,
      multiplicador: M,
      items,
      sobran_botes: sobranBotes,
      insuficientes,
      stock_ok: insuficientes === 0,
    });
  } catch (err) {
    logger.error('[recetas-envasado.simular]', { err });
    res.status(500).json({ error: 'Error simulando' });
  }
});

// ── POST /api/recetas-envasado/ejecutar ─────────────────────
// Crea una orden de envasado:
//   - Descuenta FEFO de líquido + envase + etiqueta + caja (si aplica)
//   - Inserta stock_moves
//   - Crea ordenes_produccion (tipo='envasado') con referencia a receta_envasado_id
//   - Si guardar_receta=true y no había receta_id → la persiste tras la OF
// Body: { receta_id? | config?, cantidad_botes, guardar_receta?, nombre_receta? }
router.post('/ejecutar', async (req: Request, res: Response) => {
  const { cantidad_botes, guardar_receta, nombre_receta } = req.body ?? {};
  if (cantidad_botes == null || Number(cantidad_botes) <= 0) {
    return res.status(400).json({ error: 'cantidad_botes > 0 obligatorio' });
  }
  const userId = (req as Request & { user?: { id: string } }).user?.id ?? null;

  // Carga config a partir de receta_id o body.config
  let cfgLoaded: Record<string, unknown> | undefined;
  if (req.body?.receta_id) {
    const { rows: [r] } = await pool.query(`SELECT ${SELECT_FULL} ${FROM_FULL} WHERE re.id = $1`, [req.body.receta_id]);
    if (!r) return res.status(404).json({ error: 'Receta no encontrada' });
    cfgLoaded = r;
  } else if (req.body?.config) {
    cfgLoaded = req.body.config;
  }
  if (!cfgLoaded) return res.status(400).json({ error: 'config o receta_id obligatorio' });
  const cfg = cfgLoaded;

  // Para guardar la receta necesitamos los ids; validamos
  if (guardar_receta && !req.body?.receta_id) {
    const e = validar({ ...cfg, nombre: nombre_receta ?? cfg.nombre });
    if (e) return res.status(400).json({ error: `Receta inválida: ${e}` });
  }

  // N = unidades PE a fabricar (= cajas si lleva caja).
  // M = envases dentro de cada PE (= caja.unidades_por_envase si aplica).
  // totalEnvases = N × M = botes/frascos individuales consumidos.
  // Cantidades de PE producidas, lote PE y stock_move PE usan N.
  // Cantidades de líquido/envase/etiqueta consumidas usan totalEnvases.
  const N = Number(cantidad_botes);
  const llevaCaja   = !!cfg.lleva_caja;
  const cajaUdsCfg  = Number(cfg.caja_uds ?? 1);
  const M = (llevaCaja && cajaUdsCfg > 1) ? cajaUdsCfg : Number(cfg.envases_por_bote ?? 1);
  const totalEnvases = N * M;
  const liquidoCant = cfg.liquido_id ? Number(cfg.liquido_cantidad ?? 0) * totalEnvases : 0;
  const liquidoConsumo = cfg.liquido_unidad === 'g' ? liquidoCant / 1000 :
                         cfg.liquido_unidad === 'mL' ? liquidoCant / 1000 :
                         liquidoCant;
  const envasesUd   = cfg.envase_id ? totalEnvases : 0;
  const peOrigenId  = cfg.pe_origen_id as string | undefined;
  // Etiqueta por unidad PE (por caja, no por envase individual).
  const etiquetasUd = cfg.etiqueta_id ? Number(cfg.etiquetas_por_bote ?? 1) * N : 0;
  const cajasUd     = llevaCaja ? N : 0; // 1 caja por unidad PE
  const extras      = Array.isArray(cfg.extras)
    ? (cfg.extras as Array<{ producto_id: string; cantidad_por_bote: number }>)
        .filter(e => e?.producto_id && Number(e?.cantidad_por_bote) > 0)
    : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Lock determinístico productos para evitar deadlocks
    const lockIds = [cfg.liquido_id, cfg.envase_id, cfg.etiqueta_id, cfg.caja_id, cfg.producto_envasado_id, peOrigenId,
                     ...extras.map(e => e.producto_id)]
      .filter((x): x is string => typeof x === 'string')
      .sort();
    const { rows: locked } = await client.query<{ id: string; nombre: string; stock_actual: string }>(
      `SELECT id, nombre, stock_actual FROM productos WHERE id = ANY($1::UUID[]) ORDER BY id FOR UPDATE`,
      [lockIds]
    );
    const stockOf = (id: unknown): { nombre: string; stock: number } => {
      const r = locked.find(x => x.id === id);
      return r ? { nombre: r.nombre, stock: parseFloat(r.stock_actual) } : { nombre: '?', stock: 0 };
    };

    // Validar stock antes de descontar
    const checks: Array<{ id: unknown; needed: number; label: string }> = [];
    if (cfg.liquido_id) checks.push({ id: cfg.liquido_id, needed: liquidoConsumo, label: 'líquido' });
    if (cfg.envase_id)  checks.push({ id: cfg.envase_id,  needed: envasesUd,      label: 'envase'  });
    if (peOrigenId)     checks.push({ id: peOrigenId,     needed: N,              label: 'PE origen' });
    if (cfg.etiqueta_id) checks.push({ id: cfg.etiqueta_id, needed: etiquetasUd, label: 'etiqueta' });
    if (llevaCaja && cfg.caja_id) checks.push({ id: cfg.caja_id, needed: cajasUd, label: 'caja' });
    for (const e of extras) checks.push({ id: e.producto_id, needed: Number(e.cantidad_por_bote) * totalEnvases, label: 'extra' });
    if (checks.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'sin_consumo', detalle: 'Selecciona al menos un componente a consumir.' });
    }
    for (const c of checks) {
      const s = stockOf(c.id);
      if (s.stock < c.needed - 0.001) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'stock_insuficiente',
          detalle: `Falta ${c.label}: necesitas ${c.needed.toFixed(2)}, hay ${s.stock.toFixed(2)} (${s.nombre})`,
        });
      }
    }

    // Crear OF para trazabilidad
    const { rows: [orden] } = await client.query<{ id: string; numero_orden: string }>(
      `INSERT INTO ordenes_produccion
         (receta_id, cantidad_planificada, cantidad_real_producida, estado, fecha_planificada,
          fecha_inicio, fecha_fin, notas, tipo_orden, cola_id, envase_id, formato_label,
          operario_id, creado_por_id, receta_envasado_id, producto_envasado_id)
       VALUES ((SELECT id FROM recetas WHERE activa = TRUE LIMIT 1),
               $1, $1, 'completada', CURRENT_DATE, NOW(), NOW(), $2, 'envasado',
               $3, $4, $5, $6::UUID, $6::UUID, $7::UUID, $8::UUID)
       RETURNING id, numero_orden`,
      [N,
       `Envasado: ${N} unidades PE${M > 1 ? ` (× ${M} envases = ${totalEnvases} botes)` : ''}${req.body.receta_id ? ' (receta)' : ''}`,
       cfg.liquido_id ?? null, cfg.envase_id ?? null,
       cfg.envase_nombre ?? null,
       userId,
       req.body.receta_id ?? null,
       cfg.producto_envasado_id ?? null]
    );

    // Helper: descontar FEFO + stock_moves
    const descontar = async (productoId: string, cantidad: number, motivo: string) => {
      const { rows: lotes } = await client.query<{ id: string; cantidad_actual: string }>(
        `SELECT id, cantidad_actual FROM lotes
         WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
        [productoId]
      );
      let resta = cantidad;
      for (const l of lotes) {
        if (resta <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, resta);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`,
          [usar.toFixed(6), l.id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
           VALUES ($1, $2, 'produccion_consumo', $3, $4, $5, $6, $7, $8)`,
          [productoId, l.id, (-usar).toFixed(6), disp.toFixed(6), (disp - usar).toFixed(6),
           orden.id, userId, motivo]
        );
        resta -= usar;
      }
      if (resta > 0.001) throw new Error(`STOCK_INSUFICIENTE_LOTES:${productoId}:${resta.toFixed(6)}`);
    };

    if (cfg.liquido_id) await descontar(String(cfg.liquido_id), liquidoConsumo, `Envasado ${orden.numero_orden} · líquido`);
    if (cfg.envase_id)  await descontar(String(cfg.envase_id),  envasesUd,      `Envasado ${orden.numero_orden} · envase`);
    if (peOrigenId)     await descontar(peOrigenId, N, `Empaquetado ${orden.numero_orden} · PE origen`);
    if (cfg.etiqueta_id) await descontar(String(cfg.etiqueta_id), etiquetasUd, `Envasado ${orden.numero_orden} · etiqueta`);
    if (llevaCaja && cfg.caja_id) await descontar(String(cfg.caja_id), cajasUd, `Envasado ${orden.numero_orden} · caja`);
    for (const e of extras) {
      await descontar(e.producto_id, Number(e.cantidad_por_bote) * totalEnvases, `Envasado ${orden.numero_orden} · extra`);
    }

    // Crear lote del PE resultante con coste = suma de componentes / botes
    const { rows: stocksAll } = await client.query<{ id: string; coste_medio_actual: string | null; precio_unitario: string | null }>(
      `SELECT id, coste_medio_actual, precio_unitario FROM productos WHERE id = ANY($1::UUID[])`,
      [[cfg.liquido_id, cfg.envase_id, cfg.etiqueta_id, cfg.caja_id, ...extras.map(e => e.producto_id)].filter(Boolean) as string[]]
    );
    const costeOf = (id: unknown): number => {
      const r = stocksAll.find(s => s.id === id);
      const c = parseFloat(r?.coste_medio_actual ?? '') || parseFloat(r?.precio_unitario ?? '') || 0;
      return c;
    };
    const costeExtras = extras.reduce((s, e) => s + costeOf(e.producto_id) * Number(e.cantidad_por_bote) * totalEnvases, 0);
    const costeTotal =
      costeOf(cfg.liquido_id) * liquidoConsumo
      + costeOf(cfg.envase_id) * envasesUd
      + (cfg.etiqueta_id ? costeOf(cfg.etiqueta_id) * etiquetasUd : 0)
      + (llevaCaja && cfg.caja_id ? costeOf(cfg.caja_id) * cajasUd : 0)
      + costeExtras;
    const costeUnitario = N > 0 ? costeTotal / N : 0;

    const year = new Date().getFullYear();
    const { rows: [seqRow] } = await client.query<{ n: number }>(`
      SELECT COALESCE(MAX(CAST(SUBSTRING(lote_interno FROM '\\d+$') AS INTEGER)), 0) + 1 AS n
      FROM lotes WHERE lote_interno LIKE $1
    `, [`PE-${year}-%`]);
    const loteInterno = `PE-${year}-${String(seqRow.n).padStart(4, '0')}`;
    const { rows: [loteRow] } = await client.query<{ id: string }>(`
      INSERT INTO lotes (producto_id, lote_interno, cantidad_inicial, cantidad_actual,
                         estado, fecha_fabricacion, precio_compra)
      VALUES ($1, $2, $3::NUMERIC, $3::NUMERIC, 'aprobado', CURRENT_DATE, $4::NUMERIC)
      RETURNING id
    `, [cfg.producto_envasado_id, loteInterno, N, costeUnitario.toFixed(6)]);

    // stock_move ENTRADA (produccion_salida) — para trazabilidad + finanzas
    const { rows: [peStock] } = await client.query<{ stock_actual: string }>(
      `SELECT stock_actual FROM productos WHERE id = $1`, [cfg.producto_envasado_id]
    );
    const peStockAntes = parseFloat(peStock?.stock_actual ?? '0') - N; // ya se aplicó trigger
    await client.query(
      `INSERT INTO stock_moves
         (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
       VALUES ($1, $2, 'produccion_salida', $3, $4, $5, $6, $7, $8)`,
      [cfg.producto_envasado_id, loteRow.id, N.toFixed(6),
       peStockAntes.toFixed(6), (peStockAntes + N).toFixed(6),
       orden.id, userId, `Envasado ${orden.numero_orden}: ${N} ud PE${M > 1 ? ` (${totalEnvases} botes)` : ''}`]
    );

    // Bumpear version
    await client.query(`UPDATE productos SET version = version + 1 WHERE id = ANY($1::UUID[])`,
      [lockIds]);

    // Guardar receta si se pidió (1 click)
    let recetaCreadaId: string | null = null;
    if (guardar_receta && !req.body?.receta_id) {
      const { rows: [r] } = await client.query<{ id: string }>(
        `INSERT INTO recetas_envasado (
           nombre, producto_envasado_id,
           liquido_id, liquido_cantidad, liquido_unidad,
           envase_id, envases_por_bote,
           etiqueta_id, etiquetas_por_bote,
           lleva_caja, caja_id, extras
         ) VALUES ($1,$2,$3,$4::NUMERIC,$5,$6,$7::INT,$8,$9::INT,$10,$11,$12::JSONB)
         RETURNING id`,
        [String(nombre_receta ?? cfg.nombre ?? `Envasado ${orden.numero_orden}`).trim(),
         cfg.producto_envasado_id,
         cfg.liquido_id, cfg.liquido_cantidad ?? (totalEnvases > 0 ? liquidoCant / totalEnvases : 0), cfg.liquido_unidad ?? 'kg',
         cfg.envase_id, cfg.envases_por_bote ?? 1,
         cfg.etiqueta_id ?? null, cfg.etiquetas_por_bote ?? 1,
         !!cfg.lleva_caja, cfg.lleva_caja ? cfg.caja_id : null,
         JSON.stringify(extras)]
      );
      recetaCreadaId = r.id;
      await client.query(`UPDATE ordenes_produccion SET receta_envasado_id = $1 WHERE id = $2`,
        [recetaCreadaId, orden.id]);
    }

    await client.query('COMMIT');
    // Auditoría · envasado ejecutado
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'ENVASADO_EJECUTADO', 'ordenes_produccion', $2, $3)`,
      [userId, orden.id,
       `${orden.numero_orden} · ${N} ud PE${M > 1 ? ` (${totalEnvases} botes)` : ''} · Lote PE: ${loteInterno}${recetaCreadaId ? ' · receta guardada' : ''}`]
    ).catch(() => undefined);
    res.json({
      ok: true,
      orden_id: orden.id,
      numero_orden: orden.numero_orden,
      lote_pe: loteInterno,
      coste_unitario: costeUnitario,
      receta_creada_id: recetaCreadaId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('STOCK_INSUFICIENTE_LOTES')) {
      return res.status(422).json({ error: 'stock_insuficiente_lotes', detalle: msg });
    }
    logger.error('[recetas-envasado.ejecutar]', { err });
    res.status(500).json({ error: 'Error ejecutando envasado' });
  } finally {
    client.release();
  }
});

export default router;
