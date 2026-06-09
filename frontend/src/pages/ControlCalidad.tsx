import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Droplets, Wrench, Plus, Trash2, X, Check } from 'lucide-react';
import clsx from 'clsx';
import { controlesCalidadApi, productosApi, lotesApi, specsApi } from '../api/client';
import type { ProductoSpec } from '../types';
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
  estado?: 'pendiente' | 'completado' | null;
  confirmado_por_nombre?: string | null;
  confirmado_at?: string | null;
  valores?: { nombre: string; valor: string; unidad?: string | null }[];
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
    { value: 'correcto',  label: 'CORRECTO',  color: 'emerald' },
    { value: 'pendiente', label: 'PENDIENTE', color: 'amber' },
    { value: 'revisar',   label: 'REVISAR',   color: 'amber' },
    { value: 'no_apto',   label: 'NO APTO',   color: 'red' },
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
  const [busquedaMp, setBusquedaMp] = useState('');
  const [productoSpecs, setProductoSpecs] = useState<ProductoSpec[]>([]);
  const [specsValores, setSpecsValores] = useState<Record<number, string>>({});
  const [lotesProducto, setLotesProducto] = useState<{ id: string; lote_interno: string; fecha_entrada?: string; cantidad_actual: string }[]>([]);
  // Lotes de productos fabricados/envasados recientes (para limpieza: registrar qué se fabricó)
  const [lotesFabricados, setLotesFabricados] = useState<{ id: string; lote_interno: string; producto_id: string; producto_nombre: string; producto_codigo: string; fecha_entrada?: string }[]>([]);
  const [lotesEstado, setLotesEstado] = useState<{
    producto_id: string; producto_codigo: string; producto_nombre: string; stock_actual: string; unidad_medida: string;
    lotes: { lote_id: string; lote_interno: string; lote_proveedor?: string; fecha_entrada?: string; cantidad_actual: string; control_id?: string | null }[];
  }[]>([]);
  const [expandedProducto, setExpandedProducto] = useState<string | null>(null);
  const [expandedLote, setExpandedLote] = useState<string | null>(null);
  const [valoresLote, setValoresLote] = useState<Record<string, { nombre: string; valor: string; unidad?: string | null }[]>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    // Cargas independientes
    try {
      const r = await controlesCalidadApi.listar(tab);
      console.log('[ControlCalidad] listar', tab, '→', (r.data as any[])?.length, 'registros', r.data);
      setRegistros(r.data as Registro[]);
    } catch (e) {
      console.error('[ControlCalidad] listar FALLÓ', tab, e);
      setRegistros([]);
    }
    try { const r = await controlesCalidadApi.lotesEstado(); setLotesEstado(r.data as typeof lotesEstado); } catch { setLotesEstado([]); }
    try {
      const r = await productosApi.listar({ tipo: 'materia_prima' });
      // Analítico MP solo aplica a emulsiones (acepta "Emulsion" sin tilde).
      const emulsionSolo = (r.data as Producto[]).filter(p =>
        /emulsi[oó]n/i.test((p as any).subcategoria_mp ?? '')
      );
      setProductos(emulsionSolo);
    } catch { setProductos([]); }
    setLoading(false);
  }, [tab]);

  // Si productos.listar falló, derivamos la lista MP desde lotesEstado
  // (mismo dato, query distinta — robusto frente a errores del endpoint principal).
  const productosMpEfectivos = productos.length > 0
    ? productos
    : (lotesEstado.map((mp) => ({
        id: mp.producto_id,
        codigo: mp.producto_codigo,
        nombre: mp.producto_nombre,
        unidad_medida: mp.unidad_medida,
      })) as unknown as Producto[]);

  useEffect(() => { cargar(); }, [cargar]);

  // Lotes fabricados/envasados recientes para autorrellenar registro de limpieza
  useEffect(() => {
    if (tab !== 'limpieza') return;
    let cancelado = false;
    lotesApi.listar({ estado: 'aprobado' })
      .then(res => {
        if (cancelado) return;
        const lotes = (res.data as Array<{ id: string; lote_interno: string; producto_id: string; producto_nombre: string; producto_codigo: string; producto_tipo: string; fecha_entrada?: string }>)
          .filter(l => l.producto_tipo === 'producto_fabricado' || l.producto_tipo === 'producto_envasado')
          .sort((a, b) => new Date(b.fecha_entrada ?? 0).getTime() - new Date(a.fecha_entrada ?? 0).getTime())
          .slice(0, 30)
          .map(l => ({ id: l.id, lote_interno: l.lote_interno, producto_id: l.producto_id, producto_nombre: l.producto_nombre, producto_codigo: l.producto_codigo, fecha_entrada: l.fecha_entrada }));
        setLotesFabricados(lotes);
      })
      .catch(() => { if (!cancelado) setLotesFabricados([]); });
    return () => { cancelado = true; };
  }, [tab]);

  const abrirNuevo = (preset?: { producto_id: string; producto_nombre: string; lote_codigo: string }) => {
    setForm({
      tipo: tab,
      fecha: new Date().toISOString().slice(0, 10),
      resultado: tab === 'analitico' ? 'apto' : 'correcto',
      ...preset,
    });
    setModalOpen(true);
  };

  const guardar = async () => {
    try {
      // Estado se deriva del resultado seleccionado en el selector superior.
      // resultado === 'pendiente' → estado pendiente (deja huella firmada del que lo
      // creó; luego al confirmar quien lo realice añade su firma).
      const estado: 'pendiente' | 'completado' = form.resultado === 'pendiente' ? 'pendiente' : 'completado';
      // Mapea specs custom a campos legacy ph_valor/solidos_valor/viscosidad_valor + JSON con todo
      const payload: any = { ...form, tipo: tab, estado };
      if (tab === 'analitico' && productoSpecs.length > 0) {
        const specsLista: { spec_id: number; nombre: string; valor: string; unidad?: string | null }[] = [];
        for (const s of productoSpecs) {
          const v = specsValores[s.spec_id];
          if (v == null || v === '') continue;
          specsLista.push({ spec_id: s.spec_id, nombre: s.nombre, valor: v, unidad: s.unidad });
          // Compatibilidad: si la spec coincide con las legacy, popular esos campos también
          if (s.nombre === 'pH')         payload.ph_valor = v;
          if (s.nombre === 'Sólidos')    payload.solidos_valor = v;
          if (s.nombre === 'Viscosidad') payload.viscosidad_valor = v;
        }
        payload.specs_valores = specsLista;
      }
      await controlesCalidadApi.crear(payload);
      // Resumen del registro recién creado en el toast
      const partes: string[] = [];
      if (form.producto_nombre) partes.push(form.producto_nombre);
      if (form.lote_codigo)     partes.push(`Lote ${form.lote_codigo}`);
      if (form.deposito_equipo) partes.push(form.deposito_equipo);
      if (form.resultado)       partes.push(`Resultado: ${form.resultado}`);
      const valores: string[] = [];
      if (form.ph_valor)         valores.push(`pH ${form.ph_valor}`);
      if (form.solidos_valor)    valores.push(`Sól ${form.solidos_valor}%`);
      if (form.viscosidad_valor) valores.push(`Visc ${form.viscosidad_valor}`);
      if (valores.length > 0)    partes.push(valores.join(' · '));
      notify.success('Registro guardado', {
        description: `${partes.join(' — ')} (firmado por ${user?.nombre ?? 'operario'})`,
      });
      setModalOpen(false);
      cargar();
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.error ?? e?.message ?? 'desconocido';
      notify.error('Error al guardar', { description: `${status ? `[${status}] ` : ''}${msg}` });
      // También log a consola para diagnóstico
      console.error('[ControlCalidad guardar]', { status, data: e?.response?.data, raw: e });
    }
  };

  const confirmarPendiente = async (id: string) => {
    if (!confirm('¿Marcar este control como realizado?')) return;
    try {
      await controlesCalidadApi.confirmar(id);
      notify.success('Confirmado', { description: `Realizado por ${user?.nombre ?? 'operario'}` });
      cargar();
    } catch (e: any) {
      notify.error('Error al confirmar', { description: e?.response?.data?.error ?? 'desconocido' });
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

  // Auto-rellenar specs cuando se selecciona producto en analitico + cargar sus lotes + specs custom
  useEffect(() => {
    if (tab !== 'analitico' || !form.producto_id) {
      setLotesProducto([]); setProductoSpecs([]); setSpecsValores({});
      return;
    }
    const p = productosMpEfectivos.find(x => x.id === form.producto_id) as any;
    if (!p) return;
    setForm((f: any) => ({ ...f, producto_nombre: p.nombre }));
    // Carga lotes aprobados
    lotesApi.listar({ producto_id: form.producto_id, estado: 'aprobado' })
      .then(res => setLotesProducto((res.data as any[]).map(l => ({
        id: l.id, lote_interno: l.lote_interno, fecha_entrada: l.fecha_entrada, cantidad_actual: l.cantidad_actual,
      }))))
      .catch(() => setLotesProducto([]));
    // Carga specs custom del producto (pH, sólidos, viscosidad, acidez, densidad, lo que sea)
    specsApi.productoSpecs(form.producto_id)
      .then(res => {
        setProductoSpecs((res.data ?? []) as ProductoSpec[]);
        setSpecsValores({});
      })
      .catch(() => setProductoSpecs([]));
  }, [form.producto_id, tab, productosMpEfectivos]);

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
          onClick={() => abrirNuevo()}
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

      {/* Panel jerárquico MP → lotes (solo analitico). Verde = lote con QC, Rojo = sin QC. */}
      {tab === 'analitico' && !loading && lotesEstado.length > 0 && (() => {
        // Búsqueda accent-insensitive y case-insensitive
        const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const q = norm(busquedaMp.trim());
        const filtrados = q
          ? lotesEstado.filter(mp =>
              norm(mp.producto_nombre).includes(q) ||
              norm(mp.producto_codigo).includes(q) ||
              (mp.lotes ?? []).some(l => norm(l.lote_interno).includes(q) || norm(l.lote_proveedor ?? '').includes(q))
            )
          : lotesEstado;
        return (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/60 text-[11px] font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-3 flex-wrap">
            <span>Materias primas ({filtrados.length})</span>
            <input
              value={busquedaMp}
              onChange={(e) => setBusquedaMp(e.target.value)}
              placeholder="Buscar nombre, código o lote…"
              className="flex-1 min-w-[200px] rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-normal normal-case tracking-normal focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
            />
            <span className="flex items-center gap-1 text-emerald-600"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> con QC</span>
            <span className="flex items-center gap-1 text-loga-red"><span className="inline-block w-2 h-2 rounded-full bg-loga-red" /> sin QC</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {filtrados.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-gray-400 italic">Sin coincidencias</div>
            )}
            {filtrados.map((mp) => {
              const expandido = expandedProducto === mp.producto_id;
              const lotesArr = mp.lotes ?? [];
              const conQc = lotesArr.filter(l => !!l.control_id).length;
              const sinQc = lotesArr.length - conQc;
              return (
                <div key={mp.producto_id}>
                  <button
                    onClick={() => setExpandedProducto(expandido ? null : mp.producto_id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                  >
                    <span className={clsx('inline-block w-1.5 h-6 rounded-full', sinQc > 0 ? 'bg-loga-red' : conQc > 0 ? 'bg-emerald-500' : 'bg-gray-200')} />
                    <span className="font-mono text-xs text-gray-500 w-16 shrink-0">{mp.producto_codigo}</span>
                    <span className="font-medium text-sm text-gray-800 flex-1 truncate">{mp.producto_nombre}</span>
                    <span className="text-xs text-gray-400">{lotesArr.length} lote{lotesArr.length === 1 ? '' : 's'}</span>
                    {sinQc > 0 && <span className="text-[10px] font-bold uppercase tracking-wide bg-red-50 text-loga-red px-1.5 py-0.5 rounded">{sinQc} sin QC</span>}
                    {conQc > 0 && sinQc === 0 && <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Todos OK</span>}
                  </button>
                  {expandido && lotesArr.length > 0 && (
                    <div className="px-4 py-2 bg-gray-50/40 space-y-1">
                      {lotesArr.map(l => {
                        const tieneQc = !!l.control_id;
                        const valoresExp = expandedLote === l.lote_id ? (valoresLote[l.control_id ?? ''] ?? []) : null;
                        return (
                          <div key={l.lote_id}>
                            <button
                              onClick={async () => {
                                if (tieneQc && l.control_id) {
                                  // Toggle expand + carga valores si aún no
                                  if (expandedLote === l.lote_id) {
                                    setExpandedLote(null);
                                  } else {
                                    setExpandedLote(l.lote_id);
                                    if (!valoresLote[l.control_id]) {
                                      try {
                                        const { data } = await controlesCalidadApi.listar('analitico');
                                        // Buscar el registro y leer su 'valores'
                                        const reg = (data as Registro[]).find(r => r.id === l.control_id);
                                        if (reg?.valores) {
                                          setValoresLote(prev => ({ ...prev, [l.control_id!]: reg.valores! }));
                                        } else {
                                          // Fallback: pide vía endpoint específico
                                          const res = await fetch(`/api/controles-calidad/${l.control_id}/valores`, {
                                            headers: { Authorization: `Bearer ${localStorage.getItem('loga_token') ?? sessionStorage.getItem('loga_token') ?? ''}` },
                                          });
                                          const vals = await res.json();
                                          setValoresLote(prev => ({ ...prev, [l.control_id!]: vals }));
                                        }
                                      } catch { /* silent */ }
                                    }
                                  }
                                } else {
                                  abrirNuevo({ producto_id: mp.producto_id, producto_nombre: mp.producto_nombre, lote_codigo: l.lote_interno });
                                }
                              }}
                              className={clsx(
                                'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs transition-colors',
                                tieneQc
                                  ? 'bg-emerald-50/60 hover:bg-emerald-50 text-emerald-800'
                                  : 'bg-red-50/60 hover:bg-red-50 text-loga-red'
                              )}
                            >
                              <span className={clsx('inline-block w-2 h-2 rounded-full shrink-0', tieneQc ? 'bg-emerald-500' : 'bg-loga-red')} />
                              <span className="font-mono font-semibold">{l.lote_interno}</span>
                              <span className="text-gray-500">{l.lote_proveedor ?? '—'}</span>
                              <span className="text-gray-400 ml-auto">
                                {l.fecha_entrada ? new Date(l.fecha_entrada).toLocaleDateString('es-ES') : '—'}
                              </span>
                              <span className="text-gray-500 tabular-nums">
                                {parseFloat(l.cantidad_actual).toLocaleString('es-ES', { maximumFractionDigits: 1 })} {mp.unidad_medida}
                              </span>
                              <span className="text-[10px] font-bold uppercase">{tieneQc ? '✓ ver QC' : '+ Añadir QC'}</span>
                            </button>
                            {valoresExp && (
                              <div className="px-3 py-2 ml-5 bg-white rounded-lg border border-emerald-100">
                                {valoresExp.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 italic">Sin valores medidos</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {valoresExp.map((v, i) => (
                                      <span key={i} className="inline-flex items-baseline gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-xs">
                                        <span className="text-gray-500">{v.nombre}</span>
                                        <span className="font-bold text-emerald-700 tabular-nums">{parseFloat(v.valor).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</span>
                                        {v.unidad && <span className="text-[10px] text-gray-400">{v.unidad}</span>}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); abrirNuevo({ producto_id: mp.producto_id, producto_nombre: mp.producto_nombre, lote_codigo: l.lote_interno }); }}
                                  className="mt-2 text-[10px] text-emerald-700 font-semibold hover:underline"
                                >
                                  + Añadir nuevo control para este lote
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {expandido && lotesArr.length === 0 && (
                    <div className="px-4 py-2 bg-gray-50/40 text-xs text-gray-400 italic">Sin lotes con stock</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

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
                      <th className="text-left px-3 py-2.5 font-semibold">Valores medidos</th>
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
                          <td className="px-3 py-2">
                            {(() => {
                              // Construye lista de valores: prioriza tabla nueva (specs custom),
                              // si vacía, cae a campos legacy ph/sólidos/viscosidad.
                              const lista: { nombre: string; valor: string; unidad?: string | null }[] = [];
                              if (r.valores && r.valores.length > 0) lista.push(...r.valores);
                              else {
                                if (r.ph_valor != null)         lista.push({ nombre: 'pH',         valor: String(r.ph_valor) });
                                if (r.solidos_valor != null)    lista.push({ nombre: 'Sólidos',    valor: String(r.solidos_valor), unidad: '%' });
                                if (r.viscosidad_valor != null) lista.push({ nombre: 'Viscosidad', valor: String(r.viscosidad_valor), unidad: 'cP' });
                              }
                              if (lista.length === 0) return <span className="text-gray-300">—</span>;
                              return (
                                <div className="flex flex-wrap gap-1.5">
                                  {lista.map((v, i) => (
                                    <span key={i} className="inline-flex items-baseline gap-1 rounded-full bg-gray-50 border border-gray-100 px-2 py-0.5 text-xs">
                                      <span className="text-gray-500">{v.nombre}</span>
                                      <span className="font-bold text-gray-800 tabular-nums">{parseFloat(v.valor).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</span>
                                      {v.unidad && <span className="text-[10px] text-gray-400">{v.unidad}</span>}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-gray-800 font-semibold">
                            {r.deposito_equipo ?? '—'}
                            {r.tipo === 'limpieza' && (r.producto_nombre || r.lote_codigo) && (
                              <div className="mt-0.5 inline-flex flex-wrap gap-1">
                                {r.producto_nombre && (
                                  <span className="text-[10px] font-medium rounded bg-blue-50 text-blue-700 px-1.5 py-0.5 border border-blue-100">
                                    {r.producto_codigo ? `${r.producto_codigo} · ` : ''}{r.producto_nombre}
                                  </span>
                                )}
                                {r.lote_codigo && (
                                  <span className="text-[10px] font-mono rounded bg-gray-100 text-gray-700 px-1.5 py-0.5 border border-gray-200">
                                    Lote {r.lote_codigo}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
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
                        <div className="rounded-lg bg-gray-50/80 border border-gray-100 px-2 py-1.5 space-y-0.5">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Responsable</p>
                          {r.firmado_por_nombre ? (
                            <>
                              <p className="font-semibold text-gray-800 flex items-center gap-1">
                                <Check size={11} className="text-emerald-600" /> {r.firmado_por_nombre}
                              </p>
                              <p className="text-[10px] text-gray-500 italic">Firmado · {r.firmado_at ? new Date(r.firmado_at).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}</p>
                            </>
                          ) : <span className="text-gray-300">—</span>}
                          {r.estado === 'pendiente' && (
                            <p className="mt-1 inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">⏱ Pendiente</p>
                          )}
                          {r.confirmado_por_nombre && (
                            <p className="mt-1 text-[10px] text-emerald-700">
                              <span className="font-semibold">Confirmado por</span> {r.confirmado_por_nombre}
                              {r.confirmado_at && <> · {new Date(r.confirmado_at).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</>}
                            </p>
                          )}
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {r.estado === 'pendiente' && (
                              <button onClick={() => confirmarPendiente(r.id)} className="text-emerald-600 hover:bg-emerald-50 rounded p-1" title="Confirmar realizado">
                                <Check size={14} />
                              </button>
                            )}
                            <button onClick={() => eliminar(r.id)} className="text-gray-400 hover:text-loga-red p-1">
                              <Trash2 size={14} />
                            </button>
                          </div>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
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
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Producto (materia prima)</span>
                    <select value={form.producto_id ?? ''} onChange={e => setForm({ ...form, producto_id: e.target.value, lote_codigo: '' })}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <option value="">— Selecciona materia prima —</option>
                      {productosMpEfectivos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Lote</span>
                      <select
                        value={form.lote_codigo ?? ''}
                        onChange={e => setForm({ ...form, lote_codigo: e.target.value })}
                        disabled={!form.producto_id}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">{form.producto_id ? '— Selecciona lote —' : 'Elige producto primero'}</option>
                        {lotesProducto.map(l => (
                          <option key={l.id} value={l.lote_interno}>
                            {l.lote_interno} · {l.fecha_entrada ? new Date(l.fecha_entrada).toLocaleDateString('es-ES') : 's/f'} · {parseFloat(l.cantidad_actual).toLocaleString('es-ES', { maximumFractionDigits: 1 })} kg
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Método</span>
                      <input value={form.metodo ?? ''} onChange={e => setForm({ ...form, metodo: e.target.value })}
                        placeholder="Ej: CB-2001"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                    </label>
                  </div>
                  {/* Specs dinámicas del producto (pH, sólidos, viscosidad, acidez, densidad…) */}
                  {productoSpecs.length === 0 ? (
                    form.producto_id ? (
                      <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                        Este producto no tiene specs asignadas. Edita el producto y añade specs en Productos → Editar → Especificaciones requeridas.
                      </p>
                    ) : null
                  ) : (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
                      <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Specs del producto — introduce valor medido</p>
                      {productoSpecs.map((s) => {
                        const val = specsValores[s.spec_id] ?? '';
                        const min = s.min_valor != null ? parseFloat(String(s.min_valor)) : null;
                        const max = s.max_valor != null ? parseFloat(String(s.max_valor)) : null;
                        let ok: boolean | null = null;
                        if (val !== '') {
                          const n = Number(val);
                          if (!isNaN(n)) ok = (min != null && n < min) || (max != null && n > max) ? false : true;
                        }
                        const rangoStr = (min == null && max == null)
                          ? 'sin rango definido'
                          : `Rango: ${min ?? '?'}–${max ?? '?'}${s.unidad ? ' ' + s.unidad : ''}`;
                        const params = s.parametros as Record<string, string> | undefined;
                        const paramsText = params ? Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
                        return (
                          <div key={s.spec_id}>
                            <div className="flex items-baseline justify-between mb-1">
                              <label className="text-xs font-semibold text-gray-700">
                                {s.nombre}{s.unidad ? <span className="text-gray-400"> ({s.unidad})</span> : null}
                              </label>
                              <span className="text-[10px] text-gray-400">{rangoStr}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number" step="0.01"
                                value={val}
                                onChange={(e) => setSpecsValores((m) => ({ ...m, [s.spec_id]: e.target.value }))}
                                placeholder="—"
                                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                              />
                              {ok === false && <span className="text-xs text-loga-red font-semibold whitespace-nowrap">Fuera ⚠</span>}
                              {ok === true  && <span className="text-xs text-emerald-600 font-semibold whitespace-nowrap">OK ✓</span>}
                            </div>
                            {paramsText && (
                              <p className="mt-1 text-[10px] text-gray-500">Condiciones de medida — {paramsText}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {tab === 'limpieza' && (
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Producto fabricado · Lote <span className="font-normal text-gray-400">(opcional)</span>
                      </span>
                      <select
                        value={form.lote_codigo ?? ''}
                        onChange={e => {
                          const sel = lotesFabricados.find(l => l.lote_interno === e.target.value);
                          if (!sel) {
                            setForm((f: any) => ({ ...f, lote_codigo: null, producto_id: null, producto_nombre: null, producto_codigo: null }));
                          } else {
                            setForm((f: any) => ({
                              ...f,
                              lote_codigo: sel.lote_interno,
                              producto_id: sel.producto_id,
                              producto_nombre: sel.producto_nombre,
                              producto_codigo: sel.producto_codigo,
                            }));
                          }
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="">— Sin asociar —</option>
                        {lotesFabricados.map(l => (
                          <option key={l.id} value={l.lote_interno}>
                            {l.producto_codigo} · {l.producto_nombre} — Lote {l.lote_interno}
                          </option>
                        ))}
                      </select>
                      {form.producto_nombre && (
                        <p className="mt-1 text-[11px] text-blue-700">
                          Se firmará: <b>{form.producto_codigo}</b> {form.producto_nombre} · Lote <b>{form.lote_codigo}</b>
                        </p>
                      )}
                    </label>
                  )}
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
                {form.resultado === 'pendiente' ? 'Guardar pendiente' : 'Firmar y guardar'}
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
