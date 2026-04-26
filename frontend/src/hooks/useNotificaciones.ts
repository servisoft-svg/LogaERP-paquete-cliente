import { useState, useEffect, useCallback } from 'react';
import { stockApi } from '../api/client';
import type { Notificacion } from '../types';

export function useNotificaciones() {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [count, setCount] = useState(0);

  const fetchNotificaciones = useCallback(async () => {
    try {
      const { data } = await stockApi.notificaciones(false);
      setNotificaciones(data);
      setCount((data as Notificacion[]).filter((n) => !n.leida).length);
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    fetchNotificaciones();
    const interval = setInterval(fetchNotificaciones, 30_000); // polling 30s
    return () => clearInterval(interval);
  }, [fetchNotificaciones]);

  return { notificaciones, count, refresh: fetchNotificaciones };
}
