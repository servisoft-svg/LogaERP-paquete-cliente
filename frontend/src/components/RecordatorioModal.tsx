import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bell, Volume2, BellRing, Users, Calendar as CalIcon } from 'lucide-react';
import { recordatoriosApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../lib/notify';
import clsx from 'clsx';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onCreado?: () => void;
  fechaInicial?: string;
}

type Destino = 'yo' | 'admin' | 'operario' | 'personalizado';

const COLORES = [
  { v: 'indigo',  c: 'bg-indigo-500'  },
  { v: 'red',     c: 'bg-loga-red'    },
  { v: 'amber',   c: 'bg-amber-500'   },
  { v: 'emerald', c: 'bg-emerald-500' },
  { v: 'blue',    c: 'bg-blue-500'    },
  { v: 'purple',  c: 'bg-purple-500'  },
];

export default function RecordatorioModal({ abierto, onCerrar, onCreado, fechaInicial }: Props) {
  const { user } = useAuth();
  const [titulo, setTitulo]             = useState('');
  const [descripcion, setDescripcion]   = useState('');
  const [fecha, setFecha]               = useState(fechaInicial ?? new Date().toISOString().slice(0, 10));
  const [hora, setHora]                 = useState('');
  const [conSonido, setConSonido]       = useState(true);
  const [conNotificacion, setConNotif]  = useState(true);
  const [color, setColor]               = useState('indigo');
  const [destino, setDestino]           = useState<Destino>('yo');
  const [destinatariosIds, setDestIds]  = useState<string[]>([]);
  const [usuarios, setUsuarios]         = useState<{ id: string; nombre: string; rol: string }[]>([]);
  const [guardando, setGuardando]       = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setTitulo('');
    setDescripcion('');
    setFecha(fechaInicial ?? new Date().toISOString().slice(0, 10));
    setHora('');
    setConSonido(true);
    setConNotif(true);
    setColor('indigo');
    setDestino('yo');
    setDestIds([]);
    recordatoriosApi['usuarios' as keyof typeof recordatoriosApi];
    // Carga lista de usuarios (solo para admin o selector personalizado)
    fetch('/api/recordatorios/usuarios', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${localStorage.getItem('loga_token') ?? ''}` },
    }).then(r => r.ok ? r.json() : []).then((data) => setUsuarios(data ?? [])).catch(() => {});
  }, [abierto, fechaInicial]);

  const handleGuardar = async () => {
    if (!titulo.trim()) { notify.error('Título obligatorio'); return; }
    setGuardando(true);
    try {
      let destinatarios: string[] | undefined;
      let destinatario_roles: string[] | undefined;
      if (destino === 'yo')              destinatarios = user ? [user.id] : undefined;
      else if (destino === 'admin')      destinatario_roles = ['admin'];
      else if (destino === 'operario')   destinatario_roles = ['operario'];
      else                                destinatarios = destinatariosIds;

      const programado_para = hora ? `${fecha}T${hora}:00` : null;
      await recordatoriosApi.crear({
        fecha,
        programado_para,
        titulo: titulo.trim(),
        descripcion: descripcion.trim() || null,
        color,
        destinatarios,
        destinatario_roles,
        con_sonido: conSonido,
        con_notificacion: conNotificacion,
        origen: 'manual',
      });
      notify.success('Recordatorio creado', { description: hora ? `Avisaré ${fecha} ${hora}` : `Fecha ${fecha}` });
      onCreado?.();
      onCerrar();
    } catch (e) {
      notify.error('Error al crear', { description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '' });
    } finally { setGuardando(false); }
  };

  if (!abierto) return null;
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onCerrar} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-loga-red" />
              <h2 className="text-sm font-bold text-gray-900">Nuevo recordatorio</h2>
            </div>
            <button onClick={onCerrar} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Título *</span>
              <input
                value={titulo} onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej: Revisar lote MP-001"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                autoFocus
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Descripción</span>
              <textarea
                value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                rows={2}
                placeholder="Detalles opcionales…"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1"><CalIcon size={11} /> Fecha</span>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Hora (opcional)</span>
                <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </label>
            </div>
            <p className="text-[11px] text-gray-400 -mt-1">Sin hora = solo aparece en el calendario. Con hora = sonido + notificación a esa hora.</p>

            {hora && (
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={conSonido} onChange={(e) => setConSonido(e.target.checked)} className="accent-loga-red" />
                  <Volume2 size={12} /> Sonido
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={conNotificacion} onChange={(e) => setConNotif(e.target.checked)} className="accent-loga-red" />
                  <BellRing size={12} /> Notif navegador
                </label>
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1"><Users size={11} /> Notificar a</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {([
                  { v: 'yo',            l: 'Solo a mí' },
                  { v: 'admin',         l: 'Todos los admins' },
                  { v: 'operario',      l: 'Todos los operarios' },
                  { v: 'personalizado', l: 'Personalizado…' },
                ] as { v: Destino; l: string }[]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setDestino(opt.v)}
                    className={clsx(
                      'text-xs px-3 py-1.5 rounded-lg border transition-colors',
                      destino === opt.v
                        ? 'border-loga-red bg-red-50 text-loga-red font-semibold'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>

              {destino === 'personalizado' && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/40 p-2 max-h-40 overflow-y-auto space-y-1">
                  {usuarios.length === 0 ? (
                    <p className="text-xs text-gray-400 italic py-1">Cargando usuarios…</p>
                  ) : usuarios.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-white rounded px-1.5 py-1">
                      <input
                        type="checkbox"
                        checked={destinatariosIds.includes(u.id)}
                        onChange={() => setDestIds((p) => p.includes(u.id) ? p.filter(x => x !== u.id) : [...p, u.id])}
                        className="accent-loga-red"
                      />
                      <span className="text-xs text-gray-700 flex-1">{u.nombre}</span>
                      <span className="text-[10px] text-gray-400 uppercase">{u.rol}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Color</span>
              <div className="mt-1 flex gap-1.5">
                {COLORES.map((c) => (
                  <button
                    key={c.v} type="button" onClick={() => setColor(c.v)}
                    className={clsx('h-7 w-7 rounded-full', c.c, color === c.v && 'ring-2 ring-offset-2 ring-gray-400')}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
            <button onClick={onCerrar} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Cancelar</button>
            <button
              onClick={handleGuardar}
              disabled={!titulo.trim() || guardando}
              className="text-xs px-4 py-1.5 rounded-lg bg-loga-red text-white font-semibold hover:bg-red-700 disabled:opacity-40"
            >
              {guardando ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
