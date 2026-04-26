import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { producto_id, estado, busqueda } = req.query;
    let sql = `
      SELECT l.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
             p.unidad_medida
      FROM lotes l
      JOIN productos p ON p.id = l.producto_id
      WHERE 1=1
    `;
    const params: string[] = [];
    let idx = 1;

    if (producto_id) { sql += ` AND l.producto_id = $${idx++}`; params.push(String(producto_id)); }
    if (estado)      { sql += ` AND l.estado = $${idx++}`;      params.push(String(estado)); }
    if (busqueda)    {
      sql += ` AND (l.lote_interno ILIKE $${idx} OR l.lote_proveedor ILIKE $${idx} OR p.nombre ILIKE $${idx})`;
      params.push(`%${busqueda}%`); idx++;
    }

    sql += ` ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    res.status(500).json({ error: msg });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      producto_id, lote_interno: loteInternoBody, lote_proveedor,
      cantidad, cantidad_inicial, cantidad_actual,
      fecha_caducidad, fecha_fabricacion, ubicacion, observaciones, estado, precio_compra,
    } = req.body;

    const qty = cantidad ?? cantidad_inicial;
    if (!producto_id || !qty) {
      return res.status(400).json({ error: 'producto_id y cantidad son obligatorios' });
    }
    if (Number(qty) <= 0) {
      return res.status(400).json({ error: 'cantidad debe ser mayor que 0' });
    }

    // Auto-generate readable lote code: LMP-DDMMYY-XXXX
    let lote_interno = loteInternoBody?.trim().toUpperCase();
    if (!lote_interno) {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      lote_interno = `LMP-${dd}${mm}${yy}-${rand}`;
    }
    const qty_actual   = cantidad_actual ?? qty;

    // Auto-calcular caducidad si el producto tiene caducidad_meses y no se proporcionó fecha
    let fechaCad = fecha_caducidad ?? null;
    if (!fechaCad) {
      const { rows: [prod] } = await pool.query(`SELECT caducidad_meses FROM productos WHERE id = $1`, [producto_id]);
      if (prod?.caducidad_meses) {
        const d = new Date();
        d.setMonth(d.getMonth() + prod.caducidad_meses);
        fechaCad = d.toISOString().slice(0, 10);
      }
    }

    const { rows: [lote] } = await pool.query(
      `INSERT INTO lotes
         (producto_id, lote_interno, lote_proveedor, cantidad_inicial, cantidad_actual,
          fecha_fabricacion, fecha_caducidad, ubicacion, observaciones, estado, precio_compra)
       VALUES ($1,$2,$3,$4::NUMERIC,$5::NUMERIC,$6,$7,$8,$9,COALESCE($10::estado_lote,'cuarentena'),$11::NUMERIC)
       RETURNING *`,
      [
        producto_id,
        lote_interno,
        lote_proveedor ?? null,
        Number(qty).toFixed(6),
        Number(qty_actual).toFixed(6),
        fecha_fabricacion ?? null,
        fechaCad          ?? null,
        ubicacion         ?? null,
        observaciones     ?? null,
        estado            ?? null,
        precio_compra     ?? null,
      ]
    );
    // Sincronizar stock del producto = suma de lotes aprobados
    await pool.query(`
      UPDATE productos SET stock_actual = (
        SELECT COALESCE(SUM(cantidad_actual), 0) FROM lotes
        WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
      ) WHERE id = $1
    `, [producto_id]);

    // Stock move for traceability
    if (lote.estado === 'aprobado' && parseFloat(lote.cantidad_actual) > 0) {
      await pool.query(
        `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
         VALUES ($1, $2, 'entrada', $3::NUMERIC, 0, $3::NUMERIC, $4, $5)`,
        [producto_id, lote.id, lote.cantidad_actual, (req as any).user?.id ?? null, `Lote ${lote.lote_interno} creado`]
      );
    }

    // Audit trail
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'ENTRADA_STOCK', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, lote.id, `Lote ${lote.lote_interno} creado: ${Number(qty).toFixed(2)} ${req.body.unidad_medida ?? 'kg'}`]
    );

    return res.status(201).json(lote);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe un lote con ese código. Cambia el código de lote.' });
    }
    if (msg.includes('constraint')) {
      return res.status(400).json({ error: 'Los datos no son válidos. Revisa las cantidades.' });
    }
    return res.status(500).json({ error: 'Error al crear el lote. Inténtalo de nuevo.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { cantidad_actual, ubicacion, observaciones, precio_compra } = req.body;

    if (cantidad_actual != null && Number(cantidad_actual) < 0) {
      return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
    }

    // Get old quantity before update for stock_move
    const { rows: [antes] } = await pool.query(`SELECT cantidad_actual, producto_id FROM lotes WHERE id = $1`, [req.params.id]);

    const { rows: [lote] } = await pool.query(
      `UPDATE lotes SET
        cantidad_actual = COALESCE($1::NUMERIC, cantidad_actual),
        cantidad_inicial = GREATEST(cantidad_inicial, COALESCE($1::NUMERIC, cantidad_actual)),
        ubicacion = COALESCE($2, ubicacion),
        observaciones = COALESCE($3, observaciones),
        precio_compra = COALESCE($4::NUMERIC, precio_compra)
       WHERE id = $5 RETURNING *`,
      [cantidad_actual ?? null, ubicacion ?? null, observaciones ?? null, precio_compra ?? null, req.params.id]
    );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    // Stock move for quantity change
    if (cantidad_actual != null && antes) {
      const diff = parseFloat(lote.cantidad_actual) - parseFloat(antes.cantidad_actual);
      if (Math.abs(diff) > 0.0001) {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'ajuste', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [lote.producto_id, lote.id, diff.toFixed(6), antes.cantidad_actual, lote.cantidad_actual,
           (req as any).user?.id ?? null, `Ajuste manual lote ${lote.lote_interno}`]
        );
      }
    }

    // Also sync product stock_actual = sum of lotes
    await pool.query(`
      UPDATE productos SET stock_actual = (
        SELECT COALESCE(SUM(cantidad_actual), 0) FROM lotes WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
      ) WHERE id = $1
    `, [lote.producto_id]);

    // Audit
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'MODIFICAR_LOTE', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, lote.id, `Lote ${lote.lote_interno} modificado`]
    );

    res.json(lote);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/:id/trazabilidad', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT sm.tipo, sm.cantidad, sm.created_at, sm.motivo,
              op.numero_orden, op.estado, op.registro_limpieza,
              p.nombre AS producto_nombre, p.codigo AS producto_codigo
       FROM stock_moves sm
       LEFT JOIN ordenes_produccion op ON op.id = sm.orden_id
       JOIN productos p ON p.id = sm.producto_id
       WHERE sm.lote_id = $1
       ORDER BY sm.created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    res.status(500).json({ error: msg });
  }
});

router.patch('/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, motivo } = req.body;
    if (!['cuarentena', 'aprobado', 'rechazado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    if (!motivo) return res.status(400).json({ error: 'motivo es obligatorio para cambios de estado' });

    // Validate state transition
    const { rows: [actual] } = await pool.query(`SELECT estado, cantidad_actual FROM lotes WHERE id = $1`, [id]);
    if (!actual) return res.status(404).json({ error: 'Lote no encontrado' });
    const TRANS_LOTE: Record<string, string[]> = { cuarentena: ['aprobado', 'rechazado'], aprobado: ['rechazado'], rechazado: [] };
    if (!(TRANS_LOTE[actual.estado] ?? []).includes(estado)) {
      return res.status(422).json({ error: `No se puede cambiar de "${actual.estado}" a "${estado}"` });
    }

    const { rows: [lote] } = await pool.query(
      `UPDATE lotes SET estado = $1 WHERE id = $2 RETURNING *`,
      [estado, id]
    );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    // Sincronizar stock del producto
    await pool.query(`
      UPDATE productos SET stock_actual = (
        SELECT COALESCE(SUM(cantidad_actual), 0) FROM lotes
        WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
      ) WHERE id = $1
    `, [lote.producto_id]);

    // Stock move for estado change (aprobado = stock entry, rechazado = stock exit)
    const cantLote = parseFloat(lote.cantidad_actual);
    if (cantLote > 0) {
      if (estado === 'aprobado' && actual.estado === 'cuarentena') {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'entrada', $3::NUMERIC, 0, $3::NUMERIC, $4, $5)`,
          [lote.producto_id, lote.id, cantLote.toFixed(6), (req as any).user?.id ?? null, `Lote ${lote.lote_interno} aprobado: ${motivo}`]
        );
      } else if (estado === 'rechazado' && actual.estado === 'aprobado') {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, 0, $5, $6)`,
          [lote.producto_id, lote.id, (-cantLote).toFixed(6), cantLote.toFixed(6), (req as any).user?.id ?? null, `Lote ${lote.lote_interno} rechazado: ${motivo}`]
        );
      }
    }

    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CAMBIO_ESTADO_LOTE', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, id, motivo]
    );
    return res.json(lote);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    return res.status(500).json({ error: msg });
  }
});

export default router;
