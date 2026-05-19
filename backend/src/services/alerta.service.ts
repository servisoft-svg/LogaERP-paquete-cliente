import { pool } from '../db/pool';

class AlertaService {
  async listarNotificaciones(soloNoLeidas = true): Promise<unknown[]> {
    // DISTINCT ON producto_id: una sola notif por producto (la más reciente).
    // Solo notifica productos que SIGUEN bajo mínimo (stock_actual < stock_minimo).
    // Filtra notifs obsoletas (producto repuesto pero notif aún sin leer).
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (n.producto_id)
              n.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
              p.unidad_medida, p.stock_actual, p.stock_maximo, p.stock_minimo,
              pv.email AS proveedor_email, pv.nombre AS proveedor_nombre
       FROM notificaciones n
       JOIN productos p ON p.id = n.producto_id AND p.activo = TRUE
       LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
       WHERE 1=1
         ${soloNoLeidas ? 'AND n.leida = FALSE' : ''}
         AND p.stock_minimo > 0
         AND p.stock_actual < p.stock_minimo
       ORDER BY n.producto_id, n.created_at DESC
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

  /**
   * Marca leídas las notifs de stock bajo cuyo producto YA está repuesto.
   * Limpia ruido sin perder histórico. Llamar tras mutaciones de stock.
   */
  async limpiarObsoletas(): Promise<void> {
    await pool.query(`
      UPDATE notificaciones n SET leida = TRUE
      FROM productos p
      WHERE n.producto_id = p.id
        AND n.leida = FALSE
        AND n.tipo IN ('stock_bajo', 'sin_stock')
        AND (p.stock_minimo = 0 OR p.stock_actual >= p.stock_minimo)
    `);
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

    if (lotesCaducando.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const lote of lotesCaducando) {
        const dias = Math.ceil((new Date(lote.fecha_caducidad).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        values.push(`('caducidad', $${idx}, $${idx+1}, $${idx+2})`);
        params.push(
          'Caducidad proxima: ' + lote.producto_nombre,
          'Lote ' + lote.lote_interno + ' de ' + lote.producto_nombre + ' caduca en ' + dias + ' dias (' + new Date(lote.fecha_caducidad).toLocaleDateString('es-ES') + ')',
          lote.producto_id,
        );
        idx += 3;
      }
      await pool.query(`
        INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `, params);
    }
    } catch (err) {
      console.error('[alertaService] checkCaducidades failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Push-based: check stock mínimo for specific product IDs.
   * Called automatically after fabricación/envasado/consumo.
   */
  async checkStockMinimo(productoIds?: string[]): Promise<void> {
    try {
      const where = productoIds && productoIds.length > 0
        ? `AND p.id = ANY($1)`
        : '';
      const params = productoIds && productoIds.length > 0 ? [productoIds] : [];

      const { rows } = await pool.query(`
        SELECT p.id, p.nombre, p.codigo, p.stock_actual, p.stock_minimo, p.stock_maximo
        FROM productos p
        WHERE p.activo = true
          AND p.stock_minimo > 0
          AND p.stock_actual <= p.stock_minimo
          ${where}
      `, params);

      // Aunque no haya productos bajo mínimo ahora, limpia notifs obsoletas
      if (rows.length === 0) {
        await this.limpiarObsoletas();
        return;
      }

      const values: string[] = [];
      const insertParams: unknown[] = [];
      let idx = 1;
      for (const p of rows) {
        const tipo = parseFloat(p.stock_actual) <= 0 ? 'sin_stock' : 'stock_bajo';
        values.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
        insertParams.push(
          tipo,
          `Stock bajo: ${p.nombre}`,
          `${p.nombre} (${p.codigo}): stock actual ${parseFloat(p.stock_actual).toFixed(1)} por debajo del mínimo ${parseFloat(p.stock_minimo).toFixed(1)}`,
          p.id,
        );
        idx += 4;
      }

      await pool.query(`
        INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `, insertParams);

      // Limpia notifs obsoletas (productos ya repuestos) en el mismo paso
      await this.limpiarObsoletas();
    } catch (err) {
      // Non-blocking: don't let alert failures break the main operation
      console.error('[alertaService] checkStockMinimo failed:', err instanceof Error ? err.message : err);
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
