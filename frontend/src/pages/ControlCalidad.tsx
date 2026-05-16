import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Droplets, Wrench, Plus, Trash2, X, Check } from 'lucide-react';
import clsx from 'clsx';
import { controlesCalidadApi, productosApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../lib/notify';

type Tipo = 'analitico' | 'limpieza' | 'mantenimiento';

interface Producto { id: string; codigo: string; nombre: string; tipo: string }
interface Registro {
  id: string;
  tipo: Tipo;
  fecha: string;
  lote_codigo?: string | null;
  metodo?: string | null;
  producto_id?: string | null;
  producto_nombre?: string | null;
  producto_codigo?: string | null;
  ph_spec?: string | null;
  ph_valor?: string | number | null;
  solidos_spec?: string | null;
  solidos_valor?: string | number | null;
  viscosidad_spec?: string | null;
  viscosidad_valor?: string | number | null;
  deposito_equipo?: string | null;
  accion?: string | null;
  resultado?: string | null;
  observaciones?: string | null;
  firmado_por_nombre?: string | null;
  firmado_at?: string | null;
  created_at?: string;
}

const TABS: { key: Tipo; label: string; icon: typeof FlaskConical; color: string }[] = [
  { key: 'analitico',     label: 'Analítico MP', icon: FlaskConical, color: 'violet' },
  { key: 'limpieza',      label: 'Limpieza',     icon: Droplets,     color: 'blue' },
  { key: 'mantenimiento', label: 'Mantenimiento', icon: Wrench,      color: 'amber' },
];

const RESULTADOS: Record<Tipo, { value: string; label: string; color: string }[]> = {
  analitico: [
    { value: 'apto',    label: 'APTO',    color: 'emerald' },
    { value: 'no_apto', label: 'NO APTO', color: 'red' },
    { value: 'revisar', label: 'REVISAR', color: 'amber' },
  ],
  limpieza: [
    { value: 'correcto', label: 'CORRECTO', color: 'emerald' },
    { value: 'revisar',  label: 'REVISAR',  color: 'amber' },
    { value: 'no_apto',  label: 'NO APTO',  color: 'red' },
  ],
  mantenimiento: [
    { value: 'correcto',  label: 'OK',        color: 'emerald' },
    { value: 'pendiente', label: 'PENDIENTE', color: 'amber' },
    { value: 'no_apto',   label: 'INCIDENCIA', color: 'red' },
  ],
};

export default function ControlCalidad() {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tipo>('analitico');
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        controlesCalidadApi.listar(tab),
        productosApi.listar({ tipo: 'materia_prima' }),
      ]);
      setRegistros(r1.data as Registro[]);
      setProductos(r2.data as Producto[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setForm({
      tipo: tab,
      fecha: new Date().toISOString().slice(0, 10),
      resultado: tab === 'analitico' ? 'apto' : 'correcto',
    });
    setModalOpen(true);
  };

  const guardar = async () => {
    try {
      await controlesCalidadApi.crear({ ...form, tipo: tab });
      notify.success('Registro guardado', { description: `Firmado por ${user?.nombre ?? 'operario'}` });
      setModalOpen(false);
      cargar();
    } catch (e: any) {
      notify.error('Error al guardar', { description: e?.response?.data?.error ?? 'desconocido' });
    }
  };

  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      await controlesCalidadApi.eliminar(id);
      cargar();
    } catch (e: any) {
      notify.error('Error al eliminar', { description: e?.response?.data?.error ?? 'desconocido' });
    }
  };

  const tabInfo = TABS.find(t => t.key === tab)!;
  const Icon = tabInfo.icon;

  // Auto-rellenar specs cuando se selecciona producto en analitico
  useEffect(() => {
    if (tab !== 'analitico' || !form.producto_id) return;
    const p = productos.find(x => x.id === form.producto_id) as any;
    if (!p) return;
    setForm((f: any) => ({
      ...f,
      producto_nombre: p.nombre,
      ph_spec:        (p.ph_min != null && p.ph_max != null) ? `${p.ph_min}-${p.ph_max}` : f.ph_spec,
      solidos_spec:   (p.solidos_min != null && p.solidos_max != null) ? `${p.solidos_min}-${p.solidos_max}` : f.solidos_spec,
      viscosidad_spec:(p.viscosidad_min != null && p.viscosidad_max != null) ? `${p.viscosidad_min}-${p.viscosidad_max}` : f.viscosidad_spec,
    }));
  }, [form.producto_id, tab, productos]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheckIcon /> Control de Calidad
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro firmado de analíticos, limpieza y mantenimiento</p>
        </div>
        <button
          onClick={abrirNuevo}
          className="inline-flex items-center gap-1.5 rounded-lg bg-loga-red px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
        >
          <Plus size={14} /> Nuevo registro
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const TI = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.key
                  ? `border-${t.color}-500 text-${t.color}-700`
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <TI size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Cargando...</div>
        ) : registros.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Icon size={32} className="mx-auto mb-2 text-gray-200" />
            Sin registros de {tabInfo.label.toLowerCase()}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold">Fecha</th>
                  {tab === 'analitico' ? (
                    <>
                      <th className="text-left px-3 py-2.5 font-semibold">Lote</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Producto</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Método</th>
                      <th className="text-right px-3 py-2.5 font-semibold">pH</th>
                      <th className="text-right px-3 py-2.5 font-semibold">%Sól.</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Visc.</th>
                    </>
                  ) : (
                    <>
                      <th className="text-left px-3 py-2.5 font-semibold">Depósito / Equipo</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Acción</th>
                    </>
                  )}
                  <th className="text-center px-3 py-2.5 font-semibold">Resultado</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Firma</th>
                  {isAdmin && <th className="px-3 py-2.5"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {registros.map(r => {
                  const resInfo = RESULTADOS[tab].find(x => x.value === r.resultado);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {new Date(r.fecha).toLocaleDateString('es-ES')}
                      </td>
                      {tab === 'analitico' ? (
                        <>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.lote_codigo ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-800 font-semibold">
                            {r.producto_codigo && <span className="text-gray-400 font-normal text-xs mr-1">{r.producto_codigo}</span>}
                            {r.producto_nombre ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{r.metodo ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.ph_valor != null && <><span className="font-semibold text-gray-800">{r.ph_valor}</span><span className="text-xs text-gray-400 ml-1">{r.ph_spec ?? ''}</span></>}
                            {r.ph_valor == null && '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.solidos_valor != null && <><span className="font-semibold text-gray-800">{r.solidos_valor}</span><span className="text-xs text-gray-400 ml-1">{r.solidos_spec ?? ''}</span></>}
                            {r.solidos_valor == null && '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.viscosidad_valor != null && <><span className="font-semibold text-gray-800">{r.viscosidad_valor}</span><span className="text-xs text-gray-400 ml-1">{r.viscosidad_spec ?? ''}</span></>}
                            {r.viscosidad_valor == null && '—'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-gray-800 font-semibold">{r.deposito_equipo ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.accion ?? r.observaciones ?? '—'}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-center">
                        {resInfo && (
                          <span className={clsx(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold',
                            resInfo.color === 'emerald' && 'bg-emerald-100 text-emerald-700',
                            resInfo.color === 'red' && 'bg-red-100 text-loga-red',
                            resInfo.color === 'amber' && 'bg-amber-100 text-amber-700',
                          )}>
                            {resInfo.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.firmado_por_nombre ? (
                          <div>
                            <p className="font-semibold text-gray-700 flex items-center gap-1"><Check size={11} className="text-emerald-600" /> {r.firmado_por_nombre}</p>
                            {r.firmado_at && <p className="text-gray-400">{new Date(r.firmado_at).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</p>}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => eliminar(r.id)} className="text-gray-400 hover:text-loga-red p-1">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal nuevo registro */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h2 className="text-lg font-bold text-gray-900">Nuevo registro — {tabInfo.label}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fecha</span>
                  <input type="date" value={form.fecha ?? ''} onChange={e => setForm({ ...form, fecha: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Resultado</span>
                  <select value={form.resultado ?? ''} onChange={e => setForm({ ...form, resultado: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    {RESULTADOS[tab].map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
              </div>

              {tab === 'analitico' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Lote (código)</span>
                      <input value={form.lote_codigo ?? ''} onChange={e => setForm({ ...form, lote_codigo: e.target.value })}
                        placeholder="Ej: 260114"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Método</span>
                      <input value={form.metodo ?? ''} onChange={e => setForm({ ...form, metodo: e.target.value })}
                        placeholder="Ej: CB-2001"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Producto</span>
                    <select value={form.producto_id ?? ''} onChange={e => setForm({ ...form, producto_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <option value="">— Selecciona materia prima —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">pH (spec)</span>
                      <input value={form.ph_spec ?? ''} onChange={e => setForm({ ...form, ph_spec: e.target.value })}
                        placeholder="4.5-5.5" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">% Sólidos (spec)</span>
                      <input value={form.solidos_spec ?? ''} onChange={e => setForm({ ...form, solidos_spec: e.target.value })}
                        placeholder="41±1" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Viscosidad (spec)</span>
                      <input value={form.viscosidad_spec ?? ''} onChange={e => setForm({ ...form, viscosidad_spec: e.target.value })}
                        placeholder="300-360" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">pH (valor)</span>
                      <input type="number" step="0.01" value={form.ph_valor ?? ''} onChange={e => setForm({ ...form, ph_valor: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">% Sólidos (valor)</span>
                      <input type="number" step="0.01" value={form.solidos_valor ?? ''} onChange={e => setForm({ ...form, solidos_valor: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Viscosidad (valor)</span>
                      <input type="number" step="0.01" value={form.viscosidad_valor ?? ''} onChange={e => setForm({ ...form, viscosidad_valor: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {tab === 'limpieza' ? 'Depósito / Tanque' : 'Equipo'}
                    </span>
                    <input value={form.deposito_equipo ?? ''} onChange={e => setForm({ ...form, deposito_equipo: e.target.value })}
                      placeholder={tab === 'limpieza' ? 'Ej: Reactor 1, Bidón 50L...' : 'Ej: Bomba P-101, Filtro F-3...'}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Acción realizada</span>
                    <textarea value={form.accion ?? ''} onChange={e => setForm({ ...form, accion: e.target.value })}
                      rows={3}
                      placeholder={tab === 'limpieza' ? 'Ej: Limpieza con agua + sosa al 5%, enjuague final' : 'Ej: Cambio aceite, revisión rodamientos, ajuste presión...'}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </label>
                </>
              )}

              <label className="block">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Observaciones</span>
                <textarea value={form.observaciones ?? ''} onChange={e => setForm({ ...form, observaciones: e.target.value })}
                  rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>

              <div className="rounded-lg bg-blue-50/40 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                Este registro quedará firmado por <strong>{user?.nombre ?? 'operario'}</strong> ({user?.email ?? ''}) con la fecha y hora actuales.
              </div>
            </div>
            <div className="flex gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setModalOpen(false)} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={guardar} className="flex-1 rounded-lg bg-loga-red py-2 text-sm font-semibold text-white hover:bg-red-700">
                Firmar y guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClipboardCheckIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-loga-red">
      <rect width={8} height={4} x={8} y={2} rx={1} ry={1} />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}
