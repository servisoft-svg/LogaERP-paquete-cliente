import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, RotateCcw, Thermometer, Clock, Droplets, FlaskConical, Check } from 'lucide-react';
import type { PasoReceta, IngredienteReceta } from '../types';
import TanqueRojo from './TanqueRojo';
import clsx from 'clsx';

interface Props {
  pasos: PasoReceta[];
  ingredientes: IngredienteReceta[];
  rendimiento?: number;
}

export default function ReactorVisualization({ pasos, ingredientes, rendimiento }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [fillLevel, setFillLevel] = useState(0);
  const [temperatura, setTemperatura] = useState(25);
  const [targetTemp, setTargetTemp] = useState(25);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalWeight = ingredientes.reduce((s, i) => s + parseFloat(i.cantidad), 0) || rendimiento || 1000;

  // Temperature animation
  useEffect(() => {
    if (Math.abs(temperatura - targetTemp) < 0.5) return;
    const iv = setInterval(() => {
      setTemperatura(prev => {
        const diff = targetTemp - prev;
        if (Math.abs(diff) < 0.5) return targetTemp;
        return prev + diff * 0.08;
      });
    }, 50);
    return () => clearInterval(iv);
  }, [targetTemp, temperatura]);

  // Playback
  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    if (currentStep < 0) setCurrentStep(0);
    const dur = pasos[Math.max(0, currentStep)]?.duracion_min ?? 3;
    intervalRef.current = setInterval(() => {
      setCurrentStep(prev => {
        const next = prev + 1;
        if (next >= pasos.length) { setPlaying(false); return prev; }
        return next;
      });
    }, Math.max(dur * 1000, 2500));
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, currentStep, pasos]);

  // Update fill + temp on step change
  useEffect(() => {
    if (currentStep < 0) return;
    const paso = pasos[currentStep];
    if (!paso) return;

    let cumWeight = 0;
    for (let i = 0; i <= currentStep; i++) {
      const p = pasos[i];
      if (p?.ingredientes_ids?.length) {
        for (const id of p.ingredientes_ids) {
          const ing = ingredientes.find(x => x.materia_prima_id === id);
          if (ing) cumWeight += parseFloat(ing.cantidad);
        }
      } else {
        cumWeight += totalWeight / pasos.length;
      }
    }
    setFillLevel(Math.min((cumWeight / totalWeight) * 90, 90));

    if (paso.temperatura) {
      const t = parseFloat(paso.temperatura);
      if (!isNaN(t)) setTargetTemp(t);
    }
  }, [currentStep, pasos, ingredientes, totalWeight]);

  const reset = () => {
    setPlaying(false);
    setCurrentStep(-1);
    setFillLevel(0);
    setTemperatura(25);
    setTargetTemp(25);
  };

  const goToStep = (i: number) => {
    setPlaying(false);
    setCurrentStep(i);
  };

  const currentPaso = currentStep >= 0 ? pasos[currentStep] : null;
  const stepIngredients = (currentPaso?.ingredientes_ids ?? [])
    .map(id => ingredientes.find(x => x.materia_prima_id === id))
    .filter(Boolean) as IngredienteReceta[];

  if (pasos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-6 py-10 text-center">
        <FlaskConical size={28} className="mx-auto mb-2 text-gray-300" />
        <p className="text-sm text-gray-400">Sin pasos de proceso definidos</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying(!playing)}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all shadow-sm',
            playing ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-loga-red text-white hover:bg-red-700'
          )}
        >
          {playing ? <><Pause size={13} /> Pausar</> : <><Play size={13} /> Simular</>}
        </button>
        <button onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <RotateCcw size={13} /> Reset
        </button>
        {currentPaso && (
          <span className="ml-auto text-[10px] font-semibold text-loga-red bg-red-50 rounded-full px-2.5 py-0.5">
            Paso {currentStep + 1}/{pasos.length}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-4">
        {/* Tank */}
        <div className="flex justify-center">
          <TanqueRojo pct={fillLevel} temperatura={temperatura} size={130} />
        </div>

        {/* Steps timeline + status */}
        <div className="space-y-3">
          {/* Current step card */}
          <AnimatePresence mode="wait">
            {currentPaso ? (
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="rounded-xl border-2 border-loga-red/20 bg-red-50/30 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-loga-red px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                    {currentPaso.fase}
                  </span>
                  <h4 className="font-bold text-gray-900 text-sm">{currentPaso.titulo}</h4>
                </div>
                {currentPaso.descripcion && (
                  <p className="text-xs text-gray-500 leading-relaxed">{currentPaso.descripcion}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  {currentPaso.temperatura && (
                    <div className="flex items-center gap-1 text-xs">
                      <Thermometer size={12} className={temperatura > 60 ? 'text-loga-red' : temperatura > 35 ? 'text-amber-500' : 'text-blue-500'} />
                      <span className="font-mono font-bold text-gray-700">{Math.round(temperatura)}°C</span>
                      <span className="text-gray-400">/ {currentPaso.temperatura}°C</span>
                    </div>
                  )}
                  {currentPaso.duracion_min && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock size={12} /><span>{currentPaso.duracion_min} min</span>
                    </div>
                  )}
                </div>
                {stepIngredients.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Ingredientes</p>
                    {stepIngredients.map(ing => (
                      <div key={ing.id} className="flex items-center gap-2 text-xs">
                        <Droplets size={11} className="text-loga-red" />
                        <span className="font-medium text-gray-700">{ing.nombre_mp}</span>
                        <span className="tabular-nums text-gray-400">{parseFloat(ing.cantidad).toLocaleString('es-ES')} {ing.unidad_medida}</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-5 text-center">
                <Play size={18} className="mx-auto mb-1 text-gray-300" />
                <p className="text-xs text-gray-400">Pulsa "Simular" o selecciona un paso</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Timeline */}
          <div className="space-y-0">
            {pasos.map((paso, i) => {
              const isActive = i === currentStep;
              const isDone = i < currentStep;
              return (
                <div
                  key={i}
                  onClick={() => goToStep(i)}
                  className={clsx(
                    'flex items-start gap-3 px-3 py-1.5 rounded-lg cursor-pointer transition-all',
                    isActive ? 'bg-red-50 ring-1 ring-red-200' : 'hover:bg-gray-50',
                  )}
                >
                  <div className="flex flex-col items-center pt-0.5">
                    <div
                      className={clsx(
                        'rounded-full border-2 flex items-center justify-center',
                        isDone ? 'border-emerald-500 bg-emerald-500' : isActive ? 'border-loga-red bg-red-50' : 'border-gray-200 bg-white'
                      )}
                      style={{ width: isActive ? 18 : 14, height: isActive ? 18 : 14 }}
                    >
                      {isDone && <Check size={8} className="text-white" />}
                      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-loga-red" />}
                    </div>
                    {i < pasos.length - 1 && (
                      <div className={clsx('w-0.5 flex-1 min-h-[12px]', isDone ? 'bg-emerald-400' : 'bg-gray-200')} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={clsx(
                        'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                        isActive || isDone ? 'bg-loga-red text-white' : 'bg-gray-100 text-gray-400'
                      )}>
                        {paso.fase}
                      </span>
                      <span className={clsx('text-xs font-semibold truncate', isActive ? 'text-gray-900' : 'text-gray-500')}>
                        {paso.titulo}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
