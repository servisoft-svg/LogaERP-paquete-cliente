import { stockApi } from '../api/client';
import { notify } from './notify';

type Notif = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo: string;
  unidad_medida: string;
  stock_actual: string;
  mensaje?: string;
  leida?: boolean;
  created_at?: string;
};

let lastShownAt = 0;

/**
 * Comprueba notificaciones no leídas tras una mutación crítica
 * (fabricación, envasado, consumo pedido) y muestra toast warning
 * con la lista de materias primas bajo stock.
 *
 * Throttled a 1 toast cada 8s para no spamear.
 */
export async function checkStockBajo(): Promise<void> {
  const now = Date.now();
  if (now - lastShownAt < 8000) return;

  try {
    const { data } = await stockApi.notificaciones(false);
    const notifs = (data as Notif[]).filter((n) => n.leida === false);
    if (notifs.length === 0) return;

    lastShownAt = now;
    const top = notifs.slice(0, 6);

    notify.warning(
      notifs.length === 1
        ? 'Stock bajo en 1 producto'
        : `Stock bajo en ${notifs.length} productos`,
      {
        description: (
          <div className="text-xs space-y-1 mt-1">
            {top.map((n) => (
              <div key={n.id} className="flex justify-between items-baseline gap-3 tabular-nums">
                <span className="truncate font-semibold text-gray-800">
                  {n.producto_nombre}
                  <span className="ml-1 font-mono text-[10px] font-normal text-gray-400">{n.producto_codigo}</span>
                </span>
                <span className="text-amber-600 font-semibold whitespace-nowrap">
                  {parseFloat(n.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 1 })} {n.unidad_medida}
                </span>
              </div>
            ))}
            {notifs.length > top.length && (
              <div className="text-gray-400 pt-0.5">+ {notifs.length - top.length} más…</div>
            )}
          </div>
        ),
        expand: true,
        duration: 7000,
        button: {
          title: 'Ver',
          onClick: () => { window.location.href = '/productos?filtro=bajo_stock'; },
        },
      }
    );
  } catch { /* silencioso */ }
}
