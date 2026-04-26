import { Request, Response } from 'express';
import { stockService }  from '../services/stock.service';
import { alertaService } from '../services/alerta.service';
import { emailService }  from '../services/email.service';
import { pool }          from '../db/pool';

export const stockController = {
  async listarProductos(req: Request, res: Response) {
    try {
      const { tipo, solo_bajos, busqueda } = req.query;
      const productos = await stockService.listarProductos({
        tipo:       tipo ? String(tipo) : undefined,
        solo_bajos: solo_bajos === 'true',
        busqueda:   busqueda ? String(busqueda) : undefined,
      });
      return res.json(productos);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  async ajustarStock(req: Request, res: Response) {
    try {
      const { producto_id, lote_id, cantidad, motivo, referencia_externa } = req.body;
      if (!producto_id || cantidad === undefined || !motivo) {
        return res.status(400).json({ error: 'producto_id, cantidad y motivo son obligatorios' });
      }
      await stockService.ajustarStock({
        producto_id,
        lote_id,
        cantidad: Number(cantidad),
        motivo,
        referencia_externa,
      });
      return res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      if (msg === 'STOCK_RESULTANTE_NEGATIVO') {
        return res.status(422).json({ error: 'El ajuste dejaría el stock en negativo' });
      }
      return res.status(500).json({ error: msg });
    }
  },

  async historial(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { limit } = req.query;
      const movimientos = await stockService.historialMovimientos(id, limit ? Number(limit) : 50);
      return res.json(movimientos);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  async notificaciones(req: Request, res: Response) {
    try {
      const soloNoLeidas = req.query.todas !== 'true';
      const notifs = await alertaService.listarNotificaciones(soloNoLeidas);
      return res.json(notifs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  async enviarPedido(req: Request, res: Response) {
    try {
      const { producto_id, destinatario, cantidad_sugerida, notas_adicionales, cuerpo_personalizado } = req.body;
      if (!producto_id || !destinatario) {
        return res.status(400).json({ error: 'producto_id y destinatario son obligatorios' });
      }
      await emailService.enviarPedidoStock({
        producto_id,
        destinatario,
        cantidad_sugerida: Number(cantidad_sugerida),
        notas_adicionales,
        cuerpo_personalizado,
      });

      // Register supplier order request for traceability
      const userId = (req as any).user?.id ?? null;
      const { rows: [prod] } = await pool.query(`SELECT proveedor_id FROM productos WHERE id = $1`, [producto_id]);
      const { rows: [registro] } = await pool.query(
        `INSERT INTO pedidos_proveedor
           (producto_id, proveedor_id, cantidad_solicitada, destinatario_email, notas, usuario_solicitud_id)
         VALUES ($1, $2, $3::NUMERIC, $4, $5, $6)
         RETURNING id`,
        [producto_id, prod?.proveedor_id ?? null, Number(cantidad_sugerida || 0).toFixed(6), destinatario, notas_adicionales ?? null, userId]
      );

      return res.json({ ok: true, mensaje: 'Email enviado correctamente', pedido_proveedor_id: registro.id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },

  async cantidadSugerida(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const cantidad = await alertaService.calcularCantidadSugerida(id);
      return res.json({ cantidad });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error interno';
      return res.status(500).json({ error: msg });
    }
  },
};
