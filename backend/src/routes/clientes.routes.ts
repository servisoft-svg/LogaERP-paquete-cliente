import { Router } from 'express';
import { pool } from '../db/pool';
import { adminOnly } from '../middleware/auth';

const router = Router();

// GET /api/clientes
// Filtros:
//   ?q=<texto>           — busqueda accent-insensible por nombre / email / NIF
//   ?archivados=true     — solo archivados (ordenados por archivado_at DESC)
//   ?archivados=all      — todos (activos + archivados, marcados)
//   (sin parámetro)      — solo activos (no archivados)
router.get('/', async (req, res) => {
  try {
    const { q, archivados } = req.query as { q?: string; archivados?: string };
    const params: string[] = [];
    let where: string;
    let order: string;
    if (archivados === 'true') {
      where = `activo = TRUE AND archivado_at IS NOT NULL`;
      order = `ORDER BY archivado_at DESC`;
    } else if (archivados === 'all') {
      where = `activo = TRUE`;
      order = `ORDER BY archivado_at IS NULL DESC, nombre ASC`;
    } else {
      where = `activo = TRUE AND archivado_at IS NULL`;
      order = `ORDER BY nombre ASC`;
    }

    let sql = `SELECT * FROM clientes WHERE ${where}`;
    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(nombre) LIKE $${params.length} OR LOWER(COALESCE(email,'')) LIKE $${params.length} OR LOWER(COALESCE(nif,'')) LIKE $${params.length})`;
    }
    sql += ` ${order}`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/clientes/:id/archivar — mueve a la lista de archivados
router.post('/:id/archivar', adminOnly, async (req, res) => {
  try {
    const motivo = req.body?.motivo ? String(req.body.motivo).trim().slice(0, 200) : null;
    const { rows: [c] } = await pool.query(
      `UPDATE clientes
         SET archivado_at = COALESCE(archivado_at, NOW()),
             archivado_motivo = COALESCE($2, archivado_motivo),
             archivado_por_id = COALESCE($3, archivado_por_id)
       WHERE id = $1 AND activo = TRUE
       RETURNING *`,
      [req.params.id, motivo, (req as any).user?.id ?? null]
    );
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    // Auditoría
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'ARCHIVAR_CLIENTE', 'clientes', $2, $3)`,
      [(req as any).user?.id ?? null, c.id, `${c.nombre}${motivo ? ` · ${motivo}` : ''}`]
    ).catch(() => undefined);
    return res.json(c);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/clientes/:id/recuperar — saca de la lista de archivados
router.post('/:id/recuperar', adminOnly, async (req, res) => {
  try {
    const { rows: [c] } = await pool.query(
      `UPDATE clientes
         SET archivado_at = NULL,
             archivado_motivo = NULL,
             archivado_por_id = NULL,
             activo = TRUE
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'RECUPERAR_CLIENTE', 'clientes', $2, $3)`,
      [(req as any).user?.id ?? null, c.id, `${c.nombre} · vuelto a activos`]
    ).catch(() => undefined);
    return res.json(c);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [cli] } = await pool.query(
      `SELECT * FROM clientes WHERE id = $1`, [req.params.id]
    );
    if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json(cli);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/clientes
router.post('/', adminOnly, async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, nif, notas, codigo_postal } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'nombre es obligatorio' });
    }
    const cp = codigo_postal?.trim() ?? null;
    if (cp && !/^\d{5}$/.test(cp)) {
      return res.status(400).json({ error: 'codigo_postal debe tener 5 dígitos' });
    }
    const { rows: [cli] } = await pool.query(
      `INSERT INTO clientes (nombre, email, telefono, direccion, nif, notas, codigo_postal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        nombre.trim(),
        email?.trim().toLowerCase() ?? null,
        telefono ?? null,
        direccion ?? null,
        nif?.trim() ?? null,
        notas ?? null,
        cp,
      ]
    );
    return res.status(201).json(cli);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, nif, notas, activo, codigo_postal } = req.body;
    const cp = codigo_postal?.trim() ?? null;
    if (cp && !/^\d{5}$/.test(cp)) {
      return res.status(400).json({ error: 'codigo_postal debe tener 5 dígitos' });
    }
    const { rows: [cli] } = await pool.query(
      `UPDATE clientes SET
         nombre        = COALESCE($1, nombre),
         email         = $2,
         telefono      = $3,
         direccion     = $4,
         nif           = $5,
         notas         = $6,
         activo        = COALESCE($7, activo),
         codigo_postal = $8
       WHERE id = $9
       RETURNING *`,
      [
        nombre?.trim() ?? null,
        email?.trim().toLowerCase() ?? null,
        telefono ?? null,
        direccion ?? null,
        nif?.trim() ?? null,
        notas ?? null,
        activo ?? null,
        cp,
        req.params.id,
      ]
    );
    if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json(cli);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/clientes/:id/precios
// Devuelve el mapa producto_id → precio_unitario para este cliente,
// junto con num_usos y la fecha de último uso. Usado en el modal de
// pedidos para auto-rellenar el precio al elegir un producto.
router.get('/:id/precios', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT producto_id, precio_unitario::TEXT AS precio_unitario,
              num_usos, ultimo_uso_at
       FROM precios_cliente_producto
       WHERE cliente_id = $1
       ORDER BY ultimo_uso_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/clientes/:id  (soft delete)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query(`UPDATE clientes SET activo = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
