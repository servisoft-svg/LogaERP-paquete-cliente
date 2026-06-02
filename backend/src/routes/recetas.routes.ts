import { Router, Request } from 'express';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { adminOnly } from '../middleware/auth';

const router = Router();

// Crea un snapshot completo (cabecera + ingredientes) del estado ACTUAL de
// la receta antes de aplicar cualquier mutación. Si el snapshot es idéntico
// al más reciente, NO inserta (evita ruido cuando se "guarda" sin cambios).
async function snapshotReceta(recetaId: string, motivo: string, usuarioId?: string | null) {
  try {
    await pool.query(`
      WITH actual AS (
        SELECT r.id, r.version,
          jsonb_build_object(
            'nombre', r.nombre,
            'rendimiento', r.rendimiento,
            'notas', r.notas,
            'pasos', r.pasos,
            'ph_min', r.ph_min, 'ph_max', r.ph_max,
            'solidos_min', r.solidos_min, 'solidos_max', r.solidos_max,
            'viscosidad_min', r.viscosidad_min, 'viscosidad_max', r.viscosidad_max,
            'tipo_receta', r.tipo_receta,
            'producto_id', r.producto_id,
            'activa', r.activa,
            'ingredientes', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'materia_prima_id', ir.materia_prima_id,
                'cantidad', ir.cantidad,
                'porcentaje_merma', ir.porcentaje_merma,
                'unidad_medida', ir.unidad_medida,
                'paso_index', ir.paso_index
              )) FROM public.ingredientes_receta ir WHERE ir.receta_id = r.id
            ), '[]'::jsonb)
          ) AS snap
        FROM public.recetas r WHERE r.id = $1
      ),
      ultimo AS (
        SELECT snapshot, created_at FROM public.recetas_historial
        WHERE receta_id = $1
        ORDER BY created_at DESC LIMIT 1
      )
      INSERT INTO public.recetas_historial (receta_id, version, snapshot, motivo, usuario_id)
      SELECT a.id, a.version, a.snap, $2, $3
      FROM actual a
      WHERE NOT EXISTS (
        -- Dedupe: no insertar si el último snapshot es idéntico O si se hizo
        -- hace menos de 30s (ráfaga de cambios = 1 sola entrada en historial).
        SELECT 1 FROM ultimo u
        WHERE u.snapshot = a.snap
           OR (NOW() - u.created_at) < INTERVAL '5 seconds'
      )
    `, [recetaId, motivo, usuarioId ?? null]);
  } catch { /* snapshot fail-soft — no bloquea la operación principal */ }
}

// Valida que la unidad del ingrediente coincida con la unidad base del producto
// (la misma que usan los lotes). Si no, la fabricación restaría en escala
// errónea (ej. receta='gr' + producto='kg' → resta 100kg en vez de 0.1kg).
// Devuelve null si OK, o un string con el error si hay mismatch.
async function validarUnidadIngrediente(
  materia_prima_id: string,
  unidad_medida: string | undefined | null,
): Promise<string | null> {
  if (!unidad_medida) return null; // sin unidad enviada → se usará default 'kg'; se valida fuera
  const { rows: [prod] } = await pool.query<{ unidad_medida: string; nombre: string }>(
    `SELECT unidad_medida, nombre FROM productos WHERE id = $1`,
    [materia_prima_id]
  );
  if (!prod) return `Materia prima ${materia_prima_id} no encontrada`;
  if (String(unidad_medida).trim().toLowerCase() !== String(prod.unidad_medida).trim().toLowerCase()) {
    return `Unidad inconsistente para "${prod.nombre}": receta usa "${unidad_medida}" pero el producto está en "${prod.unidad_medida}". La fabricación restaría en escala incorrecta.`;
  }
  return null;
}

// POST /api/recetas/importar
router.post('/importar', adminOnly, async (req, res) => {
  try {
    const { recetas } = req.body;
    if (!Array.isArray(recetas)) return res.status(400).json({ error: 'recetas debe ser un array' });

    let creadas = 0;
    for (const r of recetas) {
      if (!r.nombre) continue;

      // Find or create product
      let producto_id = r.producto_id;
      if (!producto_id && r.producto_nombre) {
        const { rows } = await pool.query(`SELECT id FROM productos WHERE nombre ILIKE $1 LIMIT 1`, [r.producto_nombre]);
        if (rows.length > 0) producto_id = rows[0].id;
      }
      if (!producto_id) {
        // Auto-create PT
        const { rows: [maxCode] } = await pool.query(`SELECT codigo FROM productos WHERE tipo='producto_terminado' ORDER BY codigo DESC LIMIT 1`);
        let nextNum = 1;
        if (maxCode) { const m = maxCode.codigo.match(/PT-.*?(\d+)/); if (m) nextNum = parseInt(m[1], 10) + 1; }
        const codigo = `PT-${String(nextNum).padStart(3, '0')}`;
        const { rows: [newProd] } = await pool.query(
          `INSERT INTO productos (codigo, nombre, tipo, unidad_medida) VALUES ($1, $2, 'producto_terminado', 'kg') RETURNING id`,
          [codigo, r.nombre]
        );
        producto_id = newProd.id;
      }

      const { rows: [maxV] } = await pool.query(`SELECT COALESCE(MAX(version), 0) AS v FROM recetas WHERE producto_id = $1`, [producto_id]);
      const version = Number(maxV.v) + 1;

      const { rows: [receta] } = await pool.query(
        `INSERT INTO recetas (producto_id, nombre, version, rendimiento, notas)
         VALUES ($1, $2, $3, $4::NUMERIC, $5) RETURNING id`,
        [producto_id, r.nombre, version, Number(r.rendimiento ?? 1).toFixed(6), r.notas ?? null]
      );

      if (Array.isArray(r.ingredientes)) {
        for (const ing of r.ingredientes) {
          let mp_id = ing.materia_prima_id;
          if (!mp_id && ing.materia_prima_nombre) {
            const { rows } = await pool.query(`SELECT id FROM productos WHERE nombre ILIKE $1 AND tipo = 'materia_prima' LIMIT 1`, [`%${ing.materia_prima_nombre}%`]);
            if (rows.length > 0) mp_id = rows[0].id;
          }
          if (!mp_id) continue;
          if (!ing.cantidad || Number(ing.cantidad) <= 0) continue;

          const errUnidad = await validarUnidadIngrediente(mp_id, ing.unidad_medida);
          if (errUnidad) return res.status(400).json({ error: errUnidad });

          await pool.query(
            `INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida)
             VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5)`,
            [receta.id, mp_id, Number(ing.cantidad).toFixed(6), Number(ing.porcentaje_merma ?? 0).toFixed(2), ing.unidad_medida ?? 'kg']
          );
        }
      }
      creadas++;
    }
    res.json({ ok: true, creadas });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/recetas
router.get('/', async (req, res) => {
  try {
    const { producto_id, activa } = req.query;
    let sql = `
      SELECT r.*,
             p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
             (SELECT COUNT(*) FROM ingredientes_receta ir WHERE ir.receta_id = r.id) AS num_ingredientes,
             (SELECT COUNT(*) FROM ingredientes_receta ir
              JOIN productos mp ON mp.id = ir.materia_prima_id
              WHERE ir.receta_id = r.id) AS ingredientes_total,
             (SELECT COUNT(*) FROM ingredientes_receta ir
              JOIN productos mp ON mp.id = ir.materia_prima_id
              WHERE ir.receta_id = r.id
                AND mp.stock_actual < ir.cantidad) AS ingredientes_sin_stock,
             (SELECT FLOOR(MIN(
               mp.stock_actual / NULLIF(ir2.cantidad * (1 + ir2.porcentaje_merma/100.0) / r.rendimiento, 0)
             ))
             FROM ingredientes_receta ir2
             JOIN productos mp ON mp.id = ir2.materia_prima_id
             WHERE ir2.receta_id = r.id
             ) AS max_producible
      FROM recetas r
      JOIN productos p ON p.id = r.producto_id
      WHERE 1=1
    `;
    const params: string[] = [];
    let idx = 1;

    if (producto_id) { sql += ` AND r.producto_id = $${idx++}`; params.push(String(producto_id)); }
    if (activa !== undefined) { sql += ` AND r.activa = $${idx++}`; params.push(activa === 'false' ? 'false' : 'true'); }
    sql += ` ORDER BY p.nombre ASC, r.version DESC`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/recetas/:id  (con ingredientes)
router.get('/:id', async (req, res) => {
  try {
    const { rows: [receta] } = await pool.query(
      `SELECT r.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida
       FROM recetas r JOIN productos p ON p.id = r.producto_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!receta) return res.status(404).json({ error: 'Receta no encontrada' });

    const { rows: ingredientes } = await pool.query(
      `SELECT ir.*, p.nombre AS nombre_mp, p.codigo AS codigo_mp,
              p.unidad_medida, p.stock_actual, p.sds_url, p.confirmacion_msg,
              -- Stock realmente usable: solo lotes APROBADO con cantidad>0,
              -- restando reservas activas. Es lo que la fabricación puede consumir.
              COALESCE((
                SELECT SUM(GREATEST(0, l.cantidad_actual
                       - COALESCE((SELECT SUM(rs.cantidad) FROM reservas_stock rs WHERE rs.lote_id = l.id AND rs.estado = 'activa'), 0)))
                FROM lotes l
                WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
              ), 0) AS stock_disponible
       FROM ingredientes_receta ir
       JOIN productos p ON p.id = ir.materia_prima_id
       WHERE ir.receta_id = $1
       ORDER BY p.nombre ASC, ir.paso_index ASC NULLS LAST`,
      [req.params.id]
    );

    return res.json({ ...receta, ingredientes });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/recetas
router.post('/', adminOnly, async (req, res) => {
  try {
    let { producto_id } = req.body;
    const { nombre, rendimiento, notas, pasos, ingredientes, tipo_receta, ph_min, ph_max, solidos_min, solidos_max, viscosidad_min, viscosidad_max } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'nombre es obligatorio' });
    }
    if (rendimiento != null && Number(rendimiento) <= 0) {
      return res.status(400).json({ error: 'rendimiento debe ser mayor que 0' });
    }

    // Si no viene producto_id, crear producto automaticamente
    if (!producto_id) {
      const esEnvasado = tipo_receta === 'envasado';
      const prefijo = esEnvasado ? 'PE' : 'PF';
      const tipoProducto = esEnvasado ? 'producto_envasado' : 'producto_fabricado';
      const unidad = esEnvasado ? 'ud' : 'kg';

      // Buscar siguiente número disponible para ese prefijo
      const { rows: [maxCode] } = await pool.query(
        `SELECT codigo FROM productos WHERE codigo LIKE $1 || '-%' ORDER BY codigo DESC LIMIT 1`,
        [prefijo]
      );
      let nextNum = 1;
      if (maxCode) {
        const match = maxCode.codigo.match(new RegExp(`^${prefijo}-(\\d+)`));
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      const codigo = `${prefijo}-${String(nextNum).padStart(3, '0')}`;

      const { rows: [newProd] } = await pool.query(
        `INSERT INTO productos (codigo, nombre, tipo, unidad_medida)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [codigo, nombre.trim(), tipoProducto, unidad]
      );
      producto_id = newProd.id;
    }

    // Version auto: max(version) + 1 para ese producto
    const { rows: [maxV] } = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_v FROM recetas WHERE producto_id = $1`,
      [producto_id]
    );
    const version = Number(maxV.max_v) + 1;

    const { rows: [receta] } = await pool.query(
      `INSERT INTO recetas (producto_id, nombre, version, rendimiento, notas, pasos, tipo_receta, ph_min, ph_max, solidos_min, solidos_max, viscosidad_min, viscosidad_max)
       VALUES ($1, $2, $3, $4::NUMERIC, $5, $6::JSONB, $7, $8::NUMERIC, $9::NUMERIC, $10::NUMERIC, $11::NUMERIC, $12::NUMERIC, $13::NUMERIC)
       RETURNING *`,
      [producto_id, nombre.trim(), version, Number(rendimiento ?? 1).toFixed(6), notas ?? null,
       pasos ? JSON.stringify(pasos) : '[]', tipo_receta ?? 'fabricacion',
       ph_min ?? null, ph_max ?? null, solidos_min ?? null, solidos_max ?? null, viscosidad_min ?? null, viscosidad_max ?? null]
    );

    // Insertar ingredientes si vienen en el body
    if (Array.isArray(ingredientes) && ingredientes.length > 0) {
      for (const ing of ingredientes) {
        if (!ing.materia_prima_id || !ing.cantidad) continue;
        const errUnidad = await validarUnidadIngrediente(ing.materia_prima_id, ing.unidad_medida);
        if (errUnidad) return res.status(400).json({ error: errUnidad });
        await pool.query(
          `INSERT INTO ingredientes_receta
             (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida)
           VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5)`,
          [
            receta.id,
            ing.materia_prima_id,
            Number(ing.cantidad).toFixed(6),
            Number(ing.porcentaje_merma ?? 0).toFixed(2),
            ing.unidad_medida ?? 'kg',
          ]
        );
      }
    }

    invalidarCacheFinanzas();
    return res.status(201).json(receta);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      if (msg.includes('productos_codigo')) return res.status(409).json({ error: 'Ya existe un producto con ese código. Prueba con otro nombre.' });
      if (msg.includes('recetas_producto_id_version')) return res.status(409).json({ error: 'Ya existe una receta para este producto. Edita la existente o cambia el nombre.' });
      return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
    }
    return res.status(500).json({ error: 'Error al crear la receta. Inténtalo de nuevo.' });
  }
});

// PUT /api/recetas/:id
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nombre, rendimiento, notas, pasos, activa, tipo_receta, producto_id, ph_min, ph_max, solidos_min, solidos_max, viscosidad_min, viscosidad_max } = req.body;
    if (rendimiento != null && Number(rendimiento) <= 0) {
      return res.status(400).json({ error: 'rendimiento debe ser mayor que 0' });
    }
    await snapshotReceta(req.params.id, 'Edición de receta', (req as any).user?.id);
    const { rows: [receta] } = await pool.query(
      `UPDATE recetas SET
         nombre     = COALESCE($1, nombre),
         rendimiento = COALESCE($2::NUMERIC, rendimiento),
         notas      = $3,
         activa     = COALESCE($4, activa),
         pasos      = COALESCE($6::JSONB, pasos),
         tipo_receta = COALESCE($7, tipo_receta),
         producto_id = COALESCE($14::UUID, producto_id),
         ph_min     = $8::NUMERIC,
         ph_max     = $9::NUMERIC,
         solidos_min = $10::NUMERIC,
         solidos_max = $11::NUMERIC,
         viscosidad_min = $12::NUMERIC,
         viscosidad_max = $13::NUMERIC
       WHERE id = $5
       RETURNING *`,
      [nombre?.trim() ?? null, rendimiento != null ? Number(rendimiento).toFixed(6) : null,
       notas ?? null, activa ?? null, req.params.id,
       pasos !== undefined ? JSON.stringify(pasos) : null, tipo_receta ?? null,
       ph_min ?? null, ph_max ?? null, solidos_min ?? null, solidos_max ?? null, viscosidad_min ?? null, viscosidad_max ?? null,
       producto_id ?? null]
    );
    if (!receta) return res.status(404).json({ error: 'Receta no encontrada' });
    invalidarCacheFinanzas();
    return res.json(receta);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/recetas/:id  (soft delete)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query(`UPDATE recetas SET activa = FALSE WHERE id = $1`, [req.params.id]);
    invalidarCacheFinanzas();
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── Ingredientes ──────────────────────────────────────────────

// POST /api/recetas/:id/ingredientes
// Si el cliente envía `permitir_duplicado: true`, inserta una nueva fila
// aunque ya exista esa MP en la receta (necesario para repartir el agua en
// varias partes con distinto paso_index). Sin el flag, mantiene el legacy
// upsert que actualiza la cantidad de la fila existente.
router.post('/:id/ingredientes', adminOnly, async (req, res) => {
  try {
    const { materia_prima_id, cantidad, porcentaje_merma, unidad_medida, paso_index, permitir_duplicado } = req.body;
    if (!materia_prima_id || !cantidad) {
      return res.status(400).json({ error: 'materia_prima_id y cantidad son obligatorios' });
    }
    const errUnidad = await validarUnidadIngrediente(materia_prima_id, unidad_medida);
    if (errUnidad) return res.status(400).json({ error: errUnidad });
    const recetaId = req.params.id;
    await snapshotReceta(recetaId, 'Antes de añadir ingrediente', (req as any).user?.id);
    const pasoIdx = paso_index != null && !isNaN(Number(paso_index)) ? Number(paso_index) : null;

    if (!permitir_duplicado) {
      const { rows: existentes } = await pool.query(
        `SELECT id FROM ingredientes_receta
         WHERE receta_id = $1 AND materia_prima_id = $2 LIMIT 1`,
        [recetaId, materia_prima_id]
      );
      if (existentes.length > 0) {
        const { rows: [ing] } = await pool.query(
          `UPDATE ingredientes_receta
           SET cantidad = $1::NUMERIC,
               porcentaje_merma = $2::NUMERIC,
               unidad_medida = $3,
               paso_index = COALESCE($4::INT, paso_index)
           WHERE id = $5
           RETURNING *`,
          [
            Number(cantidad).toFixed(6),
            Number(porcentaje_merma ?? 0).toFixed(2),
            unidad_medida ?? 'kg',
            pasoIdx,
            existentes[0].id,
          ]
        );
        invalidarCacheFinanzas();
        return res.status(200).json(ing);
      }
    }

    const { rows: [ing] } = await pool.query(
      `INSERT INTO ingredientes_receta
         (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida, paso_index)
       VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5, $6::INT)
       RETURNING *`,
      [
        recetaId,
        materia_prima_id,
        Number(cantidad).toFixed(6),
        Number(porcentaje_merma ?? 0).toFixed(2),
        unidad_medida ?? 'kg',
        pasoIdx,
      ]
    );
    invalidarCacheFinanzas();
    return res.status(201).json(ing);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/recetas/:id/ingredientes/:ingId
router.put('/:id/ingredientes/:ingId', adminOnly, async (req, res) => {
  try {
    const { cantidad, porcentaje_merma, unidad_medida, paso_index } = req.body;
    if (unidad_medida) {
      const { rows: [ingActual] } = await pool.query<{ materia_prima_id: string }>(
        `SELECT materia_prima_id FROM ingredientes_receta WHERE id = $1 AND receta_id = $2`,
        [req.params.ingId, req.params.id]
      );
      if (ingActual) {
        const errUnidad = await validarUnidadIngrediente(ingActual.materia_prima_id, unidad_medida);
        if (errUnidad) return res.status(400).json({ error: errUnidad });
      }
    }
    await snapshotReceta(req.params.id, 'Antes de editar ingrediente', (req as any).user?.id);
    // paso_index sólo se modifica si la clave está presente en el body
    // (permite limpiarlo enviando null, conservarlo omitiéndolo).
    const updatePaso = Object.prototype.hasOwnProperty.call(req.body, 'paso_index');
    const pasoIdxParam = updatePaso
      ? (paso_index != null && !isNaN(Number(paso_index)) ? Number(paso_index) : null)
      : null;
    const { rows: [ing] } = await pool.query(
      `UPDATE ingredientes_receta
       SET cantidad = COALESCE($1::NUMERIC, cantidad),
           porcentaje_merma = COALESCE($2::NUMERIC, porcentaje_merma),
           unidad_medida = COALESCE($3, unidad_medida),
           paso_index = CASE WHEN $6::BOOLEAN THEN $7::INT ELSE paso_index END
       WHERE id = $4 AND receta_id = $5
       RETURNING *`,
      [
        cantidad != null ? Number(cantidad).toFixed(6) : null,
        porcentaje_merma != null ? Number(porcentaje_merma).toFixed(2) : null,
        unidad_medida ?? null,
        req.params.ingId,
        req.params.id,
        updatePaso,
        pasoIdxParam,
      ]
    );
    if (!ing) return res.status(404).json({ error: 'Ingrediente no encontrado' });
    invalidarCacheFinanzas();
    return res.json(ing);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/recetas/:id/ingredientes/:ingId
router.delete('/:id/ingredientes/:ingId', adminOnly, async (req, res) => {
  try {
    await snapshotReceta(req.params.id, 'Antes de eliminar ingrediente', (req as any).user?.id);
    await pool.query(
      `DELETE FROM ingredientes_receta WHERE id = $1 AND receta_id = $2`,
      [req.params.ingId, req.params.id]
    );
    invalidarCacheFinanzas();
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/recetas/:id/historial — lista snapshots ordenados (más reciente primero)
router.get('/:id/historial', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.version, h.motivo, h.created_at, h.snapshot,
              u.nombre AS usuario_nombre
       FROM public.recetas_historial h
       LEFT JOIN public.usuarios u ON u.id = h.usuario_id
       WHERE h.receta_id = $1
       ORDER BY h.created_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/recetas/:id/historial/:historialId — borrar una versión del historial
router.delete('/:id/historial/:historialId', adminOnly, async (req, res) => {
  try {
    const { id: recetaId, historialId } = req.params;
    const { rowCount } = await pool.query(
      `DELETE FROM public.recetas_historial WHERE id = $1 AND receta_id = $2`,
      [historialId, recetaId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Versión no encontrada' });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/recetas/:id/restaurar/:historialId — restaura receta a un snapshot
router.post('/:id/restaurar/:historialId', adminOnly, async (req: Request, res) => {
  const client = await pool.connect();
  try {
    const { id: recetaId, historialId } = req.params;
    const { rows: [snap] } = await client.query(
      `SELECT version, snapshot FROM public.recetas_historial
       WHERE id = $1 AND receta_id = $2`,
      [historialId, recetaId]
    );
    if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });

    await client.query('BEGIN');
    // No se crea snapshot al restaurar — solo se snapshotea cuando hay una
    // edición real. Restaurar es una acción "vuelve al estado X", no una
    // modificación que merezca su propia entrada en el historial.

    const s = snap.snapshot as Record<string, any>;
    // Al restaurar, la version vuelve a la del snapshot (NO bumpea). El trigger
    // auto-version solo bumpea si NEW.version == OLD.version; aquí se cambia
    // explícitamente, así que no incrementa.
    await client.query(
      `UPDATE public.recetas SET
         nombre = COALESCE($1, nombre),
         rendimiento = COALESCE($2::NUMERIC, rendimiento),
         notas = $3,
         pasos = COALESCE($4::JSONB, pasos),
         tipo_receta = COALESCE($5, tipo_receta),
         producto_id = COALESCE($6::UUID, producto_id),
         ph_min = $7::NUMERIC, ph_max = $8::NUMERIC,
         solidos_min = $9::NUMERIC, solidos_max = $10::NUMERIC,
         viscosidad_min = $11::NUMERIC, viscosidad_max = $12::NUMERIC,
         version = $14::SMALLINT
       WHERE id = $13`,
      [
        s.nombre ?? null,
        s.rendimiento != null ? Number(s.rendimiento) : null,
        s.notas ?? null,
        s.pasos != null ? JSON.stringify(s.pasos) : null,
        s.tipo_receta ?? null,
        s.producto_id ?? null,
        s.ph_min ?? null, s.ph_max ?? null,
        s.solidos_min ?? null, s.solidos_max ?? null,
        s.viscosidad_min ?? null, s.viscosidad_max ?? null,
        recetaId,
        snap.version,
      ]
    );
    // Reemplazar ingredientes: borrar todos y reinsertar los del snapshot
    await client.query(`DELETE FROM public.ingredientes_receta WHERE receta_id = $1`, [recetaId]);
    for (const ing of (s.ingredientes ?? [])) {
      await client.query(
        `INSERT INTO public.ingredientes_receta
           (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida, paso_index)
         VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5, $6::INT)`,
        [
          recetaId, ing.materia_prima_id,
          Number(ing.cantidad ?? 0).toFixed(6),
          Number(ing.porcentaje_merma ?? 0).toFixed(2),
          ing.unidad_medida ?? 'kg',
          ing.paso_index != null ? Number(ing.paso_index) : null,
        ]
      );
    }
    // El trigger fn_recetas_touch_on_ingredientes bumpea version en cada
    // INSERT/DELETE/UPDATE de ingredientes_receta. Tras restaurar todos los
    // ingredientes, forzamos version al valor del snapshot.
    await client.query(`UPDATE public.recetas SET version = $2::SMALLINT WHERE id = $1`, [recetaId, snap.version]);
    await client.query('COMMIT');
    invalidarCacheFinanzas();
    return res.json({ ok: true, version_restaurada: snap.version });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al restaurar' });
  } finally {
    client.release();
  }
});

export default router;
