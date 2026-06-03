import { Router } from 'express';
import { pool } from '../db/pool';
import { stockController } from '../controllers/stock.controller';
import { toNum } from '../types';
import { logger } from '../lib/logger';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { adminOnly } from '../middleware/auth';
import { AppError } from '../lib/AppError';

const router = Router();

router.get ('/',                    stockController.listarProductos);
// Ajuste manual y reconciliación: operaciones contables, solo admin (H1.2 audit v3).
router.post('/ajuste',              adminOnly, stockController.ajustarStock);
router.get ('/notificaciones',      stockController.notificaciones);
router.post('/pedido',              stockController.enviarPedido);
router.get ('/:id/historial',       stockController.historial);
router.get ('/:id/cantidad-sugerida', stockController.cantidadSugerida);

// GET /api/stock/reconciliar — verify and fix stock_actual vs SUM(lotes)
router.get('/reconciliar', async (_req, res, next) => {
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
  } catch (err) {
    return next(err);
  }
});

// POST /api/stock/reconciliar — fix all discrepancies WITH audit trail in stock_moves
router.post('/reconciliar', adminOnly, async (req, res, next) => {
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
      const antes = toNum(d.stock_actual);
      const despues = toNum(d.stock_lotes);
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
    invalidarCacheFinanzas(); // reconciliación cambia stock_actual → invalida valoración
    return res.json({ ok: true, corregidos: discrepancias.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(rbErr => logger.error('[stock.reconciliar] ROLLBACK fallo', { err: rbErr }));
    return next(err);
  } finally {
    client.release();
  }
});

// GET /api/stock/pedidos-proveedor — historial de solicitudes a proveedor con lead time
router.get('/pedidos-proveedor', async (req, res, next) => {
  try {
    const estado = req.query.estado as string || undefined;
    const productoId = req.query.producto_id as string || undefined;

    let sql = `
      SELECT pp.*,
        p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
        pv.nombre AS proveedor_nombre,
        l.lote_interno
      FROM pedidos_proveedor pp
      JOIN productos p ON p.id = pp.producto_id
      LEFT JOIN proveedores pv ON pv.id = pp.proveedor_id
      LEFT JOIN lotes l ON l.id = pp.lote_id
      WHERE 1=1
    `;
    const params: unknown[] = [];
    let idx = 1;
    if (estado) { sql += ` AND pp.estado = $${idx++}`; params.push(estado); }
    if (productoId) { sql += ` AND pp.producto_id = $${idx++}`; params.push(productoId); }
    sql += ` ORDER BY pp.fecha_solicitud DESC LIMIT 200`;

    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/stock/pedidos-proveedor/:id/pdf — descargar PDF de solicitud existente
router.get('/pedidos-proveedor/:id/pdf', async (req, res, next) => {
  try {
    const { rows: [pp] } = await pool.query(
      `SELECT pp.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.unidad_medida,
              pv.nombre    AS proveedor_nombre,
              pv.direccion AS proveedor_direccion,
              pv.telefono  AS proveedor_telefono,
              u.nombre AS solicitante_nombre
       FROM pedidos_proveedor pp
       JOIN productos p ON p.id = pp.producto_id
       LEFT JOIN proveedores pv ON pv.id = pp.proveedor_id
       LEFT JOIN usuarios u ON u.id = pp.usuario_solicitud_id
       WHERE pp.id = $1`,
      [req.params.id]
    );
    if (!pp) return next(AppError.notFound('Pedido proveedor', req.params.id));

    const { renderSolicitudCompraPDF, cargarDatosEmpresa } = await import('../lib/pdfSolicitudCompra');
    const empresa = await cargarDatosEmpresa();
    const pdf = await renderSolicitudCompraPDF({
      numero_solicitud: pp.numero_solicitud ?? `SP-${pp.id.slice(0, 8)}`,
      producto_codigo: pp.producto_codigo,
      producto_nombre: pp.producto_nombre,
      unidad_medida: pp.unidad_medida,
      cantidad: Number(pp.cantidad_solicitada),
      precio_unitario: pp.precio_unitario != null ? Number(pp.precio_unitario) : null,
      importe_total: pp.importe_total != null ? Number(pp.importe_total) : null,
      proveedor_nombre: pp.proveedor_nombre ?? 'Proveedor',
      proveedor_direccion: pp.proveedor_direccion ?? null,
      proveedor_telefono: pp.proveedor_telefono ?? null,
      destinatario: pp.destinatario_email,
      notas: pp.notas,
      fecha: new Date(pp.fecha_solicitud),
      empresa_nombre: empresa.nombre,
      empresa_cif: empresa.cif,
      empresa_direccion: empresa.direccion,
      empresa_telefono: empresa.telefono,
      datos_bancarios: empresa.datos_bancarios,
      solicitante_nombre: pp.solicitante_nombre ?? null,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pp.numero_solicitud ?? 'solicitud'}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

// GET /api/stock/lead-time-proveedores — lead time medio por proveedor
router.get('/lead-time-proveedores', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        pv.id AS proveedor_id,
        pv.nombre AS proveedor_nombre,
        COUNT(*) AS total_pedidos,
        COUNT(*) FILTER (WHERE pp.estado = 'completado') AS completados,
        COUNT(*) FILTER (WHERE pp.estado = 'pendiente') AS pendientes,
        ROUND(AVG(pp.lead_time_horas) FILTER (WHERE pp.estado = 'completado'), 1) AS lead_time_medio_horas,
        ROUND(AVG(pp.lead_time_horas / 24) FILTER (WHERE pp.estado = 'completado'), 1) AS lead_time_medio_dias,
        ROUND(MIN(pp.lead_time_horas) FILTER (WHERE pp.estado = 'completado'), 1) AS lead_time_min_horas,
        ROUND(MAX(pp.lead_time_horas) FILTER (WHERE pp.estado = 'completado'), 1) AS lead_time_max_horas,
        ROUND(AVG(pp.cantidad_recibida / NULLIF(pp.cantidad_solicitada, 0) * 100) FILTER (WHERE pp.estado = 'completado'), 1) AS fiabilidad_pct
      FROM pedidos_proveedor pp
      JOIN proveedores pv ON pv.id = pp.proveedor_id
      GROUP BY pv.id, pv.nombre
      ORDER BY total_pedidos DESC
    `);
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

export default router;
