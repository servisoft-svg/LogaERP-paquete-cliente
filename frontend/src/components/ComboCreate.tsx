/**
 * ComboCreate — combobox tipo SearchSelect con CTA "+ Crear" inline.
 * Si el texto tecleado no coincide con ningún producto, ofrece crearlo.
 */
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Plus, Check } from 'lucide-react';
import clsx from 'clsx';

export interface ComboOption {
  id: string;
  label: string;
  sub?: string;
  right?: string;
}

interface Props {
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  selectedLabel?: string;
  selectedSub?: string;
  selectedRight?: string;
  /** Si se define, muestra "+ Crear …" cuando el texto tecleado no existe. */
  onCreate?: (nombre: string) => Promise<{ id: string; label: string; sub?: string; right?: string }>;
  createLabel?: string;
  disabled?: boolean;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function ComboCreate({
  options, value, onChange, placeholder = 'Buscar o crear...',
  selectedLabel, selectedSub, selectedRight,
  onCreate, createLabel = 'Crear', disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Posición del panel desplegable (portal · position: fixed).
  // Se recalcula al abrir y en scroll/resize para mantenerse anclado al input.
  const [rect, setRect] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Calcula la posición del panel al input ancla. Si no cabe abajo, abre arriba.
  useLayoutEffect(() => {
    if (!open) { setRect(null); return; }
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const MAX_H = 288; // ~max-h-72
      const room = window.innerHeight - r.bottom;
      const openUp = room < MAX_H && r.top > MAX_H;
      setRect({
        top: openUp ? r.top - 4 : r.bottom + 4,
        left: r.left,
        width: r.width,
        openUp,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const filtered = query.trim()
    ? options.filter(o => norm(o.label).includes(norm(query)) || norm(o.sub ?? '').includes(norm(query))).slice(0, 30)
    : options.slice(0, 30);

  const hayCoincidenciaExacta = options.some(o => norm(o.label) === norm(query.trim()));
  const puedeCrear = !!onCreate && query.trim().length >= 2 && !hayCoincidenciaExacta;

  const handleCreate = async () => {
    if (!onCreate || !query.trim()) return;
    setCreating(true);
    try {
      const nuevo = await onCreate(query.trim());
      onChange(nuevo.id);
      setQuery('');
      setOpen(false);
    } finally { setCreating(false); }
  };

  return (
    <div className="relative" ref={ref}>
      {value && selectedLabel && !open ? (
        <button type="button" onClick={() => { if (!disabled) { setOpen(true); setQuery(''); } }}
          disabled={disabled}
          className={clsx('w-full text-left rounded-md border bg-white px-2.5 py-1.5 flex items-center gap-2 transition-colors',
            disabled ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-emerald-300 hover:border-emerald-400')}>
          <Check size={12} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-gray-900 truncate">{selectedLabel}</p>
            {selectedSub && <p className="text-[9px] text-gray-500 truncate">{selectedSub}</p>}
          </div>
          {selectedRight && <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{selectedRight}</span>}
          <button onClick={e => { e.stopPropagation(); onChange(''); }}
            className="text-gray-400 hover:text-gray-700 p-0.5 rounded shrink-0">
            <X size={11} />
          </button>
        </button>
      ) : (
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 py-1.5 text-[11px] outline-none focus:border-emerald-400 disabled:opacity-50"
          />
        </div>
      )}

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: rect.openUp ? undefined : rect.top,
            bottom: rect.openUp ? window.innerHeight - rect.top : undefined,
            left: rect.left,
            width: rect.width,
            zIndex: 9999,
          }}
          className="max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-2xl"
        >
          {puedeCrear && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={handleCreate} disabled={creating}
              className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11px] text-left border-b border-gray-100 bg-emerald-50/50 hover:bg-emerald-50 disabled:opacity-50">
              <div className="rounded p-0.5 bg-emerald-600 text-white"><Plus size={10} /></div>
              <span className="text-gray-700">
                {createLabel} <span className="font-bold text-emerald-700">"{query.trim()}"</span>
              </span>
              {creating && <span className="ml-auto text-[10px] text-emerald-600">creando…</span>}
            </button>
          )}
          {filtered.length === 0 && !puedeCrear && (
            <p className="px-2.5 py-3 text-[11px] text-gray-400 italic text-center">Sin resultados</p>
          )}
          {filtered.map(o => (
            <button key={o.id} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(o.id); setOpen(false); setQuery(''); }}
              className={clsx('w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-gray-50 border-b border-gray-50 last:border-b-0',
                value === o.id && 'bg-emerald-50/40')}>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-gray-900 truncate">{o.label}</p>
                {o.sub && <p className="text-[9px] text-gray-500 truncate">{o.sub}</p>}
              </div>
              {o.right && <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{o.right}</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
