import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../lib/notify';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
}

export default function PerfilModal({ abierto, onCerrar }: Props) {
  const { user, actualizarPerfil } = useAuth();
  const [nombre, setNombre] = useState('');
  const [email, setEmail]   = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!abierto || !user) return;
    setNombre(user.nombre ?? '');
    setEmail(user.email ?? '');
  }, [abierto, user]);

  const guardar = async () => {
    if (!nombre.trim()) { notify.error('El nombre es obligatorio'); return; }
    setSaving(true);
    try {
      await actualizarPerfil({ nombre: nombre.trim(), email: email.trim() });
      notify.success('Perfil actualizado', { description: `Firmarás como "${nombre.trim()}"` });
      onCerrar();
    } catch (e: any) {
      notify.error('Error al guardar', { description: e?.response?.data?.error ?? '' });
    } finally { setSaving(false); }
  };

  if (!abierto) return null;
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onCerrar} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
          className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <User size={16} className="text-loga-red" />
              <h2 className="text-sm font-bold text-gray-900">Mi perfil</h2>
            </div>
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-gray-500">El nombre aparece como firmante en pedidos, controles de calidad, recetas y todas las firmas.</p>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Nombre completo</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Jesús López Alfonso"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <div className="text-[11px] text-gray-400">
              Rol: <span className="font-semibold text-gray-600">{user?.rol}</span>
            </div>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
            <button onClick={onCerrar} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Cancelar</button>
            <button onClick={guardar} disabled={saving || !nombre.trim()}
              className="text-xs px-4 py-1.5 rounded-lg bg-loga-red text-white font-semibold hover:bg-red-700 disabled:opacity-40">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
