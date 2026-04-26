import { pool } from '../db/pool';
import { toNum } from '../types';

class StockService {
  async listarProductos(filtros?: {
    tipo?: string;
    solo_bajos?: boolean;
    busqueda?: string;
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
    const params: (string | boolean)[] = [];
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
      params.push(`%${filtros.busqueda}%`);
      idx++;
    }

    sql += ` ORDER BY alerta_activa DESC, p.nombre ASC LIMIT 1000`;
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

      const { rows: [prod] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`,
        [payload.producto_id]
      );
      if (!prod) throw new Error('PRODUCTO_NO_ENCONTRADO');

      const antes   = toNum(prod.stock_actual);
      const despues = antes + payload.cantidad;

      if (despues < 0) throw new Error('STOCK_RESULTANTE_NEGATIVO');

      await client.query(
        `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
        [despues.toFixed(6), payload.producto_id]
      );

      if (payload.lote_id) {
        await client.query(
          `UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual + $1::NUMERIC) WHERE id = $2`,
          [payload.cantidad.toFixed(6), payload.lote_id]
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
