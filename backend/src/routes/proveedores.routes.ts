import { Router } from 'express';
import { pool } from '../db/pool';
import { adminOnly } from '../middleware/auth';

const router = Router();

// GET /api/proveedores
router.get('/', async (req, res) => {
  try {
    const incluirInactivos = req.query.todos === 'true';
    const { rows } = await pool.query(
      `SELECT pv.*,
              COUNT(p.id) AS num_productos
       FROM proveedores pv
       LEFT JOIN productos p ON p.proveedor_id = pv.id AND p.activo = TRUE
       ${incluirInactivos ? '' : 'WHERE pv.activo = TRUE'}
       GROUP BY pv.id
       ORDER BY pv.nombre ASC`
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/proveedores/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [prov] } = await pool.query(
      `SELECT * FROM proveedores WHERE id = $1`, [req.params.id]
    );
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    return res.json(prov);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// Normaliza un array/string de emails → array de emails limpios y únicos
function normalizarEmails(input: unknown): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input.join(',') : String(input);
  const out = new Set<string>();
  for (const e of raw.split(/[,;\n]/)) {
    const t = e.trim().toLowerCase();
    if (t) out.add(t);
  }
  return Array.from(out);
}

// POST /api/proveedores
router.post('/', adminOnly, async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, emails_adicionales } = req.body;
    if (!nombre || !email) {
      return res.status(400).json({ error: 'nombre y email son obligatorios' });
    }
    const adicionales = normalizarEmails(emails_adicionales);
    const { rows: [prov] } = await pool.query(
      `INSERT INTO proveedores (nombre, email, telefono, direccion, emails_adicionales)
       VALUES ($1, $2, $3, $4, $5::TEXT[])
       RETURNING *`,
      [nombre.trim(), email.trim().toLowerCase(), telefono ?? null, direccion ?? null,
       adicionales.length > 0 ? adicionales : null]
    );
    return res.status(201).json(prov);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/proveedores/:id
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nombre, email, telefono, direccion, activo, emails_adicionales } = req.body;
    const adicionales = emails_adicionales !== undefined ? normalizarEmails(emails_adicionales) : null;
    const { rows: [prov] } = await pool.query(
      `UPDATE proveedores SET
         nombre              = COALESCE($1, nombre),
         email               = COALESCE($2, email),
         telefono            = $3,
         direccion           = $4,
         activo              = COALESCE($5, activo),
         emails_adicionales  = COALESCE($6::TEXT[], emails_adicionales)
       WHERE id = $7
       RETURNING *`,
      [nombre?.trim() ?? null, email?.trim().toLowerCase() ?? null,
       telefono ?? null, direccion ?? null, activo ?? null,
       adicionales,
       req.params.id]
    );
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    return res.json(prov);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/proveedores/:id  (soft delete)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query(`UPDATE proveedores SET activo = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
