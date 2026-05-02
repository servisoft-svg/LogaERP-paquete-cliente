import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, ArrowUpRight, ArrowDownRight, Search, ChevronDown, ChevronRight,
  AlertTriangle, TrendingUp, DollarSign, Factory, Warehouse,
  Sparkles, Activity, Package, Layers, Zap, Box, Beaker, Receipt, FileSpreadsheet,
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

// ── Helpers ─────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 0 });
const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + 'M';
  if (n >= 1_000) return (n / 1_000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'K';
  return n.toLocaleString('es-ES', { maximumFractionDigits: 0 });
};
const MONO = { fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace' };

// ── Sparkline ───────────────────────────────────────────────────────
function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const W = 100;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = height - ((v - min) / range) * height * 0.9 - height * 0.05;
    return { x, y };
  });
  const linePath = points.reduce((acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`), '');
  const areaPath = `${linePath} L${W},${height} L0,${height} Z`;
  const id = `spark-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full overflow-visible" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && (
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2.5" fill={color} />
      )}
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

  const beneficioBruto = useMemo(() => (data ? data.ventas.facturacion_total - data.costeProd.coste_total : 0), [data]);
  const margenPct = useMemo(() => (data && data.ventas.facturacion_total > 0 ? (beneficioBruto / data.ventas.facturacion_total) * 100 : 0), [data, beneficioBruto]);
  const maxMes = useMemo(() => (data ? Math.max(...data.ventasMes.map(v => parseFloat(String(v.total))), 1) : 1), [data]);
  const minMes = useMemo(() => (data ? Math.min(...data.ventasMes.map(v => parseFloat(String(v.total))), 0) : 0), [data]);
  const avgMes = useMemo(() => {
    if (!data || data.ventasMes.length === 0) return 0;
    return data.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0) / data.ventasMes.length;
  }, [data]);
  const sparkVentas = useMemo(() => data?.ventasMes.map(m => parseFloat(String(m.total))) ?? [], [data]);

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

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <AlertTriangle size={32} className="mx-auto text-zinc-400" />
          <p className="text-zinc-500 text-sm">Acceso restringido a administradores</p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;
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

  return (
    <div className="animate-fade-in space-y-6 pb-12">

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  HEADER COMPACTO con acciones agrupadas                  ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-loga-red/30 blur-xl rounded-full" />
            <div className="relative rounded-xl bg-gradient-to-br from-loga-red to-red-700 p-2.5 shadow-lg shadow-red-500/20">
              <Activity size={18} className="text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Finanzas</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20">
                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">Datos en tiempo real · {data.ventas.num_pedidos} pedidos completados</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            { tipo: 'pedidos',     label: 'Pedidos',    icon: Receipt },
            { tipo: 'produccion',  label: 'Producción', icon: Factory },
            { tipo: 'inventario',  label: 'Inventario', icon: Box },
          ].map(({ tipo, label, icon: Icon }) => (
            <button key={tipo} onClick={() => exportar(tipo)}
              className="group relative inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:border-loga-red hover:text-loga-red dark:hover:border-loga-red transition-all">
              <Icon size={12} />
              {label}
              <Download size={10} className="opacity-0 group-hover:opacity-100 transition-opacity -ml-0.5" />
            </button>
          ))}
          <div className="inline-flex items-center rounded-lg overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/15 dark:to-emerald-500/10">
            <select id="plastico-year" defaultValue={new Date().getFullYear()}
              className="bg-transparent px-2 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 outline-none border-r border-emerald-500/30">
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-all">
              <FileSpreadsheet size={12} />
              Plástico Ley 7/2022
            </button>
          </div>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  KPI HERO — 4 cards premium con sparklines y glow        ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Facturación',
            value: data.ventas.facturacion_total,
            sub: `${fmtInt(data.ventas.num_pedidos)} pedidos`,
            icon: DollarSign,
            color: '#10b981',
            colorClass: 'emerald',
            spark: sparkVentas,
          },
          {
            label: 'Coste producción',
            value: data.costeProd.coste_total,
            sub: `${fmtInt(data.costeProd.num_ordenes)} órdenes`,
            icon: Factory,
            color: '#f59e0b',
            colorClass: 'amber',
            spark: undefined,
          },
          {
            label: 'Beneficio bruto',
            value: beneficioBruto,
            sub: `${margenPct.toFixed(1)}% margen`,
            icon: TrendingUp,
            color: beneficioBruto >= 0 ? '#3b82f6' : '#FF0000',
            colorClass: beneficioBruto >= 0 ? 'blue' : 'red',
            spark: undefined,
          },
          {
            label: 'Inmovilizado',
            value: data.inmovilizado.valor_total,
            sub: 'Stock total',
            icon: Warehouse,
            color: '#8b5cf6',
            colorClass: 'violet',
            spark: undefined,
          },
        ].map((card, i) => (
          <motion.article
            key={card.label}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -3 }}
            className="group relative rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-5 overflow-hidden transition-all hover:border-zinc-300 dark:hover:border-white/20 hover:shadow-xl"
          >
            {/* Glow on hover */}
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-0 group-hover:opacity-100 blur-3xl transition-opacity duration-500 pointer-events-none"
              style={{ backgroundColor: card.color }}
            />

            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${card.color}, transparent)` }} />

            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">{card.label}</p>
                <div
                  className="rounded-lg p-1.5 ring-1 transition-transform group-hover:scale-110 group-hover:rotate-3"
                  style={{ backgroundColor: `${card.color}15`, color: card.color, '--tw-ring-color': `${card.color}30` } as React.CSSProperties}
                >
                  <card.icon size={13} strokeWidth={2.5} />
                </div>
              </div>

              <p className="text-3xl font-bold text-zinc-900 dark:text-white tabular-nums tracking-tight leading-none mb-1" style={MONO}>
                {fmtCompact(card.value)}
              </p>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">EUR</p>

              <div className="flex items-end justify-between gap-2 pt-3 border-t border-zinc-100 dark:border-white/5">
                <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{card.sub}</p>
                {card.spark && card.spark.length > 1 && (
                  <div className="w-20 -mb-1">
                    <Sparkline values={card.spark} color={card.color} height={28} />
                  </div>
                )}
              </div>
            </div>
          </motion.article>
        ))}
      </section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  MÉTRICAS OPERATIVAS — banda con icon-mini               ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {[
          {
            label: 'Ticket medio', icon: Receipt,
            value: data.ventas.num_pedidos > 0 ? fmt(data.ventas.facturacion_total / data.ventas.num_pedidos) : '0',
            unit: 'EUR/pedido', color: '#8b5cf6',
          },
          {
            label: 'Coste medio/orden', icon: Factory,
            value: data.costeProd.num_ordenes > 0 ? fmt(data.costeProd.coste_total / data.costeProd.num_ordenes) : '0',
            unit: 'EUR/orden', color: '#f59e0b',
          },
          {
            label: 'Producción rechazada', icon: AlertTriangle,
            value: fmtCompact(data.rechazos.valor_rechazado),
            unit: `${data.rechazos.ordenes_canceladas} órd · ${data.rechazos.lotes_rechazados} lotes`,
            color: '#FF0000',
          },
          {
            label: 'Mermas producción', icon: Beaker,
            value: `${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')} kg`,
            unit: `${fmt(data.mermas?.total_eur ?? 0)} EUR perdidos`,
            color: '#f59e0b',
          },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.05 }}
            className="group relative rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-3.5 overflow-hidden hover:shadow-lg transition-all"
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-1 transition-all group-hover:w-1.5"
              style={{ backgroundColor: m.color }}
            />
            <div className="flex items-start justify-between mb-2 pl-1">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.12em] flex-1">{m.label}</p>
              <m.icon size={12} style={{ color: m.color }} strokeWidth={2.5} />
            </div>
            <p className="pl-1 text-xl font-bold text-zinc-900 dark:text-white tabular-nums leading-tight" style={MONO}>{m.value}</p>
            <p className="pl-1 text-[10px] text-zinc-500 mt-0.5 truncate">{m.unit}</p>
          </motion.div>
        ))}
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  EVOLUCIÓN DE VENTAS — chart de líneas premium           ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasMes.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-loga-red/10 to-red-500/5 p-2 ring-1 ring-loga-red/20">
                <TrendingUp size={14} className="text-loga-red" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Evolución de ventas</h2>
                <p className="text-[11px] text-zinc-500">{data.ventasMes.length} meses · pedidos completados</p>
              </div>
            </div>

            {/* Stats inline */}
            <div className="hidden md:flex items-center gap-5 text-right">
              <div>
                <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Pico</p>
                <p className="text-sm font-bold text-zinc-900 dark:text-white tabular-nums" style={MONO}>{fmtCompact(maxMes)}</p>
              </div>
              <div className="w-px h-8 bg-zinc-200 dark:bg-white/10" />
              <div>
                <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Media</p>
                <p className="text-sm font-bold text-zinc-900 dark:text-white tabular-nums" style={MONO}>{fmtCompact(avgMes)}</p>
              </div>
              <div className="w-px h-8 bg-zinc-200 dark:bg-white/10" />
              <div>
                <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Total</p>
                <p className="text-sm font-bold text-loga-red tabular-nums" style={MONO}>{fmtCompact(data.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0))}</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <PremiumChart data={data.ventasMes} maxMes={maxMes} minMes={minMes} avgMes={avgMes} />
          </div>
        </motion.section>
      )}

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  RENTABILIDAD POR PRODUCTO                                ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
        className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-2 ring-1 ring-emerald-500/20">
              <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Rentabilidad por producto</h2>
              <p className="text-[11px] text-zinc-500">Coste recursivo desde receta · Click para desglose</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 sm:flex-initial">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={rentaSearch}
                onChange={(e) => setRentaSearch(e.target.value)}
                className="w-full sm:w-40 rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/50 pl-7 pr-2 py-1.5 text-[11px] outline-none focus:border-loga-red focus:bg-white dark:focus:bg-zinc-800 transition-all"
              />
            </div>
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/50 p-0.5">
              {([
                { v: 'todos', l: 'Todos', c: 'bg-zinc-700' },
                { v: 'producto_fabricado', l: 'Granel', c: 'bg-loga-red' },
                { v: 'producto_envasado', l: 'Envasado', c: 'bg-emerald-600' },
              ] as const).map(({ v, l, c }) => {
                const count = v === 'todos' ? data.rentabilidad.length : data.rentabilidad.filter(r => r.tipo === v).length;
                const active = rentaTab === v;
                return (
                  <button key={v} onClick={() => setRentaTab(v)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all',
                      active ? `${c} text-white shadow-sm` : 'text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-700'
                    )}>
                    {l}
                    <span className={clsx('rounded px-1 py-0.5 text-[9px] font-black tabular-nums',
                      active ? 'bg-white/20 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                    )}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-50/80 dark:bg-zinc-800/30">
              <tr className="text-[10px] uppercase tracking-[0.12em] font-bold text-zinc-500">
                <th className="text-left py-3 px-5">Producto</th>
                <SortHeader label="Venta"      active={rentaSort.key === 'venta'}    dir={rentaSort.dir} onClick={() => ordenarPor('venta')} />
                <SortHeader label="Coste"      active={rentaSort.key === 'coste'}    dir={rentaSort.dir} onClick={() => ordenarPor('coste')} />
                <SortHeader label="Margen"     active={rentaSort.key === 'margen'}   dir={rentaSort.dir} onClick={() => ordenarPor('margen')} />
                <th className="text-right py-3 px-3">Δ</th>
                <SortHeader label="Beneficio"  active={rentaSort.key === 'beneficio'} dir={rentaSort.dir} onClick={() => ordenarPor('beneficio')} pad="right-5" />
              </tr>
            </thead>
            <tbody>
              {rentabilidadFiltrada.map((r, i) => {
                const margen = parseFloat(String(r.margen_pct));
                const isOpen = desgloseId === r.id;
                const margenStyle = margen < 20
                  ? { bg: 'bg-loga-red/10', text: 'text-loga-red', dot: 'bg-loga-red', ring: 'ring-loga-red/30' }
                  : margen < 40
                  ? { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', ring: 'ring-amber-500/30' }
                  : { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', ring: 'ring-emerald-500/30' };
                const tipoColor = r.tipo === 'producto_fabricado' ? '#FF0000' : '#10b981';
                return (
                  <React.Fragment key={r.id}>
                    <motion.tr
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                      onClick={() => setDesgloseId(isOpen ? null : r.id)}
                      className={clsx(
                        'border-b border-zinc-100 dark:border-white/5 cursor-pointer group transition-colors',
                        isOpen ? 'bg-zinc-50 dark:bg-zinc-800/40' : 'hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20'
                      )}
                    >
                      <td className="py-3 px-5">
                        <div className="flex items-start gap-2.5">
                          <ChevronRight size={11} className={clsx('mt-1 text-zinc-300 transition-transform shrink-0', isOpen && 'rotate-90 text-loga-red')} />
                          <span className={clsx('mt-1 w-1.5 h-1.5 rounded-full shrink-0', margenStyle.dot)} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{r.nombre}</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-1.5">
                              <span className="font-mono">{r.codigo}</span>
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                                style={{ color: tipoColor, backgroundColor: `${tipoColor}15` }}>
                                {r.tipo === 'producto_fabricado' ? 'Granel' : 'Envasado'}
                              </span>
                              {r.precio_kg != null && (
                                <span className="text-blue-500 dark:text-blue-400">· {fmt(r.precio_kg)} EUR/kg</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <p className="text-xs font-medium text-zinc-900 dark:text-white tabular-nums" style={MONO}>{fmt(r.precio_venta)}</p>
                        <p className="text-[9px] text-zinc-400">EUR/{r.unidad_medida}</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 tabular-nums" style={MONO}>{fmt(r.precio_coste)}</p>
                        <p className="text-[9px] text-zinc-400">EUR/{r.unidad_medida}</p>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold tabular-nums ring-1', margenStyle.bg, margenStyle.text, margenStyle.ring)} style={MONO}>
                          {margen.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {r.diff_margen != null && r.diff_margen !== 0 ? (
                          <span className={clsx(
                            'inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums',
                            r.diff_margen > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-loga-red'
                          )} style={MONO}>
                            {r.diff_margen > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}
                          </span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <p className="text-xs font-bold text-zinc-900 dark:text-white tabular-nums" style={MONO}>{fmt(r.beneficio_ud)}</p>
                        <p className="text-[9px] text-zinc-400">EUR/ud</p>
                      </td>
                    </motion.tr>
                    <AnimatePresence>
                      {isOpen && r.desglose && r.desglose.length > 0 && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                              className="bg-gradient-to-r from-zinc-50 via-white to-zinc-50 dark:from-zinc-800/50 dark:via-zinc-900 dark:to-zinc-800/50 border-y border-zinc-200 dark:border-white/10"
                            >
                              <div className="px-8 py-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Layers size={11} className="text-loga-red" />
                                  <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-zinc-500">Desglose de coste</p>
                                </div>
                                <div className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden">
                                  <table className="w-full text-[11px]">
                                    <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                                      <tr>
                                        <th className="text-left py-2 px-3">Ingrediente</th>
                                        <th className="text-right py-2 px-3">Cantidad</th>
                                        <th className="text-right py-2 px-3">Precio</th>
                                        <th className="text-right py-2 px-3">Coste línea</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                      {r.desglose.map((d, j) => (
                                        <tr key={j} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                                          <td className="py-1.5 px-3 text-zinc-700 dark:text-zinc-300 font-medium">{d.nombre}</td>
                                          <td className="py-1.5 px-3 text-right tabular-nums text-zinc-500" style={MONO}>{d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {d.unidad}</td>
                                          <td className="py-1.5 px-3 text-right tabular-nums text-zinc-500" style={MONO}>{fmt(d.precio_ud)}</td>
                                          <td className="py-1.5 px-3 text-right tabular-nums font-bold text-zinc-900 dark:text-white" style={MONO}>{fmt(d.coste_linea)}</td>
                                        </tr>
                                      ))}
                                      <tr className="bg-zinc-50 dark:bg-zinc-800/40 border-t-2 border-zinc-300 dark:border-white/20 font-bold">
                                        <td className="py-2 px-3 text-zinc-800 dark:text-zinc-200" colSpan={3}>
                                          Total batch{r.rendimiento && r.rendimiento > 1 ? ` (${r.rendimiento} ${r.unidad_medida})` : ''}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-zinc-900 dark:text-white" style={MONO}>{fmt(r.coste_batch ?? r.precio_coste)} EUR</td>
                                      </tr>
                                      {r.rendimiento && r.rendimiento > 1 && (
                                        <tr className="bg-loga-red/5 font-bold text-loga-red">
                                          <td className="py-2 px-3" colSpan={3}>Coste por {r.unidad_medida}</td>
                                          <td className="py-2 px-3 text-right tabular-nums" style={MONO}>{fmt(r.precio_coste)} EUR</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
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
                <tr><td colSpan={6} className="py-12 text-center">
                  <Package size={28} className="mx-auto text-zinc-300 mb-2" />
                  <p className="text-xs text-zinc-400">{rentaSearch ? 'Sin resultados' : 'Sin productos'}</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  INVENTARIO — donut + top 10 (5+7 cols)                  ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Distribución (5 cols) */}
        <motion.div
          initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
          className="lg:col-span-5 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="rounded-xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 p-2 ring-1 ring-violet-500/20">
              <Package size={14} className="text-violet-600 dark:text-violet-400" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Distribución inventario</h2>
              <p className="text-[11px] text-zinc-500">Por categoría</p>
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Donut */}
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
                        <motion.circle
                          key={i}
                          cx="18" cy="18" r="14" fill="none" stroke={item.color} strokeWidth="5"
                          strokeLinecap="round"
                          initial={{ strokeDasharray: '0 100' }}
                          animate={{ strokeDasharray: `${pct} ${100 - pct}` }}
                          transition={{ delay: 0.6 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                          strokeDashoffset={`-${offset}`}
                          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))' }}
                        />
                      );
                      offset += pct;
                      return el;
                    });
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums leading-none" style={MONO}>{fmtCompact(data.inmovilizado.valor_total)}</p>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mt-1">EUR Total</p>
                </div>
              </div>

              {/* Legend */}
              <div className="flex-1 w-full space-y-2.5">
                {([
                  { label: 'Materia prima', value: data.inmovilizado.valor_mp,  color: '#3b82f6', icon: Beaker },
                  { label: 'Fabricado',     value: data.inmovilizado.valor_fab, color: '#FF0000', icon: Zap },
                  { label: 'Envasado',      value: data.inmovilizado.valor_env, color: '#10b981', icon: Package },
                  { label: 'Embalaje',      value: data.inmovilizado.valor_emb, color: '#f59e0b', icon: Box },
                ]).map(({ label, value, color, icon: Icon }, i) => {
                  const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                  return (
                    <motion.div
                      key={label}
                      initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.05 }}
                      className="group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="rounded-md p-1" style={{ backgroundColor: `${color}15` }}>
                          <Icon size={9} style={{ color }} strokeWidth={2.5} />
                        </div>
                        <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 flex-1">{label}</span>
                        <span className="text-[11px] font-bold tabular-nums text-zinc-900 dark:text-white" style={MONO}>{fmtCompact(value)}</span>
                        <span className="text-[10px] tabular-nums text-zinc-400 w-10 text-right font-bold">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.9 + i * 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: color }}
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Top 10 (7 cols) */}
        <motion.div
          initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 }}
          className="lg:col-span-7 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-2 ring-1 ring-amber-500/20">
                <Layers size={14} className="text-amber-600 dark:text-amber-400" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Top inmovilizado</h2>
                <p className="text-[11px] text-zinc-500">Productos con más valor en stock</p>
              </div>
            </div>
            <span className="rounded-full bg-amber-500/10 dark:bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/20">
              {data.topInmovilizado.length}
            </span>
          </div>

          <div className="p-3 space-y-1">
            {data.topInmovilizado.slice(0, 10).map((p, i) => {
              const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
              const val = parseFloat(String(p.valor));
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              const tipoConfig = p.tipo === 'producto_fabricado'
                ? { color: '#FF0000', label: 'Granel', icon: Zap }
                : p.tipo === 'producto_envasado'
                ? { color: '#10b981', label: 'Envasado', icon: Package }
                : p.tipo === 'materia_prima'
                ? { color: '#3b82f6', label: 'MP', icon: Beaker }
                : { color: '#f59e0b', label: 'Embalaje', icon: Box };
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.65 + i * 0.04 }}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] font-black text-zinc-500 dark:text-zinc-400 shrink-0 tabular-nums" style={MONO}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="rounded-md p-1 shrink-0" style={{ backgroundColor: `${tipoConfig.color}15` }}>
                    <tipoConfig.icon size={10} style={{ color: tipoConfig.color }} strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">{p.nombre}</p>
                      <p className="text-xs font-bold text-zinc-900 dark:text-white tabular-nums shrink-0" style={MONO}>{fmtCompact(val)} <span className="text-zinc-400 text-[10px] font-normal">EUR</span></p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ delay: 0.85 + i * 0.04, duration: 0.6 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: tipoConfig.color }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums text-zinc-400 w-20 text-right font-medium" style={MONO}>
                        {fmtInt(parseFloat(String(p.stock_actual)))} {p.unidad_medida}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {data.topInmovilizado.length === 0 && (
              <div className="py-8 text-center">
                <Box size={28} className="mx-auto text-zinc-300 mb-2" />
                <p className="text-xs text-zinc-400">Sin datos</p>
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  TOP VENTAS — cards horizontales con bar charts          ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasProducto.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-indigo-500/5 p-2 ring-1 ring-blue-500/20">
              <TrendingUp size={14} className="text-blue-600 dark:text-blue-400" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Top productos por ventas</h2>
              <p className="text-[11px] text-zinc-500">Pedidos completados · Precio efectivo del momento</p>
            </div>
          </div>

          <div className="p-5 space-y-2">
            {data.ventasProducto.map((v, i) => {
              const fact = parseFloat(String(v.facturacion));
              const cantidad = parseFloat(String(v.cantidad_vendida));
              const maxFact = parseFloat(String(data.ventasProducto[0]?.facturacion ?? 1));
              const pct = maxFact > 0 ? (fact / maxFact) * 100 : 0;
              const precioEf = cantidad > 0 ? fact / cantidad : 0;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.04 }}
                  className="group relative rounded-xl border border-zinc-200 dark:border-white/10 bg-gradient-to-r from-white via-white to-blue-50/30 dark:from-zinc-900 dark:via-zinc-900 dark:to-blue-950/10 p-3.5 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500/30 transition-all overflow-hidden"
                >
                  {/* Background bar */}
                  <motion.div
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ delay: 0.8 + i * 0.04, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500/5 to-transparent dark:from-blue-500/10"
                  />

                  <div className="relative flex items-center gap-3.5">
                    <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-black shadow-lg shadow-blue-500/20 shrink-0 tabular-nums" style={MONO}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{v.nombre}</p>
                        <span className="text-[10px] text-zinc-400 font-mono">{v.codigo}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-1">
                          <Package size={10} className="text-zinc-400" />
                          <b className="text-zinc-900 dark:text-white tabular-nums" style={MONO}>{fmtInt(cantidad)}</b>
                          <span className="text-zinc-400">{v.unidad_medida}</span>
                        </span>
                        <span className="text-zinc-300">·</span>
                        <span><b className="text-zinc-700 dark:text-zinc-300 tabular-nums" style={MONO}>{fmt(precioEf)}</b> EUR/{v.unidad_medida}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-blue-600 dark:text-blue-400 tabular-nums leading-none" style={MONO}>{fmtCompact(fact)}</p>
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mt-1">EUR</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  IMPACTO PRECIOS — acordeón                              ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {impactoRecetas.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }}
          className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-fuchsia-500/5 p-2 ring-1 ring-purple-500/20">
              <Activity size={14} className="text-purple-600 dark:text-purple-400" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Impacto de precios en rentabilidad</h2>
              <p className="text-[11px] text-zinc-500">PVP + coste anterior vs actual</p>
            </div>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-white/5">
            {impactoRecetas.map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const diffPositivo = r.diff_margen > 0;
              const diffNegativo = r.diff_margen < 0;
              const pvpCambio = r.pvp_anterior && r.pvp_actual && Math.abs(r.pvp_actual - r.pvp_anterior) > 0.01;
              const margenColor = r.margen_actual > 40 ? 'text-emerald-600 dark:text-emerald-400'
                : r.margen_actual > 20 ? 'text-amber-600 dark:text-amber-400' : 'text-loga-red';
              const dotColor = diffNegativo ? 'bg-loga-red shadow-loga-red/30'
                : diffPositivo ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-zinc-300';
              return (
                <div key={r.receta_nombre}>
                  <button
                    onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)}
                    className={clsx(
                      'w-full px-5 py-3.5 flex items-center justify-between gap-4 text-left transition-colors group',
                      expanded ? 'bg-zinc-50 dark:bg-zinc-800/40' : 'hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20'
                    )}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span className={clsx('mt-1.5 w-2 h-2 rounded-full shadow-md shrink-0', dotColor)} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{r.producto_nombre}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          <span className="font-medium">{r.receta_nombre}</span>
                          {r.pvp_actual !== undefined && (
                            <span> · PVP <b className="text-zinc-700 dark:text-zinc-300 tabular-nums" style={MONO}>{r.pvp_actual.toFixed(2)}</b> EUR/{r.unidad_medida}</span>
                          )}
                          {pvpCambio && (
                            <span className="ml-1 text-blue-500 dark:text-blue-400 text-[10px]">(ant: {r.pvp_anterior?.toFixed(2)})</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Coste/{r.unidad_medida}</p>
                        <p className="text-xs font-bold text-zinc-900 dark:text-white tabular-nums mt-0.5" style={MONO}>{r.coste_actual.toFixed(4)}</p>
                        {r.diff_coste !== 0 && (
                          <p className={clsx('text-[10px] font-bold tabular-nums', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} style={MONO}>
                            {r.diff_coste > 0 ? '+' : ''}{r.diff_coste.toFixed(4)}
                          </p>
                        )}
                      </div>
                      <div className="text-right min-w-[60px]">
                        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Margen</p>
                        <p className={clsx('text-base font-bold tabular-nums mt-0.5', margenColor)} style={MONO}>
                          {r.margen_actual.toFixed(1)}%
                        </p>
                        {r.diff_margen !== 0 && (
                          <p className={clsx('inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums', diffNegativo ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} style={MONO}>
                            {diffPositivo ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                          </p>
                        )}
                      </div>
                      <ChevronDown size={14} className={clsx('text-zinc-400 transition-transform', expanded && 'rotate-180')} />
                    </div>
                  </button>

                  <AnimatePresence>
                    {expanded && r.detalle_mp.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                        className="px-5 pb-4 bg-gradient-to-b from-zinc-50/50 to-transparent dark:from-zinc-800/30"
                      >
                        {r.salud && (
                          <div className={clsx(
                            'mb-3 px-3 py-2 rounded-xl text-[11px] font-medium flex items-start gap-2',
                            diffNegativo ? 'bg-loga-red/10 text-loga-red ring-1 ring-loga-red/20'
                              : diffPositivo ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                          )}>
                            <Sparkles size={11} className="shrink-0 mt-0.5" />
                            <span>
                              {r.salud}
                              {pvpCambio && <span className="ml-2 text-blue-500 dark:text-blue-400 font-normal">PVP: {r.pvp_anterior?.toFixed(2)} → {r.pvp_actual?.toFixed(2)}</span>}
                            </span>
                          </div>
                        )}
                        <div className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-[10px] uppercase tracking-wider font-bold text-zinc-400">
                              <tr>
                                <th className="text-left py-2 px-3">Materia prima</th>
                                <th className="text-right py-2 px-3">Anterior</th>
                                <th className="text-right py-2 px-3">Actual</th>
                                <th className="text-right py-2 px-3">Impacto</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                              {r.detalle_mp.map((mp, i) => (
                                <tr key={i} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                                  <td className="py-1.5 px-3 text-zinc-700 dark:text-zinc-300 font-medium">
                                    {mp.nombre} <span className="text-zinc-400 text-[10px]">({mp.cantidad.toFixed(2)})</span>
                                  </td>
                                  <td className="py-1.5 px-3 text-right tabular-nums text-zinc-500" style={MONO}>{mp.precio_anterior?.toFixed(4) ?? '—'}</td>
                                  <td className="py-1.5 px-3 text-right tabular-nums font-bold text-zinc-800 dark:text-zinc-200" style={MONO}>{mp.precio_actual.toFixed(4)}</td>
                                  <td className={clsx(
                                    'py-1.5 px-3 text-right font-bold tabular-nums',
                                    mp.diff > 0 ? 'text-loga-red' : mp.diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
                                  )} style={MONO}>
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

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  MATERIAS PRIMAS — heatmap cards                         ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {mpPrecios.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-orange-500/10 to-rose-500/5 p-2 ring-1 ring-orange-500/20">
                <Beaker size={14} className="text-orange-600 dark:text-orange-400" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Materias primas</h2>
                <p className="text-[11px] text-zinc-500">Variación últimos 90 días · ordenadas por volatilidad</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...mpPrecios]
                .sort((a, b) => Math.abs(parseFloat(b.variacion_pct)) - Math.abs(parseFloat(a.variacion_pct)))
                .map((item, i) => {
                  const variacion = parseFloat(item.variacion_pct);
                  const isUp = variacion > 0;
                  const intensity = Math.min(Math.abs(variacion) / 30, 1);
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.8 + i * 0.025 }}
                      className="group relative rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-3 hover:shadow-lg transition-all overflow-hidden"
                    >
                      {/* Glow background according to variation */}
                      {variacion !== 0 && (
                        <div
                          className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-40 group-hover:opacity-70 transition-opacity"
                          style={{
                            backgroundColor: isUp ? '#FF0000' : '#10b981',
                            opacity: 0.05 + intensity * 0.2,
                          }}
                        />
                      )}

                      <div className="relative">
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{item.nombre}</p>
                            <p className="text-[10px] text-zinc-400 font-mono">{item.codigo}</p>
                          </div>
                          {item.precio_anterior && variacion !== 0 && (
                            <span className={clsx(
                              'inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-black tabular-nums shrink-0 ring-1',
                              isUp
                                ? 'bg-loga-red/10 text-loga-red ring-loga-red/30'
                                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30'
                            )} style={MONO}>
                              {isUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {isUp ? '+' : ''}{variacion.toFixed(1)}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between gap-2 text-[10px]">
                          <div className="flex-1">
                            <p className="text-zinc-400 font-medium uppercase tracking-wider mb-0.5">Antes</p>
                            <p className="font-medium tabular-nums text-zinc-500" style={MONO}>
                              {item.precio_anterior ? parseFloat(item.precio_anterior).toFixed(4) : '—'}
                            </p>
                          </div>
                          <ChevronRight size={12} className="text-zinc-300 mt-2" />
                          <div className="flex-1 text-right">
                            <p className="text-zinc-400 font-medium uppercase tracking-wider mb-0.5">Actual</p>
                            <p className="font-bold tabular-nums text-zinc-900 dark:text-white" style={MONO}>
                              {parseFloat(item.precio_actual).toFixed(4)} <span className="text-zinc-400 font-normal text-[9px]">{item.unidad_medida}</span>
                            </p>
                          </div>
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
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════

function SortHeader({ label, active, dir, onClick, pad }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; pad?: string
}) {
  return (
    <th className={clsx('text-right py-3', pad ? `px-3 pr-${pad.split('-')[1]}` : 'px-3')}>
      <button
        onClick={onClick}
        className={clsx(
          'inline-flex items-center gap-1 transition-colors text-[10px] uppercase tracking-[0.12em] font-bold',
          active ? 'text-loga-red' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
        )}
      >
        {label}
        <ChevronDown
          size={9}
          className={clsx('transition-all', active ? 'opacity-100' : 'opacity-30', active && dir === 'asc' && 'rotate-180')}
        />
      </button>
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CHART premium con líneas, área, axis Y, gridlines, dots interactivos
// ═══════════════════════════════════════════════════════════════════════
function PremiumChart({ data, maxMes, minMes, avgMes }: { data: VentaMes[]; maxMes: number; minMes: number; avgMes: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 1000;
  const H = 280;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 35;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const range = Math.max(maxMes - minMes, 1);

  const points = data.map((m, i) => {
    const v = parseFloat(String(m.total));
    const x = padL + (i / Math.max(data.length - 1, 1)) * innerW;
    const y = padT + innerH - ((v - minMes) / range) * innerH;
    return { x, y, v, m };
  });

  const linePath = points.reduce((acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`), '');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padT + innerH} L${points[0].x},${padT + innerH} Z`;
  const avgY = padT + innerH - ((avgMes - minMes) / range) * innerH;

  // Y axis ticks (4 ticks)
  const yTicks = [0, 0.33, 0.66, 1].map(t => {
    const value = minMes + range * t;
    const y = padT + innerH - t * innerH;
    return { value, y };
  });

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none" style={{ minHeight: 220 }}>
        <defs>
          <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF0000" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chart-line-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FF0000" stopOpacity="0.7" />
            <stop offset="50%" stopColor="#FF0000" stopOpacity="1" />
            <stop offset="100%" stopColor="#FF0000" stopOpacity="0.7" />
          </linearGradient>
          <filter id="chart-glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Y axis grid + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="currentColor" strokeWidth="0.5" className="text-zinc-100 dark:text-white/5" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" className="text-[9px] fill-zinc-400" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
              {fmtCompact(t.value)}
            </text>
          </g>
        ))}

        {/* Avg line punteada */}
        <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" className="text-zinc-400 dark:text-zinc-500" />
        <text x={W - padR - 4} y={avgY - 5} textAnchor="end" className="text-[9px] fill-zinc-400 font-bold uppercase tracking-wider" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
          Media
        </text>

        {/* X axis labels */}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={H - 12} textAnchor="middle"
            className={clsx('text-[10px] fill-zinc-500 font-medium', hoverIdx === i && 'fill-loga-red font-bold')}
            style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            {p.m.mes_label.split(' ')[0]}
          </text>
        ))}

        {/* Área */}
        <motion.path
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 1 }}
          d={areaPath} fill="url(#chart-area-grad)"
        />

        {/* Línea principal con glow */}
        <motion.path
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, ease: [0.65, 0, 0.35, 1] }}
          d={linePath} fill="none" stroke="url(#chart-line-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#chart-glow)"
        />

        {/* Dots */}
        {points.map((p, i) => {
          const isHover = hoverIdx === i;
          const isAboveAvg = p.v > avgMes;
          return (
            <g key={i}>
              {isHover && (
                <line x1={p.x} y1={p.y} x2={p.x} y2={H - padB} stroke="#FF0000" strokeWidth="1" strokeDasharray="2 3" opacity="0.4" />
              )}
              <motion.circle
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 1.5 + i * 0.04, type: 'spring', stiffness: 300, damping: 20 }}
                cx={p.x} cy={p.y} r={isHover ? 6 : 3.5}
                fill="white"
                stroke="#FF0000" strokeWidth={isHover ? 3 : 2}
                className="transition-all"
                style={{ filter: isHover ? 'drop-shadow(0 4px 8px rgba(255,0,0,0.4))' : undefined }}
              />
              {isAboveAvg && !isHover && (
                <circle cx={p.x} cy={p.y - 12} r="2" fill="#10b981" />
              )}
              <rect
                x={p.x - innerW / data.length / 2}
                y={padT}
                width={innerW / data.length}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                className="cursor-crosshair"
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip premium */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute pointer-events-none bg-zinc-900 dark:bg-zinc-800 text-white px-4 py-3 rounded-xl shadow-2xl ring-1 ring-white/10"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 16px))',
              minWidth: 160,
            }}
          >
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-bold mb-1" style={MONO}>{hovered.m.mes_label}</p>
            <p className="text-2xl font-bold leading-none mb-1.5 tabular-nums" style={MONO}>
              {fmt(hovered.v)} <span className="text-xs font-normal text-zinc-400">EUR</span>
            </p>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-zinc-400">{hovered.m.num_pedidos} pedidos</span>
              <span className="text-zinc-600">·</span>
              <span className={clsx('font-bold inline-flex items-center gap-0.5', hovered.v > avgMes ? 'text-emerald-400' : 'text-amber-400')}>
                {hovered.v > avgMes ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {hovered.v > avgMes ? '+' : ''}{((hovered.v / avgMes - 1) * 100).toFixed(0)}% vs media
              </span>
            </div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 bg-zinc-900 dark:bg-zinc-800 rotate-45 ring-1 ring-white/10" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
