import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

export default function ConfirmModal({
  open, title, message,
  confirmText = 'Confirmar', cancelText = 'Cancelar', secondaryText,
  danger = true, loading = false,
  onConfirm, onCancel, onSecondary,
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-red-50' : 'bg-blue-50'}`}>
            <AlertTriangle size={18} className={danger ? 'text-loga-red' : 'text-blue-600'} />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{message}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {onSecondary && secondaryText && (
            <button
              onClick={onSecondary}
              disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 transition-colors"
            >
              {loading ? 'Procesando...' : secondaryText}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:bg-gray-300 ${danger ? 'bg-loga-red hover:bg-loga-red-dark' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {loading ? 'Procesando...' : confirmText}
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
