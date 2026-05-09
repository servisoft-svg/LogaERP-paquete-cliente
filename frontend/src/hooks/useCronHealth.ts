/**
 * Hook que pollea /api/health/cron cada 60s. Si algún cron está caído
 * (ultima ejecución > umbral configurado), dispara un toast sileo.error
 * persistente para que el admin se entere antes de que el cliente queje.
 *
 * Una sola alerta por cron caído (dedup en memoria) — al recuperarse,
 * permite alertar de nuevo si vuelve a caer.
 */
import { useEffect, useRef } from 'react';
import { notify } from '../lib/notify';
import api from '../api/client';

interface CronEstado {
  nombre: string;
  ultimo_run: string;
  ultimo_status: 'ok' | 'error';
  ultimo_error: string | null;
  intervalo_ms: number;
  umbral_ms: number;
  edad_ms: number;
  caido: boolean;
}

const NOMBRE_LEGIBLE: Record<string, string> = {
  sweep_pedidos:           'Auto-completar pedidos',
  sweep_stock_reglas:      'Reglas de stock automático',
  backup_nocturno_tick:    'Backup nocturno',
  retry_email_proveedor:   'Reintento emails proveedor',
};

export function useCronHealth() {
  const yaAvisado = useRef<Set<string>>(new Set());
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        const { data } = await api.get<{ status: string; crons: CronEstado[] }>('/health/cron');
        if (!mounted) return;
        const crons = data.crons ?? [];

        for (const c of crons) {
          if (c.caido && !yaAvisado.current.has(c.nombre)) {
            yaAvisado.current.add(c.nombre);
            const minutos = Math.floor(c.edad_ms / 60_000);
            const titulo = `Sistema caído: ${NOMBRE_LEGIBLE[c.nombre] ?? c.nombre}`;
            const desc = c.ultimo_status === 'error'
              ? `Último error: ${c.ultimo_error ?? 'desconocido'}. Hace ${minutos} min sin ejecutar.`
              : `No ha ejecutado en ${minutos} min (umbral ${Math.floor(c.umbral_ms / 60_000)} min). Avisa al técnico.`;
            notify.error(titulo, { description: desc });
          } else if (!c.caido && yaAvisado.current.has(c.nombre)) {
            // Recuperado — limpia dedup para alertar otra vez si vuelve a caer.
            yaAvisado.current.delete(c.nombre);
          }
        }
      } catch {
        // Endpoint no disponible: backend caído entero. No spamear toasts:
        // el usuario ya ve errores en sus operaciones normales.
      }
    };

    // Primera ejecución 5s tras login para dejar que la app cargue.
    const initial = window.setTimeout(tick, 5_000);
    intervalRef.current = window.setInterval(tick, 60_000);

    return () => {
      mounted = false;
      window.clearTimeout(initial);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);
}
