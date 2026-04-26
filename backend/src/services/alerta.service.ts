import { pool } from '../db/pool';

class AlertaService {
  async listarNotificaciones(soloNoLeidas = true): Promise<unknown[]> {
    const { rows } = await pool.query(
      `SELECT n.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
              p.unidad_medida, p.stock_actual, p.stock_maximo,
              pv.email AS proveedor_email, pv.nombre AS proveedor_nombre
       FROM notificaciones n
       JOIN productos p ON p.id = n.producto_id
       LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
       ${soloNoLeidas ? 'WHERE n.leida = FALSE' : ''}
       ORDER BY n.created_at DESC
       LIMIT 100`
    );
    return rows;
  }

  async marcarLeida(notificacionId: string): Promise<void> {
    await pool.query(
      `UPDATE notificaciones SET leida = TRUE WHERE id = $1`,
      [notificacionId]
    );
  }

  async marcarTodasLeidas(): Promise<void> {
    await pool.query(`UPDATE notificaciones SET leida = TRUE WHERE leida = FALSE`);
  }

  async cantidadNoLeidas(): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notificaciones WHERE leida = FALSE`
    );
    return parseInt(rows[0].count, 10);
  }

  async checkCaducidades(): Promise<void> {
    try {
    // Find lots expiring in the next 30 days
    const { rows: lotesCaducando } = await pool.query(`
      SELECT l.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo
      FROM lotes l
      JOIN productos p ON p.id = l.producto_id
      WHERE l.estado = 'aprobado'
        AND l.cantidad_actual > 0
        AND l.fecha_caducidad IS NOT NULL
        AND l.fecha_caducidad <= CURRENT_DATE + INTERVAL '30 days'
        AND l.fecha_caducidad > CURRENT_DATE
      ORDER BY l.fecha_caducidad ASC
    `);

    for (const lote of lotesCaducando) {
      const dias = Math.ceil((new Date(lote.fecha_caducidad).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      await pool.query(`
        INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
        VALUES ('caducidad', $1, $2, $3)
        ON CONFLICT (producto_id, tipo) WHERE leida = FALSE DO UPDATE SET
          created_at = NOW(), mensaje = EXCLUDED.mensaje
      `, [
        'Caducidad proxima: ' + lote.producto_nombre,
        'Lote ' + lote.lote_interno + ' de ' + lote.producto_nombre + ' caduca en ' + dias + ' dias (' + new Date(lote.fecha_caducidad).toLocaleDateString('es-ES') + ')',
        lote.producto_id,
      ]);
    }
    } catch (err) {
      console.error('[alertaService] checkCaducidades failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Cantidad sugerida: stock_maximo - stock_actual (siempre positivo) */
  async calcularCantidadSugerida(productoId: string): Promise<number> {
    const { rows: [p] } = await pool.query<{ stock_actual: string; stock_maximo: string }>(
      `SELECT stock_actual, stock_maximo FROM productos WHERE id = $1`,
      [productoId]
    );
    if (!p) return 0;
    const sugerida = parseFloat(p.stock_maximo) - parseFloat(p.stock_actual);
    return Math.max(0, sugerida);
  }
}

export const alertaService = new AlertaService();
