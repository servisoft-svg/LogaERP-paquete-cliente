/**
 * EmailModal
 * ==========
 * Modal de confirmación de pedido de stock por email.
 * Flujo de doble confirmación:
 *  Paso 1: Mostrar/editar email y datos → botón "Revisar envío"
 *  Paso 2: Confirmación final → botón "Confirmar y Enviar"
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Package, Send, CheckCircle, AlertCircle, ChevronRight, Eye } from 'lucide-react';
import { stockApi, configuracionApi } from '../api/client';
import api from '../api/client';
import type { Producto } from '../types';
import { notify } from '../lib/notify';
import SpinnerColaBlanca from './SpinnerColaBlanca';
import clsx from 'clsx';

interface EmailModalProps {
  producto: Producto | null;
  onClose: () => void;
}

type Step = 'editar' | 'confirmar' | 'enviando' | 'exito' | 'error';

export default function EmailModal({ producto, onClose }: EmailModalProps) {
  const [step, setStep]               = useState<Step>('editar');
  const [destinatario, setDestinatario] = useState('');
  const [emailsCandidatos, setEmailsCandidatos] = useState<string[]>([]);
  const [emailsSeleccionados, setEmailsSeleccionados] = useState<Set<string>>(new Set());
  const [emailExtra, setEmailExtra]   = useState('');
  const [cantidadSugerida, setCantidad] = useState(0);
  const [notas, setNotas]             = useState('');
  const [errorMsg, setErrorMsg]       = useState('');
  const [plantilla, setPlantilla]     = useState('');
  const [asunto, setAsunto]           = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [cuerpoEditado, setCuerpoEditado] = useState<string | null>(null);
  const [cuerpoManual, setCuerpoManual]   = useState(false);
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [adjuntarPdf, setAdjuntarPdf]     = useState(true);
  // Quién corre con el porte. Se imprime en el PDF (sección Agencia de transportes).
  const [porteA, setPorteA]               = useState<'proveedor' | 'cliente'>('proveedor');
  const [programar, setProgramar]         = useState(false);
  const [fechaProg, setFechaProg]         = useState('');
  const [horaProg, setHoraProg]           = useState('');

  useEffect(() => {
    if (!producto) return;
    // Construye lista candidata: email principal + adicionales
    const principal = (producto.proveedor_email ?? '').trim().toLowerCase();
    const adicionales = (producto.proveedor_emails_adicionales ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const candidatos = Array.from(new Set([principal, ...adicionales].filter(Boolean)));
    setEmailsCandidatos(candidatos);
    // Pre-selección: últimos usados (filtrados a los que aún existen) o solo el principal
    const ultimos = (producto.proveedor_ultimos_destinatarios ?? []).map((e) => e.trim().toLowerCase());
    const validos = ultimos.filter((e) => candidatos.includes(e));
    setEmailsSeleccionados(new Set(validos.length > 0 ? validos : (principal ? [principal] : [])));
    setEmailExtra('');
    setStep('editar');
    setErrorMsg('');
    setShowPreview(false);
    setCuerpoEditado(null);
    setCuerpoManual(false);
    setPrecioUnitario(producto.precio_unitario ? String(parseFloat(producto.precio_unitario)) : '');
    setAdjuntarPdf(true);
    setProgramar(false);
    setFechaProg(''); setHoraProg('');

    Promise.all([
      stockApi.cantidadSugerida(producto.id).catch(() => ({ data: { cantidad: 0 } })),
      configuracionApi.obtener().catch(() => ({ data: { plantilla_email: '', email_remitente: '' } })),
    ]).then(([cantRes, cfgRes]) => {
      setCantidad(cantRes.data.cantidad ?? 0);
      setPlantilla((cfgRes.data as { plantilla_email: string }).plantilla_email ?? '');
      setAsunto(`Pedido ${producto.nombre} — Fábrica Loga`);
    });
  }, [producto]);

  // Recalcula destinatario CSV cada vez que cambian checkboxes / email extra
  useEffect(() => {
    const base = Array.from(emailsSeleccionados);
    const extras = emailExtra.split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const todos = Array.from(new Set([...base, ...extras]));
    setDestinatario(todos.join(', '));
  }, [emailsSeleccionados, emailExtra]);

  const toggleEmail = (e: string) => {
    setEmailsSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

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
    // Si está marcado "programar", guarda en pedidos_programados en lugar de enviar ya
    if (programar) {
      if (!fechaProg || !horaProg) { setErrorMsg('Indica fecha y hora del envío programado'); setStep('error'); return; }
      try {
        await notify.promise(
          api.post('/pedidos-programados', {
            producto_id: producto.id,
            destinatarios: destinatario.split(/[,;]/).map(s => s.trim()).filter(Boolean),
            cantidad: cantidadSugerida,
            notas,
            cuerpo_personalizado: cuerpoEditado !== null ? cuerpoEditado : undefined,
            programado_para: `${fechaProg}T${horaProg}:00`,
          }),
          {
            loading: 'Programando envío…',
            success: 'Pedido programado',
            successDesc: `Saldrá ${fechaProg} a las ${horaProg}`,
            error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo programar',
          }
        );
        setStep('exito');
      } catch (err: unknown) {
        const backendMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setErrorMsg(backendMsg ?? 'No se pudo programar el envío');
        setStep('error');
      }
      return;
    }
    try {
      await notify.promise(
        stockApi.enviarPedido({
          producto_id:       producto.id,
          destinatario,
          cantidad_sugerida: cantidadSugerida,
          notas_adicionales: notas,
          cuerpo_personalizado: cuerpoEditado !== null ? cuerpoEditado : undefined,
          adjuntar_pdf:      adjuntarPdf,
          precio_unitario:   precioUnitario !== '' ? Number(precioUnitario) : undefined,
          porte_a:           porteA,
        } as any),
        {
          loading: 'Enviando email…',
          success: 'Email enviado',
          successDesc: destinatario,
          error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo enviar el email',
        }
      );
      setStep('exito');
    } catch (err: unknown) {
      const backendMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorMsg(backendMsg ?? 'No se pudo enviar el email. Verifique la configuración SMTP.');
      setStep('error');
    }
  };

  if (!producto) return null;

  return createPortal(
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
          className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 shrink-0">
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

          {/* Contenido por paso — scrollable si no cabe */}
          <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
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
                    Destinatarios *
                  </label>
                  {emailsCandidatos.length === 0 ? (
                    <input
                      type="email"
                      value={emailExtra}
                      onChange={(e) => setEmailExtra(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all"
                      placeholder="proveedor@empresa.com"
                    />
                  ) : (
                    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/40 p-2.5">
                      {emailsCandidatos.map((e, i) => {
                        const ultimos = (producto.proveedor_ultimos_destinatarios ?? []).map((x) => x.toLowerCase());
                        const fueUltimo = ultimos.includes(e);
                        return (
                          <label key={e} className="flex items-center gap-2 cursor-pointer hover:bg-white rounded px-1.5 py-1 transition-colors">
                            <input
                              type="checkbox"
                              checked={emailsSeleccionados.has(e)}
                              onChange={() => toggleEmail(e)}
                              className="accent-loga-red"
                            />
                            <span className="text-sm text-gray-700 flex-1 truncate">{e}</span>
                            {i === 0 && <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 rounded font-medium">Principal</span>}
                            {fueUltimo && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded font-medium">Último envío</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-2">
                    <input
                      type="text"
                      value={emailExtra}
                      onChange={(e) => setEmailExtra(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all"
                      placeholder="+ Añadir otro email (separar con coma)"
                    />
                  </div>
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
                    Precio unitario estimado (EUR/{producto.unidad_medida}) <span className="text-gray-400 font-normal">— opcional, aparecerá en el PDF</span>
                  </label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={precioUnitario}
                    onChange={(e) => setPrecioUnitario(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all font-mono"
                    placeholder="0.0000"
                  />
                  {precioUnitario && cantidadSugerida > 0 && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      Total estimado: <b className="text-gray-800">{(Number(precioUnitario) * cantidadSugerida).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</b>
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">
                    Observaciones <span className="text-xs font-normal text-gray-500">(aparecerán en el PDF y en el email)</span>
                  </label>
                  <textarea
                    rows={4}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none transition-all"
                    placeholder="Urgencia, formato de entrega, plazo deseado, instrucciones especiales…"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2">
                  <input type="checkbox" checked={adjuntarPdf} onChange={(e) => setAdjuntarPdf(e.target.checked)} className="accent-loga-red" />
                  <span className="font-semibold text-gray-700">Adjuntar PDF estilo factura</span>
                  <span className="text-gray-500">— solicitud formal con número correlativo</span>
                </label>

                {/* Selector de porte — aparece en el PDF en "Porte:" */}
                <div className="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2 space-y-1.5">
                  <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Porte</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPorteA('proveedor')}
                      className={clsx(
                        'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors',
                        porteA === 'proveedor'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                      )}
                    >
                      Porte pagado
                    </button>
                    <button
                      type="button"
                      onClick={() => setPorteA('cliente')}
                      className={clsx(
                        'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors',
                        porteA === 'cliente'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                      )}
                    >
                      Porte debido
                    </button>
                  </div>
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

                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={programar} onChange={(e) => setProgramar(e.target.checked)} className="accent-loga-red" />
                    <span className="font-semibold text-gray-700">Programar envío</span>
                    <span className="text-gray-400">— se enviará automáticamente en la fecha/hora indicada</span>
                  </label>
                  {programar && (
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={fechaProg} onChange={(e) => setFechaProg(e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
                      <input type="time" value={horaProg} onChange={(e) => setHoraProg(e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setStep('confirmar')}
                  disabled={!destinatario || cantidadSugerida <= 0 || (programar && (!fechaProg || !horaProg))}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {programar ? 'Revisar y programar' : 'Revisar envío'}
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
                <SpinnerColaBlanca size="md" />
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
    </AnimatePresence>,
    document.body
  );
}
