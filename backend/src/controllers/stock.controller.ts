import { Request, Response } from 'express';
import { stockService }  from '../services/stock.service';
import { alertaService } from '../services/alerta.service';
import { automatizacionesService } from '../services/automatizaciones.service';
import { emailService }  from '../services/email.service';
import { pool }          from '../db/pool';
import { invalidarCacheFinanzas } from '../routes/finanzas.routes';

export const stockController = {
  async listarProductos(req: Request, res: Response) {
    try {
      const { tipo, solo_bajos, busqueda, limit, offset } = req.query;
      const productos = await stockService.listarProductos({
        tipo:       tipo ? String(tipo) : undefined,
        solo_bajos: solo_bajos === 'true',
        busqueda:   busqueda ? String(busqueda) : undefined,
        limit:      limit ? Number(limit) : undefined,
        offset:     offset ? Number(offset) : undefined,
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
      invalidarCacheFinanzas(); // ajuste cambia stock_actual → afecta inmovilizado
      setImmediate(() => {
        automatizacionesService.checkStockAndTrigger(producto_id).catch(err => console.error('[auto.ajuste]', err));
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
      const { producto_id, destinatario, cantidad_sugerida, notas_adicionales, cuerpo_personalizado,
              adjuntar_pdf, precio_unitario } = req.body;
      if (!producto_id || !destinatario) {
        return res.status(400).json({ error: 'producto_id y destinatario son obligatorios' });
      }
      await emailService.enviarPedidoStock({
        producto_id,
        destinatario,
        cantidad_sugerida: Number(cantidad_sugerida),
        notas_adicionales,
        cuerpo_personalizado,
        usuario_id: (req as any).user?.id,
        adjuntar_pdf: !!adjuntar_pdf,
        precio_unitario: precio_unitario != null && precio_unitario !== '' ? Number(precio_unitario) : null,
      });

      // Si adjuntar_pdf=true, el helper crearSolicitudYRenderPDF ya insertó el registro.
      // Sólo registramos aquí cuando NO se adjuntó PDF (modo simple).
      let pedidoId: string | null = null;
      if (!adjuntar_pdf) {
        const userId = (req as any).user?.id ?? null;
        const { rows: [prod] } = await pool.query(`SELECT proveedor_id FROM productos WHERE id = $1`, [producto_id]);
        const { rows: [registro] } = await pool.query(
          `INSERT INTO pedidos_proveedor
             (producto_id, proveedor_id, cantidad_solicitada, destinatario_email, notas, usuario_solicitud_id)
           VALUES ($1, $2, $3::NUMERIC, $4, $5, $6)
           RETURNING id`,
          [producto_id, prod?.proveedor_id ?? null, Number(cantidad_sugerida || 0).toFixed(6), destinatario, notas_adicionales ?? null, userId]
        );
        pedidoId = registro.id;
      }

      return res.json({ ok: true, mensaje: 'Email enviado correctamente', pedido_proveedor_id: pedidoId });
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
