import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, User, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AlertaPendiente } from '../hooks/useAlertas';

interface Props {
  alerta: AlertaPendiente | null;
  onCerrar: (id: string) => void;
}

export default function AlertaModal({ alerta, onCerrar }: Props) {
  const navigate = useNavigate();
  if (!alerta) return null;
  const irAReferencia = () => {
    if (!alerta.referencia?.url) return;
    onCerrar(alerta.id);
    navigate(alerta.referencia.url);
  };
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        >
          <div className="bg-gradient-to-r from-loga-red to-red-600 px-6 py-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
              <Bell className="text-white" size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Recordatorio</p>
              <h2 className="text-lg font-bold text-white truncate">{alerta.titulo}</h2>
              {alerta.creador_nombre && (
                <p className="text-[11px] text-white/80 mt-0.5 flex items-center gap-1">
                  <User size={10} /> de parte de <b>{alerta.creador_nombre}</b>
                  {alerta.creador_rol && <span className="opacity-70">({alerta.creador_rol})</span>}
                </p>
              )}
            </div>
          </div>
          {alerta.descripcion && (
            <div className="px-6 py-4 text-sm text-gray-700 whitespace-pre-line">
              {alerta.descripcion}
            </div>
          )}
          {alerta.referencia && (
            <div className="px-6 pb-3">
              <button onClick={irAReferencia}
                className="w-full inline-flex items-center gap-2 rounded-lg border-2 border-loga-red bg-red-50 hover:bg-red-100 px-3 py-2 text-sm font-semibold text-loga-red transition-colors">
                <ExternalLink size={14} />
                <span className="flex-1 text-left truncate">{alerta.referencia.label}</span>
                <span className="text-[10px] uppercase opacity-60">{alerta.referencia_tipo}</span>
              </button>
            </div>
          )}
          <div className="px-6 py-3 text-[11px] text-gray-400 border-t border-gray-100">
            Programado: {new Date(alerta.programado_para).toLocaleString('es-ES')}
          </div>
          <div className="px-6 py-4 bg-gray-50 flex justify-end">
            <button
              onClick={() => onCerrar(alerta.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-loga-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              <Check size={14} /> Visto
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
