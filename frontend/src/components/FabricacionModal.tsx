/**
 * FabricacionModal — Vista por pasos con tanque minimalista rojo
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertCircle, Factory, ChevronRight, ChevronLeft, FlaskConical, Camera, ScanLine, Thermometer, Clock, Droplets, FileText, Download, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { recetasApi, produccionApi, lotesApi, proveedoresApi, productosApi, controlesCalidadApi } from '../api/client';
import type { OrdenProduccion, IngredienteReceta, Receta, PasoReceta } from '../types';
import clsx from 'clsx';
import axios from 'axios';
import BarcodeScanner from './BarcodeScanner';
import TanqueRojo from './TanqueRojo';
import TanqueBadge from './TanqueBadge';

// Motivos del registro de limpieza (formato APPCC simplificado).
const MOTIVOS_LIMPIEZA = [
  { value: 'evitar_secado', label: 'Evitar secado' },
  { value: 'alimentario',   label: 'Alimentario'   },
  { value: 'otra_resina',   label: 'Otra resina'   },
  { value: 'color',         label: 'Color'         },
  { value: 'externo',       label: 'Externo'       },
] as const;
import { useAuth } from '../contexts/AuthContext';
import TanqueEnvasado from './TanqueEnvasado';
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
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [fase, setFase] = useState<Fase>('cargando');
  const [receta, setReceta] = useState<Receta | null>(null);
  // Confirmados es un Set de claves compuestas `${pasoIdx}|${ingId}`. Cada paso
  // tiene su propio checklist independiente — marcar AGUA en paso 1 NO marca
  // AGUA en paso 2 aunque sea el mismo ingrediente. Ingredientes huérfanos
  // (sin paso asignado) usan pasoIdx = -1.
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  // Helper para construir la clave compuesta de manera uniforme.
  const cKey = (paso: number, ingId: string) => `${paso}|${ingId}`;
  // Helper para saber si un ingrediente está marcado en CUALQUIER paso. Usado
  // por el "Acumulado en tanque" (cumulativo real) y el cálculo de fillPct.
  const isMarkedAnywhere = (set: Set<string>, ingId: string) => {
    const suffix = `|${ingId}`;
    for (const k of set) if (k.endsWith(suffix)) return true;
    return false;
  };
  // Ingrediente pendiente de confirmación final (modal "¿Confirmas que has echado X?")
  // pendienteConfirm guarda { id: ingredienteId, paso: pasoIdx } para saber a
  // qué paso pertenece la marca. Mismo ingrediente puede estar pendiente en
  // diferentes pasos sin conflicto.
  const [pendienteConfirm, setPendienteConfirm] = useState<{ id: string; paso: number } | null>(null);
  // Bloquea el botón "Confirmar" del modal durante 800ms al abrirse. Evita que
  // un usuario apurado pase 3 ingredientes en 3 segundos por triple-tap. Obliga
  // a leer el nombre y la cantidad antes de poder confirmar.
  const [confirmReady, setConfirmReady] = useState<boolean>(false);
  useEffect(() => {
    if (!pendienteConfirm) {
      setConfirmReady(false);
      confirmingRef.current = false; // liberar guard al cerrar popup
      return;
    }
    setConfirmReady(false);
    confirmingRef.current = false; // liberar guard al abrir nuevo popup
    const t = setTimeout(() => setConfirmReady(true), 800);
    return () => clearTimeout(t);
  }, [pendienteConfirm]);
  // Cooldown global: tras CADA confirmación (o cierre de popup), bloqueamos
  // 1200 ms los botones OK de filas para impedir cadenas accidentales (tap
  // rápido tras cerrar popup que llega a la fila de debajo).
  const [okCooldownUntil, setOkCooldownUntil] = useState<number>(0);
  const okBlocked = () => Date.now() < okCooldownUntil;
  // Guard de doble-fire del botón Confirmar del popup. Algunos dispositivos
  // disparan touchend + click → React onClick se ejecuta 2 veces en ~150 ms.
  // Como confirmarIngrediente NO es idempotente a nivel de paso (cuenta como
  // 2 confirmaciones distintas si se llama 2 veces y aun no terminó la 1ª
  // de cerrar el popup), bloqueamos con un ref.
  const confirmingRef = useRef<boolean>(false);
  // Override manual de lotes por ingrediente: { ingrediente_id: [{lote_id, cantidad}] }
  // Si no hay entrada para un ingrediente, se usa FEFO automático al confirmar.
  const [lotesOverride, setLotesOverride] = useState<Record<string, Array<{ lote_id: string; cantidad: number }>>>({});
  // Ingrediente al que estamos editando lotes manualmente
  const [editandoLotesIng, setEditandoLotesIng] = useState<string | null>(null);
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
  const [lotesMP, setLotesMP] = useState<Record<string, { lote_interno: string; cantidad_actual: string; fecha_caducidad?: string; tanque?: number | null }[]>>({});
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
  // Registro de limpieza nuevo (estilo APPCC) — formulario estructurado.
  type SiNo = 'si' | 'no' | '';
  type MotivoLimpieza = 'evitar_secado' | 'alimentario' | 'otra_resina' | 'color' | 'externo' | 'no_precisa' | '';
  const [limpiezaSiNo,        setLimpiezaSiNo]        = useState<SiNo>('');
  const [limpiezaMotivo,      setLimpiezaMotivo]      = useState<MotivoLimpieza>('');
  const [limpiezaMaquina]     = useState('Agitador 1');
  // Sistema=Agua, herramienta=Pistola, presión=Sí son siempre fijos por defecto
  // (el operario solo decide alta presión Sí/No). No se muestran en la UI.
  const [limpiezaSistemaProd] = useState('Agua');
  const [limpiezaPresion]     = useState<SiNo>('si');
  const [limpiezaHerramienta] = useState('Pistola');
  const [limpiezaAltaPres,    setLimpiezaAltaPres]    = useState<SiNo>('');
  const [limpiezaObservaciones, setLimpiezaObservaciones] = useState('');
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string; telefono?: string; email?: string }[]>([]);
  const inicioFabRef = useRef<string | null>(null);

  const ingredientes: IngredienteReceta[] = receta?.ingredientes ?? [];
  const pasos: PasoReceta[] = receta?.pasos ?? [];
  // total = nº de SLOTS (paso × ingrediente) que hay que confirmar. Si AGUA
  // está en paso 1 (30 kg) Y paso 2 (30 kg), son 2 slots, ambos deben marcarse.
  // Huérfanos (ingrediente no asignado a ningún paso) cuentan como 1 slot (-1).
  const total = (() => {
    if (pasos.length === 0) return ingredientes.length;
    let slots = 0;
    const usedAnywhere = new Set<string>();
    for (const p of pasos) {
      const ids = p.ingredientes_ids ?? [];
      for (const mpId of ids) {
        slots++;
        usedAnywhere.add(mpId);
      }
      // Agua inyectada por cantidad_agua > 0 (si el ingrediente agua no está ya en ids).
      if (Number(p.cantidad_agua) > 0) {
        const aguaIng = ingredientes.find(i => esAgua(i.nombre_mp));
        if (aguaIng && !ids.includes(aguaIng.materia_prima_id)) {
          slots++;
          usedAnywhere.add(aguaIng.materia_prima_id);
        }
      }
    }
    // Huérfanos: ingredientes no asignados a ningún paso (cuentan como 1).
    for (const ing of ingredientes) {
      if (!usedAnywhere.has(ing.materia_prima_id)) slots++;
    }
    return slots;
  })();
  // nConf = nº de slots (paso × ingrediente) ya confirmados = confirmados.size,
  // porque cada clave del Set es única por (paso, ingrediente).
  const nConf = confirmados.size;
  const hasPasos = pasos.length > 0;

  // Cuando todos los ingredientes únicos están marcados, transicionamos a
  // 'confirmando' para que aparezca el panel de QC (pH, sólidos, viscosidad)
  // + fotos + limpieza + botón Fabricar lateral. Si el usuario deshace algo,
  // vuelve a 'preparando'. Esto reemplaza la lógica antigua que estaba dentro
  // de confirmarIngrediente.
  useEffect(() => {
    if (fase !== 'preparando' && fase !== 'confirmando') return;
    if (total > 0 && nConf >= total && fase !== 'confirmando') setFase('confirmando');
    else if (nConf < total && fase === 'confirmando') setFase('preparando');
  }, [nConf, total, fase]);

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
      // Cargamos receta + detalle FRESCO de la orden en paralelo. El detalle
      // trae lotes_revisados_at + lotes_override actualizados (la prop puede
      // estar caducada si el usuario firmó la revisión y reabre el modal sin
      // que el listado padre se haya recargado).
      const [recRes, detRes] = await Promise.all([
        recetasApi.obtener(orden.receta_id),
        produccionApi.detalle(orden.id).catch(() => null),
      ]);
      const recetaData = recRes.data as Receta;
      setReceta(recetaData);
      // detalle endpoint devuelve { orden, consumos, coste_total } — la orden
      // fresca (con lotes_revisados_at y lotes_override actualizados) está dentro
      // de .orden, NO en la raíz. Bug previo: leíamos .data directamente y
      // lotes_revisados_at salía undefined → revisión pre-fab se mostraba siempre.
      const detData = detRes?.data as { orden?: Record<string, unknown> } | undefined;
      const ordenFresca: Record<string, unknown> = detData?.orden ?? (orden as unknown as Record<string, unknown>);

      // Confirmaciones = SOURCE-OF-TRUTH EN BD (tabla confirmaciones_ingrediente).
      // localStorage YA NO se usa para confirmaciones (causaba estados fantasma).
      // Borramos cualquier residuo de versiones anteriores.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('fab_confirmados_')) localStorage.removeItem(k);
        }
      } catch { /* */ }
      // Cargar las confirmaciones ya existentes de esta OF desde la BD.
      // Ahora cada fila trae paso_index → la clave en el Set es `${paso}|${id}`.
      const ingTotal = recetaData.ingredientes?.length ?? 0;
      let confInicial: Set<string> = new Set();
      try {
        const { data: confs } = await produccionApi.listarConfirmaciones(orden.id);
        const items = confs as Array<{ ingrediente_receta_id: string; paso_index?: number }>;
        confInicial = new Set(items.map(c => cKey(c.paso_index ?? -1, c.ingrediente_receta_id)));
      } catch { /* */ }
      setConfirmados(confInicial);
      setFase(confInicial.size >= ingTotal && ingTotal > 0 ? 'confirmando' : 'preparando');

      // Restaurar ajustes manuales de cantidad si los hubo (no son confirmaciones)
      try {
        const ajRaw = localStorage.getItem(`fab_ajustes_${orden.id}`);
        setCantidadesAjustadas(ajRaw ? JSON.parse(ajRaw) : {});
      } catch { setCantidadesAjustadas({}); }
      // Revisión pre-fabricación: persistida en la orden (lotes_revisados_at).
      // Si el admin ya firmó, cualquier operario que abra después entra directo
      // a producción con el mismo override de lotes. Si no está firmada, se
      // muestra el modal de revisión al abrir.
      const yaFirmada = !!ordenFresca.lotes_revisados_at;
      setRevisionPreOk(yaFirmada);
      setRevisionPre(!yaFirmada);
      // Reconstituir override persistido en la orden
      const overrideOrden = ordenFresca.lotes_override as
        Array<{ materia_prima_id: string; lotes: { lote_id: string; cantidad: number }[] }> | null;
      if (Array.isArray(overrideOrden)) {
        const map: Record<string, Array<{ lote_id: string; cantidad: number }>> = {};
        for (const o of overrideOrden) {
          // El override se guarda por materia_prima_id. Mapear al ingrediente_id correspondiente.
          const ing = recetaData.ingredientes?.find(i => i.materia_prima_id === o.materia_prima_id);
          if (ing) map[ing.id] = o.lotes;
        }
        setLotesOverride(map);
      }

      // Restaurar paso actual desde localStorage si lo había (request user:
      // "cuando vaya por el paso 2 se quede ahí"). Validamos que el índice
      // exista en los pasos de la receta para evitar quedar fuera de rango.
      try {
        const savedPaso = localStorage.getItem(`fab_paso_${orden.id}`);
        const idx = savedPaso ? parseInt(savedPaso, 10) : 0;
        const maxIdx = (recetaData.pasos?.length ?? 1) - 1;
        setPasoActual(Math.max(0, Math.min(idx, maxIdx)));
      } catch { setPasoActual(0); }

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

  // Recalcular fillPct — cuenta ingredientes marcados en CUALQUIER paso (sin
  // duplicar si está en varios). El tanque es acumulativo real.
  useEffect(() => {
    if (fase !== 'preparando' && fase !== 'confirmando') return;
    if (!orden || !receta || ingredientes.length === 0) return;
    let progress = 0;
    for (const ing of ingredientes) {
      if (isMarkedAnywhere(confirmados, ing.id)) progress += 1;
    }
    const newPct = (progress / ingredientes.length) * 90;
    setFillPct(newPct);
  }, [confirmados, ingredientes, receta, orden, fase]);

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

  const confirmarIngrediente = (id: string, pIdx: number) => {
    if (!id || !orden) return;
    const key = cKey(pIdx, id);
    // Persistir en BD (idempotente). Optimistic UI: añadimos clave compuesta.
    setConfirmados((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    produccionApi.confirmarIngrediente(orden.id, id, pIdx).catch(err => {
      console.error('[fab] confirmarIngrediente API falló', err);
      setConfirmados(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      notify.error('No se pudo guardar la confirmación');
    });
  };

  const deshacerIngrediente = (id: string, pIdx: number) => {
    if (!orden) return;
    const key = cKey(pIdx, id);
    setConfirmados((prev) => {
      const next = new Set(prev);
      next.delete(key);
      if (fase === 'confirmando') setFase('preparando');
      return next;
    });
    produccionApi.deshacerIngrediente(orden.id, id, pIdx).catch(err => {
      console.error('[fab] deshacerIngrediente API falló', err);
      // Re-añadir si falla (mantener consistencia con BD)
      setConfirmados(prev => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      notify.error('No se pudo guardar el deshacer');
    });
  };

  // Fill by step — moved below allStepConfirmed declaration

  // SOLO avanza al siguiente paso sin tocar el estado de confirmaciones.
  // Petición explícita del usuario: ningún ingrediente debe quedar marcado como
  // confirmado automáticamente al cambiar de paso — el operario debe pulsar OK
  // (o escanear) en cada uno individualmente. Esto garantiza trazabilidad real
  // y obliga a una verificación consciente.
  const confirmarPaso = () => {
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
  // Revisión pre-fabricación: admin verifica todos los lotes asignados antes de
  // descontar stock. Se abre la primera vez que se pulsa "Fabricar".
  const [revisionPre, setRevisionPre] = useState<boolean>(false);
  const [revisionPreOk, setRevisionPreOk] = useState<boolean>(false);

  const handleFabricar = async () => {
    if (!orden) return;
    // Revisión pre-fabricación obligatoria (admin verifica lotes)
    if (!revisionPreOk) {
      setRevisionPre(true);
      return;
    }
    // Registro de limpieza obligatorio (si la receta lo requiere). El form
    // vive inline en el sidebar; aquí solo abortamos si no se ha rellenado.
    if (requiereLimpieza && !limpiezaSiNo) {
      notify.warning('Falta el registro de limpieza', { description: 'Marca Sí/No en el sidebar antes de fabricar.' });
      return;
    }
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
      // Construir lotes_override desde el estado por ingrediente:
      //   { ingrediente_id: [{lote_id, cantidad}] } → { materia_prima_id: [{lote_id, cantidad}] }
      const lotesOverridePayload = Object.entries(lotesOverride)
        .map(([ingId, lotes]) => {
          const ing = ingredientes.find(i => i.id === ingId);
          if (!ing || lotes.length === 0) return null;
          return { materia_prima_id: ing.materia_prima_id, lotes };
        })
        .filter((x): x is { materia_prima_id: string; lotes: Array<{ lote_id: string; cantidad: number }> } => x !== null);

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
        lotes_override: lotesOverridePayload.length > 0 ? lotesOverridePayload : undefined,
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
      if (requiereLimpieza && limpiezaSiNo) {
        try {
          const motivoLabel = MOTIVOS_LIMPIEZA.find(m => m.value === limpiezaMotivo)?.label ?? '—';
          const partesAccion: string[] = [];
          partesAccion.push(`Limpieza: ${limpiezaSiNo === 'si' ? 'Sí' : 'No'}`);
          if (limpiezaMotivo) partesAccion.push(`Motivo: ${motivoLabel}`);
          if (limpiezaSiNo === 'si') {
            partesAccion.push(`Sistema: ${limpiezaSistemaProd || 'Agua'}${limpiezaPresion ? ` (presión: ${limpiezaPresion === 'si' ? 'Sí' : 'No'})` : ''}`);
            partesAccion.push(`Tipo: ${limpiezaHerramienta || 'Pistola'}${limpiezaAltaPres ? ` (alta presión: ${limpiezaAltaPres === 'si' ? 'Sí' : 'No'})` : ''}`);
          }
          const accionTxt = partesAccion.join(' · ');
          const deposito = limpiezaMaquina || 'Agitador 1';
          await controlesCalidadApi.crear({
            tipo: 'limpieza',
            fecha: (fechaFab || new Date().toISOString()).slice(0, 10),
            resultado: 'correcto', // APTO siempre por defecto
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

  // El agua se muestra como un ingrediente normal en la lista del paso.
  // Si el paso tiene cantidad_agua > 0 y el agua no está ya en ingredientes_ids,
  // la inyectamos para que aparezca como una fila más. La echada inicial
  // (paso_index=-1) cuenta en el total echado → pendiente baja automáticamente.
  const stepIngIds = paso?.ingredientes_ids ?? [];
  const stepIngsBase = (stepIngIds.map(mpId => ingredientes.find(i => i.materia_prima_id === mpId)).filter(Boolean) as IngredienteReceta[]);
  const pasoTieneAgua = paso != null && Number(paso.cantidad_agua) > 0;
  const aguaIngParaPaso = pasoTieneAgua ? ingredientes.find(i => esAgua(i.nombre_mp)) : null;
  const stepIngs = aguaIngParaPaso && !stepIngsBase.some(i => i.id === aguaIngParaPaso.id)
    ? [...stepIngsBase, aguaIngParaPaso]
    : stepIngsBase;
  const allStepConfirmed = stepIngs.length === 0 || stepIngs.every(i => confirmados.has(cKey(pasoActual, i.id)));
  // Confirmados DE ESTE PASO (X/Y), para mostrar progreso por paso en lugar
  // del global. Pedido del usuario: "1/3 en paso de 3 ings, 1/9 en paso de 9".
  const nConfStep = stepIngs.filter(i => confirmados.has(cKey(pasoActual, i.id))).length;
  const totalStep = stepIngs.length;

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
  // El agua queda fuera de huérfanos si algún paso la usa (cantidad_agua>0),
  // porque ya se renderiza como ingrediente del paso correspondiente.
  const allStepMpIds = new Set(pasos.flatMap(p => p.ingredientes_ids ?? []));
  const aguaUsadaEnPasos = pasos.some(p => Number(p.cantidad_agua) > 0);
  const unassignedIngs = ingredientes
    .filter(i => !allStepMpIds.has(i.materia_prima_id))
    .filter(i => !(aguaUsadaEnPasos && esAgua(i.nombre_mp)));

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
          className="relative z-10 w-full max-w-6xl rounded-2xl bg-white shadow-2xl overflow-hidden"
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
                        <span className="font-mono font-bold text-gray-600 shrink-0">{tt.toFixed(4)} {ing.unidad_medida}</span>
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

                  {/* Echar agua INICIAL (opcional, antes de los pasos). El operario
                      puede pre-cargar agua al reactor antes de empezar. Lo echado se
                      descuenta de la sugerencia del primer paso de agua. */}
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
                        loteOverride={lotesOverride[aguaIng.id]?.[0]?.lote_id}
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
                            if (isMarkedAnywhere(confirmados, ing.id)) acumulado += real;
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

                        {/* Ingredients for this step */}
                        {stepIngs.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Ingredientes de este paso</p>
                              <p className={clsx(
                                "text-[11px] font-bold tabular-nums",
                                nConfStep === totalStep ? "text-emerald-600" : "text-loga-red"
                              )}>{nConfStep}/{totalStep}</p>
                            </div>
                            {stepIngs.map((ing, i) => {
                              const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                              // Agua que aparece en un paso con cantidad_agua > 0:
                              // usar la PORCIÓN de agua de este paso, no la cantidad total
                              // del ingrediente. Permite repartir agua entre pasos.
                              const ingEsAguaPaso = esAgua(ing.nombre_mp) && paso != null && Number(paso.cantidad_agua) > 0;
                              const cantidadBase = ingEsAguaPaso ? Number(paso!.cantidad_agua) : parseFloat(ing.cantidad);
                              const teorico = cantidadBase * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                              const ajustado = cantidadesAjustadas[ing.id];
                              const necesario = ajustado ?? teorico;
                              const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? "0");
                              const suficiente = stock >= necesario;
                              // conf solo true si está marcado EN ESTE PASO, no en otros.
                              const conf = confirmados.has(cKey(pasoActual, ing.id));
                              const ingEsAgua = esAgua(ing.nombre_mp);
                              // echadoIng = lo que ya está echado para este paso.
                              // Para agua-por-paso: suma echado-en-este-paso + crédito de
                              // "agua inicial" (paso=-1) aún no consumido por pasos previos.
                              // Así si echaste 5 kg inicial y este paso necesita 10.76, te
                              // mostramos pendiente = 10.76 - 5 = 5.76 sin que tengas que
                              // re-echarlo.
                              let echadoIng = 0;
                              if (ingEsAguaPaso) {
                                const echadoPaso = (echadoPorPaso[ing.id] ?? {})[pasoActual] ?? 0;
                                const echadoInicial = (echadoPorPaso[ing.id] ?? {})[-1] ?? 0;
                                let necesarioPrevios = 0;
                                for (let pi = 0; pi < pasoActual; pi++) {
                                  const ca = Number(pasos[pi]?.cantidad_agua) || 0;
                                  if (ca > 0) {
                                    necesarioPrevios += ca * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                                  }
                                }
                                const creditDisponible = Math.max(0, echadoInicial - necesarioPrevios);
                                const creditAplicado = Math.min(creditDisponible, teorico);
                                echadoIng = echadoPaso + creditAplicado;
                              } else {
                                echadoIng = dosificadoPorMP[ing.id] ?? 0;
                              }
                              // Para AGUA: displayed = PENDIENTE (necesario - echado), para
                              // que el operario vea directamente lo que le queda por echar.
                              // Para otros ingredientes: displayed = necesario (cantidad total).
                              const displayed = ingEsAgua ? Math.max(0, necesario - echadoIng) : necesario;

                              const setAjuste = (val: number | null) => {
                                setCantidadesAjustadas(prev => {
                                  const next = { ...prev };
                                  if (val == null || Math.abs(val - teorico) < 0.005) delete next[ing.id];
                                  else next[ing.id] = val;
                                  if (orden) localStorage.setItem(`fab_ajustes_${orden.id}`, JSON.stringify(next));
                                  return next;
                                });
                              };
                              const setDisplayed = (v: number | null) => {
                                if (v == null) { setAjuste(null); return; }
                                // Para agua: el operario edita el PENDIENTE → ajuste real = v + echado.
                                setAjuste(ingEsAgua ? v + echadoIng : v);
                              };
                              const step = teorico >= 100 ? 1 : teorico >= 10 ? 0.5 : teorico >= 1 ? 0.1 : 0.01;
                              // OK abre confirmación obligatoria (req. usuario explícito).
                              // Marca con paso actual — paso 1 y paso 2 son independientes.
                              const handleOk = () => {
                                if (okBlocked()) return; // anti tap-cadena tras popup previo
                                setPendienteConfirm({ id: ing.id, paso: pasoActual });
                              };

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
                                          className="w-20 text-center font-mono font-bold text-base bg-white border border-gray-200 rounded-md px-1.5 py-0.5 focus:border-loga-red focus:outline-none"
                                        />
                                        <button
                                          onClick={() => setDisplayed(displayed + step)}
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
                                      const lotes = [...lotesMP[ing.materia_prima_id]];
                                      const ov = lotesOverride[ing.id];
                                      // Para agua: el chip muestra el pendiente, no el total planificado.
                                      const baseCantidad = ingEsAgua ? displayed : necesario;
                                      const usar: { lote: any; tomar: number }[] = [];
                                      if (ov && ov.length > 0) {
                                        let restante = baseCantidad;
                                        for (const o of ov) {
                                          if (restante <= 0) break;
                                          const l = lotes.find((x: any) => x.id === o.lote_id);
                                          if (!l) continue;
                                          const tomar = ingEsAgua ? Math.min(o.cantidad, restante) : o.cantidad;
                                          usar.push({ lote: l, tomar });
                                          restante -= tomar;
                                        }
                                      } else {
                                        const lotesOrd = lotes.sort((a, b) => {
                                          if (a.fecha_caducidad && b.fecha_caducidad) return a.fecha_caducidad.localeCompare(b.fecha_caducidad);
                                          return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
                                        });
                                        let falta = baseCantidad;
                                        for (const l of lotesOrd) {
                                          if (falta <= 0) break;
                                          const disponible = parseFloat(l.cantidad_actual);
                                          const tomar = Math.min(disponible, falta);
                                          usar.push({ lote: l, tomar });
                                          falta -= tomar;
                                        }
                                      }
                                      if (usar.length === 0) return null;
                                      return (
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                          {usar.map(({ lote: l, tomar }, li) => (
                                            <button key={li} type="button"
                                              onClick={(e) => { e.stopPropagation(); setEditandoLotesIng(ing.id); }}
                                              title={l.tanque ? `Tanque ${l.tanque} · Click para cambiar de lote` : 'Click para cambiar de lote'}
                                              className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-md px-2 py-1 font-bold font-mono hover:bg-blue-100 hover:border-blue-400 transition-colors cursor-pointer inline-flex items-center gap-1.5">
                                              <TanqueBadge tanque={l.tanque} size="sm" />
                                              {l.lote_interno}: <span className="text-blue-900">{tomar.toFixed(2)} {ing.unidad_medida}</span>
                                            </button>
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
                                        onClick={handleOk}
                                        className="flex items-center gap-1 rounded-lg bg-loga-red px-2 py-1 text-[10px] font-bold text-white hover:bg-red-700 transition-colors"
                                      >
                                        OK <ChevronRight size={9} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button onClick={() => deshacerIngrediente(ing.id, pasoActual)} className="text-[10px] text-gray-400 hover:text-gray-600 underline">deshacer</button>
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
                              title={stepIngs.length > 0 && !allStepConfirmed
                                ? 'Aún hay ingredientes sin marcar OK en este paso. Pulsar siguiente NO los confirma — pulsa OK en cada uno antes.'
                                : 'Pasar al siguiente paso'}
                              className={clsx(
                                'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors',
                                stepIngs.length > 0 && !allStepConfirmed
                                  ? 'bg-gray-400 hover:bg-gray-500'
                                  : 'bg-loga-red hover:bg-red-700'
                              )}
                            >
                              {stepIngs.length > 0 && !allStepConfirmed ? 'Siguiente paso (sin confirmar)' : 'Siguiente paso'} <ChevronRight size={14} />
                            </button>
                          ) : (
                            <button
                              onClick={handleFabricar}
                              disabled={!todoConStock || (requiereLimpieza && !limpiezaSiNo) || nConf < total}
                              title={
                                !todoConStock ? 'Falta stock de algún ingrediente — revisa el listado rojo.' :
                                requiereLimpieza && !limpiezaSiNo ? 'Indica Sí/No en la sección Limpieza.' :
                                nConf < total ? `Faltan ${total - nConf} ingrediente(s) por confirmar (OK).` :
                                'Fabricar ahora'
                              }
                              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-loga-red hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-200 transition-colors"
                            >
                              <FlaskConical size={14} /> {
                                !todoConStock ? 'Sin stock suficiente' :
                                (requiereLimpieza && !limpiezaSiNo) ? 'Indica limpieza' :
                                nConf < total ? `Falta confirmar ${total - nConf}` :
                                'Fabricar ahora'
                              }
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Unassigned ingredients — solo en el ÚLTIMO paso para evitar
                      que se repitan en todos. Si un ingrediente no está asignado
                      a ningún paso, lo vemos al final como "quedan por echar". */}
                  {unassignedIngs.length > 0 && pasoActual === pasos.length - 1 && (
                    <div className="border-t border-gray-100 pt-3 space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Otros ingredientes</p>
                      {unassignedIngs.map((ing, idx) => {
                        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                        const necesario = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                        // Huérfanos (sin paso): scope = -1.
                        const conf = confirmados.has(cKey(-1, ing.id));
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
                                <button onClick={() => setPendienteConfirm({ id: ing.id, paso: -1 })} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:bg-gray-200">OK</button>
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
                                loteOverride={lotesOverride[ing.id]?.[0]?.lote_id}
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
                      if (isMarkedAnywhere(confirmados, ing.id)) acumulado += real;
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
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-gray-400">{nConf}/{total} confirmados</p>
                      {nConf > 0 && (
                        <button
                          onClick={async () => {
                            if (!orden) return;
                            if (!confirm('¿Reiniciar TODAS las confirmaciones de esta OF? Esto NO devuelve stock — solo borra las marcas.')) return;
                            try {
                              await produccionApi.reiniciarConfirmaciones(orden.id);
                              setConfirmados(new Set());
                              notify.success('Confirmaciones reiniciadas');
                            } catch (e: any) {
                              notify.error(e?.response?.data?.error ?? 'No se pudo reiniciar');
                            }
                          }}
                          className="text-[10px] text-red-600 hover:text-red-800 underline font-semibold">
                          Reiniciar todas
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {ingredientes.map((ing, i) => {
                      const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta!.rendimiento);
                      const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
                      const ajustado = cantidadesAjustadas[ing.id];
                      const necesario = ajustado ?? teorico;
                      const stock = parseFloat(ing.stock_disponible ?? ing.stock_actual ?? "0");
                      const suficiente = stock >= necesario;
                      // En esta vista flat (fase='confirmando' o receta sin pasos),
                      // el ingrediente se muestra como CONFIRMADO si está marcado en
                      // CUALQUIER paso. Antes solo miraba paso -1 → recetas con pasos
                      // mostraban los OK aún tras marcar todo. Bug usuario reportado.
                      const conf = isMarkedAnywhere(confirmados, ing.id);
                      const ingEsAgua = esAgua(ing.nombre_mp);
                      const echadoIng = dosificadoPorMP[ing.id] ?? 0;
                      // Para AGUA: displayed = pendiente (necesario - echado).
                      // Para otros: displayed = necesario total.
                      const displayed = ingEsAgua ? Math.max(0, necesario - echadoIng) : necesario;
                      const setAjuste = (val: number | null) => {
                        setCantidadesAjustadas(prev => {
                          const next = { ...prev };
                          if (val == null || Math.abs(val - teorico) < 0.005) delete next[ing.id];
                          else next[ing.id] = val;
                          if (orden) localStorage.setItem(`fab_ajustes_${orden.id}`, JSON.stringify(next));
                          return next;
                        });
                      };
                      const setDisplayed = (v: number | null) => {
                        if (v == null) { setAjuste(null); return; }
                        // Para agua: editas el pendiente → ajuste = v + echado.
                        setAjuste(ingEsAgua ? v + echadoIng : v);
                      };
                      const step = teorico >= 100 ? 1 : teorico >= 10 ? 0.5 : teorico >= 1 ? 0.1 : 0.01;
                      // OK abre confirmación. Si la receta tiene pasos, usamos el
                      // primer paso donde aparezca este ingrediente (para que la
                      // confirmación se guarde con paso_index coherente). Sin pasos: -1.
                      const handleOk = () => {
                        if (okBlocked()) return; // anti tap-cadena tras popup previo
                        let pasoMark = -1;
                        if (hasPasos) {
                          for (let pi = 0; pi < pasos.length; pi++) {
                            if ((pasos[pi].ingredientes_ids ?? []).includes(ing.materia_prima_id)) {
                              pasoMark = pi; break;
                            }
                          }
                          // Si no aparece en ningún paso (huérfano): paso 0 por defecto.
                          if (pasoMark === -1) pasoMark = 0;
                        }
                        setPendienteConfirm({ id: ing.id, paso: pasoMark });
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
                              const lotes = [...lotesMP[ing.materia_prima_id]];
                              const ov = lotesOverride[ing.id];
                              // Para agua mostramos el pendiente (lo que falta por echar)
                              // distribuido entre el/los lote(s) del override. Si no hay
                              // override, FEFO sobre el pendiente. Para no-agua: lo planificado.
                              const baseCantidad = ingEsAgua ? displayed : necesario;
                              const usar: { lote: any; tomar: number }[] = [];
                              if (ov && ov.length > 0) {
                                let restante = baseCantidad;
                                for (const o of ov) {
                                  if (restante <= 0) break;
                                  const l = lotes.find((x: any) => x.id === o.lote_id);
                                  if (!l) continue;
                                  const tomar = ingEsAgua ? Math.min(o.cantidad, restante) : o.cantidad;
                                  usar.push({ lote: l, tomar });
                                  restante -= tomar;
                                }
                              } else {
                                const lotesOrd = lotes.sort((a, b) => {
                                  if (a.fecha_caducidad && b.fecha_caducidad) return a.fecha_caducidad.localeCompare(b.fecha_caducidad);
                                  return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
                                });
                                let falta = baseCantidad;
                                for (const l of lotesOrd) {
                                  if (falta <= 0) break;
                                  const disponible = parseFloat(l.cantidad_actual);
                                  const tomar = Math.min(disponible, falta);
                                  usar.push({ lote: l, tomar });
                                  falta -= tomar;
                                }
                              }
                              if (usar.length === 0) return null;
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {usar.map(({ lote: l, tomar }, li) => (
                                    <button
                                      key={li}
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setEditandoLotesIng(ing.id); }}
                                      title={l.tanque ? `Tanque ${l.tanque} · Click para cambiar de lote` : 'Click para cambiar de lote'}
                                      className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-md px-2 py-1 font-bold font-mono hover:bg-blue-100 hover:border-blue-400 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                                    >
                                      <TanqueBadge tanque={l.tanque} size="sm" />
                                      {l.lote_interno} <span className="font-normal text-blue-500">({tomar.toFixed(2)} {ing.unidad_medida})</span>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                          {fase !== 'fabricando' && fase !== 'completado' && (
                            conf ? (
                              <button
                                onClick={() => {
                                  // Deshacer de TODOS los pasos donde esté marcado este ing.
                                  // Vista flat (fase=confirmando o sin pasos) no sabe qué paso
                                  // específico revertir → revertimos todos.
                                  const suffix = `|${ing.id}`;
                                  for (const k of Array.from(confirmados)) {
                                    if (k.endsWith(suffix)) {
                                      const sep = k.indexOf('|');
                                      const p = parseInt(k.slice(0, sep), 10);
                                      deshacerIngrediente(ing.id, p);
                                    }
                                  }
                                }}
                                className="shrink-0 text-[11px] text-gray-400 hover:text-gray-700 underline">deshacer</button>
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
                    {/* Registro de Limpieza · ultra-compacto inline.
                        Lo automático (fecha, lote, producto, máquina=Agitador 1,
                        sistema=Agua, herramienta=Pistola, presión=Sí, resultado=APTO,
                        firma=usuario) va por detrás. El operario solo decide:
                        - ¿Limpieza Sí/No?
                        - Motivo (chips)
                        - ¿Alta presión Sí/No? (solo si limpieza=Sí)
                        - Observaciones */}
                    {requiereLimpieza && (() => {
                      const buildRegistro = () => {
                        const motivoLabel = MOTIVOS_LIMPIEZA.find(m => m.value === limpiezaMotivo)?.label ?? '';
                        const partes: string[] = [
                          `Limpieza: ${limpiezaSiNo === 'si' ? 'Sí' : limpiezaSiNo === 'no' ? 'No' : '—'}`,
                        ];
                        if (motivoLabel) partes.push(`Motivo: ${motivoLabel}`);
                        partes.push(`Máquina: ${limpiezaMaquina}`);
                        if (limpiezaSiNo === 'si') {
                          partes.push(`Sistema: ${limpiezaSistemaProd} (presión: Sí)`);
                          partes.push(`Tipo: ${limpiezaHerramienta}${limpiezaAltaPres ? ` (alta presión: ${limpiezaAltaPres === 'si' ? 'Sí' : 'No'})` : ''}`);
                        }
                        partes.push('Resultado: APTO');
                        if (limpiezaObservaciones) partes.push(`Obs: ${limpiezaObservaciones}`);
                        return partes.join(' · ');
                      };
                      return (
                        <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-2.5 py-2.5 space-y-2.5 shadow-sm">
                          <div className="flex items-center gap-1.5">
                            <Droplets size={12} className="text-amber-700" />
                            <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Limpieza</span>
                          </div>

                          {/* Sí / No */}
                          <div className="flex gap-1">
                            <button type="button"
                              onClick={() => { setLimpiezaSiNo('si'); setRegistroLimpieza(buildRegistro()); }}
                              className={clsx('flex-1 rounded-md py-2 text-xs font-bold transition-all',
                                limpiezaSiNo === 'si' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50')}>
                              Sí
                            </button>
                            <button type="button"
                              onClick={() => { setLimpiezaSiNo('no'); setRegistroLimpieza(buildRegistro()); }}
                              className={clsx('flex-1 rounded-md py-2 text-xs font-bold transition-all',
                                limpiezaSiNo === 'no' ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50')}>
                              No
                            </button>
                          </div>

                          {/* Motivo */}
                          {limpiezaSiNo && (
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold text-amber-800/70 uppercase tracking-wider">Motivo</p>
                              <div className="flex flex-wrap gap-1">
                                {MOTIVOS_LIMPIEZA.map(m => (
                                  <button key={m.value} type="button"
                                    onClick={() => { setLimpiezaMotivo(m.value); setRegistroLimpieza(buildRegistro()); }}
                                    className={clsx(
                                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all',
                                      limpiezaMotivo === m.value
                                        ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                                        : 'bg-white text-amber-800 border-amber-300 hover:border-amber-500'
                                    )}>
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Alta presión (solo si Sí) */}
                          {limpiezaSiNo === 'si' && (
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold text-amber-800/70 uppercase tracking-wider">¿Alta presión?</p>
                              <div className="flex gap-1">
                                <button type="button"
                                  onClick={() => { setLimpiezaAltaPres('si'); setRegistroLimpieza(buildRegistro()); }}
                                  className={clsx('flex-1 rounded-md py-1.5 text-[11px] font-bold transition-all',
                                    limpiezaAltaPres === 'si' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-white text-emerald-700 border border-emerald-200')}>
                                  Sí
                                </button>
                                <button type="button"
                                  onClick={() => { setLimpiezaAltaPres('no'); setRegistroLimpieza(buildRegistro()); }}
                                  className={clsx('flex-1 rounded-md py-1.5 text-[11px] font-bold transition-all',
                                    limpiezaAltaPres === 'no' ? 'bg-gray-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200')}>
                                  No
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Observaciones */}
                          {limpiezaSiNo && (
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold text-amber-800/70 uppercase tracking-wider">Observaciones</p>
                              <textarea rows={2}
                                value={limpiezaObservaciones}
                                onChange={e => { setLimpiezaObservaciones(e.target.value); setRegistroLimpieza(buildRegistro()); }}
                                placeholder="opcional…"
                                className="w-full rounded-md border border-amber-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-amber-500 resize-none leading-snug placeholder:text-gray-400" />
                            </div>
                          )}

                          {/* Firma APTO (resumen) */}
                          {limpiezaSiNo && (
                            <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1.5">
                              <Check size={11} className="text-emerald-600 shrink-0" />
                              <span className="text-[10px] text-emerald-800 leading-tight truncate">
                                <b>APTO</b> · {user?.nombre ?? '—'}
                              </span>
                            </div>
                          )}
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
                      disabled={!todoConStock || (requiereLimpieza && !limpiezaSiNo)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-loga-red px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-200 hover:bg-red-700 disabled:bg-gray-300 disabled:shadow-none transition-colors">
                      <FlaskConical size={15} /> {todoConStock ? 'Fabricar ahora' : 'Sin stock suficiente'}
                    </button>
                    {requiereLimpieza && !limpiezaSiNo && todoConStock && (
                      <p className="text-[10px] text-amber-600 text-center font-medium">Indica si se ha realizado limpieza (Sí / No)</p>
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
        onScan={(_code) => { setScanning(false); if (scanIngId) confirmarIngrediente(scanIngId, hasPasos ? pasoActual : -1); }}
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

      {/* Confirmación al pulsar OK en un ingrediente — KEY obligatoria por AnimatePresence */}
      {pendienteConfirm && (() => {
        const ing = ingredientes.find(i => i.id === pendienteConfirm.id);
        if (!ing || !orden || !receta) { return null; }
        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
        // Si es agua confirmada desde un paso específico con cantidad_agua > 0,
        // usar la porción de ese paso, no la cantidad total del ingrediente.
        const pasoDelConfirm = pendienteConfirm.paso >= 0 ? pasos[pendienteConfirm.paso] : null;
        const ingEsAguaPasoConfirm = esAgua(ing.nombre_mp) && pasoDelConfirm != null && Number(pasoDelConfirm.cantidad_agua) > 0;
        const cantidadBase = ingEsAguaPasoConfirm ? Number(pasoDelConfirm!.cantidad_agua) : parseFloat(ing.cantidad);
        const teorico = cantidadBase * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
        const necesario = cantidadesAjustadas[ing.id] ?? teorico;
        const ingEsAgua = esAgua(ing.nombre_mp);
        // echadoIng = lo ya echado contra este paso + crédito de agua inicial
        // (paso=-1) aún sin consumir por pasos previos. Igual que la fila.
        let echadoIng = 0;
        if (ingEsAguaPasoConfirm) {
          const echadoPaso = (echadoPorPaso[ing.id] ?? {})[pendienteConfirm.paso] ?? 0;
          const echadoInicial = (echadoPorPaso[ing.id] ?? {})[-1] ?? 0;
          let necesarioPrevios = 0;
          for (let pi = 0; pi < pendienteConfirm.paso; pi++) {
            const ca = Number(pasos[pi]?.cantidad_agua) || 0;
            if (ca > 0) {
              necesarioPrevios += ca * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
            }
          }
          const creditDisponible = Math.max(0, echadoInicial - necesarioPrevios);
          const creditAplicado = Math.min(creditDisponible, teorico);
          echadoIng = echadoPaso + creditAplicado;
        } else {
          echadoIng = dosificadoPorMP[ing.id] ?? 0;
        }
        // En agua, real = pendiente para este paso.
        const real = ingEsAgua ? Math.max(0, necesario - echadoIng) : necesario;
        // Plan de lotes: respeta override manual; si no hay, FEFO. Para agua, sobre el pendiente.
        const lotesProd = lotesMP[ing.materia_prima_id] ?? [];
        const override = lotesOverride[ing.id];
        let planLotes: Array<{ lote: any; usar: number }> = [];
        let falta = real;
        if (override && override.length > 0) {
          for (const o of override) {
            if (falta <= 0) break;
            const l = lotesProd.find((x: any) => x.id === o.lote_id);
            if (!l) continue;
            const usar = ingEsAgua ? Math.min(o.cantidad, falta) : o.cantidad;
            planLotes.push({ lote: l, usar });
            falta -= usar;
          }
        } else {
          const lotesOrdenados = [...lotesProd].sort((a: any, b: any) => {
            if (a.fecha_caducidad && b.fecha_caducidad) return String(a.fecha_caducidad).localeCompare(String(b.fecha_caducidad));
            return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
          });
          for (const l of lotesOrdenados) {
            if (falta <= 0) break;
            const disp = parseFloat((l as any).cantidad_actual ?? '0');
            const usar = Math.min(disp, falta);
            planLotes.push({ lote: l, usar });
            falta -= usar;
          }
        }
        return (
          <motion.div key={`confirm-${pendienteConfirm.id}-${pendienteConfirm.paso}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            {/* Backdrop NO cierra el modal — forzamos al usuario a pulsar Cancelar
                o Confirmar explícitamente. Evita confirmaciones por touch fuera. */}
            <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 8 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-amber-50">
                <AlertCircle size={16} className="text-amber-600" />
                <p className="text-sm font-bold text-gray-900">¿Ya has VERTIDO este ingrediente?</p>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <p className="text-xs text-amber-700 font-semibold">Pulsa "Sí" SOLO si ya está físicamente en la cuba. Esto descontará el stock.</p>
                  <p className="text-base font-bold text-gray-900 mt-1">{ing.nombre_mp}</p>
                </div>
                {(() => {
                  // Acumulado en tanque DESPUÉS de echar este ingrediente — para
                  // que el operario sepa cuál es el nivel objetivo del tanque
                  // al cerrar la llave. Incluye:
                  //   1) Confirmados → su cantidad real planificada
                  //   2) Agua con dispense parcial (paso=-1) ya en cuba
                  //   3) + lo que se va a echar AHORA (este ingrediente)
                  let tanqueActual = 0;
                  let totalTanque = 0;
                  for (const ig of ingredientes) {
                    const tt = parseFloat(ig.cantidad) * ratio * (1 + parseFloat(ig.porcentaje_merma) / 100);
                    const rt = cantidadesAjustadas[ig.id] ?? tt;
                    totalTanque += tt;
                    if (isMarkedAnywhere(confirmados, ig.id)) tanqueActual += rt;
                    else if (esAgua(ig.nombre_mp)) tanqueActual += dosificadoPorMP[ig.id] ?? 0;
                  }
                  const acumuladoTanque = tanqueActual + real;
                  const pctTanque = totalTanque > 0 ? (acumuladoTanque / totalTanque) * 100 : 0;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                          {ingEsAgua && echadoIng > 0.001 ? 'Falta echar' : 'Cantidad a echar'}
                        </p>
                        <p className="text-2xl font-bold text-gray-900 tabular-nums">
                          {(ingEsAgua ? real : necesario).toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-sm text-gray-500 font-normal">{ing.unidad_medida ?? 'kg'}</span>
                        </p>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-blue-700">Tanque al cerrar llave</p>
                          <p className="text-[10px] font-bold text-blue-700">{pctTanque.toFixed(0)}%</p>
                        </div>
                        <p className="text-lg font-bold text-blue-900 tabular-nums leading-tight">
                          {acumuladoTanque.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                          <span className="text-xs text-blue-600 font-normal"> / {totalTanque.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg</span>
                        </p>
                        <div className="mt-1 h-1 rounded-full bg-blue-100 overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, pctTanque)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {planLotes.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1">Lote{planLotes.length > 1 ? 's' : ''} a consumir (FEFO)</p>
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      {planLotes.map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] border-b border-gray-100 last:border-b-0">
                          <span className="font-mono text-gray-700 truncate">{p.lote.lote_interno}</span>
                          <span className="font-semibold tabular-nums text-gray-900 shrink-0">{p.usar.toLocaleString('es-ES', { maximumFractionDigits: 3 })} {ing.unidad_medida ?? 'kg'}</span>
                        </div>
                      ))}
                      {falta > 0.001 && (
                        <div className="px-2.5 py-1.5 text-[10px] bg-red-50 text-red-700 border-t border-red-100">
                          ⚠ Faltan {falta.toLocaleString('es-ES', { maximumFractionDigits: 3 })} sin lote disponible
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
                {/* Cancelar tiene autoFocus → si el usuario presiona Enter por
                    inercia, dismissea en lugar de confirmar. Defensa anti-tap. */}
                <button onClick={() => setPendienteConfirm(null)}
                  autoFocus
                  className="flex-1 rounded-lg border-2 border-gray-300 bg-white py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-100">
                  No aún
                </button>
                <button
                  disabled={!confirmReady}
                  onClick={async () => {
                    if (!confirmReady) return;
                    // Anti doble-fire: si el botón ya se está procesando, ignora
                    // el 2º evento (touchend + click bug en algunos dispositivos).
                    if (confirmingRef.current) return;
                    confirmingRef.current = true;
                    // Para agua: dispense ahora (al confirmar). Hacemos el descuento del
                    // pendiente justo antes de marcar el ingrediente como consumido.
                    if (ingEsAgua && real > 0.001 && orden) {
                      try {
                        const ov = lotesOverride[ing.id];
                        const loteOverride = ov && ov.length > 0 ? ov[0].lote_id : undefined;
                        await produccionApi.dosificar(orden.id, {
                          producto_id: ing.materia_prima_id,
                          cantidad: real,
                          ingrediente_receta_id: ing.id,
                          lote_id: loteOverride,
                          // paso_index para que la dosificación cuente solo en el paso
                          // correspondiente (necesario para agua repartida).
                          paso_index: pendienteConfirm.paso >= 0 ? pendienteConfirm.paso : null,
                        });
                        await recargarDosificaciones();
                      } catch (e: any) {
                        notify.error(e?.response?.data?.error ?? 'Error al echar lo restante');
                        return;
                      }
                    }
                    confirmarIngrediente(ing.id, pendienteConfirm.paso);
                    notify.success(`${ing.nombre_mp} marcado como echado`);
                    setPendienteConfirm(null);
                    setOkCooldownUntil(Date.now() + 1200);
                  }}
                  className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-bold text-white hover:bg-loga-red-dark disabled:bg-gray-300 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1">
                  <Check size={14} /> {confirmReady ? (real > 0.001 ? `Sí, ya eché ${real.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${ing.unidad_medida ?? 'kg'}` : `Sí, todo echado (${necesario.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${ing.unidad_medida ?? 'kg'})`) : 'Espera 1 s…'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}

      {/* Revisión pre-fabricación — admin verifica todos los lotes */}
      {revisionPre && orden && receta && (() => {
        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
        const filas = ingredientes.map(ing => {
          const teorico = parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100);
          const real = cantidadesAjustadas[ing.id] ?? teorico;
          const lotesProd = lotesMP[ing.materia_prima_id] ?? [];
          const override = lotesOverride[ing.id];
          let plan: Array<{ lote: any; usar: number }> = [];
          let falta = real;
          if (override && override.length > 0) {
            for (const o of override) {
              const l = lotesProd.find((x: any) => x.id === o.lote_id);
              if (l) plan.push({ lote: l, usar: o.cantidad });
              falta -= o.cantidad;
            }
          } else {
            const lotesOrd = [...lotesProd].sort((a: any, b: any) => {
              if (a.fecha_caducidad && b.fecha_caducidad) return String(a.fecha_caducidad).localeCompare(String(b.fecha_caducidad));
              return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
            });
            for (const l of lotesOrd) {
              if (falta <= 0) break;
              const disp = parseFloat((l as any).cantidad_actual ?? '0');
              const usar = Math.min(disp, falta);
              plan.push({ lote: l, usar });
              falta -= usar;
            }
          }
          return { ing, real, plan, falta, manual: !!override };
        });
        const algoSinStock = filas.some(f => f.falta > 0.001);
        return (
          <motion.div key="revisionPre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setRevisionPre(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-indigo-50">
                <AlertCircle size={18} className="text-indigo-600" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">Revisión pre-fabricación · {orden.numero_orden}</p>
                  <p className="text-[10px] text-gray-500">Verifica los lotes asignados antes de descontar stock.</p>
                </div>
                <button onClick={() => setRevisionPre(false)} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-white/60">
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-[9px] uppercase tracking-wider text-gray-500">
                      <th className="text-left py-2 px-3 font-semibold">Ingrediente</th>
                      <th className="text-right py-2 px-3 font-semibold">Necesario</th>
                      <th className="text-left py-2 px-3 font-semibold">Lote(s) — click para cambiar</th>
                      <th className="text-right py-2 px-3 font-semibold">Cantidad</th>
                      <th className="text-center py-2 px-3 font-semibold">Origen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filas.map(({ ing, real, plan, falta, manual }) => (
                      <React.Fragment key={ing.id}>
                        {plan.length === 0 ? (
                          <tr className="bg-red-50/40">
                            <td className="py-2 px-3 font-semibold text-gray-900">{ing.nombre_mp}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{real.toFixed(3)} {ing.unidad_medida ?? 'kg'}</td>
                            <td colSpan={2} className="py-2 px-3 text-red-700 italic">⚠ sin lotes disponibles</td>
                            <td className="py-2 px-3 text-center">
                              <button onClick={() => setEditandoLotesIng(ing.id)}
                                className="rounded bg-blue-600 text-white px-2 py-0.5 text-[10px] font-bold hover:bg-blue-700">
                                Elegir lote
                              </button>
                            </td>
                          </tr>
                        ) : plan.map((p, pi) => (
                          <tr key={pi} className={clsx('hover:bg-blue-50/30 cursor-pointer', manual && 'bg-blue-50/30')}
                            onClick={() => setEditandoLotesIng(ing.id)}>
                            <td className="py-1.5 px-3">
                              {pi === 0 && (
                                <>
                                  <p className="font-semibold text-gray-900">{ing.nombre_mp}</p>
                                  <p className="text-[9px] font-mono text-gray-400">{ing.codigo_mp}</p>
                                </>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {pi === 0 && <span className="font-bold">{real.toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-[10px] text-gray-500 font-normal">{ing.unidad_medida ?? 'kg'}</span></span>}
                            </td>
                            <td className="py-1.5 px-3">
                              <span className="font-mono text-[10px] text-blue-700 underline decoration-dotted hover:text-blue-900 inline-flex items-center gap-1.5">
                                <TanqueBadge tanque={p.lote.tanque} size="sm" className="no-underline" />
                                {p.lote.lote_interno}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums">
                              {p.usar.toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-[10px] text-gray-500">{ing.unidad_medida ?? 'kg'}</span>
                            </td>
                            <td className="py-1.5 px-3 text-center">
                              {pi === 0 && (
                                manual
                                  ? <span className="inline-block rounded bg-blue-100 text-blue-700 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">manual</span>
                                  : <span className="inline-block rounded bg-emerald-100 text-emerald-700 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">FEFO</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {falta > 0.001 && (
                          <tr className="bg-red-50/40">
                            <td colSpan={5} className="py-1 px-3 text-red-700 text-[10px] italic">
                              ⚠ Faltan {falta.toLocaleString('es-ES', { maximumFractionDigits: 3 })} {ing.unidad_medida ?? 'kg'} de {ing.nombre_mp} sin lote disponible.
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-500">
                {isAdmin
                  ? <>Firmando como <b className="text-gray-900">{user?.nombre ?? '—'}</b> (admin). Esta firma queda en la trazabilidad de la OF.</>
                  : <span className="text-amber-700">⚠ Solo un administrador puede confirmar la fabricación. Pide a un admin que firme.</span>
                }
              </div>
              <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
                <button onClick={() => { setRevisionPre(false); onClose(); }}
                  className="flex-1 rounded-lg border border-gray-200 bg-white py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    if (!orden) return;
                    // Persistir en backend: el override + flag de revisión firmada.
                    // Cualquier operario que abra después la OF entra directo a producción.
                    try {
                      const payload = Object.entries(lotesOverride)
                        .map(([ingId, lotes]) => {
                          const ing = ingredientes.find(i => i.id === ingId);
                          return ing && lotes.length > 0
                            ? { materia_prima_id: ing.materia_prima_id, lotes }
                            : null;
                        })
                        .filter((x): x is { materia_prima_id: string; lotes: { lote_id: string; cantidad: number }[] } => !!x);
                      await produccionApi.revisarLotes(orden.id, payload);
                    } catch (e: any) {
                      notify.error(e?.response?.data?.error ?? 'Error al firmar la revisión');
                      return;
                    }
                    setRevisionPreOk(true);
                    setRevisionPre(false);
                  }}
                  disabled={!isAdmin || algoSinStock}
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:bg-gray-300 inline-flex items-center justify-center gap-1">
                  <Check size={12} /> Confirmar e iniciar fabricación
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}

      {/* Modal: Cambiar lotes de un ingrediente — con confirmación */}
      {editandoLotesIng && (() => {
        const ing = ingredientes.find(i => i.id === editandoLotesIng);
        if (!ing || !orden || !receta) return null;
        const ratio = parseFloat(orden.cantidad_planificada) / parseFloat(receta.rendimiento);
        const necesario = (cantidadesAjustadas[ing.id] ?? parseFloat(ing.cantidad) * ratio * (1 + parseFloat(ing.porcentaje_merma) / 100));
        const lotesDisp = [...(lotesMP[ing.materia_prima_id] ?? [])].sort((a: any, b: any) => {
          if (a.fecha_caducidad && b.fecha_caducidad) return String(a.fecha_caducidad).localeCompare(String(b.fecha_caducidad));
          return a.fecha_caducidad ? -1 : b.fecha_caducidad ? 1 : 0;
        });
        // Override actual o FEFO auto como punto de partida
        const overrideActual = lotesOverride[ing.id];
        const cantidadPorLote = new Map<string, number>();
        if (overrideActual) {
          for (const o of overrideActual) cantidadPorLote.set(o.lote_id, o.cantidad);
        } else {
          let falta = necesario;
          for (const l of lotesDisp) {
            if (falta <= 0) break;
            const disp = parseFloat((l as any).cantidad_actual ?? '0');
            const usar = Math.min(disp, falta);
            cantidadPorLote.set((l as any).id, usar);
            falta -= usar;
          }
        }
        const total = Array.from(cantidadPorLote.values()).reduce((s, v) => s + v, 0);
        const setCant = (loteId: string, nuevoVal: number) => {
          const next = new Map(cantidadPorLote);
          if (nuevoVal <= 0) next.delete(loteId); else next.set(loteId, nuevoVal);
          const arr = Array.from(next.entries()).map(([lote_id, cantidad]) => ({ lote_id, cantidad }));
          setLotesOverride(prev => ({ ...prev, [editandoLotesIng]: arr }));
        };
        const guardar = () => {
          if (!confirm(`¿Confirmas el cambio de lote para "${ing.nombre_mp}"?\n\nTotal asignado: ${total.toFixed(3)} ${ing.unidad_medida ?? 'kg'} de ${necesario.toFixed(3)} ${ing.unidad_medida ?? 'kg'} necesarios.`)) return;
          setEditandoLotesIng(null);
        };
        const resetFEFO = () => {
          if (!confirm('¿Volver al reparto FEFO automático? Se perderán los cambios manuales.')) return;
          setLotesOverride(prev => {
            const next = { ...prev };
            delete next[editandoLotesIng];
            return next;
          });
          setEditandoLotesIng(null);
        };
        const diff = total - necesario;
        const okTotal = Math.abs(diff) < 0.001;
        return (
          <motion.div key={`lotes-${editandoLotesIng}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setEditandoLotesIng(null)}>
            <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 8 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-blue-50">
                <FlaskConical size={16} className="text-blue-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">Cambiar lotes</p>
                  <p className="text-[10px] text-gray-500 truncate">{ing.nombre_mp}</p>
                </div>
                <button onClick={() => setEditandoLotesIng(null)} className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-white/60">
                  <X size={14} />
                </button>
              </div>
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between text-xs">
                <span className="text-gray-500">Necesario: <b className="text-gray-900 tabular-nums">{necesario.toLocaleString('es-ES', { maximumFractionDigits: 3 })} {ing.unidad_medida ?? 'kg'}</b></span>
                <span className={clsx('font-bold tabular-nums', okTotal ? 'text-emerald-600' : 'text-loga-red')}>
                  Asignado: {total.toLocaleString('es-ES', { maximumFractionDigits: 3 })} {ing.unidad_medida ?? 'kg'}
                  {!okTotal && <span className="ml-1 text-[10px]">({diff > 0 ? '+' : ''}{diff.toFixed(3)})</span>}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {lotesDisp.length === 0 && (
                  <p className="text-[11px] text-gray-400 italic text-center py-4">Sin lotes disponibles para este ingrediente.</p>
                )}
                {lotesDisp.map((l: any) => {
                  const disp = parseFloat(l.cantidad_actual ?? '0');
                  const usar = cantidadPorLote.get(l.id) ?? 0;
                  const activo = usar > 0;
                  return (
                    <div key={l.id} className={clsx('rounded-lg border p-2.5',
                      activo ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white')}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] font-bold text-gray-900 truncate flex items-center gap-1.5">
                            <TanqueBadge tanque={l.tanque} size="md" />
                            {l.lote_interno}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            Disp: {disp.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {ing.unidad_medida ?? 'kg'}
                            {l.fecha_caducidad && ` · cad. ${new Date(l.fecha_caducidad).toLocaleDateString('es-ES')}`}
                          </p>
                        </div>
                        <input type="number" min="0" max={disp} step="0.001" value={usar || ''}
                          onChange={(e) => setCant(l.id, Math.min(disp, parseFloat(e.target.value) || 0))}
                          placeholder="0"
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-mono text-right outline-none focus:border-blue-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
                <button onClick={resetFEFO}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-600 hover:bg-gray-100">
                  Reset FEFO
                </button>
                <button onClick={() => setEditandoLotesIng(null)}
                  className="flex-1 rounded-lg border border-gray-200 bg-white py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">
                  Cancelar
                </button>
                <button onClick={guardar} disabled={!okTotal}
                  className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 inline-flex items-center justify-center gap-1">
                  <Check size={12} /> Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        );
      })()}

    </AnimatePresence>
  );
}

// ── DosificarAguaInline ────────────────────────────────────────────────────
// Botón inline al lado de cada ingrediente que sea AGUA. Permite registrar
// echadas parciales sucesivas durante la fabricación (cada click POST a
// /produccion/:id/dosificar — descuenta stock al instante). Muestra acumulado
// y pendiente para que el operario sepa cuánto le queda por echar.
function DosificarAguaInline({
  ordenId, ingredienteId, productoId, unidad, necesario, echado, loteOverride, onChange,
}: {
  ordenId: string;
  ingredienteId?: string;
  productoId: string;
  unidad: string;
  necesario: number;
  echado: number;
  loteOverride?: string | null;
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
        lote_id: loteOverride ?? undefined,
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
  ordenId, ingredienteId, productoId, unidad, totalNecesario, echadoTotal, echadoInicial, loteOverride, onChange,
}: {
  ordenId: string;
  ingredienteId: string;
  productoId: string;
  unidad: string;
  totalNecesario: number;
  echadoTotal: number;
  echadoInicial: number;
  loteOverride?: string | null;
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
        lote_id: loteOverride ?? undefined,
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

