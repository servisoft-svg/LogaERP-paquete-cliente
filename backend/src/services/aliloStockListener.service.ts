// Listener LISTEN/NOTIFY: escucha cambios en stock de productos compartidos
// con Alilo y dispara el webhook a Alilo. Cubre TODOS los caminos de cambio
// (compras, ajustes, fabricación, consumo Alilo, lotes…).

import { Client } from 'pg';
import { notifyAliloStock } from '../routes/integracionAlilo.routes';
import { logger } from '../lib/logger';
import { pool } from '../db/pool';

/**
 * Devuelve el precio FEFO del lote en uso para un producto (el próximo a
 * consumir). Si no hay lotes con precio, devuelve null.
 */
async function getFefoLotePrice(productoId: string): Promise<{ precio: number | null; lote: string | null }> {
  const { rows: [l] } = await pool.query<{ precio_compra: string | null; lote_interno: string }>(
    `SELECT precio_compra, lote_interno
     FROM lotes
     WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
     ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC
     LIMIT 1`,
    [productoId]
  );
  if (!l) return { precio: null, lote: null };
  return {
    precio: l.precio_compra != null ? parseFloat(l.precio_compra) : null,
    lote: l.lote_interno,
  };
}

interface StockChangePayload {
  producto_id: string;
  codigo: string;
  codigo_alilo: string | null;
  nombre: string;
  stock_actual: number | string;
  precio_unitario: number | string;
  unidad: string;
  old_stock: number | string;
  changed_at: number;
}
type NotifyArgs = Parameters<typeof notifyAliloStock>[0];

let listenerClient: Client | null = null;
let restartTimer: NodeJS.Timeout | null = null;

async function start(): Promise<void> {
  const url = process.env.DATABASE_URL || 'postgresql://localhost/loga_erp';
  const client = new Client({ connectionString: url });
  listenerClient = client;

  client.on('error', (err) => {
    logger.warn('[alilo.listener] error de conexión', { err: err.message });
    scheduleRestart();
  });

  client.on('end', () => {
    logger.warn('[alilo.listener] conexión cerrada');
    scheduleRestart();
  });

  client.on('notification', async (msg) => {
    if (msg.channel !== 'alilo_stock_change' || !msg.payload) return;
    try {
      const p: StockChangePayload = JSON.parse(msg.payload);
      const motivo = (() => {
        const oldS = parseFloat(String(p.old_stock));
        const newS = parseFloat(String(p.stock_actual));
        const delta = newS - oldS;
        if (delta > 0)      return `Stock subió ${delta.toFixed(2)} en Loga`;
        else if (delta < 0) return `Stock bajó ${Math.abs(delta).toFixed(2)} en Loga`;
        else                return 'Cambio en producto compartido';
      })();
      const fefo = await getFefoLotePrice(p.producto_id);
      await notifyAliloStock({
        codigo: p.codigo,
        codigo_alilo: p.codigo_alilo,
        nombre: p.nombre,
        stock_actual: parseFloat(String(p.stock_actual)),
        precio_unitario: parseFloat(String(p.precio_unitario)),
        unidad: p.unidad,
        motivo,
        precio_lote_actual: fefo.precio,
        lote_actual_interno: fefo.lote,
      } as NotifyArgs);
    } catch (e) {
      logger.warn('[alilo.listener] error procesando notify', {
        e: e instanceof Error ? e.message : String(e),
      });
    }
  });

  await client.connect();
  await client.query('LISTEN alilo_stock_change');
  logger.info('[alilo.listener] LISTEN alilo_stock_change activo');
}

function scheduleRestart(): void {
  if (restartTimer) return;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await listenerClient?.end().catch(() => {});
      await start();
    } catch (err) {
      logger.error('[alilo.listener] no se pudo reiniciar', {
        err: err instanceof Error ? err.message : String(err),
      });
      scheduleRestart();
    }
  }, 5000);
}

export async function startAliloStockListener(): Promise<void> {
  try {
    await start();
  } catch (err) {
    logger.error('[alilo.listener] fallo inicial', {
      err: err instanceof Error ? err.message : String(err),
    });
    scheduleRestart();
  }
}

export async function stopAliloStockListener(): Promise<void> {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  await listenerClient?.end().catch(() => {});
  listenerClient = null;
}
