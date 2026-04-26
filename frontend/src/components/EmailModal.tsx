/**
 * EmailModal
 * ==========
 * Modal de confirmación de pedido de stock por email.
 * Flujo de doble confirmación:
 *  Paso 1: Mostrar/editar email y datos → botón "Revisar envío"
 *  Paso 2: Confirmación final → botón "Confirmar y Enviar"
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Package, Send, CheckCircle, AlertCircle, ChevronRight, Eye } from 'lucide-react';
import { stockApi, configuracionApi } from '../api/client';
import type { Producto } from '../types';
import clsx from 'clsx';

interface EmailModalProps {
  producto: Producto | null;
  onClose: () => void;
}

type Step = 'editar' | 'confirmar' | 'enviando' | 'exito' | 'error';

export default function EmailModal({ producto, onClose }: EmailModalProps) {
  const [step, setStep]               = useState<Step>('editar');
  const [destinatario, setDestinatario] = useState('');
  const [cantidadSugerida, setCantidad] = useState(0);
  const [notas, setNotas]             = useState('');
  const [errorMsg, setErrorMsg]       = useState('');
  const [plantilla, setPlantilla]     = useState('');
  const [asunto, setAsunto]           = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [cuerpoEditado, setCuerpoEditado] = useState<string | null>(null);
  const [cuerpoManual, setCuerpoManual]   = useState(false);

  useEffect(() => {
    if (!producto) return;
    setDestinatario(producto.proveedor_email ?? '');
    setStep('editar');
    setErrorMsg('');
    setShowPreview(false);
    setCuerpoEditado(null);
    setCuerpoManual(false);

    Promise.all([
      stockApi.cantidadSugerida(producto.id).catch(() => ({ data: { cantidad: 0 } })),
      configuracionApi.obtener().catch(() => ({ data: { plantilla_email: '', email_remitente: '' } })),
    ]).then(([cantRes, cfgRes]) => {
      setCantidad(cantRes.data.cantidad ?? 0);
      setPlantilla((cfgRes.data as { plantilla_email: string }).plantilla_email ?? '');
      setAsunto(`Pedido ${producto.nombre} — Fábrica Loga`);
    });
  }, [producto]);

  const renderCuerpo = () => {
    if (!producto) return '';
    const cantidad = cantidadSugerida.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return plantilla
      .replace(/\{\{producto\}\}/g, producto.nombre)
      .replace(/\{\{cantidad\}\}/g, cantidad)
      .replace(/\{\{unidad\}\}/g, producto.unidad_medida)
      .replace(/\{\{proveedor\}\}/g, producto.proveedor_nombre ?? 'Proveedor')
      + (notas ? `\n\nNotas adicionales: ${notas}` : '');
  };

  const handleTogglePreview = () => {
    if (!showPreview && cuerpoEditado === null) {
      setCuerpoEditado(renderCuerpo());
    }
    setShowPreview((v) => !v);
  };

  const handleEnviar = async () => {
    if (!producto) return;
    setStep('enviando');
    try {
      await stockApi.enviarPedido({
        producto_id:       producto.id,
        destinatario,
        cantidad_sugerida: cantidadSugerida,
        notas_adicionales: notas,
        cuerpo_personalizado: cuerpoEditado !== null ? cuerpoEditado : undefined,
      });
      setStep('exito');
    } catch {
      setErrorMsg('No se pudo enviar el email. Verifique la configuración SMTP.');
      setStep('error');
    }
  };

  if (!producto) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/30 backdrop-blur-sm"
          onClick={step !== 'enviando' ? onClose : undefined}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50">
                <Mail size={18} className="text-loga-red" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Pedido de Stock</h2>
                <p className="text-xs text-gray-400">{producto.codigo} — {producto.nombre}</p>
              </div>
            </div>
            {step !== 'enviando' && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Contenido por paso */}
          <div className="px-6 py-5 space-y-4">
            {/* Info producto */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 flex items-center gap-3">
              <Package size={20} className="text-gray-400 shrink-0" />
              <div className="text-sm min-w-0">
                <p className="font-medium text-gray-900 truncate">{producto.nombre}</p>
                <p className="text-gray-400">
                  Stock actual:
                  <span className="ml-1 font-semibold text-loga-red">
                    {parseFloat(producto.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {producto.unidad_medida}
                  </span>
                </p>
              </div>
            </div>

            {step === 'editar' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Email destinatario *
                  </label>
                  <input
                    type="email"
                    value={destinatario}
                    onChange={(e) => setDestinatario(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all"
                    placeholder="proveedor@empresa.com"
                  />
                  {producto.proveedor_nombre && (
                    <p className="mt-1 text-xs text-gray-400">Proveedor: {producto.proveedor_nombre}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Cantidad sugerida ({producto.unidad_medida}) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={cantidadSugerida}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setCantidad(val);
                      if (!cuerpoManual && showPreview) {
                        // Regenerar preview con nueva cantidad
                        const cantStr = val.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                        const nuevo = plantilla
                          .replace(/\{\{producto\}\}/g, producto.nombre)
                          .replace(/\{\{cantidad\}\}/g, cantStr)
                          .replace(/\{\{unidad\}\}/g, producto.unidad_medida)
                          .replace(/\{\{proveedor\}\}/g, producto.proveedor_nombre ?? 'Proveedor')
                          + (notas ? `\n\nNotas adicionales: ${notas}` : '');
                        setCuerpoEditado(nuevo);
                      }
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Notas adicionales (opcional)
                  </label>
                  <textarea
                    rows={3}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all resize-none"
                    placeholder="Urgencia, formato de entrega…"
                  />
                </div>

                {/* Preview */}
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={handleTogglePreview}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <span className="flex items-center gap-1.5"><Eye size={12} /> Vista previa del email</span>
                    <ChevronRight size={12} className={clsx('transition-transform', showPreview && 'rotate-90')} />
                  </button>
                  <AnimatePresence>
                    {showPreview && (
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 py-3 space-y-2 bg-white border-t border-gray-100">
                          <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Asunto</div>
                          <p className="text-xs font-semibold text-gray-800 bg-gray-50 rounded px-2 py-1.5">{asunto}</p>
                          <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mt-2">Para</div>
                          <p className="text-xs text-gray-700 bg-gray-50 rounded px-2 py-1.5">{destinatario || '—'}</p>
                          <div className="flex items-center justify-between mt-2">
                            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Cuerpo</div>
                            <span className="text-[10px] text-blue-500">editable</span>
                          </div>
                          <textarea
                            rows={6}
                            value={cuerpoEditado ?? ''}
                            onChange={(e) => { setCuerpoEditado(e.target.value); setCuerpoManual(true); }}
                            className="w-full text-xs text-gray-700 bg-blue-50/50 border border-blue-200 rounded-lg px-3 py-2.5 font-sans leading-relaxed resize-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={() => setStep('confirmar')}
                  disabled={!destinatario || cantidadSugerida <= 0}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Revisar envío
                  <ChevronRight size={16} />
                </button>
              </motion.div>
            )}

            {step === 'confirmar' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
                  <p className="font-semibold">Confirmar envío de email</p>
                  <p>Para: <span className="font-medium">{destinatario}</span></p>
                  <p>Cantidad: <span className="font-medium">{cantidadSugerida} {producto.unidad_medida}</span></p>
                  {notas && <p>Notas: {notas}</p>}
                </div>

                <p className="text-xs text-gray-500 text-center">
                  Esta acción enviará el correo de pedido al proveedor.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep('editar')}
                    className="flex-1 rounded-lg border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Volver
                  </button>
                  <button
                    onClick={handleEnviar}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-loga-red py-3 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
                  >
                    <Send size={14} />
                    Confirmar y Enviar
                  </button>
                </div>
              </motion.div>
            )}

            {step === 'enviando' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-6 gap-3">
                <div className="h-10 w-10 rounded-full border-2 border-loga-red border-t-transparent animate-spin" />
                <p className="text-sm text-gray-500">Enviando email…</p>
              </motion.div>
            )}

            {step === 'exito' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6 gap-3 text-center"
              >
                <CheckCircle size={48} className="text-emerald-500" />
                <p className="font-semibold text-gray-900">Email enviado correctamente</p>
                <p className="text-sm text-gray-400">El pedido fue enviado a {destinatario}</p>
                <button
                  onClick={onClose}
                  className="mt-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  Cerrar
                </button>
              </motion.div>
            )}

            {step === 'error' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center py-6 gap-3 text-center"
              >
                <AlertCircle size={48} className="text-loga-red" />
                <p className="font-semibold text-gray-900">Error al enviar</p>
                <p className="text-sm text-gray-400">{errorMsg}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setStep('editar')}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Volver a editar
                  </button>
                  <button
                    onClick={onClose}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
