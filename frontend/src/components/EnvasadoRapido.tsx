/**
 * EnvasadoRapido — Flujo: Producto final → Cola (receta) → Envase → Materiales → Preview lotes → Animación
 */
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Package } from 'lucide-react';
import { produccionApi, productosApi, recetasApi } from '../api/client';
import type { Producto, Receta } from '../types';
import TanqueEnvasado from './TanqueEnvasado';
import SearchSelect from './SearchSelect';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Pre-select by product name (partial match) */
  initialProducto?: string;
  /** Pre-fill quantity */
  initialCantidad?: string;
}

export default function EnvasadoRapido({ open, onClose, onDone, initialProducto, initialCantidad }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [fase, setFase] = useState<'seleccion' | 'preview' | 'procesando' | 'completado' | 'error'>('seleccion');
  const [fillPct, setFillPct] = useState(0);
  const [resultado, setResultado] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Form
  const [productoFinalId, setProductoFinalId] = useState('');
  const [colaId, setColaId] = useState('');
  const [envaseId, setEnvaseId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [materiales, setMateriales] = useState<{ producto_id: string; cantidad: string }[]>([]);

  // Preview
  const [previewData, setPreviewData] = useState<any>(null);
  const [ordenCreada, setOrdenCreada] = useState<string | null>(null);

  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  useEffect(() => {
    if (open) {
      productosApi.listar({ activo: 'true' }).then(res => {
        const prods = res.data as Producto[];
        setProductos(prods);

        if (initialProducto) {
          const q = norm(initialProducto);
          const pe = prods.find(p => p.tipo === 'producto_envasado' && norm(p.nombre).includes(q));
          if (pe) {
            setProductoFinalId(pe.id);
            setColaId(pe.granel_id ?? '');
            setCantidad(initialCantidad ?? '');
            // Load recipe
            loadRecipe(pe.id, prods);
          }
        }
      });
      if (!initialProducto) {
        setProductoFinalId(''); setColaId(''); setEnvaseId(''); setCantidad(''); setMateriales([]);
      }
      setFase('seleccion'); setFillPct(0); setResultado(null); setErrorMsg(''); setPreviewData(null); setOrdenCreada(null);
    }
  }, [open]);

  const loadRecipe = async (prodId: string, prods?: Producto[]) => {
    try {
      const all = prods ?? productos;
      const res = await recetasApi.listar({ activa: 'true' });
      const recetas = res.data as Receta[];
      const receta = recetas.find(r => r.tipo_receta === 'envasado' && r.producto_id === prodId);
      if (!receta) return;
      const det = (await recetasApi.obtener(receta.id)).data as Receta;
      const ings = det.ingredientes ?? [];
      const colaIng = ings.find(i => all.find(p => p.id === i.materia_prima_id)?.tipo === 'producto_fabricado');
      const envaseIng = ings.find(i => all.find(p => p.id === i.materia_prima_id)?.tipo === 'material_embalaje');
      const otrosMats = ings.filter(i => all.find(p => p.id === i.materia_prima_id)?.tipo === 'material_embalaje' && i.id !== envaseIng?.id);
      if (colaIng) setColaId(colaIng.materia_prima_id);
      if (envaseIng) setEnvaseId(envaseIng.materia_prima_id);
      if (otrosMats.length > 0) setMateriales(otrosMats.map(m => ({ producto_id: m.materia_prima_id, cantidad: String(m.cantidad ?? '1') })));
    } catch { /* no recipe */ }
  };

  const productosEnvasados = productos.filter(p => p.tipo === 'producto_envasado');
  const colasDisponibles = productos.filter(p => p.tipo === 'producto_fabricado');
  const materialesEmbalaje = productos.filter(p => p.tipo === 'material_embalaje');
  const prodFinal = productos.find(p => p.id === productoFinalId);
  const colaSel = productos.find(p => p.id === colaId);
  const envaseSel = productos.find(p => p.id === envaseId);

  // Multiplier detection
  const multMatch = envaseSel?.nombre.match(/(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i);
  const mult = multMatch ? parseInt(multMatch[1], 10) : 1;
  const cantNum = parseInt(cantidad) || 0;
  const totalUds = cantNum * mult;
  const pesoUd = parseFloat(prodFinal?.peso_unitario_kg ?? '0');
  const colaNecesaria = totalUds * pesoUd;

  const puedeEnvasar = productoFinalId && colaId && envaseId && cantNum > 0;

  // Step 1: Create temp order + get preview
  const handlePreview = async () => {
    if (!puedeEnvasar) return;
    setFase('preview');
    try {
      const mats = materiales.filter(m => m.producto_id && parseFloat(m.cantidad) > 0).map(m => ({ producto_id: m.producto_id, cantidad: parseFloat(m.cantidad) }));
      // Create order as borrador
      const createRes = await produccionApi.envasadoPlanificar({
        producto_final_id: productoFinalId,
        cola_id: colaId,
        envase_id: envaseId,
        cantidad_unidades: cantNum,
        formato_label: envaseSel?.nombre,
        materiales: mats.length > 0 ? mats : undefined,
      });
      const ordId = (createRes.data as any).orden_id;
      setOrdenCreada(ordId);
      // Get preview
      const prev = await produccionApi.previewEnvasado(ordId);
      setPreviewData(prev.data);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      setErrorMsg(apiErr?.response?.data?.error ?? 'Error');
      setFase('error');
    }
  };

  // Step 2: Execute
  const handleConfirmar = async () => {
    if (!ordenCreada) return;
    setFase('procesando'); setFillPct(10);
    const interval = setInterval(() => setFillPct(prev => Math.min(prev + 8, 85)), 200);
    try {
      try { audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYuDe3J1eH+GjIuGgXx4eHyBhomLiYV/enh5fIGFiIqIhYB8eXl8gIWIioiGgX15eXyAhYiKiIaBfXl5fICEh4mIhoF9eXl8gISHiYiGgX15'); audioRef.current.volume = 0.15; audioRef.current.play().catch(() => {}); } catch {}
      const { data } = await produccionApi.confirmarEnvasado(ordenCreada);
      clearInterval(interval); setFillPct(100); setResultado(data);
      setTimeout(() => setFase('completado'), 800);
    } catch (err: unknown) {
      clearInterval(interval); setFillPct(0);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorMsg(msg ?? 'Error al envasar'); setFase('error');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-md" onClick={fase === 'procesando' ? undefined : onClose} />

      <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <Package size={15} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Envasado rapido</p>
              <p className="text-[10px] text-gray-400">Producto → Cola → Envase → Confirmar</p>
            </div>
          </div>
          {fase !== 'procesando' && <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={15} /></button>}
        </div>

        {/* Selection phase */}
        {fase === 'seleccion' && (
          <>
            {/* Producto final — outside scroll */}
            <div className="px-5 pt-5 pb-2 shrink-0">
              <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">1. Producto final</label>
              <SearchSelect
                options={productosEnvasados.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                value={productoFinalId}
                onChange={id => {
                  if (!id) { setProductoFinalId(''); setColaId(''); setEnvaseId(''); setMateriales([]); return; }
                  const prod = productos.find(p => p.id === id);
                  setProductoFinalId(id);
                  setColaId(prod?.granel_id ?? '');
                  setEnvaseId(''); setMateriales([]);
                  loadRecipe(id);
                }}
                placeholder="Buscar producto envasado... (ej: Logalkyl, Cartonaje, D2)"
                selectedLabel={prodFinal?.nombre}
                selectedSub={prodFinal?.codigo}
                selectedRight={prodFinal ? `${parseFloat(prodFinal.stock_actual).toLocaleString('es-ES')} ud` : undefined}
              />
            </div>

            <div className="px-5 pb-5 space-y-4 overflow-y-auto flex-1">
              {productoFinalId && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                  <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">2. Cola que lleva dentro</label>
                  <SearchSelect
                    options={colasDisponibles.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} kg` }))}
                    value={colaId}
                    onChange={id => setColaId(id)}
                    placeholder="Buscar cola..."
                    selectedLabel={colaSel?.nombre}
                    selectedRight={colaSel ? `${parseFloat(colaSel.stock_actual).toLocaleString('es-ES')} kg` : undefined}
                  />
                  {colaSel && prodFinal?.granel_id === colaSel.id && (
                    <p className="text-[10px] text-emerald-500 mt-1">Auto-asignada por receta</p>
                  )}
                </motion.div>
              )}

              {colaId && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">3. Envase</label>
                    <SearchSelect
                      options={materialesEmbalaje.map(p => ({ id: p.id, label: p.nombre, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')}` }))}
                      value={envaseId}
                      onChange={id => setEnvaseId(id)}
                      placeholder="Buscar envase..."
                      selectedLabel={envaseSel?.nombre}
                      selectedRight={envaseSel ? `${parseFloat(envaseSel.stock_actual).toLocaleString('es-ES')}` : undefined}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">
                      4. Cantidad {mult > 1 ? `(${envaseSel?.nombre?.match(/caja|pal[eé]|palet/i)?.[0] ?? 'cajas'})` : '(unidades)'}
                    </label>
                    <input type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)}
                      placeholder={mult > 1 ? `Ej: 10 (= ${10 * mult} ud)` : 'Ej: 50'}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-lg font-bold text-center font-mono focus:border-emerald-400 outline-none" />
                    {mult > 1 && cantNum > 0 && (
                      <p className="text-[10px] text-emerald-600 font-bold mt-1 text-center">
                        {cantNum} {envaseSel?.nombre?.match(/caja|pal[eé]|palet/i)?.[0] ?? 'envases'} × {mult} ud = {totalUds.toLocaleString('es-ES')} unidades totales
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Extra materials */}
              {envaseId && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Materiales extra</label>
                    <button onClick={() => setMateriales(m => [...m, { producto_id: '', cantidad: '1' }])}
                      className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">+ Añadir</button>
                  </div>
                  {materiales.length === 0 && <p className="text-[10px] text-gray-300 italic">Sin materiales extra</p>}
                  {materiales.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <div className="flex-1">
                        <SearchSelect
                          options={materialesEmbalaje.map(p => ({ id: p.id, label: p.nombre }))}
                          value={m.producto_id}
                          onChange={id => setMateriales(prev => prev.map((x, j) => j === i ? { ...x, producto_id: id } : x))}
                          placeholder="Material..."
                          selectedLabel={productos.find(p => p.id === m.producto_id)?.nombre}
                        />
                      </div>
                      <input type="number" min="1" value={m.cantidad}
                        onChange={e => setMateriales(prev => prev.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))}
                        className="w-16 rounded-lg border border-gray-200 px-2 py-2 text-xs text-center outline-none" />
                      <button onClick={() => setMateriales(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Summary */}
              {cantNum > 0 && envaseSel && colaSel && prodFinal && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-1.5 text-xs">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Resumen</p>
                  <div className="flex justify-between"><span className="text-gray-500">Producto:</span><span className="font-bold text-gray-800">{prodFinal.nombre}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Cola:</span><span className="font-bold text-gray-800">{colaSel.nombre}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Envase:</span><span className="font-bold text-gray-800">{envaseSel.nombre}</span></div>
                  <div className="border-t border-emerald-100 pt-2 mt-1 space-y-1">
                    {mult > 1 && (
                      <>
                        <div className="flex justify-between"><span className="text-gray-500">Envases:</span><span className="font-bold">{cantNum} {envaseSel.nombre}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">{cantNum} × {mult} ud/envase =</span><span className="font-bold">{totalUds.toLocaleString('es-ES')} ud</span></div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Cola necesaria{pesoUd > 0 ? ` (${totalUds} ud × ${pesoUd} kg)` : ''}:</span>
                      <span className={clsx('font-bold', colaNecesaria <= parseFloat(colaSel.stock_actual) ? 'text-emerald-600' : 'text-loga-red')}>
                        {colaNecesaria.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg
                      </span>
                    </div>
                    {mult > 1 && (
                      <div className="flex justify-between"><span className="text-gray-500">Envases a consumir:</span><span className="font-bold">{cantNum}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-gray-500">Produccion:</span><span className="font-black text-emerald-600 text-lg">{totalUds.toLocaleString('es-ES')} ud</span></div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>
              <button onClick={handlePreview} disabled={!puedeEnvasar}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:bg-gray-300 disabled:shadow-none transition-all">
                <Package size={16} /> Ver lotes y confirmar
              </button>
            </div>
          </>
        )}

        {/* Preview phase — show lots to consume */}
        {fase === 'preview' && previewData && (
          <>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <p className="text-xs text-gray-500">
                {previewData.multiplicador > 1
                  ? `${previewData.cantidad_input} × ${previewData.multiplicador} = ${previewData.total_unidades} unidades`
                  : `${previewData.total_unidades} unidades`}
                {' · '}{previewData.peso_cola.toFixed(2)} kg cola
              </p>
              {previewData.consumos.map((c: any, i: number) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-gray-900">{c.nombre}</span>
                    <span className={clsx('text-xs font-bold', c.suficiente ? 'text-emerald-600' : 'text-loga-red')}>
                      {c.cantidad_necesaria} {c.unidad} {!c.suficiente && '⚠ insuficiente'}
                    </span>
                  </div>
                  {c.lotes.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-2 text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 mb-1">
                      <code className="font-mono text-gray-500 flex-1 truncate">{l.lote_interno}</code>
                      <span className="tabular-nums text-gray-400">{parseFloat(l.cantidad_actual).toLocaleString('es-ES')} disp.</span>
                      <span className="tabular-nums font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">-{l.cantidad_a_usar} {c.unidad}</span>
                    </div>
                  ))}
                  {c.lotes.length === 0 && <p className="text-[10px] text-red-400 italic">Sin lotes</p>}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button onClick={() => setFase('seleccion')} className="text-sm text-gray-500 hover:text-gray-900">Volver</button>
              <button onClick={handleConfirmar} disabled={!previewData.todo_ok}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:bg-gray-300 disabled:shadow-none transition-all">
                <Package size={16} /> Envasar {previewData.total_unidades} ud
              </button>
            </div>
          </>
        )}

        {/* Preview loading */}
        {fase === 'preview' && !previewData && (
          <div className="flex items-center justify-center py-16">
            <span className="h-6 w-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Processing + animation */}
        {fase === 'procesando' && (
          <div className="flex flex-col items-center py-8 px-6 space-y-4">
            <TanqueEnvasado pct={fillPct} size={180} />
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-emerald-600 font-bold animate-pulse">Envasando...</motion.p>
          </div>
        )}

        {/* Completed */}
        {fase === 'completado' && resultado && (
          <div className="flex flex-col items-center py-8 px-6 space-y-4">
            <TanqueEnvasado pct={100} size={180} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-3 w-full max-w-sm">
              <div className="flex items-center justify-center gap-2 text-emerald-600">
                <Check size={24} /><p className="text-lg font-black">¡Envasado completado!</p>
              </div>
              <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 p-4 space-y-1 text-sm">
                <p className="font-bold text-gray-900">{resultado.producto_envasado}</p>
                <p className="text-emerald-700 font-mono text-lg font-black">{resultado.cantidad?.toLocaleString('es-ES')} unidades</p>
                <p className="text-xs text-gray-500">Cola consumida: {resultado.peso_cola_consumido?.toLocaleString('es-ES')} kg</p>
                <p className="text-xs text-gray-500">Lote: <code className="bg-white rounded px-1">{resultado.lote}</code></p>
              </div>
              <button onClick={() => { onDone(); onClose(); }}
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cerrar</button>
            </motion.div>
          </div>
        )}

        {/* Error */}
        {fase === 'error' && (
          <div className="flex flex-col items-center py-8 px-6 space-y-3">
            <p className="text-sm font-bold text-loga-red">Error al envasar</p>
            <p className="text-xs text-red-700 bg-red-50 rounded-lg p-3 w-full max-w-sm text-center">{errorMsg}</p>
            <button onClick={() => { setFase('seleccion'); setErrorMsg(''); }} className="rounded-xl border py-2 px-6 text-sm font-medium text-gray-600 hover:bg-gray-50">Reintentar</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
