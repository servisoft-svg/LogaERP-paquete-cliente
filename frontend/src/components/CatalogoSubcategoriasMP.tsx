import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, X, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { configuracionApi } from '../api/client';
import { notify } from '../lib/notify';

interface Sub { id: string; nombre: string; orden: number; activo: boolean }

export default function CatalogoSubcategoriasMP() {
  const [items, setItems] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await configuracionApi.listarSubcategoriasMP();
      setItems(data as Sub[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  const crear = async () => {
    const n = nuevoNombre.trim();
    if (!n) return;
    try {
      const maxOrden = items.reduce((m, s) => Math.max(m, s.orden), 0);
      await configuracionApi.crearSubcategoriaMP({ nombre: n, orden: maxOrden + 1 });
      notify.success('Sub-categoría creada');
      setNuevoNombre('');
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al crear');
    }
  };

  const guardarEdit = async (id: string) => {
    const n = editNombre.trim();
    if (!n) return;
    try {
      await configuracionApi.editarSubcategoriaMP(id, { nombre: n });
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
        configuracionApi.editarSubcategoriaMP(a.id, { orden: b.orden }),
        configuracionApi.editarSubcategoriaMP(b.id, { orden: a.orden }),
      ]);
      cargar();
    } catch {
      notify.error('Error al reordenar');
    }
  };

  const eliminar = async (s: Sub) => {
    if (!confirm(`¿Eliminar "${s.nombre}"? Los productos con esta sub-categoría asignada la mantendrán como texto.`)) return;
    try {
      await configuracionApi.eliminarSubcategoriaMP(s.id);
      notify.success('Eliminada');
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al eliminar');
    }
  };

  return (
    <div className="px-5 py-5 space-y-3">
      <p className="text-xs text-gray-500">
        Familias químicas usadas para clasificar materias primas (ej. Resina, Agua, Pigmento).
        Renombrar aquí también renombra el valor en todos los productos que la tengan asignada.
      </p>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Sin sub-categorías. Añade la primera.</p>
      ) : (
        <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 bg-white overflow-hidden">
          {items.map((s, idx) => {
            const isEdit = editando === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col">
                  <button
                    onClick={() => mover(s.id, -1)}
                    disabled={idx === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20"
                    title="Subir"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => mover(s.id, 1)}
                    disabled={idx === items.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-20"
                    title="Bajar"
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>
                {isEdit ? (
                  <input
                    autoFocus
                    value={editNombre}
                    onChange={(e) => setEditNombre(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') guardarEdit(s.id);
                      if (e.key === 'Escape') setEditando(null);
                    }}
                    className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-loga-red/40"
                  />
                ) : (
                  <span className="flex-1 text-sm text-gray-800">{s.nombre}</span>
                )}
                {isEdit ? (
                  <>
                    <button
                      onClick={() => guardarEdit(s.id)}
                      className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                      title="Guardar"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditando(null)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100"
                      title="Cancelar"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditando(s.id); setEditNombre(s.nombre); }}
                      className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                      title="Renombrar"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => eliminar(s)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-loga-red"
                      title="Eliminar"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') crear(); }}
          placeholder="Nueva sub-categoría (ej. Tensioactivo)"
          maxLength={50}
          className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-loga-red/40"
        />
        <button
          onClick={crear}
          disabled={!nuevoNombre.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-loga-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-loga-red-dark disabled:opacity-40"
        >
          <Plus size={13} /> Añadir
        </button>
      </div>
    </div>
  );
}
