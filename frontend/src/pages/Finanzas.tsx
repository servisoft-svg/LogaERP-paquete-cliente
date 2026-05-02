import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, ArrowUpRight, ArrowDownRight, Search, ChevronDown,
  AlertTriangle, Plus, Minus,
} from 'lucide-react';
import { finanzasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { notify } from '../lib/notify';
import clsx from 'clsx';

// ── Tipos (intactos) ────────────────────────────────────────────────
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

// Animations: ease lineal, sin spring/bounce
const FADE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const },
};

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
  const totalEvolucion = useMemo(() => data?.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0) ?? 0, [data]);

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
        <div className="text-center space-y-2">
          <AlertTriangle size={24} className="mx-auto text-zinc-400" strokeWidth={1.5} />
          <p className="text-zinc-500 text-xs">Acceso restringido a administradores</p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-loga-red text-xs">{error || 'Sin datos'}</p>
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
    <div className="animate-fade-in -mx-4 sm:-mx-6 -mt-4 sm:-mt-6">

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  TOP BAR — ultra fina con título + acciones              ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <div className="border-b border-zinc-200 dark:border-white/10 px-6 sm:px-10 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-loga-red" />
          <h1 className="text-[13px] font-semibold text-zinc-900 dark:text-white tracking-tight">Finanzas</h1>
          <span className="text-[11px] text-zinc-400">/</span>
          <span className="text-[11px] text-zinc-500">Resumen</span>
        </div>
        <div className="flex items-center gap-1">
          {[
            { tipo: 'pedidos',     label: 'Pedidos' },
            { tipo: 'produccion',  label: 'Producción' },
            { tipo: 'inventario',  label: 'Inventario' },
          ].map(({ tipo, label }) => (
            <button key={tipo} onClick={() => exportar(tipo)}
              className="group inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 rounded-md transition-colors">
              {label}
              <Download size={10} strokeWidth={2} className="opacity-50 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-200 dark:bg-white/10 mx-1" />
          <select id="plastico-year" defaultValue={new Date().getFullYear()}
            className="bg-transparent text-[11px] font-medium text-zinc-600 dark:text-zinc-400 outline-none px-1.5 h-7 rounded-md hover:bg-zinc-100 dark:hover:bg-white/5">
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
            className="group inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 rounded-md transition-colors">
            Plástico {new Date().getFullYear()}
            <Download size={10} strokeWidth={2} className="opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  HERO — números grandes, asimétrico, definido            ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="px-6 sm:px-10 pt-10 sm:pt-14 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-y-8 gap-x-10">

          {/* Facturación principal */}
          <div className="lg:col-span-7">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-zinc-500">Facturación</span>
              <span className="text-[10px] text-zinc-400 tabular-nums">· {fmtInt(data.ventas.num_pedidos)} pedidos</span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-[64px] sm:text-[88px] font-semibold text-zinc-900 dark:text-white tracking-[-0.04em] leading-none tabular-nums">
                {fmt(data.ventas.facturacion_total).split(',')[0]}
                <span className="text-zinc-300 dark:text-zinc-600">,{fmt(data.ventas.facturacion_total).split(',')[1] ?? '00'}</span>
              </h2>
              <span className="text-sm font-medium text-zinc-400 tracking-tight">EUR</span>
            </div>
          </div>

          {/* 3 stats laterales */}
          <div className="lg:col-span-5 grid grid-cols-3 lg:flex lg:flex-col lg:justify-end gap-y-5 gap-x-4 lg:gap-y-4 lg:border-l lg:border-zinc-200 lg:dark:border-white/10 lg:pl-10">
            <HeroStat
              label="Beneficio bruto"
              value={fmtCompact(beneficioBruto)}
              hint={`${margenPct.toFixed(1)}%`}
              positive={beneficioBruto >= 0}
            />
            <HeroStat
              label="Coste producción"
              value={fmtCompact(data.costeProd.coste_total)}
              hint={`${fmtInt(data.costeProd.num_ordenes)} órd`}
            />
            <HeroStat
              label="Inmovilizado"
              value={fmtCompact(data.inmovilizado.valor_total)}
              hint="stock"
            />
          </div>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  KPI INLINE — banda densa estilo Bloomberg               ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <section className="border-y border-zinc-200 dark:border-white/10 bg-zinc-50/50 dark:bg-white/[0.02]">
        <div className="px-6 sm:px-10 py-4 grid grid-cols-2 sm:grid-cols-4 divide-x divide-zinc-200 dark:divide-white/10">
          <Inline label="Ticket medio" value={data.ventas.num_pedidos > 0 ? fmt(data.ventas.facturacion_total / data.ventas.num_pedidos) : '0'} unit="€/pedido" />
          <Inline label="Coste/orden" value={data.costeProd.num_ordenes > 0 ? fmt(data.costeProd.coste_total / data.costeProd.num_ordenes) : '0'} unit="€/orden" />
          <Inline label="Rechazada" value={fmtCompact(data.rechazos.valor_rechazado)} unit={`${data.rechazos.ordenes_canceladas} órd`} accent="red" />
          <Inline label="Mermas" value={`${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')}`} unit={`kg · ${fmtCompact(data.mermas?.total_eur ?? 0)} €`} />
        </div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  CHART EVOLUCIÓN — line precision                         ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasMes.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader
            label="Evolución"
            title={`${data.ventasMes.length} meses`}
            extra={
              <div className="flex items-center gap-6 text-[11px]">
                <Stat sub="Pico" value={fmtCompact(maxMes)} />
                <Stat sub="Media" value={fmtCompact(avgMes)} />
                <Stat sub="Total" value={fmtCompact(totalEvolucion)} accent />
              </div>
            }
          />
          <div className="mt-6">
            <PrecisionChart data={data.ventasMes} maxMes={maxMes} minMes={minMes} avgMes={avgMes} />
          </div>
        </motion.section>
      )}

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  RENTABILIDAD — tabla densa precision                     ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
        <SectionHeader
          label="Rentabilidad"
          title="Por producto"
          extra={
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Buscar"
                  value={rentaSearch}
                  onChange={(e) => setRentaSearch(e.target.value)}
                  className="w-32 sm:w-40 h-7 bg-zinc-100 dark:bg-white/5 border-0 pl-7 pr-2 text-[11px] outline-none focus:bg-white dark:focus:bg-white/10 rounded-md placeholder:text-zinc-400 transition-colors"
                />
              </div>
              <div className="flex items-center text-[11px] font-medium">
                {([
                  { v: 'todos',              l: 'Todos' },
                  { v: 'producto_fabricado', l: 'Granel' },
                  { v: 'producto_envasado',  l: 'Envasado' },
                ] as const).map(({ v, l }, idx) => {
                  const count = v === 'todos' ? data.rentabilidad.length : data.rentabilidad.filter(r => r.tipo === v).length;
                  const active = rentaTab === v;
                  return (
                    <button key={v} onClick={() => setRentaTab(v)}
                      className={clsx(
                        'h-7 px-2.5 inline-flex items-center gap-1 transition-colors',
                        idx === 0 && 'rounded-l-md border-l border-y',
                        idx === 2 && 'rounded-r-md border-r border-y',
                        idx === 1 && 'border-y',
                        idx > 0 && 'border-l',
                        active
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                          : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
                      )}>
                      {l}
                      <span className={clsx('text-[10px] tabular-nums', active ? 'opacity-70' : 'text-zinc-400')}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        <div className="mt-6 border-t border-zinc-200 dark:border-white/10">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.12em] font-semibold text-zinc-500">
                <th className="text-left py-3 pr-3 w-[40%]">Producto</th>
                <Sort label="Venta" k={rentaSort.key} active={rentaSort.key === 'venta'} dir={rentaSort.dir} onClick={() => ordenarPor('venta')} />
                <Sort label="Coste" k={rentaSort.key} active={rentaSort.key === 'coste'} dir={rentaSort.dir} onClick={() => ordenarPor('coste')} />
                <Sort label="Margen" k={rentaSort.key} active={rentaSort.key === 'margen'} dir={rentaSort.dir} onClick={() => ordenarPor('margen')} />
                <th className="text-right py-3 px-3 w-16">Δ</th>
                <Sort label="Beneficio" k={rentaSort.key} active={rentaSort.key === 'beneficio'} dir={rentaSort.dir} onClick={() => ordenarPor('beneficio')} />
              </tr>
            </thead>
            <tbody>
              {rentabilidadFiltrada.map((r, i) => {
                const margen = parseFloat(String(r.margen_pct));
                const isOpen = desgloseId === r.id;
                const margenColor = margen < 20 ? 'text-loga-red' : margen < 40 ? 'text-zinc-900 dark:text-white' : 'text-emerald-600 dark:text-emerald-400';
                return (
                  <React.Fragment key={r.id}>
                    <motion.tr
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.012, duration: 0.2 }}
                      onClick={() => setDesgloseId(isOpen ? null : r.id)}
                      className={clsx(
                        'border-t border-zinc-100 dark:border-white/5 cursor-pointer group transition-colors',
                        isOpen ? 'bg-zinc-50 dark:bg-white/[0.03]' : 'hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]'
                      )}
                    >
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <span className="text-zinc-300 dark:text-zinc-600 group-hover:text-loga-red transition-colors shrink-0">
                            {isOpen ? <Minus size={10} strokeWidth={2.5} /> : <Plus size={10} strokeWidth={2.5} />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] text-zinc-900 dark:text-white truncate">{r.nombre}</p>
                            <p className="text-[10px] text-zinc-400 mt-px tabular-nums">
                              {r.codigo} · {r.tipo === 'producto_fabricado' ? 'Granel' : 'Envasado'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className="text-[12px] tabular-nums text-zinc-900 dark:text-white">{fmt(r.precio_venta)}</p>
                        <p className="text-[9px] text-zinc-400 tabular-nums">€/{r.unidad_medida}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className="text-[12px] tabular-nums text-zinc-700 dark:text-zinc-300">{fmt(r.precio_coste)}</p>
                        <p className="text-[9px] text-zinc-400 tabular-nums">€/{r.unidad_medida}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className={clsx('text-[13px] font-medium tabular-nums', margenColor)}>{margen.toFixed(1)}<span className="text-[10px] text-zinc-400 ml-0.5">%</span></p>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {r.diff_margen != null && r.diff_margen !== 0 ? (
                          <span className={clsx(
                            'inline-flex items-center gap-0.5 text-[11px] tabular-nums font-medium',
                            r.diff_margen > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-loga-red'
                          )}>
                            {r.diff_margen > 0 ? <ArrowUpRight size={9} strokeWidth={2.5} /> : <ArrowDownRight size={9} strokeWidth={2.5} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}
                          </span>
                        ) : <span className="text-zinc-300 text-[11px]">—</span>}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <p className="text-[12px] tabular-nums font-medium text-zinc-900 dark:text-white">{fmt(r.beneficio_ud)}</p>
                        <p className="text-[9px] text-zinc-400 tabular-nums">€/ud</p>
                      </td>
                    </motion.tr>
                    <AnimatePresence>
                      {isOpen && r.desglose && r.desglose.length > 0 && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                              className="bg-zinc-50/80 dark:bg-white/[0.02] border-t border-zinc-200 dark:border-white/10"
                            >
                              <div className="px-9 py-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-zinc-500">Desglose de coste</span>
                                  <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                                </div>
                                <div className="grid grid-cols-12 gap-3 text-[10px] uppercase tracking-[0.1em] font-semibold text-zinc-400 mb-1.5 pb-1.5 border-b border-zinc-200 dark:border-white/10">
                                  <span className="col-span-5">Ingrediente</span>
                                  <span className="col-span-3 text-right">Cantidad</span>
                                  <span className="col-span-2 text-right">Precio</span>
                                  <span className="col-span-2 text-right">Línea</span>
                                </div>
                                {r.desglose.map((d, j) => (
                                  <div key={j} className="grid grid-cols-12 gap-3 text-[11px] py-1 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                                    <span className="col-span-5 text-zinc-700 dark:text-zinc-300">{d.nombre}</span>
                                    <span className="col-span-3 text-right tabular-nums text-zinc-500">{d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {d.unidad}</span>
                                    <span className="col-span-2 text-right tabular-nums text-zinc-500">{fmt(d.precio_ud)}</span>
                                    <span className="col-span-2 text-right tabular-nums text-zinc-900 dark:text-white font-medium">{fmt(d.coste_linea)}</span>
                                  </div>
                                ))}
                                <div className="grid grid-cols-12 gap-3 text-[11px] pt-2.5 mt-1.5 border-t border-zinc-300 dark:border-white/20">
                                  <span className="col-span-10 font-medium text-zinc-900 dark:text-white">
                                    Total batch{r.rendimiento && r.rendimiento > 1 ? ` · ${r.rendimiento} ${r.unidad_medida}` : ''}
                                  </span>
                                  <span className="col-span-2 text-right tabular-nums font-medium text-zinc-900 dark:text-white">{fmt(r.coste_batch ?? r.precio_coste)} €</span>
                                </div>
                                {r.rendimiento && r.rendimiento > 1 && (
                                  <div className="grid grid-cols-12 gap-3 text-[11px] pt-1">
                                    <span className="col-span-10 text-loga-red font-medium">Coste por {r.unidad_medida}</span>
                                    <span className="col-span-2 text-right tabular-nums text-loga-red font-medium">{fmt(r.precio_coste)} €</span>
                                  </div>
                                )}
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
                <tr><td colSpan={6} className="py-12 text-center text-[11px] text-zinc-400 border-t border-zinc-100 dark:border-white/5">{rentaSearch ? 'Sin resultados' : 'Sin productos'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="border-t border-zinc-200 dark:border-white/10" />
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  INVENTARIO — distribución + top 10                       ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

          {/* Distribución (5 cols) */}
          <div className="lg:col-span-5">
            <SectionHeader label="Distribución" title="Por categoría" />

            <div className="mt-6 space-y-0">
              {([
                { label: 'Materia prima', value: data.inmovilizado.valor_mp,  color: '#18181b' },
                { label: 'Fabricado',     value: data.inmovilizado.valor_fab, color: '#FF0000' },
                { label: 'Envasado',      value: data.inmovilizado.valor_env, color: '#71717a' },
                { label: 'Embalaje',      value: data.inmovilizado.valor_emb, color: '#d4d4d8' },
              ]).map(({ label, value, color }, i) => {
                const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                return (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 + i * 0.04, duration: 0.2 }}
                    className="group"
                  >
                    <div className="flex items-baseline justify-between py-2.5 border-t border-zinc-200 dark:border-white/10 first:border-t-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1 h-3.5 rounded-sm" style={{ backgroundColor: color }} />
                        <span className="text-[12px] text-zinc-900 dark:text-white">{label}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="text-[10px] tabular-nums text-zinc-400 font-medium">{pct.toFixed(1)}%</span>
                        <span className="text-[13px] font-medium tabular-nums text-zinc-900 dark:text-white w-24 text-right">{fmtCompact(value)} <span className="text-[10px] text-zinc-400 font-normal">€</span></span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              <div className="flex items-baseline justify-between py-3 border-t-2 border-zinc-900 dark:border-white">
                <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-zinc-500">Total</span>
                <span className="text-[18px] font-semibold tabular-nums text-zinc-900 dark:text-white">
                  {fmt(data.inmovilizado.valor_total)} <span className="text-[11px] text-zinc-400 font-normal">EUR</span>
                </span>
              </div>
            </div>
          </div>

          {/* Top 10 (7 cols) */}
          <div className="lg:col-span-7">
            <SectionHeader
              label="Inmovilizado"
              title={`Top ${data.topInmovilizado.length > 10 ? 10 : data.topInmovilizado.length}`}
            />

            <ol className="mt-6 border-t border-zinc-200 dark:border-white/10">
              {data.topInmovilizado.slice(0, 10).map((p, i) => {
                const val = parseFloat(String(p.valor));
                const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                const isLoga = p.tipo === 'producto_fabricado';
                return (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 + i * 0.025, duration: 0.2 }}
                    className="grid grid-cols-12 gap-3 items-center py-2.5 border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50/40 dark:hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded"
                  >
                    <span className="col-span-1 text-[10px] text-zinc-400 tabular-nums font-medium">{String(i + 1).padStart(2, '0')}</span>
                    <div className="col-span-5 min-w-0">
                      <p className="text-[12px] text-zinc-900 dark:text-white truncate">{p.nombre}</p>
                      <p className="text-[10px] text-zinc-400 tabular-nums">{fmtInt(parseFloat(String(p.stock_actual)))} {p.unidad_medida}</p>
                    </div>
                    <div className="col-span-4 hidden sm:block">
                      <div className="h-px bg-zinc-100 dark:bg-white/5 relative">
                        <motion.div
                          initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                          transition={{ delay: 0.2 + i * 0.025, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          style={{ transformOrigin: 'left', backgroundColor: isLoga ? '#FF0000' : '#18181b' }}
                          className="absolute inset-0 dark:!bg-white"
                        />
                      </div>
                    </div>
                    <span className="col-span-2 text-right text-[12px] font-medium tabular-nums text-zinc-900 dark:text-white">{fmtCompact(val)} <span className="text-[9px] text-zinc-400">€</span></span>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  TOP VENTAS — lista numerada precision                    ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasProducto.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader label="Ventas" title="Top productos" />

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-x-10">
            {data.ventasProducto.map((v, i) => {
              const fact = parseFloat(String(v.facturacion));
              const cantidad = parseFloat(String(v.cantidad_vendida));
              const maxFact = parseFloat(String(data.ventasProducto[0]?.facturacion ?? 1));
              const pct = maxFact > 0 ? (fact / maxFact) * 100 : 0;
              const precioEf = cantidad > 0 ? fact / cantidad : 0;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 * i, duration: 0.2 }}
                  className="grid grid-cols-12 gap-3 items-center py-3 border-t border-zinc-100 dark:border-white/5 first:border-t-0 lg:first:border-t lg:[&:nth-child(2)]:border-t group"
                >
                  <span className="col-span-1 text-[10px] text-zinc-400 tabular-nums font-medium">{String(i + 1).padStart(2, '0')}</span>
                  <div className="col-span-7 min-w-0">
                    <p className="text-[12px] text-zinc-900 dark:text-white truncate">{v.nombre}</p>
                    <p className="text-[10px] text-zinc-400 tabular-nums mt-0.5">
                      {fmtInt(cantidad)} {v.unidad_medida} · {fmt(precioEf)} €/{v.unidad_medida}
                    </p>
                    <div className="h-px bg-zinc-100 dark:bg-white/5 mt-2 relative overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                        transition={{ delay: 0.15 + i * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        style={{ transformOrigin: 'left' }}
                        className="absolute inset-0 bg-loga-red"
                      />
                    </div>
                  </div>
                  <div className="col-span-4 text-right">
                    <p className="text-[14px] font-medium tabular-nums text-zinc-900 dark:text-white">{fmtCompact(fact)}</p>
                    <p className="text-[9px] text-zinc-400 uppercase tracking-wider">EUR</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  IMPACTO PRECIOS                                           ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {impactoRecetas.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader label="Impacto" title="Variación de margen" hint="PVP + coste anterior vs actual" />

          <div className="mt-6 border-t border-zinc-200 dark:border-white/10">
            {impactoRecetas.map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const diffPositivo = r.diff_margen > 0;
              const diffNegativo = r.diff_margen < 0;
              const pvpCambio = r.pvp_anterior && r.pvp_actual && Math.abs(r.pvp_actual - r.pvp_anterior) > 0.01;
              const margenColor = r.margen_actual > 40 ? 'text-emerald-600 dark:text-emerald-400'
                : r.margen_actual > 20 ? 'text-zinc-900 dark:text-white' : 'text-loga-red';
              return (
                <div key={r.receta_nombre} className="border-b border-zinc-100 dark:border-white/5">
                  <button
                    onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)}
                    className={clsx(
                      'w-full grid grid-cols-12 gap-3 items-center py-3 text-left transition-colors px-2 -mx-2 rounded',
                      expanded ? 'bg-zinc-50 dark:bg-white/[0.03]' : 'hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]'
                    )}
                  >
                    <span className={clsx(
                      'col-span-1 w-1 h-3.5 rounded-sm justify-self-center',
                      diffNegativo ? 'bg-loga-red' : diffPositivo ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                    )} />
                    <div className="col-span-12 sm:col-span-6 min-w-0">
                      <p className="text-[12px] text-zinc-900 dark:text-white truncate">{r.producto_nombre}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums truncate">
                        {r.receta_nombre}
                        {r.pvp_actual !== undefined && <span> · {r.pvp_actual.toFixed(2)} €/{r.unidad_medida}</span>}
                        {pvpCambio && <span className="text-zinc-300"> (ant {r.pvp_anterior?.toFixed(2)})</span>}
                      </p>
                    </div>
                    <div className="col-span-6 sm:col-span-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-400 font-medium">Coste</p>
                      <p className="text-[12px] tabular-nums text-zinc-900 dark:text-white">{r.coste_actual.toFixed(4)}</p>
                      {r.diff_coste !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')}>
                          {r.diff_coste > 0 ? '+' : ''}{r.diff_coste.toFixed(4)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-5 sm:col-span-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-400 font-medium">Margen</p>
                      <p className={clsx('text-[14px] font-medium tabular-nums', margenColor)}>{r.margen_actual.toFixed(1)}%</p>
                      {r.diff_margen !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums inline-flex items-center gap-0.5', diffNegativo ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')}>
                          {diffPositivo ? <ArrowUpRight size={9} strokeWidth={2.5} /> : <ArrowDownRight size={9} strokeWidth={2.5} />}
                          {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                        </p>
                      )}
                    </div>
                    <ChevronDown size={12} className={clsx('col-span-1 justify-self-end text-zinc-400 transition-transform', expanded && 'rotate-180')} strokeWidth={2.5} />
                  </button>

                  <AnimatePresence>
                    {expanded && r.detalle_mp.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                        className="overflow-hidden bg-zinc-50/60 dark:bg-white/[0.02]"
                      >
                        <div className="px-9 py-4">
                          {r.salud && (
                            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-3 italic border-l-2 border-zinc-300 dark:border-white/20 pl-3">
                              {r.salud}
                            </p>
                          )}
                          <div className="grid grid-cols-12 gap-3 text-[10px] uppercase tracking-[0.1em] font-semibold text-zinc-400 mb-1.5 pb-1.5 border-b border-zinc-200 dark:border-white/10">
                            <span className="col-span-6">Materia prima</span>
                            <span className="col-span-2 text-right">Anterior</span>
                            <span className="col-span-2 text-right">Actual</span>
                            <span className="col-span-2 text-right">Impacto</span>
                          </div>
                          {r.detalle_mp.map((mp, i) => (
                            <div key={i} className="grid grid-cols-12 gap-3 text-[11px] py-1 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                              <span className="col-span-6 text-zinc-700 dark:text-zinc-300">{mp.nombre} <span className="text-zinc-400 tabular-nums">({mp.cantidad.toFixed(2)})</span></span>
                              <span className="col-span-2 text-right tabular-nums text-zinc-500">{mp.precio_anterior?.toFixed(4) ?? '—'}</span>
                              <span className="col-span-2 text-right tabular-nums text-zinc-900 dark:text-white font-medium">{mp.precio_actual.toFixed(4)}</span>
                              <span className={clsx(
                                'col-span-2 text-right tabular-nums font-medium',
                                mp.diff > 0 ? 'text-loga-red' : mp.diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-300'
                              )}>
                                {mp.diff !== 0 ? `${mp.diff > 0 ? '+' : ''}${mp.diff.toFixed(2)}` : '—'}
                              </span>
                            </div>
                          ))}
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
          ║  MATERIAS PRIMAS — lista densa                            ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {mpPrecios.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader label="Materias primas" title="Variación 90 días" hint="Ordenadas por volatilidad" />

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {[...mpPrecios]
              .sort((a, b) => Math.abs(parseFloat(b.variacion_pct)) - Math.abs(parseFloat(a.variacion_pct)))
              .map((item, i) => {
                const variacion = parseFloat(item.variacion_pct);
                const isUp = variacion > 0;
                const ant = item.precio_anterior ? parseFloat(item.precio_anterior) : null;
                const act = parseFloat(item.precio_actual);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.025 * i, duration: 0.2 }}
                    className="grid grid-cols-12 items-baseline gap-2 py-2.5 border-t border-zinc-100 dark:border-white/5 first:border-t-0 md:[&:nth-child(2)]:border-t-0 lg:[&:nth-child(3)]:border-t-0 group"
                  >
                    <div className="col-span-7 min-w-0">
                      <p className="text-[12px] text-zinc-900 dark:text-white truncate">{item.nombre}</p>
                      <p className="text-[10px] text-zinc-400 tabular-nums mt-0.5">
                        {ant ? ant.toFixed(4) : '—'} → <span className="text-zinc-700 dark:text-zinc-300 font-medium">{act.toFixed(4)}</span> €/{item.unidad_medida}
                      </p>
                    </div>
                    <div className="col-span-5 text-right">
                      {item.precio_anterior && variacion !== 0 ? (
                        <span className={clsx(
                          'inline-flex items-center gap-0.5 text-[12px] tabular-nums font-medium',
                          isUp ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400'
                        )}>
                          {isUp ? <ArrowUpRight size={11} strokeWidth={2.5} /> : <ArrowDownRight size={11} strokeWidth={2.5} />}
                          {isUp ? '+' : ''}{variacion.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-300">—</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
          </div>
        </motion.section>
      )}

      <div className="h-12" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES — definidos, sin decoración
// ═══════════════════════════════════════════════════════════════════════

function HeroStat({ label, value, hint, positive }: { label: string; value: string; hint?: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-zinc-500 mb-1.5">{label}</p>
      <p className="text-[28px] font-semibold text-zinc-900 dark:text-white tabular-nums leading-none tracking-tight">
        {value}
        <span className="text-[12px] font-normal text-zinc-400 ml-1.5">€</span>
      </p>
      {hint && (
        <p className={clsx(
          'text-[11px] tabular-nums mt-1.5 inline-flex items-center gap-0.5',
          positive === true ? 'text-emerald-600 dark:text-emerald-400'
            : positive === false ? 'text-loga-red'
            : 'text-zinc-500'
        )}>
          {positive === true && <ArrowUpRight size={10} strokeWidth={2.5} />}
          {positive === false && <ArrowDownRight size={10} strokeWidth={2.5} />}
          {hint}
        </p>
      )}
    </div>
  );
}

function Inline({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: 'red' }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-zinc-500 mb-1">{label}</p>
      <p className={clsx('text-[18px] font-medium tabular-nums leading-none', accent === 'red' ? 'text-loga-red' : 'text-zinc-900 dark:text-white')}>
        {value}
      </p>
      <p className="text-[10px] text-zinc-400 tabular-nums mt-1">{unit}</p>
    </div>
  );
}

function SectionHeader({ label, title, extra, hint }: { label: string; title: string; extra?: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="flex items-baseline gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-zinc-500">{label}</span>
        <span className="h-px w-6 bg-zinc-300 dark:bg-white/20" />
        <h2 className="text-[20px] font-semibold text-zinc-900 dark:text-white tracking-tight">{title}</h2>
        {hint && <p className="text-[11px] text-zinc-400 hidden sm:block">{hint}</p>}
      </div>
      {extra}
    </div>
  );
}

function Stat({ sub, value, accent }: { sub: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[9px] uppercase tracking-[0.14em] font-semibold text-zinc-400">{sub}</p>
      <p className={clsx('text-[13px] font-medium tabular-nums', accent ? 'text-loga-red' : 'text-zinc-900 dark:text-white')}>{value}</p>
    </div>
  );
}

function Sort({ label, active, dir, onClick }: { label: string; k?: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <th className="text-right py-3 px-3">
      <button onClick={onClick} className={clsx(
        'inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors',
        active ? 'text-loga-red' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
      )}>
        {label}
        <ChevronDown size={9} strokeWidth={2.5} className={clsx('transition-all', active ? 'opacity-100' : 'opacity-30', active && dir === 'asc' && 'rotate-180')} />
      </button>
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PRECISION CHART — line + area, sin glows ni filtros
// ═══════════════════════════════════════════════════════════════════════
function PrecisionChart({ data, maxMes, minMes, avgMes }: { data: VentaMes[]; maxMes: number; minMes: number; avgMes: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 1000;
  const H = 240;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
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

  const yTicks = [0, 0.5, 1].map(t => ({
    value: minMes + range * t,
    y: padT + innerH - t * innerH,
  }));

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none" style={{ minHeight: 200 }}>
        <defs>
          <linearGradient id="pchart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF0000" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y ticks (3 hairlines) */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="currentColor" strokeWidth="0.5" className="text-zinc-200 dark:text-white/10" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" className="text-[9px] fill-zinc-400 tabular-nums font-medium">
              {fmtCompact(t.value)}
            </text>
          </g>
        ))}

        {/* Avg line */}
        <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 3" className="text-zinc-400 dark:text-white/30" />

        {/* X labels */}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={H - 8} textAnchor="middle"
            className={clsx('text-[10px] tabular-nums', hoverIdx === i ? 'fill-loga-red font-semibold' : 'fill-zinc-400')}>
            {p.m.mes_label.split(' ')[0]}
          </text>
        ))}

        {/* Área */}
        <motion.path
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.6 }}
          d={areaPath} fill="url(#pchart-area)"
        />

        {/* Línea */}
        <motion.path
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
          d={linePath} fill="none" stroke="#FF0000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        />

        {/* Dots */}
        {points.map((p, i) => {
          const isHover = hoverIdx === i;
          return (
            <g key={i}>
              {isHover && (
                <line x1={p.x} y1={p.y} x2={p.x} y2={H - padB} stroke="#FF0000" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.4" />
              )}
              <motion.circle
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 1.2 + i * 0.03, duration: 0.2 }}
                cx={p.x} cy={p.y} r={isHover ? 4 : 2.5}
                fill="white"
                stroke="#FF0000" strokeWidth={isHover ? 2 : 1.5}
                className="transition-all dark:fill-zinc-900"
              />
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

      {/* Tooltip preciso */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute pointer-events-none bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 border border-zinc-900 dark:border-white"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 12px))',
            }}
          >
            <p className="text-[9px] uppercase tracking-[0.16em] opacity-60 font-semibold">{hovered.m.mes_label}</p>
            <p className="text-[18px] font-semibold tabular-nums leading-tight">{fmt(hovered.v)} <span className="text-[10px] font-normal opacity-60">EUR</span></p>
            <p className="text-[10px] tabular-nums opacity-60 mt-0.5">{hovered.m.num_pedidos} pedidos · {hovered.v > avgMes ? '+' : ''}{((hovered.v / avgMes - 1) * 100).toFixed(0)}%</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
