import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// POST /api/recetas/importar
router.post('/importar', async (req, res) => {
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
              p.unidad_medida, p.stock_actual, p.sds_url,
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
       ORDER BY p.nombre ASC`,
      [req.params.id]
    );

    return res.json({ ...receta, ingredientes });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/recetas
router.post('/', async (req, res) => {
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
router.put('/:id', async (req, res) => {
  try {
    const { nombre, rendimiento, notas, pasos, activa, tipo_receta, producto_id, ph_min, ph_max, solidos_min, solidos_max, viscosidad_min, viscosidad_max } = req.body;
    if (rendimiento != null && Number(rendimiento) <= 0) {
      return res.status(400).json({ error: 'rendimiento debe ser mayor que 0' });
    }
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
    return res.json(receta);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/recetas/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE recetas SET activa = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── Ingredientes ──────────────────────────────────────────────

// POST /api/recetas/:id/ingredientes
router.post('/:id/ingredientes', async (req, res) => {
  try {
    const { materia_prima_id, cantidad, porcentaje_merma, unidad_medida } = req.body;
    if (!materia_prima_id || !cantidad) {
      return res.status(400).json({ error: 'materia_prima_id y cantidad son obligatorios' });
    }
    const { rows: [ing] } = await pool.query(
      `INSERT INTO ingredientes_receta
         (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida)
       VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5)
       ON CONFLICT (receta_id, materia_prima_id)
       DO UPDATE SET cantidad = EXCLUDED.cantidad,
                     porcentaje_merma = EXCLUDED.porcentaje_merma,
                     unidad_medida = EXCLUDED.unidad_medida
       RETURNING *`,
      [
        req.params.id,
        materia_prima_id,
        Number(cantidad).toFixed(6),
        Number(porcentaje_merma ?? 0).toFixed(2),
        unidad_medida ?? 'kg',
      ]
    );
    return res.status(201).json(ing);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/recetas/:id/ingredientes/:ingId
router.put('/:id/ingredientes/:ingId', async (req, res) => {
  try {
    const { cantidad, porcentaje_merma, unidad_medida } = req.body;
    const { rows: [ing] } = await pool.query(
      `UPDATE ingredientes_receta
       SET cantidad = COALESCE($1::NUMERIC, cantidad),
           porcentaje_merma = COALESCE($2::NUMERIC, porcentaje_merma),
           unidad_medida = COALESCE($3, unidad_medida)
       WHERE id = $4 AND receta_id = $5
       RETURNING *`,
      [
        cantidad != null ? Number(cantidad).toFixed(6) : null,
        porcentaje_merma != null ? Number(porcentaje_merma).toFixed(2) : null,
        unidad_medida ?? null,
        req.params.ingId,
        req.params.id,
      ]
    );
    if (!ing) return res.status(404).json({ error: 'Ingrediente no encontrado' });
    return res.json(ing);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/recetas/:id/ingredientes/:ingId
router.delete('/:id/ingredientes/:ingId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM ingredientes_receta WHERE id = $1 AND receta_id = $2`,
      [req.params.ingId, req.params.id]
    );
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
