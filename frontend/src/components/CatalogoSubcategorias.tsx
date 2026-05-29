import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, X, Check, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { notify } from '../lib/notify';

interface Sub { id: string; nombre: string; orden: number; activo: boolean }

type Color = 'purple' | 'amber' | 'blue' | 'emerald';

interface ApiShape {
  listar: () => Promise<{ data: Sub[] | unknown }>;
  crear: (data: { nombre: string; orden?: number }) => Promise<unknown>;
  editar: (id: string, data: { nombre?: string; orden?: number; activo?: boolean }) => Promise<unknown>;
  eliminar: (id: string) => Promise<unknown>;
}

interface Props {
  api: ApiShape;
  color?: Color;
  /** Texto explicativo arriba (ej. "Familias químicas usadas para clasificar..."). */
  descripcion?: string;
  /** Placeholder del input para añadir nueva. */
  placeholderNueva?: string;
  /** Mensaje al confirmar eliminar (usa {nombre} como placeholder). */
  mensajeEliminar?: string;
}

const COLOR_CLASSES: Record<Color, { ring: string; chip: string; chipText: string; btnNew: string; btnNewHover: string; bar: string }> = {
  purple:  { ring: 'focus:ring-purple-500/30',  chip: 'bg-purple-100/70',  chipText: 'text-purple-700',  btnNew: 'bg-purple-600',  btnNewHover: 'hover:bg-purple-700',  bar: 'from-purple-200/60' },
  amber:   { ring: 'focus:ring-amber-500/30',   chip: 'bg-amber-100/70',   chipText: 'text-amber-700',   btnNew: 'bg-amber-600',   btnNewHover: 'hover:bg-amber-700',   bar: 'from-amber-200/60' },
  blue:    { ring: 'focus:ring-blue-500/30',    chip: 'bg-blue-100/70',    chipText: 'text-blue-700',    btnNew: 'bg-blue-600',    btnNewHover: 'hover:bg-blue-700',    bar: 'from-blue-200/60' },
  emerald: { ring: 'focus:ring-emerald-500/30', chip: 'bg-emerald-100/70', chipText: 'text-emerald-700', btnNew: 'bg-emerald-600', btnNewHover: 'hover:bg-emerald-700', bar: 'from-emerald-200/60' },
};

export default function CatalogoSubcategorias({
  api,
  color = 'purple',
  descripcion,
  placeholderNueva = 'Nueva sub-categoría',
  mensajeEliminar = '¿Eliminar "{nombre}"? Los productos asignados la mantendrán como texto.',
}: Props) {
  const c = COLOR_CLASSES[color];
  const [items, setItems] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [saving, setSaving] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await api.listar();
      setItems((data as Sub[]) ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const crear = async () => {
    const n = nuevoNombre.trim();
    if (!n) return;
    setSaving(true);
    try {
      const maxOrden = items.reduce((m, s) => Math.max(m, s.orden), 0);
      await api.crear({ nombre: n, orden: maxOrden + 1 });
      notify.success('Sub-categoría creada');
      setNuevoNombre('');
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al crear');
    } finally { setSaving(false); }
  };

  const guardarEdit = async (id: string) => {
    const n = editNombre.trim();
    if (!n) return;
    try {
      await api.editar(id, { nombre: n });
      notify.success('Renombrada');
      setEditando(null);
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al renombrar');
    }
  };

  const mover = async (id: string, dir: -1 | 1) => {
    const idx = items.findIndex(s => s.id === id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const a = items[idx], b = items[swapIdx];
    try {
      await Promise.all([
        api.editar(a.id, { orden: b.orden }),
        api.editar(b.id, { orden: a.orden }),
      ]);
      cargar();
    } catch {
      notify.error('Error al reordenar');
    }
  };

  const eliminar = async (s: Sub) => {
    if (!confirm(mensajeEliminar.replace('{nombre}', s.nombre))) return;
    try {
      await api.eliminar(s.id);
      notify.success('Eliminada');
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al eliminar');
    }
  };

  return (
    <div className="px-5 py-5 space-y-4">
      {descripcion && (
        <p className="text-xs text-gray-500 leading-relaxed">{descripcion}</p>
      )}

      {/* Input añadir — destacado arriba */}
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 p-1.5 focus-within:border-gray-300 focus-within:bg-white transition-colors">
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') crear(); }}
          placeholder={placeholderNueva}
          maxLength={50}
          className={clsx(
            'flex-1 rounded-lg bg-transparent px-2.5 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none',
          )}
        />
        <button
          onClick={crear}
          disabled={!nuevoNombre.trim() || saving}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all',
            c.btnNew, c.btnNewHover,
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'shadow-sm hover:shadow active:scale-95',
          )}
        >
          <Plus size={13} /> Añadir
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <span className="h-5 w-5 border-2 border-gray-300 border-t-loga-red rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/30 py-8 text-center">
          <p className="text-xs text-gray-400 italic">Sin sub-categorías. Añade la primera arriba ↑</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          {items.map((s, idx) => {
            const isEdit = editando === s.id;
            return (
              <div
                key={s.id}
                className={clsx(
                  'group flex items-center gap-2 px-3 py-2 transition-colors',
                  idx !== items.length - 1 && 'border-b border-gray-50',
                  !isEdit && 'hover:bg-gray-50/60',
                )}
              >
                {/* Drag handle visual + reorder buttons */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <GripVertical size={13} className="text-gray-200 group-hover:text-gray-300" />
                  <div className="flex flex-col -space-y-0.5">
                    <button
                      onClick={() => mover(s.id, -1)}
                      disabled={idx === 0}
                      className="text-gray-300 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-300 transition-colors"
                      title="Subir"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={() => mover(s.id, 1)}
                      disabled={idx === items.length - 1}
                      className="text-gray-300 hover:text-gray-700 disabled:opacity-20 disabled:hover:text-gray-300 transition-colors"
                      title="Bajar"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                </div>

                {/* Order badge */}
                <span className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums',
                  c.chip, c.chipText,
                )}>
                  {idx + 1}
                </span>

                {/* Name / edit input */}
                {isEdit ? (
                  <input
                    autoFocus
                    value={editNombre}
                    onChange={(e) => setEditNombre(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') guardarEdit(s.id);
                      if (e.key === 'Escape') setEditando(null);
                    }}
                    className={clsx(
                      'flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2',
                      c.ring,
                    )}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditando(s.id); setEditNombre(s.nombre); }}
                    className="flex-1 text-left text-sm font-medium text-gray-800 hover:text-gray-950 transition-colors truncate"
                    title="Clic para renombrar"
                  >
                    {s.nombre}
                  </button>
                )}

                {/* Actions */}
                {isEdit ? (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => guardarEdit(s.id)}
                      className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 transition-colors"
                      title="Guardar"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditando(null)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"
                      title="Cancelar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditando(s.id); setEditNombre(s.nombre); }}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      title="Renombrar"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => eliminar(s)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pie con contador */}
      {!loading && items.length > 0 && (
        <p className="text-[10px] text-gray-400 text-right tabular-nums">
          {items.length} sub-categoría{items.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
