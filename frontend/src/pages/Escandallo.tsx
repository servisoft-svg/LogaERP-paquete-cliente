/**
 * Escandallo — gestión de fórmulas de envasado (recetas_envasado).
 * Crear / editar / eliminar fórmulas. No fabrica; eso vive en /envasado.
 *
 *  - Tarjetas con las fórmulas guardadas (nuevas + legacy de recetas tipo='envasado')
 *  - Botón "Nueva fórmula" abre modal con configurador 6 bloques
 *  - Inline create de productos (PE, líquido, envase, etiqueta, caja…)
 *  - Botón "Guardar fórmula" único
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, Droplet, Tag, Package, Plus, Save, Trash2, X, ChefHat, Search, Pencil,
  Check, Clock, FlaskConical, Beaker,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { productosApi, recetasEnvasadoApi } from '../api/client';
import { notify } from '../lib/notify';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import ComboCreate from '../components/ComboCreate';

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
  liquido_nombre: string; liquido_stock?: string;
  envase_id: string; envases_por_bote: number;
  envase_nombre: string; envase_stock?: string;
  etiqueta_id: string | null; etiquetas_por_bote: number;
  etiqueta_nombre: string | null; etiqueta_stock?: string;
  lleva_caja: boolean; caja_id: string | null;
  caja_nombre: string | null; caja_uds: number | null; caja_stock?: string;
  // Packaging (peso porte)
  peso_envase_vacio_kg?: string | number | null;
  unidades_por_caja?:    string | number | null;
  peso_caja_vacia_kg?:   string | number | null;
  cajas_por_pale?:       string | number | null;
  peso_pale_vacio_kg?:   string | number | null;
  extras?: Array<{ producto_id: string; cantidad_por_bote: number }>;
  created_at?: string; updated_at?: string;
}
interface ExtraItem { producto_id: string; cantidad_por_bote: string }

const EMPTY = {
  nombre: '',
  producto_envasado_id: '',
  liquido_id: '', liquido_cantidad: '',
  envase_id: '', envases_por_bote: 1,
  etiqueta_id: '', etiquetas_por_bote: 1,
  lleva_caja: false, caja_id: '',
  // Packaging para cálculo de porte
  peso_envase_vacio_kg: '',
  unidades_por_caja:    '1',
  peso_caja_vacia_kg:   '',
  cajas_por_pale:       '',
  peso_pale_vacio_kg:   '',
  extras: [] as ExtraItem[],
};

export default function Escandallo() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [recetas, setRecetas]     = useState<RecetaEnvasado[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busqueda, setBusqueda]   = useState('');

  const [modalOpen, setModalOpen]       = useState(false);
  const [seleccionada, setSeleccionada] = useState<RecetaEnvasado | null>(null);
  const [form, setForm]                 = useState({ ...EMPTY });
  const [busy, setBusy]                 = useState(false);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  const cargar = async () => {
    setLoading(true);
    try {
      const [pR, rR] = await Promise.all([
        productosApi.listar({ activo: 'true' }),
        recetasEnvasadoApi.listar(),
      ]);
      setProductos((pR.data as Producto[]).filter(p => p.tipo !== 'producto_terminado'));
      setRecetas(rR.data as RecetaEnvasado[]);
    } catch { notify.error('Error cargando'); }
    finally { setLoading(false); }
  };
  useEffect(() => { cargar(); }, []);

  const liquidos  = useMemo(() => productos.filter(p => p.tipo === 'producto_fabricado'), [productos]);
  const envasados = useMemo(() => productos.filter(p => p.tipo === 'producto_envasado'), [productos]);
  const envases   = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Bote' || (!p.subcategoria_me && /(bote|bid|garrafa)/i.test(p.nombre)))), [productos]);
  const etiquetas = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Etiqueta' || (!p.subcategoria_me && /etiqueta/i.test(p.nombre)))), [productos]);
  const cajas     = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje' &&
    (p.subcategoria_me === 'Caja' || p.subcategoria_me === 'Palé' || (!p.subcategoria_me && /caja|pal[eé]/i.test(p.nombre)))), [productos]);
  const extrasCatalog = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje'), [productos]);

  const findProd = (id: string) => productos.find(p => p.id === id);
  const PE       = findProd(form.producto_envasado_id);
  const liquidoSel  = findProd(form.liquido_id);
  const envaseSel   = findProd(form.envase_id);
  const etiquetaSel = findProd(form.etiqueta_id);
  const cajaSel     = findProd(form.caja_id);

  // Auto-fill: cuando cambia el envase, usa peso_unitario_kg del envase
  useEffect(() => {
    if (!form.envase_id) return;
    const peso = parseFloat(envaseSel?.peso_unitario_kg ?? '0');
    if (peso > 0) setForm(f => ({ ...f, liquido_cantidad: String(peso) }));
  }, [form.envase_id, envaseSel]);

  const abrirNueva = () => {
    setSeleccionada(null); setForm({ ...EMPTY, extras: [] }); setModalOpen(true);
  };
  const abrirEditar = (r: RecetaEnvasado) => {
    setSeleccionada(r);
    const numStr = (v: string | number | null | undefined, def = '') =>
      v == null ? def : String(parseFloat(String(v)) || (def === '' ? '' : def));
    setForm({
      nombre: r.nombre,
      producto_envasado_id: r.producto_envasado_id,
      liquido_id: r.liquido_id, liquido_cantidad: String(parseFloat(r.liquido_cantidad)),
      envase_id: r.envase_id, envases_por_bote: r.envases_por_bote ?? 1,
      etiqueta_id: r.etiqueta_id ?? '', etiquetas_por_bote: r.etiquetas_por_bote,
      lleva_caja: r.lleva_caja, caja_id: r.caja_id ?? '',
      peso_envase_vacio_kg: numStr(r.peso_envase_vacio_kg),
      unidades_por_caja:    numStr(r.unidades_por_caja, '1') || '1',
      peso_caja_vacia_kg:   numStr(r.peso_caja_vacia_kg),
      cajas_por_pale:       numStr(r.cajas_por_pale),
      peso_pale_vacio_kg:   numStr(r.peso_pale_vacio_kg),
      extras: (r.extras ?? []).map(e => ({ producto_id: e.producto_id, cantidad_por_bote: String(e.cantidad_por_bote) })),
    });
    setModalOpen(true);
  };
  const cerrarModal = () => setModalOpen(false);

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

  const guardar = async () => {
    if (!form.nombre.trim()) { notify.error('Pon un nombre a la fórmula'); return; }
    if (!form.producto_envasado_id || !form.liquido_id || !form.envase_id || !form.liquido_cantidad) {
      notify.error('Faltan campos (producto, líquido, envase + cantidad)'); return;
    }
    setBusy(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        producto_envasado_id: form.producto_envasado_id,
        liquido_id: form.liquido_id, liquido_cantidad: Number(form.liquido_cantidad), liquido_unidad: 'kg',
        envase_id: form.envase_id, envases_por_bote: Math.max(1, Number(form.envases_por_bote) || 1),
        etiqueta_id: form.etiqueta_id || null, etiquetas_por_bote: Number(form.etiquetas_por_bote) || 1,
        lleva_caja: form.lleva_caja, caja_id: form.lleva_caja ? form.caja_id : null,
        peso_envase_vacio_kg: Number(form.peso_envase_vacio_kg) || 0,
        unidades_por_caja:    Math.max(1, Number(form.unidades_por_caja) || 1),
        peso_caja_vacia_kg:   Number(form.peso_caja_vacia_kg) || 0,
        cajas_por_pale:       Math.max(0, Number(form.cajas_por_pale) || 0),
        peso_pale_vacio_kg:   Number(form.peso_pale_vacio_kg) || 0,
        extras: form.extras.filter(e => e.producto_id && Number(e.cantidad_por_bote) > 0)
          .map(e => ({ producto_id: e.producto_id, cantidad_por_bote: Number(e.cantidad_por_bote) })),
      };
      if (seleccionada) await recetasEnvasadoApi.editar(seleccionada.id, payload);
      else              await recetasEnvasadoApi.crear(payload);
      notify.success(seleccionada ? 'Fórmula actualizada' : 'Fórmula guardada');
      cerrarModal();
      cargar();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error guardando');
    } finally { setBusy(false); }
  };

  const eliminar = async (r: RecetaEnvasado) => {
    if (!confirm(`¿Eliminar la fórmula "${r.nombre}"?`)) return;
    try {
      await recetasEnvasadoApi.eliminar(r.id);
      notify.success('Fórmula eliminada');
      cargar();
    } catch { notify.error('Error eliminando'); }
  };

  const filtradas = busqueda.trim()
    ? recetas.filter(r => r.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
                          r.producto_envasado_nombre?.toLowerCase().includes(busqueda.toLowerCase()))
    : recetas;

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;

  return (
    <div className="animate-fade-in max-w-7xl mx-auto px-3 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="rounded-md p-1 bg-indigo-600 text-white"><ChefHat size={12} strokeWidth={2.5} /></div>
          <h1 className="text-sm font-bold text-gray-900">Escandallo</h1>
          <span className="text-[9px] uppercase tracking-wider font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-px">FÓRMULAS · ENVASADO</span>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-500">{recetas.length} fórmula{recetas.length !== 1 ? 's' : ''} de envasado</span>
        </div>
        <button onClick={abrirNueva}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-indigo-700 shadow-sm">
          <Plus size={12} /> Nueva fórmula
        </button>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar fórmula por nombre o producto envasado..."
          className="w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
      </div>

      {/* Lista de fórmulas estilo Fórmulas */}
      {filtradas.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center bg-white">
          <ChefHat size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-xs text-gray-500">{busqueda ? 'Sin resultados' : 'No hay fórmulas todavía.'}</p>
          {!busqueda && <p className="text-[10px] text-gray-400 mt-1">Pulsa "Nueva fórmula" para crear la primera.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map((r, i) => {
            // Calcular máximo de botes producibles a partir del stock de cada componente
            const liqStock = parseFloat(r.liquido_stock ?? '0');
            const liqCant  = parseFloat(r.liquido_cantidad);
            const maxLiq = liqCant > 0 ? Math.floor(liqStock / liqCant) : Infinity;
            const envStock = parseFloat(r.envase_stock ?? '0');
            const maxEnv = (r.envases_por_bote ?? 1) > 0 ? Math.floor(envStock / (r.envases_por_bote ?? 1)) : Infinity;
            const etiStock = parseFloat(r.etiqueta_stock ?? '0');
            const maxEti = r.etiqueta_id && (r.etiquetas_por_bote ?? 1) > 0
              ? Math.floor(etiStock / (r.etiquetas_por_bote ?? 1)) : Infinity;
            const cajaStock = parseFloat(r.caja_stock ?? '0');
            const maxCaja = r.lleva_caja && r.caja_id
              ? Math.floor(cajaStock * (r.caja_uds ?? 1))
              : Infinity;
            const maxProd = Math.min(maxLiq, maxEnv, maxEti, maxCaja);
            const sinStock = [
              { ok: liqStock >= liqCant, nombre: r.liquido_nombre },
              { ok: envStock >= (r.envases_por_bote ?? 1), nombre: r.envase_nombre },
              r.etiqueta_id ? { ok: etiStock >= (r.etiquetas_por_bote ?? 1), nombre: r.etiqueta_nombre } : null,
              r.lleva_caja && r.caja_id ? { ok: cajaStock >= 1, nombre: r.caja_nombre } : null,
            ].filter(Boolean).filter((x: any) => !x.ok).length;

            const nIngredientes = 2 + (r.etiqueta_id ? 1 : 0) + (r.lleva_caja ? 1 : 0) + (r.extras?.length ?? 0);
            const ts = r.updated_at ? new Date(r.updated_at) : null;
            const tsCreated = r.created_at ? new Date(r.created_at) : null;
            const editada = ts && tsCreated && Math.abs(ts.getTime() - tsCreated.getTime()) > 1000;

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={clsx(
                  'rounded-xl border bg-white shadow-sm overflow-hidden',
                  sinStock === 0 ? 'border-l-4 border-l-emerald-500 border-gray-100' : 'border-l-4 border-l-indigo-500 border-gray-100'
                )}
              >
                <div className="px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ChefHat size={16} className={sinStock === 0 ? 'text-emerald-500 shrink-0' : 'text-indigo-600 shrink-0'} />
                        <h3 className="font-semibold text-gray-900 truncate">{r.nombre}</h3>
                        <span className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 text-xs font-bold font-mono">
                          v1
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <FlaskConical size={12} /> {r.producto_envasado_nombre}
                        </span>
                        <span>{parseFloat(r.liquido_cantidad).toLocaleString('es-ES', { maximumFractionDigits: 3 })} kg/bote</span>
                        <span>{nIngredientes} ingrediente{nIngredientes !== 1 ? 's' : ''}</span>
                        {r.lleva_caja && (
                          <span className="flex items-center gap-1">
                            <Beaker size={12} /> caja ×{r.caja_uds ?? '?'}
                          </span>
                        )}
                        {ts && (() => {
                          const fechaCorta = ts.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                          const horaCorta = ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                          return (
                            <span className="flex items-center gap-1 text-gray-400"
                              title={`Última edición: ${ts.toLocaleString('es-ES')}\nCreada: ${tsCreated ? tsCreated.toLocaleString('es-ES') : '—'}`}>
                              <Clock size={11} /> {editada ? 'Editada' : 'Creada'} {fechaCorta} {horaCorta}
                            </span>
                          );
                        })()}
                      </div>
                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {sinStock === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
                            <Check size={10} /> Stock OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 text-loga-red px-2 py-0.5 text-[11px] font-medium">
                            <X size={10} /> {sinStock} ingrediente{sinStock !== 1 ? 's' : ''} sin stock
                          </span>
                        )}
                        <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium',
                          isFinite(maxProd) && maxProd > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500')}>
                          Max: {isFinite(maxProd) ? maxProd.toLocaleString('es-ES') : '∞'} botes
                        </span>
                      </div>
                    </div>
                    {/* Acciones */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => abrirEditar(r)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Editar">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => eliminar(r)}
                        className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors" title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* MODAL formulario */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3"
            onClick={cerrarModal}>
            <motion.div initial={{ scale: 0.96, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 6 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                <div className="rounded-md p-1 bg-indigo-600 text-white"><ChefHat size={12} /></div>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Nombre de la fórmula (ej. Garrafa 1kg Cola X)"
                  className="flex-1 text-sm font-bold border-b border-transparent focus:border-indigo-500 outline-none px-1 py-0.5 bg-transparent" />
                <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100">
                  <X size={13} />
                </button>
              </div>

              <div ref={modalBodyRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {/* Producto envasado */}
                <Step n={1} done={!!form.producto_envasado_id} title="Producto envasado">
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

                {/* Líquido */}
                <Step n={2} done={!!form.liquido_id} title="Líquido base" Icon={Droplet}>
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

                {/* Envase + líquido por bote */}
                <Step n={3} done={!!form.envase_id && !!form.liquido_cantidad} title="Envase" Icon={Package}>
                  <ComboCreate
                    options={envases.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                    value={form.envase_id}
                    onChange={id => setForm({ ...form, envase_id: id, liquido_cantidad: '' })}
                    placeholder="Buscar o crear envase..."
                    selectedLabel={envaseSel?.nombre} selectedSub={envaseSel?.codigo}
                    selectedRight={envaseSel ? `${parseFloat(envaseSel.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                    onCreate={async (nombre) => {
                      const p = await crearProducto(nombre, 'material_embalaje', 'Bote', 'ud');
                      return { id: p.id, label: p.nombre, sub: p.codigo };
                    }}
                    createLabel="Crear envase"
                  />
                  {form.lleva_caja && cajaSel?.unidades_por_envase && Number(cajaSel.unidades_por_envase) > 1 && (
                    <p className="mt-2 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <strong>×{cajaSel.unidades_por_envase}</strong> envases por unidad PE (multiplicador automático desde la caja "{cajaSel.nombre}"). El consumo de líquido, envases y etiquetas se multiplica por este valor.
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">
                        Líquido por bote (kg)
                        {envaseSel && parseFloat(envaseSel.peso_unitario_kg ?? '0') > 0 && (
                          <span className="ml-1 text-indigo-600 normal-case font-medium">· auto</span>
                        )}
                      </label>
                      <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-indigo-500 overflow-hidden">
                        <input type="number" min="0" step="0.001" value={form.liquido_cantidad}
                          onChange={e => setForm({ ...form, liquido_cantidad: e.target.value })}
                          placeholder="0" className="flex-1 px-2 py-1 text-[11px] font-mono text-right outline-none min-w-0" />
                        <span className="bg-gray-50 border-l border-gray-200 px-2 text-[11px] font-bold flex items-center text-gray-600">kg</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">
                        Peso envase vacío (kg)
                        <span className="ml-1 text-gray-400 normal-case font-medium" title="Tara del bote/garrafa vacío. Se suma al peso del líquido para calcular peso bruto por unidad.">· tara</span>
                      </label>
                      <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-indigo-500 overflow-hidden">
                        <input type="number" min="0" step="0.001" value={form.peso_envase_vacio_kg}
                          onChange={e => setForm({ ...form, peso_envase_vacio_kg: e.target.value })}
                          placeholder="0" className="flex-1 px-2 py-1 text-[11px] font-mono text-right outline-none min-w-0" />
                        <span className="bg-gray-50 border-l border-gray-200 px-2 text-[11px] font-bold flex items-center text-gray-600">kg</span>
                      </div>
                    </div>
                  </div>
                </Step>

                {/* Etiqueta */}
                <Step n={4} done={!!form.etiqueta_id} title="Etiqueta" hint="opcional" Icon={Tag}>
                  <ComboCreate
                    options={etiquetas.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo,
                      right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
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

                {/* Caja */}
                <Step n={5} done={!form.lleva_caja || !!form.caja_id} title="¿Lleva caja o palé?" Icon={Boxes}
                  right={
                    <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-[10px] font-bold">
                      <button onClick={() => setForm({ ...form, lleva_caja: false, caja_id: '' })}
                        className={clsx('px-2.5 py-0.5 transition-colors',
                          !form.lleva_caja ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>NO</button>
                      <button onClick={() => setForm({ ...form, lleva_caja: true })}
                        className={clsx('px-2.5 py-0.5 transition-colors border-l border-gray-200',
                          form.lleva_caja ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>SÍ</button>
                    </div>
                  }>
                  {form.lleva_caja && (
                    <>
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
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Uds / caja</label>
                          <input type="number" min="1" step="1" value={form.unidades_por_caja}
                            onChange={e => setForm({ ...form, unidades_por_caja: e.target.value })}
                            placeholder="1" className="w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] font-mono text-right outline-none focus:border-indigo-500" />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Peso caja vacía</label>
                          <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-indigo-500 overflow-hidden">
                            <input type="number" min="0" step="0.001" value={form.peso_caja_vacia_kg}
                              onChange={e => setForm({ ...form, peso_caja_vacia_kg: e.target.value })}
                              placeholder="0" className="flex-1 px-2 py-1 text-[11px] font-mono text-right outline-none min-w-0" />
                            <span className="bg-gray-50 border-l border-gray-200 px-1.5 text-[10px] font-bold flex items-center text-gray-600">kg</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Cajas / palé</label>
                          <input type="number" min="0" step="1" value={form.cajas_por_pale}
                            onChange={e => setForm({ ...form, cajas_por_pale: e.target.value })}
                            placeholder="0" className="w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] font-mono text-right outline-none focus:border-indigo-500" />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-0.5">Peso palé vacío</label>
                          <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-indigo-500 overflow-hidden">
                            <input type="number" min="0" step="0.001" value={form.peso_pale_vacio_kg}
                              onChange={e => setForm({ ...form, peso_pale_vacio_kg: e.target.value })}
                              placeholder="0" className="flex-1 px-2 py-1 text-[11px] font-mono text-right outline-none min-w-0" />
                            <span className="bg-gray-50 border-l border-gray-200 px-1.5 text-[10px] font-bold flex items-center text-gray-600">kg</span>
                          </div>
                        </div>
                      </div>
                      {/* Resumen peso bruto */}
                      {(() => {
                        const liq  = parseFloat(form.liquido_cantidad) || 0;
                        const env  = parseFloat(form.peso_envase_vacio_kg) || 0;
                        const udC  = Math.max(1, parseInt(form.unidades_por_caja || '1', 10));
                        const cVac = parseFloat(form.peso_caja_vacia_kg) || 0;
                        const cPal = parseInt(form.cajas_por_pale || '0', 10);
                        const pVac = parseFloat(form.peso_pale_vacio_kg) || 0;
                        const pesoUnidad = liq + env;
                        const pesoCaja   = pesoUnidad * udC + cVac;
                        const pesoPale   = cPal > 0 ? pesoCaja * cPal + pVac : 0;
                        if (pesoUnidad <= 0) return null;
                        return (
                          <div className="mt-2 rounded-md bg-indigo-50/50 border border-indigo-100 px-2 py-1.5 text-[10px] text-gray-700 grid grid-cols-3 gap-2 font-mono">
                            <div><span className="text-gray-500">Bruto / ud:</span> <span className="font-bold text-indigo-700">{pesoUnidad.toFixed(3)} kg</span></div>
                            <div><span className="text-gray-500">/ caja ({udC}u):</span> <span className="font-bold text-indigo-700">{pesoCaja.toFixed(2)} kg</span></div>
                            <div><span className="text-gray-500">/ palé ({cPal || '—'}c):</span> <span className="font-bold text-indigo-700">{cPal > 0 ? pesoPale.toFixed(1) + ' kg' : '—'}</span></div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </Step>

                {/* Extras */}
                <Step n={6} done={form.extras.length > 0} title="Extras" hint="cinta, palé, tapón…" Icon={Plus}
                  right={
                    <button onClick={() => {
                      setForm({ ...form, extras: [...form.extras, { producto_id: '', cantidad_por_bote: '1' }] });
                      requestAnimationFrame(() => {
                        const body = modalBodyRef.current;
                        if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
                      });
                    }}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-600 text-white px-2 py-0.5 text-[10px] font-bold hover:bg-indigo-700">
                      <Plus size={10} /> Añadir
                    </button>
                  }>
                  {form.extras.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic px-1">Sin extras.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {form.extras.map((ex, idx) => {
                        const prod = productos.find(p => p.id === ex.producto_id);
                        return (
                          <div key={idx} className="flex items-stretch gap-1.5">
                            <div className="flex-1 min-w-0">
                              <ComboCreate
                                options={extrasCatalog
                                  .filter(p => !form.extras.some((e, j) => j !== idx && e.producto_id === p.id))
                                  .map(p => ({ id: p.id, label: p.nombre,
                                    sub: `${p.codigo}${p.subcategoria_me ? ` · ${p.subcategoria_me}` : ''}`,
                                    right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ${p.unidad_medida}` }))}
                                value={ex.producto_id}
                                onChange={id => setForm({ ...form, extras: form.extras.map((e, j) => j === idx ? { ...e, producto_id: id } : e) })}
                                placeholder="Buscar o crear material..."
                                selectedLabel={prod?.nombre}
                                selectedSub={prod ? `${prod.codigo}${prod.subcategoria_me ? ` · ${prod.subcategoria_me}` : ''}` : undefined}
                                selectedRight={prod ? `${parseFloat(prod.stock_actual).toLocaleString('es-ES')} ${prod.unidad_medida}` : undefined}
                                onCreate={async (nombre) => {
                                  const p = await crearProducto(nombre, 'material_embalaje', 'Otros', 'ud');
                                  return { id: p.id, label: p.nombre, sub: p.codigo };
                                }}
                                createLabel="Crear material"
                              />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <input type="number" min="0" step="0.001" value={ex.cantidad_por_bote}
                                onChange={e => setForm({ ...form, extras: form.extras.map((x, j) => j === idx ? { ...x, cantidad_por_bote: e.target.value } : x) })}
                                className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] font-mono text-right outline-none focus:border-indigo-500" />
                              <span className="text-[10px] text-gray-500">/bote</span>
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

                {/* Resumen — qué consume cada unidad PE de esta fórmula */}
                {form.envase_id && form.liquido_cantidad && (() => {
                  const M = (form.lleva_caja && cajaSel?.unidades_por_envase && Number(cajaSel.unidades_por_envase) > 1)
                    ? Number(cajaSel.unidades_por_envase)
                    : 1;
                  const liq = Number(form.liquido_cantidad) * M;
                  const etiq = Number(form.etiquetas_por_bote || 0);
                  const pesoEnv = Number(form.peso_envase_vacio_kg || 0) * M;
                  const pesoCaja = Number(form.peso_caja_vacia_kg || 0);
                  const brutoUd = liq + pesoEnv + (form.lleva_caja ? pesoCaja : 0);
                  return (
                    <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/50 p-3 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-indigo-800 mb-1">
                        Por cada unidad PE ({PE?.nombre ?? 'producto'}) →
                      </p>
                      <ul className="text-[11px] text-gray-800 space-y-0.5 font-mono">
                        {liquidoSel && <li><span className="font-bold">{liq.toLocaleString('es-ES', { maximumFractionDigits: 3 })} kg</span> · {liquidoSel.nombre}</li>}
                        {envaseSel && <li><span className="font-bold">{M.toLocaleString('es-ES')} ud</span> · {envaseSel.nombre}</li>}
                        {etiquetaSel && etiq > 0 && <li><span className="font-bold">{etiq.toLocaleString('es-ES')} ud</span> · {etiquetaSel.nombre}</li>}
                        {form.lleva_caja && cajaSel && <li><span className="font-bold">1 ud</span> · {cajaSel.nombre}{M > 1 && <span className="text-gray-500"> (contiene {M} envases)</span>}</li>}
                        {form.extras.filter(e => e.producto_id && Number(e.cantidad_por_bote) > 0).map((e, i) => {
                          const ex = productos.find(p => p.id === e.producto_id);
                          return <li key={i}><span className="font-bold">{(Number(e.cantidad_por_bote) * M).toLocaleString('es-ES', { maximumFractionDigits: 3 })}</span> · {ex?.nombre ?? '?'}</li>;
                        })}
                      </ul>
                      <div className="pt-1.5 mt-1.5 border-t border-indigo-200 flex items-baseline gap-3 text-[10px] text-gray-600">
                        <span>Peso bruto por ud: <span className="font-bold text-gray-900">{brutoUd.toLocaleString('es-ES', { maximumFractionDigits: 3 })} kg</span></span>
                        {M > 1 && <span>Multiplicador: <span className="font-bold text-indigo-700">×{M}</span></span>}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <button onClick={cerrarModal} className="text-[11px] text-gray-500 hover:text-gray-900 px-2 py-1.5">Cancelar</button>
                <button onClick={guardar} disabled={busy}
                  className="ml-auto inline-flex items-center gap-1 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-bold hover:bg-indigo-700 shadow-sm disabled:opacity-50">
                  <Save size={11} /> {seleccionada ? 'Actualizar fórmula' : 'Guardar fórmula'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
            done ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500')}>{n}</div>
          {Icon && <Icon size={11} className={done ? 'text-indigo-600' : 'text-gray-400'} />}
          <span className={clsx('text-[11px] font-bold uppercase tracking-wider',
            done ? 'text-indigo-700' : 'text-gray-600')}>{title}</span>
          {hint && <span className="text-[9px] text-gray-400 italic">{hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

