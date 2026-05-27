/**
 * useAlertas
 * ----------
 * Polling 30s contra /recordatorios/pendientes. Cuando una alerta vence:
 *  · Reproduce sonido (si con_sonido).
 *  · Dispara Notification del navegador (si con_notificacion y permiso concedido).
 *  · Devuelve la cola para que un modal global la muestre.
 *
 * Una vez el usuario la marca vista → POST /marcar-entregado.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { recordatoriosApi } from '../api/client';

export interface AlertaPendiente {
  id: string;
  titulo: string;
  descripcion?: string | null;
  programado_para: string;
  color?: string | null;
  con_sonido: boolean;
  con_notificacion: boolean;
  origen?: string;
}

const POLL_MS = 30_000;

export function useAlertas(enabled: boolean) {
  const [cola, setCola] = useState<AlertaPendiente[]>([]);
  const yaVistasRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Pide permiso Notification al primer render
  useEffect(() => {
    if (!enabled) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [enabled]);

  // Reproduce un beep procedural via WebAudio (2 tonos cortos)
  const beep = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      [880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.25);
        gain.gain.linearRampToValueAtTime(0.3, now + i * 0.25 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.25);
        osc.stop(now + i * 0.25 + 0.25);
      });
    } catch { /* autoplay bloqueado o navegador antiguo */ }
  }, []);

  const tick = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await recordatoriosApi.pendientes();
      const nuevas: AlertaPendiente[] = [];
      for (const a of data as AlertaPendiente[]) {
        if (yaVistasRef.current.has(a.id)) continue;
        yaVistasRef.current.add(a.id);
        nuevas.push(a);
        // Notification del SO
        if (a.con_notificacion && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const n = new Notification(a.titulo, {
              body: a.descripcion ?? '',
              icon: '/favicon.ico',
              tag: a.id,
              requireInteraction: true,
            });
            n.onclick = () => { window.focus(); n.close(); };
          } catch { /* ignore */ }
        }
        // Sonido procedural
        if (a.con_sonido) beep();
      }
      if (nuevas.length > 0) setCola((prev) => [...prev, ...nuevas]);
    } catch { /* silent */ }
  }, [enabled, beep]);

  useEffect(() => {
    if (!enabled) return;
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => clearInterval(iv);
  }, [enabled, tick]);

  const marcarVista = useCallback(async (id: string) => {
    setCola((prev) => prev.filter((a) => a.id !== id));
    try { await recordatoriosApi.marcarEntregado(id); } catch { /* silent */ }
  }, []);

  return { cola, marcarVista, refrescar: tick };
}
