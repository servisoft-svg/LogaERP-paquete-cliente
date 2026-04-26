import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `SELECT * FROM clientes WHERE activo = TRUE`;
    const params: string[] = [];

    if (q && typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(nombre) LIKE $1 OR LOWER(COALESCE(email,'')) LIKE $1 OR LOWER(COALESCE(nif,'')) LIKE $1)`;
    }

    sql += ` ORDER BY nombre ASC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
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
router.post('/', async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, nif, notas } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'nombre es obligatorio' });
    }
    const { rows: [cli] } = await pool.query(
      `INSERT INTO clientes (nombre, email, telefono, direccion, nif, notas)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        nombre.trim(),
        email?.trim().toLowerCase() ?? null,
        telefono ?? null,
        direccion ?? null,
        nif?.trim() ?? null,
        notas ?? null,
      ]
    );
    return res.status(201).json(cli);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, nif, notas, activo } = req.body;
    const { rows: [cli] } = await pool.query(
      `UPDATE clientes SET
         nombre    = COALESCE($1, nombre),
         email     = $2,
         telefono  = $3,
         direccion = $4,
         nif       = $5,
         notas     = $6,
         activo    = COALESCE($7, activo)
       WHERE id = $8
       RETURNING *`,
      [
        nombre?.trim() ?? null,
        email?.trim().toLowerCase() ?? null,
        telefono ?? null,
        direccion ?? null,
        nif?.trim() ?? null,
        notas ?? null,
        activo ?? null,
        req.params.id,
      ]
    );
    if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json(cli);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/clientes/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE clientes SET activo = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
