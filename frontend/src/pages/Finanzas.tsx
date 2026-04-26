import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, TrendingUp, Factory, Warehouse, Download, BarChart3, PieChart, ArrowUpRight, Package,
} from 'lucide-react';
import { finanzasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import clsx from 'clsx';

interface DesgloseItem { nombre: string; cantidad: number; unidad: string; precio_ud: number; coste_linea: number }
interface Rentabilidad {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  precio_venta: number;
  precio_coste: number;
  coste_batch?: number;
  rendimiento?: number;
  precio_kg?: number;
  precio_1000kg?: number;
  stock_actual: number;
  unidad_medida: string;
  margen_pct: number;
  beneficio_ud: number;
  desglose?: DesgloseItem[];
}

interface Inmovilizado {
  valor_mp: number;
  valor_fab: number;
  valor_env: number;
  valor_pt: number;
  valor_emb: number;
  valor_total: number;
}

interface TopInmovilizado {
  codigo: string;
  nombre: string;
  tipo: string;
  stock_actual: number;
  unidad_medida: string;
  precio_unitario: number;
  valor: number;
}

interface Ventas {
  num_pedidos: number;
  facturacion_total: number;
  subtotal_total: number;
  portes_total: number;
}

interface VentaMes {
  mes: string;
  mes_label: string;
  num_pedidos: number;
  total: number;
}

interface VentaProducto {
  nombre: string;
  codigo: string;
  cantidad_vendida: number;
  unidad_medida: string;
  precio_venta: number;
  facturacion: number;
}

interface CosteProd {
  num_ordenes: number;
  coste_total: number;
}

interface ResumenData {
  rentabilidad: Rentabilidad[];
  rechazos: { ordenes_canceladas: number; valor_rechazado: number; lotes_rechazados: number };
  clientes_activos: number;
  inmovilizado: Inmovilizado;
  topInmovilizado: TopInmovilizado[];
  ventas: Ventas;
  ventasMes: VentaMes[];
  ventasProducto: VentaProducto[];
  costeProd: CosteProd;
  mermas?: { total_kg: number; total_eur: number; unidades_perdidas: number; num_ordenes: number };
}

const fmt = (n: number) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShort = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return fmt(n);
};


interface ImpactoReceta {
  receta_nombre: string;
  producto_nombre: string;
  producto_codigo: string;
  unidad_medida: string;
  precio_venta: number;
  coste_anterior: number;
  coste_actual: number;
  margen_anterior: number;
  margen_actual: number;
  diff_coste: number;
  diff_margen: number;
  detalle_mp: { nombre: string; cantidad: number; precio_anterior: number | null; precio_actual: number; diff: number }[];
}

interface MPPrecio {
  codigo: string;
  nombre: string;
  unidad_medida: string;
  precio_actual: string;
  precio_anterior: string | null;
  variacion_pct: string;
}

export default function Finanzas() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<ResumenData | null>(null);
  const [impactoRecetas, setImpactoRecetas] = useState<ImpactoReceta[]>([]);
  const [mpPrecios, setMpPrecios] = useState<MPPrecio[]>([]);
  const [expandedReceta, setExpandedReceta] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rentaTab, setRentaTab] = useState<'todos' | 'producto_fabricado' | 'producto_envasado'>('todos');
  const [desgloseId, setDesgloseId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [resRes, impRes] = await Promise.all([
        finanzasApi.resumen(),
        finanzasApi.impactoCostes().catch(() => ({ data: { impactoRecetas: [], materiasPrimas: [] } })),
      ]);
      setData(resRes.data as ResumenData);
      const imp = impRes.data as { impactoRecetas: ImpactoReceta[]; materiasPrimas: MPPrecio[] };
      setImpactoRecetas(imp.impactoRecetas ?? []);
      setMpPrecios(imp.materiasPrimas ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos financieros');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-400 text-sm">Acceso restringido a administradores</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-loga-red text-sm">{error || 'Sin datos'}</p>
      </div>
    );
  }

  const exportar = async (tipo: string) => {
    try {
      const res = await finanzasApi.exportar(tipo);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tipo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const beneficioBruto = data.ventas.facturacion_total - data.costeProd.coste_total;
  const maxMes = Math.max(...data.ventasMes.map(v => parseFloat(String(v.total))), 1);

  const margenPct = data.ventas.facturacion_total > 0 ? ((beneficioBruto / data.ventas.facturacion_total) * 100) : 0;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Finanzas</h1>
          <p className="text-xs text-gray-400 mt-0.5">Panel financiero en tiempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {['pedidos', 'produccion', 'inventario'].map(tipo => (
            <button key={tipo} onClick={() => exportar(tipo)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-all">
              <Download size={11} /> {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
            </button>
          ))}
          <select id="plastico-year" defaultValue={new Date().getFullYear()}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-medium text-emerald-700 outline-none">
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={() => {
            const y = (document.getElementById('plastico-year') as HTMLSelectElement)?.value || new Date().getFullYear();
            const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';
            const url = `/api/finanzas/informe-plastico?desde=${y}-01-01&hasta=${y}-12-31`;
            fetch(url, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.blob())
              .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `informe-plastico-${y}.csv`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              })
              .catch(e => console.error('Error:', e));
          }}
            className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-all">
            <Download size={11} /> Materiales embalaje
          </button>
        </div>
      </div>

      {/* KPI Cards — Premium */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Facturación', value: data.ventas.facturacion_total,
            sub: `${data.ventas.num_pedidos} pedidos completados`,
            icon: DollarSign, gradient: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50', accent: 'text-emerald-600',
          },
          {
            label: 'Coste producción', value: data.costeProd.coste_total,
            sub: `${data.costeProd.num_ordenes} órdenes fabricadas`,
            icon: Factory, gradient: 'from-amber-500 to-orange-500', light: 'bg-amber-50', accent: 'text-amber-600',
          },
          {
            label: 'Beneficio bruto', value: beneficioBruto,
            sub: margenPct > 0 ? `${margenPct.toFixed(1)}% margen` : '—',
            icon: TrendingUp, gradient: beneficioBruto >= 0 ? 'from-blue-500 to-indigo-600' : 'from-red-500 to-red-600',
            light: beneficioBruto >= 0 ? 'bg-blue-50' : 'bg-red-50', accent: beneficioBruto >= 0 ? 'text-blue-600' : 'text-loga-red',
          },
          {
            label: 'Valor inventario', value: data.inmovilizado.valor_total,
            sub: 'Inmovilizado en stock',
            icon: Warehouse, gradient: 'from-violet-500 to-purple-600', light: 'bg-violet-50', accent: 'text-violet-600',
          },
        ].map(({ label, value, sub, icon: Icon, gradient, light, accent }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 300, damping: 25 }}
            className="relative rounded-2xl border border-gray-100 bg-white p-5 shadow-sm overflow-hidden group hover:shadow-md transition-shadow"
          >
            {/* Gradient accent bar */}
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradient}`} />

            <div className="flex items-start justify-between mb-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
              <div className={clsx('rounded-xl p-2.5 transition-transform group-hover:scale-110', light)}>
                <Icon size={16} className={accent} />
              </div>
            </div>
            <p className={clsx('text-2xl font-black tabular-nums tracking-tight', accent)}>
              {fmtShort(value)} <span className="text-sm font-semibold text-gray-300">EUR</span>
            </p>
            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
              {value > 0 && <ArrowUpRight size={10} className="text-emerald-500" />}
              {sub}
            </p>
          </motion.div>
        ))}
      </section>

      {/* KPIs secundarios — datos operativos */}
      <motion.section
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {[
          { label: 'Ticket medio', value: data.ventas.num_pedidos > 0 ? fmt(data.ventas.facturacion_total / data.ventas.num_pedidos) : '0', unit: 'EUR/pedido', color: 'text-violet-600' },
          { label: 'Coste medio/orden', value: data.costeProd.num_ordenes > 0 ? fmt(data.costeProd.coste_total / data.costeProd.num_ordenes) : '0', unit: 'EUR/orden', color: 'text-amber-600' },
          { label: 'Producción rechazada', value: fmt(data.rechazos.valor_rechazado), unit: `${data.rechazos.ordenes_canceladas} órdenes · ${data.rechazos.lotes_rechazados} lotes`, color: 'text-loga-red' },
          { label: 'Mermas producción', value: `${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')} kg`, unit: `${fmt(data.mermas?.total_eur ?? 0)} EUR · ${(data.mermas?.unidades_perdidas ?? 0).toLocaleString('es-ES')} ud perdidas`, color: 'text-amber-600' },
        ].map(({ label, value, unit, color }, i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.05 }}
            className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-[10px] text-gray-400 font-medium">{label}</p>
            <p className={clsx('text-lg font-black tabular-nums mt-1', color)}>{value}</p>
            <p className="text-[9px] text-gray-300">{unit}</p>
          </motion.div>
        ))}
      </motion.section>

      {/* Ventas por mes — chart con tooltips */}
      {data.ventasMes.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-loga-red" />
              <h2 className="text-sm font-bold text-gray-900">Evolución de ventas</h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              <span>Total: <b className="text-gray-700">{fmt(data.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0))} EUR</b></span>
              <span>{data.ventasMes.length} meses</span>
            </div>
          </div>
          <div className="flex items-end gap-2 h-44">
            {data.ventasMes.map((m, i) => {
              const total = parseFloat(String(m.total));
              const pct = maxMes > 0 ? (total / maxMes) * 100 : 0;
              const avg = data.ventasMes.reduce((s, x) => s + parseFloat(String(x.total)), 0) / data.ventasMes.length;
              return (
                <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 group relative">
                  {/* Tooltip on hover */}
                  <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-lg px-3 py-2 text-[10px] opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-10 whitespace-nowrap shadow-xl">
                    <p className="font-bold text-sm tabular-nums">{fmt(total)} EUR</p>
                    <p className="text-gray-400">{m.num_pedidos} pedidos · {m.mes_label}</p>
                    <p className={total > avg ? 'text-emerald-400' : 'text-amber-400'}>
                      {total > avg ? '↑' : '↓'} {((total / avg - 1) * 100).toFixed(0)}% vs media
                    </p>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-gray-900 rotate-45" />
                  </div>
                  <div className="w-full relative rounded-xl overflow-hidden cursor-pointer" style={{ height: '120px' }}>
                    <div className="absolute inset-0 bg-gray-50 rounded-xl" />
                    {/* Línea media */}
                    <div className="absolute left-0 right-0 border-t border-dashed border-gray-200" style={{ bottom: `${(avg / maxMes) * 100}%` }} />
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${pct}%` }}
                      transition={{ delay: 0.5 + i * 0.08, duration: 0.8, ease: 'easeOut' }}
                      className={clsx('absolute bottom-0 left-1 right-1 rounded-lg transition-all group-hover:left-0 group-hover:right-0',
                        total > avg ? 'bg-gradient-to-t from-loga-red to-red-400' : 'bg-gradient-to-t from-red-300 to-red-200'
                      )}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600">{m.mes_label}</span>
                  <span className="text-[9px] text-gray-300 tabular-nums">{fmtShort(total)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-loga-red" /> Por encima de la media</span>
            <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-red-200" /> Por debajo</span>
            <span className="flex items-center gap-1"><span className="w-6 border-t border-dashed border-gray-300" /> Media mensual</span>
          </div>
        </motion.section>
      )}

      {/* Rentabilidad por producto */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Rentabilidad por producto</h2>
        <div className="flex items-center gap-2 mb-3">
          {([
            { v: 'todos', l: 'Todos', color: 'bg-gray-700' },
            { v: 'producto_fabricado', l: 'Granel', color: 'bg-loga-red' },
            { v: 'producto_envasado', l: 'Envasado', color: 'bg-emerald-600' },
          ] as const).map(({ v, l, color }) => (
            <button key={v} onClick={() => setRentaTab(v)}
              className={clsx('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                rentaTab === v ? `${color} text-white` : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              )}>
              {l} ({v === 'todos' ? data.rentabilidad.length : data.rentabilidad.filter(r => r.tipo === v).length})
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Producto', 'Tipo', 'Precio venta', 'Precio coste', 'Margen %', 'Beneficio/ud'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {data.rentabilidad.filter(r => rentaTab === 'todos' || r.tipo === rentaTab).map(r => {
                const margen = parseFloat(String(r.margen_pct));
                const margenColor = margen < 20 ? 'text-loga-red bg-red-50' : margen < 40 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';
                const tipoLabel = r.tipo === 'producto_fabricado' ? 'Granel' : r.tipo === 'producto_envasado' ? 'Envasado' : 'Prod.';
                const tipoCls = r.tipo === 'producto_fabricado' ? 'bg-loga-red/10 text-loga-red' : 'bg-emerald-100 text-emerald-700';
                const isOpen = desgloseId === r.id;
                return (
                  <React.Fragment key={r.id}>
                  <tr className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setDesgloseId(isOpen ? null : r.id)}>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-gray-900">{r.nombre}</p>
                      <p className="text-[11px] text-gray-400 font-mono">{r.codigo}</p>
                      {r.precio_kg != null && (
                        <p className="text-[10px] text-blue-500 mt-0.5">{fmt(r.precio_kg)} EUR/kg · {fmt(r.precio_1000kg ?? 0)} EUR/1000kg</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('rounded-md px-2 py-0.5 text-[10px] font-semibold', tipoCls)}>{tipoLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-700">{fmt(r.precio_venta)} EUR/{r.unidad_medida}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-700">
                      {fmt(r.precio_coste)} EUR/{r.unidad_medida}
                      {r.coste_batch != null && r.rendimiento != null && r.rendimiento > 1 && (
                        <p className="text-[10px] text-gray-400">Batch {r.rendimiento} {r.unidad_medida}: {fmt(r.coste_batch)} EUR</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums', margenColor)}>
                        {margen.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums font-semibold text-gray-800">
                      {fmt(r.beneficio_ud)} EUR
                    </td>
                  </tr>
                  {isOpen && r.desglose && r.desglose.length > 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-gray-50/80">
                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Desglose de coste</p>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left py-0.5 font-medium">Ingrediente</th>
                              <th className="text-right py-0.5 font-medium">Cantidad</th>
                              <th className="text-right py-0.5 font-medium">Precio/ud</th>
                              <th className="text-right py-0.5 font-medium">Coste línea</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {r.desglose.map((d, i) => (
                              <tr key={i}>
                                <td className="py-1 text-gray-700 font-medium">{d.nombre}</td>
                                <td className="py-1 text-right tabular-nums text-gray-500">{d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {d.unidad}</td>
                                <td className="py-1 text-right tabular-nums text-gray-500">{fmt(d.precio_ud)} EUR/{d.unidad}</td>
                                <td className="py-1 text-right tabular-nums font-semibold text-gray-800">{fmt(d.coste_linea)} EUR</td>
                              </tr>
                            ))}
                            <tr className="border-t border-gray-200 font-bold">
                              <td className="py-1 text-gray-800" colSpan={3}>
                                Total batch{r.rendimiento && r.rendimiento > 1 ? ` (${r.rendimiento} ${r.unidad_medida})` : ''}
                              </td>
                              <td className="py-1 text-right tabular-nums text-gray-900">{fmt(r.coste_batch ?? r.precio_coste)} EUR</td>
                            </tr>
                            {r.rendimiento && r.rendimiento > 1 && (
                              <tr className="font-bold text-loga-red">
                                <td className="py-1" colSpan={3}>Coste por {r.unidad_medida}</td>
                                <td className="py-1 text-right tabular-nums">{fmt(r.precio_coste)} EUR</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {data.rentabilidad.filter(r => rentaTab === 'todos' || r.tipo === rentaTab).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">Sin productos con precios</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {/* Inmovilizado en stock */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Distribucion por tipo con donut visual */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
          className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart size={16} className="text-violet-500" />
            <h2 className="text-sm font-bold text-gray-900">Valor inventario por tipo</h2>
          </div>
          <div className="flex items-center gap-6">
            {/* Donut SVG */}
            <div className="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                {(() => {
                  const items = [
                    { value: data.inmovilizado.valor_mp, color: '#3b82f6' },
                    { value: data.inmovilizado.valor_fab, color: '#FF0000' },
                    { value: data.inmovilizado.valor_env, color: '#10b981' },
                    { value: data.inmovilizado.valor_emb, color: '#f59e0b' },
                  ];
                  const total = data.inmovilizado.valor_total || 1;
                  let offset = 0;
                  return items.map((item, i) => {
                    const pct = (item.value / total) * 100;
                    const el = <circle key={i} cx="18" cy="18" r="14" fill="none" stroke={item.color} strokeWidth="4"
                      strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={`-${offset}`} className="transition-all duration-1000" />;
                    offset += pct;
                    return el;
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-xs font-black text-gray-900 tabular-nums">{fmtShort(data.inmovilizado.valor_total)}</p>
                <p className="text-[8px] text-gray-400">EUR total</p>
              </div>
            </div>
            {/* Legend */}
            <div className="flex-1 space-y-2">
              {([
                { label: 'Materia Prima', value: data.inmovilizado.valor_mp, color: 'bg-blue-500', dot: '#3b82f6' },
                { label: 'Fabricado', value: data.inmovilizado.valor_fab, color: 'bg-loga-red', dot: '#FF0000' },
                { label: 'Envasado', value: data.inmovilizado.valor_env, color: 'bg-emerald-500', dot: '#10b981' },
                { label: 'Embalaje', value: data.inmovilizado.valor_emb, color: 'bg-amber-500', dot: '#f59e0b' },
              ]).map(({ label, value, dot }) => {
                const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                    <span className="text-[11px] text-gray-600 flex-1">{label}</span>
                    <span className="text-[11px] font-bold tabular-nums text-gray-800">{fmt(value)}</span>
                    <span className="text-[9px] text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* Top 10 productos por valor — barras horizontales */}
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}
          className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold text-gray-900">Top 10 valor inmovilizado</h2>
          </div>
          <div className="space-y-2">
            {data.topInmovilizado.slice(0, 10).map((p, i) => {
              const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
              const val = parseFloat(String(p.valor));
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              const tipoC = p.tipo === 'producto_fabricado' ? 'text-loga-red' : p.tipo === 'producto_envasado' ? 'text-emerald-600' : p.tipo === 'materia_prima' ? 'text-blue-600' : 'text-gray-500';
              return (
                <motion.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.05 }}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-bold text-gray-300 w-4">{i + 1}</span>
                    <span className="text-[11px] font-semibold text-gray-800 flex-1 truncate">{p.nombre}</span>
                    <span className="text-[11px] font-bold tabular-nums text-gray-900">{fmt(val)} EUR</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4" />
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.9 + i * 0.05, duration: 0.6 }}
                        className={clsx('h-full rounded-full', p.tipo === 'producto_fabricado' ? 'bg-loga-red' : p.tipo === 'producto_envasado' ? 'bg-emerald-500' : p.tipo === 'materia_prima' ? 'bg-blue-500' : 'bg-amber-500')}
                      />
                    </div>
                    <span className={clsx('text-[9px] font-semibold w-16 text-right', tipoC)}>
                      {parseFloat(String(p.stock_actual)).toLocaleString('es-ES')} {p.unidad_medida}
                    </span>
                  </div>
                </motion.div>
              );
            })}
            {data.topInmovilizado.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Sin datos</p>}
          </div>
        </motion.div>
      </section>

      {/* Ventas por producto */}
      {data.ventasProducto.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Top 10 ventas por producto</h2>
          <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Producto', 'Cantidad vendida', 'Precio venta', 'Facturacion'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-50">
                {data.ventasProducto.map((v, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-gray-900">{v.nombre}</p>
                      <p className="text-[11px] text-gray-400 font-mono">{v.codigo}</p>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-700">
                      {parseFloat(String(v.cantidad_vendida)).toLocaleString('es-ES')} {v.unidad_medida}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-gray-700">{fmt(parseFloat(String(v.precio_venta)))} EUR</td>
                    <td className="px-4 py-3 text-xs tabular-nums font-semibold text-gray-800">{fmt(parseFloat(String(v.facturacion)))} EUR</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      )}

      {/* Impacto en rentabilidad por receta */}
      {impactoRecetas.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-800">Impacto de Precios en Rentabilidad</h2>
            <p className="text-xs text-gray-400">Como afectan las variaciones de precio de MP al margen de cada receta</p>
          </div>
          <div className="divide-y divide-gray-100">
            {impactoRecetas.map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const margenBajo = r.diff_margen < 0;
              return (
                <div key={r.receta_nombre}>
                  <button onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)} className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{r.producto_nombre}</p>
                      <p className="text-[11px] text-gray-400">{r.receta_nombre} · PVP: {r.precio_venta.toFixed(2)} EUR/{r.unidad_medida}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-xs">
                      <div className="text-right">
                        <p className="text-gray-400">Coste/{r.unidad_medida}</p>
                        <p className="font-semibold text-gray-800">{r.coste_actual.toFixed(4)} EUR</p>
                        {r.diff_coste !== 0 && (
                          <p className={clsx('text-[10px] font-bold', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600')}>
                            {r.diff_coste > 0 ? '+' : ''}{r.diff_coste.toFixed(4)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-gray-400">Margen</p>
                        <p className={clsx('font-bold text-sm', r.margen_actual > 40 ? 'text-emerald-600' : r.margen_actual > 20 ? 'text-amber-600' : 'text-loga-red')}>
                          {r.margen_actual.toFixed(1)}%
                        </p>
                        {r.diff_margen !== 0 && (
                          <p className={clsx('text-[10px] font-bold', margenBajo ? 'text-loga-red' : 'text-emerald-600')}>
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                  {expanded && r.detalle_mp.length > 0 && (
                    <div className="px-5 pb-3 overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left py-1 font-medium">Ingrediente</th>
                            <th className="text-right py-1 font-medium">Precio ant.</th>
                            <th className="text-right py-1 font-medium">Precio act.</th>
                            <th className="text-right py-1 font-medium">Impacto/batch</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.detalle_mp.map((mp, i) => (
                            <tr key={i} className="border-t border-gray-50">
                              <td className="py-1 text-gray-700">{mp.nombre} <span className="text-gray-400">({mp.cantidad.toFixed(2)})</span></td>
                              <td className="py-1 text-right text-gray-500">{mp.precio_anterior?.toFixed(4) ?? '---'}</td>
                              <td className="py-1 text-right font-medium text-gray-800">{mp.precio_actual.toFixed(4)}</td>
                              <td className={clsx('py-1 text-right font-bold', mp.diff > 0 ? 'text-loga-red' : mp.diff < 0 ? 'text-emerald-600' : 'text-gray-400')}>
                                {mp.diff !== 0 ? (mp.diff > 0 ? '+' : '') + mp.diff.toFixed(2) + ' EUR' : '---'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Evolucion precios materias primas */}
      {mpPrecios.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-800">Precios de Materias Primas</h2>
            <p className="text-xs text-gray-400">Variaciones de precio de compra (ultimos 90 dias)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Materia Prima', 'Precio anterior', 'Precio actual', 'Variacion'].map(h =>
                    <th key={h} className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {mpPrecios.map((item, i) => {
                  const variacion = parseFloat(item.variacion_pct);
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{item.nombre}</p>
                        <p className="text-gray-400 font-mono text-[10px]">{item.codigo}</p>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-500">
                        {item.precio_anterior ? `${parseFloat(item.precio_anterior).toFixed(4)} EUR/${item.unidad_medida}` : '---'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-gray-800">
                        {parseFloat(item.precio_actual).toFixed(4)} EUR/{item.unidad_medida}
                      </td>
                      <td className="px-4 py-2.5">
                        {item.precio_anterior && variacion !== 0 ? (
                          <span className={clsx('font-bold', variacion > 0 ? 'text-loga-red' : 'text-emerald-600')}>
                            {variacion > 0 ? '+' : ''}{variacion.toFixed(1)}%
                          </span>
                        ) : <span className="text-gray-300">Sin cambios</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
