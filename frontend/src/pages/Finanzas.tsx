import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, TrendingUp, Factory, Warehouse, Download, BarChart3, PieChart,
  ArrowUpRight, ArrowDownRight, Package, Search, Sparkles, Activity,
  ChevronDown, Receipt, Layers, Box, Beaker, Zap, AlertTriangle,
} from 'lucide-react';
import { finanzasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { notify } from '../lib/notify';
import clsx from 'clsx';

// ── Tipos (sin cambios) ─────────────────────────────────────────────
interface DesgloseItem { nombre: string; cantidad: number; unidad: string; precio_ud: number; coste_linea: number }
interface Rentabilidad {
  id: string; codigo: string; nombre: string; tipo: string;
  precio_venta: number; precio_coste: number; coste_batch?: number; rendimiento?: number;
  precio_kg?: number; precio_1000kg?: number; stock_actual: number; unidad_medida: string;
  margen_pct: number; margen_ref?: number; diff_margen?: number; salud?: string;
  pvp_anterior?: number; beneficio_ud: number; desglose?: DesgloseItem[];
}
interface Inmovilizado { valor_mp: number; valor_fab: number; valor_env: number; valor_pt: number; valor_emb: number; valor_total: number }
interface TopInmovilizado { codigo: string; nombre: string; tipo: string; stock_actual: number; unidad_medida: string; precio_unitario: number; valor: number }
interface Ventas { num_pedidos: number; facturacion_total: number; subtotal_total: number; portes_total: number }
interface VentaMes { mes: string; mes_label: string; num_pedidos: number; total: number }
interface VentaProducto { nombre: string; codigo: string; cantidad_vendida: number; unidad_medida: string; precio_venta: number; facturacion: number }
interface CosteProd { num_ordenes: number; coste_total: number }
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
interface ImpactoReceta {
  receta_nombre: string; producto_nombre: string; producto_codigo: string;
  unidad_medida: string; precio_venta: number;
  pvp_anterior?: number; pvp_actual?: number;
  coste_anterior: number; coste_actual: number;
  margen_anterior: number; margen_actual: number;
  diff_coste: number; diff_margen: number; salud?: string;
  detalle_mp: { nombre: string; cantidad: number; precio_anterior: number | null; precio_actual: number; diff: number }[];
}
interface MPPrecio { codigo: string; nombre: string; unidad_medida: string; precio_actual: string; precio_anterior: string | null; variacion_pct: string }

// ── Helpers de formato ──────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return fmt(n);
};
const fmtInt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 0 });

// ── Sparkline mini SVG (sin librería) ───────────────────────────────
function Sparkline({ values, color = '#FF0000', height = 28 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = `0,${height} ${points} 100,${height}`;
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full overflow-visible" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#spark-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Página ──────────────────────────────────────────────────────────
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
  const [rentaSearch, setRentaSearch] = useState('');
  const [rentaSort, setRentaSort] = useState<{ key: 'margen' | 'venta' | 'coste' | 'beneficio'; dir: 'desc' | 'asc' }>({ key: 'margen', dir: 'desc' });
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

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
      setRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos financieros');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Memos para no recalcular en cada render ────────────────────────
  const beneficioBruto = useMemo(() => (data ? data.ventas.facturacion_total - data.costeProd.coste_total : 0), [data]);
  const margenPct = useMemo(() => (data && data.ventas.facturacion_total > 0 ? (beneficioBruto / data.ventas.facturacion_total) * 100 : 0), [data, beneficioBruto]);
  const maxMes = useMemo(() => (data ? Math.max(...data.ventasMes.map(v => parseFloat(String(v.total))), 1) : 1), [data]);
  const avgMes = useMemo(() => {
    if (!data || data.ventasMes.length === 0) return 0;
    return data.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0) / data.ventasMes.length;
  }, [data]);
  const totalEvolucion = useMemo(() => data?.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0) ?? 0, [data]);

  const sparkVentas = useMemo(() => data?.ventasMes.map(m => parseFloat(String(m.total))) ?? [], [data]);

  // Filtro + búsqueda + sort de rentabilidad (memoizado)
  const rentabilidadFiltrada = useMemo(() => {
    if (!data) return [];
    let arr = data.rentabilidad.filter(r => rentaTab === 'todos' || r.tipo === rentaTab);
    if (rentaSearch) {
      const q = rentaSearch.toLowerCase();
      arr = arr.filter(r => r.nombre.toLowerCase().includes(q) || r.codigo.toLowerCase().includes(q));
    }
    const k = rentaSort.key;
    const dir = rentaSort.dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      const va = k === 'margen' ? parseFloat(String(a.margen_pct))
               : k === 'venta'  ? parseFloat(String(a.precio_venta))
               : k === 'coste'  ? parseFloat(String(a.precio_coste))
               : parseFloat(String(a.beneficio_ud));
      const vb = k === 'margen' ? parseFloat(String(b.margen_pct))
               : k === 'venta'  ? parseFloat(String(b.precio_venta))
               : k === 'coste'  ? parseFloat(String(b.precio_coste))
               : parseFloat(String(b.beneficio_ud));
      return (va - vb) * dir;
    });
  }, [data, rentaTab, rentaSearch, rentaSort]);

  const ordenarPor = (key: typeof rentaSort.key) => {
    setRentaSort(prev => prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  };

  // ── Guards de auth/loading/error ───────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <AlertTriangle size={32} className="mx-auto text-amber-500" />
          <p className="text-gray-500 text-sm">Acceso restringido a administradores</p>
        </div>
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
      a.href = url; a.download = `${tipo}.csv`; a.click();
      URL.revokeObjectURL(url);
      notify.success('Exportación lista', { description: `${tipo}.csv descargado` });
    } catch { notify.error(`No se pudo exportar ${tipo}`); }
  };

  // ── Render principal ───────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-12">

      {/* ═══════════════════════════════════════════════════════════════
           HERO HEADER — gradient + métricas resumen integradas
         ═══════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl border border-gray-100 bg-gradient-to-br from-white via-white to-red-50/30 dark:from-zinc-900 dark:via-zinc-900 dark:to-red-950/20 p-6 shadow-sm"
      >
        {/* Decorative blobs */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-loga-red/5 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-gradient-to-br from-loga-red to-red-600 p-3 shadow-lg shadow-red-500/20">
              <Activity size={22} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">Finanzas</h1>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  En vivo
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Panel financiero ·{' '}
                {refreshedAt && <span className="text-gray-400">Actualizado {refreshedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>}
              </p>
            </div>
          </div>

          {/* Acciones agrupadas */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
              {([
                { tipo: 'pedidos',     label: 'Pedidos',    icon: Receipt },
                { tipo: 'produccion',  label: 'Producción', icon: Factory },
                { tipo: 'inventario',  label: 'Inventario', icon: Box },
              ] as const).map(({ tipo, label, icon: Icon }) => (
                <button key={tipo} onClick={() => exportar(tipo)}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all">
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden shadow-sm">
              <select id="plastico-year" defaultValue={new Date().getFullYear()}
                className="bg-transparent px-2 py-1.5 text-[11px] font-bold text-emerald-700 outline-none border-r border-emerald-200">
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all">
                <Download size={12} /> Plástico (Ley 7/2022)
              </button>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ═══════════════════════════════════════════════════════════════
           KPI HERO — 4 métricas grandes con sparkline + comparativas
         ═══════════════════════════════════════════════════════════════ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Facturación',
            value: data.ventas.facturacion_total,
            sub: `${fmtInt(data.ventas.num_pedidos)} pedidos`,
            icon: DollarSign,
            color: '#10b981',
            gradientFrom: 'from-emerald-50',
            gradientTo: 'to-emerald-100/30',
            iconBg: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
            textColor: 'text-emerald-700 dark:text-emerald-400',
            sparkColor: '#10b981',
            spark: sparkVentas.length > 1 ? sparkVentas : undefined,
          },
          {
            label: 'Coste producción',
            value: data.costeProd.coste_total,
            sub: `${fmtInt(data.costeProd.num_ordenes)} órdenes`,
            icon: Factory,
            color: '#f59e0b',
            gradientFrom: 'from-amber-50',
            gradientTo: 'to-amber-100/30',
            iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500',
            textColor: 'text-amber-700 dark:text-amber-400',
            sparkColor: '#f59e0b',
            spark: undefined,
          },
          {
            label: 'Beneficio bruto',
            value: beneficioBruto,
            sub: `${margenPct.toFixed(1)}% margen`,
            subBadge: margenPct >= 40 ? 'excelente' : margenPct >= 20 ? 'óptimo' : 'revisar',
            subBadgeColor: margenPct >= 40 ? 'emerald' : margenPct >= 20 ? 'amber' : 'red',
            icon: TrendingUp,
            color: beneficioBruto >= 0 ? '#3b82f6' : '#FF0000',
            gradientFrom: beneficioBruto >= 0 ? 'from-blue-50' : 'from-red-50',
            gradientTo: beneficioBruto >= 0 ? 'to-indigo-100/30' : 'to-red-100/30',
            iconBg: beneficioBruto >= 0 ? 'bg-gradient-to-br from-blue-400 to-indigo-600' : 'bg-gradient-to-br from-red-500 to-rose-600',
            textColor: beneficioBruto >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-loga-red',
            sparkColor: beneficioBruto >= 0 ? '#3b82f6' : '#FF0000',
            spark: undefined,
          },
          {
            label: 'Valor inventario',
            value: data.inmovilizado.valor_total,
            sub: 'Stock inmovilizado',
            icon: Warehouse,
            color: '#8b5cf6',
            gradientFrom: 'from-violet-50',
            gradientTo: 'to-purple-100/30',
            iconBg: 'bg-gradient-to-br from-violet-400 to-purple-600',
            textColor: 'text-violet-700 dark:text-violet-400',
            sparkColor: '#8b5cf6',
            spark: undefined,
          },
        ].map((card, i) => (
          <motion.article
            key={card.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 280, damping: 24 }}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            className={clsx(
              'relative rounded-2xl border border-gray-100 dark:border-white/10 p-5 shadow-sm overflow-hidden group cursor-default transition-shadow hover:shadow-lg',
              'bg-gradient-to-br', card.gradientFrom, card.gradientTo, 'dark:from-zinc-900 dark:to-zinc-900',
            )}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">{card.label}</p>
                <p className={clsx('text-3xl font-black tabular-nums tracking-tight leading-none', card.textColor)}>
                  {fmtShort(card.value)}
                </p>
                <p className="text-[10px] font-semibold text-gray-400 mt-1">EUR</p>
              </div>
              <div className={clsx('rounded-2xl p-2.5 shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3', card.iconBg)}>
                <card.icon size={18} className="text-white" strokeWidth={2.5} />
              </div>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                <span className="font-semibold">{card.sub}</span>
                {card.subBadge && (
                  <span className={clsx(
                    'rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                    card.subBadgeColor === 'emerald' && 'bg-emerald-100 text-emerald-700',
                    card.subBadgeColor === 'amber' && 'bg-amber-100 text-amber-700',
                    card.subBadgeColor === 'red' && 'bg-red-100 text-red-700',
                  )}>
                    {card.subBadge}
                  </span>
                )}
              </div>
              {card.spark && (
                <div className="w-20 opacity-70 group-hover:opacity-100 transition-opacity">
                  <Sparkline values={card.spark} color={card.sparkColor} height={24} />
                </div>
              )}
            </div>
          </motion.article>
        ))}
      </section>

      {/* ═══════════════════════════════════════════════════════════════
           MÉTRICAS OPERATIVAS — 4 mini cards
         ═══════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {[
          {
            label: 'Ticket medio', icon: Receipt,
            value: data.ventas.num_pedidos > 0 ? fmt(data.ventas.facturacion_total / data.ventas.num_pedidos) : '0',
            unit: 'EUR/pedido', accent: 'violet',
          },
          {
            label: 'Coste medio/orden', icon: Factory,
            value: data.costeProd.num_ordenes > 0 ? fmt(data.costeProd.coste_total / data.costeProd.num_ordenes) : '0',
            unit: 'EUR/orden', accent: 'amber',
          },
          {
            label: 'Producción rechazada', icon: AlertTriangle,
            value: fmtShort(data.rechazos.valor_rechazado),
            unit: `${data.rechazos.ordenes_canceladas} órd · ${data.rechazos.lotes_rechazados} lotes`,
            accent: 'red',
          },
          {
            label: 'Mermas producción', icon: Beaker,
            value: `${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')} kg`,
            unit: `${fmt(data.mermas?.total_eur ?? 0)} EUR perdidos`,
            accent: 'amber',
          },
        ].map((m, i) => {
          const accentMap: Record<string, { ring: string; icon: string; text: string }> = {
            violet: { ring: 'ring-violet-100 dark:ring-violet-900/30', icon: 'text-violet-500 bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-400' },
            amber:  { ring: 'ring-amber-100 dark:ring-amber-900/30',  icon: 'text-amber-500 bg-amber-50 dark:bg-amber-950/30',   text: 'text-amber-700 dark:text-amber-400' },
            red:    { ring: 'ring-red-100 dark:ring-red-900/30',      icon: 'text-loga-red bg-red-50 dark:bg-red-950/30',         text: 'text-loga-red' },
          };
          const a = accentMap[m.accent];
          return (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.05 }}
              whileHover={{ y: -2 }}
              className={clsx('rounded-xl border border-gray-100 bg-white dark:bg-zinc-900 px-4 py-3.5 ring-1 transition-all hover:shadow-md', a.ring)}
            >
              <div className="flex items-start justify-between mb-1.5">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{m.label}</p>
                <div className={clsx('rounded-md p-1', a.icon)}>
                  <m.icon size={11} strokeWidth={2.5} />
                </div>
              </div>
              <p className={clsx('text-lg font-black tabular-nums leading-tight', a.text)}>{m.value}</p>
              <p className="text-[9px] text-gray-400 mt-0.5 truncate">{m.unit}</p>
            </motion.div>
          );
        })}
      </motion.section>

      {/* ═══════════════════════════════════════════════════════════════
           EVOLUCIÓN DE VENTAS — Chart de barras mejorado
         ═══════════════════════════════════════════════════════════════ */}
      {data.ventasMes.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-loga-red/10 p-2">
                <BarChart3 size={16} className="text-loga-red" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Evolución de ventas</h2>
                <p className="text-[11px] text-gray-400">Últimos {data.ventasMes.length} meses</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 font-medium">Total período</p>
              <p className="text-lg font-black text-gray-900 dark:text-white tabular-nums">{fmt(totalEvolucion)} EUR</p>
            </div>
          </div>

          <div className="p-5 pt-4">
            <div className="flex items-end gap-1.5 sm:gap-2 h-52">
              {data.ventasMes.map((m, i) => {
                const total = parseFloat(String(m.total));
                const pct = maxMes > 0 ? (total / maxMes) * 100 : 0;
                const aboveAvg = total > avgMes;
                const diffPct = avgMes > 0 ? ((total / avgMes - 1) * 100) : 0;
                return (
                  <div key={m.mes} className="flex-1 flex flex-col items-center gap-1.5 group relative min-w-0">
                    {/* Tooltip rico */}
                    <div className="absolute -top-24 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-zinc-800 text-white rounded-xl px-3 py-2.5 text-[10px] opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-20 whitespace-nowrap shadow-2xl ring-1 ring-white/10">
                      <p className="font-black text-base tabular-nums leading-none mb-1">{fmt(total)} <span className="text-xs text-gray-400">EUR</span></p>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-gray-400">{m.num_pedidos} pedidos</span>
                        <span className="text-gray-500">·</span>
                        <span className="text-gray-300 font-semibold">{m.mes_label}</span>
                      </div>
                      <div className={clsx('mt-1.5 flex items-center gap-1 text-[10px] font-bold', aboveAvg ? 'text-emerald-400' : 'text-amber-400')}>
                        {aboveAvg ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        {aboveAvg ? '+' : ''}{diffPct.toFixed(0)}% vs media
                      </div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2.5 h-2.5 bg-gray-900 dark:bg-zinc-800 rotate-45" />
                    </div>

                    {/* Barra */}
                    <div className="w-full relative cursor-pointer" style={{ height: '152px' }}>
                      <div className="absolute inset-0 bg-gray-50 dark:bg-zinc-800/50 rounded-xl" />
                      {/* Línea media (solo arriba) */}
                      <div className="absolute left-0 right-0 border-t border-dashed border-gray-300 dark:border-white/15"
                           style={{ bottom: `${avgMes > 0 ? (avgMes / maxMes) * 100 : 0}%` }} />
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${pct}%` }}
                        transition={{ delay: 0.6 + i * 0.06, duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
                        className={clsx(
                          'absolute bottom-0 left-1 right-1 rounded-lg transition-all',
                          'group-hover:left-0 group-hover:right-0 group-hover:shadow-lg',
                          aboveAvg
                            ? 'bg-gradient-to-t from-loga-red via-red-500 to-red-400'
                            : 'bg-gradient-to-t from-red-300 to-red-200 dark:from-red-900/50 dark:to-red-800/30'
                        )}
                      />
                      {/* Indicador above-avg sutil */}
                      {aboveAvg && (
                        <motion.div
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 + i * 0.06 }}
                          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-zinc-900"
                        />
                      )}
                    </div>

                    <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300">{m.mes_label.split(' ')[0]}</span>
                    <span className="text-[9px] text-gray-400 tabular-nums hidden sm:inline">{fmtShort(total)}</span>
                  </div>
                );
              })}
            </div>

            {/* Legenda */}
            <div className="flex items-center justify-center gap-5 mt-4 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-gradient-to-t from-loga-red to-red-400" />
                Sobre la media
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-gradient-to-t from-red-300 to-red-200" />
                Bajo la media
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-5 border-t border-dashed border-gray-400 dark:border-white/30" />
                Media: <b className="text-gray-700 dark:text-gray-200 tabular-nums">{fmtShort(avgMes)}</b>
              </span>
            </div>
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════════════
           INVENTARIO — Donut + Top 10 (2 columnas en desktop)
         ═══════════════════════════════════════════════════════════════ */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Donut distribución (2 cols) */}
        <motion.div
          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 }}
          className="lg:col-span-2 rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="rounded-xl bg-violet-100 dark:bg-violet-950/30 p-2">
              <PieChart size={16} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Distribución inventario</h2>
              <p className="text-[11px] text-gray-400">Por categoría de producto</p>
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Donut SVG mejorado */}
              <div className="relative w-36 h-36 shrink-0">
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
                      const el = (
                        <circle
                          key={i} cx="18" cy="18" r="14" fill="none" stroke={item.color} strokeWidth="5"
                          strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={`-${offset}`}
                          strokeLinecap="round"
                          className="transition-all duration-1000"
                          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                        />
                      );
                      offset += pct;
                      return el;
                    });
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-none">{fmtShort(data.inmovilizado.valor_total)}</p>
                  <p className="text-[10px] font-bold text-gray-400 mt-1">EUR TOTAL</p>
                </div>
              </div>

              {/* Legend con barra de progreso */}
              <div className="flex-1 w-full space-y-2.5">
                {([
                  { label: 'Materia prima', value: data.inmovilizado.valor_mp,  color: '#3b82f6', icon: Beaker },
                  { label: 'Fabricado',     value: data.inmovilizado.valor_fab, color: '#FF0000', icon: Zap },
                  { label: 'Envasado',      value: data.inmovilizado.valor_env, color: '#10b981', icon: Package },
                  { label: 'Embalaje',      value: data.inmovilizado.valor_emb, color: '#f59e0b', icon: Box },
                ]).map(({ label, value, color, icon: Icon }) => {
                  const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                  return (
                    <div key={label} className="group">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={11} style={{ color }} />
                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 flex-1">{label}</span>
                        <span className="text-[11px] font-black tabular-nums text-gray-900 dark:text-white">{fmtShort(value)}</span>
                        <span className="text-[10px] tabular-nums text-gray-400 w-10 text-right font-semibold">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.7, duration: 0.8 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Top 10 inmovilizado (3 cols) */}
        <motion.div
          initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}
          className="lg:col-span-3 rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="rounded-xl bg-amber-100 dark:bg-amber-950/30 p-2">
              <Layers size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Top 10 inmovilizado</h2>
              <p className="text-[11px] text-gray-400">Productos con más valor en stock</p>
            </div>
            <span className="rounded-full bg-amber-100 dark:bg-amber-950/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {data.topInmovilizado.length}
            </span>
          </div>

          <div className="p-5 space-y-2.5">
            {data.topInmovilizado.slice(0, 10).map((p, i) => {
              const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
              const val = parseFloat(String(p.valor));
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              const tipoConfig = p.tipo === 'producto_fabricado'
                ? { color: 'bg-loga-red', text: 'text-loga-red', label: 'Granel' }
                : p.tipo === 'producto_envasado'
                ? { color: 'bg-emerald-500', text: 'text-emerald-600', label: 'Envasado' }
                : p.tipo === 'materia_prima'
                ? { color: 'bg-blue-500', text: 'text-blue-600', label: 'MP' }
                : { color: 'bg-amber-500', text: 'text-amber-600', label: 'Embalaje' };
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.04 }}
                  className="group"
                >
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="flex items-center justify-center w-5 h-5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[10px] font-black text-gray-500 dark:text-gray-400 shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 flex-1 truncate">{p.nombre}</span>
                    <span className={clsx('rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-opacity-10', tipoConfig.text)}
                          style={{ backgroundColor: 'transparent' }}>
                      {tipoConfig.label}
                    </span>
                    <span className="text-[12px] font-black tabular-nums text-gray-900 dark:text-white w-20 text-right">{fmt(val)}</span>
                  </div>
                  <div className="flex items-center gap-2.5 pl-7">
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.9 + i * 0.04, duration: 0.6 }}
                        className={clsx('h-full rounded-full', tipoConfig.color)}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-gray-400 w-24 text-right font-medium">
                      {fmtInt(parseFloat(String(p.stock_actual)))} {p.unidad_medida}
                    </span>
                  </div>
                </motion.div>
              );
            })}
            {data.topInmovilizado.length === 0 && (
              <div className="py-8 text-center">
                <Box size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-xs text-gray-400">Sin datos de inventario</p>
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
           RENTABILIDAD POR PRODUCTO — tabla con search + sort
         ═══════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}
        className="rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-5 pb-4 border-b border-gray-50 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 dark:bg-emerald-950/30 p-2">
              <Sparkles size={16} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Rentabilidad por producto</h2>
              <p className="text-[11px] text-gray-400">Margen calculado desde receta · Click para desglose</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 sm:flex-initial">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar producto..."
                value={rentaSearch}
                onChange={(e) => setRentaSearch(e.target.value)}
                className="w-full sm:w-44 rounded-lg border border-gray-200 bg-white dark:bg-zinc-800 pl-7 pr-2 py-1.5 text-[11px] outline-none focus:border-loga-red transition-colors"
              />
            </div>
            {/* Tabs filtro */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 dark:bg-zinc-800 p-1">
              {([
                { v: 'todos',              l: 'Todos',    color: 'bg-gray-700' },
                { v: 'producto_fabricado', l: 'Granel',   color: 'bg-loga-red' },
                { v: 'producto_envasado',  l: 'Envasado', color: 'bg-emerald-600' },
              ] as const).map(({ v, l, color }) => {
                const count = v === 'todos' ? data.rentabilidad.length : data.rentabilidad.filter(r => r.tipo === v).length;
                return (
                  <button
                    key={v}
                    onClick={() => setRentaTab(v)}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all',
                      rentaTab === v ? `${color} text-white shadow-sm` : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-zinc-700'
                    )}
                  >
                    {l}
                    <span className={clsx('rounded-md px-1 py-0.5 text-[9px] font-black tabular-nums',
                      rentaTab === v ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-gray-400')}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-white/5 text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Producto</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Tipo</th>
                <SortableHeader label="Precio venta" active={rentaSort.key === 'venta'} dir={rentaSort.dir} onClick={() => ordenarPor('venta')} />
                <SortableHeader label="Precio coste" active={rentaSort.key === 'coste'} dir={rentaSort.dir} onClick={() => ordenarPor('coste')} />
                <SortableHeader label="Margen %" active={rentaSort.key === 'margen'} dir={rentaSort.dir} onClick={() => ordenarPor('margen')} />
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Variación</th>
                <SortableHeader label="Beneficio/ud" active={rentaSort.key === 'beneficio'} dir={rentaSort.dir} onClick={() => ordenarPor('beneficio')} />
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-50 dark:divide-white/5">
              {rentabilidadFiltrada.map(r => {
                const margen = parseFloat(String(r.margen_pct));
                const margenColor = margen < 20 ? 'text-loga-red bg-red-50 dark:bg-red-950/30 ring-red-200/50'
                                  : margen < 40 ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-amber-200/50'
                                  : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-200/50';
                const tipoLabel = r.tipo === 'producto_fabricado' ? 'Granel' : r.tipo === 'producto_envasado' ? 'Envasado' : 'Prod.';
                const tipoCls = r.tipo === 'producto_fabricado' ? 'bg-loga-red/10 text-loga-red' : 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400';
                const isOpen = desgloseId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className={clsx(
                        'transition-colors cursor-pointer',
                        isOpen ? 'bg-gray-50 dark:bg-zinc-800/50' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/30'
                      )}
                      onClick={() => setDesgloseId(isOpen ? null : r.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronDown size={12} className={clsx('text-gray-400 transition-transform', isOpen && 'rotate-180')} />
                          <div>
                            <p className="text-xs font-bold text-gray-900 dark:text-white">{r.nombre}</p>
                            <p className="text-[10px] text-gray-400 font-mono">{r.codigo}</p>
                            {r.precio_kg != null && (
                              <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">
                                {fmt(r.precio_kg)} EUR/kg · {fmt(r.precio_1000kg ?? 0)}/1000kg
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tipoCls)}>
                          {tipoLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-gray-700 dark:text-gray-300 font-semibold">
                        {fmt(r.precio_venta)} <span className="text-gray-400 font-normal">EUR/{r.unidad_medida}</span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-gray-700 dark:text-gray-300">
                        <p className="font-semibold">{fmt(r.precio_coste)} <span className="text-gray-400 font-normal">EUR/{r.unidad_medida}</span></p>
                        {r.coste_batch != null && r.rendimiento != null && r.rendimiento > 1 && (
                          <p className="text-[10px] text-gray-400">Batch {r.rendimiento} {r.unidad_medida}: {fmt(r.coste_batch)} EUR</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black tabular-nums ring-1', margenColor)}>
                          {margen.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.diff_margen != null && r.diff_margen !== 0 ? (
                          <div className="relative group">
                            <span className={clsx(
                              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums',
                              r.diff_margen > 0 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'text-loga-red bg-red-50 dark:bg-red-950/30'
                            )}>
                              {r.diff_margen > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                              {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                            </span>
                            {r.salud && (
                              <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-20 w-56 px-3 py-2 rounded-xl shadow-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-[10px] text-gray-600 dark:text-gray-400 font-normal whitespace-normal">
                                <span className={clsx('inline-block w-2 h-2 rounded-full mr-1.5 align-middle', r.diff_margen > 0 ? 'bg-emerald-500' : 'bg-red-500')} />
                                {r.salud}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums font-black text-gray-900 dark:text-white">
                        {fmt(r.beneficio_ud)} <span className="text-gray-400 font-normal text-[10px]">EUR</span>
                      </td>
                    </tr>
                    {/* Desglose expandible */}
                    <AnimatePresence>
                      {isOpen && r.desglose && r.desglose.length > 0 && (
                        <tr>
                          <td colSpan={7} className="px-0 py-0 bg-gradient-to-b from-gray-50 to-white dark:from-zinc-800/50 dark:to-zinc-900">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                              className="px-6 py-4"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Layers size={11} className="text-gray-400" />
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Desglose de coste</p>
                              </div>
                              <div className="rounded-lg border border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-900 overflow-hidden">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-gray-400 text-[10px] uppercase tracking-wider bg-gray-50 dark:bg-zinc-800/50">
                                      <th className="text-left py-2 px-3 font-bold">Ingrediente</th>
                                      <th className="text-right py-2 px-3 font-bold">Cantidad</th>
                                      <th className="text-right py-2 px-3 font-bold">Precio/ud</th>
                                      <th className="text-right py-2 px-3 font-bold">Coste línea</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                                    {r.desglose.map((d, i) => (
                                      <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30">
                                        <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300 font-medium">{d.nombre}</td>
                                        <td className="py-1.5 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                                          {d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} <span className="text-gray-400">{d.unidad}</span>
                                        </td>
                                        <td className="py-1.5 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                                          {fmt(d.precio_ud)} <span className="text-gray-400">EUR/{d.unidad}</span>
                                        </td>
                                        <td className="py-1.5 px-3 text-right tabular-nums font-bold text-gray-900 dark:text-white">{fmt(d.coste_linea)} EUR</td>
                                      </tr>
                                    ))}
                                    <tr className="border-t-2 border-gray-200 dark:border-white/10 font-bold bg-gray-50 dark:bg-zinc-800/50">
                                      <td className="py-2 px-3 text-gray-800 dark:text-gray-200" colSpan={3}>
                                        Total batch{r.rendimiento && r.rendimiento > 1 ? ` (${r.rendimiento} ${r.unidad_medida})` : ''}
                                      </td>
                                      <td className="py-2 px-3 text-right tabular-nums text-gray-900 dark:text-white">{fmt(r.coste_batch ?? r.precio_coste)} EUR</td>
                                    </tr>
                                    {r.rendimiento && r.rendimiento > 1 && (
                                      <tr className="font-bold text-loga-red bg-red-50/50 dark:bg-red-950/20">
                                        <td className="py-2 px-3" colSpan={3}>Coste por {r.unidad_medida}</td>
                                        <td className="py-2 px-3 text-right tabular-nums">{fmt(r.precio_coste)} EUR</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}
              {rentabilidadFiltrada.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Package size={28} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400">{rentaSearch ? 'Sin resultados para esta búsqueda' : 'Sin productos con precios'}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* ═══════════════════════════════════════════════════════════════
           TOP 10 VENTAS POR PRODUCTO
         ═══════════════════════════════════════════════════════════════ */}
      {data.ventasProducto.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          className="rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="rounded-xl bg-blue-100 dark:bg-blue-950/30 p-2">
              <TrendingUp size={16} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Top productos por ventas</h2>
              <p className="text-[11px] text-gray-400">Pedidos completados · Precio efectivo del momento de la venta</p>
            </div>
          </div>

          <div className="p-5 space-y-2">
            {data.ventasProducto.map((v, i) => {
              const fact = parseFloat(String(v.facturacion));
              const cantidad = parseFloat(String(v.cantidad_vendida));
              const maxFact = parseFloat(String(data.ventasProducto[0]?.facturacion ?? 1));
              const pct = maxFact > 0 ? (fact / maxFact) * 100 : 0;
              const precioEfectivo = cantidad > 0 ? fact / cantidad : 0;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.04 }}
                  className="group rounded-xl border border-gray-100 dark:border-white/5 bg-gradient-to-r from-white to-gray-50/30 dark:from-zinc-900 dark:to-zinc-800/30 p-3 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/40 dark:to-indigo-950/40 text-xs font-black text-blue-700 dark:text-blue-400 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{v.nombre}</p>
                        <span className="text-[10px] text-gray-400 font-mono">{v.codigo}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                        <span><b className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtInt(cantidad)}</b> {v.unidad_medida}</span>
                        <span className="text-gray-300">·</span>
                        <span><b className="text-gray-700 dark:text-gray-300 tabular-nums">{fmt(precioEfectivo)}</b> EUR/{v.unidad_medida} efectivo</span>
                      </div>
                      <div className="mt-1.5 h-1 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ delay: 1 + i * 0.04, duration: 0.6 }}
                          className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full"
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-gray-900 dark:text-white tabular-nums">{fmt(fact)}</p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">EUR Total</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════════════
           IMPACTO PRECIOS — Cards expandibles
         ═══════════════════════════════════════════════════════════════ */}
      {impactoRecetas.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}
          className="rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="rounded-xl bg-purple-100 dark:bg-purple-950/30 p-2">
              <Activity size={16} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Impacto de precios en rentabilidad</h2>
              <p className="text-[11px] text-gray-400">Variación de margen real (PVP + coste anterior vs actual)</p>
            </div>
          </div>

          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {impactoRecetas.map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const diffPositivo = r.diff_margen > 0;
              const diffNegativo = r.diff_margen < 0;
              const pvpCambio = r.pvp_anterior && r.pvp_actual && Math.abs(r.pvp_actual - r.pvp_anterior) > 0.01;
              const margenColor = r.margen_actual > 40 ? 'text-emerald-600 dark:text-emerald-400'
                                : r.margen_actual > 20 ? 'text-amber-600 dark:text-amber-400'
                                : 'text-loga-red';
              return (
                <div key={r.receta_nombre}>
                  <button
                    onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)}
                    className={clsx(
                      'w-full px-5 py-4 flex items-center justify-between text-left transition-colors',
                      expanded ? 'bg-gray-50 dark:bg-zinc-800/50' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/30'
                    )}
                  >
                    <div className="min-w-0 flex items-start gap-3">
                      <div className={clsx(
                        'mt-1 w-2 h-2 rounded-full shrink-0',
                        diffNegativo ? 'bg-red-500 ring-2 ring-red-200 dark:ring-red-900/50'
                          : diffPositivo ? 'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900/50'
                          : 'bg-gray-300'
                      )} />
                      <div>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{r.producto_nombre}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          <span className="font-semibold">{r.receta_nombre}</span>
                          {r.pvp_actual !== undefined && (
                            <span className="ml-2">
                              · PVP: <b className="text-gray-600 dark:text-gray-300 tabular-nums">{r.pvp_actual.toFixed(2)} EUR/{r.unidad_medida}</b>
                              {pvpCambio && (
                                <span className="ml-1 text-blue-500 dark:text-blue-400 text-[10px]">
                                  (ant: {r.pvp_anterior?.toFixed(2)})
                                </span>
                              )}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Coste/{r.unidad_medida}</p>
                        <p className="text-xs font-black text-gray-900 dark:text-white tabular-nums mt-0.5">{r.coste_actual.toFixed(4)}</p>
                        {r.diff_coste !== 0 && (
                          <p className={clsx('text-[10px] font-bold tabular-nums', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')}>
                            {r.diff_coste > 0 ? '+' : ''}{r.diff_coste.toFixed(4)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Margen</p>
                        <p className={clsx('text-base font-black tabular-nums mt-0.5', margenColor)}>
                          {r.margen_actual.toFixed(1)}%
                        </p>
                        {r.diff_margen !== 0 && (
                          <p className={clsx('inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums', diffNegativo ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')}>
                            {diffPositivo ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                          </p>
                        )}
                      </div>
                      <ChevronDown size={14} className={clsx('text-gray-400 transition-transform', expanded && 'rotate-180')} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {expanded && r.detalle_mp.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                        className="px-5 pb-4 bg-gray-50/30 dark:bg-zinc-800/20"
                      >
                        {r.salud && (
                          <div className={clsx(
                            'mb-3 px-3 py-2 rounded-xl text-[11px] font-medium flex items-start gap-2',
                            diffNegativo ? 'bg-red-50 dark:bg-red-950/30 text-loga-red'
                              : diffPositivo ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-gray-50 dark:bg-zinc-800 text-gray-500'
                          )}>
                            <Sparkles size={11} className="shrink-0 mt-0.5" />
                            <span>
                              {r.salud}
                              {pvpCambio && <span className="ml-2 text-blue-500 dark:text-blue-400 font-normal">PVP: {r.pvp_anterior?.toFixed(2)} → {r.pvp_actual?.toFixed(2)}</span>}
                            </span>
                          </div>
                        )}
                        <div className="rounded-lg border border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-900 overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-gray-400 text-[10px] uppercase tracking-wider bg-gray-50 dark:bg-zinc-800/50">
                                <th className="text-left py-2 px-3 font-bold">Ingrediente</th>
                                <th className="text-right py-2 px-3 font-bold">Precio anterior</th>
                                <th className="text-right py-2 px-3 font-bold">Precio actual</th>
                                <th className="text-right py-2 px-3 font-bold">Impacto/batch</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                              {r.detalle_mp.map((mp, i) => (
                                <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/30">
                                  <td className="py-1.5 px-3 text-gray-700 dark:text-gray-300 font-medium">
                                    {mp.nombre} <span className="text-gray-400 text-[10px] font-normal">({mp.cantidad.toFixed(2)})</span>
                                  </td>
                                  <td className="py-1.5 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{mp.precio_anterior?.toFixed(4) ?? '—'}</td>
                                  <td className="py-1.5 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-200">{mp.precio_actual.toFixed(4)}</td>
                                  <td className={clsx(
                                    'py-1.5 px-3 text-right font-black tabular-nums',
                                    mp.diff > 0 ? 'text-loga-red' : mp.diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'
                                  )}>
                                    {mp.diff !== 0 ? `${mp.diff > 0 ? '+' : ''}${mp.diff.toFixed(2)} EUR` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ═══════════════════════════════════════════════════════════════
           PRECIOS MATERIAS PRIMAS — Heatmap visual
         ═══════════════════════════════════════════════════════════════ */}
      {mpPrecios.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
          className="rounded-2xl border border-gray-100 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center gap-3 p-5 pb-3 border-b border-gray-50 dark:border-white/5">
            <div className="rounded-xl bg-orange-100 dark:bg-orange-950/30 p-2">
              <Beaker size={16} className="text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Precios de materias primas</h2>
              <p className="text-[11px] text-gray-400">Variaciones últimos 90 días</p>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...mpPrecios]
                .sort((a, b) => parseFloat(b.variacion_pct) - parseFloat(a.variacion_pct))
                .map((item, i) => {
                  const variacion = parseFloat(item.variacion_pct);
                  const intensity = Math.min(Math.abs(variacion) / 30, 1); // satura a 30%
                  const bgIntensity = 0.05 + intensity * 0.15;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.85 + i * 0.03 }}
                      className="rounded-xl border border-gray-100 dark:border-white/5 p-3 hover:shadow-md transition-all relative overflow-hidden"
                      style={{
                        backgroundColor: variacion > 0
                          ? `rgba(239, 68, 68, ${bgIntensity})`
                          : variacion < 0
                          ? `rgba(16, 185, 129, ${bgIntensity})`
                          : undefined,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{item.nombre}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{item.codigo}</p>
                        </div>
                        {item.precio_anterior && variacion !== 0 && (
                          <span className={clsx(
                            'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums shrink-0',
                            variacion > 0 ? 'bg-red-100 dark:bg-red-950/40 text-loga-red' : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                          )}>
                            {variacion > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                            {variacion > 0 ? '+' : ''}{variacion.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-[10px]">
                        <div>
                          <p className="text-gray-400">Anterior</p>
                          <p className="font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                            {item.precio_anterior ? parseFloat(item.precio_anterior).toFixed(4) : '—'}
                          </p>
                        </div>
                        <ArrowUpRight size={11} className="text-gray-300 rotate-90" />
                        <div className="text-right">
                          <p className="text-gray-400">Actual</p>
                          <p className="font-black tabular-nums text-gray-900 dark:text-white">
                            {parseFloat(item.precio_actual).toFixed(4)} <span className="text-gray-400 font-normal">{item.unidad_medida}</span>
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
            </div>
          </div>
        </motion.section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Componente helper: Header sortable de columna
// ═══════════════════════════════════════════════════════════════════════
function SortableHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <th className="px-4 py-3 text-left">
      <button
        onClick={onClick}
        className={clsx(
          'inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider transition-colors',
          active ? 'text-loga-red' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        )}
      >
        {label}
        <ChevronDown
          size={10}
          className={clsx('transition-all', active ? 'opacity-100' : 'opacity-30', active && dir === 'asc' && 'rotate-180')}
        />
      </button>
    </th>
  );
}
