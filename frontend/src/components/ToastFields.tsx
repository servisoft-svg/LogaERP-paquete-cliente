import type { ReactNode } from 'react';

/**
 * Componentes pequeños para construir descripciones ricas y consistentes en toasts.
 * Diseño: label gris pequeño arriba, valor en negrita abajo (más robusto con valores largos).
 */

interface ToastBlockProps {
  title?: ReactNode;
  children?: ReactNode;
}

export function ToastBlock({ title, children }: ToastBlockProps) {
  return (
    <div className="mt-1 space-y-1.5 text-[12px] leading-tight">
      {title && (
        <div className="font-semibold text-gray-900 truncate">{title}</div>
      )}
      {children && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

interface ToastFieldProps {
  label: ReactNode;
  value?: ReactNode;
  span?: 1 | 2; // ocupa 1 o 2 columnas
}

export function ToastField({ label, value, span = 1 }: ToastFieldProps) {
  if (value == null || value === '' || value === false) return null;
  return (
    <div className={span === 2 ? 'col-span-2' : 'col-span-1'}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</div>
      <div className="text-[12px] text-gray-800 font-medium truncate">{value}</div>
    </div>
  );
}

interface ToastListProps {
  title?: ReactNode;
  rows: { left: ReactNode; right: ReactNode }[];
  footer?: ReactNode;
  emptyMore?: number;
}

/**
 * Lista de filas (izquierda-derecha) — útil para líneas de pedido,
 * stocks bajos, ingredientes, etc.
 */
export function ToastList({ title, rows, footer, emptyMore }: ToastListProps) {
  return (
    <div className="mt-1 space-y-1 text-[12px] leading-tight">
      {title && (
        <div className="font-semibold text-gray-900 truncate">{title}</div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between items-baseline gap-3 tabular-nums">
          <span className="truncate text-gray-800">{r.left}</span>
          <span className="text-gray-600 font-medium whitespace-nowrap">{r.right}</span>
        </div>
      ))}
      {emptyMore != null && emptyMore > 0 && (
        <div className="text-[11px] text-gray-400 italic">+ {emptyMore} más…</div>
      )}
      {footer && (
        <div className="pt-1 mt-1 border-t border-gray-100 flex justify-between text-[12px] font-semibold tabular-nums">
          {footer}
        </div>
      )}
    </div>
  );
}
