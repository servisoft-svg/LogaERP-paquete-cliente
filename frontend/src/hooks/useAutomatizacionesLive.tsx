/**
 * Hook que polling cada 30s nuevas entradas de automatizaciones_log no leídas
 * y dispara un toast sileo por cada una. Después marca como leídas.
 *
 * Se monta una sola vez en App (dentro de AppContent) y vive durante toda la sesión.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { automatizacionesApi } from '../api/client';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';

interface NoLeida {
  id: string;
  tipo: string;
  resultado: string;
  detalle: { cantidad?: number; unidad?: string; numero_orden?: string; destinatario?: string; fecha_planificada?: string; motivo?: string };
  error_msg: string | null;
  created_at: string;
  orden_id: string | null;
  orden_compra_id: string | null;
  producto_codigo: string | null;
  producto_nombre: string | null;
  orden_numero: string | null;
}

const TIPO_TITULO: Record<string, string> = {
  orden_compra_creada: 'Orden de compra creada',
  email_proveedor_enviado: 'Email enviado al proveedor',
  orden_fabricacion_creada: 'Orden de fabricación creada',
  orden_envasado_creada: 'Orden de envasado creada',
  lote_aprobado_qc: 'Lote aprobado automáticamente',
  duplicado_evitado: 'Automatización omitida (duplicado)',
  error: 'Error en automatización',
};

export function useAutomatizacionesLive() {
  const navigate = useNavigate();
  const intervalRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      try {
        const { data } = await automatizacionesApi.noLeidas();
        const lista = data as NoLeida[];
        if (!mounted || lista.length === 0) return;

        const nuevasIds: string[] = [];
        for (const l of lista) {
          if (seenRef.current.has(l.id)) continue;
          seenRef.current.add(l.id);
          nuevasIds.push(l.id);

          // No mostrar toasts para omisiones (ruido innecesario:
          // cliente_fuera_filtro, albaran_ya_enviado, duplicado_evitado, etc.)
          if (l.resultado === 'omitido' || l.tipo === 'duplicado_evitado') continue;

          const titulo = TIPO_TITULO[l.tipo] ?? 'Automatización';
          const det = l.detalle ?? {};
          const isError = l.resultado === 'fallo_definitivo' || l.tipo === 'error';
          const isPendiente = l.resultado === 'pendiente_reintento';
          const isOmitido = l.resultado === 'omitido';

          const description = (
            <ToastBlock title={l.producto_nombre ?? l.producto_codigo ?? undefined}>
              {det.cantidad !== undefined && (
                <ToastField label="Cantidad" value={`${Number(det.cantidad).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${det.unidad ?? ''}`} />
              )}
              {det.numero_orden && <ToastField label="Orden" value={det.numero_orden} />}
              {det.destinatario && <ToastField label="Email" value={det.destinatario} />}
              {det.fecha_planificada && <ToastField label="Para" value={det.fecha_planificada} />}
              {l.error_msg && <ToastField label="Error" value={l.error_msg} span={2} />}
              {det.motivo && <ToastField label="Motivo" value={det.motivo} span={2} />}
            </ToastBlock>
          );

          const button = l.orden_id
            ? { title: 'Ver orden', onClick: () => navigate(`/produccion?orden_id=${l.orden_id}`) }
            : l.orden_compra_id
              ? { title: 'Ver compra', onClick: () => navigate('/automatizaciones?tab=log') }
              : { title: 'Ver historial', onClick: () => navigate('/automatizaciones?tab=log') };

          if (isError) notify.error(titulo, { description, button });
          else if (isPendiente) notify.warning(titulo, { description, button });
          else if (isOmitido) notify.info(titulo, { description });
          else notify.success(titulo, { description, button });
        }

        if (nuevasIds.length > 0) {
          await automatizacionesApi.marcarLeidas(nuevasIds).catch(() => {});
        }
      } catch { /* silencioso */ }
    };

    // Cargar IDs ya conocidas al inicio para no spamear toasts en mount
    automatizacionesApi.noLeidas()
      .then(({ data }) => {
        for (const l of data as NoLeida[]) seenRef.current.add(l.id);
      })
      .catch(() => {});

    // Pausar polling cuando la pestaña está oculta (Fix #22) — evita
    // requests inútiles + reduces dedup effort al volver. También evita
    // doble interval en StrictMode dev mode (cleanup limpia siempre).
    const startInterval = () => {
      if (intervalRef.current) return; // ya activo
      intervalRef.current = window.setInterval(tick, 30_000);
    };
    const stopInterval = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stopInterval();
      else { startInterval(); tick(); /* refresca al volver para sincronizar */ }
    };
    if (!document.hidden) startInterval();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [navigate]);
}
