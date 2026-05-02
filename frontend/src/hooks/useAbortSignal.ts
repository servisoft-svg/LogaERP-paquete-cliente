import { useEffect, useRef } from 'react';

/**
 * Hook que devuelve un AbortSignal que se aborta automáticamente cuando
 * el componente se desmonta. Pasa el signal a cualquier llamada axios
 * para cancelar el request si el usuario navega antes de la respuesta.
 *
 * Uso:
 *   const signal = useAbortSignal();
 *   useEffect(() => {
 *     productosApi.listar(undefined, { signal }).then(...);
 *   }, []);
 *
 * Beneficios:
 *   - Evita "Can't perform a React state update on unmounted component"
 *   - Libera conexión HTTP si la respuesta tarda y el usuario navega
 *   - Reduce requests zombie en navegación rápida entre páginas
 */
export function useAbortSignal(): AbortSignal {
  const ref = useRef<AbortController | null>(null);
  if (!ref.current) ref.current = new AbortController();

  useEffect(() => {
    const ctrl = ref.current;
    return () => {
      ctrl?.abort();
    };
  }, []);

  return ref.current.signal;
}
