import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ShoppingCart, TrendingDown, Clock, ChevronDown, Layers } from 'lucide-react';
import clsx from 'clsx';
import type { Producto } from '../types';
import { lotesApi } from '../api/client';

interface LoteResumen {
  id: string;
  lote_interno: string;
  cantidad_actual: string;
  unidad_medida: string;
  fecha_caducidad?: string;
}

interface StockCardProps {
  producto: Producto;
  onPedirStock: (producto: Producto) => void;
  index?: number;
  emailEnviado?: boolean;
}

export default function StockCard({ producto, onPedirStock, index = 0, emailEnviado = false }: StockCardProps) {
  const [lotes, setLotes]         = useState<LoteResumen[]>([]);
  const [showLotes, setShowLotes] = useState(false);
  const [loadingLotes, setLoadingLotes] = useState(false);

  const toggleLotes = async () => {
    if (!showLotes && lotes.length === 0) {
      setLoadingLotes(true);
      try {
        const { data } = await lotesApi.listar({ producto_id: producto.id, estado: 'aprobado' });
        setLotes((data as LoteResumen[]).filter((l) => parseFloat(l.cantidad_actual) > 0));
      } catch { /* silencioso */ }
      finally { setLoadingLotes(false); }
    }
    setShowLotes((v) => !v);
  };
  const stockActual   = parseFloat(producto.stock_actual);
  const stockMaximo   = parseFloat(producto.stock_maximo);
  const stockMinimo   = parseFloat(producto.stock_minimo);
  const pct           = stockMaximo > 0 ? Math.min(100, (stockActual / stockMaximo) * 100) : 0;
  const alerta        = producto.alerta_activa;

  const colorBar = alerta
    ? 'bg-loga-red'
    : pct < 50
    ? 'bg-amber-400'
    : 'bg-emerald-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={clsx(
        'relative rounded-xl border bg-white p-5 flex flex-col gap-4 transition-shadow hover:shadow-md',
        alerta
          ? 'border-loga-red/40 shadow-[0_0_0_2px_rgba(255,0,0,0.08)] animate-pulse-red'
          : 'border-gray-100 shadow-sm'
      )}
    >
      {/* Badge alerta */}
      {alerta && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 rounded-full bg-loga-red px-2 py-0.5 text-[10px] font-bold text-white shadow">
          <AlertTriangle size={10} />
          STOCK BAJO
        </div>
      )}

      {/* Cabecera */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono text-gray-400 truncate">{producto.codigo}</p>
          <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">
            {producto.nombre}
          </h3>
          <span className={clsx(
            'mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded',
            producto.tipo === 'materia_prima'
              ? 'bg-blue-50 text-blue-600'
              : 'bg-purple-50 text-purple-600'
          )}>
            {producto.tipo === 'materia_prima' ? 'Materia Prima' : 'Prod. Terminado'}
          </span>
        </div>

        {alerta && (
          <TrendingDown size={20} className="text-loga-red shrink-0 mt-0.5" />
        )}
      </div>

      {/* Stock cifras */}
      <div className="flex items-end justify-between">
        <div>
          <span className={clsx(
            'text-2xl font-bold tabular-nums',
            alerta ? 'text-loga-red' : 'text-gray-900'
          )}>
            {stockActual.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
          </span>
          <span className="ml-1 text-sm text-gray-400">{producto.unidad_medida}</span>
        </div>
        <div className="text-right text-xs text-gray-400">
          <p>Mín: {stockMinimo.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p>
          <p>Máx: {stockMaximo.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Nivel de stock</span>
          <span className={alerta ? 'text-loga-red font-medium' : ''}>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <motion.div
            className={clsx('h-full rounded-full', colorBar)}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: index * 0.05 + 0.2 }}
          />
        </div>
      </div>

      {/* Desglose de lotes */}
      <div>
        <button
          onClick={toggleLotes}
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-700 transition-colors w-full"
        >
          <Layers size={11} />
          <span>Ver lotes</span>
          {loadingLotes
            ? <span className="ml-auto h-3 w-3 border border-gray-300 border-t-transparent rounded-full animate-spin" />
            : <ChevronDown size={11} className={clsx('ml-auto transition-transform', showLotes && 'rotate-180')} />
          }
        </button>
        <AnimatePresence>
          {showLotes && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-1">
                {lotes.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic">Sin lotes aprobados con stock</p>
                ) : lotes.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <code className="text-[10px] font-mono text-gray-600 truncate">{l.lote_interno}</code>
                      {l.fecha_caducidad && (
                        <span className="text-[10px] text-gray-400 shrink-0">
                          · cad. {new Date(l.fecha_caducidad).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-gray-800 shrink-0 ml-2">
                      {parseFloat(l.cantidad_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      <span className="ml-0.5 font-normal text-gray-400">{l.unidad_medida}</span>
                    </span>
                  </div>
                ))}
                {lotes.length > 1 && (
                  <div className="flex items-center justify-between rounded-lg bg-gray-100 px-2.5 py-1.5 border-t border-gray-200">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{lotes.length} lotes · Total</span>
                    <span className="text-[11px] font-bold tabular-nums text-gray-900">
                      {lotes.reduce((s, l) => s + parseFloat(l.cantidad_actual), 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      <span className="ml-0.5 font-normal text-gray-400">{lotes[0].unidad_medida}</span>
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Botón pedir stock */}
      {alerta && (
        emailEnviado ? (
          <div className="flex items-center justify-center gap-2 w-full rounded-lg bg-amber-50 border border-amber-200 py-2.5 text-sm font-semibold text-amber-700">
            <Clock size={14} />
            Stock Solicitado
          </div>
        ) : (
          <motion.button
            onClick={() => onPedirStock(producto)}
            whileTap={{ scale: 0.97 }}
            className="flex items-center justify-center gap-2 w-full rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
          >
            <ShoppingCart size={14} />
            Pedir Stock
          </motion.button>
        )
      )}
    </motion.div>
  );
}
