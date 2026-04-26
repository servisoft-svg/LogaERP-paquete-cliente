import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  pagina: number;
  totalPaginas: number;
  onChange: (p: number) => void;
  totalItems?: number;
  porPagina?: number;
}

export default function Paginacion({ pagina, totalPaginas, onChange, totalItems, porPagina }: Props) {
  if (totalPaginas <= 1) return null;

  const desde = ((pagina - 1) * (porPagina ?? 0)) + 1;
  const hasta = Math.min(pagina * (porPagina ?? 0), totalItems ?? 0);

  return (
    <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-4">
      <div className="text-[11px] text-gray-400">
        {totalItems != null && porPagina != null && (
          <span>{desde}-{hasta} de <b className="text-gray-600">{totalItems}</b></span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, pagina - 1))}
          disabled={pagina <= 1}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>

        {/* Páginas */}
        {Array.from({ length: Math.min(totalPaginas, 7) }, (_, i) => {
          let p: number;
          if (totalPaginas <= 7) {
            p = i + 1;
          } else if (pagina <= 4) {
            p = i + 1;
          } else if (pagina >= totalPaginas - 3) {
            p = totalPaginas - 6 + i;
          } else {
            p = pagina - 3 + i;
          }
          return (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={clsx(
                'rounded-lg w-7 h-7 text-xs font-semibold transition-all',
                pagina === p
                  ? 'bg-loga-red text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {p}
            </button>
          );
        })}

        <button
          onClick={() => onChange(Math.min(totalPaginas, pagina + 1))}
          disabled={pagina >= totalPaginas}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={14} />
        </button>

        {/* Input directo */}
        <div className="flex items-center gap-1 ml-2 border-l border-gray-100 pl-2">
          <span className="text-[10px] text-gray-400">Ir a</span>
          <input
            type="number"
            min={1}
            max={totalPaginas}
            className="w-12 rounded-md border border-gray-200 px-1.5 py-1 text-xs text-center focus:border-loga-red outline-none"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (v >= 1 && v <= totalPaginas) onChange(v);
                (e.target as HTMLInputElement).value = '';
              }
            }}
            placeholder={String(pagina)}
          />
          <span className="text-[10px] text-gray-300">/ {totalPaginas}</span>
        </div>
      </div>
    </div>
  );
}
