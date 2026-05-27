import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { specsApi } from '../api/client';
import type { SpecCatalogo } from '../types';
import { notify } from '../lib/notify';

export default function CatalogoSpecs() {
  const [items, setItems] = useState<SpecCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', unidad: '', decimales: '2', rango_min: '', rango_max: '' });
  const [editando, setEditando] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', unidad: '', decimales: '2', rango_min: '', rango_max: '' });

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await specsApi.catalogo();
      setItems(data as SpecCatalogo[]);
    } finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  const handleCrear = async () => {
    if (!nuevo.nombre.trim()) return;
    try {
      await specsApi.catalogoCrear({
        nombre: nuevo.nombre.trim(),
        unidad: nuevo.unidad.trim() || null,
        decimales: nuevo.decimales ? Number(nuevo.decimales) : 2,
        rango_min: nuevo.rango_min !== '' ? Number(nuevo.rango_min) : null,
        rango_max: nuevo.rango_max !== '' ? Number(nuevo.rango_max) : null,
      });
      notify.success('Spec creada');
      setNuevo({ nombre: '', unidad: '', decimales: '2', rango_min: '', rango_max: '' });
      setCreando(false);
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al crear');
    }
  };

  const empezarEdit = (s: SpecCatalogo) => {
    setEditando(s.id);
    setEditForm({
      nombre: s.nombre,
      unidad: s.unidad ?? '',
      decimales: String(s.decimales),
      rango_min: s.rango_min != null ? String(s.rango_min) : '',
      rango_max: s.rango_max != null ? String(s.rango_max) : '',
    });
  };

  const handleGuardarEdit = async (id: number) => {
    try {
      await specsApi.catalogoEditar(id, {
        nombre: editForm.nombre.trim(),
        unidad: editForm.unidad.trim() || null,
        decimales: editForm.decimales ? Number(editForm.decimales) : 2,
        rango_min: editForm.rango_min !== '' ? Number(editForm.rango_min) : null,
        rango_max: editForm.rango_max !== '' ? Number(editForm.rango_max) : null,
      });
      notify.success('Spec actualizada');
      setEditando(null);
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar');
    }
  };

  const handleBorrar = async (s: SpecCatalogo) => {
    if (!confirm(`¿Desactivar la spec "${s.nombre}"? Los productos/lotes que la usen seguirán mostrándola, pero ya no podrá asignarse a nuevos productos.`)) return;
    try {
      await specsApi.catalogoBorrar(s.id);
      notify.success('Spec desactivada');
      cargar();
    } catch (e) {
      notify.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error');
    }
  };

  if (loading) return <p className="text-xs text-gray-400 px-5 py-4">Cargando…</p>;

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Define los parámetros físico-químicos que tus productos pueden requerir (pH, Sólidos, Acidez, Densidad…). Cada producto elige cuáles aplican.</p>
        {!creando && (
          <button
            onClick={() => setCreando(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-loga-red text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700"
          >
            <Plus size={13} /> Nueva spec
          </button>
        )}
      </div>

      {creando && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Nueva especificación</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="text-sm rounded-lg border border-gray-200 px-2 py-1.5" placeholder="Nombre (ej: Acidez)"
              value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <input className="text-sm rounded-lg border border-gray-200 px-2 py-1.5" placeholder="Unidad (ej: mg KOH/g, °C, %)"
              value={nuevo.unidad} onChange={(e) => setNuevo((n) => ({ ...n, unidad: e.target.value }))} />
            <input className="text-sm rounded-lg border border-gray-200 px-2 py-1.5" placeholder="Decimales"
              type="number" min="0" max="6" value={nuevo.decimales} onChange={(e) => setNuevo((n) => ({ ...n, decimales: e.target.value }))} />
            <div className="flex gap-2">
              <input className="text-sm rounded-lg border border-gray-200 px-2 py-1.5 flex-1" placeholder="Rango mín"
                type="number" value={nuevo.rango_min} onChange={(e) => setNuevo((n) => ({ ...n, rango_min: e.target.value }))} />
              <input className="text-sm rounded-lg border border-gray-200 px-2 py-1.5 flex-1" placeholder="Rango máx"
                type="number" value={nuevo.rango_max} onChange={(e) => setNuevo((n) => ({ ...n, rango_max: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setCreando(false); setNuevo({ nombre: '', unidad: '', decimales: '2', rango_min: '', rango_max: '' }); }}
              className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Cancelar</button>
            <button onClick={handleCrear} disabled={!nuevo.nombre.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-loga-red text-white font-semibold hover:bg-red-700 disabled:opacity-40">Crear</button>
          </div>
        </div>
      )}

      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Nombre</th>
            <th className="text-left px-3 py-2 font-medium">Unidad</th>
            <th className="text-right px-3 py-2 font-medium">Decimales</th>
            <th className="text-right px-3 py-2 font-medium">Rango</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Sin specs en el catálogo</td></tr>
          )}
          {items.map((s) => (
            <tr key={s.id} className="hover:bg-gray-50/50">
              {editando === s.id ? (
                <>
                  <td className="px-3 py-1.5"><input className="text-sm rounded border border-gray-200 px-2 py-1 w-full" value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} /></td>
                  <td className="px-3 py-1.5"><input className="text-sm rounded border border-gray-200 px-2 py-1 w-full" value={editForm.unidad} onChange={(e) => setEditForm((f) => ({ ...f, unidad: e.target.value }))} /></td>
                  <td className="px-3 py-1.5 text-right"><input className="text-sm rounded border border-gray-200 px-2 py-1 w-16 text-right" type="number" min="0" max="6" value={editForm.decimales} onChange={(e) => setEditForm((f) => ({ ...f, decimales: e.target.value }))} /></td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <input className="text-sm rounded border border-gray-200 px-2 py-1 w-20 text-right" type="number" placeholder="mín" value={editForm.rango_min} onChange={(e) => setEditForm((f) => ({ ...f, rango_min: e.target.value }))} />
                      <input className="text-sm rounded border border-gray-200 px-2 py-1 w-20 text-right" type="number" placeholder="máx" value={editForm.rango_max} onChange={(e) => setEditForm((f) => ({ ...f, rango_max: e.target.value }))} />
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => handleGuardarEdit(s.id)} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
                      <button onClick={() => setEditando(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={14} /></button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 font-medium text-gray-800">{s.nombre}</td>
                  <td className="px-3 py-2 text-gray-500">{s.unidad ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{s.decimales}</td>
                  <td className="px-3 py-2 text-right text-gray-500 tabular-nums">
                    {s.rango_min == null && s.rango_max == null ? '—' : `${s.rango_min ?? '?'} – ${s.rango_max ?? '?'}`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => empezarEdit(s)} className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600" title="Editar"><Pencil size={13} /></button>
                      <button onClick={() => handleBorrar(s)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red" title="Desactivar"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
