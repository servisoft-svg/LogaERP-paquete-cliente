import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, ArrowUpRight, ArrowDownRight, Search, ChevronDown,
  AlertTriangle, Plus, Minus, Activity, TrendingUp,
  Factory, Warehouse, Package, Layers, Beaker, Zap, Eye, EyeOff, X,
  type LucideIcon,
} from 'lucide-react';
import { finanzasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { notify } from '../lib/notify';
import clsx from 'clsx';

// ── Tipos (intactos) ────────────────────────────────────────────────
interface DesgloseItem {
  nombre: string; cantidad: number; unidad: string;
  precio_ud: number; coste_linea: number;
  precio_ud_futuro?: number; coste_linea_futuro?: number;
}
interface Rentabilidad {
  id: string; codigo: string; nombre: string; tipo: string;
  precio_venta: number; precio_coste: number; coste_batch?: number;
  coste_ud_futuro?: number; coste_batch_futuro?: number;
  rendimiento?: number;
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
  producto_tipo?: 'producto_fabricado' | 'producto_envasado';
  tipo_receta?: 'fabricacion' | 'envasado';
  unidad_medida: string; precio_venta: number; rendimiento?: number;
  pvp_anterior?: number; pvp_actual?: number;
  coste_anterior: number; coste_actual: number;
  coste_batch_anterior?: number; coste_batch_actual?: number;
  coste_stock_min?: number; coste_stock_max?: number;
  coste_stock_min_batch?: number; coste_stock_max_batch?: number;
  margen_anterior: number; margen_actual: number;
  diff_coste: number; diff_margen: number; salud?: string;
  detalle_mp: {
    nombre: string;
    cantidad: number;
    precio_anterior: number | null;
    precio_actual: number;
    precio_stock_min?: number | null;
    precio_stock_max?: number | null;
    stock_source?: 'lots' | 'recursive' | 'ficha';
    diff: number;
  }[];
}
interface MPPrecio { id: string; codigo: string; nombre: string; unidad_medida: string; precio_actual: string; precio_anterior: string | null; variacion_pct: string }
interface PrecioHistRow { id: string; tipo: string; precio_anterior: string | null; precio_nuevo: string; motivo: string | null; created_at: string }

// ── Helpers — SIN ABREVIATURAS K/M ──────────────────────────────────
const fmt = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 0 });

// ── Privacy mode — enmascara solo valores monetarios ───────────────
const PRIV_KEY = 'loga_finanzas_priv';
const money = (n: number, priv: boolean, decimals = 2) =>
  priv ? '**' : n.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const moneyInt = (n: number, priv: boolean) =>
  priv ? '**' : Math.round(n).toLocaleString('es-ES', { maximumFractionDigits: 0 });

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
  const [mpDetalle, setMpDetalle] = useState<MPPrecio | null>(null);
  const [mpDetalleHist, setMpDetalleHist] = useState<PrecioHistRow[]>([]);
  const [mpDetalleLoading, setMpDetalleLoading] = useState(false);
  const [expandedReceta, setExpandedReceta] = useState<string | null>(null);
  const [filtroImpacto, setFiltroImpacto] = useState<'todos' | 'granel' | 'envasado'>('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rentaTab, setRentaTab] = useState<'todos' | 'producto_fabricado' | 'producto_envasado'>('todos');
  const [desgloseId, setDesgloseId] = useState<string | null>(null);
  const [rentaSearch, setRentaSearch] = useState('');
  const [rentaSort, setRentaSort] = useState<{ key: 'margen' | 'venta' | 'coste' | 'beneficio'; dir: 'desc' | 'asc' }>({ key: 'margen', dir: 'desc' });
  const [año, setAño] = useState<number>(() => new Date().getFullYear());
  const [priv, setPriv] = useState<boolean>(() => {
    try { return localStorage.getItem(PRIV_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(PRIV_KEY, priv ? '1' : '0'); } catch { /* noop */ }
  }, [priv]);
  const m  = useCallback((n: number, dec = 2) => money(n, priv, dec), [priv]);
  const mi = useCallback((n: number) => moneyInt(n, priv), [priv]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [resRes, impRes] = await Promise.all([
        finanzasApi.resumen(año),
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
  }, [año]);

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
          <AlertTriangle size={24} className="mx-auto text-loga-red" strokeWidth={1.5} />
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
      // Inventario es estado actual, no se filtra por año.
      const usaAño = tipo !== 'inventario';
      const res = await finanzasApi.exportar(tipo, usaAño ? año : undefined);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = usaAño ? `${tipo}-${año}.csv` : `${tipo}.csv`;
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      notify.success('Exportación lista', { description: `${filename} descargado` });
    } catch { notify.error(`No se pudo exportar ${tipo}`); }
  };

  return (
    <div className="animate-fade-in -mx-4 sm:-mx-6 -mt-4 sm:-mt-6">

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  TOP BAR — con presencia de rojo                         ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <div className="border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-6 sm:px-10 h-14 flex items-center justify-between gap-4 sticky top-0 z-30 backdrop-blur-md bg-white/95 dark:bg-zinc-900/95">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-loga-red p-1.5">
            <Activity size={11} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-[13px] font-semibold text-zinc-900 dark:text-white tracking-tight">Finanzas</h1>
          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">/</span>
          <span className="text-[11px] text-zinc-500">Resumen</span>
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-loga-red/10 px-2 py-0.5 text-[10px] font-semibold text-loga-red">
            <span className="w-1 h-1 rounded-full bg-loga-red animate-pulse" />
            Live
          </span>
          {/* Selector de año — filtra TODA la página + exports */}
          <div className="ml-2 flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-zinc-400">Año</label>
            <select
              value={año}
              onChange={(e) => setAño(parseInt(e.target.value, 10))}
              className="bg-zinc-100 dark:bg-white/5 text-[11px] font-bold text-loga-red outline-none px-2 h-7 rounded-md border border-loga-red/20 hover:border-loga-red focus:ring-2 focus:ring-loga-red/30 transition-all tabular-nums"
            >
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPriv(p => !p)}
            title={priv ? 'Mostrar importes' : 'Ocultar importes (modo presentación)'}
            aria-pressed={priv}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium rounded-md transition-colors',
              priv
                ? 'bg-loga-red text-white hover:bg-loga-red-dark'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-loga-red hover:bg-loga-red/5'
            )}
          >
            {priv ? <EyeOff size={11} strokeWidth={2.5} /> : <Eye size={11} strokeWidth={2.5} />}
            {priv ? 'Oculto' : 'Privacidad'}
          </button>
          <div className="w-px h-4 bg-zinc-200 dark:bg-white/10 mx-1" />
          {[
            { tipo: 'pedidos',     label: 'Pedidos' },
            { tipo: 'produccion',  label: 'Producción' },
            { tipo: 'inventario',  label: 'Inventario' },
          ].map(({ tipo, label }) => (
            <button key={tipo} onClick={() => exportar(tipo)}
              className="group inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-loga-red hover:bg-loga-red/5 rounded-md transition-colors">
              {label}
              <Download size={10} strokeWidth={2} className="opacity-50 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-200 dark:bg-white/10 mx-1" />
          <button onClick={() => {
            const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';
            const url = `/api/finanzas/informe-plastico?desde=${año}-01-01&hasta=${año}-12-31`;
            fetch(url, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.blob())
              .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `informe-plastico-${año}.csv`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              })
              .catch(e => console.error('Error:', e));
          }}
            className="group inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-loga-red hover:bg-loga-red/5 rounded-md transition-colors">
            Plástico {año}
            <Download size={10} strokeWidth={2} className="opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  HERO — número grande con red accent line                ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="relative px-6 sm:px-10 pt-10 sm:pt-14 pb-10 overflow-hidden">
        {/* Subtle red glow background */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-loga-red/[0.04] blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-y-8 gap-x-10">

          {/* Facturación principal */}
          <div className="lg:col-span-7">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-3 rounded-sm bg-loga-red" />
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-loga-red">Facturación</span>
              <span className="text-[10px] text-zinc-400 tabular-nums">· {fmtInt(data.ventas.num_pedidos)} pedidos completados</span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-[56px] sm:text-[80px] font-bold text-zinc-900 dark:text-white tracking-[-0.04em] leading-none tabular-nums">
                {priv ? '**' : fmt(data.ventas.facturacion_total).split(',')[0]}
                {!priv && <span className="text-zinc-300 dark:text-zinc-600 font-normal">,{fmt(data.ventas.facturacion_total).split(',')[1] ?? '00'}</span>}
              </h2>
              <span className="text-base font-bold text-loga-red tracking-tight">EUR</span>
            </div>
          </div>

          {/* 3 stats laterales */}
          <div className="lg:col-span-5 grid grid-cols-3 lg:flex lg:flex-col lg:justify-end gap-y-5 gap-x-4 lg:gap-y-4 lg:border-l lg:border-zinc-200 lg:dark:border-white/10 lg:pl-10">
            <HeroStat
              label="Beneficio bruto"
              value={mi(beneficioBruto)}
              hint={`${margenPct.toFixed(1)}% margen`}
              positive={beneficioBruto >= 0}
              icon={TrendingUp}
              accent="emerald"
            />
            <HeroStat
              label="Coste producción"
              value={mi(data.costeProd.coste_total)}
              hint={`${fmtInt(data.costeProd.num_ordenes)} órdenes`}
              icon={Factory}
              accent="amber"
            />
            <HeroStat
              label="Inmovilizado"
              value={mi(data.inmovilizado.valor_total)}
              hint="stock total"
              icon={Warehouse}
              accent="red"
            />
          </div>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  KPI INLINE — banda con accents coloreados               ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <section className="border-y-2 border-zinc-900 dark:border-white bg-zinc-50 dark:bg-white/[0.02]">
        <div className="px-6 sm:px-10 py-5 grid grid-cols-2 sm:grid-cols-4 divide-x divide-zinc-200 dark:divide-white/10">
          <Inline label="Ticket medio" value={data.ventas.num_pedidos > 0 ? m(data.ventas.facturacion_total / data.ventas.num_pedidos) : (priv ? '**' : '0')} unit="€/pedido" color="violet" />
          <Inline label="Coste/orden" value={data.costeProd.num_ordenes > 0 ? m(data.costeProd.coste_total / data.costeProd.num_ordenes) : (priv ? '**' : '0')} unit="€/orden" color="amber" />
          <Inline label="Rechazada" value={mi(data.rechazos.valor_rechazado)} unit={`${data.rechazos.ordenes_canceladas} órd · ${data.rechazos.lotes_rechazados} lotes`} color="red" />
          <Inline label="Mermas" value={`${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')}`} unit={`kg · ${mi(data.mermas?.total_eur ?? 0)} €`} color="orange" />
        </div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  CHART EVOLUCIÓN — line precision con red brand          ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasMes.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader
            label="Evolución"
            title={`${data.ventasMes.length} meses`}
            icon={TrendingUp}
            extra={
              <div className="flex items-center gap-5 text-[11px]">
                <Stat sub="Pico" value={mi(maxMes)} />
                <Stat sub="Media" value={mi(avgMes)} />
                <Stat sub="Total" value={mi(totalEvolucion)} accent />
              </div>
            }
          />
          <div className="mt-6">
            <PrecisionChart data={data.ventasMes} maxMes={maxMes} minMes={minMes} avgMes={avgMes} priv={priv} />
          </div>
        </motion.section>
      )}

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  RENTABILIDAD                                              ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
        <SectionHeader
          label="Rentabilidad · coste actual"
          title="Por producto"
          icon={Layers}
          hint="Coste real de los lotes en almacén"
          extra={
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Buscar"
                  value={rentaSearch}
                  onChange={(e) => setRentaSearch(e.target.value)}
                  className="w-32 sm:w-40 h-7 bg-zinc-100 dark:bg-white/5 border-0 pl-7 pr-2 text-[11px] outline-none focus:bg-white dark:focus:bg-white/10 focus:ring-2 focus:ring-loga-red/30 rounded-md placeholder:text-zinc-400 transition-all"
                />
              </div>
              <div className="flex items-center text-[11px] font-medium">
                {([
                  { v: 'todos',              l: 'Todos' },
                  { v: 'producto_fabricado', l: 'Producto fabricado' },
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
                          ? 'bg-loga-red text-white border-loga-red'
                          : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-loga-red/5 hover:text-loga-red'
                      )}>
                      {l}
                      <span className={clsx('text-[10px] tabular-nums', active ? 'opacity-80' : 'text-zinc-400')}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        <div className="mt-6 border-t-2 border-zinc-900 dark:border-white">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.12em] font-semibold text-zinc-500 bg-zinc-50/50 dark:bg-white/[0.02]">
                <th className="text-left py-3 px-3 w-[40%]">Producto</th>
                <Sort label="Venta" active={rentaSort.key === 'venta'} dir={rentaSort.dir} onClick={() => ordenarPor('venta')} />
                <Sort label="Coste" active={rentaSort.key === 'coste'} dir={rentaSort.dir} onClick={() => ordenarPor('coste')} />
                <Sort label="Margen" active={rentaSort.key === 'margen'} dir={rentaSort.dir} onClick={() => ordenarPor('margen')} />
                <th className="text-right py-3 px-3 w-16">Δ</th>
                <Sort label="Beneficio" active={rentaSort.key === 'beneficio'} dir={rentaSort.dir} onClick={() => ordenarPor('beneficio')} />
              </tr>
            </thead>
            <tbody>
              {rentabilidadFiltrada.map((r, i) => {
                const margen = parseFloat(String(r.margen_pct));
                const isOpen = desgloseId === r.id;
                const margenStyle = margen < 20
                  ? { text: 'text-loga-red', bg: 'bg-loga-red/10', dot: 'bg-loga-red' }
                  : margen < 40
                  ? { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-500' }
                  : { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' };
                const tipoStyle = r.tipo === 'producto_fabricado'
                  ? { text: 'text-loga-red', bg: 'bg-loga-red/10', label: 'Producto fabricado' }
                  : { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', label: 'Envasado' };
                return (
                  <React.Fragment key={r.id}>
                    <motion.tr
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.012, duration: 0.2 }}
                      onClick={() => setDesgloseId(isOpen ? null : r.id)}
                      className={clsx(
                        'border-t border-zinc-100 dark:border-white/5 cursor-pointer group transition-colors',
                        isOpen ? 'bg-loga-red/[0.03] dark:bg-loga-red/[0.08]' : 'hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]'
                      )}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <span className={clsx(
                            'transition-colors shrink-0',
                            isOpen ? 'text-loga-red' : 'text-zinc-300 dark:text-zinc-600 group-hover:text-loga-red'
                          )}>
                            {isOpen ? <Minus size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                          </span>
                          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', margenStyle.dot)} />
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{r.nombre}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-zinc-400 tabular-nums">{r.codigo}</span>
                              <span className={clsx('rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider', tipoStyle.bg, tipoStyle.text)}>
                                {tipoStyle.label}
                              </span>
                              {r.precio_kg != null && (
                                <span className="text-[10px] text-zinc-500 tabular-nums">· {m(r.precio_kg)} €/kg</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className="text-[12px] tabular-nums text-zinc-900 dark:text-white font-medium">{m(r.precio_venta)}</p>
                        <p className="text-[9px] text-zinc-400 tabular-nums">€/{r.unidad_medida}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className="text-[12px] tabular-nums text-zinc-700 dark:text-zinc-300">{m(r.precio_coste)}</p>
                        <p className="text-[9px] text-zinc-400 tabular-nums">€/{r.unidad_medida}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={clsx('inline-flex items-center rounded-md px-2 py-1 text-[12px] font-bold tabular-nums', margenStyle.bg, margenStyle.text)}>
                          {margen.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {r.diff_margen != null && r.diff_margen !== 0 ? (
                          <span className={clsx(
                            'inline-flex items-center gap-0.5 text-[11px] tabular-nums font-bold',
                            r.diff_margen > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-loga-red'
                          )}>
                            {r.diff_margen > 0 ? <ArrowUpRight size={9} strokeWidth={2.5} /> : <ArrowDownRight size={9} strokeWidth={2.5} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}
                          </span>
                        ) : <span className="text-zinc-300 text-[11px]">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <p className="text-[12px] tabular-nums font-bold text-zinc-900 dark:text-white">{m(r.beneficio_ud)}</p>
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
                              className="bg-gradient-to-b from-loga-red/[0.03] to-transparent dark:from-loga-red/[0.08] border-t border-loga-red/20"
                            >
                              <div className="px-9 py-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Layers size={11} className="text-loga-red" strokeWidth={2.5} />
                                  <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-loga-red">Desglose de coste</span>
                                  <span className="h-px flex-1 bg-loga-red/20" />
                                </div>
                                <div className="grid grid-cols-12 gap-3 text-[10px] uppercase tracking-[0.1em] font-bold text-zinc-400 mb-2 pb-2 border-b border-zinc-200 dark:border-white/10">
                                  <span className="col-span-5">Ingrediente</span>
                                  <span className="col-span-3 text-right">Cantidad</span>
                                  <span className="col-span-2 text-right">Precio</span>
                                  <span className="col-span-2 text-right">Coste por batch</span>
                                </div>
                                {r.desglose.map((d, j) => (
                                  <div key={j} className="grid grid-cols-12 gap-3 text-[11px] py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                                    <span className="col-span-5 text-zinc-700 dark:text-zinc-300 font-medium">{d.nombre}</span>
                                    <span className="col-span-3 text-right tabular-nums text-zinc-500">{d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {d.unidad}</span>
                                    <span className="col-span-2 text-right tabular-nums text-zinc-500">{m(d.precio_ud)}</span>
                                    <span className="col-span-2 text-right tabular-nums text-zinc-900 dark:text-white font-bold">{m(d.coste_linea)}</span>
                                  </div>
                                ))}
                                <div className="grid grid-cols-12 gap-3 text-[11px] pt-2.5 mt-1.5 border-t border-zinc-300 dark:border-white/20 font-bold">
                                  <span className="col-span-10 text-zinc-900 dark:text-white">
                                    Total batch{r.rendimiento && r.rendimiento > 1 ? ` · ${r.rendimiento} ${r.unidad_medida}` : ''}
                                  </span>
                                  <span className="col-span-2 text-right tabular-nums text-zinc-900 dark:text-white">{m(r.coste_batch ?? r.precio_coste)} €</span>
                                </div>
                                {r.rendimiento && r.rendimiento > 1 && (
                                  <div className="grid grid-cols-12 gap-3 text-[11px] pt-1.5 mt-1.5 bg-loga-red/10 -mx-2 px-2 py-1.5 rounded font-bold text-loga-red">
                                    <span className="col-span-10">Coste por {r.unidad_medida}</span>
                                    <span className="col-span-2 text-right tabular-nums">{m(r.precio_coste)} €</span>
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
          <div className="border-t-2 border-zinc-900 dark:border-white" />
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  INVENTARIO — distribución + top 10                       ║
          ╚══════════════════════════════════════════════════════════╝ */}
      <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

          {/* Distribución (5 cols) */}
          <div className="lg:col-span-5">
            <SectionHeader label="Distribución" title="Por categoría" icon={Package} />

            <div className="mt-6 space-y-0">
              {([
                { label: 'Materia prima', value: data.inmovilizado.valor_mp,  color: '#3b82f6', icon: Beaker },
                { label: 'Fabricado',     value: data.inmovilizado.valor_fab, color: '#FF0000', icon: Zap },
                { label: 'Envasado',      value: data.inmovilizado.valor_env, color: '#10b981', icon: Package },
                { label: 'Embalaje',      value: data.inmovilizado.valor_emb, color: '#f59e0b', icon: Package },
              ]).map(({ label, value, color, icon: Icon }, i) => {
                const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                return (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 + i * 0.04, duration: 0.2 }}
                    className="group"
                  >
                    <div className="flex items-baseline justify-between py-2.5 border-t border-zinc-200 dark:border-white/10 first:border-t-0">
                      <div className="flex items-center gap-2.5">
                        <div className="rounded p-1" style={{ backgroundColor: `${color}15` }}>
                          <Icon size={10} style={{ color }} strokeWidth={2.5} />
                        </div>
                        <span className="text-[12px] font-medium text-zinc-900 dark:text-white">{label}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="text-[10px] tabular-nums text-zinc-400 font-bold">{pct.toFixed(1)}%</span>
                        <span className="text-[13px] font-bold tabular-nums text-zinc-900 dark:text-white w-32 text-right">{mi(value)} <span className="text-[10px] text-zinc-400 font-normal">€</span></span>
                      </div>
                    </div>
                    <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                        transition={{ delay: 0.2 + i * 0.04, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        style={{ backgroundColor: color, transformOrigin: 'left' }}
                        className="h-full rounded-full"
                      />
                    </div>
                  </motion.div>
                );
              })}
              <div className="flex items-baseline justify-between py-3 border-t-2 border-loga-red mt-2">
                <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-loga-red">Total inventario</span>
                <span className="text-[20px] font-bold tabular-nums text-zinc-900 dark:text-white">
                  {mi(data.inmovilizado.valor_total)} <span className="text-[12px] text-loga-red font-bold">EUR</span>
                </span>
              </div>
            </div>
          </div>

          {/* Top 10 (7 cols) */}
          <div className="lg:col-span-7">
            <SectionHeader
              label="Inmovilizado"
              title={`Top ${data.topInmovilizado.length > 10 ? 10 : data.topInmovilizado.length}`}
              icon={Layers}
            />

            <ol className="mt-6 border-t border-zinc-200 dark:border-white/10">
              {data.topInmovilizado.slice(0, 10).map((p, i) => {
                const val = parseFloat(String(p.valor));
                const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                const tipoConfig = p.tipo === 'producto_fabricado'
                  ? { color: '#FF0000', label: 'Producto fabricado' }
                  : p.tipo === 'producto_envasado'
                  ? { color: '#10b981', label: 'Envasado' }
                  : p.tipo === 'materia_prima'
                  ? { color: '#3b82f6', label: 'MP' }
                  : { color: '#f59e0b', label: 'Embalaje' };
                return (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 + i * 0.025, duration: 0.2 }}
                    className="grid grid-cols-12 gap-3 items-center py-2.5 border-b border-zinc-100 dark:border-white/5 group hover:bg-loga-red/[0.02] transition-colors px-2 -mx-2 rounded"
                  >
                    <span className="col-span-1 text-[10px] text-zinc-400 group-hover:text-loga-red tabular-nums font-bold transition-colors">{String(i + 1).padStart(2, '0')}</span>
                    <div className="col-span-5 min-w-0 flex items-center gap-2">
                      <span className="w-1 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: tipoConfig.color }} />
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{p.nombre}</p>
                        <p className="text-[10px] text-zinc-400 tabular-nums">{fmtInt(parseFloat(String(p.stock_actual)))} {p.unidad_medida}</p>
                      </div>
                    </div>
                    <div className="col-span-4 hidden sm:block">
                      <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                          transition={{ delay: 0.2 + i * 0.025, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          style={{ transformOrigin: 'left', backgroundColor: tipoConfig.color }}
                          className="h-full rounded-full"
                        />
                      </div>
                    </div>
                    <span className="col-span-2 text-right text-[12px] font-bold tabular-nums text-zinc-900 dark:text-white">{mi(val)} <span className="text-[9px] text-zinc-400 font-normal">€</span></span>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </div>
      </motion.section>

      {/* ╔══════════════════════════════════════════════════════════╗
          ║  TOP VENTAS                                                ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {data.ventasProducto.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader label="Ventas" title="Top productos" icon={TrendingUp} />

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-x-10">
            {data.ventasProducto.map((v, i) => {
              const fact = parseFloat(String(v.facturacion));
              const cantidad = parseFloat(String(v.cantidad_vendida));
              const maxFact = parseFloat(String(data.ventasProducto[0]?.facturacion ?? 1));
              const pct = maxFact > 0 ? (fact / maxFact) * 100 : 0;
              const precioEf = cantidad > 0 ? fact / cantidad : 0;
              const isTop3 = i < 3;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 * i, duration: 0.2 }}
                  className="grid grid-cols-12 gap-3 items-center py-3 border-t border-zinc-100 dark:border-white/5 first:border-t-0 lg:[&:nth-child(2)]:border-t-0 group hover:bg-loga-red/[0.02] transition-colors px-2 -mx-2 rounded"
                >
                  <span className={clsx(
                    'col-span-1 inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] tabular-nums font-bold',
                    isTop3 ? 'bg-loga-red text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  )}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="col-span-7 min-w-0">
                    <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{v.nombre}</p>
                    <p className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                      {fmtInt(cantidad)} {v.unidad_medida} · {m(precioEf)} €/{v.unidad_medida}
                    </p>
                    <div className="h-1 bg-zinc-100 dark:bg-zinc-800 mt-2 relative overflow-hidden rounded-full">
                      <motion.div
                        initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                        transition={{ delay: 0.15 + i * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        style={{ transformOrigin: 'left' }}
                        className="absolute inset-0 bg-gradient-to-r from-loga-red to-red-400 rounded-full"
                      />
                    </div>
                  </div>
                  <div className="col-span-4 text-right">
                    <p className="text-[14px] font-bold tabular-nums text-zinc-900 dark:text-white">{mi(fact)}</p>
                    <p className="text-[9px] text-loga-red font-bold uppercase tracking-wider">EUR</p>
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
          <SectionHeader label="Impacto · coste futuro" title="Variación de margen" hint="PVP + coste anterior vs futuro proyectado (precios ficha MP). Envasados incluyen coste de cola + envase + materiales recursivamente." icon={Activity} />

          {/* Tabs de filtro: todos / granel / envasado */}
          {(() => {
            const granel = impactoRecetas.filter(r => r.producto_tipo === 'producto_fabricado' || r.tipo_receta === 'fabricacion');
            const envasado = impactoRecetas.filter(r => r.producto_tipo === 'producto_envasado' || r.tipo_receta === 'envasado');
            const otros = impactoRecetas.filter(r =>
              !(r.producto_tipo === 'producto_fabricado' || r.tipo_receta === 'fabricacion') &&
              !(r.producto_tipo === 'producto_envasado' || r.tipo_receta === 'envasado')
            );
            return (
              <div className="mt-4 inline-flex rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-1 gap-1">
                {([
                  { key: 'todos',    label: 'Todos',    n: impactoRecetas.length },
                  { key: 'granel',   label: 'Producto fabricado',   n: granel.length + otros.length },
                  { key: 'envasado', label: 'Envasado', n: envasado.length },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setFiltroImpacto(opt.key)}
                    className={clsx(
                      'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                      filtroImpacto === opt.key
                        ? 'bg-loga-red text-white shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
                    )}
                  >
                    {opt.label}
                    <span className={clsx(
                      'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                      filtroImpacto === opt.key ? 'bg-white/20' : 'bg-zinc-100 dark:bg-white/10'
                    )}>
                      {opt.n}
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}

          <div className="mt-6 border-t border-zinc-200 dark:border-white/10">
            {impactoRecetas
              .filter(r => {
                if (filtroImpacto === 'todos') return true;
                if (filtroImpacto === 'envasado') return r.producto_tipo === 'producto_envasado' || r.tipo_receta === 'envasado';
                // granel = fabricado + cualquier otro que no sea envasado
                return !(r.producto_tipo === 'producto_envasado' || r.tipo_receta === 'envasado');
              })
              .map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const diffPositivo = r.diff_margen > 0;
              const diffNegativo = r.diff_margen < 0;
              const pvpCambio = r.pvp_anterior && r.pvp_actual && Math.abs(r.pvp_actual - r.pvp_anterior) > 0.01;
              const margenColor = r.margen_actual > 40 ? 'text-emerald-600 dark:text-emerald-400'
                : r.margen_actual > 20 ? 'text-amber-700 dark:text-amber-400' : 'text-loga-red';
              return (
                <div key={r.receta_nombre} className="border-b border-zinc-100 dark:border-white/5">
                  <button
                    onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)}
                    className={clsx(
                      'w-full grid grid-cols-12 gap-3 items-center py-3 text-left transition-colors px-2 -mx-2 rounded',
                      expanded
                        ? 'bg-loga-red/[0.04] dark:bg-loga-red/[0.08]'
                        : diffNegativo ? 'hover:bg-loga-red/[0.02]'
                        : 'hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]'
                    )}
                  >
                    <span className={clsx(
                      'col-span-1 w-1 h-3.5 rounded-sm justify-self-center',
                      diffNegativo ? 'bg-loga-red' : diffPositivo ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                    )} />
                    <div className="col-span-12 sm:col-span-6 min-w-0">
                      <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{r.producto_nombre}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums truncate">
                        {r.receta_nombre}
                        {r.pvp_actual !== undefined && <span> · <span className="font-medium text-zinc-700 dark:text-zinc-300">{m(r.pvp_actual)}</span> €/{r.unidad_medida}</span>}
                        {pvpCambio && <span className="text-zinc-400"> (ant {m(r.pvp_anterior!)})</span>}
                      </p>
                    </div>
                    <div className="col-span-6 sm:col-span-2 text-right" title={`Coste de fabricar 1 ${r.unidad_medida} con precios futuros (precio ficha de las MP)`}>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-400 font-bold">Coste / {r.unidad_medida}</p>
                      <p className="text-[12px] tabular-nums text-zinc-900 dark:text-white font-medium">{m(r.coste_actual, 4)} <span className="text-[9px] text-zinc-400 font-normal">€/{r.unidad_medida}</span></p>
                      {r.coste_batch_actual != null && r.rendimiento && r.rendimiento > 1 && (
                        <p className="text-[10px] tabular-nums text-zinc-500" title={`Coste total de un batch de ${r.rendimiento} ${r.unidad_medida}`}>
                          batch: <b>{m(r.coste_batch_actual)}</b> <span className="text-[9px] text-zinc-400">€</span>
                        </p>
                      )}
                      {r.diff_coste !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums font-bold', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} title={`Subida/bajada de coste por ${r.unidad_medida} respecto al periodo anterior`}>
                          {priv ? (r.diff_coste > 0 ? '+**' : '-**') : `${r.diff_coste > 0 ? '+' : ''}${r.diff_coste.toFixed(4)} €/${r.unidad_medida}`}
                        </p>
                      )}
                    </div>
                    <div className="col-span-5 sm:col-span-2 text-right" title={`Margen sobre PVP: (PVP − coste) / PVP × 100. Pestaña sobre el % indica cuánto te queda de cada euro vendido`}>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-zinc-400 font-bold">Margen s/PVP</p>
                      <p className={clsx('text-[14px] font-bold tabular-nums', margenColor)}>{r.margen_actual.toFixed(1)}%</p>
                      {r.diff_margen !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums inline-flex items-center gap-0.5 font-bold', diffNegativo ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} title="Variación en puntos porcentuales (pp): si margen pasa de 90% a 88%, son -2pp (NO -2%)">
                          {diffPositivo ? <ArrowUpRight size={9} strokeWidth={2.5} /> : <ArrowDownRight size={9} strokeWidth={2.5} />}
                          {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)} pp
                        </p>
                      )}
                    </div>
                    <ChevronDown size={12} className={clsx('col-span-1 justify-self-end transition-transform', expanded ? 'rotate-180 text-loga-red' : 'text-zinc-400')} strokeWidth={2.5} />
                  </button>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                        className="overflow-hidden bg-gradient-to-b from-loga-red/[0.03] to-transparent dark:from-loga-red/[0.08]"
                      >
                        <div className="px-9 py-4">
                          {r.salud && (
                            <p className="text-[11px] text-zinc-700 dark:text-zinc-300 mb-3 italic border-l-2 border-loga-red pl-3 font-medium">
                              {r.salud}
                            </p>
                          )}
                          {r.detalle_mp.length === 0 ? (
                            <p className="text-[11px] text-zinc-500 italic text-center py-4">
                              Esta receta no tiene ingredientes registrados. Edítala para añadir cola, envases y materiales.
                            </p>
                          ) : (
                            <>
                              <p className="text-[10px] text-zinc-500 mb-3 italic leading-relaxed">
                                <b className="text-emerald-600 dark:text-emerald-400">Precio actual</b>: el del lote más barato que tienes en almacén ahora.{' '}
                                <b className="text-amber-600 dark:text-amber-400">Precio tras subida</b>: el del lote más caro en stock — lo que pagarás cuando se acabe el barato.{' '}
                                Si no hay stock propio, se calcula con los precios mín/máx de sus materias primas.
                              </p>
                              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-[0.1em] font-bold text-zinc-400 mb-2 pb-2 border-b border-zinc-200 dark:border-white/10">
                                <span className="col-span-3">Ingrediente</span>
                                <span className="col-span-1 text-right">Cant.</span>
                                <span className="col-span-2 text-right text-emerald-600 dark:text-emerald-400" title="Precio del lote más barato disponible en almacén — el que se está consumiendo ahora">Precio actual</span>
                                <span className="col-span-2 text-right text-amber-600 dark:text-amber-400" title="Precio del lote más caro disponible — lo que pagarás cuando se acabe el barato">Precio tras subida</span>
                                <span className="col-span-2 text-right text-emerald-600 dark:text-emerald-400" title="Cantidad × precio actual = coste de fabricar este batch hoy">Coste fabricación actual</span>
                                <span className="col-span-2 text-right text-amber-600 dark:text-amber-400" title="Cantidad × precio tras subida = coste cuando se acabe el lote barato">Coste con subida</span>
                              </div>
                              {r.detalle_mp.map((mp, i) => {
                                const pMin = mp.precio_stock_min ?? mp.precio_actual;
                                const pMax = mp.precio_stock_max ?? mp.precio_actual;
                                const costeActual = mp.cantidad * pMin;
                                const costeFuturo = mp.cantidad * pMax;
                                const haySpread = Math.abs(pMax - pMin) > 0.0001;
                                const sourceLabel = mp.stock_source === 'lots' ? null
                                  : mp.stock_source === 'recursive' ? 'calculado de sus MP'
                                  : 'precio ficha · sin stock';
                                return (
                                  <div key={i} className="grid grid-cols-12 gap-2 text-[11px] py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                                    <span className="col-span-3 text-zinc-700 dark:text-zinc-300 font-medium truncate" title={mp.nombre}>{mp.nombre}</span>
                                    <span className="col-span-1 text-right tabular-nums text-zinc-500">{mp.cantidad.toFixed(3)}</span>
                                    <span className="col-span-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">
                                      {priv ? '**' : m(pMin, 4)}
                                      {sourceLabel && (
                                        <span className="block text-[8px] font-normal text-zinc-400 italic">{sourceLabel}</span>
                                      )}
                                    </span>
                                    <span className="col-span-2 text-right tabular-nums text-amber-700 dark:text-amber-300 font-semibold">
                                      {priv ? '**' : m(pMax, 4)}
                                      {haySpread && (
                                        <span className="block text-[8px] font-normal text-amber-600">+{((pMax - pMin) / pMin * 100).toFixed(0)}% vs actual</span>
                                      )}
                                    </span>
                                    <span className="col-span-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300 font-bold">
                                      {priv ? '**' : costeActual.toFixed(2)} €
                                    </span>
                                    <span className="col-span-2 text-right tabular-nums text-amber-700 dark:text-amber-300 font-bold">
                                      {priv ? '**' : costeFuturo.toFixed(2)} €
                                    </span>
                                  </div>
                                );
                              })}
                              {/* Totales: dos columnas (barato vs caro) */}
                              <div className="grid grid-cols-12 gap-2 text-[11px] py-2 mt-1 border-t-2 border-zinc-300 dark:border-white/20">
                                <span className="col-span-8 text-right text-zinc-500 font-bold uppercase text-[10px] tracking-wide">
                                  Total receta {r.rendimiento && r.rendimiento > 1 ? `· batch ${r.rendimiento} ${r.unidad_medida}` : ''}
                                </span>
                                <span className="col-span-2 text-right tabular-nums">
                                  <span className="block text-emerald-700 dark:text-emerald-300 font-bold">
                                    {priv ? '**' : (r.coste_stock_min_batch ?? 0).toFixed(2)} €
                                  </span>
                                  <span className="block text-[9px] text-emerald-600 dark:text-emerald-400 font-normal">coste fabricación actual</span>
                                </span>
                                <span className="col-span-2 text-right tabular-nums">
                                  <span className="block text-amber-700 dark:text-amber-300 font-bold">
                                    {priv ? '**' : (r.coste_stock_max_batch ?? 0).toFixed(2)} €
                                  </span>
                                  <span className="block text-[9px] text-amber-600 dark:text-amber-400 font-normal">coste tras subida MP</span>
                                </span>
                              </div>
                              {/* Coste por unidad final */}
                              <div className="grid grid-cols-12 gap-2 text-[11px] py-1">
                                <span className="col-span-8 text-right text-zinc-400 italic text-[10px]">coste de producción por {r.unidad_medida}</span>
                                <span className="col-span-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300 font-bold">
                                  {priv ? '**' : (r.coste_stock_min ?? 0).toFixed(4)} €
                                </span>
                                <span className="col-span-2 text-right tabular-nums text-amber-700 dark:text-amber-300 font-bold">
                                  {priv ? '**' : (r.coste_stock_max ?? 0).toFixed(4)} €
                                </span>
                              </div>
                            </>
                          )}
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
          ║  MATERIAS PRIMAS — heatmap intensity                      ║
          ╚══════════════════════════════════════════════════════════╝ */}
      {mpPrecios.length > 0 && (
        <motion.section {...FADE} className="px-6 sm:px-10 py-10 border-b border-zinc-200 dark:border-white/10">
          <SectionHeader label="Materias primas" title="Variación 90 días" hint="Ordenadas por volatilidad" icon={Beaker} />

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {[...mpPrecios]
              .sort((a, b) => Math.abs(parseFloat(b.variacion_pct)) - Math.abs(parseFloat(a.variacion_pct)))
              .map((item, i) => {
                const variacion = parseFloat(item.variacion_pct);
                const isUp = variacion > 0;
                const ant = item.precio_anterior ? parseFloat(item.precio_anterior) : null;
                const act = parseFloat(item.precio_actual);
                const intensity = Math.min(Math.abs(variacion) / 30, 1);
                return (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.025 * i, duration: 0.2 }}
                    onClick={async () => {
                      setMpDetalle(item);
                      setMpDetalleHist([]);
                      setMpDetalleLoading(true);
                      try {
                        const { data } = await finanzasApi.historialPrecios(item.id);
                        setMpDetalleHist((data as PrecioHistRow[]).filter(r => r.tipo === 'compra'));
                      } catch { setMpDetalleHist([]); }
                      finally { setMpDetalleLoading(false); }
                    }}
                    className="text-left grid grid-cols-12 items-baseline gap-2 py-2.5 border-t border-zinc-100 dark:border-white/5 first:border-t-0 md:[&:nth-child(2)]:border-t-0 lg:[&:nth-child(3)]:border-t-0 group rounded px-2 -mx-2 transition-colors hover:bg-zinc-50/60 dark:hover:bg-white/[0.02] relative overflow-hidden cursor-pointer"
                  >
                    {/* Background tint según variación */}
                    {variacion !== 0 && (
                      <div
                        className="absolute inset-0 pointer-events-none opacity-50"
                        style={{
                          background: `linear-gradient(90deg, transparent 0%, ${isUp ? '#FF0000' : '#10b981'}${Math.round(intensity * 12).toString(16).padStart(2, '0')} 100%)`,
                        }}
                      />
                    )}
                    <div className="col-span-7 min-w-0 relative">
                      <p className="text-[12px] font-medium text-zinc-900 dark:text-white truncate">{item.nombre}</p>
                      <p className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                        {ant != null ? m(ant, 4) : '—'} → <span className="text-zinc-900 dark:text-white font-bold">{m(act, 4)}</span> €/{item.unidad_medida}
                      </p>
                    </div>
                    <div className="col-span-5 text-right relative">
                      {item.precio_anterior && variacion !== 0 ? (
                        <span className={clsx(
                          'inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[12px] tabular-nums font-bold',
                          isUp ? 'bg-loga-red/15 text-loga-red' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        )}>
                          {isUp ? <ArrowUpRight size={11} strokeWidth={2.5} /> : <ArrowDownRight size={11} strokeWidth={2.5} />}
                          {isUp ? '+' : ''}{variacion.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-300">—</span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
          </div>
        </motion.section>
      )}

      {/* Modal detalle MP — gráfico de historial de precios */}
      {mpDetalle && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMpDetalle(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-red-50 to-white border-b border-red-100 shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-loga-red uppercase tracking-wider">Historial de precio</p>
                <p className="text-base font-bold text-gray-900 truncate">{mpDetalle.nombre}</p>
                <p className="text-[11px] text-gray-500 font-mono">{mpDetalle.codigo}</p>
              </div>
              <button onClick={() => setMpDetalle(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {mpDetalleLoading ? (
                <p className="text-xs text-gray-400 text-center py-6">Cargando…</p>
              ) : mpDetalleHist.length === 0 ? (
                <p className="text-xs text-gray-400 italic text-center py-6">Sin cambios de precio registrados.</p>
              ) : (() => {
                // Ordenar ASC para gráfico cronológico. Ignoramos los registros
                // con precio_nuevo ≤ 0.01 (entradas iniciales sin precio real)
                // — solo distorsionan el gráfico y la subida acumulada.
                const hist = [...mpDetalleHist]
                  .filter(h => parseFloat(h.precio_nuevo) > 0.01)
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                if (hist.length === 0) {
                  return <p className="text-xs text-gray-400 italic text-center py-6">Sin cambios de precio &gt; 0,01 € registrados.</p>;
                }
                const precios = hist.map(h => parseFloat(h.precio_nuevo));
                const minP = Math.min(...precios);
                const maxP = Math.max(...precios);
                const rangeP = maxP - minP || 1;
                const W = 600, H = 180, padX = 30, padY = 20;
                const xStep = hist.length > 1 ? (W - 2 * padX) / (hist.length - 1) : 0;
                const yOf = (p: number) => H - padY - ((p - minP) / rangeP) * (H - 2 * padY);
                const points = hist.map((h, i) => ({ x: padX + i * xStep, y: yOf(parseFloat(h.precio_nuevo)), p: parseFloat(h.precio_nuevo), d: h.created_at }));
                const pathD = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
                // Primer precio "real" = precio_anterior de la primera fila si es > 0.01,
                // si no precio_nuevo de la primera. Así el 0→3 no aparece como cambio.
                const primerPrecio = (() => {
                  const ant = parseFloat(hist[0].precio_anterior ?? '0');
                  return ant > 0.01 ? ant : parseFloat(hist[0].precio_nuevo);
                })();
                const ultPrecio = parseFloat(hist[hist.length - 1].precio_nuevo);
                const acumPct = primerPrecio > 0 ? ((ultPrecio - primerPrecio) / primerPrecio) * 100 : 0;
                const acumAbs = ultPrecio - primerPrecio;
                return (
                  <>
                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Precio actual</p>
                        <p className="text-lg font-bold text-gray-900 tabular-nums">{ultPrecio.toFixed(4)} €</p>
                        <p className="text-[10px] text-gray-400">/ {mpDetalle.unidad_medida}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Primer precio registrado</p>
                        <p className="text-lg font-bold text-gray-900 tabular-nums">{primerPrecio.toFixed(4)} €</p>
                        <p className="text-[10px] text-gray-400">{new Date(hist[0].created_at).toLocaleDateString('es-ES')}</p>
                      </div>
                      <div className={clsx(
                        "rounded-lg border p-3",
                        acumPct > 0 ? "border-loga-red/30 bg-loga-red/10" : acumPct < 0 ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-gray-50"
                      )}>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Subida acumulada</p>
                        <p className={clsx("text-lg font-bold tabular-nums", acumPct > 0 ? "text-loga-red" : acumPct < 0 ? "text-emerald-700" : "text-gray-900")}>
                          {acumPct > 0 ? '+' : ''}{acumPct.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-gray-500 tabular-nums">{acumAbs > 0 ? '+' : ''}{acumAbs.toFixed(4)} €/{mpDetalle.unidad_medida}</p>
                      </div>
                    </div>

                    {/* Gráfico SVG */}
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-2">Evolución del precio</p>
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
                        {/* Eje Y referencia */}
                        <text x={4} y={padY + 4} fontSize="9" fill="#9ca3af">{maxP.toFixed(2)}</text>
                        <text x={4} y={H - padY + 4} fontSize="9" fill="#9ca3af">{minP.toFixed(2)}</text>
                        <line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="#e5e7eb" strokeWidth="1" />
                        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="#e5e7eb" strokeWidth="1" />
                        {/* Path */}
                        <path d={pathD} fill="none" stroke="#FF0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        {/* Dots */}
                        {points.map((pt, i) => (
                          <g key={i}>
                            <circle cx={pt.x} cy={pt.y} r={3} fill="#FF0000" />
                            <title>{`${pt.p.toFixed(4)} € — ${new Date(pt.d).toLocaleDateString('es-ES')}`}</title>
                          </g>
                        ))}
                      </svg>
                    </div>

                    {/* Tabla de cambios */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-2">Cambios de precio ({hist.length})</p>
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr className="text-gray-500">
                              <th className="text-left px-3 py-2 font-medium">Fecha</th>
                              <th className="text-right px-3 py-2 font-medium">Precio anterior</th>
                              <th className="text-right px-3 py-2 font-medium">Precio nuevo</th>
                              <th className="text-right px-3 py-2 font-medium">Δ</th>
                              <th className="text-left px-3 py-2 font-medium">Motivo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {[...hist].reverse().map((h, i) => {
                              const ant = h.precio_anterior ? parseFloat(h.precio_anterior) : null;
                              const nuevo = parseFloat(h.precio_nuevo);
                              const delta = ant != null ? nuevo - ant : null;
                              const deltaPct = ant != null && ant > 0 ? ((nuevo - ant) / ant) * 100 : null;
                              return (
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{new Date(h.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{ant != null ? `${ant.toFixed(4)} €` : '—'}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{nuevo.toFixed(4)} €</td>
                                  <td className={clsx('px-3 py-2 text-right tabular-nums font-bold',
                                    delta == null ? 'text-gray-300' :
                                    delta > 0 ? 'text-loga-red' :
                                    delta < 0 ? 'text-emerald-700' : 'text-gray-400'
                                  )}>
                                    {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(4)}`}
                                    {deltaPct != null && delta !== 0 && (
                                      <span className="block text-[10px] font-normal opacity-70">
                                        ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500 truncate" title={h.motivo ?? undefined}>{h.motivo ?? '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </motion.div>
        </div>
      )}

      <div className="h-12" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════

function HeroStat({ label, value, hint, positive, icon: Icon, accent }: {
  label: string; value: string; hint?: string; positive?: boolean;
  icon: LucideIcon;
  accent: 'red' | 'emerald' | 'amber';
}) {
  const accentClass = accent === 'red' ? 'text-loga-red bg-loga-red/10'
    : accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
    : 'text-amber-600 dark:text-amber-400 bg-amber-500/10';
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={clsx('rounded p-1', accentClass)}>
          <Icon size={10} strokeWidth={2.5} />
        </div>
        <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-zinc-500">{label}</p>
      </div>
      <p className="text-[26px] font-bold text-zinc-900 dark:text-white tabular-nums leading-none tracking-tight">
        {value}
        <span className="text-[12px] font-normal text-zinc-400 ml-1.5">€</span>
      </p>
      {hint && (
        <p className={clsx(
          'text-[11px] tabular-nums mt-1.5 inline-flex items-center gap-0.5 font-medium',
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

function Inline({ label, value, unit, color }: {
  label: string; value: string; unit: string; color: 'red' | 'violet' | 'amber' | 'orange'
}) {
  const accentMap = {
    red:    'text-loga-red',
    violet: 'text-violet-600 dark:text-violet-400',
    amber:  'text-amber-600 dark:text-amber-400',
    orange: 'text-orange-600 dark:text-orange-400',
  };
  const dotMap = {
    red:    'bg-loga-red',
    violet: 'bg-violet-500',
    amber:  'bg-amber-500',
    orange: 'bg-orange-500',
  };
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={clsx('w-1 h-1 rounded-full', dotMap[color])} />
        <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-zinc-500">{label}</p>
      </div>
      <p className={clsx('text-[18px] font-bold tabular-nums leading-none', accentMap[color])}>{value}</p>
      <p className="text-[10px] text-zinc-400 tabular-nums mt-1 truncate">{unit}</p>
    </div>
  );
}

function SectionHeader({ label, title, extra, hint, icon: Icon }: {
  label: string; title: string; extra?: React.ReactNode; hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="rounded-md bg-loga-red/10 p-1.5">
            <Icon size={12} className="text-loga-red" strokeWidth={2.5} />
          </div>
        )}
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-loga-red">{label}</span>
          <span className="h-px w-6 bg-loga-red/40" />
          <h2 className="text-[20px] font-bold text-zinc-900 dark:text-white tracking-tight">{title}</h2>
          {hint && <p className="text-[11px] text-zinc-500 hidden sm:block">{hint}</p>}
        </div>
      </div>
      {extra}
    </div>
  );
}

function Stat({ sub, value, accent }: { sub: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-zinc-400">{sub}</p>
      <p className={clsx('text-[13px] font-bold tabular-nums', accent ? 'text-loga-red' : 'text-zinc-900 dark:text-white')}>{value}</p>
    </div>
  );
}

function Sort({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <th className="text-right py-3 px-3">
      <button onClick={onClick} className={clsx(
        'inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-bold transition-colors',
        active ? 'text-loga-red' : 'text-zinc-500 hover:text-loga-red'
      )}>
        {label}
        <ChevronDown size={9} strokeWidth={2.5} className={clsx('transition-all', active ? 'opacity-100' : 'opacity-30', active && dir === 'asc' && 'rotate-180')} />
      </button>
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PRECISION CHART — más vivo con red brand
// ═══════════════════════════════════════════════════════════════════════
function PrecisionChart({ data, maxMes, minMes, avgMes, priv = false }: { data: VentaMes[]; maxMes: number; minMes: number; avgMes: number; priv?: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 1000;
  const H = 240;
  const padL = 64;
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
          <linearGradient id="pchart-area-v5" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF0000" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y ticks */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="currentColor" strokeWidth="0.5" className="text-zinc-200 dark:text-white/10" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" className="text-[9px] fill-zinc-400 tabular-nums font-medium">
              {moneyInt(t.value, priv)}
            </text>
          </g>
        ))}

        {/* Avg line */}
        <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="#FF0000" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.4" />
        <text x={W - padR - 4} y={avgY - 5} textAnchor="end" className="text-[9px] fill-loga-red font-bold uppercase tracking-wider">
          Media
        </text>

        {/* X labels */}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={H - 8} textAnchor="middle"
            className={clsx('text-[10px] tabular-nums', hoverIdx === i ? 'fill-loga-red font-bold' : 'fill-zinc-500 font-medium')}>
            {p.m.mes_label.split(' ')[0]}
          </text>
        ))}

        {/* Área */}
        <motion.path
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.6 }}
          d={areaPath} fill="url(#pchart-area-v5)"
        />

        {/* Línea */}
        <motion.path
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
          d={linePath} fill="none" stroke="#FF0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        />

        {/* Dots */}
        {points.map((p, i) => {
          const isHover = hoverIdx === i;
          const isAboveAvg = p.v > avgMes;
          return (
            <g key={i}>
              {isHover && (
                <line x1={p.x} y1={p.y} x2={p.x} y2={H - padB} stroke="#FF0000" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
              )}
              <motion.circle
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 1.2 + i * 0.03, duration: 0.2 }}
                cx={p.x} cy={p.y} r={isHover ? 5 : 3}
                fill={isAboveAvg ? '#FF0000' : 'white'}
                stroke="#FF0000" strokeWidth={isHover ? 2.5 : 2}
                className={clsx('transition-all', !isAboveAvg && 'dark:fill-zinc-900')}
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

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute pointer-events-none bg-loga-red text-white px-3 py-2 rounded-md shadow-xl"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 12px))',
            }}
          >
            <p className="text-[9px] uppercase tracking-[0.16em] opacity-80 font-bold">{hovered.m.mes_label}</p>
            <p className="text-[18px] font-bold tabular-nums leading-tight">{moneyInt(hovered.v, priv)} <span className="text-[10px] font-normal opacity-80">EUR</span></p>
            <p className="text-[10px] tabular-nums opacity-90 mt-0.5">{hovered.m.num_pedidos} pedidos · {hovered.v > avgMes ? '+' : ''}{((hovered.v / avgMes - 1) * 100).toFixed(0)}%</p>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-loga-red rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
