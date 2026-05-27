// Catálogo flexible de especificaciones físico-químicas.
// CRUD del catálogo + endpoints para asignar specs a productos y leer valores de lotes.
import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// ── Catálogo ────────────────────────────────────────────────────────────────

router.get('/catalogo', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, unidad, decimales, rango_min, rango_max, activo
       FROM spec_catalogo
       WHERE activo = true
       ORDER BY nombre`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/catalogo', async (req, res) => {
  try {
    const { nombre, unidad, decimales, rango_min, rango_max } = req.body;
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'nombre obligatorio' });
    }
    const nombreClean = String(nombre).trim();
    const unidadClean = unidad != null && String(unidad).trim() !== '' ? String(unidad).trim() : null;
    const decimalesClean = decimales ?? null;
    const rangoMinClean = rango_min != null && rango_min !== '' ? Number(rango_min) : null;
    const rangoMaxClean = rango_max != null && rango_max !== '' ? Number(rango_max) : null;

    // UPSERT case-insensitive: si ya existe (activo o no), lo reactiva y sobreescribe.
    // Resuelve el caso "borré pureza → quiero volver a crearla con mismo nombre".
    const { rows: [existente] } = await pool.query(
      `SELECT id, activo FROM spec_catalogo WHERE LOWER(nombre) = LOWER($1) LIMIT 1`,
      [nombreClean]
    );
    if (existente) {
      const { rows } = await pool.query(
        `UPDATE spec_catalogo SET
           nombre    = $1,
           unidad    = $2,
           decimales = COALESCE($3::SMALLINT, decimales),
           rango_min = $4::NUMERIC,
           rango_max = $5::NUMERIC,
           activo    = TRUE
         WHERE id = $6
         RETURNING *`,
        [nombreClean, unidadClean, decimalesClean, rangoMinClean, rangoMaxClean, existente.id]
      );
      return res.status(200).json(rows[0]);
    }

    const { rows } = await pool.query(
      `INSERT INTO spec_catalogo (nombre, unidad, decimales, rango_min, rango_max)
       VALUES ($1, $2, COALESCE($3::SMALLINT, 2), $4::NUMERIC, $5::NUMERIC)
       RETURNING *`,
      [nombreClean, unidadClean, decimalesClean, rangoMinClean, rangoMaxClean]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.put('/catalogo/:id', async (req, res) => {
  try {
    const { nombre, unidad, decimales, rango_min, rango_max, activo } = req.body;
    const nombreClean = nombre != null ? String(nombre).trim() : null;
    // Comprueba colisión de nombre case-insensitive con otra fila distinta
    if (nombreClean) {
      const { rows: [chk] } = await pool.query(
        `SELECT id FROM spec_catalogo WHERE LOWER(nombre) = LOWER($1) AND id <> $2 LIMIT 1`,
        [nombreClean, req.params.id]
      );
      if (chk) return res.status(409).json({ error: 'Otra spec ya usa ese nombre' });
    }
    const { rows } = await pool.query(
      `UPDATE spec_catalogo SET
         nombre    = COALESCE($1, nombre),
         unidad    = $2,
         decimales = COALESCE($3::SMALLINT, decimales),
         rango_min = $4::NUMERIC,
         rango_max = $5::NUMERIC,
         activo    = COALESCE($6, activo)
       WHERE id = $7
       RETURNING *`,
      [
        nombreClean,
        unidad != null && String(unidad).trim() !== '' ? String(unidad).trim() : null,
        decimales ?? null,
        rango_min != null && rango_min !== '' ? Number(rango_min) : null,
        rango_max != null && rango_max !== '' ? Number(rango_max) : null,
        activo ?? null,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/catalogo/:id', async (req, res) => {
  try {
    // Soft delete: marcar inactivo para no romper FK con producto_specs/lote_specs
    await pool.query(`UPDATE spec_catalogo SET activo = false WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Specs asignadas a un producto ───────────────────────────────────────────

router.get('/producto/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ps.spec_id, ps.min_valor, ps.max_valor, ps.orden, ps.parametros,
              sc.nombre, sc.unidad, sc.decimales
       FROM producto_specs ps
       JOIN spec_catalogo sc ON sc.id = ps.spec_id
       WHERE ps.producto_id = $1
       ORDER BY ps.orden, sc.nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Reemplaza todas las specs de un producto en una transacción
router.put('/producto/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const specs: Array<{ spec_id: number; min_valor?: number | string | null; max_valor?: number | string | null; orden?: number; parametros?: Record<string, unknown> | null }> =
      Array.isArray(req.body) ? req.body : (req.body?.specs ?? []);

    await client.query('BEGIN');
    await client.query(`DELETE FROM producto_specs WHERE producto_id = $1`, [req.params.id]);

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      if (s.spec_id == null) continue;
      await client.query(
        `INSERT INTO producto_specs (producto_id, spec_id, min_valor, max_valor, orden, parametros)
         VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5, $6::JSONB)
         ON CONFLICT (producto_id, spec_id) DO UPDATE
           SET min_valor  = EXCLUDED.min_valor,
               max_valor  = EXCLUDED.max_valor,
               orden      = EXCLUDED.orden,
               parametros = EXCLUDED.parametros`,
        [
          req.params.id,
          s.spec_id,
          s.min_valor != null && s.min_valor !== '' ? Number(s.min_valor) : null,
          s.max_valor != null && s.max_valor !== '' ? Number(s.max_valor) : null,
          s.orden ?? i,
          s.parametros != null ? JSON.stringify(s.parametros) : null,
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: specs.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// ── Valores medidos en un lote ──────────────────────────────────────────────

router.get('/lote/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ls.spec_id, ls.valor, sc.nombre, sc.unidad, sc.decimales
       FROM lote_specs ls
       JOIN spec_catalogo sc ON sc.id = ls.spec_id
       WHERE ls.lote_id = $1
       ORDER BY sc.nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
