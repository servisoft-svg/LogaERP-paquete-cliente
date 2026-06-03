import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool, acquireProductLocks, withSerializableTransaction } from '../db/pool';
import { AppError } from '../lib/AppError';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { alertaService } from '../services/alerta.service';
import { automatizacionesService } from '../services/automatizaciones.service';
import { pedidoAlbaranService } from '../services/pedido-albaran.service';
import { adminOnly } from '../middleware/auth';
import { logger } from '../lib/logger';

const router = Router();

// GET /api/pedidos
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
    const offset = (page - 1) * limit;
    // Subquery `coste_real`: suma de (cantidad consumida × precio_compra del lote)
    // a partir de reservas_stock con estado='consumida' (lo que realmente se gastó
    // de cada lote concreto). Solo lectura — NO modifica nada de stock ni reservas.
    // Si un pedido no tiene reservas consumidas (cancelado / no completado / sin
    // lote_id), el SUM devuelve NULL y el frontend lo muestra como "—".
    const { rows } = await pool.query(`
      SELECT pd.*,
        c.nombre AS cliente_nombre_rel,
        p.nombre AS producto_nombre_rel, p.codigo AS producto_codigo,
        p.unidad_medida AS producto_unidad,
        op.numero_orden,
        (SELECT SUM(rs.cantidad * COALESCE(l.precio_compra, 0))
         FROM reservas_stock rs
         LEFT JOIN lotes l ON l.id = rs.lote_id
         WHERE rs.pedido_id = pd.id
           AND rs.estado = 'consumida'
           AND rs.lote_id IS NOT NULL
        )
        + COALESCE(
          (SELECT SUM(pe.cantidad * COALESCE(pp.coste_medio_actual, pp.precio_unitario, 0))
             FROM pedido_embalajes_extra pe
             JOIN productos pp ON pp.id = pe.producto_id
            WHERE pe.pedido_id = pd.id), 0)
        AS coste_real
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

// POST /api/pedidos — crea pedido + líneas + reservas FIFO en UNA transacción
// SERIALIZABLE. Si la reserva falla, ROLLBACK total → no queda pedido huérfano.
// Adicionalmente valida totales calculados (no acepta Infinity/NaN).
router.post('/', async (req, res) => {
  try {
    const { cliente_id, cliente_nombre, producto_id, cantidad, fecha_entrega, notas, lineas, subtotal, portes, iva_porcentaje } = req.body;
    const userRol = (req as any).user?.rol;
    const esAdmin = userRol === 'admin';

    // [H3.2 audit v3] Si NO es admin, ignorar precio_unitario del body y usar
    // precio_venta del catálogo. Manual: "precio unitario solo admin".
    // Antes: trabajador podía enviar precio = 0.01 y el servidor lo aceptaba.
    if (!esAdmin && Array.isArray(lineas) && lineas.length > 0) {
      const productoIds = lineas
        .map((l: any) => l.producto_id)
        .filter((id: any) => typeof id === 'string' && id);
      if (productoIds.length > 0) {
        const { rows: prods } = await pool.query<{ id: string; nombre: string; precio_venta: string }>(
          `SELECT id, nombre, COALESCE(precio_venta, 0)::TEXT AS precio_venta FROM productos WHERE id = ANY($1::uuid[])`,
          [productoIds]
        );
        const precioMap = new Map(prods.map(p => [p.id, parseFloat(p.precio_venta)]));
        const nombreMap = new Map(prods.map(p => [p.id, p.nombre]));
        // Edge case: producto puede no tener precio_venta configurado (NULL o 0).
        // Fallback ?? 0 para evitar NaN en el total. Si queda en 0, log warn
        // pero NO bloquea: el admin puede revisar el pedido y editarlo después.
        for (const l of lineas as any[]) {
          if (!l.producto_id) continue;
          const precio = precioMap.get(l.producto_id) ?? 0;
          l.precio_unitario = precio;
          if (precio === 0) {
            logger.warn('[POST pedidos] Producto sin precio_venta configurado', {
              producto_id: l.producto_id,
              producto_nombre: nombreMap.get(l.producto_id) ?? 'desconocido',
              usuario_id: (req as any).user?.id,
            });
          }
        }
      }
    }

    // Server-side validation: recalculate totals from lineas + sanidad numérica
    const portesNum = Number(portes ?? 0);
    const ivaPctNum = Number(iva_porcentaje ?? 21);
    let subtotalCalc = Number(subtotal ?? 0);
    if (Array.isArray(lineas) && lineas.length > 0) {
      subtotalCalc = lineas.reduce((s: number, l: any) => {
        const q = Number(l.cantidad ?? 0);
        const p = Number(l.precio_unitario ?? 0);
        return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0);
    }
    const ivaCalc = (subtotalCalc + portesNum) * ivaPctNum / 100;
    const totalCalc = subtotalCalc + portesNum + ivaCalc;

    // Anti-NaN/Infinity: cualquier número inválido aborta con 400 (mejor que
    // dejar 'NaN' guardado en BD y descubrirlo cuando una factura imprima 'NaN€')
    for (const [name, val] of [['subtotal', subtotalCalc], ['portes', portesNum], ['iva', ivaPctNum], ['total', totalCalc]] as const) {
      if (!Number.isFinite(val) || Math.abs(val) > 1e9) {
        return res.status(400).json({ error: `Valor numérico inválido en ${name}: ${val}` });
      }
    }

    if (Array.isArray(lineas) && lineas.length > 100) {
      return res.status(400).json({ error: 'Maximo 100 lineas por pedido.' });
    }

    const lineasValidas = Array.isArray(lineas)
      ? (lineas as { producto_id?: string; producto_nombre?: string; cantidad?: string|number; unidad_medida?: string; notas?: string; precio_unitario?: string|number; subtotal?: string|number }[])
          .filter(l => l.producto_id || l.producto_nombre)
      : [];

    type Reserva = { producto_id: string; cantidad: number };
    const itemsToReserve: Reserva[] = [];
    if (lineasValidas.length > 0) {
      for (const l of lineasValidas) {
        if (l.producto_id && l.cantidad) {
          const c = Number(l.cantidad);
          if (Number.isFinite(c) && c > 0) itemsToReserve.push({ producto_id: l.producto_id, cantidad: c });
        }
      }
    } else if (producto_id && cantidad) {
      const c = Number(cantidad);
      if (Number.isFinite(c) && c > 0) itemsToReserve.push({ producto_id, cantidad: c });
    }

    // TODO atómico: pedido + líneas + reservas en una sola SERIALIZABLE.
    // Si reserva falla → ROLLBACK → no queda pedido huérfano (Fix #14).
    let reservationFailed = false;
    let reservationError: string | null = null;
    const pedido = await withSerializableTransaction(async (client) => {
      // Lock por producto antes de cualquier mutación de stock
      if (itemsToReserve.length > 0) {
        await acquireProductLocks(client, itemsToReserve.map(i => i.producto_id));
      }

      // 1) INSERT pedido
      const { rows: [p] } = await client.query(
        `INSERT INTO pedidos (cliente_id, cliente_nombre, producto_id, cantidad, fecha_entrega, notas, origen, estado, subtotal, portes, iva_porcentaje, total)
         VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, 'manual', 'confirmado', $7::NUMERIC, $8::NUMERIC, $9::NUMERIC, $10::NUMERIC)
         RETURNING *`,
        [cliente_id ?? null, cliente_nombre ?? null, producto_id ?? null, cantidad ?? null, fecha_entrega ?? null, notas ?? null,
         subtotalCalc.toFixed(2), portesNum.toFixed(2), ivaPctNum, totalCalc.toFixed(2)]
      );

      // 2) INSERT líneas (batch). Incluye desglose cajas+sueltos+caja_id si la
      // línea viene de un PE con caja vinculada (frontend lo manda).
      if (lineasValidas.length > 0) {
        const placeholders: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        for (const l of lineasValidas) {
          placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::UUID)`);
          params.push(
            p.id, l.producto_id ?? null, l.producto_nombre ?? null,
            l.cantidad ?? null, l.unidad_medida ?? 'kg', l.notas ?? null,
            l.precio_unitario ?? null, l.subtotal ?? null,
            (l as any).cantidad_cajas ?? 0,
            (l as any).cantidad_botes_sueltos ?? 0,
            (l as any).caja_id ?? null,
          );
        }
        await client.query(
          `INSERT INTO lineas_pedido (pedido_id, producto_id, producto_nombre, cantidad, unidad_medida, notas, precio_unitario, subtotal, cantidad_cajas, cantidad_botes_sueltos, caja_id)
           VALUES ${placeholders.join(', ')}`,
          params
        );
        // Reactivar cliente si estaba archivado (auto-recovery cuando vuelve a comprar)
        if (p.cliente_id) {
          await client.query(
            `UPDATE clientes
               SET archivado_at = NULL, archivado_motivo = NULL, archivado_por_id = NULL
             WHERE id = $1 AND archivado_at IS NOT NULL`,
            [p.cliente_id]
          );
        }

        // Memoria de precio cliente↔producto. UPSERT por cada línea con
        // precio > 0. Se usa luego como sugerencia en el siguiente pedido.
        if (p.cliente_id) {
          for (const l of lineasValidas) {
            const precioNum = parseFloat(String(l.precio_unitario ?? '0'));
            if (!l.producto_id || !(precioNum > 0)) continue;
            await client.query(
              `INSERT INTO precios_cliente_producto
                 (cliente_id, producto_id, precio_unitario, num_usos, ultimo_uso_at)
               VALUES ($1, $2, $3::NUMERIC, 1, NOW())
               ON CONFLICT (cliente_id, producto_id) DO UPDATE
                 SET precio_unitario = EXCLUDED.precio_unitario,
                     num_usos = precios_cliente_producto.num_usos + 1,
                     ultimo_uso_at = NOW()`,
              [p.cliente_id, l.producto_id, precioNum]
            );
          }
        }
      }

      // 3) Reservar stock FIFO. Si falta stock, marca warning pero no aborta
      //    (la lógica original no abortaba — preservamos comportamiento).
      //    Sólo fallos REALES de BD (deadlock, etc) propagan el throw que
      //    aborta toda la transacción.
      if (itemsToReserve.length > 0) {
        try {
          for (const item of itemsToReserve) {
            const { rows: lotes } = await client.query(
              `SELECT l.id,
                      l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id AND r.estado = 'activa'), 0) AS disponible
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
              await client.query(
                `INSERT INTO reservas_stock (pedido_id, producto_id, lote_id, cantidad) VALUES ($1, $2, $3, $4)`,
                [p.id, item.producto_id, l.id, reservar.toFixed(6)]
              );
              falta -= reservar;
            }
            if (falta > 0.001) {
              // Stock insuficiente: marcar warning pero NO abortar — el
              // operario puede confirmar/consumir más tarde cuando llegue stock.
              reservationFailed = true;
              reservationError = `stock_insuficiente:${item.producto_id}:falta=${falta.toFixed(3)}`;
            }
          }
        } catch (resErr) {
          // Error real de BD → propagar para ROLLBACK total
          logger.error('[POST pedidos] reserva fallo BD', { err: resErr });
          throw resErr;
        }
      }

      return p;
    });

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

    // [H1.1 audit v3] Auditoría fail-soft: no bloquea la respuesta.
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CREAR_PEDIDO', 'pedidos', $2, $3)`,
      [(req as any).user?.id ?? null, pedido.id, `Pedido ${pedido.numero_pedido} creado · cliente=${cliente_nombre ?? cliente_id ?? 'sin cliente'} · total=${totalCalc.toFixed(2)}`]
    ).catch((e: unknown) => logger.warn('[auditoria CREAR_PEDIDO]', { err: e instanceof Error ? e.message : e }));

    res.status(201).json({
      ...pedido,
      ...(reservationFailed ? { warning: 'reservation_partial', detalle: reservationError } : {}),
    });
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

router.put('/:id', adminOnly, async (req, res) => {
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
              `SELECT l.id, l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id AND r.estado = 'activa'), 0) AS disponible
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

        // Auditoría · transición de estado pedido (todas las válidas)
        if (estado !== actual.estado) {
          const { rows: [pedInfo] } = await pool.query<{ numero_pedido: string; cliente_nombre: string | null }>(
            `SELECT numero_pedido, cliente_nombre FROM pedidos WHERE id = $1`, [req.params.id]
          );
          pool.query(
            `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
             VALUES ($1, 'CAMBIO_ESTADO_PEDIDO', 'pedidos', $2, $3)`,
            [(req as any).user?.id ?? null, req.params.id,
             `${pedInfo?.numero_pedido ?? ''} · ${actual.estado} → ${estado}${pedInfo?.cliente_nombre ? ` · ${pedInfo.cliente_nombre}` : ''}`]
          ).catch(() => undefined);
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
          for (const l of lineasValidas as { producto_id?: string; producto_nombre?: string; cantidad?: string|number; unidad_medida?: string; precio_unitario?: string|number; cantidad_cajas?: number|string; cantidad_botes_sueltos?: number|string; caja_id?: string }[]) {
            placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::NUMERIC, $${idx++}, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::NUMERIC, $${idx++}::UUID)`);
            const subtotal = (parseFloat(String(l.cantidad ?? 0)) * parseFloat(String(l.precio_unitario ?? 0))).toFixed(2);
            params.push(req.params.id, l.producto_id ?? null, l.producto_nombre ?? null, l.cantidad ?? null, l.unidad_medida ?? 'kg', l.precio_unitario ?? null, subtotal,
              l.cantidad_cajas ?? 0, l.cantidad_botes_sueltos ?? 0, l.caja_id ?? null);
          }
          await txClient.query(
            `INSERT INTO lineas_pedido (pedido_id, producto_id, producto_nombre, cantidad, unidad_medida, precio_unitario, subtotal, cantidad_cajas, cantidad_botes_sueltos, caja_id)
             VALUES ${placeholders.join(', ')}`,
            params
          );
          // Memoria precio cliente↔producto (mismo upsert que en POST)
          const { rows: [ped] } = await txClient.query<{ cliente_id: string | null }>(
            `SELECT cliente_id FROM pedidos WHERE id = $1`, [req.params.id]
          );
          if (ped?.cliente_id) {
            for (const l of lineasValidas as { producto_id?: string; precio_unitario?: string|number }[]) {
              const precioNum = parseFloat(String(l.precio_unitario ?? '0'));
              if (!l.producto_id || !(precioNum > 0)) continue;
              await txClient.query(
                `INSERT INTO precios_cliente_producto (cliente_id, producto_id, precio_unitario, num_usos, ultimo_uso_at)
                 VALUES ($1, $2, $3::NUMERIC, 1, NOW())
                 ON CONFLICT (cliente_id, producto_id) DO UPDATE
                   SET precio_unitario = EXCLUDED.precio_unitario,
                       num_usos = precios_cliente_producto.num_usos + 1,
                       ultimo_uso_at = NOW()`,
                [ped.cliente_id, l.producto_id, precioNum]
              );
            }
          }
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

// DELETE /api/pedidos/:id — restringido a admin
// Cancela un pedido. Si estaba 'completado' (stock ya consumido), REVIERTE el
// stock: devuelve las cantidades a sus lotes originales e inserta stock_moves
// de 'entrada' como reversión auditable. Identifica los movimientos a revertir
// por referencia_externa='PED:<pedido_id>' (precise) con fallback al patrón
// motivo='Pedido <numero> -%' para pedidos anteriores al fix BUG B.
router.delete('/:id', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const { rows: [pedido] } = await client.query<{
      id: string; numero_pedido: string; estado: string; cliente_nombre: string | null;
    }>(`SELECT id, numero_pedido, estado, cliente_nombre FROM pedidos WHERE id = $1 FOR UPDATE`,
       [req.params.id]);
    if (!pedido) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    if (pedido.estado === 'cancelado') {
      await client.query('ROLLBACK');
      return res.json({ ok: true, ya_cancelado: true });
    }

    let reversiones = 0;
    if (pedido.estado === 'completado') {
      // Recuperar los stock_moves de tipo 'salida' generados por este pedido.
      // Filtra por referencia_externa precisa y, como fallback, por motivo
      // legacy (pedidos consumidos antes de la introducción de referencia_externa).
      const { rows: salidas } = await client.query<{
        id: string; producto_id: string; lote_id: string | null; cantidad: string;
      }>(`SELECT id, producto_id, lote_id, cantidad
          FROM stock_moves
          WHERE tipo = 'salida'
            AND cantidad < 0
            AND (
              referencia_externa = 'PED:' || $1::text
              OR motivo LIKE 'Pedido ' || $2 || ' -%'
            )
          ORDER BY created_at ASC`,
         [pedido.id, pedido.numero_pedido]);

      for (const mov of salidas) {
        if (!mov.lote_id) continue; // sin lote no sabemos a dónde devolver
        const devolverCant = Math.abs(parseFloat(mov.cantidad));
        if (devolverCant <= 0) continue;

        // Bloquear lote y devolver. El trigger 025 recalcula productos.stock_actual.
        const { rows: [loteActual] } = await client.query<{ cantidad_actual: string }>(
          `SELECT cantidad_actual FROM lotes WHERE id = $1 FOR UPDATE`, [mov.lote_id]
        );
        if (!loteActual) continue;
        const antes = parseFloat(loteActual.cantidad_actual);
        const despues = antes + devolverCant;
        await client.query(
          `UPDATE lotes SET cantidad_actual = $1::NUMERIC WHERE id = $2`,
          [despues.toFixed(6), mov.lote_id]
        );

        await client.query(
          `INSERT INTO stock_moves
             (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues,
              referencia_externa, usuario_id, motivo)
           VALUES ($1, $2, 'entrada', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC,
                   'PED-REV:' || $6, $7, $8)`,
          [mov.producto_id, mov.lote_id,
           devolverCant.toFixed(6), antes.toFixed(6), despues.toFixed(6),
           pedido.id, (req as any).user?.id ?? null,
           `Reversión cancelación Pedido ${pedido.numero_pedido}${pedido.cliente_nombre ? ' - ' + pedido.cliente_nombre : ''}`]
        );
        reversiones++;
      }
    }

    await client.query(`DELETE FROM reservas_stock WHERE pedido_id = $1`, [pedido.id]);
    await client.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [pedido.id]);
    await client.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CANCELAR_PEDIDO', 'pedidos', $2, $3)`,
      [(req as any).user?.id ?? null, pedido.id,
       reversiones > 0
         ? `Pedido ${pedido.numero_pedido} cancelado; stock revertido en ${reversiones} movimientos`
         : `Pedido ${pedido.numero_pedido} cancelado`]
    );

    await client.query('COMMIT');
    invalidarCacheFinanzas();
    return res.json({ ok: true, reversiones });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('[DELETE pedidos]', { err, pedido_id: req.params.id });
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error al cancelar pedido' });
  } finally {
    client.release();
  }
});

// GET /api/pedidos/:id/lotes-disponibles — lotes FIFO para cada linea del pedido
// GET /api/pedidos/:id/desglose-coste
// Devuelve los lotes que se consumieron del pedido con su coste real:
//   cantidad consumida × precio_compra del lote (no precio ficha).
// Solo LECTURA — no toca stock, reservas, ni stock_moves.
router.get('/:id/desglose-coste', async (req, res) => {
  try {
    const { rows } = await pool.query<{
      lote_id: string; lote_interno: string; producto_id: string; producto_nombre: string;
      producto_codigo: string; unidad_medida: string;
      cantidad: string; precio_compra: string | null;
      fecha_caducidad: Date | null; fecha_entrada: Date | null;
    }>(
      `SELECT rs.lote_id,
              l.lote_interno, l.fecha_caducidad, l.fecha_entrada,
              p.id AS producto_id, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
              p.unidad_medida,
              rs.cantidad, l.precio_compra
       FROM reservas_stock rs
       JOIN lotes l ON l.id = rs.lote_id
       JOIN productos p ON p.id = rs.producto_id
       WHERE rs.pedido_id = $1
         AND rs.estado = 'consumida'
       ORDER BY p.nombre ASC, l.fecha_caducidad ASC NULLS LAST`,
      [req.params.id]
    );

    const desglose = rows.map(r => {
      const cantidad = parseFloat(r.cantidad);
      const precio = r.precio_compra !== null ? parseFloat(r.precio_compra) : 0;
      return {
        lote_id: r.lote_id,
        lote_interno: r.lote_interno,
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        producto_codigo: r.producto_codigo,
        unidad_medida: r.unidad_medida,
        cantidad,
        precio_compra: precio,
        coste_linea: Math.round(cantidad * precio * 100) / 100,
        fecha_caducidad: r.fecha_caducidad,
        fecha_entrada: r.fecha_entrada,
      };
    });
    // Extras de embalaje del pedido — coste = cantidad × CMP del producto.
    // No están en reservas (no son líneas), pero suman al coste interno.
    const { rows: extras } = await pool.query<{
      producto_id: string; producto_nombre: string; producto_codigo: string; unidad_medida: string;
      cantidad: string; coste_unitario: string | null;
    }>(
      `SELECT pe.producto_id,
              p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
              pe.cantidad,
              COALESCE(p.coste_medio_actual, p.precio_unitario, 0) AS coste_unitario
         FROM pedido_embalajes_extra pe JOIN productos p ON p.id = pe.producto_id
        WHERE pe.pedido_id = $1`,
      [req.params.id]
    );
    const extrasDesglose = extras.map(e => {
      const cant = parseFloat(e.cantidad);
      const coste = parseFloat(e.coste_unitario ?? '0');
      return {
        es_extra: true as const,
        producto_id: e.producto_id,
        producto_nombre: e.producto_nombre,
        producto_codigo: e.producto_codigo,
        unidad_medida: e.unidad_medida,
        cantidad: cant,
        precio_compra: coste,
        coste_linea: Math.round(cant * coste * 100) / 100,
      };
    });
    const coste_lineas = Math.round(desglose.reduce((s, d) => s + d.coste_linea, 0) * 100) / 100;
    const coste_extras = Math.round(extrasDesglose.reduce((s, d) => s + d.coste_linea, 0) * 100) / 100;
    const coste_total = Math.round((coste_lineas + coste_extras) * 100) / 100;
    return res.json({ desglose, extras: extrasDesglose, coste_lineas, coste_extras, coste_total });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

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
        tanque: number | null;
      }>(
        `SELECT id, producto_id, lote_interno, cantidad_actual, precio_compra, fecha_caducidad, fecha_entrada, tanque
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
router.post('/:id/consumir', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const { id } = req.params;
    // Acepta dos formatos:
    //   - { producto_id: ['lote_id', ...] }                       → orden, consume FEFO usando solo esos lotes
    //   - { producto_id: [{lote_id, cantidad}, ...] }             → cantidad EXACTA por lote (respeta split manual)
    const lotesOverride: Record<string, string[] | Array<{ lote_id: string; cantidad: number }>> = req.body.lotes_override ?? {};
    const { rows: [pedido] } = await client.query(`SELECT * FROM pedidos WHERE id = $1 FOR UPDATE`, [id]);
    if (!pedido) { await client.query('ROLLBACK'); return next(AppError.notFound('Pedido', id)); }

    // Validate state — only allow consumir from valid states
    const consumirPermitido = ['confirmado', 'en_produccion', 'fabricado', 'envasado'];
    if (!consumirPermitido.includes(pedido.estado)) {
      await client.query('ROLLBACK');
      return next(new AppError(
        'ESTADO_INVALIDO',
        `No se puede consumir un pedido en estado "${pedido.estado}"`,
        { estado_actual: pedido.estado, estados_validos: consumirPermitido }
      ));
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

    if (items.length === 0) { await client.query('ROLLBACK'); return next(AppError.validacion('Pedido sin productos')); }

    // Lock TODOS los productos del pedido en una sola query (evita N+1 + race conditions
    // entre filas distintas de la misma transacción)
    const productoIds = items.filter(i => i.cantidad > 0).map(i => i.producto_id);
    if (productoIds.length > 0) {
      // Advisory lock por producto: serializa con producción/ajustes/automatizaciones.
      await acquireProductLocks(client, productoIds);
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
          return next(AppError.notFound('Producto', item.producto_id));
        }
        item.stock = parseFloat(prod.stock_actual);
        item.nombre = prod.nombre;
        item.unidad = prod.unidad_medida;
        if (item.stock < item.cantidad) {
          await client.query('ROLLBACK');
          return next(new AppError(
            'STOCK_INSUFICIENTE',
            `${item.nombre}: stock ${item.stock.toFixed(3)} ${item.unidad}, necesario ${item.cantidad.toFixed(3)} ${item.unidad}`,
            {
              producto_id: item.producto_id,
              producto: item.nombre,
              stock_actual: item.stock,
              cantidad_necesaria: item.cantidad,
              unidad: item.unidad,
            }
          ));
        }
      }
    }

    // Descontar stock FIFO de cada item
    const consumidos: string[] = [];
    for (const item of items) {
      if (item.cantidad <= 0) continue;

      // Detectar formato del override
      const override = lotesOverride[item.producto_id];
      const isExactFormat = Array.isArray(override) && override.length > 0
        && typeof override[0] === 'object' && override[0] !== null && 'lote_id' in override[0];

      let stockAntes = item.stock;
      let restante = item.cantidad;

      if (isExactFormat) {
        // Cantidades EXACTAS por lote — respeta el split manual del usuario
        const items = override as Array<{ lote_id: string; cantidad: number }>;
        const loteIds = items.map(x => x.lote_id);
        const { rows: locked } = await client.query<{ id: string; cantidad_actual: string }>(
          `SELECT id, cantidad_actual FROM lotes
           WHERE id = ANY($1) AND producto_id = $2 AND estado = 'aprobado' AND cantidad_actual > 0 FOR UPDATE`,
          [loteIds, item.producto_id]
        );
        const locMap = new Map(locked.map(l => [l.id, parseFloat(l.cantidad_actual)]));
        for (const slot of items) {
          const disp = locMap.get(slot.lote_id) ?? 0;
          const consumir = Math.min(slot.cantidad, disp);
          if (consumir <= 0) continue;
          await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`,
            [consumir.toFixed(6), slot.lote_id]);
          const stockDespues = stockAntes - consumir;
          await client.query(
            `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
             VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, 'PED:' || $7, $6)`,
            [item.producto_id, slot.lote_id, (-consumir).toFixed(6), stockAntes.toFixed(6), stockDespues.toFixed(6),
             `Pedido ${pedido.numero_pedido} - ${pedido.cliente_nombre ?? ''}`, pedido.id]
          );
          stockAntes = stockDespues;
          restante -= consumir;
        }
      } else {
        // Formato legacy: solo orden de IDs → FEFO con esa preferencia
        const overrideIds = override as string[] | undefined;
        let lotes;
        if (overrideIds && overrideIds.length > 0) {
          const { rows } = await client.query(
            `SELECT id, cantidad_actual FROM lotes
             WHERE id = ANY($1) AND producto_id = $2 AND estado = 'aprobado' AND cantidad_actual > 0 FOR UPDATE`,
            [overrideIds, item.producto_id]
          );
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
        for (const lote of lotes) {
          if (restante <= 0) break;
          const disponible = parseFloat(lote.cantidad_actual);
          const consumir = Math.min(disponible, restante);
          await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`, [consumir.toFixed(6), lote.id]);
          const stockDespues = stockAntes - consumir;
          await client.query(
            `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
             VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, 'PED:' || $7, $6)`,
            [item.producto_id, lote.id, (-consumir).toFixed(6), stockAntes.toFixed(6), stockDespues.toFixed(6),
             `Pedido ${pedido.numero_pedido} - ${pedido.cliente_nombre ?? ''}`, pedido.id]
          );
          stockAntes = stockDespues;
          restante -= consumir;
        }
      }

      // Verify all quantity was consumed from approved lots
      if (restante > 0.001) {
        await client.query('ROLLBACK');
        return next(new AppError(
          'STOCK_INSUFICIENTE',
          `${item.nombre}: solo hay ${(item.cantidad - restante).toFixed(3)} ${item.unidad} en lotes aprobados, necesario ${item.cantidad.toFixed(3)} ${item.unidad}`,
          {
            producto_id: item.producto_id,
            producto: item.nombre,
            consumido: item.cantidad - restante,
            faltante: restante,
            unidad: item.unidad,
          }
        ));
      }

      // [Eliminado tras hot-fix C-5 trigger]: trigger fn_trg_lotes_stock_actual
      // ya recalculó productos.stock_actual desde lotes al UPDATE lotes anterior.
      // Restar de nuevo causaba doble descuento → CHECK constraint violation.
      consumidos.push(`${item.nombre}: ${item.cantidad} ${item.unidad}`);
    }

    // Cajas autoenlazadas: por cada línea con cantidad_cajas > 0 y caja_id,
    // descontamos esas cajas del stock (FIFO sobre lotes aprobados de la caja).
    // Trazable vía referencia_externa = PED-CAJA:pedido_id.
    const { rows: lineasCajas } = await client.query<{
      caja_id: string; cantidad_cajas: string; producto_id: string; producto_nombre: string;
      caja_nombre: string; caja_codigo: string;
    }>(
      `SELECT lp.caja_id, lp.cantidad_cajas, lp.producto_id, lp.producto_nombre,
              p.nombre AS caja_nombre, p.codigo AS caja_codigo
         FROM lineas_pedido lp JOIN productos p ON p.id = lp.caja_id
        WHERE lp.pedido_id = $1 AND lp.caja_id IS NOT NULL AND lp.cantidad_cajas > 0`,
      [id]
    );
    for (const lc of lineasCajas) {
      const necCajas = parseFloat(lc.cantidad_cajas);
      const { rows: [prodCaja] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`, [lc.caja_id]
      );
      let stockCaja = parseFloat(prodCaja?.stock_actual ?? '0');
      if (stockCaja < necCajas - 0.001) {
        await client.query('ROLLBACK');
        return next(new AppError(
          'STOCK_INSUFICIENTE',
          `Caja ${lc.caja_nombre}: stock ${stockCaja.toFixed(2)} ud, necesario ${necCajas} cajas para ${lc.producto_nombre}`,
          { producto_id: lc.caja_id, producto: lc.caja_nombre, faltante: necCajas - stockCaja, es_caja: true }
        ));
      }
      const { rows: lotesCaja } = await client.query<{ id: string; cantidad_actual: string }>(
        `SELECT id, cantidad_actual FROM lotes
         WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
        [lc.caja_id]
      );
      let restanteCaja = necCajas;
      for (const l of lotesCaja) {
        if (restanteCaja <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, restanteCaja);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`,
          [usar.toFixed(6), l.id]);
        const stockDespues = stockCaja - usar;
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, 'PED-CAJA:' || $7, $6)`,
          [lc.caja_id, l.id, (-usar).toFixed(6), stockCaja.toFixed(6), stockDespues.toFixed(6),
           `Caja ${lc.caja_nombre} para línea ${lc.producto_nombre} en pedido ${pedido.numero_pedido}`, pedido.id]
        );
        stockCaja = stockDespues;
        restanteCaja -= usar;
      }
      if (restanteCaja > 0.001) {
        // Sin lotes suficientes — descuento sin lote
        await client.query(`UPDATE productos SET stock_actual = stock_actual - $1::NUMERIC WHERE id = $2`,
          [restanteCaja.toFixed(6), lc.caja_id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
           VALUES ($1, 'salida', $2::NUMERIC, $3::NUMERIC, $4::NUMERIC, 'PED-CAJA:' || $6, $5)`,
          [lc.caja_id, (-restanteCaja).toFixed(6), stockCaja.toFixed(6), (stockCaja - restanteCaja).toFixed(6),
           `Caja ${lc.caja_nombre} sin lote para ${lc.producto_nombre}`, pedido.id]
        );
      }
      consumidos.push(`${lc.caja_nombre} (caja): ${necCajas} ud`);
    }

    // Extras de embalaje del pedido (palets, film...) — descontar FIFO.
    // No están en líneas (no van al cliente), pero al completar consumimos su
    // stock e insertamos stock_moves tipo='salida' para trazabilidad.
    const { rows: extras } = await client.query<{
      id: string; producto_id: string; cantidad: string; nombre: string; unidad_medida: string;
    }>(
      `SELECT pe.id, pe.producto_id, pe.cantidad, p.nombre, p.unidad_medida
         FROM pedido_embalajes_extra pe JOIN productos p ON p.id = pe.producto_id
        WHERE pe.pedido_id = $1`,
      [id]
    );
    for (const ex of extras) {
      const cantNec = parseFloat(ex.cantidad);
      // Lock + lectura stock del producto extra
      const { rows: [prodEx] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`, [ex.producto_id]
      );
      let stockEx = parseFloat(prodEx?.stock_actual ?? '0');
      if (stockEx < cantNec - 0.001) {
        await client.query('ROLLBACK');
        return next(new AppError(
          'STOCK_INSUFICIENTE',
          `Extra ${ex.nombre}: stock ${stockEx.toFixed(2)} ${ex.unidad_medida}, necesario ${cantNec.toFixed(2)}`,
          { producto_id: ex.producto_id, producto: ex.nombre, faltante: cantNec - stockEx, es_extra: true }
        ));
      }
      // FIFO sobre lotes aprobados (caducidad asc, entrada asc)
      const { rows: lotesEx } = await client.query<{ id: string; cantidad_actual: string }>(
        `SELECT id, cantidad_actual FROM lotes
         WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
         ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC FOR UPDATE`,
        [ex.producto_id]
      );
      let restante = cantNec;
      for (const l of lotesEx) {
        if (restante <= 0) break;
        const disp = parseFloat(l.cantidad_actual);
        const usar = Math.min(disp, restante);
        await client.query(`UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`,
          [usar.toFixed(6), l.id]);
        const stockDespues = stockEx - usar;
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, 'PED-EXTRA:' || $7, $6)`,
          [ex.producto_id, l.id, (-usar).toFixed(6), stockEx.toFixed(6), stockDespues.toFixed(6),
           `Extra pedido ${pedido.numero_pedido}: ${usar.toFixed(2)} ${ex.unidad_medida} ${ex.nombre}`, pedido.id]
        );
        stockEx = stockDespues;
        restante -= usar;
      }
      if (restante > 0.001) {
        // Cubrir resto con descuento sin lote (raro: extras pueden no estar en lotes).
        await client.query(`UPDATE productos SET stock_actual = stock_actual - $1::NUMERIC WHERE id = $2`,
          [restante.toFixed(6), ex.producto_id]);
        await client.query(
          `INSERT INTO stock_moves (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
           VALUES ($1, 'salida', $2::NUMERIC, $3::NUMERIC, $4::NUMERIC, 'PED-EXTRA:' || $6, $5)`,
          [ex.producto_id, (-restante).toFixed(6), stockEx.toFixed(6), (stockEx - restante).toFixed(6),
           `Extra pedido ${pedido.numero_pedido}: ${restante.toFixed(2)} ${ex.unidad_medida} ${ex.nombre} (sin lote)`, pedido.id]
        );
      }
      consumidos.push(`${ex.nombre} (extra): ${cantNec} ${ex.unidad_medida}`);
    }

    // Marcar reservas del pedido como consumidas (preserva auditoría +
    // mantiene visibilidad coherente del cálculo de stock disponible
    // hasta que la transacción haga COMMIT). Antes era DELETE.
    await client.query(`UPDATE reservas_stock SET estado = 'consumida' WHERE pedido_id = $1 AND estado = 'activa'`, [id]);
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
      // Copia de archivo INDEPENDIENTE: si email_copia_albaranes está
      // configurado, mandamos el albarán al archivo aunque el cliente no tenga
      // email o el toggle de auto-email esté desactivado. Idempotente
      // (albaran_copia_archivada_at evita reenvíos).
      pedidoAlbaranService.enviarCopiaArchivoSiProcede(req.params.id)
        .catch(err => logger.warn('[auto.albaran.copia-archivo]', { err: err instanceof Error ? err.message : err, pedido_id: req.params.id }));
    });

    // Auditoría · pedido consumido (stock descontado)
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CONSUMIR_PEDIDO', 'pedidos', $2, $3)`,
      [(req as any).user?.id ?? null, pedido.id,
       `${pedido.numero_pedido} · ${pedido.cliente_nombre ?? 'cliente'} · ${items.length} líneas consumidas (${consumidos.length} mov. de stock)`]
    ).catch(() => undefined);

    return res.json({ ok: true, consumidos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return next(err);
  } finally {
    client.release();
  }
});

// Helper interno: carga pedido + líneas + datos empresa para PDF mercantil
async function cargarDatosDoc(id: string): Promise<{ pedido: any; lineas: any[]; empresa: any } | null> {
  const { rows: [pedido] } = await pool.query(`
    SELECT pd.*, c.nombre AS cliente_nombre_rel, c.email AS cliente_email_rel,
           c.direccion AS cliente_direccion, c.nif AS cliente_nif, c.telefono AS cliente_telefono
    FROM pedidos pd LEFT JOIN clientes c ON c.id = pd.cliente_id
    WHERE pd.id = $1`, [id]);
  if (!pedido) return null;

  const { rows: lineas } = await pool.query(`
    SELECT lp.*, p.nombre AS producto_nombre_rel, p.codigo AS producto_codigo
    FROM lineas_pedido lp LEFT JOIN productos p ON p.id = lp.producto_id
    WHERE lp.pedido_id = $1 ORDER BY lp.created_at ASC`, [id]);

  // Si no hay líneas pero el pedido tiene producto único antiguo, sintetizar 1 línea
  if (lineas.length === 0 && pedido.producto_id) {
    lineas.push({
      producto_nombre_rel: null, producto_nombre: pedido.producto_nombre, producto_codigo: pedido.producto_codigo,
      cantidad: pedido.cantidad, unidad_medida: pedido.unidad_medida, precio_unitario: null, subtotal: null,
    });
  }

  const { rows: [cfg] } = await pool.query(`SELECT * FROM configuracion_global WHERE id = 1`);
  const empresa = {
    nombre: cfg?.empresa_nombre || 'Colas Loga S.L.',
    cif: cfg?.empresa_cif || '',
    direccion: cfg?.empresa_direccion || '',
    telefono: cfg?.empresa_telefono || '',
    web: cfg?.empresa_web || '',
    email: cfg?.email_remitente || '',
  };
  return { pedido, lineas, empresa };
}

// GET /api/pedidos/:id/albaran.pdf — Albarán de entrega minimalista (sin trazabilidad/fotos)
// Side-effect: si configuracion_global.email_copia_albaranes está definido y el
// pedido aún no ha sido archivado por email (campo albaran_copia_archivada_at),
// se dispara un envío silencioso al email de archivo. Idempotente: solo una vez
// por pedido. Cualquier sistema interno (token sistema) está excluido para
// evitar bucles cuando es el propio servidor el que pide el PDF para adjuntarlo.
router.get('/:id/albaran.pdf', async (req, res) => {
  try {
    const datos = await cargarDatosDoc(req.params.id);
    if (!datos) return res.status(404).json({ error: 'Pedido no encontrado' });

    const PDFDocument = require('pdfkit');
    const { renderDocumentoPDF } = require('../lib/pdfDocumento');

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="albaran-${datos.pedido.numero_pedido}.pdf"`);
    doc.pipe(res);

    renderDocumentoPDF(doc, 'albaran', {
      empresa: datos.empresa,
      pedido: datos.pedido,
      lineas: datos.lineas,
    });

    doc.end();

    // Disparar copia de archivo (fire-and-forget). El servicio internamente
    // comprueba si ya fue archivado y si hay email_copia_albaranes configurado.
    // No esperamos su finalización para no demorar la respuesta del PDF.
    const tokenInterno = (req as { user?: { sistema?: boolean } }).user?.sistema === true;
    if (!tokenInterno) {
      setImmediate(() => {
        pedidoAlbaranService.enviarCopiaArchivoSiProcede(req.params.id)
          .catch(err => logger.warn('[albaran.pdf.copia]', { err: err instanceof Error ? err.message : err, pedido_id: req.params.id }));
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/pedidos/:id/factura.pdf — Factura conforme RD 1619/2012, misma estética minimalista
router.get('/:id/factura.pdf', async (req, res) => {
  try {
    const datos = await cargarDatosDoc(req.params.id);
    if (!datos) return res.status(404).json({ error: 'Pedido no encontrado' });

    const PDFDocument = require('pdfkit');
    const { renderDocumentoPDF } = require('../lib/pdfDocumento');

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${datos.pedido.numero_pedido}.pdf"`);
    doc.pipe(res);

    renderDocumentoPDF(doc, 'factura', {
      empresa: datos.empresa,
      pedido: datos.pedido,
      lineas: datos.lineas,
    });

    doc.end();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/pedidos/:id/enviar-albaran — envia albaran PDF + trazabilidad + fotos + docs por email
router.post('/:id/enviar-albaran', adminOnly, async (req, res) => {
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

// ── Material de embalaje EXTRA por pedido ──────────────────────────────────
// No aparece en albarán ni factura. Solo se suma en /finanzas/informe-materiales.
// Caso típico: 2 palets para transporte, film, sacos extra. Editable por
// cualquier usuario (trabajador puede ajustar lo que carga al transportar).

router.get('/:id/embalajes-extra', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT pe.id, pe.producto_id, pe.cantidad, pe.notas, pe.created_at,
              p.codigo, p.nombre, p.material_embalaje, p.peso_material_vacio_kg, p.unidad_medida,
              p.stock_actual
         FROM pedido_embalajes_extra pe
         JOIN productos p ON p.id = pe.producto_id
        WHERE pe.pedido_id = $1
        ORDER BY pe.created_at`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/embalajes-extra', async (req, res, next) => {
  try {
    const { producto_id, cantidad, notas } = req.body ?? {};
    if (!producto_id || !Number.isFinite(Number(cantidad)) || Number(cantidad) <= 0) {
      return next(AppError.validacion('producto_id y cantidad>0 obligatorios', { campo: 'cantidad' }));
    }
    // El producto debe ser tipo material_embalaje (no PE/PF: para esos hay líneas).
    const { rows: [prod] } = await pool.query<{ tipo: string; activo: boolean }>(
      `SELECT tipo::text AS tipo, activo FROM productos WHERE id = $1`,
      [producto_id]
    );
    if (!prod || !prod.activo) return next(AppError.notFound('Producto', producto_id));
    if (prod.tipo !== 'material_embalaje') {
      return next(AppError.validacion('Solo material_embalaje puede ir como extra de pedido', { tipo: prod.tipo }));
    }
    // Verifica pedido existe (FK ya lo hace, pero error más limpio).
    const { rows: [ped] } = await pool.query(`SELECT id FROM pedidos WHERE id = $1`, [req.params.id]);
    if (!ped) return next(AppError.notFound('Pedido', req.params.id));

    const userId = (req as any).user?.id ?? null;
    const { rows: [extra] } = await pool.query(
      `INSERT INTO pedido_embalajes_extra (pedido_id, producto_id, cantidad, notas, creado_por)
       VALUES ($1, $2, $3::NUMERIC, $4, $5)
       RETURNING id, pedido_id, producto_id, cantidad, notas, created_at`,
      [req.params.id, producto_id, Number(cantidad).toFixed(6), notas ?? null, userId]
    );
    return res.status(201).json(extra);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/embalajes-extra/:extraId', async (req, res, next) => {
  try {
    const { rows: [del] } = await pool.query(
      `DELETE FROM pedido_embalajes_extra WHERE id = $1 AND pedido_id = $2 RETURNING id`,
      [req.params.extraId, req.params.id]
    );
    if (!del) return next(AppError.notFound('Extra', req.params.extraId));
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
