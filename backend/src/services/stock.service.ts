import { pool, acquireProductLocks } from '../db/pool';
import { toNum } from '../types';

class StockService {
  async listarProductos(filtros?: {
    tipo?: string;
    solo_bajos?: boolean;
    busqueda?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    let sql = `
      SELECT
        p.*,
        pv.nombre AS proveedor_nombre,
        pv.email  AS proveedor_email,
        ROUND(
          CASE WHEN p.stock_maximo > 0
            THEN (p.stock_actual / p.stock_maximo * 100)
            ELSE 0
          END, 2
        ) AS porcentaje_stock,
        (
          SELECT cg.porcentaje_alerta FROM configuracion_global cg WHERE cg.id = 1
        ) AS porcentaje_alerta,
        CASE WHEN p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo
        THEN TRUE ELSE FALSE END AS alerta_activa
      FROM productos p
      LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
      WHERE p.activo = TRUE
    `;
    const params: (string | boolean | number)[] = [];
    let idx = 1;

    if (filtros?.tipo) {
      sql += ` AND p.tipo = $${idx++}`;
      params.push(filtros.tipo);
    }
    if (filtros?.solo_bajos) {
      sql += ` AND (p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo)`;
    }
    if (filtros?.busqueda) {
      sql += ` AND (p.nombre ILIKE $${idx} OR p.codigo ILIKE $${idx})`;
      // Escapar % y _ para evitar wildcard injection / ReDoS via input usuario
      const safeBusqueda = filtros.busqueda.replace(/[\\%_]/g, m => '\\' + m);
      params.push(`%${safeBusqueda}%`);
      idx++;
    }

    // Paginación con cap defensivo (default 200, max 1000).
    const limit = Math.min(1000, Math.max(1, Number(filtros?.limit) || 200));
    const offset = Math.max(0, Number(filtros?.offset) || 0);
    sql += ` ORDER BY alerta_activa DESC, p.nombre ASC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await pool.query(sql, params);
    return rows;
  }

  async ajustarStock(payload: {
    producto_id: string;
    lote_id?: string;
    cantidad: number;  // positivo=entrada, negativo=salida
    motivo: string;
    referencia_externa?: string;
    usuario_id?: string;
  }): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      // Advisory lock por producto: serializa con /consumir, producción y automatizaciones.
      await acquireProductLocks(client, [payload.producto_id]);

      const { rows: [prod] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`,
        [payload.producto_id]
      );
      if (!prod) throw new Error('PRODUCTO_NO_ENCONTRADO');

      // Validar que el lote pertenece al producto antes de tocarlo (evita corrupción cruzada).
      if (payload.lote_id) {
        const { rows: [lote] } = await client.query<{ producto_id: string }>(
          `SELECT producto_id FROM lotes WHERE id = $1 FOR UPDATE`,
          [payload.lote_id]
        );
        if (!lote) throw new Error('LOTE_NO_ENCONTRADO');
        if (lote.producto_id !== payload.producto_id) throw new Error('LOTE_NO_PERTENECE_AL_PRODUCTO');
      }

      const antes   = toNum(prod.stock_actual);
      const despues = antes + payload.cantidad;

      if (despues < 0) throw new Error('STOCK_RESULTANTE_NEGATIVO');

      if (payload.lote_id) {
        // UPDATE lotes dispara trigger 025 (fn_trg_lotes_stock_actual) que
        // recalcula productos.stock_actual = SUM(lotes aprobados). No hace
        // falta UPDATE manual a productos.stock_actual aquí.
        await client.query(
          `UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual + $1::NUMERIC) WHERE id = $2`,
          [payload.cantidad.toFixed(6), payload.lote_id]
        );
      } else {
        // Caso defensivo: ajuste sin lote — actualizamos stock_actual
        // directamente. NO debería ocurrir en flujos normales (siempre debe
        // haber lote_id). Sólo aquí porque el trigger 025 no se dispara sin
        // cambio en lotes.
        await client.query(
          `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
          [despues.toFixed(6), payload.producto_id]
        );
      }

      const tipo = payload.cantidad >= 0 ? 'entrada' : 'salida';
      await client.query(
        `INSERT INTO stock_moves
           (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues,
            referencia_externa, usuario_id, motivo)
         VALUES ($1, $2, $3, $4::NUMERIC, $5::NUMERIC, $6::NUMERIC, $7, $8, $9)`,
        [
          payload.producto_id,
          payload.lote_id ?? null,
          tipo,
          payload.cantidad.toFixed(6),
          antes.toFixed(6),
          despues.toFixed(6),
          payload.referencia_externa ?? null,
          payload.usuario_id ?? null,
          payload.motivo,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async historialMovimientos(productoId: string, limit = 50): Promise<unknown[]> {
    const { rows } = await pool.query(
      `SELECT sm.*, l.lote_interno, p.nombre AS producto_nombre
       FROM stock_moves sm
       JOIN productos p ON p.id = sm.producto_id
       LEFT JOIN lotes l ON l.id = sm.lote_id
       WHERE sm.producto_id = $1
       ORDER BY sm.created_at DESC
       LIMIT $2`,
      [productoId, limit]
    );
    return rows;
  }
}

export const stockService = new StockService();
