/**
 * FabricacionModal — Vista por pasos con tanque minimalista rojo
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertCircle, Factory, ChevronRight, ChevronLeft, FlaskConical, Camera, ScanLine, Thermometer, Clock, Droplets, FileText, Download, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { recetasApi, produccionApi, lotesApi, proveedoresApi, productosApi, controlesCalidadApi } from '../api/client';
import type { OrdenProduccion, IngredienteReceta, Receta, PasoReceta } from '../types';
import clsx from 'clsx';
import axios from 'axios';
import BarcodeScanner from './BarcodeScanner';
import TanqueRojo from './TanqueRojo';
import TanqueEnvasado from './TanqueEnvasado';
import SearchSelect from './SearchSelect';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from './ToastFields';
import { checkStockBajo } from '../lib/stockAlerts';
import { withAuthToken } from '../lib/uploadsUrl';

interface Props {
  orden: OrdenProduccion | null;
  onClose: () => void;
  onDone: () => void;
}

type Fase = 'cargando' | 'preparando' | 'confirmando' | 'fabricando' | 'completado' | 'error';

// ── Componente principal ──────────────────────────────────────────────────────
export default function FabricacionModal({ orden, onClose, onDone }: Props) {
  const navigate = useNavigate();
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
  // Dosificado parcial acumulado por ingrediente_receta_id (kg). Se carga al abrir
  // el modal y se refresca tras cada echada parcial. Permite mostrar pendiente
  // POR PARTE (cuando el agua está dividida en varias filas).
  const [dosificadoPorMP, setDosificadoPorMP] = useState<Record<string, number>>({});
  // Echado por (ingrediente_id, paso_index) — permite redistribuir el sobrante
  // de un paso al siguiente (ej: si echó 28 en lugar de 30, próximo paso suma 2).
  const [echadoPorPaso, setEchadoPorPaso] = useState<Record<string, Record<number, number>>>({});
  // Cantidades ajustadas en vivo por el operario (id ingrediente → kg). Persistido en
  // localStorage para sobrevivir a recargas durante la fabricación.
  const [cantidadesAjustadas, setCantidadesAjustadas] = useState<Record<string, number>>({});
  // Últimos lotes del producto que se fabrica + specs (para comparar QC con históricos)
  const [historicoQC, setHistoricoQC] = useState<{
    productoSpecs: { solidos_min?: any; solidos_max?: any; ph_min?: any; ph_max?: any; viscosidad_min?: any; viscosidad_max?: any } | null;
    ultimosLotes: { lote_interno: string; created_at: string; solidos?: any; ph?: any; viscosidad?: any }[];
  }>({ productoSpecs: null, ultimosLotes: [] });
  const [pasoActual, setPasoActual] = useState(0);
  const [temperatura, setTemperatura] = useState(25);
  const [registroLimpieza, setRegistroLimpieza] = useState('');
  const [limpiezaTipo, setLimpiezaTipo] = useState<'interna' | 'externa' | ''>('');
  const [limpiezaTanque, setLimpiezaTanque] = useState('');
  const [limpiezaProducto, setLimpiezaProducto] = useState('');
  const [limpiezaDestino, setLimpiezaDestino] = useState('');
  const [limpiezaObservaciones, setLimpiezaObservaciones] = useState('');
  const [limpiezaProveedorId, setLimpiezaProveedorId] = useState('');
  const [limpiezaAlbaran, setLimpiezaAlbaran] = useState('');
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string; telefono?: string; email?: string }[]>([]);
  const inicioFabRef = useRef<string | null>(null);

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

      // Restore cantidades ajustadas (id → kg) — persistido en cada cambio
      const savedAjustes = localStorage.getItem(`fab_ajustes_${orden.id}`);
      setCantidadesAjustadas(savedAjustes ? JSON.parse(savedAjustes) : {});

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

      // Histórico QC del producto que se fabrica: últimos 2 lotes con valores físico-químicos
      try {
        const prodId = recetaData.producto_id;
        if (prodId) {
          const [prodRes, lotesRes] = await Promise.all([
            productosApi.obtener(prodId).catch(() => null),
            lotesApi.listar({ producto_id: prodId }).catch(() => null),
          ]);
          const prodData = (prodRes?.data as any) ?? null;
          const lotesData = (lotesRes?.data as any[]) ?? [];
          const ultimos = lotesData
            .filter(l => l.solidos != null || l.ph != null || l.viscosidad != null)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 2);
          setHistoricoQC({
            productoSpecs: prodData ? {
              solidos_min: prodData.solidos_min, solidos_max: prodData.solidos_max,
              ph_min: prodData.ph_min, ph_max: prodData.ph_max,
              viscosidad_min: prodData.viscosidad_min, viscosidad_max: prodData.viscosidad_max,
            } : null,
            ultimosLotes: ultimos,
          });
        }
      } catch { /* silencioso */ }
    } catch {
      setFase('error');
      setErrorMsg('No se pudo cargar la receta');
    }
  }, [orden]);

  // Recarga las dosificaciones parciales (echadas) desde backend.
  // Indexa por ingrediente_id (fila de receta) — permite mostrar el echado
  // por parte cuando un MP (agua) aparece varias veces en la receta.
  const recargarDosificaciones = useCallback(async () => {
    if (!orden) return;
    try {
      const { data } = await produccionApi.listarDosificaciones(orden.id);
      const items = (data as any).items as Array<{ ingrediente_id: string; echado: number }>;
      const map: Record<string, number> = {};
      for (const it of items) map[it.ingrediente_id] = Number(it.echado);
      setDosificadoPorMP(map);
      setEchadoPorPaso(((data as any).echadoPorPaso ?? {}) as Record<string, Record<number, number>>);
    } catch { /* silencioso */ }
  }, [orden]);

  useEffect(() => {
    if (orden) {
      inicioFabRef.current = new Date().toISOString();
      cargar();
      recargarDosificaciones();
      proveedoresApi.listar().then(r => setProveedores(r.data as typeof proveedores)).catch(() => {});
    } else {
      inicioFabRef.current = null;
    }
  }, [orden, cargar, recargarDosificaciones]);

  // Persist pasoActual to localStorage
  useEffect(() => {
    if (orden && hasPasos) localStorage.setItem(`fab_paso_${orden.id}`, String(pasoActual));
  }, [pasoActual, orden, hasPasos]);

  // Recalcular fillPct combinando ingredientes confirmados + echadas parciales
  // (cada echada de agua suma su fracción al tanque, sin esperar a OK).
  useEffect(() => {
    if (fase !== 'preparando' && fase !== 'confirmando') return;
    if (!orden || !receta || ingredientes.length === 0) return;
    const ratioR = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
    let progress = 0;
    for (const ing of ingredientes) {
      if (confirmados.has(ing.id)) {
        progress += 1;
      } else if (esAgua(ing.nombre_mp)) {
        const necesario = parseFloat(ing.cantidad) * ratioR * (1 + parseFloat(ing.porcentaje_merma) / 100);
        const echadoIng = dosificadoPorMP[ing.id] ?? 0;
        if (necesario > 0) progress += Math.min(1, echadoIng / necesario);
      }
    }
    const newPct = (progress / ingredientes.length) * 90;
    setFillPct(newPct);
  }, [confirmados, dosificadoPorMP, ingredientes, receta, orden, fase]);

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

  // Checklist de confirmaciones pendientes (mensajes definidos en cada MP).
  // Se rellena al pulsar "Fabricar" y bloquea hasta marcar todas.
  const [checklistConfirm, setChecklistConfirm] = useState<{ mpId: string; nombre: string; mensaje: string; ok: boolean }[] | null>(null);

  const handleFabricar = async () => {
    if (!orden) return;
    // Antes de fabricar, recopilar mensajes de confirmación de cada MP.
    if (!checklistConfirm) {
      const items = ingredientes
        .filter(i => i.confirmacion_msg && i.confirmacion_msg.trim())
        .map(i => ({ mpId: i.materia_prima_id, nombre: i.nombre_mp, mensaje: i.confirmacion_msg!.trim(), ok: false }));
      // Si hay alguno, mostrar checklist y NO fabricar todavía
      if (items.length > 0) {
        setChecklistConfirm(items);
        return;
      }
    } else {
      // Si ya estaba el checklist abierto, comprobamos que todos estén OK
      if (checklistConfirm.some(x => !x.ok)) return;
      setChecklistConfirm(null);
    }
    setFase('fabricando');

    // Progressive fill from 0
    setFillPct(5);
    const fillInterval = setInterval(() => {
      setFillPct(prev => Math.min(prev + 3, 90));
    }, 150);

    // Construir lista de ingredientes ajustados (solo los que el operario tocó).
    // Backend usará estas cantidades para descontar stock en vez de las teóricas.
    const ingredientesAjustados = Object.entries(cantidadesAjustadas).map(([ingId, cant]) => {
      const ing = ingredientes.find(i => i.id === ingId);
      return ing ? { materia_prima_id: ing.materia_prima_id, cantidad: cant } : null;
    }).filter((x): x is { materia_prima_id: string; cantidad: number } => x !== null);

    try {
      const { data } = await produccionApi.confirmar(orden.id, {
        ph: ph || undefined,
        solidos: solidos || undefined,
        viscosidad: viscosidad || undefined,
        fecha_fabricacion: fechaFab || undefined,
        fotos: fotos.length > 0 ? fotos : undefined,
        cantidad_real_producida: cantidadReal || undefined,
        registro_limpieza: registroLimpieza || undefined,
        fecha_inicio_cliente: inicioFabRef.current ?? undefined,
        ingredientes_ajustados: ingredientesAjustados.length > 0 ? ingredientesAjustados : undefined,
      });
      clearInterval(fillInterval);
      setFillPct(100);
      const res = data as { lote_producido?: string; qc_fuera_de_rango?: boolean; qc_desviaciones?: string[]; lote_estado?: string };
      setLoteProd(res.lote_producido ?? '');
      if (lsKey) localStorage.removeItem(lsKey);
      if (orden) localStorage.removeItem(`fab_paso_${orden.id}`);
      if (orden) localStorage.removeItem(`fab_ajustes_${orden.id}`);

      // ── Auto-crear registro en Control de Calidad → Limpieza ──
      // Si la receta requería limpieza y el operario rellenó la sección,
      // generamos un control firmado tipo='limpieza' con los datos. Aparece
      // automáticamente en Control Calidad → pestaña Limpieza.
      if (requiereLimpieza && registroLimpieza && registroLimpieza.trim()) {
        try {
          const accionTxt = limpiezaTipo === 'externa'
            ? (() => {
                const prov = proveedores.find(p => p.id === limpiezaProveedorId);
                const partes: string[] = [];
                if (prov) partes.push(`Limpieza externa por ${prov.nombre}`);
                if (limpiezaAlbaran) partes.push(`Albarán: ${limpiezaAlbaran}`);
                return partes.length > 0 ? partes.join(' · ') : 'Limpieza externa';
              })()
            : (() => {
                const partes: string[] = [];
                if (limpiezaProducto) partes.push(`Producto: ${limpiezaProducto}`);
                if (limpiezaDestino)  partes.push(`Destino residuo: ${limpiezaDestino}`);
                return `Limpieza interna — ${partes.join(' · ')}`;
              })();
          const resultadoCtrl = 'correcto';
          const deposito = limpiezaTanque
            || (receta?.nombre ? `Reactor (${receta.nombre})` : 'Reactor');
          await controlesCalidadApi.crear({
            tipo: 'limpieza',
            fecha: (fechaFab || new Date().toISOString()).slice(0, 10),
            resultado: resultadoCtrl,
            estado: 'completado',
            deposito_equipo: deposito,
            accion: accionTxt,
            observaciones: [
              limpiezaObservaciones,
              `Auto-generado al confirmar fabricación ${orden.numero_orden}${res.lote_producido ? ` — Lote ${res.lote_producido}` : ''}.`,
            ].filter(Boolean).join(' '),
            lote_codigo: res.lote_producido ?? null,
            producto_id: receta?.producto_id ?? null,
            producto_nombre: orden.receta_nombre ?? receta?.nombre ?? null,
          });
        } catch {
          console.warn('[fabricacion] no se pudo crear control de limpieza auto');
        }
      }

      // If QC out of range, show warning before completing
      if (res.qc_fuera_de_rango) {
        const errMsg = `⚠ Control de calidad fuera de rango:\n${(res.qc_desviaciones ?? []).join('\n')}\n\nEl lote se ha creado en CUARENTENA. Requiere aprobación manual en Lotes.`;
        setErrorMsg(errMsg);
        notify.warning('Lote en cuarentena', { description: 'QC fuera de rango — requiere aprobación manual' });
        setFase('error');
        onDone();
      } else {
        // Compute duration in minutes
        const inicio = inicioFabRef.current;
        const duracionMin = inicio ? Math.round((Date.now() - new Date(inicio).getTime()) / 60000) : 0;
        const cantidadFinal = cantidadReal || cantidad;
        const ordenId = orden.id;
        notify.success('Fabricación completada', {
          description: (
            <ToastBlock title={`Lote ${res.lote_producido ?? '—'}`}>
              <ToastField label="Producido" value={`${cantidadFinal} ${unidad}`} />
              <ToastField label="Duración" value={duracionMin > 0 ? `${duracionMin} min` : ''} />
            </ToastBlock>
          ),
          button: {
            title: 'Ver detalle',
            onClick: () => {
              onClose();
              navigate(`/produccion?detalle=${ordenId}`);
            },
          },
          expand: true,
        });
        setTimeout(() => checkStockBajo(), 1500);
        setTimeout(() => { setFase('completado'); onDone(); }, 1000);
      }
    } catch (err: unknown) {
      clearInterval(fillInterval);
      setFillPct(0);
      let parsedMsg = 'Error inesperado';
      if (axios.isAxiosError(err)) {
        const raw = err.response?.data?.detalle ?? err.response?.data?.mensaje ?? err.response?.data?.error ?? '';
        if (raw.includes('STOCK_INSUFICIENTE')) {
          const parts = raw.split(':');
          const nombre = parts[1] ?? '';
          const nec = parts[2]?.split('=')[1] ?? '?';
          const disp = parts[3]?.split('=')[1] ?? '?';
          parsedMsg = `Stock insuficiente de ${nombre}: necesitas ${parseFloat(nec).toFixed(1)}, tienes ${parseFloat(disp).toFixed(1)}`;
        } else {
          parsedMsg = raw || 'Error inesperado';
        }
      }
      setErrorMsg(parsedMsg);
      notify.error('Fabricación fallida', { description: parsedMsg });
      setFase('error');
    }
  };

  const cantidad = orden ? parseFloat(orden.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '0';
  const unidad = receta?.unidad_medida ?? 'kg';
  const paso = hasPasos ? pasos[pasoActual] : null;

  // Check stock sufficiency for ALL ingredients (usar stock_disponible = solo lotes APROBADO menos reservas)
  const ratio = receta && orden ? parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento) : 0;
  const ingredientesSinStock = ingredientes.filter(ing => {
    const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
    const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? '0');
    return stock < necesario;
  });
  const todoConStock = ingredientesSinStock.length === 0 && ingredientes.length > 0;

  // Si el agua está repartida por pasos (alguna paso tiene cantidad_agua),
  // se gestiona vía la tarjeta azul DosificarAguaPaso — no se duplica en la
  // lista de ingredientes del paso ni en los huérfanos.
  const aguaPorPasos = pasos.some(p => Number(p.cantidad_agua) > 0);
  const aguaIngIds = new Set(
    aguaPorPasos ? ingredientes.filter(i => esAgua(i.nombre_mp)).map(i => i.id) : []
  );

  // Get ingredients for current step
  const stepIngIds = paso?.ingredientes_ids ?? [];
  const stepIngs = (stepIngIds.map(mpId => ingredientes.find(i => i.materia_prima_id === mpId)).filter(Boolean) as IngredienteReceta[])
    .filter(i => !aguaIngIds.has(i.id));
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

  // Ingredients not assigned to any step (show in flat list).
  // Excluye agua si está gestionada por pasos via cantidad_agua.
  const allStepMpIds = new Set(pasos.flatMap(p => p.ingredientes_ids ?? []));
  const unassignedIngs = ingredientes
    .filter(i => !allStepMpIds.has(i.materia_prima_id))
    .filter(i => !aguaIngIds.has(i.id));

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
              <button
                onClick={async () => {
                  if (!orden) return;
                  try {
                    const { default: api } = await import('../api/client');
                    const res = await api.post(
                      `/produccion/${orden.id}/receta.pdf`,
                      { ajustes: cantidadesAjustadas ?? {} },
                      { responseType: 'blob' }
                    );
                    const blob = new Blob([res.data], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `receta-${orden.numero_orden ?? orden.id}.pdf`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1500);
                  } catch {
                    /* manejado por notify global o silent */
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-loga-red transition-colors"
                title="Descargar receta completa en PDF"
              >
                <Download size={16} />
                <span className="text-xs font-semibold hidden sm:inline">Descargar receta</span>
              </button>
              <button
                onClick={async () => {
                  if (!orden) return;
                  try {
                    const { default: api } = await import('../api/client');
                    const res = await api.get(`/produccion/${orden.id}/etiqueta.pdf`, { responseType: 'blob' });
                    const blob = new Blob([res.data], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `etiqueta-${orden.numero_orden ?? orden.id}.pdf`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1500);
                  } catch { /* silent */ }
                }}
                className="inline-flex items-center gap-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-loga-red transition-colors"
                title="Descargar etiqueta para imprimir"
              >
                <Tag size={16} />
                <span className="text-xs font-semibold hidden sm:inline">Etiqueta</span>
              </button>
              {fase !== 'fabricando' && (
                <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 transition-colors">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row overflow-y-auto max-h-[80vh]">

            {/* ── Far-left (lg+): Receta original (sólo lectura) ── */}
            {receta && orden && (fase === 'preparando' || fase === 'confirmando' || fase === 'cargando') && (
              <div className="hidden lg:flex flex-col w-56 shrink-0 border-r border-gray-100 bg-gradient-to-b from-gray-50/60 to-white px-4 py-4 lg:overflow-y-auto lg:max-h-[70vh]">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Receta original</p>
                <p className="mt-1 text-sm font-semibold text-gray-800 leading-tight">{receta.nombre}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  Rendimiento: <b className="text-gray-700">{parseFloat(receta.rendimiento).toFixed(2)} {receta.unidad_medida}</b>
                </p>
                <p className="text-[11px] text-gray-500">
                  Esta orden: <b className="text-gray-700">{parseFloat(orden.cantidad_planificada).toFixed(2)} {receta.unidad_medida}</b>
                </p>
                <div className="my-3 h-px bg-gray-100" />
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Ingredientes (teóricos)</p>
                <div className="space-y-1.5">
                  {ingredientes.map((ing) => {
                    const ratioR = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
                    const tt = parseFloat(ing.cantidad) * ratioR * (1 + parseFloat(ing.porcentaje_merma) / 100);
                    return (
                      <div key={`origR-${ing.id || ing.materia_prima_id}`} className="text-[11px] flex justify-between gap-2 leading-tight">
                        <span className="text-gray-700 truncate" title={ing.nombre_mp}>{ing.nombre_mp}</span>
                        <span className="font-mono font-bold text-gray-600 shrink-0">{tt.toFixed(2)} {ing.unidad_medida}</span>
                      </div>
                    );
                  })}
                </div>
                {pasos.length > 0 && (
                  <>
                    <div className="my-3 h-px bg-gray-100" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Pasos</p>
                    <ol className="space-y-1 list-decimal list-inside">
                      {pasos.map((p, i) => (
                        <li key={`origP-${i}`} className="text-[11px] text-gray-600 leading-tight">
                          <b className="text-gray-800">{p.titulo ?? p.fase ?? `Paso ${i + 1}`}</b>
                          {p.temperatura && <span className="text-gray-400"> · {p.temperatura}°C</span>}
                          {p.duracion_min && <span className="text-gray-400"> · {p.duracion_min} min</span>}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}

            {/* ── Left: Steps / Ingredients ── */}
            <div className="flex-1 px-5 py-4 lg:overflow-y-auto lg:max-h-[70vh] border-b lg:border-b-0 lg:border-r border-gray-100">
              {fase === 'cargando' ? (
                <div className="flex justify-center py-10">
                  <span className="h-6 w-6 border-2 border-loga-red border-t-transparent rounded-full animate-spin" />
                </div>
              ) : hasPasos && fase === 'preparando' ? (
                /* ── Step-by-step view ── */
                <div className="space-y-4">
                  {/* ── Histórico QC: últimas fabricaciones del mismo producto ── */}
                  {historicoQC.ultimosLotes.length > 0 && (() => {
                    const specs = historicoQC.productoSpecs;
                    // SIEMPRE muestra las 3 columnas (pH, %Sól, Visc). Sin rango → gris.
                    const cls = (v: any, min: any, max: any) => {
                      if (v == null) return 'text-gray-300';
                      const n = parseFloat(String(v));
                      if (isNaN(n)) return 'text-gray-300';
                      if (min == null && max == null) return 'text-gray-600'; // sin rango → neutro
                      if (min != null && n < parseFloat(min)) return 'text-loga-red font-bold';
                      if (max != null && n > parseFloat(max)) return 'text-loga-red font-bold';
                      return 'text-emerald-700 font-bold';
                    };
                    const fmt = (v: any) => v == null ? '—' : parseFloat(String(v)).toString();
                    const rangoStr = (min: any, max: any, unit = '') => {
                      if (min == null && max == null) return '—';
                      const f = (v: any) => v != null ? parseFloat(v).toString() : '?';
                      return `${f(min)}–${f(max)}${unit}`;
                    };
                    return (
                      <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5">
                        <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">Últimas fabricaciones · QC</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left py-0.5 font-medium">Lote</th>
                              <th className="text-left py-0.5 font-medium">Fecha</th>
                              <th className="text-right py-0.5 font-medium">pH</th>
                              <th className="text-right py-0.5 font-medium">%Sól.</th>
                              <th className="text-right py-0.5 font-medium">Visc.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historicoQC.ultimosLotes.map((l, i) => (
                              <tr key={i} className="border-t border-violet-100">
                                <td className="py-1 font-mono text-gray-700">{l.lote_interno}</td>
                                <td className="py-1 text-gray-500">{new Date(l.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.ph,         specs?.ph_min,         specs?.ph_max))}>{fmt(l.ph)}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.solidos,    specs?.solidos_min,    specs?.solidos_max))}>{fmt(l.solidos)}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.viscosidad, specs?.viscosidad_min, specs?.viscosidad_max))}>{fmt(l.viscosidad)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-violet-200 text-gray-500 text-[10px]">
                              <td className="py-0.5" colSpan={2}>Rango aceptable</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.ph_min, specs?.ph_max)}</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.solidos_min, specs?.solidos_max, ' %')}</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.viscosidad_min, specs?.viscosidad_max, ' cP')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* Echar agua INICIAL (opcional, antes de los pasos). Útil cuando
                      el operario quiere pre-cargar agua al reactor antes de empezar.
                      Solo aparece si la receta tiene agua. */}
                  {orden && (() => {
                    const aguaIng = ingredientes.find(i => esAgua(i.nombre_mp));
                    if (!aguaIng) return null;
                    const ratioR = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                    const totalNecesario = parseFloat(aguaIng.cantidad) * ratioR * (1 + parseFloat(aguaIng.porcentaje_merma) / 100);
                    const echadoTotal = dosificadoPorMP[aguaIng.id] ?? 0;
                    const echadoInicial = (echadoPorPaso[aguaIng.id] ?? {})[-1] ?? 0;
                    return (
                      <EcharAguaInicial
                        ordenId={orden.id}
                        ingredienteId={aguaIng.id}
                        productoId={aguaIng.materia_prima_id}
                        unidad={aguaIng.unidad_medida ?? 'kg'}
                        totalNecesario={totalNecesario}
                        echadoTotal={echadoTotal}
                        echadoInicial={echadoInicial}
                        onChange={() => {
                          recargarDosificaciones();
                          lotesApi.listar({ producto_id: aguaIng.materia_prima_id, estado: 'aprobado' })
                            .then(res => setLotesMP(prev => ({ ...prev, [aguaIng.materia_prima_id]: (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0) })))
                            .catch(() => {});
                        }}
                      />
                    );
                  })()}

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
                                <span>{paso.duracion_min} min</span>
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

                        {/* Acumulado en tanque — running total de ingredientes confirmados
                            (todos los pasos). Usa cantidades AJUSTADAS por el operario (si
                            las hubo); en caso contrario, el valor teórico calculado. */}
                        {ingredientes.length > 0 && receta && (() => {
                          const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
                          let acumulado = 0;
                          let totalTeorico = 0;
                          for (const ing of ingredientes) {
                            const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                            const real = cantidadesAjustadas[ing.id] ?? teorico;
                            totalTeorico += teorico;
                            if (confirmados.has(ing.id)) acumulado += real;
                            else if (esAgua(ing.nombre_mp)) acumulado += Math.min(real, dosificadoPorMP[ing.id] ?? 0);
                          }
                          const pct = totalTeorico > 0 ? (acumulado / totalTeorico) * 100 : 0;
                          return (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">Acumulado en tanque</span>
                                <span className="text-[11px] font-semibold text-blue-700">{pct.toFixed(0)}%</span>
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold font-mono text-blue-900">{acumulado.toFixed(2)}</span>
                                <span className="text-sm text-blue-600">/ {totalTeorico.toFixed(2)} kg</span>
                              </div>
                              <div className="mt-2 h-1.5 rounded-full bg-blue-100 overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 transition-all duration-300"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}

                        {/* Echada de agua específica de este paso (cantidad_agua).
                            Suma el sobrante NO echado de pasos anteriores. */}
                        {pasos[pasoActual]?.cantidad_agua != null && orden && (() => {
                          const cantPaso = Number(pasos[pasoActual].cantidad_agua);
                          if (!Number.isFinite(cantPaso) || cantPaso <= 0) return null;
                          const aguaIng = ingredientes.find(i => esAgua(i.nombre_mp));
                          if (!aguaIng) return null;
                          const ratioR = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                          const totalNecesario = parseFloat(aguaIng.cantidad) * ratioR * (1 + parseFloat(aguaIng.porcentaje_merma) / 100);
                          const echadoTotal = dosificadoPorMP[aguaIng.id] ?? 0;
                          const pteTotal = Math.max(0, totalNecesario - echadoTotal);
                          // Sobrante NO echado de pasos anteriores (con cantidad_agua definida).
                          // Permite valores negativos (over-pour) para que la sugerencia se
                          // reduzca correctamente si el operario echó de más antes.
                          // Incluye paso_index=-1 (echadas iniciales) — restan al próximo.
                          const echadoPorPasoIng = echadoPorPaso[aguaIng.id] ?? {};
                          let sobranteAnterior = 0;
                          // Echadas iniciales (paso_index=-1): se cuentan como sobrante negativo
                          // (cero planificado, X echado → sobrante -X). Solo afecta al paso 0.
                          if (pasoActual === 0) {
                            sobranteAnterior -= (echadoPorPasoIng[-1] ?? 0);
                          }
                          for (let pi = 0; pi < pasoActual; pi++) {
                            const planAnt = Number(pasos[pi]?.cantidad_agua);
                            if (Number.isFinite(planAnt) && planAnt > 0) {
                              const planAntEsc = planAnt * ratioR;
                              const echadoAnt = echadoPorPasoIng[pi] ?? 0;
                              sobranteAnterior += (planAntEsc - echadoAnt);
                            }
                          }
                          const baseEscalada = cantPaso * ratioR;
                          // Sugerencia = lo de este paso + sobrante de anteriores.
                          // No se topea contra pteTotal: el operario PUEDE echar más
                          // del total planificado (over-pour). Stock se descuenta de verdad.
                          const sugerida = Math.max(0, baseEscalada + sobranteAnterior);
                          return (
                            <DosificarAguaPaso
                              ordenId={orden.id}
                              ingredienteId={aguaIng.id}
                              productoId={aguaIng.materia_prima_id}
                              cantidadSugerida={sugerida}
                              cantidadPlanPaso={baseEscalada}
                              sobranteAnterior={sobranteAnterior}
                              unidad={aguaIng.unidad_medida ?? 'kg'}
                              echadoTotal={echadoTotal}
                              echadoEstePaso={echadoPorPasoIng[pasoActual] ?? 0}
                              totalNecesario={totalNecesario}
                              pteTotal={pteTotal}
                              pasoNum={pasoActual + 1}
                              pasoIndex={pasoActual}
                              onChange={() => {
                                recargarDosificaciones();
                                lotesApi.listar({ producto_id: aguaIng.materia_prima_id, estado: 'aprobado' })
                                  .then(res => setLotesMP(prev => ({ ...prev, [aguaIng.materia_prima_id]: (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0) })))
                                  .catch(() => {});
                              }}
                            />
                          );
                        })()}

                        {/* Ingredients for this step */}
                        {stepIngs.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Ingredientes de este paso</p>
                            {stepIngs.map((ing, i) => {
                              const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                              const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                              const ajustado = cantidadesAjustadas[ing.id];
                              const necesario = ajustado ?? teorico;
                              const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? "0");
                              const suficiente = stock >= necesario;
                              const conf = confirmados.has(ing.id);

                              const setAjuste = (val: number | null) => {
                                setCantidadesAjustadas(prev => {
                                  const next = { ...prev };
                                  if (val == null || val === teorico) delete next[ing.id];
                                  else next[ing.id] = val;
                                  if (orden) localStorage.setItem(`fab_ajustes_${orden.id}`, JSON.stringify(next));
                                  return next;
                                });
                              };
                              const step = teorico >= 100 ? 1 : teorico >= 10 ? 0.5 : teorico >= 1 ? 0.1 : 0.01;

                              return (
                                <motion.div
                                  key={ing.id || ing.materia_prima_id || `ing-${i}`}
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
                                        <a href={withAuthToken(ing.sds_url)}
                                          target="_blank" rel="noopener noreferrer"
                                          className="shrink-0 rounded p-1 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Ficha de seguridad (SDS)">
                                          <FileText size={14} />
                                        </a>
                                      )}
                                    </div>
                                    {/* Cantidad — editable mientras no esté confirmado */}
                                    {conf ? (
                                      <p className="text-base font-bold font-mono text-emerald-700 line-through">
                                        {necesario.toFixed(2)} <span className="text-xs font-semibold">{ing.unidad_medida}</span>
                                      </p>
                                    ) : (
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <button
                                          onClick={() => setAjuste(Math.max(0, necesario - step))}
                                          className="rounded-md w-6 h-6 flex items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 text-base leading-none"
                                          title={`-${step}`}
                                        >−</button>
                                        <input
                                          type="number"
                                          step={step}
                                          min={0}
                                          value={necesario.toFixed(2)}
                                          onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            if (!isNaN(v) && v >= 0) setAjuste(v);
                                          }}
                                          className="w-20 text-center font-mono font-bold text-base bg-white border border-gray-200 rounded-md px-1.5 py-0.5 focus:border-loga-red focus:outline-none"
                                        />
                                        <button
                                          onClick={() => setAjuste(necesario + step)}
                                          className="rounded-md w-6 h-6 flex items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 text-base leading-none"
                                          title={`+${step}`}
                                        >+</button>
                                        <span className="text-xs font-semibold text-gray-500">{ing.unidad_medida}</span>
                                        {ajustado != null && (
                                          <button
                                            onClick={() => setAjuste(null)}
                                            className="text-[10px] text-amber-600 hover:text-amber-800 underline ml-1"
                                            title={`Receta: ${teorico.toFixed(2)} ${ing.unidad_medida}`}
                                          >
                                            ajustado (vs {teorico.toFixed(2)}) — reset
                                          </button>
                                        )}
                                        {!suficiente && <span className="ml-1 text-xs text-loga-red font-semibold">⚠ Stock: {stock.toFixed(2)}</span>}
                                      </div>
                                    )}
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
                                    {esAgua(ing.nombre_mp) && orden && !conf && (
                                      <DosificarAguaInline
                                        ordenId={orden.id}
                                        ingredienteId={ing.id}
                                        productoId={ing.materia_prima_id}
                                        unidad={ing.unidad_medida ?? 'kg'}
                                        necesario={necesario}
                                        echado={dosificadoPorMP[ing.id] ?? 0}
                                        onChange={() => {
                                          recargarDosificaciones();
                                          lotesApi.listar({ producto_id: ing.materia_prima_id, estado: 'aprobado' })
                                            .then(res => setLotesMP(prev => ({ ...prev, [ing.materia_prima_id]: (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0) })))
                                            .catch(() => {});
                                        }}
                                      />
                                    )}
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
                      {unassignedIngs.map((ing, idx) => {
                        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                        const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                        const conf = confirmados.has(ing.id);
                        return (
                          <div key={ing.id || ing.materia_prima_id || `un-${idx}`} className={clsx(
                            'rounded-lg px-3 py-1.5 border text-xs',
                            conf ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100'
                          )}>
                            <div className="flex items-center gap-2">
                              {conf ? <Check size={10} className="text-emerald-500" /> : <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />}
                              <span className={clsx('flex-1', conf && 'line-through text-emerald-700')}>{ing.nombre_mp}</span>
                              <span className="font-mono text-gray-400">{necesario.toFixed(1)} {ing.unidad_medida}</span>
                              {!conf && (
                                <button onClick={() => confirmarIngrediente(ing.id)} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:bg-gray-200">OK</button>
                              )}
                            </div>
                            {esAgua(ing.nombre_mp) && !conf && (
                              <DosificarAguaInline
                                ordenId={orden.id}
                                ingredienteId={ing.id}
                                productoId={ing.materia_prima_id}
                                unidad={ing.unidad_medida ?? 'kg'}
                                necesario={necesario}
                                echado={dosificadoPorMP[ing.id] ?? 0}
                                onChange={() => {
                                  recargarDosificaciones();
                                  lotesApi.listar({ producto_id: ing.materia_prima_id, estado: 'aprobado' })
                                    .then(res => setLotesMP(prev => ({ ...prev, [ing.materia_prima_id]: (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0) })))
                                    .catch(() => {});
                                }}
                              />
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
                  {/* Histórico QC (últimas 2 fabricaciones) — también disponible sin pasos */}
                  {historicoQC.ultimosLotes.length > 0 && (() => {
                    const specs = historicoQC.productoSpecs;
                    const cls = (v: any, min: any, max: any) => {
                      if (v == null) return 'text-gray-300';
                      const n = parseFloat(String(v));
                      if (isNaN(n)) return 'text-gray-300';
                      if (min == null && max == null) return 'text-gray-600';
                      if (min != null && n < parseFloat(min)) return 'text-loga-red font-bold';
                      if (max != null && n > parseFloat(max)) return 'text-loga-red font-bold';
                      return 'text-emerald-700 font-bold';
                    };
                    const fmt = (v: any) => v == null ? '—' : parseFloat(String(v)).toString();
                    const rangoStr = (min: any, max: any, unit = '') => {
                      if (min == null && max == null) return '—';
                      const f = (v: any) => v != null ? parseFloat(v).toString() : '?';
                      return `${f(min)}–${f(max)}${unit}`;
                    };
                    return (
                      <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 mb-3">
                        <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">Últimas fabricaciones · QC</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left py-0.5 font-medium">Lote</th>
                              <th className="text-left py-0.5 font-medium">Fecha</th>
                              <th className="text-right py-0.5 font-medium">pH</th>
                              <th className="text-right py-0.5 font-medium">%Sól.</th>
                              <th className="text-right py-0.5 font-medium">Visc.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historicoQC.ultimosLotes.map((l, i) => (
                              <tr key={i} className="border-t border-violet-100">
                                <td className="py-1 font-mono text-gray-700">{l.lote_interno}</td>
                                <td className="py-1 text-gray-500">{new Date(l.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.ph,         specs?.ph_min,         specs?.ph_max))}>{fmt(l.ph)}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.solidos,    specs?.solidos_min,    specs?.solidos_max))}>{fmt(l.solidos)}</td>
                                <td className={clsx('py-1 text-right tabular-nums', cls(l.viscosidad, specs?.viscosidad_min, specs?.viscosidad_max))}>{fmt(l.viscosidad)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-violet-200 text-gray-500 text-[10px]">
                              <td className="py-0.5" colSpan={2}>Rango aceptable</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.ph_min, specs?.ph_max)}</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.solidos_min, specs?.solidos_max, ' %')}</td>
                              <td className="py-0.5 text-right tabular-nums">{rangoStr(specs?.viscosidad_min, specs?.viscosidad_max, ' cP')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* Acumulado en tanque (running total ingredientes confirmados) */}
                  {ingredientes.length > 0 && receta && (() => {
                    const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
                    let acumulado = 0;
                    let totalTeorico = 0;
                    for (const ing of ingredientes) {
                      const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                      const real = cantidadesAjustadas[ing.id] ?? teorico;
                      totalTeorico += teorico;
                      if (confirmados.has(ing.id)) acumulado += real;
                    }
                    const pct = totalTeorico > 0 ? (acumulado / totalTeorico) * 100 : 0;
                    return (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">Acumulado en tanque</span>
                          <span className="text-[11px] font-semibold text-blue-700">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold font-mono text-blue-900">{acumulado.toFixed(2)}</span>
                          <span className="text-sm text-blue-600">/ {totalTeorico.toFixed(2)} kg</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-blue-100 overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Ingredientes</p>
                    <p className="text-[11px] text-gray-400">{nConf}/{total} confirmados</p>
                  </div>
                  <div className="space-y-2">
                    {ingredientes.map((ing, i) => {
                      const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                      const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                      const ajustado = cantidadesAjustadas[ing.id];
                      const necesario = ajustado ?? teorico;
                      const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? "0");
                      const suficiente = stock >= necesario;
                      const conf = confirmados.has(ing.id);
                      const ingEsAgua = esAgua(ing.nombre_mp);
                      const echadoIng = dosificadoPorMP[ing.id] ?? 0;
                      // En agua mostramos el pendiente (necesario − echado). Los +/− e
                      // input editan el pendiente; el ajuste real = pendiente + echado.
                      const displayed = ingEsAgua ? Math.max(0, necesario - echadoIng) : necesario;
                      const setAjuste = (val: number | null) => {
                        setCantidadesAjustadas(prev => {
                          const next = { ...prev };
                          if (val == null || val === teorico) delete next[ing.id];
                          else next[ing.id] = val;
                          if (orden) localStorage.setItem(`fab_ajustes_${orden.id}`, JSON.stringify(next));
                          return next;
                        });
                      };
                      const setDisplayed = (v: number | null) => {
                        if (v == null) { setAjuste(null); return; }
                        setAjuste(ingEsAgua ? v + echadoIng : v);
                      };
                      const step = teorico >= 100 ? 1 : teorico >= 10 ? 0.5 : teorico >= 1 ? 0.1 : 0.01;
                      // OK en agua: si queda pendiente, lo echa automáticamente antes de marcar confirmado.
                      const handleOk = async () => {
                        if (ingEsAgua && displayed > 0.001 && orden) {
                          try {
                            await produccionApi.dosificar(orden.id, {
                              producto_id: ing.materia_prima_id,
                              cantidad: displayed,
                              ingrediente_receta_id: ing.id,
                            });
                            await recargarDosificaciones();
                          } catch (e: any) {
                            notify.error(e?.response?.data?.error ?? 'Error al echar lo restante');
                            return;
                          }
                        }
                        confirmarIngrediente(ing.id);
                      };
                      return (
                        <motion.div
                          key={ing.id || ing.materia_prima_id || `ing2-${i}`}
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
                              {(ing as any).paso_index != null && (
                                <span className="shrink-0 text-[9px] font-bold rounded px-1 py-0.5 bg-blue-50 text-blue-700 border border-blue-100">
                                  Paso {Number((ing as any).paso_index) + 1}
                                </span>
                              )}
                              {ing.sds_url && (
                                <a href={withAuthToken(ing.sds_url)}
                                  target="_blank" rel="noopener noreferrer"
                                  className="shrink-0 rounded p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50" title="Ficha SDS">
                                  <FileText size={12} />
                                </a>
                              )}
                            </div>
                            {conf ? (
                              <p className="text-sm font-bold font-mono text-emerald-700 line-through">
                                {necesario.toFixed(2)} <span className="text-xs font-semibold">{ing.unidad_medida}</span>
                              </p>
                            ) : (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <button
                                  onClick={() => setDisplayed(Math.max(0, displayed - step))}
                                  className="rounded-md w-6 h-6 flex items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 text-base leading-none"
                                  title={`-${step}`}
                                >−</button>
                                <input
                                  type="number"
                                  step={step}
                                  min={0}
                                  value={displayed.toFixed(2)}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    if (!isNaN(v) && v >= 0) setDisplayed(v);
                                  }}
                                  className="w-20 text-center font-mono font-bold text-sm bg-white border border-gray-200 rounded-md px-1.5 py-0.5 focus:border-loga-red focus:outline-none"
                                />
                                <button
                                  onClick={() => setDisplayed(displayed + step)}
                                  className="rounded-md w-6 h-6 flex items-center justify-center bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 text-base leading-none"
                                  title={`+${step}`}
                                >+</button>
                                <span className="text-xs font-semibold text-gray-500">{ing.unidad_medida}</span>
                                {ingEsAgua && echadoIng > 0 && (
                                  <span className="text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                    pendiente (ya {echadoIng.toFixed(2)} echados)
                                  </span>
                                )}
                                {ajustado != null && (
                                  <button
                                    onClick={() => setAjuste(null)}
                                    className="text-[10px] text-amber-600 hover:text-amber-800 underline ml-1"
                                    title={`Receta: ${teorico.toFixed(2)} ${ing.unidad_medida}`}
                                  >
                                    ajustado (vs {teorico.toFixed(2)}) — reset
                                  </button>
                                )}
                                {!suficiente && <span className="ml-1 text-xs text-loga-red font-semibold">⚠ Stock: {stock.toFixed(2)}</span>}
                              </div>
                            )}
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
                            {esAgua(ing.nombre_mp) && orden && !conf && (
                              <DosificarAguaInline
                                ordenId={orden.id}
                                ingredienteId={ing.id}
                                productoId={ing.materia_prima_id}
                                unidad={ing.unidad_medida ?? 'kg'}
                                necesario={necesario}
                                echado={dosificadoPorMP[ing.id] ?? 0}
                                onChange={() => {
                                  recargarDosificaciones();
                                  lotesApi.listar({ producto_id: ing.materia_prima_id, estado: 'aprobado' })
                                    .then(res => setLotesMP(prev => ({ ...prev, [ing.materia_prima_id]: (res.data as any[]).filter((l: any) => parseFloat(l.cantidad_actual) > 0) })))
                                    .catch(() => {});
                                }}
                              />
                            )}
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
                                  onClick={handleOk}
                                  className={clsx(
                                    'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                                    suficiente ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-loga-red/10 text-loga-red hover:bg-loga-red/20'
                                  )}
                                  title={ingEsAgua && displayed > 0.001 ? `Echar ${displayed.toFixed(2)} ${ing.unidad_medida} y confirmar` : 'Marcar como echado'}
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


              {/* Observaciones de la orden */}
              {(fase === 'preparando' || fase === 'confirmando') && (
                <div className="w-full rounded-lg border border-amber-100 bg-amber-50/40 px-2.5 py-2">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Observaciones</p>
                  {orden.notas ? (
                    <p className="text-[11px] text-gray-700 leading-tight whitespace-pre-wrap break-words">
                      {orden.notas}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">Sin observaciones</p>
                  )}
                  {orden.cliente && (
                    <p className="mt-1.5 pt-1.5 border-t border-amber-100 text-[10px] text-gray-500">
                      Cliente: <b className="text-gray-700">{orden.cliente}</b>
                    </p>
                  )}
                </div>
              )}

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
                    {/* Registro de Limpieza — formato APPCC / sanidad */}
                    {requiereLimpieza && (() => {
                      // Construye el string registroLimpieza desde los campos del form
                      const buildRegistroInterna = (over: Partial<{
                        tanque: string; producto: string; destino: string; obs: string;
                      }> = {}) => {
                        const tanque = over.tanque ?? limpiezaTanque;
                        const producto = over.producto ?? limpiezaProducto;
                        const destino = over.destino ?? limpiezaDestino;
                        const obs = over.obs ?? limpiezaObservaciones;
                        const partes: string[] = [];
                        if (tanque) partes.push(`Tanque: ${tanque}`);
                        if (producto) partes.push(`Producto: ${producto}`);
                        if (destino) partes.push(`Destino residuo: ${destino}`);
                        if (obs) partes.push(`Obs: ${obs}`);
                        return `Interna — ${partes.join(' · ')}`;
                      };
                      const buildRegistroExterna = (over: Partial<{ proveedorId: string; albaran: string; obs: string }> = {}) => {
                        const proveedorId = over.proveedorId ?? limpiezaProveedorId;
                        const albaran = over.albaran ?? limpiezaAlbaran;
                        const obs = over.obs ?? limpiezaObservaciones;
                        const prov = proveedores.find(p => p.id === proveedorId);
                        const partes: string[] = [];
                        if (prov) partes.push(`Proveedor: ${prov.nombre}`);
                        if (albaran) partes.push(`Albarán: ${albaran}`);
                        if (obs) partes.push(`Obs: ${obs}`);
                        return partes.length > 0 ? `Externa — ${partes.join(' · ')}` : 'Externa';
                      };

                      const fieldCls = 'w-full rounded-md border border-amber-200/70 bg-white px-2.5 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition-all placeholder:text-gray-400';
                      const labelCls = 'block text-[10px] font-bold text-amber-900/70 uppercase tracking-wider mb-1';

                      return (
                        <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50 to-amber-50/40 shadow-sm overflow-hidden">
                          {/* Header */}
                          <div className="flex items-center gap-2 px-3.5 py-2 bg-amber-100/60 border-b border-amber-200/70">
                            <Droplets size={14} className="text-amber-700" />
                            <span className="text-sm font-bold text-amber-900">Registro de Limpieza</span>
                            <span className="ml-auto text-[10px] text-loga-red font-bold bg-white/80 border border-red-200 rounded-md px-1.5 py-0.5">Obligatorio</span>
                          </div>

                          <div className="p-3 space-y-2.5">
                            {/* Tipo — segmented pill */}
                            <div className="flex rounded-lg border border-amber-200 bg-white p-0.5 gap-0.5">
                              <button type="button" onClick={() => { setLimpiezaTipo('interna'); setRegistroLimpieza(buildRegistroInterna()); }}
                                className={clsx('flex-1 rounded-md py-1.5 text-xs font-bold transition-all',
                                  limpiezaTipo === 'interna' ? 'bg-amber-500 text-white shadow-sm' : 'text-amber-700 hover:bg-amber-50')}>
                                Interna
                              </button>
                              <button type="button" onClick={() => { setLimpiezaTipo('externa'); setRegistroLimpieza(buildRegistroExterna()); }}
                                className={clsx('flex-1 rounded-md py-1.5 text-xs font-bold transition-all',
                                  limpiezaTipo === 'externa' ? 'bg-amber-500 text-white shadow-sm' : 'text-amber-700 hover:bg-amber-50')}>
                                Externa
                              </button>
                            </div>

                            {limpiezaTipo === 'interna' && (
                              <div className="space-y-2.5">
                                {/* Tanque + Producto */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className={labelCls}>Tanque / equipo</label>
                                    <input value={limpiezaTanque}
                                      onChange={e => { setLimpiezaTanque(e.target.value); setRegistroLimpieza(buildRegistroInterna({ tanque: e.target.value })); }}
                                      placeholder="Reactor 1, Tanque 2…"
                                      className={fieldCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Producto de limpieza</label>
                                    <input value={limpiezaProducto}
                                      onChange={e => { setLimpiezaProducto(e.target.value); setRegistroLimpieza(buildRegistroInterna({ producto: e.target.value })); }}
                                      placeholder="Sosa, agua caliente…"
                                      className={fieldCls} />
                                  </div>
                                </div>

                                {/* Destino residuo (opcional, solo si hay) */}
                                <div>
                                  <label className={labelCls}>Destino del residuo <span className="text-amber-600/60 normal-case font-normal">(opcional)</span></label>
                                  <input value={limpiezaDestino}
                                    onChange={e => { setLimpiezaDestino(e.target.value); setRegistroLimpieza(buildRegistroInterna({ destino: e.target.value })); }}
                                    placeholder="Depuradora, gestor autorizado…"
                                    className={fieldCls} />
                                </div>

                                {/* Observaciones */}
                                <div>
                                  <label className={labelCls}>Observaciones</label>
                                  <textarea rows={3} value={limpiezaObservaciones}
                                    onChange={e => { setLimpiezaObservaciones(e.target.value); setRegistroLimpieza(buildRegistroInterna({ obs: e.target.value })); }}
                                    placeholder="Anota cualquier incidencia o detalle adicional…"
                                    className={fieldCls + ' resize-none leading-snug'} />
                                </div>
                              </div>
                            )}

                            {limpiezaTipo === 'externa' && (
                              <div className="space-y-2.5">
                                <div>
                                  <label className={labelCls}>Proveedor</label>
                                  <SearchSelect
                                    options={proveedores.map(p => ({ id: p.id, label: p.nombre, sub: p.telefono || p.email || '' }))}
                                    value={limpiezaProveedorId}
                                    onChange={id => { setLimpiezaProveedorId(id); setRegistroLimpieza(buildRegistroExterna({ proveedorId: id })); }}
                                    placeholder="Buscar proveedor de limpieza..."
                                    selectedLabel={proveedores.find(p => p.id === limpiezaProveedorId)?.nombre}
                                    selectedSub={proveedores.find(p => p.id === limpiezaProveedorId)?.telefono ?? ''}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className={labelCls}>Tanque / equipo</label>
                                    <input value={limpiezaTanque}
                                      onChange={e => setLimpiezaTanque(e.target.value)}
                                      placeholder="Reactor 1, Tanque 2…"
                                      className={fieldCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Nº albarán <span className="text-amber-600/60 normal-case font-normal">(opcional)</span></label>
                                    <input value={limpiezaAlbaran}
                                      onChange={e => { setLimpiezaAlbaran(e.target.value); setRegistroLimpieza(buildRegistroExterna({ albaran: e.target.value })); }}
                                      placeholder="ALB-2026-042"
                                      className={fieldCls + ' font-mono'} />
                                  </div>
                                </div>
                                <div>
                                  <label className={labelCls}>Observaciones</label>
                                  <textarea rows={3} value={limpiezaObservaciones}
                                    onChange={e => { setLimpiezaObservaciones(e.target.value); setRegistroLimpieza(buildRegistroExterna({ obs: e.target.value })); }}
                                    placeholder="Anota cualquier incidencia o detalle adicional…"
                                    className={fieldCls + ' resize-none leading-snug'} />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Stock warning */}
                    {ingredientesSinStock.length > 0 && (
                      <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 space-y-1">
                        <p className="text-xs font-bold text-loga-red">Stock insuficiente:</p>
                        {ingredientesSinStock.map((ing, idx) => {
                          const nec = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                          const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? "0");
                          return (
                            <p key={ing.id || ing.materia_prima_id || `sk-${idx}`} className="text-xs text-red-700">
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

      {/* Checklist de confirmaciones MP antes de fabricar */}
      {checklistConfirm && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setChecklistConfirm(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100 shrink-0">
              <p className="text-sm font-bold text-amber-900">Confirmaciones antes de finalizar</p>
              <p className="text-[11px] text-gray-500">Marca cada punto para poder fabricar.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {checklistConfirm.map((c, i) => (
                <label key={c.mpId + i} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 cursor-pointer hover:bg-amber-50">
                  <input
                    type="checkbox"
                    checked={c.ok}
                    onChange={(e) => setChecklistConfirm(prev => prev?.map((x, j) => j === i ? { ...x, ok: e.target.checked } : x) ?? prev)}
                    className="mt-1 h-4 w-4 accent-loga-red cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">{c.nombre}</p>
                    <p className="text-sm text-gray-800 leading-tight whitespace-pre-wrap">{c.mensaje}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button onClick={() => setChecklistConfirm(null)} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>
              <button
                onClick={handleFabricar}
                disabled={checklistConfirm.some(x => !x.ok)}
                className="flex items-center gap-2 rounded-xl bg-loga-red px-5 py-2 text-sm font-bold text-white hover:bg-loga-red-dark disabled:bg-gray-300"
              >
                <Check size={15} /> Todo confirmado, fabricar
              </button>
            </div>
          </motion.div>
        </div>
      )}

    </AnimatePresence>
  );
}

// ── DosificarAguaInline ────────────────────────────────────────────────────
// Botón inline al lado de cada ingrediente que sea AGUA. Permite registrar
// echadas parciales sucesivas durante la fabricación (cada click POST a
// /produccion/:id/dosificar — descuenta stock al instante). Muestra acumulado
// y pendiente para que el operario sepa cuánto le queda por echar.
function DosificarAguaInline({
  ordenId, ingredienteId, productoId, unidad, necesario, echado, onChange,
}: {
  ordenId: string;
  ingredienteId?: string;
  productoId: string;
  unidad: string;
  necesario: number;
  echado: number;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cant, setCant] = useState('');
  const [posting, setPosting] = useState(false);

  const pendiente = Math.max(0, necesario - echado);

  const guardar = async () => {
    const c = parseFloat(cant);
    if (!Number.isFinite(c) || c <= 0) { notify.error('Cantidad inválida'); return; }
    setPosting(true);
    try {
      await produccionApi.dosificar(ordenId, {
        producto_id: productoId,
        cantidad: c,
        ingrediente_receta_id: ingredienteId,
      });
      notify.success(`+${c.toFixed(2)} ${unidad} echados`);
      setCant('');
      setOpen(false);
      onChange?.();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al echar');
    } finally {
      setPosting(false);
    }
  };

  const completo = pendiente <= 0.01;
  // Label dinámico: si hay restante conocido, sugerirlo en el botón
  const labelBoton = completo
    ? 'Completo'
    : echado > 0
      ? `Echar ${pendiente.toFixed(2)} ${unidad} restantes`
      : 'Echar parcial';

  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      {(echado > 0 || open) && (
        <span className="text-[10px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
          Echado: <b>{echado.toFixed(2)}</b> / {necesario.toFixed(2)} {unidad}
          {pendiente > 0.01 && <> · pte <b className="text-loga-red">{pendiente.toFixed(2)}</b></>}
        </span>
      )}
      {open ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.001"
            min="0"
            autoFocus
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') { setOpen(false); setCant(''); } }}
            placeholder={pendiente.toFixed(2)}
            className="w-24 rounded border border-amber-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <span className="text-[10px] text-gray-500">{unidad}</span>
          <button
            onClick={guardar}
            disabled={posting}
            className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {posting ? '…' : 'Echar'}
          </button>
          <button
            onClick={() => { setOpen(false); setCant(''); }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Cancelar"
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setOpen(true); setCant(pendiente > 0 ? pendiente.toFixed(2) : ''); }}
          disabled={completo}
          className={clsx(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold transition-colors',
            completo
              ? 'bg-emerald-100 text-emerald-700 cursor-default'
              : 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
          )}
        >
          <Droplets size={10} /> {labelBoton}
        </button>
      )}
    </div>
  );
}

const esAgua = (nombre?: string | null) => /\bagua\b/i.test(nombre ?? '');

// ── EcharAguaInicial ───────────────────────────────────────────────────────
// Botón "Echar agua inicial" colapsado por defecto. Permite al operario echar
// una parte del agua ANTES de empezar los pasos (uso opcional, no habitual).
// Registra la echada con paso_index=-1.
function EcharAguaInicial({
  ordenId, ingredienteId, productoId, unidad, totalNecesario, echadoTotal, echadoInicial, onChange,
}: {
  ordenId: string;
  ingredienteId: string;
  productoId: string;
  unidad: string;
  totalNecesario: number;
  echadoTotal: number;
  echadoInicial: number;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cant, setCant] = useState<string>('');
  const [posting, setPosting] = useState(false);

  const guardar = async () => {
    const c = parseFloat(cant);
    if (!Number.isFinite(c) || c <= 0) { notify.error('Cantidad inválida'); return; }
    setPosting(true);
    try {
      await produccionApi.dosificar(ordenId, {
        producto_id: productoId,
        cantidad: c,
        ingrediente_receta_id: ingredienteId,
        paso_index: -1,
        notas: 'Echada inicial',
      });
      notify.success(`+${c.toFixed(2)} ${unidad} echados (inicial)`);
      setCant('');
      setOpen(false);
      onChange?.();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al echar');
    } finally {
      setPosting(false);
    }
  };

  if (!open) {
    // Si ya hubo una echada inicial, mostrar chip discreto con el total + lupa
    // para añadir más. Si nunca se ha echado, solo un mini-botón gris.
    if (echadoInicial > 0) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            <Droplets size={10} /> Agua inicial: {echadoInicial.toFixed(2)} {unidad}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[10px] text-gray-400 hover:text-cyan-700 underline"
          >
            + añadir más
          </button>
        </div>
      );
    }
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 transition-colors"
        >
          <Droplets size={10} /> Echar agua inicial
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-cyan-900">Echar agua ANTES de los pasos</p>
        <span className="text-[10px] text-cyan-700">
          Total receta {totalNecesario.toFixed(2)} {unidad} · ya {echadoTotal.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          step="0.01"
          min="0.001"
          autoFocus
          value={cant}
          onChange={(e) => setCant(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setOpen(false); }}
          placeholder={`Ej: 10 ${unidad}`}
          className="w-28 rounded-md border border-cyan-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <span className="text-xs text-gray-600">{unidad}</span>
        <button
          type="button"
          onClick={guardar}
          disabled={posting}
          className="rounded-md bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {posting ? '…' : 'Confirmar echada inicial'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setCant(''); }}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="Cancelar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ── DosificarAguaPaso ──────────────────────────────────────────────────────
// Botón destacado dentro del bloque de un paso que tiene definida una
// `cantidad_agua` en la receta. El operario lo pulsa cuando llega a ese paso
// para registrar la echada de esa cantidad (con opción de ajustarla antes).
function DosificarAguaPaso({
  ordenId, ingredienteId, productoId, cantidadSugerida, cantidadPlanPaso, sobranteAnterior, unidad,
  echadoTotal, echadoEstePaso, totalNecesario, pteTotal, pasoNum, pasoIndex, onChange,
}: {
  ordenId: string;
  ingredienteId: string;
  productoId: string;
  cantidadSugerida: number;
  cantidadPlanPaso: number;
  sobranteAnterior: number;
  unidad: string;
  echadoTotal: number;
  echadoEstePaso: number;
  totalNecesario: number;
  pteTotal: number;
  pasoNum: number;
  pasoIndex: number;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cant, setCant] = useState<string>(cantidadSugerida.toFixed(2));
  const [posting, setPosting] = useState(false);

  useEffect(() => { setCant(cantidadSugerida.toFixed(2)); }, [cantidadSugerida]);

  const guardar = async () => {
    const c = parseFloat(cant);
    if (!Number.isFinite(c) || c <= 0) { notify.error('Cantidad inválida'); return; }
    setPosting(true);
    try {
      await produccionApi.dosificar(ordenId, {
        producto_id: productoId,
        cantidad: c,
        ingrediente_receta_id: ingredienteId,
        paso_index: pasoIndex,
        notas: `Paso ${pasoNum}`,
      });
      notify.success(`+${c.toFixed(2)} ${unidad} echados (paso ${pasoNum})`);
      setOpen(false);
      onChange?.();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al echar');
    } finally {
      setPosting(false);
    }
  };

  const completo = pteTotal <= 0.01;
  const overPour = echadoTotal > totalNecesario + 0.01;
  return (
    <div className={clsx(
      'rounded-xl border-2 px-4 py-3',
      overPour
        ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50/40'
        : completo
          ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-blue-50/40'
          : 'border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50/40'
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white',
            overPour ? 'bg-amber-500' : completo ? 'bg-emerald-500' : 'bg-blue-500'
          )}>
            {completo ? <Check size={14} /> : <Droplets size={14} />}
          </div>
          <div className="min-w-0">
            <p className={clsx('text-xs font-bold', overPour ? 'text-amber-900' : completo ? 'text-emerald-900' : 'text-blue-900')}>
              Agua de este paso
              {echadoEstePaso > 0 && <span className="ml-1 text-emerald-600">· {echadoEstePaso.toFixed(2)} {unidad} ya echados</span>}
              {completo && !overPour && <span className="ml-1 text-emerald-700">· total alcanzado</span>}
              {overPour && <span className="ml-1 text-amber-700">· +{(echadoTotal - totalNecesario).toFixed(2)} extra</span>}
            </p>
            <p className={clsx('text-[10px]', overPour ? 'text-amber-700' : 'text-blue-700')}>
              Plan paso: <b>{cantidadPlanPaso.toFixed(2)}</b>
              {sobranteAnterior > 0.01 && (
                <> · sobrante anterior <b className="text-amber-700">+{sobranteAnterior.toFixed(2)}</b></>
              )}
              <span className="mx-1.5 text-blue-300">|</span>
              Total receta <b>{totalNecesario.toFixed(2)}</b> · ya <b>{echadoTotal.toFixed(2)}</b>
            </p>
          </div>
        </div>
        {!open && (
          <button
            onClick={() => { setCant(cantidadSugerida.toFixed(2)); setOpen(true); }}
            className={clsx(
              'shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors shadow-sm',
              overPour ? 'bg-amber-500 hover:bg-amber-600' : completo ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {completo ? `Echar más (${cantidadSugerida.toFixed(2)} ${unidad})` : `Echar ${cantidadSugerida.toFixed(2)} ${unidad}`}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="number"
            step="0.01"
            min="0.001"
            autoFocus
            value={cant}
            onChange={(e) => setCant(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setOpen(false); }}
            className="w-28 rounded-md border border-blue-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-xs text-gray-600">{unidad}</span>
          <button
            onClick={guardar}
            disabled={posting}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {posting ? '…' : 'Confirmar echada'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Cancelar"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
