/**
 * Envasado — vista lista + modal configurador (estilo Producción).
 *   - Centro: cards/grid de recetas guardadas + tabla de OFs envasado recientes
 *   - Botón "Envasar" abre modal con configurador paso a paso (6 bloques)
 *   - Inline create en cada campo (Producto envasado, líquido, envase, etiqueta,
 *     caja, extras) — escribe nombre nuevo → crear sin salir del modal
 *   - Auto-rellena "Líquido por bote" desde peso_unitario_kg del envase
 *   - "Envases por bote" siempre 1 (oculto)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes, Droplet, Tag, Package, Plus, Play, Trash2, X,
  AlertTriangle, CheckCircle2, Calculator, Sparkles,
  Eye, Pencil, ClipboardList, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { productosApi, recetasEnvasadoApi, produccionApi } from '../api/client';
import { notify } from '../lib/notify';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import ComboCreate from '../components/ComboCreate';
import EtiquetaPreviewModal from '../components/EtiquetaPreviewModal';
import TanqueEnvasado from '../components/TanqueEnvasado';
import { motion, AnimatePresence } from 'framer-motion';

interface Producto {
  id: string; codigo: string; nombre: string; tipo: string;
  unidad_medida: string; stock_actual: string;
  subcategoria_me?: string | null; unidades_por_envase?: number | null;
  peso_unitario_kg?: string | null;
}
interface RecetaEnvasado {
  id: string; nombre: string; legacy?: boolean;
  producto_envasado_id: string; producto_envasado_codigo: string; producto_envasado_nombre: string;
  liquido_id: string; liquido_cantidad: string; liquido_unidad: string;
  liquido_nombre: string;
  envase_id: string; envases_por_bote: number;
  envase_nombre: string;
  etiqueta_id: string | null; etiquetas_por_bote: number;
  etiqueta_nombre: string | null;
  lleva_caja: boolean; caja_id: string | null;
  caja_nombre: string | null; caja_uds: number | null;
  extras?: Array<{ producto_id: string; cantidad_por_bote: number }>;
}
interface OFEnvasado {
  id: string; numero_orden: string; estado: 'borrador'|'confirmada'|'en_proceso'|'completada'|'cancelada';
  cantidad_planificada: string; cantidad_real_producida: string | null;
  fecha_fin: string | null; fecha_planificada: string | null;
  formato_label: string | null; notas: string | null; cliente: string | null;
  producto_nombre?: string; producto_codigo?: string;
  pe_nombre?: string | null; pe_codigo?: string | null;
  receta_envasado_nombre?: string | null;
  created_at: string;
}
interface SimItem {
  rol: string; id: string; nombre: string; codigo: string; unidad: string;
  cantidad: number; stock: number;
  lotes_fefo?: Array<{
    lote_interno: string; lote_proveedor: string | null;
    cantidad_a_usar: number; precio_compra: number | null;
    fecha_caducidad: string | null; fecha_entrada: string;
  }>;
}
interface SimResp {
  cantidad_botes: number; items: SimItem[];
  sobran_botes: number; insuficientes: number; stock_ok: boolean;
}
interface ExtraItem {
  producto_id: string;
  cantidad_por_bote: string;
  modo_cantidad?: 'por_bote' | 'total'; // 'total' = N fijos por OF, 'por_bote' = N por cada bote
}

type Modo = 'envasar' | 'empaquetar';
const EMPTY = {
  nombre: '',
  modo: 'envasar' as Modo,
  producto_envasado_id: '',
  pe_origen_id: '',
  liquido_id: '', liquido_cantidad: '',
  envase_id: '',
  etiqueta_id: '', etiquetas_por_bote: 1,
  lleva_caja: false, caja_id: '',
  extras: [] as ExtraItem[],
};

export default function Envasado() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [recetas, setRecetas]     = useState<RecetaEnvasado[]>([]);
  const [ofs, setOfs]             = useState<OFEnvasado[]>([]);
  const [loading, setLoading]     = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [seleccionada, setSeleccionada] = useState<RecetaEnvasado | null>(null);
  const [form, setForm]                 = useState({ ...EMPTY });
  const [cantidadBotes, setCantidadBotes] = useState<string>('100');
  const [sim, setSim]                     = useState<SimResp | null>(null);
  const [busy, setBusy]                   = useState(false);
  const [busqueda, setBusqueda]           = useState('');
  const [borrando, setBorrando]           = useState<string | null>(null);
  const [detalleId, setDetalleId]         = useState<string | null>(null);
  const [detalle, setDetalle]             = useState<any | null>(null);
  const [printOpenFor, setPrintOpenFor]   = useState<OFEnvasado | null>(null);
  const [fase, setFase]                   = useState<'config' | 'envasando' | 'completado'>('config');
  const [fillPct, setFillPct]             = useState(0);
  const [resultadoFab, setResultadoFab]   = useState<{ numero_orden: string; lote_pe: string; coste_unitario: number; botes: number } | null>(null);

  const [ofsAll, setOfsAll] = useState<any[]>([]);

  const cargar = async () => {
    setLoading(true);
    try {
      const [pR, rR, ofR] = await Promise.all([
        productosApi.listar({ activo: 'true' }),
        recetasEnvasadoApi.listar(),
        produccionApi.listar().catch(() => ({ data: [] })),
      ]);
      setProductos((pR.data as Producto[]).filter(p => p.tipo !== 'producto_terminado'));
      setRecetas(rR.data as RecetaEnvasado[]);
      const ofsEnvasado = (ofR.data as any[]).filter((o: any) => o.tipo_orden === 'envasado');
      setOfsAll(ofsEnvasado);
      setOfs(ofsEnvasado.slice(0, 8) as OFEnvasado[]);
    } catch { notify.error('Error cargando'); }
    finally { setLoading(false); }
  };

  // Top 5 fórmulas más usadas (count OFs por receta_envasado_id o receta_id legacy)
  const topRecetas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of ofsAll) {
      // Nuevas: receta_envasado_id; Legacy: la OF tiene receta_id apuntando a recetas
      const k = o.receta_envasado_id ?? o.receta_id;
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ranked = [...recetas].sort((a, b) =>
      (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    return ranked.slice(0, 5).map(r => ({ ...r, uso_count: counts.get(r.id) ?? 0 }));
  }, [ofsAll, recetas]);
  useEffect(() => { cargar(); }, []);

  const liquidos  = useMemo(() => productos.filter(p => p.tipo === 'producto_fabricado'), [productos]);
  const envasados = useMemo(() => productos.filter(p => p.tipo === 'producto_envasado'), [productos]);
  const envases   = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Bote' || (!p.subcategoria_me && /(bote|bid|garrafa)/i.test(p.nombre)))), [productos]);
  const etiquetas = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Etiqueta' || (!p.subcategoria_me && /etiqueta/i.test(p.nombre)))), [productos]);
  const cajas     = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Caja' || p.subcategoria_me === 'Palé' || (!p.subcategoria_me && /caja|pal[eé]/i.test(p.nombre)))), [productos]);
  // Extras: SOLO material de embalaje (caja, palé, cinta, pegatina, tapón…)
  const extrasCatalog = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje'), [productos]);

  const findProd = (id: string) => productos.find(p => p.id === id);
  const PE         = findProd(form.producto_envasado_id);
  const liquidoSel = findProd(form.liquido_id);
  const envaseSel  = findProd(form.envase_id);
  const etiquetaSel= findProd(form.etiqueta_id);
  const cajaSel    = findProd(form.caja_id);

  // Auto-fill: cuando cambia el envase, usa SIEMPRE el peso_unitario_kg del envase
  // (la ficha del bote es la fuente de verdad — 200 ml → 0.2 kg).
  // Si el envase no tiene peso configurado, no toca el valor existente.
  useEffect(() => {
    if (!form.envase_id) return;
    const peso = parseFloat(envaseSel?.peso_unitario_kg ?? '0');
    if (peso > 0) setForm(f => ({ ...f, liquido_cantidad: String(peso) }));
  }, [form.envase_id, envaseSel]);

  const abrirModalNuevo = () => {
    setSeleccionada(null); setForm({ ...EMPTY, extras: [] }); setSim(null); setCantidadBotes('100');
    setModalOpen(true);
  };
  const abrirModalReceta = (r: RecetaEnvasado) => {
    setSeleccionada(r);
    setForm({
      nombre: r.nombre,
      modo: r.liquido_id ? 'envasar' : 'empaquetar',
      producto_envasado_id: r.producto_envasado_id, pe_origen_id: '',
      liquido_id: r.liquido_id, liquido_cantidad: String(parseFloat(r.liquido_cantidad)),
      envase_id: r.envase_id,
      etiqueta_id: r.etiqueta_id ?? '', etiquetas_por_bote: r.etiquetas_por_bote,
      lleva_caja: r.lleva_caja, caja_id: r.caja_id ?? '',
      extras: (r.extras ?? []).map(e => ({ producto_id: e.producto_id, cantidad_por_bote: String(e.cantidad_por_bote) })),
    });
    setSim(null); setCantidadBotes('100');
    setModalOpen(true);
  };
  const cerrarModal = () => { setModalOpen(false); setSim(null); };

  // ── Inline create helpers ──
  const crearProducto = async (nombre: string, tipo: string, subcat?: string, unidad: string = 'ud') => {
    const { data } = await productosApi.crear({
      nombre, tipo, unidad_medida: unidad,
      stock_minimo: 0, stock_maximo: 0, precio_unitario: 0, precio_venta: 0,
      iva_porcentaje: 21,
      ...(subcat ? { subcategoria_me: subcat } : {}),
    });
    const nuevo = data as Producto;
    setProductos(prev => [...prev, nuevo]);
    notify.success(`"${nuevo.nombre}" creado`);
    return nuevo;
  };

  // ── Simular ──
  useEffect(() => {
    if (!modalOpen) return;
    const esEmpaquetar = form.modo === 'empaquetar';
    const tieneAlgo = esEmpaquetar
      ? (form.producto_envasado_id && form.extras.some(e => e.producto_id && Number(e.cantidad_por_bote) > 0))
      : (form.liquido_id && form.envase_id && form.liquido_cantidad);
    if (!tieneAlgo || !cantidadBotes) { setSim(null); return; }
    const t = setTimeout(async () => {
      try {
        const payload: any = { cantidad_botes: Number(cantidadBotes) };
        if (seleccionada && !seleccionada.legacy) payload.receta_id = seleccionada.id;
        else {
          payload.config = {
            pe_origen_id: undefined,
            liquido_id: esEmpaquetar ? undefined : form.liquido_id,
            liquido_nombre: liquidoSel?.nombre, liquido_codigo: liquidoSel?.codigo,
            liquido_cantidad: esEmpaquetar ? 0 : Number(form.liquido_cantidad), liquido_unidad: 'kg',
            envase_id: esEmpaquetar ? undefined : form.envase_id,
            envase_nombre: envaseSel?.nombre, envase_codigo: envaseSel?.codigo,
            envases_por_bote: 1,
            etiqueta_id: esEmpaquetar ? undefined : (form.etiqueta_id || undefined),
            etiqueta_nombre: etiquetaSel?.nombre, etiqueta_codigo: etiquetaSel?.codigo,
            etiquetas_por_bote: Number(form.etiquetas_por_bote) || 1,
            lleva_caja: form.lleva_caja, caja_id: form.lleva_caja ? form.caja_id : undefined,
            caja_nombre: cajaSel?.nombre, caja_codigo: cajaSel?.codigo,
            caja_uds: cajaSel?.unidades_por_envase ?? 1,
            extras: form.extras.filter(e => e.producto_id && Number(e.cantidad_por_bote) > 0)
              .map(e => {
                // 'total' = N fijos por OF → cantidad_por_bote = N / botes
                const botesN = Number(cantidadBotes) || 1;
                const cant = e.modo_cantidad === 'total'
                  ? Number(e.cantidad_por_bote) / botesN
                  : Number(e.cantidad_por_bote);
                return { producto_id: e.producto_id, cantidad_por_bote: cant };
              }),
          };
        }
        const r = await recetasEnvasadoApi.simular(payload);
        setSim(r.data as SimResp);
      } catch { /* silent */ }
    }, 180);
    return () => clearTimeout(t);
  }, [modalOpen, form, cantidadBotes, seleccionada, liquidoSel, envaseSel, etiquetaSel, cajaSel]);

  const toggleDetalle = async (id: string) => {
    if (detalleId === id) { setDetalleId(null); setDetalle(null); return; }
    setDetalleId(id); setDetalle(null);
    try {
      const r = await produccionApi.detalle(id);
      setDetalle(r.data);
    } catch { /* silent */ }
  };

  const eliminarOF = async (o: OFEnvasado) => {
    const accion = o.estado === 'completada' ? 'revertir' : 'borrar';
    if (!confirm(`¿${accion === 'revertir' ? 'Revertir y eliminar' : 'Borrar'} la orden ${o.numero_orden}?`)) return;
    setBorrando(o.id);
    try {
      await produccionApi.eliminar(o.id, accion);
      notify.success('Orden eliminada');
      cargar();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error eliminando');
    } finally { setBorrando(null); }
  };

  const eliminarReceta = async () => {
    if (!seleccionada) return;
    if (!confirm(`¿Eliminar la fórmula "${seleccionada.nombre}"?`)) return;
    try {
      await recetasEnvasadoApi.eliminar(seleccionada.id);
      notify.success('Fórmula eliminada'); cerrarModal(); cargar();
    } catch { notify.error('Error'); }
  };

  const fabricar = async (tambienGuardar: boolean) => {
    if (!sim || !sim.stock_ok) { notify.error('Stock insuficiente'); return; }
    if (tambienGuardar && !form.nombre.trim()) {
      notify.error('Para guardar pon nombre'); return;
    }
    setBusy(true);
    try {
      const payload: any = { cantidad_botes: Number(cantidadBotes) };
      if (seleccionada && !seleccionada.legacy) payload.receta_id = seleccionada.id;
      else {
        const esEmpaquetar = form.modo === 'empaquetar';
        payload.config = {
          producto_envasado_id: form.producto_envasado_id,
          pe_origen_id: undefined,
          liquido_id: esEmpaquetar ? undefined : form.liquido_id,
          liquido_cantidad: esEmpaquetar ? 0 : Number(form.liquido_cantidad), liquido_unidad: 'kg',
          envase_id: esEmpaquetar ? undefined : form.envase_id, envases_por_bote: 1,
          envase_nombre: envaseSel?.nombre,
          etiqueta_id: esEmpaquetar ? undefined : (form.etiqueta_id || undefined),
          etiquetas_por_bote: Number(form.etiquetas_por_bote) || 1,
          lleva_caja: form.lleva_caja, caja_id: form.lleva_caja ? form.caja_id : undefined,
          caja_uds: cajaSel?.unidades_por_envase ?? 1,
          extras: form.extras.filter(e => e.producto_id && Number(e.cantidad_por_bote) > 0)
            .map(e => ({ producto_id: e.producto_id, cantidad_por_bote: Number(e.cantidad_por_bote) })),
        };
      }
      if (tambienGuardar) { payload.guardar_receta = true; payload.nombre_receta = form.nombre.trim(); }

      // Animación: dura exactamente 3 s con interpolación lineal por requestAnimationFrame.
      // Esperamos a (a) finalización de la animación y (b) respuesta del backend antes
      // de mostrar la pantalla de completado.
      setFase('envasando');
      setFillPct(0);
      const ANIM_MS = 3000;
      const t0 = Date.now();
      let rafId = 0;
      const tick = () => {
        const elapsed = Date.now() - t0;
        const pct = Math.min(100, (elapsed / ANIM_MS) * 100);
        setFillPct(pct);
        if (elapsed < ANIM_MS) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      const animPromise = new Promise<void>(resolve => setTimeout(resolve, ANIM_MS));

      try {
        const [r] = await Promise.all([
          recetasEnvasadoApi.ejecutar(payload),
          animPromise,
        ]);
        cancelAnimationFrame(rafId);
        setFillPct(100);
        const out = r.data as any;
        setResultadoFab({
          numero_orden: out.numero_orden,
          lote_pe: out.lote_pe,
          coste_unitario: out.coste_unitario ?? 0,
          botes: Number(cantidadBotes),
        });
        setTimeout(() => setFase('completado'), 300);
        cargar();
      } catch (e: any) {
        cancelAnimationFrame(rafId);
        setFase('config');
        setFillPct(0);
        notify.error(e?.response?.data?.detalle ?? e?.response?.data?.error ?? 'Error fabricando');
      }
    } finally { setBusy(false); }
  };

  const cerrarYReset = () => {
    cerrarModal();
    setFase('config');
    setFillPct(0);
    setResultadoFab(null);
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;

  return (
    <div className="animate-fade-in max-w-7xl mx-auto px-3 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="rounded-md p-1 bg-emerald-600 text-white"><Boxes size={12} strokeWidth={2.5} /></div>
          <h1 className="text-sm font-bold text-gray-900">Envasado</h1>
        </div>
        <button onClick={abrirModalNuevo}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700 shadow-sm shadow-emerald-200">
          <Sparkles size={12} /> Envasar
        </button>
      </div>

      {/* Top 5 fórmulas más envasadas — chips rápidos */}
      {topRecetas.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 shrink-0 pr-1">Top envasadas</span>
          {topRecetas.map(r => (
            <button key={r.id} onClick={() => abrirModalReceta(r)}
              className="inline-flex items-center gap-1 shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
              <Sparkles size={9} className="text-emerald-600" />
              {r.nombre}
              {r.uso_count > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center rounded bg-emerald-100 text-emerald-700 px-1 text-[9px] font-bold tabular-nums">
                  {r.uso_count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Buscador */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar orden por número, formato o cliente..."
            className="w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 py-1.5 text-xs outline-none focus:border-emerald-400" />
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">{ofs.length} órdenes</span>
      </div>

      {/* Tabla de OFs envasado estilo Producción */}
      <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Nº Orden', 'Producto / Formato', 'Botes', 'Cliente', 'Estado', 'Fecha', 'Acciones'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {ofs
              .filter(o => !busqueda || `${o.numero_orden} ${o.formato_label ?? ''} ${o.cliente ?? ''} ${o.producto_nombre ?? ''}`.toLowerCase().includes(busqueda.toLowerCase()))
              .map(o => (
              <React.Fragment key={o.id}>
              <tr className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{o.numero_orden}</td>
                <td className="px-3 py-2">
                  <p className="font-medium text-emerald-700 text-xs uppercase">{o.pe_nombre ?? o.producto_nombre ?? o.formato_label ?? 'Envasado'}</p>
                  <p className="text-[10px] text-gray-500">
                    Envasado: <span className="font-bold tabular-nums text-gray-700">{parseFloat(o.cantidad_real_producida ?? o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 0 })}</span> botes
                  </p>
                </td>
                <td className="px-3 py-2 tabular-nums text-xs text-gray-700">
                  <span className="font-bold">{parseFloat(o.cantidad_real_producida ?? o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</span>
                  <span className="ml-1 text-[10px] text-gray-400">ud</span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{o.cliente ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2"><EstadoBadge estado={o.estado} /></td>
                <td className="px-3 py-2 text-[11px] text-gray-400">
                  {o.fecha_fin ? new Date(o.fecha_fin).toLocaleDateString('es-ES')
                    : o.fecha_planificada ? new Date(o.fecha_planificada).toLocaleDateString('es-ES')
                    : new Date(o.created_at).toLocaleDateString('es-ES')}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPrintOpenFor(o)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors" title="Imprimir pegatinas">
                      <Tag size={13} />
                    </button>
                    <button onClick={() => toggleDetalle(o.id)}
                      className={clsx('rounded-lg p-1.5 transition-colors',
                        detalleId === o.id ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-blue-50 hover:text-blue-600')}
                      title="Ver lotes consumidos">
                      <Eye size={13} />
                    </button>
                    {['borrador', 'confirmada'].includes(o.estado) && (
                      <button className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Editar (próximamente)" disabled>
                        <Pencil size={13} />
                      </button>
                    )}
                    {o.estado !== 'cancelada' && (
                      <button onClick={() => eliminarOF(o)} disabled={borrando === o.id}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red disabled:opacity-40 transition-colors" title={o.estado === 'completada' ? 'Revertir y borrar' : 'Borrar'}>
                        {borrando === o.id
                          ? <span className="h-3 w-3 border border-loga-red border-t-transparent rounded-full animate-spin block" />
                          : <Trash2 size={13} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {detalleId === o.id && (
                <tr className="bg-gray-50/50">
                  <td colSpan={7} className="px-4 py-4">
                    {!detalle ? (
                      <p className="text-[11px] text-gray-500 italic">Cargando trazabilidad…</p>
                    ) : (
                      <TrazabilidadDetalle detalle={detalle} />
                    )}
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
            {ofs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <ClipboardList size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-xs text-gray-400">No hay órdenes de envasado todavía.</p>
                  <p className="text-[10px] text-gray-300 mt-0.5">Pulsa "Envasar" para crear la primera.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL configurador */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3"
            onClick={cerrarYReset}>
            <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                <div className="rounded-md p-1 bg-emerald-600 text-white"><Sparkles size={12} /></div>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Nombre de la fórmula (ej. Garrafa 1kg Cola X)"
                  className="flex-1 text-sm font-bold border-b border-transparent focus:border-emerald-400 outline-none px-1 py-0.5 bg-transparent" />
                {seleccionada && !seleccionada.legacy && (
                  <button onClick={eliminarReceta} className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50">
                    <Trash2 size={12} />
                  </button>
                )}
                <button onClick={cerrarYReset} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100">
                  <X size={14} />
                </button>
              </div>

              {/* Modo selector */}
              <div className="px-3 pt-2.5">
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-bold w-full">
                  <button onClick={() => setForm({ ...form, modo: 'envasar' })}
                    className={clsx('flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 transition-colors',
                      form.modo === 'envasar' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>
                    <Droplet size={11} /> Envasar líquido
                  </button>
                  <button onClick={() => setForm(f => ({
                    ...f, modo: 'empaquetar',
                    // Auto-añade fila vacía si no hay containers todavía
                    extras: f.extras.length === 0 ? [{ producto_id: '', cantidad_por_bote: '1' }] : f.extras,
                  }))}
                    className={clsx('flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 transition-colors border-l border-gray-200',
                      form.modo === 'empaquetar' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>
                    <Boxes size={11} /> Solo empaquetar
                  </button>
                </div>
                <p className="text-[9px] text-gray-400 mt-1 px-1">
                  {form.modo === 'envasar'
                    ? 'Llena botes con líquido, etiqueta y opcionalmente empaqueta en cajas.'
                    : 'Toma botes ya envasados y mételos en cajas/palés (sin gastar líquido).'}
                </p>
              </div>

              {/* Fase Envasando: animación tanque */}
              {fase === 'envasando' && (
                <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-br from-red-50/40 to-white">
                  <TanqueEnvasado pct={fillPct} size={220} />
                  <motion.p
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="mt-4 text-sm font-bold text-loga-red animate-pulse">
                    Envasando {cantidadBotes} botes…
                  </motion.p>
                  <p className="text-[10px] text-gray-500 mt-1">{Math.round(fillPct)}% completado</p>
                </div>
              )}

              {/* Fase Completado: estilo refinado (Stripe/Linear-inspired) */}
              {fase === 'completado' && resultadoFab && (
                <FaseCompletado
                  resultado={resultadoFab}
                  onCerrar={cerrarYReset}
                  onOtra={() => { setFase('config'); setFillPct(0); setResultadoFab(null); }}
                />
              )}

              {/* Cuerpo scrollable */}
              {fase === 'config' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">

                {/* Selector de fórmula guardada — rellena todos los campos */}
                <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/60 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={12} className="text-emerald-600" />
                    <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-700">Fórmula de envasado</span>
                    <span className="text-[9px] text-gray-500 italic ml-auto">
                      {recetas.length === 0 ? 'no hay fórmulas guardadas todavía' : 'rellena todos los campos abajo'}
                    </span>
                  </div>
                  {recetas.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic px-1 py-1">Las fórmulas se crean en la pestaña Fórmulas. Por ahora rellena los campos manualmente.</p>
                  ) : (
                    <ComboCreate
                      options={recetas.map(r => ({
                        id: r.id, label: r.nombre,
                        sub: `→ ${r.producto_envasado_nombre}${r.lleva_caja ? ` · caja ×${r.caja_uds ?? '?'}` : ''}`,
                        right: `${parseFloat(r.liquido_cantidad).toFixed(2)} kg`,
                      }))}
                      value={seleccionada?.id ?? ''}
                      onChange={(id) => {
                        const r = recetas.find(x => x.id === id);
                        if (r) {
                          setSeleccionada(r);
                          setForm({
                            nombre: r.nombre,
                            modo: r.liquido_id ? 'envasar' : 'empaquetar',
                            producto_envasado_id: r.producto_envasado_id, pe_origen_id: '',
                            liquido_id: r.liquido_id, liquido_cantidad: String(parseFloat(r.liquido_cantidad)),
                            envase_id: r.envase_id,
                            etiqueta_id: r.etiqueta_id ?? '', etiquetas_por_bote: r.etiquetas_por_bote,
                            lleva_caja: r.lleva_caja, caja_id: r.caja_id ?? '',
                            extras: (r.extras ?? []).map(e => ({ producto_id: e.producto_id, cantidad_por_bote: String(e.cantidad_por_bote) })),
                          });
                        } else {
                          setSeleccionada(null);
                        }
                      }}
                      placeholder={`Elegir entre ${recetas.length} fórmula${recetas.length !== 1 ? 's' : ''} guardada${recetas.length !== 1 ? 's' : ''}...`}
                      selectedLabel={seleccionada?.nombre}
                      selectedSub={seleccionada ? `→ ${seleccionada.producto_envasado_nombre}` : undefined}
                      selectedRight={seleccionada ? `${parseFloat(seleccionada.liquido_cantidad).toFixed(2)} kg` : undefined}
                    />
                  )}
                </div>

                <Step n={1} done={!!form.producto_envasado_id} title={form.modo === 'empaquetar' ? 'Producto envasado a empaquetar' : 'Producto Final'}>
                  <ComboCreate
                    options={envasados.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                    value={form.producto_envasado_id}
                    onChange={id => setForm({ ...form, producto_envasado_id: id })}
                    placeholder="Buscar o crear PE..."
                    selectedLabel={PE?.nombre} selectedSub={PE?.codigo}
                    selectedRight={PE ? `${parseFloat(PE.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                    onCreate={async (nombre) => {
                      const p = await crearProducto(nombre, 'producto_envasado', undefined, 'ud');
                      return { id: p.id, label: p.nombre, sub: p.codigo };
                    }}
                    createLabel="Crear PE"
                  />
                </Step>

                {form.modo === 'envasar' && (
                <Step n={2} done={!!form.liquido_id} title="Conteindo del bote" Icon={Droplet}>
                  <ComboCreate
                    options={liquidos.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ${p.unidad_medida}` }))}
                    value={form.liquido_id}
                    onChange={id => setForm({ ...form, liquido_id: id })}
                    placeholder="Buscar o crear líquido..."
                    selectedLabel={liquidoSel?.nombre} selectedSub={liquidoSel?.codigo}
                    selectedRight={liquidoSel ? `${parseFloat(liquidoSel.stock_actual).toLocaleString('es-ES')} ${liquidoSel.unidad_medida}` : undefined}
                    onCreate={async (nombre) => {
                      const p = await crearProducto(nombre, 'producto_fabricado', undefined, 'kg');
                      return { id: p.id, label: p.nombre, sub: p.codigo };
                    }}
                    createLabel="Crear líquido"
                  />
                </Step>
                )}

                {form.modo === 'envasar' && (
                <Step n={3} done={!!form.envase_id && !!form.liquido_cantidad} title="Envase" Icon={Package}>
                  <ComboCreate
                    options={envases.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                    value={form.envase_id}
                    onChange={id => { setForm({ ...form, envase_id: id, liquido_cantidad: '' }); /* trigger autofill */ }}
                    placeholder="Buscar o crear envase..."
                    selectedLabel={envaseSel?.nombre} selectedSub={envaseSel?.codigo}
                    selectedRight={envaseSel ? `${parseFloat(envaseSel.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                    onCreate={async (nombre) => {
                      const p = await crearProducto(nombre, 'material_embalaje', 'Bote', 'ud');
                      return { id: p.id, label: p.nombre, sub: p.codigo };
                    }}
                    createLabel="Crear envase"
                  />
                  <div className="mt-2">
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">
                      Líquido por bote (kg)
                      {envaseSel && parseFloat(envaseSel.peso_unitario_kg ?? '0') > 0 && (
                        <span className="ml-1 text-emerald-600 normal-case font-medium">· auto desde envase</span>
                      )}
                    </label>
                    <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-emerald-400 overflow-hidden w-40">
                      <input type="number" min="0" step="0.001" value={form.liquido_cantidad}
                        onChange={e => setForm({ ...form, liquido_cantidad: e.target.value })}
                        placeholder="0" className="flex-1 px-2 py-1 text-[11px] font-mono text-right outline-none min-w-0" />
                      <span className="bg-gray-50 border-l border-gray-200 px-2 text-[11px] font-bold flex items-center text-gray-600">kg</span>
                    </div>
                  </div>
                </Step>
                )}

                {form.modo === 'envasar' && (
                <Step n={4} done={!!form.etiqueta_id} title="Etiqueta" hint="opcional" Icon={Tag}>
                  <ComboCreate
                    options={[...etiquetas.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))]}
                    value={form.etiqueta_id}
                    onChange={id => setForm({ ...form, etiqueta_id: id })}
                    placeholder={`${etiquetas.length} etiquetas o crear nueva...`}
                    selectedLabel={etiquetaSel?.nombre} selectedSub={etiquetaSel?.codigo}
                    selectedRight={etiquetaSel ? `${parseFloat(etiquetaSel.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                    onCreate={async (nombre) => {
                      const p = await crearProducto(nombre, 'material_embalaje', 'Etiqueta', 'ud');
                      return { id: p.id, label: p.nombre, sub: p.codigo };
                    }}
                    createLabel="Crear etiqueta"
                  />
                </Step>
                )}

                {form.modo === 'envasar' && (
                <Step n={5} done={!form.lleva_caja || !!form.caja_id} title="¿Lleva caja o palé?" Icon={Boxes}
                  right={
                    <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-[10px] font-bold">
                      <button onClick={() => setForm({ ...form, lleva_caja: false, caja_id: '' })}
                        className={clsx('px-2.5 py-0.5 transition-colors',
                          !form.lleva_caja ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>NO</button>
                      <button onClick={() => setForm({ ...form, lleva_caja: true })}
                        className={clsx('px-2.5 py-0.5 transition-colors border-l border-gray-200',
                          form.lleva_caja ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>SÍ</button>
                    </div>
                  }
                >
                  {form.lleva_caja && (
                    <ComboCreate
                      options={cajas.map(p => ({ id: p.id, label: p.nombre,
                        sub: `${p.codigo}${p.unidades_por_envase ? ` · ×${p.unidades_por_envase} uds` : ''}${p.subcategoria_me === 'Palé' ? ' · palé' : ''}`,
                        right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                      value={form.caja_id}
                      onChange={id => setForm({ ...form, caja_id: id })}
                      placeholder={`${cajas.length} cajas/palés o crear nueva...`}
                      selectedLabel={cajaSel?.nombre}
                      selectedSub={cajaSel ? `${cajaSel.codigo}${cajaSel.unidades_por_envase ? ` · ×${cajaSel.unidades_por_envase} uds` : ''}` : undefined}
                      selectedRight={cajaSel ? `${parseFloat(cajaSel.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                      onCreate={async (nombre) => {
                        const p = await crearProducto(nombre, 'material_embalaje', 'Caja', 'ud');
                        return { id: p.id, label: p.nombre, sub: p.codigo };
                      }}
                      createLabel="Crear caja"
                    />
                  )}
                </Step>
                )}

                <Step n={form.modo === 'empaquetar' ? 2 : 6}
                  done={form.extras.length > 0}
                  title={form.modo === 'empaquetar' ? '¿En qué se empaqueta?' : 'Extras'}
                  hint={form.modo === 'empaquetar' ? 'caja, palé, etc.' : 'cinta, film, tapón, sellos…'}
                  Icon={form.modo === 'empaquetar' ? Boxes : Plus}
                  right={
                    <button onClick={() => setForm({ ...form, extras: [...form.extras, { producto_id: '', cantidad_por_bote: '1' }] })}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-bold hover:bg-emerald-700">
                      <Plus size={10} /> Añadir
                    </button>
                  }>
                  {form.extras.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic px-1">
                      {form.modo === 'empaquetar' ? 'Pulsa "+ Añadir" para elegir caja, palé, etc.' : 'Sin extras.'}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {form.extras.map((ex, idx) => {
                        const prod = productos.find(p => p.id === ex.producto_id);
                        // En empaquetar: prioriza cajas + palés. Si no son los suficientes, mostrar todo.
                        const opts = (form.modo === 'empaquetar'
                          ? [...cajas, ...extrasCatalog.filter(p => !cajas.includes(p))]
                          : extrasCatalog
                        ).filter(p => !form.extras.some((e, j) => j !== idx && e.producto_id === p.id));
                        return (
                          <div key={idx} className="flex items-stretch gap-1.5">
                            <div className="flex-1 min-w-0">
                              <ComboCreate
                                options={opts.map(p => ({ id: p.id, label: p.nombre,
                                  sub: `${p.codigo}${p.subcategoria_me ? ` · ${p.subcategoria_me}` : ''}${p.unidades_por_envase ? ` · ×${p.unidades_por_envase}` : ''}`,
                                  right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ${p.unidad_medida}` }))}
                                value={ex.producto_id}
                                onChange={id => {
                                  const p = productos.find(x => x.id === id);
                                  // Auto: caja con multiplicador → 1 por cada N botes
                                  //       palé → 1 total por OF (modo_cantidad='total', cantidad=1)
                                  //       resto → 1 por bote
                                  let autoCant = ex.cantidad_por_bote;
                                  let autoModo: 'por_bote' | 'total' = ex.modo_cantidad ?? 'por_bote';
                                  if (p?.subcategoria_me === 'Palé' || /pal[eé]/i.test(p?.nombre ?? '')) {
                                    autoModo = 'total';
                                    autoCant = '1';
                                  } else if (p?.unidades_por_envase && p.unidades_por_envase > 0) {
                                    autoModo = 'por_bote';
                                    autoCant = String(1 / p.unidades_por_envase);
                                  } else {
                                    autoModo = 'por_bote';
                                    autoCant = '1';
                                  }
                                  setForm({ ...form, extras: form.extras.map((e, j) => j === idx ? { ...e, producto_id: id, cantidad_por_bote: autoCant, modo_cantidad: autoModo } : e) });
                                }}
                                placeholder={form.modo === 'empaquetar' ? 'Buscar caja/palé...' : 'Buscar o crear material...'}
                                selectedLabel={prod?.nombre}
                                selectedSub={prod ? `${prod.codigo}${prod.subcategoria_me ? ` · ${prod.subcategoria_me}` : ''}${prod.unidades_por_envase ? ` · ×${prod.unidades_por_envase}` : ''}` : undefined}
                                selectedRight={prod ? `${parseFloat(prod.stock_actual).toLocaleString('es-ES')} ${prod.unidad_medida}` : undefined}
                                onCreate={async (nombre) => {
                                  const subcat = form.modo === 'empaquetar' ? 'Caja' : 'Otros';
                                  const p = await crearProducto(nombre, 'material_embalaje', subcat, 'ud');
                                  return { id: p.id, label: p.nombre, sub: p.codigo };
                                }}
                                createLabel={form.modo === 'empaquetar' ? 'Crear caja/palé' : 'Crear material'}
                              />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {/* Mostrar cantidad — auto si la caja tiene multiplicador */}
                              {ex.modo_cantidad === 'por_bote' && prod?.unidades_por_envase ? (
                                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200" title={`1 cada ${prod.unidades_por_envase} botes`}>
                                  <span className="text-[10px] text-emerald-700 font-bold">1/{prod.unidades_por_envase}</span>
                                </div>
                              ) : (
                                <input type="number" min="0" step="0.001" value={ex.cantidad_por_bote}
                                  onChange={e => setForm({ ...form, extras: form.extras.map((x, j) => j === idx ? { ...x, cantidad_por_bote: e.target.value } : x) })}
                                  className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] font-mono text-right outline-none focus:border-emerald-400" />
                              )}
                              {/* Toggle modo: por bote / total */}
                              <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-[9px] font-bold">
                                <button onClick={() => setForm({ ...form, extras: form.extras.map((x, j) => j === idx ? { ...x, modo_cantidad: 'por_bote' } : x) })}
                                  className={clsx('px-1.5 py-1 transition-colors',
                                    (ex.modo_cantidad ?? 'por_bote') === 'por_bote' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
                                  title="Por cada bote">/bote</button>
                                <button onClick={() => setForm({ ...form, extras: form.extras.map((x, j) => j === idx ? { ...x, modo_cantidad: 'total' } : x) })}
                                  className={clsx('px-1.5 py-1 transition-colors border-l border-gray-200',
                                    ex.modo_cantidad === 'total' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
                                  title="Total fijo por OF">total</button>
                              </div>
                              <button onClick={() => setForm({ ...form, extras: form.extras.filter((_, j) => j !== idx) })}
                                className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Step>

                {/* Resumen consumo */}
                <div className="rounded-lg border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/40 to-white p-3 mt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Calculator size={12} className="text-emerald-600" />
                    <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Botes a fabricar</p>
                    <input type="number" min="1" step="1" value={cantidadBotes}
                      onChange={e => setCantidadBotes(e.target.value)}
                      className="ml-auto w-24 rounded-md border border-gray-200 px-2 py-1 text-base font-bold font-mono text-right outline-none focus:border-emerald-500" />
                  </div>
                  {!sim && (
                    <p className="text-[10px] text-gray-400 italic">Configura líquido + envase para ver consumo.</p>
                  )}
                  {sim && (
                    <div className="space-y-1.5">
                      {sim.items.map((it, i) => {
                        const ok = it.stock >= it.cantidad;
                        return (
                          <div key={i} className={clsx('rounded-md border px-2 py-1.5',
                            ok ? 'border-emerald-100 bg-white' : 'border-red-200 bg-red-50/50')}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-gray-900 truncate text-[11px]">{it.nombre}</span>
                              {ok ? <CheckCircle2 size={10} className="text-emerald-600 shrink-0" /> : <AlertTriangle size={10} className="text-red-600 shrink-0" />}
                            </div>
                            <div className="flex items-baseline gap-1 mt-0.5">
                              <span className={clsx('font-bold tabular-nums text-[11px]', ok ? 'text-gray-900' : 'text-red-700')}>
                                {it.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                              </span>
                              <span className="text-[9px] text-gray-500">{it.unidad}</span>
                              <span className="text-[9px] text-gray-400 ml-auto">stock {it.stock.toLocaleString('es-ES', { maximumFractionDigits: 1 })}</span>
                            </div>
                            {/* Plan FEFO de lotes a consumir */}
                            {it.lotes_fefo && it.lotes_fefo.length > 0 && ok && (
                              <div className="mt-1.5 pt-1 border-t border-emerald-100/70 space-y-0.5">
                                <p className="text-[8px] uppercase tracking-wider font-bold text-emerald-700">
                                  Lote{it.lotes_fefo.length > 1 ? 's' : ''} FIFO
                                </p>
                                {it.lotes_fefo.map((l, li) => (
                                  <div key={li} className="flex items-center justify-between gap-1 text-[9.5px]">
                                    <span className="font-mono text-gray-700 truncate">{l.lote_interno}</span>
                                    <div className="flex items-center gap-1 text-[9px] text-gray-500 shrink-0">
                                      {l.fecha_caducidad && <span>cad {new Date(l.fecha_caducidad).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit' })}</span>}
                                      <span className="font-semibold text-emerald-700 tabular-nums">
                                        {l.cantidad_a_usar.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {it.unidad}
                                      </span>
                                      {l.precio_compra != null && l.precio_compra > 0 && (
                                        <span className="text-gray-400">@ {l.precio_compra.toFixed(2)}€</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Footer (oculto durante envasado/completado) */}
              {fase === 'config' && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <button onClick={cerrarYReset} className="text-[11px] text-gray-500 hover:text-gray-900 px-2 py-1.5">Cancelar</button>
                <button onClick={() => fabricar(false)} disabled={busy || !sim || !sim.stock_ok}
                  className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white px-4 py-1.5 text-xs font-bold hover:bg-emerald-700 shadow-sm shadow-emerald-200 disabled:opacity-50">
                  <Play size={11} /> Fabricar {cantidadBotes}
                </button>
              </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal preview/imprimir pegatinas (mismo que Producción) */}
      <EtiquetaPreviewModal
        ordenId={printOpenFor?.id ?? null}
        numeroOrden={printOpenFor?.numero_orden}
        open={!!printOpenFor}
        onClose={() => setPrintOpenFor(null)}
      />
    </div>
  );
}

/**
 * Trazabilidad — vista detalle estilo trazabilidad PDF de producción.
 * Header con info de OF + tabla de ingredientes consumidos + lote PE producido.
 * Para ingredientes producto_fabricado: botón opcional "▶ ver trazabilidad" que
 * carga la trazabilidad recursiva de la cola usada.
 */
function TrazabilidadDetalle({ detalle }: { detalle: any }) {
  const orden = detalle.orden ?? {};
  const consumos: any[] = detalle.consumos ?? [];
  const consumosMP = consumos.filter(c => c.tipo === 'produccion_consumo');
  const peSalida = consumos.find(c => c.tipo === 'produccion_salida');

  // Agrupar consumos por producto (puede haber varios lotes del mismo producto)
  const grupos = new Map<string, any[]>();
  for (const c of consumosMP) {
    const k = c.producto_codigo + '|' + c.producto_nombre;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }

  const [trazaLoteId, setTrazaLoteId] = useState<string | null>(null);
  const [trazaLoteData, setTrazaLoteData] = useState<any | null>(null);
  const verTrazabilidadLote = async (loteId: string) => {
    if (trazaLoteId === loteId) { setTrazaLoteId(null); setTrazaLoteData(null); return; }
    setTrazaLoteId(loteId); setTrazaLoteData(null);
    try {
      const r = await fetch(`/api/lotes/${loteId}/origen`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token')}` },
      });
      if (r.ok) setTrazaLoteData(await r.json());
    } catch { /* silent */ }
  };

  const cantReal = parseFloat(orden.cantidad_real_producida ?? orden.cantidad_planificada ?? '0');
  const cantPlan = parseFloat(orden.cantidad_planificada ?? '0');
  const tipo = orden.tipo_orden ?? 'produccion';
  const unidadEnvasado = tipo === 'envasado' ? 'botes' : (orden.unidad_medida ?? 'kg');

  return (
    <div className="space-y-3">
      {/* HEADER */}
      <div className="border-b border-gray-200 pb-2.5">
        <p className="font-mono text-[13px] font-bold text-gray-900">
          {orden.numero_orden} <span className="text-gray-400 font-sans font-normal">— Trazabilidad</span>
        </p>
        <p className="text-xs font-bold uppercase text-gray-800 mt-1">
          {orden.producto_nombre ?? '—'}
          <span className="ml-1.5 text-gray-500 font-normal normal-case">
            · {cantReal.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {unidadEnvasado}
            {cantPlan > 0 && cantPlan !== cantReal && (
              <span className="text-gray-400 ml-1">(plan: {cantPlan.toLocaleString('es-ES', { maximumFractionDigits: 2 })})</span>
            )}
          </span>
        </p>
        {orden.operario_nombre && (
          <p className="text-[10px] text-gray-500 mt-0.5">
            Hecha por <span className="font-semibold text-gray-700">{orden.operario_nombre}</span>
            {orden.operario_rol && <span className="text-gray-400"> ({orden.operario_rol})</span>}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 text-[10px]">
          <span className="text-gray-500">Coste: <b className="text-gray-900 tabular-nums">{parseFloat(detalle.coste_total ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</b></span>
          {tipo === 'envasado' && (
            <span className="text-gray-500">Envasado: <b className="text-gray-900 tabular-nums">{cantReal.toLocaleString('es-ES', { maximumFractionDigits: 0 })} botes</b></span>
          )}
        </div>
      </div>

      {/* TABLA INGREDIENTES */}
      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50">
            <tr className="text-[9px] uppercase tracking-wider text-gray-500">
              <th className="text-left py-1.5 px-2 font-semibold w-[32%]">Ingrediente / Producto</th>
              <th className="text-right py-1.5 px-2 font-semibold">Total consumido</th>
              <th className="text-left py-1.5 px-2 font-semibold">Lote</th>
              <th className="text-right py-1.5 px-2 font-semibold">Caducidad</th>
              <th className="text-right py-1.5 px-2 font-semibold">Cantidad por lote</th>
              <th className="text-right py-1.5 px-2 font-semibold">€/u</th>
              <th className="text-right py-1.5 px-2 font-semibold">Coste</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Array.from(grupos.entries()).map(([k, rows]) => {
              const total = rows.reduce((s, r) => s + Math.abs(parseFloat(r.cantidad)), 0);
              const totalCoste = rows.reduce((s, r) =>
                s + Math.abs(parseFloat(r.cantidad)) * parseFloat(r.precio_unitario ?? '0'), 0);
              const first = rows[0];
              const esCola = first.producto_tipo === 'producto_fabricado';
              return (
                <React.Fragment key={k}>
                  {rows.map((c, ri) => {
                    const qty = Math.abs(parseFloat(c.cantidad));
                    const pre = parseFloat(c.precio_unitario ?? '0');
                    const coste = qty * pre;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/40">
                        <td className="py-1.5 px-2">
                          {ri === 0 && (
                            <>
                              <p className="font-semibold text-gray-900 uppercase text-[10.5px]">{first.producto_nombre}</p>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-mono text-gray-400">{first.producto_codigo}</span>
                                {esCola && first.lote_id && (
                                  <button onClick={() => verTrazabilidadLote(first.lote_id)}
                                    className="text-[9px] text-blue-600 hover:text-blue-700 hover:underline font-medium">
                                    {trazaLoteId === first.lote_id ? '▼ ocultar trazabilidad' : '▶ ver trazabilidad'}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {ri === 0 && (
                            <span className="font-bold text-gray-900 tabular-nums">
                              {total.toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-[10px] text-gray-500 font-normal">{c.unidad_medida}</span>
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-[10px] text-gray-700">{c.lote_interno ?? '—'}</td>
                        <td className="py-1.5 px-2 text-right text-[10px] text-gray-500">{c.fecha_caducidad ? new Date(c.fecha_caducidad).toLocaleDateString('es-ES') : '—'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {qty.toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-[10px] text-gray-500">{c.unidad_medida}</span>
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-[10px] text-gray-500">
                          {pre > 0 ? pre.toFixed(4) : '—'}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {ri === 0 && rows.length > 1 ? (
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] text-gray-500">{coste > 0 ? coste.toFixed(2) : '—'}</span>
                              <span className="font-bold text-emerald-700 text-[11px]">{totalCoste.toFixed(2)} €</span>
                            </div>
                          ) : (
                            <span className={clsx(rows.length === 1 ? 'font-bold text-emerald-700' : 'text-gray-500')}>
                              {coste > 0 ? `${coste.toFixed(2)} €` : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Sub-trazabilidad de la cola (recursivo) */}
                  {esCola && trazaLoteId === first.lote_id && (
                    <tr>
                      <td colSpan={7} className="bg-blue-50/40 px-2 py-2">
                        <p className="text-[9px] uppercase tracking-wider font-bold text-blue-700 mb-1.5">
                          Trazabilidad de {first.producto_nombre} usada
                        </p>
                        {!trazaLoteData ? (
                          <p className="text-[10px] text-gray-500 italic">Cargando…</p>
                        ) : !trazaLoteData.ok ? (
                          <p className="text-[10px] text-gray-500 italic">Origen no disponible (lote sin OF de producción registrada).</p>
                        ) : (
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-0.5 px-1.5 font-medium">Materia Prima</th>
                                <th className="text-right py-0.5 px-1.5 font-medium">Cantidad</th>
                                <th className="text-left py-0.5 px-1.5 font-medium">Lote</th>
                                <th className="text-right py-0.5 px-1.5 font-medium">Precio</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(trazaLoteData.consumos ?? []).map((cc: any) => (
                                <tr key={cc.id} className="border-t border-blue-100/40">
                                  <td className="py-0.5 px-1.5 text-gray-900">{cc.producto_nombre}</td>
                                  <td className="py-0.5 px-1.5 text-right tabular-nums">{Math.abs(parseFloat(cc.cantidad)).toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-gray-400">{cc.unidad_medida}</span></td>
                                  <td className="py-0.5 px-1.5 font-mono text-gray-600">{cc.lote_interno ?? '—'}</td>
                                  <td className="py-0.5 px-1.5 text-right tabular-nums text-gray-500">{parseFloat(cc.precio_unitario ?? '0') > 0 ? `${parseFloat(cc.precio_unitario).toFixed(4)} EUR` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* PE producido (final) */}
            {peSalida && (
              <tr className="bg-emerald-50/40 border-t-2 border-emerald-200">
                <td className="py-1.5 px-2">
                  <p className="font-semibold text-emerald-800 text-[10.5px]">{peSalida.producto_nombre}</p>
                  <span className="text-[9px] text-gray-500">{peSalida.producto_codigo} · Producto terminado</span>
                </td>
                <td className="py-1.5 px-2 text-right">
                  <span className="font-bold text-emerald-700 tabular-nums">
                    +{Math.abs(parseFloat(peSalida.cantidad)).toLocaleString('es-ES', { maximumFractionDigits: 2 })} <span className="text-[10px] text-emerald-600 font-normal">{peSalida.unidad_medida}</span>
                  </span>
                </td>
                <td className="py-1.5 px-2 font-mono text-[10px] text-emerald-700 font-semibold">{peSalida.lote_interno ?? '—'}</td>
                <td className="py-1.5 px-2 text-right text-[10px] text-gray-500">{peSalida.fecha_caducidad ? new Date(peSalida.fecha_caducidad).toLocaleDateString('es-ES') : '—'}</td>
                <td className="py-1.5 px-2 text-right text-emerald-700 font-medium text-[10px]">Producido</td>
                <td className="py-1.5 px-2 text-right text-[10px] text-emerald-600 tabular-nums">
                  {(() => {
                    const peCant = Math.abs(parseFloat(peSalida.cantidad));
                    const costePorUd = parseFloat(detalle.coste_total ?? '0') / (peCant || 1);
                    return costePorUd > 0 ? costePorUd.toFixed(4) : '—';
                  })()}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums font-bold text-emerald-700">
                  {parseFloat(detalle.coste_total ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </td>
              </tr>
            )}
            {/* Fila total */}
            {consumosMP.length > 0 && (
              <tr className="bg-gray-100 border-t-2 border-gray-300">
                <td colSpan={5} className="py-1.5 px-2 text-right text-[10px] uppercase tracking-wider font-bold text-gray-600">Total coste materiales</td>
                <td></td>
                <td className="py-1.5 px-2 text-right tabular-nums font-bold text-gray-900 text-sm">
                  {parseFloat(detalle.coste_total ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Pantalla de completado refinada (estilo Stripe/Linear).
 *  - SVG check que se dibuja con stroke-dashoffset
 *  - Glow radial sutil detrás
 *  - Números que cuentan hacia arriba
 *  - Reveals secuenciales tipo cinta
 */
function FaseCompletado({
  resultado, onCerrar, onOtra,
}: {
  resultado: { numero_orden: string; lote_pe: string; coste_unitario: number; botes: number };
  onCerrar: () => void;
  onOtra: () => void;
}) {
  const [count, setCount] = useState({ botes: 0, coste: 0 });
  useEffect(() => {
    const dur = 900;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - t0;
      const p = Math.min(1, elapsed / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      setCount({
        botes: Math.round(resultado.botes * ease),
        coste: resultado.coste_unitario * ease,
      });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [resultado.botes, resultado.coste_unitario]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden bg-white">
      {/* Glow radial sutil */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 35%, rgba(16,185,129,0.10), transparent 50%)',
        }}
      />

      {/* Check SVG animado */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="relative"
      >
        {/* Anillo exterior con pulse */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [1, 1.4], opacity: [0.4, 0] }}
          transition={{ duration: 1.4, ease: 'easeOut', delay: 0.2 }}
          className="absolute inset-0 rounded-full bg-emerald-400/40"
        />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_8px_30px_-8px_rgba(16,185,129,0.5)] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <motion.path
              d="M5 12 L10 17 L19 7"
              stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
            />
          </svg>
        </div>
      </motion.div>

      {/* Título minimalista */}
      <motion.h2
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-5 text-xl font-semibold text-gray-900 tracking-tight">
        Envasado completado
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="text-xs text-gray-500 mt-0.5">
        Orden registrada y stock actualizado
      </motion.p>

      {/* Tarjeta resumen */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 w-full max-w-sm">
        <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Orden</span>
            <span className="font-mono text-sm font-semibold text-gray-900">{resultado.numero_orden}</span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <Metric label="Botes" value={count.botes.toLocaleString('es-ES')} />
            <Metric label="Lote PE" value={resultado.lote_pe} mono small />
            <Metric label="€ / bote" value={count.coste.toFixed(3)} />
          </div>
        </div>
      </motion.div>

      {/* Acciones */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85, duration: 0.4 }}
        className="mt-5 flex items-center gap-2">
        <button onClick={onOtra}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 px-3.5 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors">
          Otra fabricación
        </button>
        <button onClick={onCerrar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 text-white px-4 py-2 text-xs font-semibold hover:bg-gray-800 transition-colors">
          Cerrar
        </button>
      </motion.div>
    </div>
  );
}

function Metric({ label, value, mono, small }: {
  label: string; value: string; mono?: boolean; small?: boolean;
}) {
  return (
    <div className="px-3 py-3 text-center">
      <p className="text-[9px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5">{label}</p>
      <p className={clsx('text-gray-900 tabular-nums truncate',
        mono ? 'font-mono' : 'font-semibold',
        small ? 'text-[11px]' : 'text-base font-semibold')}>
        {value}
      </p>
    </div>
  );
}

function Step({ n, done, title, hint, Icon, right, children }: {
  n: number; done: boolean; title: string; hint?: string;
  Icon?: any; right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <div className={clsx('flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold',
            done ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-500')}>{n}</div>
          {Icon && <Icon size={11} className={done ? 'text-emerald-600' : 'text-gray-400'} />}
          <span className={clsx('text-[11px] font-bold uppercase tracking-wider',
            done ? 'text-emerald-700' : 'text-gray-600')}>{title}</span>
          {hint && <span className="text-[9px] text-gray-400 italic">{hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: OFEnvasado['estado'] }) {
  const cfg = {
    borrador:    { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700' },
    confirmada:  { label: 'Confirmada',  cls: 'bg-blue-100 text-blue-700' },
    en_proceso:  { label: 'En proceso',  cls: 'bg-amber-100 text-amber-700' },
    completada:  { label: 'Completada',  cls: 'bg-emerald-100 text-emerald-700' },
    cancelada:   { label: 'Cancelada',   cls: 'bg-red-100 text-loga-red' },
  } as const;
  const { label, cls } = cfg[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>;
}
