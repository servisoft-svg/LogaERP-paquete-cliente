import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import clsx from 'clsx';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export interface SearchSelectOption {
  id: string;
  label: string;
  sub?: string;
  right?: string;
  group?: string;
}

interface Props {
  options: SearchSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  selectedLabel?: string;
  selectedSub?: string;
  selectedRight?: string;
  className?: string;
  disabled?: boolean;
}

export default function SearchSelect({
  options, value, onChange, placeholder = 'Buscar...',
  selectedLabel, selectedSub, selectedRight,
  className, disabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // Position dropdown relative to input
  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (open) {
      updatePos();
      window.addEventListener('scroll', updatePos, true);
      window.addEventListener('resize', updatePos);
      return () => {
        window.removeEventListener('scroll', updatePos, true);
        window.removeEventListener('resize', updatePos);
      };
    }
  }, [open, updatePos]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o => {
    if (!query) return true;
    const q = norm(query);
    return norm(o.label).includes(q) || (o.sub && norm(o.sub).includes(q));
  });

  const groups = new Map<string, SearchSelectOption[]>();
  for (const o of filtered) {
    const g = o.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }

  if (value && selectedLabel) {
    return (
      <div className={clsx('flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2', className)}>
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900 block truncate">{selectedLabel}</span>
          {selectedSub && <span className="text-[10px] text-gray-400 block truncate">{selectedSub}</span>}
        </div>
        {selectedRight && <span className="text-xs text-emerald-600 font-mono shrink-0">{selectedRight}</span>}
        {!disabled && <button onClick={() => onChange('')} className="text-gray-400 hover:text-red-500"><X size={12} /></button>}
      </div>
    );
  }

  const dropdown = open && filtered.length > 0 && createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-2xl max-h-64 overflow-y-auto"
    >
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          {group && <p className="px-3 py-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 sticky top-0">{group}</p>}
          {items.map(o => (
            <button key={o.id} onClick={() => { onChange(o.id); setQuery(''); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center gap-2 border-b border-gray-50">
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-gray-800 block truncate">{o.label}</span>
                {o.sub && <span className="text-[10px] text-gray-400 block truncate">{o.sub}</span>}
              </div>
              {o.right && <span className="font-mono text-gray-500 text-[10px] shrink-0">{o.right}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body
  );

  const noResults = open && filtered.length === 0 && query && createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-2xl p-3"
    >
      <p className="text-xs text-gray-400 text-center">Sin resultados</p>
    </div>,
    document.body
  );

  return (
    <div ref={wrapRef} className={clsx('relative', className)}>
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); updatePos(); }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2.5 text-xs focus:border-emerald-400 outline-none"
      />
      {dropdown}
      {noResults}
    </div>
  );
}
