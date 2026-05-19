import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// GET /api/compras — list all purchase orders with product/supplier joins
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT oc.*,
              p.nombre  AS producto_nombre,
              p.codigo  AS producto_codigo,
              p.unidad_medida,
              pv.nombre AS proveedor_nombre
       FROM ordenes_compra oc
       JOIN productos p ON p.id = oc.producto_id
       LEFT JOIN proveedores pv ON pv.id = oc.proveedor_id
       ORDER BY oc.created_at DESC`
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/compras — create new purchase order
router.post('/', async (req, res) => {
  try {
    const { producto_id, proveedor_id, cantidad, precio_unitario, fecha_entrega_estimada, notas } = req.body;
    if (!producto_id || !cantidad) {
      return res.status(400).json({ error: 'producto_id y cantidad son obligatorios' });
    }
    const { rows: [oc] } = await pool.query(
      `INSERT INTO ordenes_compra
         (producto_id, proveedor_id, cantidad, precio_unitario, fecha_entrega_estimada, notas)
       VALUES ($1, $2, $3::NUMERIC, $4::NUMERIC, $5, $6)
       RETURNING *`,
      [
        producto_id,
        proveedor_id ?? null,
        Number(cantidad).toFixed(6),
        Number(precio_unitario ?? 0).toFixed(6),
        fecha_entrega_estimada ?? null,
        notas ?? null,
      ]
    );
    return res.status(201).json(oc);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/compras/:id — update order fields
router.put('/:id', async (req, res) => {
  try {
    const { estado, cantidad, precio_unitario, fecha_entrega_estimada, fecha_recepcion, notas } = req.body;
    const { rows: [oc] } = await pool.query(
      `UPDATE ordenes_compra SET
         estado                = COALESCE($1::estado_compra, estado),
         cantidad              = COALESCE($2::NUMERIC, cantidad),
         precio_unitario       = COALESCE($3::NUMERIC, precio_unitario),
         fecha_entrega_estimada = COALESCE($4, fecha_entrega_estimada),
         fecha_recepcion       = COALESCE($5, fecha_recepcion),
         notas                 = COALESCE($6, notas)
       WHERE id = $7
       RETURNING *`,
      [
        estado ?? null,
        cantidad != null ? Number(cantidad).toFixed(6) : null,
        precio_unitario != null ? Number(precio_unitario).toFixed(6) : null,
        fecha_entrega_estimada ?? null,
        fecha_recepcion ?? null,
        notas ?? null,
        req.params.id,
      ]
    );
    if (!oc) return res.status(404).json({ error: 'Orden no encontrada' });
    return res.json(oc);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/compras/:id/enviar — mark as 'enviada'
router.post('/:id/enviar', async (req, res) => {
  try {
    const { rows: [oc] } = await pool.query(
      `UPDATE ordenes_compra SET estado = 'enviada'
       WHERE id = $1 AND estado = 'borrador'
       RETURNING *`,
      [req.params.id]
    );
    if (!oc) return res.status(400).json({ error: 'Solo se pueden enviar ordenes en estado borrador' });
    return res.json(oc);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/compras/:id/recibir — mark as 'recibida', create lot + adjust stock
router.post('/:id/recibir', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { cantidad_recibida, lote_proveedor, fecha_caducidad, ubicacion } = req.body;

    // Fetch the order
    const { rows: [oc] } = await client.query(
      `SELECT * FROM ordenes_compra WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!oc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada' }); }
    if (oc.estado !== 'enviada') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Solo se pueden recibir ordenes en estado enviada' }); }

    const cantidadFinal = Number(cantidad_recibida ?? oc.cantidad);

    // Generate lote_interno
    const loteInterno = `LT-OC-${oc.numero_oc.replace('OC-', '')}-${Date.now().toString(36).toUpperCase()}`;

    // Create lot
    const { rows: [lote] } = await client.query(
      `INSERT INTO lotes
         (producto_id, lote_interno, lote_proveedor, cantidad_inicial, cantidad_actual,
          fecha_entrada, fecha_caducidad, ubicacion, estado)
       VALUES ($1, $2, $3, $4::NUMERIC, $4::NUMERIC, CURRENT_DATE, $5, $6, 'cuarentena')
       RETURNING *`,
      [
        oc.producto_id,
        loteInterno,
        lote_proveedor ?? null,
        cantidadFinal.toFixed(6),
        fecha_caducidad ?? null,
        ubicacion ?? null,
      ]
    );

    // Get current stock
    const { rows: [prod] } = await client.query(
      `SELECT stock_actual FROM productos WHERE id = $1`,
      [oc.producto_id]
    );
    const stockAntes = parseFloat(prod.stock_actual);
    const stockDespues = stockAntes + cantidadFinal;

    // Update product stock
    await client.query(
      `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
      [stockDespues.toFixed(6), oc.producto_id]
    );

    // Create stock_move record
    await client.query(
      `INSERT INTO stock_moves
         (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, motivo)
       VALUES ($1, $2, 'entrada', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6)`,
      [
        oc.producto_id,
        lote.id,
        cantidadFinal.toFixed(6),
        stockAntes.toFixed(6),
        stockDespues.toFixed(6),
        `Recepcion OC ${oc.numero_oc}`,
      ]
    );

    // Update order
    const { rows: [ocUpdated] } = await client.query(
      `UPDATE ordenes_compra SET
         estado = 'recibida',
         fecha_recepcion = CURRENT_DATE,
         cantidad = $1::NUMERIC,
         lote_creado_id = $2
       WHERE id = $3
       RETURNING *`,
      [cantidadFinal.toFixed(6), lote.id, req.params.id]
    );

    await client.query('COMMIT');
    return res.json({ orden: ocUpdated, lote });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  } finally {
    client.release();
  }
});

// DELETE /api/compras/:id — cancel order
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [oc] } = await pool.query(
      `UPDATE ordenes_compra SET estado = 'cancelada'
       WHERE id = $1 AND estado NOT IN ('recibida')
       RETURNING *`,
      [req.params.id]
    );
    if (!oc) return res.status(400).json({ error: 'No se puede cancelar esta orden (ya recibida o no encontrada)' });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
