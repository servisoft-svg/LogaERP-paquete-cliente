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

// POST /api/stock/reconciliar — fix all discrepancies
router.post('/reconciliar', async (_req, res) => {
  try {
    const { rowCount } = await pool.query(`
      UPDATE productos p SET stock_actual = COALESCE((
        SELECT SUM(l.cantidad_actual) FROM lotes l
        WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
      ), 0)
      WHERE p.activo = true
        AND ABS(p.stock_actual - COALESCE((
          SELECT SUM(l.cantidad_actual) FROM lotes l
          WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
        ), 0)) > 0.001
    `);
    return res.json({ ok: true, corregidos: rowCount });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
