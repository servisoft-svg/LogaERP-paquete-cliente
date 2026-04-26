import { Router } from 'express';
import { pool } from '../db/pool';
import { stockController } from '../controllers/stock.controller';

const router = Router();

router.get ('/',                    stockController.listarProductos);
router.post('/ajuste',              stockController.ajustarStock);
router.get ('/notificaciones',      stockController.notificaciones);
router.post('/pedido',              stockController.enviarPedido);
router.get ('/:id/historial',       stockController.historial);
router.get ('/:id/cantidad-sugerida', stockController.cantidadSugerida);

// GET /api/stock/reconciliar — verify and fix stock_actual vs SUM(lotes)
router.get('/reconciliar', async (_req, res) => {
  try {
    const { rows: discrepancias } = await pool.query(`
      SELECT p.id, p.codigo, p.nombre,
        ROUND(p.stock_actual::NUMERIC, 2) AS stock_actual,
        ROUND(COALESCE(s.suma, 0)::NUMERIC, 2) AS stock_lotes,
        ROUND((p.stock_actual - COALESCE(s.suma, 0))::NUMERIC, 2) AS diferencia
      FROM productos p
      LEFT JOIN LATERAL (
        SELECT SUM(l.cantidad_actual) AS suma FROM lotes l
        WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
      ) s ON true
      WHERE p.activo = true
        AND ABS(p.stock_actual - COALESCE(s.suma, 0)) > 0.001
      ORDER BY ABS(p.stock_actual - COALESCE(s.suma, 0)) DESC
    `);
    return res.json({ ok: true, discrepancias, total: discrepancias.length });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/stock/reconciliar — fix all discrepancies WITH audit trail in stock_moves
router.post('/reconciliar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = (req as any).user?.id ?? null;

    // Find all discrepancies
    const { rows: discrepancias } = await client.query(`
      SELECT p.id, p.codigo, p.nombre, p.stock_actual,
        COALESCE(s.suma, 0) AS stock_lotes,
        (COALESCE(s.suma, 0) - p.stock_actual) AS diferencia
      FROM productos p
      LEFT JOIN LATERAL (
        SELECT SUM(l.cantidad_actual) AS suma FROM lotes l
        WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
      ) s ON true
      WHERE p.activo = true
        AND ABS(p.stock_actual - COALESCE(s.suma, 0)) > 0.001
      FOR UPDATE OF p
    `);

    for (const d of discrepancias) {
      const antes = parseFloat(d.stock_actual);
      const despues = parseFloat(d.stock_lotes);
      const diferencia = despues - antes;

      // Update stock_actual
      await client.query(
        `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
        [despues.toFixed(6), d.id]
      );

      // Create stock_move for audit trail
      await client.query(
        `INSERT INTO stock_moves
           (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
         VALUES ($1, 'ajuste', $2::NUMERIC, $3::NUMERIC, $4::NUMERIC, $5, $6)`,
        [
          d.id,
          diferencia.toFixed(6),
          antes.toFixed(6),
          despues.toFixed(6),
          userId,
          `Ajuste automático vía Reconciliación (${d.codigo}: ${antes.toFixed(3)} → ${despues.toFixed(3)})`,
        ]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true, corregidos: discrepancias.length });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  } finally {
    client.release();
  }
});

export default router;
