/**
 * FabricacionModal — Vista por pasos con tanque minimalista rojo
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertCircle, Factory, ChevronRight, ChevronLeft, FlaskConical, Camera, ScanLine, Thermometer, Clock, Droplets, FileText } from 'lucide-react';
import { recetasApi, produccionApi, lotesApi, proveedoresApi } from '../api/client';
import type { OrdenProduccion, IngredienteReceta, Receta, PasoReceta } from '../types';
import clsx from 'clsx';
import axios from 'axios';
import BarcodeScanner from './BarcodeScanner';
import TanqueRojo from './TanqueRojo';
import TanqueEnvasado from './TanqueEnvasado';
import SearchSelect from './SearchSelect';

interface Props {
  orden: OrdenProduccion | null;
  onClose: () => void;
  onDone: () => void;
}

type Fase = 'cargando' | 'preparando' | 'confirmando' | 'fabricando' | 'completado' | 'error';

// ── Componente principal ──────────────────────────────────────────────────────
export default function FabricacionModal({ orden, onClose, onDone }: Props) {
  const [fase, setFase] = useState<Fase>('cargando');
  const [receta, setReceta] = useState<Receta | null>(null);
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [fillPct, setFillPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [loteProd, setLoteProd] = useState('');
  const [ph, setPh] = useState('');
  const [solidos, setSolidos] = useState('');
  const [viscosidad, setViscosidad] = useState('');
  const [cantidadReal, setCantidadReal] = useState('');
  const [fechaFab, setFechaFab] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [fotoPreviews, setFotoPreviews] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanIngId, setScanIngId] = useState<string | null>(null);
  const [lotesMP, setLotesMP] = useState<Record<string, { lote_interno: string; cantidad_actual: string; fecha_caducidad?: string }[]>>({});
  const [pasoActual, setPasoActual] = useState(0);
  const [temperatura, setTemperatura] = useState(25);
  const [registroLimpieza, setRegistroLimpieza] = useState('');
  const [limpiezaTipo, setLimpiezaTipo] = useState<'interna' | 'externa' | ''>('');
  const [limpiezaProducto, setLimpiezaProducto] = useState('');
  const [limpiezaVolumen, setLimpiezaVolumen] = useState('');
  const [limpiezaDestino, setLimpiezaDestino] = useState('');
  const [limpiezaProveedorId, setLimpiezaProveedorId] = useState('');
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string; telefono?: string; email?: string }[]>([]);

  const ingredientes: IngredienteReceta[] = receta?.ingredientes ?? [];
  const pasos: PasoReceta[] = receta?.pasos ?? [];
  const total = ingredientes.length;
  const nConf = confirmados.size;
  const hasPasos = pasos.length > 0;

  const pctPorIngrediente = total > 0 ? 90 / total : 0;
  const requiereLimpieza = pasos.some(p => p.fase === 'Limpieza');

  const lsKey = orden ? `fab_confirmados_${orden.id}` : null;

  const cargar = useCallback(async () => {
    if (!orden) return;
    setFase('cargando');
    setFillPct(0);
    setErrorMsg('');
    setLoteProd('');
    setPh('');
    setSolidos('');
    setViscosidad('');
    setCantidadReal('');
    // Usar hora local, no UTC
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setFechaFab(local);
    setFotos([]);
    setFotoPreviews([]);
    setTemperatura(25);
    try {
      const { data } = await recetasApi.obtener(orden.receta_id);
      const recetaData = data as Receta;
      setReceta(recetaData);

      const saved = localStorage.getItem(`fab_confirmados_${orden.id}`);
      const savedSet: Set<string> = saved ? new Set(JSON.parse(saved)) : new Set();
      const ingredientesTotal = recetaData.ingredientes?.length ?? 0;
      const pctPorIng = ingredientesTotal > 0 ? 90 / ingredientesTotal : 0;
      setConfirmados(savedSet);
      setFillPct(savedSet.size * pctPorIng);
      setFase(savedSet.size === ingredientesTotal && ingredientesTotal > 0 ? 'confirmando' : 'preparando');

      // Restore paso from localStorage
      const savedPaso = localStorage.getItem(`fab_paso_${orden.id}`);
      const pasoIdx = savedPaso ? parseInt(savedPaso, 10) : 0;
      setPasoActual(Math.min(pasoIdx, (recetaData.pasos ?? []).length - 1 || 0));

      const lotesMap: typeof lotesMP = {};
      for (const ing of recetaData.ingredientes ?? []) {
        try {
          const res = await lotesApi.listar({ producto_id: ing.materia_prima_id, estado: 'aprobado' });
          lotesMap[ing.materia_prima_id] = (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0);
        } catch { lotesMap[ing.materia_prima_id] = []; }
      }
      setLotesMP(lotesMap);
    } catch {
      setFase('error');
      setErrorMsg('No se pudo cargar la receta');
    }
  }, [orden]);

  useEffect(() => {
    if (orden) {
      cargar();
      proveedoresApi.listar().then(r => setProveedores(r.data as typeof proveedores)).catch(() => {});
    }
  }, [orden, cargar]);

  // Persist pasoActual to localStorage
  useEffect(() => {
    if (orden && hasPasos) localStorage.setItem(`fab_paso_${orden.id}`, String(pasoActual));
  }, [pasoActual, orden, hasPasos]);

  // Update temperature when paso changes (if pasos exist)
  useEffect(() => {
    if (!hasPasos || !pasos[pasoActual]?.temperatura) return;
    const target = parseFloat(pasos[pasoActual].temperatura!);
    if (isNaN(target)) return;
    const iv = setInterval(() => {
      setTemperatura(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.5) { clearInterval(iv); return target; }
        return prev + diff * 0.1;
      });
    }, 60);
    return () => clearInterval(iv);
  }, [pasoActual, hasPasos, pasos]);

  const confirmarIngrediente = (id: string) => {
    setConfirmados((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (!hasPasos) setFillPct(next.size * pctPorIngrediente);
      if (next.size === total) setFase('confirmando');
      if (lsKey) localStorage.setItem(lsKey, JSON.stringify([...next]));
      return next;
    });
  };

  const deshacerIngrediente = (id: string) => {
    setConfirmados((prev) => {
      const next = new Set(prev);
      next.delete(id);
      if (!hasPasos) setFillPct(next.size * pctPorIngrediente);
      if (fase === 'confirmando') setFase('preparando');
      if (lsKey) localStorage.setItem(lsKey, JSON.stringify([...next]));
      return next;
    });
  };

  // Fill by step — moved below allStepConfirmed declaration

  // Confirm all ingredients up to and including current step + advance
  const confirmarPaso = () => {
    // Confirm ingredients for ALL steps up to current (in case any were skipped)
    for (let s = 0; s <= pasoActual; s++) {
      const ids = pasos[s]?.ingredientes_ids ?? [];
      for (const mpId of ids) {
        const ing = ingredientes.find(i => i.materia_prima_id === mpId);
        if (ing && !confirmados.has(ing.id)) confirmarIngrediente(ing.id);
      }
    }

    // If last step or no ingredients left unconfirmed, confirm all remaining
    if (pasoActual >= pasos.length - 1) {
      for (const ing of ingredientes) {
        if (!confirmados.has(ing.id)) confirmarIngrediente(ing.id);
      }
    }

    if (pasoActual < pasos.length - 1) {
      setPasoActual(prev => prev + 1);
    }
  };

  const handleFotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles = Array.from(files);
    setFotos(prev => [...prev, ...newFiles]);
    for (const file of newFiles) {
      const reader = new FileReader();
      reader.onload = (ev) => setFotoPreviews(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeFoto = (idx: number) => {
    setFotos(prev => prev.filter((_, i) => i !== idx));
    setFotoPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleFabricar = async () => {
    if (!orden) return;
    setFase('fabricando');

    // Progressive fill from 0
    setFillPct(5);
    const fillInterval = setInterval(() => {
      setFillPct(prev => Math.min(prev + 3, 90));
    }, 150);

    try {
      const { data } = await produccionApi.confirmar(orden.id, {
        ph: ph || undefined,
        solidos: solidos || undefined,
        viscosidad: viscosidad || undefined,
        fecha_fabricacion: fechaFab || undefined,
        fotos: fotos.length > 0 ? fotos : undefined,
        cantidad_real_producida: cantidadReal || undefined,
        registro_limpieza: registroLimpieza || undefined,
      });
      clearInterval(fillInterval);
      setFillPct(100);
      setLoteProd((data as { lote_producido?: string }).lote_producido ?? '');
      if (lsKey) localStorage.removeItem(lsKey);
      if (orden) localStorage.removeItem(`fab_paso_${orden.id}`);
      setTimeout(() => { setFase('completado'); onDone(); }, 1000);
    } catch (err: unknown) {
      clearInterval(fillInterval);
      setFillPct(0);
      if (axios.isAxiosError(err)) {
        const raw = err.response?.data?.detalle ?? err.response?.data?.mensaje ?? err.response?.data?.error ?? '';
        // Parse STOCK_INSUFICIENTE:Acetato de Vinilo:necesario=460:disponible=100
        if (raw.includes('STOCK_INSUFICIENTE')) {
          const parts = raw.split(':');
          const nombre = parts[1] ?? '';
          const nec = parts[2]?.split('=')[1] ?? '?';
          const disp = parts[3]?.split('=')[1] ?? '?';
          setErrorMsg(`Stock insuficiente de ${nombre}: necesitas ${parseFloat(nec).toFixed(1)}, tienes ${parseFloat(disp).toFixed(1)}`);
        } else {
          setErrorMsg(raw || 'Error inesperado');
        }
      } else {
        setErrorMsg('Error inesperado');
      }
      setFase('error');
    }
  };

  const cantidad = orden ? parseFloat(orden.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '0';
  const unidad = receta?.unidad_medida ?? 'kg';
  const paso = hasPasos ? pasos[pasoActual] : null;

  // Check stock sufficiency for ALL ingredients
  const ratio = receta && orden ? parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento) : 0;
  const ingredientesSinStock = ingredientes.filter(ing => {
    const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
    const stock = parseFloat(ing.stock_actual ?? '0');
    return stock < necesario;
  });
  const todoConStock = ingredientesSinStock.length === 0 && ingredientes.length > 0;

  // Get ingredients for current step
  const stepIngIds = paso?.ingredientes_ids ?? [];
  const stepIngs = stepIngIds.map(mpId => ingredientes.find(i => i.materia_prima_id === mpId)).filter(Boolean) as IngredienteReceta[];
  const allStepConfirmed = stepIngs.length === 0 || stepIngs.every(i => confirmados.has(i.id));

  // Fill tank by step progress
  const nConfirmados = confirmados.size;
  useEffect(() => {
    if (!hasPasos) return;
    const completados = Math.min(pasoActual + 1, pasos.length);
    const pct = (completados / pasos.length) * 90;
    setFillPct(pct);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasoActual, hasPasos, pasos.length, nConfirmados]);

  // Ingredients not assigned to any step (show in flat list)
  const allStepMpIds = new Set(pasos.flatMap(p => p.ingredientes_ids ?? []));
  const unassignedIngs = ingredientes.filter(i => !allStepMpIds.has(i.materia_prima_id));

  if (!orden) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-md"
          onClick={fase === 'fabricando' ? undefined : onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.91, y: 28 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="relative z-10 w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-red-50 to-white border-b border-red-100">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-loga-red">
                <Factory size={17} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{orden.numero_orden}{orden.cliente ? ` — ${orden.cliente}` : ''}</p>
                <p className="text-xs text-gray-400">{orden.receta_nombre} · {cantidad} {unidad}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasPasos && fase === 'preparando' && (
                <span className="text-xs font-bold text-loga-red bg-red-50 rounded-full px-3 py-1">
                  Paso {pasoActual + 1}/{pasos.length}
                </span>
              )}
              {fase !== 'fabricando' && (
                <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 transition-colors">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row overflow-y-auto max-h-[80vh]">

            {/* ── Left: Steps / Ingredients ── */}
            <div className="flex-1 px-5 py-4 md:overflow-y-auto md:max-h-[70vh] border-b md:border-b-0 md:border-r border-gray-100">
              {fase === 'cargando' ? (
                <div className="flex justify-center py-10">
                  <span className="h-6 w-6 border-2 border-loga-red border-t-transparent rounded-full animate-spin" />
                </div>
              ) : hasPasos && fase === 'preparando' ? (
                /* ── Step-by-step view ── */
                <div className="space-y-4">
                  {/* Step timeline mini */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                    {pasos.map((_p, i) => {
                      const isDone = i < pasoActual || (i === pasoActual && allStepConfirmed && stepIngs.length > 0);
                      const isCurr = i === pasoActual;
                      return (
                        <button
                          key={i}
                          onClick={() => setPasoActual(i)}
                          className={clsx(
                            'flex items-center justify-center min-w-[36px] h-9 rounded-full text-xs font-bold whitespace-nowrap transition-all shrink-0',
                            isCurr
                              ? 'bg-loga-red text-white shadow-sm'
                              : isDone
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          )}
                        >
                          {isDone ? <Check size={11} /> : i + 1}
                        </button>
                      );
                    })}
                  </div>

                  {/* Current step card */}
                  <AnimatePresence mode="wait">
                    {paso && (
                      <motion.div
                        key={pasoActual}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-3"
                      >
                        <div className="rounded-xl border border-loga-red/20 bg-red-50/30 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center rounded-md bg-loga-red px-2.5 py-0.5 text-[11px] font-bold text-white uppercase tracking-wider">
                              {paso.fase}
                            </span>
                            <h4 className="font-bold text-gray-900 text-sm">{paso.titulo}</h4>
                          </div>
                          {paso.descripcion && (
                            <p className="text-sm text-gray-500 leading-relaxed mb-3">{paso.descripcion}</p>
                          )}
                          <div className="flex flex-wrap gap-3">
                            {paso.temperatura && (
                              <div className="flex items-center gap-1.5 text-sm">
                                <Thermometer size={14} className={parseFloat(paso.temperatura) > 60 ? 'text-loga-red' : 'text-blue-500'} />
                                <span className="font-mono font-bold text-gray-700">{paso.temperatura}°C</span>
                              </div>
                            )}
                            {paso.duracion_min && (
                              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                                <Clock size={14} />
                                <span>{paso.duracion_min}s sim.</span>
                              </div>
                            )}
                          </div>
                          {/* Limpieza — recordatorio */}
                          {paso.fase === 'Limpieza' && (
                            <p className="mt-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                              Al finalizar deberas indicar si la limpieza es interna o externa.
                            </p>
                          )}
                        </div>

                        {/* Ingredients for this step */}
                        {stepIngs.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Ingredientes de este paso</p>
                            {stepIngs.map((ing, i) => {
                              const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                              const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                              const stock = parseFloat(ing.stock_actual ?? '0');
                              const suficiente = stock >= necesario;
                              const conf = confirmados.has(ing.id);

                              return (
                                <motion.div
                                  key={ing.id}
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.05 }}
                                  className={clsx(
                                    'flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-all',
                                    conf ? 'border-emerald-200 bg-emerald-50' : suficiente ? 'border-gray-100 bg-white' : 'border-red-100 bg-red-50'
                                  )}
                                >
                                  <div className={clsx(
                                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                                    conf ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                                  )}>
                                    {conf ? <Check size={13} /> : <Droplets size={12} />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className={clsx('text-sm font-semibold truncate', conf && 'text-emerald-700 line-through')}>
                                        {ing.nombre_mp}
                                      </p>
                                      {ing.sds_url && (
                                        <a href={`${ing.sds_url}?token=${localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token')}`}
                                          target="_blank" rel="noopener noreferrer"
                                          className="shrink-0 rounded p-1 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Ficha de seguridad (SDS)">
                                          <FileText size={14} />
                                        </a>
                                      )}
                                    </div>
                                    <p className="text-base font-bold font-mono text-gray-800">
                                      {necesario.toFixed(2)} <span className="text-xs font-semibold text-gray-500">{ing.unidad_medida}</span>
                                      {!suficiente && <span className="ml-2 text-xs text-loga-red font-semibold">⚠ Stock: {stock.toFixed(2)}</span>}
                                    </p>
                                    {lotesMP[ing.materia_prima_id]?.length > 0 && (() => {
                                      const lotes = [...lotesMP[ing.materia_prima_id]].sort((a, b) => {
                                        if (a.fecha_caducidad && b.fecha_caducidad) return a.fecha_caducidad.localeCompare(b.fecha_caducidad);
                                        return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
                                      });
                                      let falta = necesario;
                                      const usar: { lote: typeof lotes[0]; tomar: number }[] = [];
                                      for (const l of lotes) {
                                        if (falta <= 0) break;
                                        const disponible = parseFloat(l.cantidad_actual);
                                        const tomar = Math.min(disponible, falta);
                                        usar.push({ lote: l, tomar });
                                        falta -= tomar;
                                      }
                                      return (
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                          {usar.map(({ lote: l, tomar }, li) => (
                                            <span key={li} className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-md px-2 py-0.5 font-bold font-mono">
                                              {l.lote_interno}: <span className="text-blue-900">{tomar.toFixed(2)} {ing.unidad_medida}</span>
                                            </span>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  {!conf ? (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => { setScanIngId(ing.id); setScanning(true); }}
                                        className="rounded-lg p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                                      >
                                        <ScanLine size={11} />
                                      </button>
                                      <button
                                        onClick={() => confirmarIngrediente(ing.id)}
                                        className="flex items-center gap-1 rounded-lg bg-loga-red px-2 py-1 text-[10px] font-bold text-white hover:bg-red-700 transition-colors"
                                      >
                                        OK <ChevronRight size={9} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button onClick={() => deshacerIngrediente(ing.id)} className="text-[10px] text-gray-400 hover:text-gray-600 underline">deshacer</button>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        )}

                        {/* Step without ingredients */}
                        {stepIngs.length === 0 && (
                          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 text-center">
                            <p className="text-xs text-gray-400">Paso sin ingredientes — verificar y continuar</p>
                          </div>
                        )}

                        {/* Navigation — touch-friendly 44px height */}
                        <div className="flex items-center gap-2 pt-2">
                          <button
                            onClick={() => setPasoActual(Math.max(0, pasoActual - 1))}
                            disabled={pasoActual === 0}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
                          >
                            <ChevronLeft size={14} /> Anterior
                          </button>
                          {pasoActual < pasos.length - 1 ? (
                            <button
                              onClick={confirmarPaso}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-loga-red px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 shadow-sm transition-colors"
                            >
                              {stepIngs.length > 0 && !allStepConfirmed ? 'Confirmar paso' : 'Siguiente paso'} <ChevronRight size={14} />
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                confirmarPaso();
                                for (const ing of unassignedIngs) {
                                  if (!confirmados.has(ing.id)) confirmarIngrediente(ing.id);
                                }
                              }}
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 shadow-sm transition-colors"
                            >
                              <Check size={12} /> Finalizar pasos
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Unassigned ingredients */}
                  {unassignedIngs.length > 0 && (
                    <div className="border-t border-gray-100 pt-3 space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Otros ingredientes</p>
                      {unassignedIngs.map((ing) => {
                        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                        const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                        const conf = confirmados.has(ing.id);
                        return (
                          <div key={ing.id} className={clsx(
                            'flex items-center gap-2 rounded-lg px-3 py-1.5 border text-xs',
                            conf ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100'
                          )}>
                            {conf ? <Check size={10} className="text-emerald-500" /> : <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />}
                            <span className={clsx('flex-1', conf && 'line-through text-emerald-700')}>{ing.nombre_mp}</span>
                            <span className="font-mono text-gray-400">{necesario.toFixed(1)} {ing.unidad_medida}</span>
                            {!conf && (
                              <button onClick={() => confirmarIngrediente(ing.id)} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:bg-gray-200">OK</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Flat list (no pasos or other phases) ── */
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Ingredientes</p>
                    <p className="text-[11px] text-gray-400">{nConf}/{total} confirmados</p>
                  </div>
                  <div className="space-y-2">
                    {ingredientes.map((ing, i) => {
                      const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                      const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                      const stock = parseFloat(ing.stock_actual ?? '0');
                      const suficiente = stock >= necesario;
                      const conf = confirmados.has(ing.id);
                      return (
                        <motion.div
                          key={ing.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className={clsx(
                            'flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all',
                            conf ? 'border-emerald-200 bg-emerald-50' : suficiente ? 'border-gray-100 bg-white hover:border-gray-200' : 'border-red-100 bg-red-50'
                          )}
                        >
                          <div className={clsx(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                            conf ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                          )}>
                            {conf ? <Check size={12} /> : i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={clsx('text-xs font-semibold truncate', conf ? 'text-emerald-700 line-through' : 'text-gray-800')}>
                                {ing.nombre_mp}
                              </p>
                              {ing.sds_url && (
                                <a href={`${ing.sds_url}?token=${localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token')}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="shrink-0 rounded p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50" title="Ficha SDS">
                                  <FileText size={12} />
                                </a>
                              )}
                            </div>
                            <p className="text-sm font-bold font-mono text-gray-800">
                              {necesario.toFixed(2)} <span className="text-xs font-semibold text-gray-500">{ing.unidad_medida}</span>
                              {!suficiente && <span className="ml-2 text-xs text-loga-red font-semibold">⚠ Stock: {stock.toFixed(2)}</span>}
                            </p>
                            {lotesMP[ing.materia_prima_id]?.length > 0 && (() => {
                              const lotes = [...lotesMP[ing.materia_prima_id]].sort((a, b) => {
                                if (a.fecha_caducidad && b.fecha_caducidad) return a.fecha_caducidad.localeCompare(b.fecha_caducidad);
                                return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
                              });
                              let falta = necesario;
                              const usar: typeof lotes = [];
                              for (const l of lotes) {
                                if (falta <= 0) break;
                                usar.push(l);
                                falta -= parseFloat(l.cantidad_actual);
                              }
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {usar.map((l, li) => (
                                    <span key={li} className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-md px-2 py-0.5 font-bold font-mono">
                                      {l.lote_interno} <span className="font-normal text-blue-500">({parseFloat(l.cantidad_actual).toFixed(0)} {ing.unidad_medida})</span>
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                          {fase !== 'fabricando' && fase !== 'completado' && (
                            conf ? (
                              <button onClick={() => deshacerIngrediente(ing.id)} className="shrink-0 text-[11px] text-gray-400 hover:text-gray-700 underline">deshacer</button>
                            ) : (
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => { setScanIngId(ing.id); setScanning(true); }} className="rounded-lg p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                                  <ScanLine size={12} />
                                </button>
                                <button
                                  onClick={() => confirmarIngrediente(ing.id)}
                                  className={clsx(
                                    'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                                    suficiente ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-loga-red/10 text-loga-red hover:bg-loga-red/20'
                                  )}
                                >
                                  OK <ChevronRight size={10} />
                                </button>
                              </div>
                            )
                          )}
                          {(fase === 'fabricando' || fase === 'completado') && conf && (
                            <Check size={14} className="text-emerald-500 shrink-0" />
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── Right: Tank + status ── */}
            <div className="w-full md:w-56 flex flex-col items-center justify-start gap-4 px-5 py-5 bg-gradient-to-b from-red-50/40 to-white md:overflow-y-auto md:max-h-[65vh]">
              {receta?.tipo_receta === 'envasado' ? (
                <TanqueEnvasado pct={fillPct} size={180} />
              ) : (
                <TanqueRojo pct={fillPct} temperatura={hasPasos ? temperatura : undefined} />
              )}

              {/* Progress bar */}
              <div className="w-full space-y-1">
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Ingredientes</span>
                  <span className="font-mono font-bold">{nConf}/{total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-loga-red"
                    animate={{ width: `${total > 0 ? (nConf / total) * 100 : 0}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 16 }}
                  />
                </div>
              </div>

              {/* Phase buttons */}
              <AnimatePresence mode="wait">
                {fase === 'preparando' && !hasPasos && (
                  <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-center text-gray-400">
                    Confirma cada ingrediente → botón OK
                  </motion.p>
                )}
                {fase === 'preparando' && hasPasos && (
                  <motion.p key="hint-pasos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-center text-gray-400">
                    Sigue los pasos del proceso
                  </motion.p>
                )}

                {fase === 'confirmando' && (
                  <motion.div key="fab-btn" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="w-full space-y-2.5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-gray-500 uppercase">Fecha/hora</label>
                      <input type="datetime-local" value={fechaFab} onChange={e => setFechaFab(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-loga-red outline-none" />
                    </div>
                    {receta?.tipo_receta !== 'envasado' && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">pH</label>
                        <input type="number" min="0" max="14" step="0.1" value={ph} onChange={e => setPh(e.target.value)} placeholder="7.2"
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-center font-mono focus:border-loga-red outline-none" />
                        {ph && receta?.ph_min && receta?.ph_max && (parseFloat(ph) < parseFloat(receta.ph_min) || parseFloat(ph) > parseFloat(receta.ph_max)) && (
                          <p className="text-[9px] text-amber-600 font-medium">Fuera ({receta.ph_min}-{receta.ph_max})</p>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">% Sol.</label>
                        <input type="number" min="0" max="100" step="0.1" value={solidos} onChange={e => setSolidos(e.target.value)} placeholder="52"
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-center font-mono focus:border-loga-red outline-none" />
                        {solidos && receta?.solidos_min && receta?.solidos_max && (parseFloat(solidos) < parseFloat(receta.solidos_min) || parseFloat(solidos) > parseFloat(receta.solidos_max)) && (
                          <p className="text-[9px] text-amber-600 font-medium">Fuera ({receta.solidos_min}-{receta.solidos_max}%)</p>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">Visc.</label>
                        <input type="number" min="0" step="1" value={viscosidad} onChange={e => setViscosidad(e.target.value)} placeholder="3500"
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-center font-mono focus:border-loga-red outline-none" />
                        {viscosidad && receta?.viscosidad_min && receta?.viscosidad_max && (parseFloat(viscosidad) < parseFloat(receta.viscosidad_min) || parseFloat(viscosidad) > parseFloat(receta.viscosidad_max)) && (
                          <p className="text-[9px] text-amber-600 font-medium">Fuera ({receta.viscosidad_min}-{receta.viscosidad_max})</p>
                        )}
                      </div>
                    </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-gray-500 uppercase">Fotos ({fotos.length})</label>
                      {fotoPreviews.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {fotoPreviews.map((src, i) => (
                            <div key={i} className="relative">
                              <img src={src} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-200" />
                              <button onClick={() => removeFoto(i)} className="absolute -top-1 -right-1 rounded-full bg-white shadow p-0.5 text-gray-500 hover:text-loga-red"><X size={9} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="flex items-center justify-center gap-1 w-full h-9 rounded-lg border border-dashed border-gray-300 cursor-pointer hover:border-loga-red hover:bg-red-50/30 transition-colors">
                        <Camera size={13} className="text-gray-400" />
                        <span className="text-[10px] text-gray-400">{fotos.length > 0 ? 'Más' : 'Subir fotos'}</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFotosChange} />
                      </label>
                    </div>
                    {/* Cantidad real producida */}
                    {receta?.tipo_receta !== 'envasado' && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-gray-500 uppercase">Cantidad real producida ({unidad})</label>
                        <input type="number" min="0" step="0.01" value={cantidadReal}
                          onChange={e => setCantidadReal(e.target.value)}
                          placeholder={cantidad}
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center font-bold font-mono focus:border-loga-red outline-none" />
                        {cantidadReal && parseFloat(cantidadReal) < parseFloat(cantidad) * 0.95 && (
                          <p className="text-[9px] text-amber-600 font-medium">
                            Merma: {(parseFloat(cantidad) - parseFloat(cantidadReal)).toFixed(1)} {unidad} ({(((parseFloat(cantidad) - parseFloat(cantidadReal)) / parseFloat(cantidad)) * 100).toFixed(1)}%)
                          </p>
                        )}
                      </div>
                    )}
                    {/* Registro de Limpieza */}
                    {requiereLimpieza && (
                      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-700 font-bold text-sm">Limpieza</span>
                          <span className="text-[10px] text-loga-red font-bold bg-red-50 rounded px-2 py-0.5">Obligatorio</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setLimpiezaTipo('interna')}
                            className={clsx('rounded-lg py-3 text-sm font-bold border-2 transition-all text-center',
                              limpiezaTipo === 'interna' ? 'border-amber-500 bg-amber-200 text-amber-900' : 'border-gray-200 bg-white text-gray-500')}>
                            Interna
                          </button>
                          <button type="button" onClick={() => { setLimpiezaTipo('externa'); setRegistroLimpieza('Limpieza externa'); }}
                            className={clsx('rounded-lg py-3 text-sm font-bold border-2 transition-all text-center',
                              limpiezaTipo === 'externa' ? 'border-amber-500 bg-amber-200 text-amber-900' : 'border-gray-200 bg-white text-gray-500')}>
                            Externa
                          </button>
                        </div>

                        {limpiezaTipo === 'interna' && (
                          <div className="space-y-2 pt-1">
                            <input value={limpiezaProducto} onChange={e => { setLimpiezaProducto(e.target.value); setRegistroLimpieza(`Interna: ${e.target.value}, ${limpiezaVolumen}, destino: ${limpiezaDestino}`); }}
                              placeholder="Producto (agua caliente, sosa, disolvente...)"
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                            <div className="grid grid-cols-2 gap-2">
                              <input value={limpiezaVolumen} onChange={e => { setLimpiezaVolumen(e.target.value); setRegistroLimpieza(`Interna: ${limpiezaProducto}, ${e.target.value}, destino: ${limpiezaDestino}`); }}
                                placeholder="Volumen (200 L)"
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                              <input value={limpiezaDestino} onChange={e => { setLimpiezaDestino(e.target.value); setRegistroLimpieza(`Interna: ${limpiezaProducto}, ${limpiezaVolumen}, destino: ${e.target.value}`); }}
                                placeholder="Destino (depuradora)"
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                            </div>
                          </div>
                        )}

                        {limpiezaTipo === 'externa' && (
                          <div className="space-y-2 pt-1">
                            <SearchSelect
                              options={proveedores.map(p => ({ id: p.id, label: p.nombre, sub: p.telefono || p.email || '' }))}
                              value={limpiezaProveedorId}
                              onChange={id => {
                                setLimpiezaProveedorId(id);
                                const prov = proveedores.find(p => p.id === id);
                                setRegistroLimpieza(prov ? `Limpieza externa: ${prov.nombre}` : 'Limpieza externa');
                              }}
                              placeholder="Buscar proveedor de limpieza..."
                              selectedLabel={proveedores.find(p => p.id === limpiezaProveedorId)?.nombre}
                              selectedSub={proveedores.find(p => p.id === limpiezaProveedorId)?.telefono ?? ''}
                            />
                            <textarea rows={2} value={registroLimpieza.includes(': ') ? registroLimpieza.split(': ').slice(1).join(': ').replace(proveedores.find(p => p.id === limpiezaProveedorId)?.nombre ?? '___', '').replace(/^[,\s]+/, '') : ''}
                              onChange={e => {
                                const prov = proveedores.find(p => p.id === limpiezaProveedorId);
                                const base = prov ? `Limpieza externa: ${prov.nombre}` : 'Limpieza externa';
                                setRegistroLimpieza(e.target.value ? `${base}. ${e.target.value}` : base);
                              }}
                              placeholder="Observaciones (opcional)"
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none resize-none focus:border-amber-400" />
                          </div>
                        )}
                      </div>
                    )}
                    {/* Stock warning */}
                    {ingredientesSinStock.length > 0 && (
                      <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 space-y-1">
                        <p className="text-xs font-bold text-loga-red">Stock insuficiente:</p>
                        {ingredientesSinStock.map(ing => {
                          const nec = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                          const stock = parseFloat(ing.stock_actual ?? '0');
                          return (
                            <p key={ing.id} className="text-xs text-red-700">
                              <b>{ing.nombre_mp}</b>: necesitas {nec.toFixed(1)} {ing.unidad_medida}, tienes {stock.toFixed(1)} {ing.unidad_medida}
                              <span className="text-loga-red font-bold"> (faltan {(nec - stock).toFixed(1)})</span>
                            </p>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={handleFabricar}
                      disabled={!todoConStock || (requiereLimpieza && !limpiezaTipo)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-loga-red px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-200 hover:bg-red-700 disabled:bg-gray-300 disabled:shadow-none transition-colors">
                      <FlaskConical size={15} /> {todoConStock ? 'Fabricar ahora' : 'Sin stock suficiente'}
                    </button>
                    {requiereLimpieza && !limpiezaTipo && todoConStock && (
                      <p className="text-[10px] text-amber-600 text-center font-medium">Selecciona tipo de limpieza (interna o externa)</p>
                    )}
                  </motion.div>
                )}

                {fase === 'fabricando' && (
                  <motion.div key="fab-ing" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="w-full text-center space-y-3 py-4">
                    {/* Progress bar */}
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-loga-red to-red-400 rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: `${fillPct}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        className="h-5 w-5 border-2 border-loga-red border-t-transparent rounded-full"
                      />
                      <p className="text-sm font-bold text-loga-red">Fabricando... {fillPct}%</p>
                    </div>
                    <p className="text-[10px] text-gray-400">Descontando materias primas y creando lote</p>
                  </motion.div>
                )}

                {fase === 'completado' && (
                  <motion.div key="done" initial={{ opacity: 0, scale: 0.85, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="w-full text-center space-y-3">
                    {/* Full progress bar */}
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full w-full" />
                    </div>
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2, stiffness: 400 }}
                      className="flex items-center justify-center gap-2 text-emerald-600">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                        <Check size={22} />
                      </div>
                      <p className="text-lg font-black">Fabricacion completada</p>
                    </motion.div>
                    {loteProd && (
                      <div className="rounded-xl bg-red-50 border-2 border-red-200 px-3 py-3">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Lote producido</p>
                        <p className="text-lg font-black font-mono text-loga-red break-all leading-tight">{loteProd}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-3 justify-center text-xs text-gray-500">
                      {ph && <span>pH: <b className="text-gray-700">{ph}</b></span>}
                      {solidos && <span>Sol: <b className="text-gray-700">{solidos}%</b></span>}
                      {viscosidad && <span>Visc: <b className="text-gray-700">{viscosidad}</b></span>}
                    </div>
                    {fotoPreviews.length > 0 && (
                      <div className="flex gap-1 flex-wrap justify-center mt-1">
                        {fotoPreviews.map((src, i) => <img key={i} src={src} alt="" className="h-12 w-12 object-cover rounded-lg border" />)}
                      </div>
                    )}
                    <button onClick={onClose} className="w-full mt-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cerrar</button>
                  </motion.div>
                )}

                {fase === 'error' && (
                  <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full text-center space-y-2">
                    <div className="flex items-center justify-center gap-1.5 text-loga-red">
                      <AlertCircle size={14} /><p className="text-xs font-semibold">ROLLBACK ejecutado</p>
                    </div>
                    <p className="text-[10px] text-red-700 bg-red-50 rounded-lg px-2 py-1.5 font-mono break-all text-left">{errorMsg}</p>
                    <button onClick={onClose} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cerrar</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      <BarcodeScanner
        open={scanning}
        onScan={(_code) => { setScanning(false); if (scanIngId) confirmarIngrediente(scanIngId); }}
        onClose={() => setScanning(false)}
      />
    </AnimatePresence>
  );
}
