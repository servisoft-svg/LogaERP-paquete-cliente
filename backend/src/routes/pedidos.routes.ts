import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { alertaService } from '../services/alerta.service';
import { automatizacionesService } from '../services/automatizaciones.service';
import { logger } from '../lib/logger';

const router = Router();

// GET /api/pedidos
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(`
      SELECT pd.*,
        c.nombre AS cliente_nombre_rel,
        p.nombre AS producto_nombre_rel, p.codigo AS producto_codigo,
        p.unidad_medida AS producto_unidad,
        op.numero_orden
      FROM pedidos pd
      LEFT JOIN clientes c ON c.id = pd.cliente_id
      LEFT JOIN productos p ON p.id = pd.producto_id
      LEFT JOIN ordenes_produccion op ON op.id = pd.orden_produccion_id
      ORDER BY pd.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    // Load lineas in a single batch query (fix N+1)
    const pedidoIds = rows.map(r => r.id);
    if (pedidoIds.length > 0) {
      const { rows: allLineas } = await pool.query(
        `SELECT lp.*, p.nombre AS producto_nombre_rel, p.codigo AS producto_codigo, p.unidad_medida AS producto_unidad
         FROM lineas_pedido lp
         LEFT JOIN productos p ON p.id = lp.producto_id
         WHERE lp.pedido_id = ANY($1)
         ORDER BY lp.created_at ASC`,
        [pedidoIds]
      );
      // Group by pedido_id
      const lineasMap = new Map<string, typeof allLineas>();
      for (const l of allLineas) {
        if (!lineasMap.has(l.pedido_id)) lineasMap.set(l.pedido_id, []);
        lineasMap.get(l.pedido_id)!.push(l);
      }
      for (const ped of rows) {
        ped.lineas = lineasMap.get(ped.id) ?? [];
      }
    } else {
      for (const ped of rows) {
        ped.lineas = [];
      }
    }
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/pedidos - create directly as 'confirmado' with auto stock reservation
router.post('/', async (req, res) => {
  try {
    const { cliente_id, cliente_nombre, producto_id, cantidad, fecha_entrega, notas, lineas, subtotal, portes, iva_porcentaje, total } = req.body;

    // Server-side validation: recalculate totals from lineas
    const portesNum = parseFloat(portes ?? 0);
    const ivaPctNum = parseFloat(iva_porcentaje ?? 21);
    let subtotalCalc = parseFloat(subtotal ?? 0);
    if (Array.isArray(lineas) && lineas.length > 0) {
      subtotalCalc = lineas.reduce((s: number, l: any) => s + (parseFloat(l.cantidad ?? 0) * parseFloat(l.precio_unitario ?? 0)), 0);
    }
    const ivaCalc = (subtotalCalc + portesNum) * ivaPctNum / 100;
    const totalCalc = subtotalCalc + portesNum + ivaCalc;

    const { rows: [pedido] } = await pool.query(
      `INSERT INTO pedidos (cliente_id, cliente_nombre, producto_id, cantidad, fecha_entrega, notas, origen, estado, subtotal, portes, iva_porcentaje, total)
       VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, 'manual', 'confirmado', $7::NUMERIC, $8::NUMERIC, $9::NUMERIC, $10::NUMERIC)
       RETURNING *`,
      [cliente_id ?? null, cliente_nombre ?? null, producto_id ?? null, cantidad ?? null, fecha_entrega ?? null, notas ?? null,
       subtotalCalc.toFixed(2), portesNum.toFixed(2), ivaPctNum, totalCalc.toFixed(2)]
    );

    // Insert lineas if provided (max 100)
    if (Array.isArray(lineas) && lineas.length > 100) {
      return res.status(400).json({ error: 'Maximo 100 lineas por pedido.' });
    }
    // Batch insert lineas (1 sola query VALUES ($1...), ($N...))
    const lineasValidas = Array.isArray(lineas)
      ? lineas.filter((l: { producto_id?: string; producto_nombre?: string }) => l.producto_id || l.producto_nombre)
      : [];
    if (lineasValidas.length > 0) {
      const placeholders: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const l of lineasValidas as { producto_id?: string; producto_nombre?: string; cantidad?: string|number; unidad_medida?: string; notas?: string; precio_unitario?: string|number; subtotal?: string|number }[]) {
        placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}::NUMERIC)`);
        params.push(
          pedido.id, l.producto_id ?? null, l.producto_nombre ?? null,
          l.cantidad ?? null, l.unidad_medida ?? 'kg', l.notas ?? null,
          l.precio_unitario ?? null, l.subtotal ?? null,
        );
      }
      await pool.query(
        `INSERT INTO lineas_pedido (pedido_id, producto_id, producto_nombre, cantidad, unidad_medida, notas, precio_unitario, subtotal)
         VALUES ${placeholders.join(', ')}`,
        params
      );
    }

    // Auto-reserve stock FIFO — wrapped in SERIALIZABLE to prevent double-booking
    const itemsToReserve: { producto_id: string; cantidad: number }[] = [];
    if (Array.isArray(lineas) && lineas.length > 0) {
      for (const l of lineas) {
        if (l.producto_id && l.cantidad) itemsToReserve.push({ producto_id: l.producto_id, cantidad: parseFloat(String(l.cantidad)) });
      }
    } else if (producto_id && cantidad) {
      itemsToReserve.push({ producto_id, cantidad: parseFloat(String(cantidad)) });
    }

    let reservationFailed = false;
    if (itemsToReserve.length > 0) {
      const resClient = await pool.connect();
      try {
        await resClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        for (const item of itemsToReserve) {
          const { rows: lotes } = await resClient.query(
            `SELECT l.id, l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id), 0) AS disponible
             FROM lotes l WHERE l.producto_id = $1 AND l.estado = 'aprobado' AND l.cantidad_actual > 0
             ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC
             FOR UPDATE`,
            [item.producto_id]
          );
          let falta = item.cantidad;
          for (const l of lotes) {
            if (falta <= 0) break;
            const disp = parseFloat(l.disponible);
            if (disp <= 0) continue;
            const reservar = Math.min(disp, falta);
            await resClient.query(
              `INSERT INTO reservas_stock (pedido_id, producto_id, lote_id, cantidad) VALUES ($1, $2, $3, $4)`,
              [pedido.id, item.producto_id, l.id, reservar.toFixed(6)]
            );
            falta -= reservar;
          }
        }
        await resClient.query('COMMIT');
      } catch (resErr) {
        reservationFailed = true;
        await resClient.query('ROLLBACK').catch(rbErr => logger.error('[POST pedidos] ROLLBACK reservas fallo', { err: rbErr }));
        logger.error('[POST pedidos] reserva FIFO fallo — pedido creado sin reservas', { err: resErr, pedido_id: pedido.id });
      } finally {
        resClient.release();
      }
    }

    // Hook automatizaciones: pedido recién creado en 'confirmado' → intentar
    // auto-fabricar (si no hay stock) o auto-completar (si sí lo hay).
    if (pedido.estado === 'confirmado') {
      setImmediate(() => {
        automatizacionesService.autoFabricarPedido(pedido.id)
          .catch(err => logger.error('[auto.fabricarPedido-POST]', { err }));
        automatizacionesService.autoCompletarPedido(pedido.id)
          .catch(err => logger.error('[auto.completarPedido-POST]', { err }));
      });
    }

    res.status(201).json({ ...pedido, ...(reservationFailed ? { warning: 'reservation_failed' } : {}) });
  } catch (err: unknown) {
    logger.error('[POST pedidos]', { err });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/pedidos/:id — update completo con lineas
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  nuevo:          ['confirmado', 'cancelado'],
  confirmado:     ['en_produccion', 'fabricado', 'envasado', 'completado', 'cancelado'],
  en_produccion:  ['fabricado', 'completado', 'cancelado'],
  fabricado:      ['envasado', 'completado', 'cancelado'],
  envasado:       ['completado', 'cancelado'],
  completado:     [],
  cancelado:      ['confirmado'],
};

router.put('/:id', async (req, res) => {
  try {
    const { estado, producto_id, cantidad, unidad_medida, fecha_entrega, notas, orden_produccion_id,
            cliente_id, cliente_nombre, subtotal, portes, iva_porcentaje, total, lineas } = req.body;

    // Validar transición de estado
    if (estado) {
      const { rows: [actual] } = await pool.query(`SELECT id, estado, producto_id, cantidad FROM pedidos WHERE id = $1`, [req.params.id]);
      if (actual) {
        const permitidos = TRANSICIONES_VALIDAS[actual.estado] ?? [];
        if (!permitidos.includes(estado)) {
          return res.status(422).json({ error: `No se puede cambiar de "${actual.estado}" a "${estado}"` });
        }

        // RESERVAS: al confirmar pedido (o re-confirmar tras cancelar), reservar stock
        if (estado === 'confirmado' && (actual.estado === 'nuevo' || actual.estado === 'cancelado') && actual.producto_id && actual.cantidad) {
          const resClient = await pool.connect();
          try {
            await resClient.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            const { rows: lotes } = await resClient.query(
              `SELECT l.id, l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id), 0) AS disponible
               FROM lotes l WHERE l.producto_id = $1 AND l.estado = 'aprobado' AND l.cantidad_actual > 0
               ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC
               FOR UPDATE`,
              [actual.producto_id]
            );
            let falta = parseFloat(actual.cantidad);
            for (const l of lotes) {
              if (falta <= 0) break;
              const disp = parseFloat(l.disponible);
              if (disp <= 0) continue;
              const reservar = Math.min(disp, falta);
              await resClient.query(
                `INSERT INTO reservas_stock (pedido_id, producto_id, lote_id, cantidad) VALUES ($1, $2, $3, $4)`,
                [req.params.id, actual.producto_id, l.id, reservar.toFixed(6)]
              );
              falta -= reservar;
            }
            await resClient.query('COMMIT');
          } catch {
            await resClient.query('ROLLBACK').catch(() => {});
          } finally {
            resClient.release();
          }
        }

        // Liberar reservas al cancelar
        if (estado === 'cancelado') {
          await pool.query(`DELETE FROM reservas_stock WHERE pedido_id = $1`, [req.params.id]);
        }
      }
    }

    // Reemplazar lineas atómicamente: DELETE + batch INSERT en una transacción.
    // Si el INSERT falla, el DELETE se revierte y el pedido NO queda sin líneas.
    if (Array.isArray(lineas)) {
      const txClient = await pool.connect();
      try {
        await txClient.query('BEGIN');
        await txClient.query(`DELETE FROM lineas_pedido WHERE pedido_id = $1`, [req.params.id]);
        const lineasValidas = lineas.filter((l: { producto_id?: string; producto_nombre?: string }) => l.producto_id || l.producto_nombre);
        if (lineasValidas.length > 0) {
          const placeholders: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          for (const l of lineasValidas as { producto_id?: string; producto_nombre?: string; cantidad?: string|number; unidad_medida?: string; precio_unitario?: string|number }[]) {
            placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}, $${idx++}::NUMERIC, $${idx++}::NUMERIC)`);
            const subtotal = (parseFloat(String(l.cantidad ?? 0)) * parseFloat(String(l.precio_unitario ?? 0))).toFixed(2);
            params.push(req.params.id, l.producto_id ?? null, l.producto_nombre ?? null, l.cantidad ?? null, l.unidad_medida ?? 'kg', l.precio_unitario ?? null, subtotal);
          }
          await txClient.query(
            `INSERT INTO lineas_pedido (pedido_id, producto_id, producto_nombre, cantidad, unidad_medida, precio_unitario, subtotal)
             VALUES ${placeholders.join(', ')}`,
            params
          );
        }
        await txClient.query('COMMIT');
      } catch (txErr) {
        await txClient.query('ROLLBACK').catch(rbErr => logger.error('[PUT pedidos] ROLLBACK reemplazar lineas fallo', { err: rbErr }));
        logger.error('[PUT pedidos] reemplazar lineas fallo', { err: txErr, pedido_id: req.params.id });
        throw txErr;
      } finally {
        txClient.release();
      }
    }

    // Server-side total recalculation — always recompute from lines
    const portesNum = parseFloat(portes ?? 0);
    const ivaPctNum = parseFloat(iva_porcentaje ?? 21);
    let subtotalCalc = parseFloat(subtotal ?? 0);

    // If lineas were sent, recalculate from them. Otherwise recalculate from DB.
    if (Array.isArray(lineas) && lineas.length > 0) {
      subtotalCalc = lineas.reduce((s: number, l: any) => s + (parseFloat(l.cantidad ?? 0) * parseFloat(l.precio_unitario ?? 0)), 0);
    } else {
      const { rows: existingLineas } = await pool.query(
        `SELECT cantidad, precio_unitario FROM lineas_pedido WHERE pedido_id = $1`,
        [req.params.id]
      );
      if (existingLineas.length > 0) {
        subtotalCalc = existingLineas.reduce((s: number, l: { cantidad: string; precio_unitario: string }) =>
          s + (parseFloat(l.cantidad) * parseFloat(l.precio_unitario)), 0);
      }
    }
    const ivaCalc = (subtotalCalc + portesNum) * ivaPctNum / 100;
    const totalCalc = subtotalCalc + portesNum + ivaCalc;

    const { rows: [pedido] } = await pool.query(
      `UPDATE pedidos SET
        estado = COALESCE($1::estado_pedido, estado),
        producto_id = COALESCE($2, producto_id),
        cantidad = COALESCE($3::NUMERIC, cantidad),
        unidad_medida = COALESCE($4, unidad_medida),
        fecha_entrega = COALESCE($5, fecha_entrega),
        notas = COALESCE($6, notas),
        orden_produccion_id = COALESCE($7, orden_produccion_id),
        cliente_id = COALESCE($8, cliente_id),
        cliente_nombre = COALESCE($9, cliente_nombre),
        subtotal = $10::NUMERIC,
        portes = $11::NUMERIC,
        iva_porcentaje = $12::NUMERIC,
        total = $13::NUMERIC
       WHERE id = $14 RETURNING *`,
      [estado ?? null, producto_id ?? null, cantidad ?? null, unidad_medida ?? null,
       fecha_entrega ?? null, notas ?? null, orden_produccion_id ?? null,
       cliente_id ?? null, cliente_nombre ?? null,
       subtotalCalc.toFixed(2), portesNum.toFixed(2), ivaPctNum, totalCalc.toFixed(2),
       req.params.id]
    );
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Hook automatizaciones: estados donde el pedido espera ser consumido
    if (['confirmado', 'fabricado', 'envasado'].includes(pedido.estado)) {
      setImmediate(() => {
        automatizacionesService.autoFabricarPedido(pedido.id)
          .catch(err => console.error('[auto.fabricarPedido]', err));
        automatizacionesService.autoCompletarPedido(pedido.id)
          .catch(err => console.error('[auto.completarPedido]', err));
        // Aviso al cliente con trazabilidad cuando pasa a fabricado/envasado
        if (['fabricado', 'envasado'].includes(pedido.estado)) {
          automatizacionesService.autoEmailTrazabilidadFabricado(pedido.id)
            .catch(err => console.error('[auto.trazabilidadFabricado]', err));
        }
      });
    }

    res.json(pedido);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/pedidos/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM reservas_stock WHERE pedido_id = $1`, [req.params.id]);
    await pool.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/pedidos/:id/lotes-disponibles — lotes FIFO para cada linea del pedido
router.get('/:id/lotes-disponibles', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: lineas } = await pool.query<{
      producto_id: string; cantidad: string; producto_nombre: string; unidad_medida: string;
    }>(
      `SELECT lp.producto_id, lp.cantidad, p.nombre AS producto_nombre, p.unidad_medida
       FROM lineas_pedido lp JOIN productos p ON p.id = lp.producto_id
       WHERE lp.pedido_id = $1`, [id]
    );
    const productoIds = lineas.map(l => l.producto_id);
    const result: Record<string, unknown[]> = {};
    for (const l of lineas) result[l.producto_id] = [];

    if (productoIds.length > 0) {
      // 1 sola query para todos los lotes (en lugar de 1 por línea)
      const { rows: lotes } = await pool.query<{
        id: string; producto_id: string; lote_interno: string; cantidad_actual: string;
        precio_compra: string | null; fecha_caducidad: string | null; fecha_entrada: string;
      }>(
        `SELECT id, producto_id, lote_interno, cantidad_actual, precio_compra, fecha_caducidad, fecha_entrada
         FROM lotes
         WHERE producto_id = ANY($1::uuid[]) AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY producto_id, fecha_caducidad ASC NULLS LAST, fecha_entrada ASC`,
        [productoIds]
      );
      const lineaByProd = new Map(lineas.map(l => [l.producto_id, l]));
      for (const lt of lotes) {
        const linea = lineaByProd.get(lt.producto_id);
        if (!linea) continue;
        result[lt.producto_id].push({
          ...lt,
          producto_nombre: linea.producto_nombre,
          unidad_medida: linea.unidad_medida,
          cantidad_pedida: linea.cantidad,
        });
      }
    }
    res.json(result);
  } catch (err: unknown) {
    logger.error('[GET lotes-disponibles]', { err, pedido_id: req.params.id });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/pedidos/:id/consumir — resta stock. Acepta lotes_override opcional
router.post('/:id/consumir', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const { id } = req.params;
    const lotesOverride: Record<string, string[]> = req.body.lotes_override ?? {};
    const { rows: [pedido] } = await client.query(`SELECT * FROM pedidos WHERE id = $1 FOR UPDATE`, [id]);
    if (!pedido) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    // Validate state — only allow consumir from valid states
    const consumirPermitido = ['confirmado', 'en_produccion', 'fabricado', 'envasado'];
    if (!consumirPermitido.includes(pedido.estado)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: `No se puede consumir un pedido en estado "${pedido.estado}"` });
    }

    // Cargar lineas del pedido (o usar producto principal si no hay lineas)
    const { rows: lineas } = await client.query(
      `SELECT lp.*, p.stock_actual, p.nombre, p.unidad_medida AS prod_unidad
       FROM lineas_pedido lp
       JOIN productos p ON p.id = lp.producto_id
       WHERE lp.pedido_id = $1`,
      [id]
    );

    // Si no hay lineas, usar producto principal
    const items = lineas.length > 0 ? lineas.map(l => ({
      producto_id: l.producto_id,
      cantidad: parseFloat(l.cantidad ?? '0'),
      nombre: l.nombre,
      unidad: l.prod_unidad,
      stock: parseFloat(l.stock_actual),
    })) : pedido.producto_id ? [{
      producto_id: pedido.producto_id,
      cantidad: parseFloat(pedido.cantidad ?? '0'),
      nombre: '',
      unidad: pedido.unidad_medida ?? 'kg',
      stock: 0,
    }] : [];

    if (items.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Pedido sin productos' }); }

    // Lock TODOS los productos del pedido en una sola query (evita N+1 + race conditions
    // entre filas distintas de la misma transacción)
    const productoIds = items.filter(i => i.cantidad > 0).map(i => i.producto_id);
    if (productoIds.length > 0) {
      const { rows: prodRows } = await client.query<{
        id: string; stock_actual: string; nombre: string; unidad_medida: string;
      }>(
        `SELECT id, stock_actual, nombre, unidad_medida
         FROM productos WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [productoIds]
      );
      const prodMap = new Map(prodRows.map(p => [p.id, p]));

      // Verificar stock con datos ya bloqueados
      for (const item of items) {
        if (item.cantidad <= 0) continue;
        const prod = prodMap.get(item.producto_id);
        if (!prod) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Producto ${item.producto_id} no encontrado` });
        }
        item.stock = parseFloat(prod.stock_actual);
        item.nombre = prod.nombre;
        item.unidad = prod.unidad_medida;
        if (item.stock < item.cantidad) {
          await client.query('ROLLBACK');
          return res.status(422).json({
            error: 'STOCK_INSUFICIENTE',
            mensaje: `${item.nombre}: stock ${item.stock.toFixed(3)} ${item.unidad}, necesario ${item.cantidad.toFixed(3)} ${item.unidad}`,
          });
        }
      }
    }

    // Descontar stock FIFO de cada item
    const consumidos: string[] = [];
    for (const item of items) {
      if (item.cantidad <= 0) continue;

      // Si hay override de lotes para este producto, usar ese orden
      const overrideIds = lotesOverride[item.producto_id];
      let lotes;
      if (overrideIds && overrideIds.length > 0) {
        const { rows } = await client.query(
          `SELECT id, cantidad_actual FROM lotes
           WHERE id = ANY($1) AND producto_id = $2 AND estado = 'aprobado' AND cantidad_actual > 0 FOR UPDATE`,
          [overrideIds, item.producto_id]
        );
        // Mantener el orden del override
        lotes = overrideIds.map(oid => rows.find(r => r.id === oid)).filter(Boolean);
      } else {
        const { rows } = await client.query(
          `SELECT id, cantidad_actual FROM lotes
           WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
           ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
          [item.producto_id]
        );
        lotes = rows;
      }

      let restante = item.cantidad;
      // Refetch actual stock inside transaction for accurate stock_moves
      const { rows: [freshStock] } = await client.query(`SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`, [item.producto_id]);
      let stockAntes = parseFloat(freshStock?.stock_actual ?? '0');
      for (const lote of lotes) {
        if (restante <= 0) break;
        const disponible = parseFloat(lote.cantidad_actual);
        const consumir = Math.min(disponible, restante);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`, [consumir.toFixed(6), lote.id]);

        const stockDespues = stockAntes - consumir;
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6)`,
          [item.producto_id, lote.id, (-consumir).toFixed(6), stockAntes.toFixed(6), stockDespues.toFixed(6),
           `Pedido ${pedido.numero_pedido} - ${pedido.cliente_nombre ?? ''}`]
        );
        stockAntes = stockDespues;
        restante -= consumir;
      }

      // Verify all quantity was consumed from approved lots
      if (restante > 0.001) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'STOCK_INSUFICIENTE',
          mensaje: `${item.nombre}: solo hay ${(item.cantidad - restante).toFixed(3)} ${item.unidad} en lotes aprobados, necesario ${item.cantidad.toFixed(3)} ${item.unidad}`,
        });
      }

      await client.query(`UPDATE productos SET stock_actual = stock_actual - $1::NUMERIC WHERE id = $2`, [item.cantidad.toFixed(6), item.producto_id]);
      consumidos.push(`${item.nombre}: ${item.cantidad} ${item.unidad}`);
    }

    // Release reservas + set estado completado
    await client.query(`DELETE FROM reservas_stock WHERE pedido_id = $1`, [id]);
    await client.query(`UPDATE pedidos SET estado = 'completado' WHERE id = $1`, [id]);
    await client.query('COMMIT');
    invalidarCacheFinanzas();

    // Push-based: check stock alerts for consumed products
    const consumedIds = items.map(i => i.producto_id);
    alertaService.checkStockMinimo(consumedIds).catch(() => {});

    // Automatizaciones: cada producto consumido puede haber bajado del mínimo
    setImmediate(() => {
      for (const id of consumedIds) {
        automatizacionesService.checkStockAndTrigger(id).catch(err => console.error('[auto.pedido-consumir]', err));
      }
      // Auto-email albarán al cliente si toggle activo
      automatizacionesService.autoEmailAlbaran(req.params.id)
        .catch(err => console.error('[auto.email-albaran]', err));
    });

    return res.json({ ok: true, consumidos });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  } finally {
    client.release();
  }
});

// GET /api/pedidos/:id/albaran.pdf — Albaran de entrega conforme legislacion espanola (RD 1619/2012)
router.get('/:id/albaran.pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: [pedido] } = await pool.query(`
      SELECT pd.*, c.nombre AS cliente_nombre_rel, c.email AS cliente_email_rel,
             c.direccion AS cliente_direccion, c.nif AS cliente_nif, c.telefono AS cliente_telefono
      FROM pedidos pd LEFT JOIN clientes c ON c.id = pd.cliente_id
      WHERE pd.id = $1`, [id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { rows: lineas } = await pool.query(`
      SELECT lp.*, p.nombre AS producto_nombre_rel, p.codigo AS producto_codigo
      FROM lineas_pedido lp LEFT JOIN productos p ON p.id = lp.producto_id
      WHERE lp.pedido_id = $1 ORDER BY lp.created_at ASC`, [id]);

    // Lotes consumidos (trazabilidad)
    const { rows: movimientos } = await pool.query(`
      SELECT sm.cantidad, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
             l.lote_interno, l.fecha_caducidad, l.fecha_entrada
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      LEFT JOIN lotes l ON l.id = sm.lote_id
      WHERE sm.motivo LIKE $1
      ORDER BY p.nombre ASC, sm.created_at ASC`, [`%${pedido.numero_pedido}%`]);

    // Fotos del lote de produccion
    let fotosProd: string[] = [];
    if (pedido.orden_produccion_id) {
      const { rows: [op] } = await pool.query(`SELECT foto_urls, archivos, registro_limpieza FROM ordenes_produccion WHERE id = $1`, [pedido.orden_produccion_id]);
      if (op) fotosProd = op.foto_urls ?? [];
    }

    // Datos empresa desde configuracion
    const { rows: [cfg] } = await pool.query(`SELECT * FROM configuracion_global WHERE id = 1`);
    const EMP = {
      nombre: cfg?.empresa_nombre || 'Colas Loga S.L.',
      cif: cfg?.empresa_cif || '',
      dir: cfg?.empresa_direccion || '',
      tel: cfg?.empresa_telefono || '',
      web: cfg?.empresa_web || '',
      email: cfg?.email_remitente || '',
    };

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="albaran-${pedido.numero_pedido}.pdf"`);
    doc.pipe(res);

    const RED = '#E8001C'; const DARK = '#1A1A1A'; const GRAY = '#6B7280';
    const LGRAY = '#F9FAFB'; const WHITE = '#FFFFFF'; const BORDER = '#E5E7EB';
    const BLUE = '#1D4ED8';
    const W = 495; const L = 50;
    const LOGO = path.join(process.cwd(), 'assets', 'logo-real.png');
    const hasLogo = fs.existsSync(LOGO);
    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('es-ES') : '---';
    const fmtNum = (n: string | number) => parseFloat(String(n)).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

    // ── CABECERA ─────────────────────────────────────────
    doc.rect(0, 0, 595, 90).fill(RED);
    if (hasLogo) { doc.roundedRect(20, 8, 74, 74, 8).fill(WHITE); try { doc.image(LOGO, 22, 10, { fit: [70, 70] }); } catch {} }
    doc.fillColor(WHITE).fontSize(20).font('Helvetica-Bold').text('ALBARAN DE ENTREGA', 105, 16);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica').text(EMP.nombre, 105, 40);
    doc.fillColor(WHITE).fontSize(7.5).font('Helvetica').text((EMP.cif ? 'CIF: ' + EMP.cif + '  |  ' : '') + EMP.dir + (EMP.tel ? '  |  Tel: ' + EMP.tel : ''), 105, 54);
    doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold').text(pedido.numero_pedido, 340, 16, { align: 'right', width: 220 });
    doc.fillColor(WHITE).fontSize(8).font('Helvetica')
      .text('Fecha emision: ' + new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }), 340, 40, { align: 'right', width: 220 });
    if (pedido.fecha_entrega) doc.text('Fecha entrega: ' + fmtDate(pedido.fecha_entrega), 340, 52, { align: 'right', width: 220 });
    doc.rect(0, 90, 595, 3).fill(WHITE);

    let y = 106;

    // ── DATOS EMISOR + RECEPTOR ──────────────────────────
    const boxW = (W - 10) / 2;
    // Emisor
    doc.rect(L, y, boxW, 52).fill(LGRAY).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text('EMISOR', L + 6, y + 4);
    doc.fillColor(DARK).fontSize(8).font('Helvetica-Bold').text(EMP.nombre, L + 6, y + 16);
    doc.fillColor(GRAY).fontSize(7).font('Helvetica');
    doc.text('CIF: ' + (EMP.cif || '---'), L + 6, y + 28);
    doc.text(EMP.dir || '', L + 6, y + 38);

    // Receptor
    const rx = L + boxW + 10;
    doc.rect(rx, y, boxW, 52).fill(LGRAY).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fillColor(RED).fontSize(7).font('Helvetica-Bold').text('DESTINATARIO', rx + 6, y + 4);
    doc.fillColor(DARK).fontSize(8).font('Helvetica-Bold').text(pedido.cliente_nombre_rel ?? pedido.cliente_nombre ?? '---', rx + 6, y + 16);
    doc.fillColor(GRAY).fontSize(7).font('Helvetica');
    doc.text('NIF/CIF: ' + (pedido.cliente_nif ?? '---'), rx + 6, y + 28);
    doc.text(pedido.cliente_direccion ?? '', rx + 6, y + 38);
    y += 60;

    // ── DETALLE DE MERCANCIA ─────────────────────────────
    doc.rect(L, y, W, 15).fill(RED);
    doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold');
    const cols = [30, 190, 65, 50, 75, 85];
    const heads = ['#', 'Descripcion mercancia', 'Cantidad', 'Ud.', 'Precio ud.', 'Importe'];
    let cx = L;
    heads.forEach((h, i) => { doc.text(h, cx + 4, y + 4, { width: cols[i] - 4 }); cx += cols[i]; });
    y += 15;

    const items = lineas.length > 0 ? lineas : (pedido.producto_id ? [{
      producto_nombre_rel: null, producto_nombre: pedido.producto_nombre, producto_codigo: pedido.producto_codigo,
      cantidad: pedido.cantidad, unidad_medida: pedido.unidad_medida, precio_unitario: null, subtotal: null,
    }] : []);

    items.forEach((l: any, i: number) => {
      const bg = i % 2 === 0 ? LGRAY : WHITE;
      doc.rect(L, y, W, 17).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
      cx = L;
      const nombre = (l.producto_nombre_rel ?? l.producto_nombre ?? '---');
      const codigo = l.producto_codigo ? ` (${l.producto_codigo})` : '';
      const vals = [
        String(i + 1),
        nombre + codigo,
        l.cantidad ? fmtNum(l.cantidad) : '',
        l.unidad_medida ?? 'kg',
        l.precio_unitario ? fmtNum(l.precio_unitario) + ' EUR' : '',
        l.subtotal ? fmtNum(l.subtotal) + ' EUR' : '',
      ];
      vals.forEach((v, vi) => {
        doc.fillColor(DARK).fontSize(7.5).font(vi === 1 ? 'Helvetica-Bold' : 'Helvetica').text(v, cx + 4, y + 5, { width: cols[vi] - 4 });
        cx += cols[vi];
      });
      y += 17;
    });

    // ── TOTALES ──────────────────────────────────────────
    if (pedido.subtotal && parseFloat(pedido.subtotal) > 0) {
      y += 4;
      const tX = L + cols[0] + cols[1] + cols[2] + cols[3];
      const tW = cols[4] + cols[5];

      const row = (label: string, val: string, bold = false, bg = LGRAY) => {
        doc.rect(tX, y, tW, 14).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').text(label, tX + 4, y + 3, { width: cols[4] - 4 });
        doc.fillColor(DARK).fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').text(val, tX + cols[4] + 4, y + 3, { width: cols[5] - 4 });
        y += 14;
      };

      row('Base imponible', fmtNum(pedido.subtotal) + ' EUR');
      if (pedido.portes && parseFloat(pedido.portes) > 0) row('Portes', fmtNum(pedido.portes) + ' EUR');
      const ivaPct = parseFloat(pedido.iva_porcentaje ?? '21');
      const base = parseFloat(pedido.subtotal) + parseFloat(pedido.portes ?? '0');
      const ivaAmt = base * ivaPct / 100;
      row('IVA ' + ivaPct + '%', fmtNum(ivaAmt) + ' EUR');

      doc.rect(tX, y, tW, 18).fill(RED);
      doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold').text('TOTAL', tX + 4, y + 5, { width: cols[4] - 4 });
      doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text(fmtNum(pedido.total) + ' EUR', tX + cols[4] + 4, y + 3, { width: cols[5] - 4 });
      y += 22;
    }

    // ── TRAZABILIDAD DE LOTES ────────────────────────────
    if (movimientos.length > 0) {
      if (y > 660) { doc.addPage(); y = 40; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
      y += 6;
      doc.rect(L, y, W, 15).fill(BLUE);
      doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold').text('TRAZABILIDAD DE LOTES EXPEDIDOS', L + 8, y + 4);
      y += 15;

      // Header
      doc.rect(L, y, W, 13).fill('#EFF6FF').strokeColor(BORDER).lineWidth(0.5).stroke();
      const tc = [200, 120, 90, 85];
      ['Producto', 'Lote', 'Caducidad', 'Cantidad'].forEach((h, i) => {
        let tx = L; for (let j = 0; j < i; j++) tx += tc[j];
        doc.fillColor(BLUE).fontSize(7).font('Helvetica-Bold').text(h, tx + 4, y + 3, { width: tc[i] - 4 });
      });
      y += 13;

      movimientos.forEach((m: any, i: number) => {
        if (y > 770) { doc.addPage(); y = 40; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
        const bg = i % 2 === 0 ? LGRAY : WHITE;
        doc.rect(L, y, W, 14).fill(bg).strokeColor(BORDER).lineWidth(0.5).stroke();
        let tx = L;
        [m.producto_nombre + ' (' + m.producto_codigo + ')', m.lote_interno ?? '---', fmtDate(m.fecha_caducidad), Math.abs(parseFloat(m.cantidad)).toFixed(3)].forEach((v, vi) => {
          doc.fillColor(DARK).fontSize(7).font(vi === 0 ? 'Helvetica-Bold' : 'Helvetica').text(v, tx + 4, y + 3, { width: tc[vi] - 4 });
          tx += tc[vi];
        });
        y += 14;
      });
    }

    // ── FOTOS DEL LOTE ───────────────────────────────────
    const validFotos = fotosProd.map(u => path.join(process.cwd(), u.replace(/^\//, ''))).filter(p => fs.existsSync(p));
    if (validFotos.length > 0) {
      if (y > 550) { doc.addPage(); y = 40; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
      y += 6;
      doc.rect(L, y, W, 15).fill(DARK);
      doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold').text('FOTOGRAFIAS DEL LOTE', L + 8, y + 4);
      y += 20;
      for (const fotoPath of validFotos.slice(0, 4)) {
        if (y > 580) { doc.addPage(); y = 40; doc.rect(0, 0, 595, 3).fill(RED); y += 10; }
        try { doc.image(fotoPath, L + (W - 250) / 2, y, { fit: [250, 180] }); y += 190; } catch {}
      }
    }

    // ── OBSERVACIONES ────────────────────────────────────
    if (pedido.notas) {
      if (y > 740) { doc.addPage(); y = 40; }
      y += 6;
      doc.fillColor(GRAY).fontSize(7.5).font('Helvetica-Bold').text('OBSERVACIONES:', L, y);
      doc.fillColor(DARK).fontSize(7.5).font('Helvetica').text(pedido.notas, L, y + 12, { width: W });
      y += 30;
    }

    // ── FIRMAS ───────────────────────────────────────────
    const signY = Math.max(y + 10, 710);
    if (signY < 770) {
      doc.fillColor(GRAY).fontSize(7.5).font('Helvetica-Bold');
      doc.text('Entregado por:', L, signY);
      doc.text('Recibido por (sello y firma):', L + 260, signY);
      doc.rect(L, signY + 12, 200, 50).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.rect(L + 260, signY + 12, 200, 50).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.fillColor(GRAY).fontSize(6.5).font('Helvetica');
      doc.text('Nombre:', L + 4, signY + 48);
      doc.text('Nombre:', L + 264, signY + 48);
      doc.text('Fecha:', L + 4, signY + 56);
      doc.text('Fecha:', L + 264, signY + 56);
    }

    // ── PIE LEGAL ────────────────────────────────────────
    doc.rect(0, 818, 595, 3).fill(RED);
    doc.fillColor(GRAY).fontSize(6).font('Helvetica')
      .text(
        EMP.nombre + (EMP.cif ? ' | CIF: ' + EMP.cif : '') + (EMP.dir ? ' | ' + EMP.dir : '') + ' | ' + EMP.email +
        ' | Albaran n. ' + pedido.numero_pedido + ' | ' + new Date().toLocaleDateString('es-ES') +
        ' | Este documento sirve como justificante de entrega de la mercancia descrita.',
        L, 824, { align: 'center', width: W, lineGap: 1 }
      );

    doc.end();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/pedidos/:id/enviar-albaran — envia albaran PDF + trazabilidad + fotos + docs por email
router.post('/:id/enviar-albaran', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email es obligatorio' });

    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const nodemailer = require('nodemailer');

    const { rows: [pedido] } = await pool.query(`
      SELECT pd.*, c.nombre AS cliente_nombre_rel
      FROM pedidos pd LEFT JOIN clientes c ON c.id = pd.cliente_id
      WHERE pd.id = $1`, [id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const { rows: lineas } = await pool.query(
      `SELECT lp.*, p.nombre AS producto_nombre_rel FROM lineas_pedido lp LEFT JOIN productos p ON p.id = lp.producto_id WHERE lp.pedido_id = $1`, [id]);

    // Generate full albaran PDF by requesting our own endpoint (timeout 10s)
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const port = process.env.PORT || 3001;
      const req = http.get(`http://localhost:${port}/api/pedidos/${id}/albaran.pdf`, { timeout: 10_000 }, (pdfRes: any) => {
        const chunks: Buffer[] = [];
        pdfRes.on('data', (c: Buffer) => chunks.push(c));
        pdfRes.on('end', () => resolve(Buffer.concat(chunks)));
        pdfRes.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('PDF_TIMEOUT')));
      req.on('error', reject);
    });

    // Attachments: albaran PDF
    const attachments: { filename: string; content?: Buffer; path?: string; contentType?: string }[] = [
      { filename: `albaran-${pedido.numero_pedido}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    ];

    // Produccion: trazabilidad PDF + fotos + docs
    if (pedido.orden_produccion_id) {
      // Trazabilidad PDF
      try {
        const trazBuffer = await new Promise<Buffer>((resolve, reject) => {
          const port = process.env.PORT || 3001;
          const req = http.get(`http://localhost:${port}/api/produccion/${pedido.orden_produccion_id}/trazabilidad.pdf`, { timeout: 10_000 }, (r: any) => {
            const ch: Buffer[] = [];
            r.on('data', (c: Buffer) => ch.push(c));
            r.on('end', () => resolve(Buffer.concat(ch)));
            r.on('error', reject);
          });
          req.on('timeout', () => req.destroy(new Error('TRAZABILIDAD_TIMEOUT')));
          req.on('error', reject);
        });
        attachments.push({ filename: `trazabilidad-${pedido.numero_pedido}.pdf`, content: trazBuffer, contentType: 'application/pdf' });
      } catch (trazErr) { logger.error('[enviar-albaran] trazabilidad fail', { err: trazErr }); }

      // Fotos + documentos. Validamos que el path resuelto está dentro de uploads/
      // (anti path-traversal: si la URL tiene ../../ no escapará del sandbox).
      const uploadsRoot = path.resolve(process.cwd(), 'uploads');
      const safeJoin = (rel: string): string | null => {
        const resolved = path.resolve(process.cwd(), rel.replace(/^\//, ''));
        if (!resolved.startsWith(uploadsRoot + path.sep)) return null;
        return resolved;
      };
      const { rows: [orden] } = await pool.query(`SELECT foto_urls, archivos, registro_limpieza FROM ordenes_produccion WHERE id = $1`, [pedido.orden_produccion_id]);
      if (orden) {
        const fotos: string[] = orden.foto_urls ?? [];
        for (let i = 0; i < fotos.length; i++) {
          const p = safeJoin(fotos[i]);
          if (p && fs.existsSync(p)) attachments.push({ filename: `foto-lote-${i + 1}${path.extname(p)}`, path: p });
        }
        const archivos: { url: string; nombre: string }[] = orden.archivos ?? [];
        for (const a of archivos) {
          const p = safeJoin(a.url);
          // filename en el adjunto: solo basename para evitar headers raros
          if (p && fs.existsSync(p)) attachments.push({ filename: path.basename(a.nombre || path.basename(p)), path: p });
        }
      }
    }

    // SMTP
    const { rows: [cfg] } = await pool.query(`SELECT * FROM configuracion_global WHERE id = 1`);
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host || process.env.SMTP_HOST,
      port: cfg.smtp_port || Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: cfg.smtp_user || process.env.SMTP_USER, pass: cfg.smtp_pass_enc || process.env.SMTP_PASS },
    });

    const emailItems = lineas.length > 0 ? lineas : [{ producto_nombre_rel: pedido.producto_nombre, cantidad: pedido.cantidad, unidad_medida: pedido.unidad_medida }];
    const itemsText = emailItems.map((l: any) => '  - ' + (l.producto_nombre_rel ?? '') + ': ' + (l.cantidad ? parseFloat(l.cantidad).toLocaleString('es-ES') : '') + ' ' + (l.unidad_medida ?? 'kg')).join('\n');

    await transporter.sendMail({
      from: cfg.email_remitente || process.env.EMAIL_FROM || 'Colas Loga <erp@loga.es>',
      to: email,
      subject: 'Albaran ' + pedido.numero_pedido + ' - Colas Loga',
      text: 'Estimado cliente,\n\nAdjuntamos albaran de entrega ' + pedido.numero_pedido + '.\n\nProductos:\n' + itemsText + '\n\nColas Loga\nAdhesivos Vinilicos de Alta Resistencia',
      attachments,
    });

    // Marcar como enviado para evitar reenvíos automáticos
    await pool.query(
      `UPDATE pedidos SET albaran_enviado = TRUE, albaran_enviado_at = NOW(), albaran_enviado_a = $1
       WHERE id = $2`,
      [email, id]
    );

    return res.json({ ok: true, enviado_a: email });
  } catch (err) {
    console.error('[enviarAlbaran]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al enviar' });
  }
});

// POST /api/pedidos/webhook - receive orders from email (Google Apps Script)
// Exported separately so it can be mounted as a public route in index.ts
export async function webhookHandler(req: Request, res: Response) {
  try {
    const { cliente_nombre, cliente_email, producto_nombre, cantidad, unidad_medida, fecha_entrega, asunto, cuerpo, token } = req.body;

    // Validate webhook token con comparación constant-time (anti timing attack)
    const expectedToken = process.env.WEBHOOK_TOKEN;
    if (!expectedToken) return res.status(500).json({ error: 'Webhook no configurado' });
    const tokenStr = typeof token === 'string' ? token : '';
    const a = Buffer.from(tokenStr);
    const b = Buffer.from(expectedToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Token invalido' });
    }

    // Try to match client by email
    let cliente_id = null;
    if (cliente_email) {
      const { rows } = await pool.query(
        `SELECT id FROM clientes WHERE email ILIKE $1 AND activo = TRUE LIMIT 1`,
        [cliente_email]
      );
      if (rows.length > 0) cliente_id = rows[0].id;
    }

    // Try to match product by name
    let producto_id = null;
    if (producto_nombre) {
      const { rows } = await pool.query(
        `SELECT id FROM productos WHERE (nombre ILIKE $1 OR codigo ILIKE $1) AND activo = TRUE LIMIT 1`,
        [`%${producto_nombre}%`]
      );
      if (rows.length > 0) producto_id = rows[0].id;
    }

    const { rows: [pedido] } = await pool.query(
      `INSERT INTO pedidos (cliente_id, cliente_nombre, cliente_email, producto_id, producto_nombre, cantidad, unidad_medida, fecha_entrega, email_asunto, email_cuerpo, origen)
       VALUES ($1, $2, $3, $4, $5, $6::NUMERIC, $7, $8, $9, $10, 'email')
       RETURNING *`,
      [
        cliente_id, cliente_nombre ?? null, cliente_email ?? null,
        producto_id, producto_nombre ?? null, cantidad ?? null,
        unidad_medida ?? 'kg', fecha_entrega ?? null,
        asunto ?? null, cuerpo ?? null,
      ]
    );

    return res.status(201).json({ ok: true, numero_pedido: pedido.numero_pedido, id: pedido.id });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
}

// Also keep it on the router for backwards compat (will be behind auth when mounted via router)
router.post('/webhook', async (req: Request, res: Response) => {
  return webhookHandler(req, res);
});

export default router;
