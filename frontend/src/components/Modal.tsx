import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
}

export default function Modal({
  open, onClose, title, subtitle, children, maxWidth = 'max-w-lg',
}: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`relative z-10 w-full ${maxWidth} max-h-[92vh] flex flex-col bg-white shadow-2xl rounded-t-2xl sm:rounded-2xl`}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-6 py-3 sm:py-4 shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">{title}</h2>
                {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="shrink-0 rounded-lg p-2 -mr-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            {/* Body con scroll */}
            <div className="overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 flex-1 pb-[env(safe-area-inset-bottom)]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
