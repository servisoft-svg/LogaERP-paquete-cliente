// Email pedido al proveedor con envío diferido.
import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const user = (req as any).user as { id?: string };
    const { producto_id, destinatarios, cantidad, notas, cuerpo_personalizado, programado_para } = req.body;
    if (!producto_id || !programado_para || !Array.isArray(destinatarios) || destinatarios.length === 0) {
      return res.status(400).json({ error: 'producto_id, destinatarios y programado_para son obligatorios' });
    }
    const { rows: [r] } = await pool.query(
      `INSERT INTO pedidos_programados
         (producto_id, destinatarios, cantidad, notas, cuerpo_personalizado, programado_para, creado_por)
       VALUES ($1, $2::TEXT[], $3::NUMERIC, $4, $5, $6::TIMESTAMPTZ, $7)
       RETURNING *`,
      [producto_id, destinatarios, Number(cantidad ?? 0), notas ?? null, cuerpo_personalizado ?? null, programado_para, user?.id ?? null]
    );
    res.status(201).json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre
       FROM pedidos_programados pp
       JOIN productos p ON p.id = pp.producto_id
       ORDER BY enviado ASC, programado_para ASC
       LIMIT 200`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM pedidos_programados WHERE id = $1 AND enviado = FALSE`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
