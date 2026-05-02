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

// Estilos editoriales reutilizables
const SERIF = { fontFamily: '"Instrument Serif", "Times New Roman", serif' };
const MONO = { fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace' };

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

  // Memos
  const beneficioBruto = useMemo(() => (data ? data.ventas.facturacion_total - data.costeProd.coste_total : 0), [data]);
  const margenPct = useMemo(() => (data && data.ventas.facturacion_total > 0 ? (beneficioBruto / data.ventas.facturacion_total) * 100 : 0), [data, beneficioBruto]);
  const maxMes = useMemo(() => (data ? Math.max(...data.ventasMes.map(v => parseFloat(String(v.total))), 1) : 1), [data]);
  const minMes = useMemo(() => (data ? Math.min(...data.ventasMes.map(v => parseFloat(String(v.total))), 0) : 0), [data]);
  const avgMes = useMemo(() => {
    if (!data || data.ventasMes.length === 0) return 0;
    return data.ventasMes.reduce((s, m) => s + parseFloat(String(m.total)), 0) / data.ventasMes.length;
  }, [data]);

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
          <AlertTriangle size={28} className="mx-auto text-zinc-400" />
          <p className="text-zinc-500 text-xs uppercase tracking-widest">Acceso restringido</p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-loga-red text-xs uppercase tracking-widest">{error || 'Sin datos'}</p>
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

  const fechaHoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in -mx-4 sm:-mx-6 -mt-4 sm:-mt-6">

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  MASTHEAD — barra superior tipo periódico financiero      ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      <div className="border-b border-black dark:border-white/20 px-6 sm:px-12 py-3">
        <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.2em] font-medium">
          <div className="flex items-center gap-4 text-zinc-600 dark:text-zinc-400">
            <span className="font-bold text-black dark:text-white">Loga · Daily Ledger</span>
            <span className="hidden sm:inline text-zinc-400">{fechaHoy}</span>
          </div>
          <div className="flex items-center gap-3 text-zinc-500">
            <span className="hidden md:inline">EUR</span>
            <span className="hidden md:inline">·</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-loga-red animate-pulse" />
              Live
            </span>
          </div>
        </div>
      </div>

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  HERO — la facturación como titular gigante editorial      ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="px-6 sm:px-12 pt-12 pb-10 sm:pt-20 sm:pb-16 border-b border-black/10 dark:border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Columna izquierda: titular */}
          <div className="lg:col-span-7">
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
              className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-5"
            >
              Facturación acumulada
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="text-[clamp(4rem,12vw,9rem)] leading-[0.85] tracking-[-0.04em] text-black dark:text-white"
              style={SERIF}
            >
              {fmt(data.ventas.facturacion_total).split(',')[0]}
              <span className="text-zinc-400 dark:text-zinc-600">,{fmt(data.ventas.facturacion_total).split(',')[1] ?? '00'}</span>
            </motion.h1>
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}
              className="mt-6 flex items-baseline gap-3 text-sm"
            >
              <span className="uppercase tracking-widest text-[10px] font-bold text-zinc-500">EUR</span>
              <span className="h-px flex-1 max-w-[120px] bg-black/20 dark:bg-white/20 self-center" />
              <span className="text-zinc-700 dark:text-zinc-300" style={MONO}>{fmtInt(data.ventas.num_pedidos)} pedidos completados</span>
            </motion.div>
          </div>

          {/* Columna derecha: 3 stats apiladas */}
          <div className="lg:col-span-5 lg:border-l lg:border-black/10 dark:lg:border-white/10 lg:pl-10 flex flex-col justify-end gap-7 pt-2">
            <StatLine
              label="Beneficio bruto"
              value={fmtCompact(beneficioBruto)}
              hint={`${margenPct.toFixed(1)}% margen`}
              positive={beneficioBruto >= 0}
              delay={0.2}
            />
            <StatLine
              label="Coste producción"
              value={fmtCompact(data.costeProd.coste_total)}
              hint={`${fmtInt(data.costeProd.num_ordenes)} órdenes`}
              delay={0.3}
            />
            <StatLine
              label="Inmovilizado"
              value={fmtCompact(data.inmovilizado.valor_total)}
              hint={`${fmtInt(data.topInmovilizado.length)} productos en stock`}
              delay={0.4}
            />
          </div>
        </div>

        {/* Acciones discretas al pie del hero */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]"
        >
          <span className="uppercase tracking-[0.2em] text-zinc-400 font-bold">Exportar</span>
          {[
            { tipo: 'pedidos',     label: 'Pedidos' },
            { tipo: 'produccion',  label: 'Producción' },
            { tipo: 'inventario',  label: 'Inventario' },
          ].map(({ tipo, label }) => (
            <button key={tipo} onClick={() => exportar(tipo)}
              className="group inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 hover:text-loga-red transition-colors">
              <span className="border-b border-zinc-300 dark:border-zinc-600 group-hover:border-loga-red transition-colors pb-px">{label}</span>
              <Download size={11} strokeWidth={2.5} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <div className="inline-flex items-center gap-1.5">
            <select id="plastico-year" defaultValue={new Date().getFullYear()}
              className="bg-transparent text-zinc-700 dark:text-zinc-300 text-[11px] outline-none border-b border-zinc-300 dark:border-zinc-600 hover:border-loga-red transition-colors py-px">
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
              className="group inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300 hover:text-loga-red transition-colors">
              <span className="border-b border-zinc-300 dark:border-zinc-600 group-hover:border-loga-red transition-colors pb-px">Plástico Ley 7/2022</span>
              <Download size={11} strokeWidth={2.5} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>
        </motion.div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  MÉTRICAS OPERATIVAS — banda horizontal con números       ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="px-6 sm:px-12 py-8 border-b border-black/10 dark:border-white/10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-6 gap-x-8">
          <MicroStat
            label="Ticket medio"
            value={data.ventas.num_pedidos > 0 ? fmt(data.ventas.facturacion_total / data.ventas.num_pedidos) : '0'}
            unit="EUR/pedido"
            delay={0.05}
          />
          <MicroStat
            label="Coste medio/orden"
            value={data.costeProd.num_ordenes > 0 ? fmt(data.costeProd.coste_total / data.costeProd.num_ordenes) : '0'}
            unit="EUR/orden"
            delay={0.1}
          />
          <MicroStat
            label="Producción rechazada"
            value={fmt(data.rechazos.valor_rechazado)}
            unit={`${data.rechazos.ordenes_canceladas} órd · ${data.rechazos.lotes_rechazados} lotes`}
            delay={0.15}
            danger
          />
          <MicroStat
            label="Mermas producción"
            value={`${(data.mermas?.total_kg ?? 0).toLocaleString('es-ES')}`}
            unit={`kg · ${fmt(data.mermas?.total_eur ?? 0)} EUR`}
            delay={0.2}
            warning
          />
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  EVOLUCIÓN — chart minimalista de líneas + área           ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      {data.ventasMes.length > 0 && (
        <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
          <div className="flex items-baseline justify-between gap-6 mb-10 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Evolución</p>
              <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>
                Últimos {data.ventasMes.length} meses
              </h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500 mb-1">Pico mensual</p>
              <p className="text-2xl text-black dark:text-white tabular-nums" style={MONO}>{fmtCompact(maxMes)}<span className="text-sm text-zinc-400 ml-1">EUR</span></p>
            </div>
          </div>

          <LineChart
            data={data.ventasMes}
            maxMes={maxMes}
            minMes={minMes}
            avgMes={avgMes}
          />
        </section>
      )}

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  RENTABILIDAD — tabla editorial financiera                 ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
        <div className="flex items-end justify-between gap-6 mb-8 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Rentabilidad</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>
              Margen por <em>producto</em>
            </h2>
            <p className="text-xs text-zinc-500 mt-1.5">Coste calculado recursivamente desde receta</p>
          </div>

          {/* Search + filter en una línea */}
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search size={11} className="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={rentaSearch}
                onChange={(e) => setRentaSearch(e.target.value)}
                className="w-32 sm:w-44 bg-transparent border-b border-zinc-300 dark:border-zinc-600 pl-5 pb-1 text-xs outline-none focus:border-loga-red transition-colors placeholder:text-zinc-400"
              />
            </div>
            <div className="flex items-center gap-4 text-[11px] uppercase tracking-widest font-bold">
              {([
                { v: 'todos',              l: 'Todos' },
                { v: 'producto_fabricado', l: 'Granel' },
                { v: 'producto_envasado',  l: 'Envasado' },
              ] as const).map(({ v, l }) => {
                const count = v === 'todos' ? data.rentabilidad.length : data.rentabilidad.filter(r => r.tipo === v).length;
                const active = rentaTab === v;
                return (
                  <button key={v} onClick={() => setRentaTab(v)}
                    className={clsx(
                      'group transition-colors flex items-baseline gap-1.5',
                      active ? 'text-black dark:text-white' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                    )}>
                    <span className={clsx('pb-1 border-b-2 transition-colors', active ? 'border-loga-red' : 'border-transparent group-hover:border-zinc-300')}>{l}</span>
                    <span className="text-[9px] text-zinc-400 tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tabla editorial */}
        <div className="border-t-2 border-b-2 border-black dark:border-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/20 dark:border-white/20 text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">
                <th className="text-left py-3 pr-4">Producto</th>
                <SortHeader label="Venta"    active={rentaSort.key === 'venta'}    dir={rentaSort.dir} onClick={() => ordenarPor('venta')} align="right" />
                <SortHeader label="Coste"    active={rentaSort.key === 'coste'}    dir={rentaSort.dir} onClick={() => ordenarPor('coste')} align="right" />
                <SortHeader label="Margen"   active={rentaSort.key === 'margen'}   dir={rentaSort.dir} onClick={() => ordenarPor('margen')} align="right" />
                <th className="text-right py-3 px-2 font-bold w-20">Δ</th>
                <SortHeader label="Beneficio" active={rentaSort.key === 'beneficio'} dir={rentaSort.dir} onClick={() => ordenarPor('beneficio')} align="right" />
              </tr>
            </thead>
            <tbody>
              {rentabilidadFiltrada.map((r, i) => {
                const margen = parseFloat(String(r.margen_pct));
                const margenColor = margen < 20 ? 'text-loga-red' : margen < 40 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400';
                const isOpen = desgloseId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <motion.tr
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}
                      className={clsx(
                        'border-b border-zinc-100 dark:border-zinc-800/60 cursor-pointer group transition-all',
                        isOpen ? 'bg-zinc-50 dark:bg-zinc-900/40' : 'hover:bg-zinc-50/60 dark:hover:bg-zinc-900/20'
                      )}
                      onClick={() => setDesgloseId(isOpen ? null : r.id)}
                    >
                      <td className="py-3.5 pr-4 align-top">
                        <div className="flex items-baseline gap-3">
                          <span className="text-zinc-300 group-hover:text-loga-red transition-colors mt-0.5">
                            {isOpen ? <Minus size={11} strokeWidth={2.5} /> : <Plus size={11} strokeWidth={2.5} />}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-black dark:text-white leading-tight">{r.nombre}</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5" style={MONO}>
                              {r.codigo}
                              <span className="ml-2 inline-block text-zinc-300">{r.tipo === 'producto_fabricado' ? '· Granel' : '· Envasado'}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 pr-2 text-right align-top">
                        <p className="text-sm tabular-nums text-black dark:text-white" style={MONO}>{fmt(r.precio_venta)}</p>
                        <p className="text-[10px] text-zinc-400">EUR/{r.unidad_medida}</p>
                      </td>
                      <td className="py-3.5 pr-2 text-right align-top">
                        <p className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300" style={MONO}>{fmt(r.precio_coste)}</p>
                        <p className="text-[10px] text-zinc-400">EUR/{r.unidad_medida}</p>
                      </td>
                      <td className="py-3.5 pr-2 text-right align-top">
                        <p className={clsx('text-base font-medium tabular-nums', margenColor)} style={MONO}>{margen.toFixed(1)}%</p>
                      </td>
                      <td className="py-3.5 px-2 text-right align-top">
                        {r.diff_margen != null && r.diff_margen !== 0 ? (
                          <span className={clsx(
                            'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
                            r.diff_margen > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-loga-red'
                          )} style={MONO}>
                            {r.diff_margen > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                            {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}
                          </span>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="py-3.5 pl-2 text-right align-top">
                        <p className="text-sm tabular-nums font-medium text-black dark:text-white" style={MONO}>{fmt(r.beneficio_ud)}</p>
                        <p className="text-[10px] text-zinc-400">EUR/ud</p>
                      </td>
                    </motion.tr>
                    <AnimatePresence>
                      {isOpen && r.desglose && r.desglose.length > 0 && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                              className="bg-zinc-50/70 dark:bg-zinc-900/40 border-y border-zinc-200 dark:border-zinc-800"
                            >
                              <div className="px-8 py-5">
                                <p className="text-[9px] uppercase tracking-[0.3em] font-bold text-loga-red mb-4">Desglose de coste</p>
                                <div className="grid grid-cols-12 gap-4 text-[11px] mb-2 pb-2 border-b border-zinc-200 dark:border-zinc-700/50">
                                  <span className="col-span-5 uppercase tracking-widest text-zinc-400 font-bold">Ingrediente</span>
                                  <span className="col-span-3 text-right uppercase tracking-widest text-zinc-400 font-bold">Cantidad</span>
                                  <span className="col-span-2 text-right uppercase tracking-widest text-zinc-400 font-bold">Precio</span>
                                  <span className="col-span-2 text-right uppercase tracking-widest text-zinc-400 font-bold">Línea</span>
                                </div>
                                {r.desglose.map((d, j) => (
                                  <div key={j} className="grid grid-cols-12 gap-4 text-xs py-1.5 border-b border-zinc-100/80 dark:border-zinc-800/40 last:border-b-0">
                                    <span className="col-span-5 text-zinc-700 dark:text-zinc-300">{d.nombre}</span>
                                    <span className="col-span-3 text-right tabular-nums text-zinc-500" style={MONO}>{d.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {d.unidad}</span>
                                    <span className="col-span-2 text-right tabular-nums text-zinc-500" style={MONO}>{fmt(d.precio_ud)}</span>
                                    <span className="col-span-2 text-right tabular-nums text-black dark:text-white font-medium" style={MONO}>{fmt(d.coste_linea)}</span>
                                  </div>
                                ))}
                                <div className="grid grid-cols-12 gap-4 text-xs pt-3 mt-2 border-t-2 border-black dark:border-white">
                                  <span className="col-span-10 font-medium text-black dark:text-white">
                                    Total batch{r.rendimiento && r.rendimiento > 1 ? ` · ${r.rendimiento} ${r.unidad_medida}` : ''}
                                  </span>
                                  <span className="col-span-2 text-right tabular-nums font-medium text-black dark:text-white" style={MONO}>{fmt(r.coste_batch ?? r.precio_coste)} EUR</span>
                                </div>
                                {r.rendimiento && r.rendimiento > 1 && (
                                  <div className="grid grid-cols-12 gap-4 text-xs pt-1.5">
                                    <span className="col-span-10 text-loga-red">Coste por {r.unidad_medida}</span>
                                    <span className="col-span-2 text-right tabular-nums text-loga-red font-medium" style={MONO}>{fmt(r.precio_coste)} EUR</span>
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
                <tr><td colSpan={6} className="py-16 text-center text-xs text-zinc-400">{rentaSearch ? 'Sin resultados' : 'Sin productos'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  INVENTARIO — composición asimétrica                       ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

          {/* Distribución (izquierda, 5 cols) */}
          <div className="lg:col-span-5">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Distribución</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em] mb-8" style={SERIF}>
              Por <em>categoría</em>
            </h2>

            <div className="space-y-1">
              {([
                { label: 'Materia prima', value: data.inmovilizado.valor_mp,  color: '#000000' },
                { label: 'Fabricado',     value: data.inmovilizado.valor_fab, color: '#FF0000' },
                { label: 'Envasado',      value: data.inmovilizado.valor_env, color: '#525252' },
                { label: 'Embalaje',      value: data.inmovilizado.valor_emb, color: '#a3a3a3' },
              ]).map(({ label, value, color }, i) => {
                const pct = data.inmovilizado.valor_total > 0 ? (value / data.inmovilizado.valor_total) * 100 : 0;
                return (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                    className="group cursor-default"
                  >
                    <div className="flex items-baseline justify-between py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-sm text-black dark:text-white">{label}</span>
                      <div className="flex items-baseline gap-3">
                        <span className="tabular-nums text-zinc-400 text-xs" style={MONO}>{pct.toFixed(1)}%</span>
                        <span className="tabular-nums text-base text-black dark:text-white font-medium w-28 text-right" style={MONO}>{fmt(value)}</span>
                      </div>
                    </div>
                    <motion.div
                      initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                      transition={{ delay: 0.3 + i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      style={{ backgroundColor: color, transformOrigin: 'left' }}
                      className="h-px"
                    />
                  </motion.div>
                );
              })}
              <div className="flex items-baseline justify-between pt-5 mt-4 border-t-2 border-black dark:border-white">
                <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Total</span>
                <span className="text-2xl tabular-nums text-black dark:text-white" style={MONO}>{fmt(data.inmovilizado.valor_total)} <span className="text-sm text-zinc-400">EUR</span></span>
              </div>
            </div>
          </div>

          {/* Top inmovilizado (derecha, 7 cols) */}
          <div className="lg:col-span-7">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Inmovilizado</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em] mb-8" style={SERIF}>
              Top <em>{data.topInmovilizado.length > 10 ? '10' : data.topInmovilizado.length}</em> productos
            </h2>

            <ol className="space-y-0">
              {data.topInmovilizado.slice(0, 10).map((p, i) => {
                const val = parseFloat(String(p.valor));
                const maxVal = data.topInmovilizado[0] ? parseFloat(String(data.topInmovilizado[0].valor)) : 1;
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                return (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="group flex items-baseline gap-5 py-3 border-b border-zinc-100 dark:border-zinc-800/60 hover:border-loga-red transition-colors"
                  >
                    <span className="text-zinc-300 dark:text-zinc-600 tabular-nums w-8 group-hover:text-loga-red transition-colors text-xs" style={MONO}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-black dark:text-white truncate">{p.nombre}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5" style={MONO}>
                        {fmtInt(parseFloat(String(p.stock_actual)))} {p.unidad_medida}
                      </p>
                    </div>
                    <div className="hidden sm:block w-32 lg:w-40">
                      <motion.div
                        initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                        transition={{ delay: 0.3 + i * 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                        style={{ transformOrigin: 'right' }}
                        className="h-px bg-black dark:bg-white"
                      />
                    </div>
                    <span className="tabular-nums text-sm text-black dark:text-white w-24 text-right" style={MONO}>{fmt(val)}</span>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  TOP VENTAS — lista numerada estilo "ranking"             ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      {data.ventasProducto.length > 0 && (
        <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
          <div className="mb-10">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Mejores ventas</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>
              Productos más <em>vendidos</em>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {data.ventasProducto.map((v, i) => {
              const fact = parseFloat(String(v.facturacion));
              const cantidad = parseFloat(String(v.cantidad_vendida));
              const maxFact = parseFloat(String(data.ventasProducto[0]?.facturacion ?? 1));
              const pct = maxFact > 0 ? (fact / maxFact) * 100 : 0;
              const precioEf = cantidad > 0 ? fact / cantidad : 0;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
                  className="group flex items-start gap-5 py-3 border-b border-zinc-200 dark:border-zinc-800 hover:border-loga-red transition-colors"
                >
                  <span className="text-zinc-300 dark:text-zinc-600 tabular-nums text-xs pt-1 w-6 group-hover:text-loga-red transition-colors" style={MONO}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-black dark:text-white">{v.nombre}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap" style={MONO}>
                      <span>{fmtInt(cantidad)} {v.unidad_medida}</span>
                      <span className="text-zinc-300">·</span>
                      <span>{fmt(precioEf)} EUR/{v.unidad_medida}</span>
                    </p>
                    <motion.div
                      initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }}
                      transition={{ delay: 0.2 + i * 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      style={{ transformOrigin: 'left' }}
                      className="h-px bg-loga-red/40 mt-2"
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-base tabular-nums text-black dark:text-white font-medium" style={MONO}>{fmtCompact(fact)}</p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest">EUR</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  IMPACTO PRECIOS — lista expandible editorial              ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      {impactoRecetas.length > 0 && (
        <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
          <div className="mb-10">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Impacto en margen</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>
              Variación de <em>rentabilidad</em>
            </h2>
            <p className="text-xs text-zinc-500 mt-1.5">PVP y coste anterior vs actual</p>
          </div>

          <div className="border-t-2 border-black dark:border-white">
            {impactoRecetas.map((r) => {
              const expanded = expandedReceta === r.receta_nombre;
              const diffPositivo = r.diff_margen > 0;
              const diffNegativo = r.diff_margen < 0;
              const pvpCambio = r.pvp_anterior && r.pvp_actual && Math.abs(r.pvp_actual - r.pvp_anterior) > 0.01;
              const margenColor = r.margen_actual > 40 ? 'text-emerald-700 dark:text-emerald-400'
                : r.margen_actual > 20 ? 'text-amber-700 dark:text-amber-400' : 'text-loga-red';
              return (
                <div key={r.receta_nombre} className="border-b border-zinc-200 dark:border-zinc-800">
                  <button
                    onClick={() => setExpandedReceta(expanded ? null : r.receta_nombre)}
                    className={clsx(
                      'w-full grid grid-cols-12 gap-4 items-baseline py-5 text-left transition-colors group',
                      expanded ? 'bg-zinc-50/60 dark:bg-zinc-900/40' : 'hover:bg-zinc-50/40 dark:hover:bg-zinc-900/20'
                    )}
                  >
                    <span className="col-span-1 mt-1 self-start">
                      <span className={clsx(
                        'inline-block w-2 h-2 rounded-full',
                        diffNegativo ? 'bg-loga-red' : diffPositivo ? 'bg-emerald-500' : 'bg-zinc-300'
                      )} />
                    </span>
                    <div className="col-span-12 sm:col-span-6">
                      <p className="text-sm text-black dark:text-white font-medium">{r.producto_nombre}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5" style={MONO}>
                        {r.receta_nombre}
                        {r.pvp_actual !== undefined && (
                          <span> · PVP {r.pvp_actual.toFixed(2)} EUR/{r.unidad_medida}</span>
                        )}
                        {pvpCambio && <span className="text-zinc-400"> (ant: {r.pvp_anterior?.toFixed(2)})</span>}
                      </p>
                    </div>
                    <div className="col-span-6 sm:col-span-2 text-right">
                      <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Coste</p>
                      <p className="text-sm tabular-nums text-black dark:text-white" style={MONO}>{r.coste_actual.toFixed(4)}</p>
                      {r.diff_coste !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums', r.diff_coste > 0 ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} style={MONO}>
                          {r.diff_coste > 0 ? '+' : ''}{r.diff_coste.toFixed(4)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-6 sm:col-span-2 text-right">
                      <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Margen</p>
                      <p className={clsx('text-base tabular-nums', margenColor)} style={MONO}>{r.margen_actual.toFixed(1)}%</p>
                      {r.diff_margen !== 0 && (
                        <p className={clsx('text-[10px] tabular-nums inline-flex items-center gap-0.5', diffNegativo ? 'text-loga-red' : 'text-emerald-600 dark:text-emerald-400')} style={MONO}>
                          {diffPositivo ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                          {r.diff_margen > 0 ? '+' : ''}{r.diff_margen.toFixed(1)}pp
                        </p>
                      )}
                    </div>
                    <ChevronDown size={14} className={clsx('col-span-1 justify-self-end text-zinc-400 transition-transform', expanded && 'rotate-180')} />
                  </button>

                  <AnimatePresence>
                    {expanded && r.detalle_mp.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                        className="overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/30"
                      >
                        <div className="px-8 sm:px-16 py-5">
                          {r.salud && (
                            <p className={clsx(
                              'text-[11px] mb-4 italic',
                              diffNegativo ? 'text-loga-red' : diffPositivo ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500'
                            )} style={SERIF}>
                              "{r.salud}"
                            </p>
                          )}
                          <div className="grid grid-cols-12 gap-3 text-[11px] mb-2 pb-1.5 border-b border-zinc-200 dark:border-zinc-700/50">
                            <span className="col-span-6 uppercase tracking-widest text-zinc-400 font-bold">Materia prima</span>
                            <span className="col-span-2 text-right uppercase tracking-widest text-zinc-400 font-bold">Anterior</span>
                            <span className="col-span-2 text-right uppercase tracking-widest text-zinc-400 font-bold">Actual</span>
                            <span className="col-span-2 text-right uppercase tracking-widest text-zinc-400 font-bold">Impacto</span>
                          </div>
                          {r.detalle_mp.map((mp, i) => (
                            <div key={i} className="grid grid-cols-12 gap-3 text-xs py-1.5 border-b border-zinc-100 dark:border-zinc-800/50 last:border-b-0">
                              <span className="col-span-6 text-zinc-700 dark:text-zinc-300">{mp.nombre} <span className="text-zinc-400">({mp.cantidad.toFixed(2)})</span></span>
                              <span className="col-span-2 text-right tabular-nums text-zinc-500" style={MONO}>{mp.precio_anterior?.toFixed(4) ?? '—'}</span>
                              <span className="col-span-2 text-right tabular-nums text-black dark:text-white font-medium" style={MONO}>{mp.precio_actual.toFixed(4)}</span>
                              <span className={clsx(
                                'col-span-2 text-right tabular-nums font-medium',
                                mp.diff > 0 ? 'text-loga-red' : mp.diff < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-300'
                              )} style={MONO}>
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
        </section>
      )}

      {/* ╔═══════════════════════════════════════════════════════════╗
          ║  MATERIAS PRIMAS — banda inferior con stats               ║
          ╚═══════════════════════════════════════════════════════════╝ */}
      {mpPrecios.length > 0 && (
        <section className="px-6 sm:px-12 py-12 border-b border-black/10 dark:border-white/10">
          <div className="mb-10">
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-loga-red mb-2">Materias primas</p>
            <h2 className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>
              Variación últimos <em>90 días</em>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-2">
            {[...mpPrecios]
              .sort((a, b) => Math.abs(parseFloat(b.variacion_pct)) - Math.abs(parseFloat(a.variacion_pct)))
              .map((item, i) => {
                const variacion = parseFloat(item.variacion_pct);
                const pct = parseFloat(item.precio_actual);
                const ant = item.precio_anterior ? parseFloat(item.precio_anterior) : null;
                const isUp = variacion > 0;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.03 * i }}
                    className="group py-3 border-b border-zinc-200 dark:border-zinc-800 hover:border-loga-red transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-sm text-black dark:text-white truncate flex-1 min-w-0">{item.nombre}</p>
                      {item.precio_anterior && variacion !== 0 && (
                        <span className={clsx(
                          'text-sm tabular-nums font-medium inline-flex items-center gap-0.5 shrink-0',
                          isUp ? 'text-loga-red' : 'text-emerald-700 dark:text-emerald-400'
                        )} style={MONO}>
                          {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                          {isUp ? '+' : ''}{variacion.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-[11px]" style={MONO}>
                      <span className="text-zinc-400">
                        {ant ? ant.toFixed(4) : '—'} → <span className="text-black dark:text-white font-medium">{pct.toFixed(4)}</span> EUR/{item.unidad_medida}
                      </span>
                      <span className="text-zinc-300 text-[10px]">{item.codigo}</span>
                    </div>
                  </motion.div>
                );
              })}
          </div>
        </section>
      )}

      {/* Fin */}
      <div className="px-6 sm:px-12 py-8 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-400">— Loga Daily Ledger —</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════════════

function StatLine({ label, value, hint, positive, delay = 0 }: { label: string; value: string; hint?: string; positive?: boolean; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">{label}</span>
        {positive !== undefined && (
          <span className={clsx('text-xs', positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-loga-red')}>
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          </span>
        )}
      </div>
      <p className="text-3xl sm:text-4xl text-black dark:text-white tracking-[-0.02em]" style={SERIF}>{value}<span className="text-zinc-400 text-base ml-1">EUR</span></p>
      {hint && <p className="text-[11px] text-zinc-500 mt-1" style={MONO}>{hint}</p>}
    </motion.div>
  );
}

function MicroStat({ label, value, unit, delay = 0, danger, warning }: {
  label: string; value: string; unit: string; delay?: number; danger?: boolean; warning?: boolean;
}) {
  const valueColor = danger ? 'text-loga-red' : warning ? 'text-amber-700 dark:text-amber-400' : 'text-black dark:text-white';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="group"
    >
      <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2">{label}</p>
      <p className={clsx('text-2xl tabular-nums tracking-tight', valueColor)} style={MONO}>{value}</p>
      <p className="text-[11px] text-zinc-500 mt-1">{unit}</p>
    </motion.div>
  );
}

function SortHeader({ label, active, dir, onClick, align = 'left' }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <th className={clsx('py-3 pr-2 font-bold', align === 'right' && 'text-right')}>
      <button
        onClick={onClick}
        className={clsx(
          'inline-flex items-center gap-1 transition-colors',
          active ? 'text-loga-red' : 'text-zinc-500 hover:text-black dark:hover:text-white'
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
// LINE CHART editorial — área + línea + dots con tooltip flotante
// ═══════════════════════════════════════════════════════════════════════
function LineChart({ data, maxMes, minMes, avgMes }: { data: VentaMes[]; maxMes: number; minMes: number; avgMes: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 1000;
  const H = 320;
  const padX = 40;
  const padY = 30;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const range = Math.max(maxMes - minMes, 1);

  const points = data.map((m, i) => {
    const v = parseFloat(String(m.total));
    const x = padX + (i / Math.max(data.length - 1, 1)) * innerW;
    const y = padY + innerH - ((v - minMes) / range) * innerH;
    return { x, y, v, m };
  });

  const linePath = points.reduce((acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : ` L${p.x},${p.y}`), '');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padY + innerH} L${points[0].x},${padY + innerH} Z`;
  const avgY = padY + innerH - ((avgMes - minMes) / range) * innerH;

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none" style={{ minHeight: 240 }}>
        <defs>
          <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF0000" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Línea media (hairline punteado) */}
        <line x1={padX} y1={avgY} x2={W - padX} y2={avgY} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 4" className="text-zinc-300 dark:text-zinc-600" />
        <text x={W - padX} y={avgY - 6} textAnchor="end" className="text-[10px] fill-zinc-400 uppercase tracking-widest" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
          Media {fmtCompact(avgMes)}
        </text>

        {/* Eje X — labels */}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={H - 8} textAnchor="middle"
            className={clsx('text-[10px] fill-zinc-400 uppercase', hoverIdx === i && 'fill-loga-red font-bold')}
            style={{ fontFamily: '"JetBrains Mono", monospace' }}>
            {p.m.mes_label.split(' ')[0]}
          </text>
        ))}

        {/* Área */}
        <motion.path
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 1 }}
          d={areaPath} fill="url(#chart-area)"
        />

        {/* Línea principal */}
        <motion.path
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1] }}
          d={linePath} fill="none" stroke="#FF0000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        />

        {/* Dots + hit areas */}
        {points.map((p, i) => (
          <g key={i}>
            <motion.circle
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ delay: 1.4 + i * 0.04, type: 'spring', stiffness: 300, damping: 20 }}
              cx={p.x} cy={p.y} r={hoverIdx === i ? 5 : 3} fill="#FF0000"
              className="transition-all"
            />
            {hoverIdx === i && (
              <line x1={p.x} y1={p.y} x2={p.x} y2={H - padY} stroke="#FF0000" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
            )}
            {/* Hit area amplia */}
            <rect
              x={p.x - innerW / data.length / 2}
              y={padY}
              width={innerW / data.length}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-crosshair"
            />
          </g>
        ))}
      </svg>

      {/* Tooltip flotante minimalista */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute pointer-events-none bg-black dark:bg-white text-white dark:text-black px-4 py-3 rounded-sm shadow-2xl"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 14px))',
            }}
          >
            <p className="text-[9px] uppercase tracking-[0.3em] opacity-60 mb-1" style={MONO}>{hovered.m.mes_label}</p>
            <p className="text-xl tracking-tight" style={SERIF}>{fmt(hovered.v)}<span className="text-xs opacity-60 ml-1">EUR</span></p>
            <p className="text-[10px] opacity-70 mt-0.5" style={MONO}>{hovered.m.num_pedidos} pedidos · {hovered.v > avgMes ? '+' : ''}{((hovered.v / avgMes - 1) * 100).toFixed(0)}% vs media</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
