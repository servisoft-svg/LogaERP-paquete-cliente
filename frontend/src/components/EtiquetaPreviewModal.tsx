import { useEffect, useRef, useState } from 'react';
import { X, Printer, Download, RefreshCw, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { produccionApi } from '../api/client';

interface Props {
  ordenId: string | null;
  numeroOrden?: string;
  open: boolean;
  onClose: () => void;
}

interface Defaults {
  lote: string;
  cantidad: number;
  unidad?: string;
  qrUrl: string;
  titulo: string;
  subtitulo: string;
  contenedorText: string;
}

/**
 * Preview de la etiqueta L-800 con campos editables (lote, cantidad, contenedor,
 * EAN). Auto-regenera el PDF con debounce al cambiar cualquier valor.
 * Botones: Imprimir (via iframe.print) y Descargar.
 */
export default function EtiquetaPreviewModal({ ordenId, numeroOrden, open, onClose }: Props) {
  // Valores auto-detectados (lote real del lote producido, cantidad real…)
  const [defaults, setDefaults] = useState<Defaults | null>(null);

  // Valores editables (controlables por el operario antes de imprimir)
  const [lote, setLote] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState('Kg');
  const [contenedorText, setContenedorText] = useState('Contenedor nº: 1');
  const [titulo, setTitulo] = useState('');
  const [subtitulo, setSubtitulo] = useState('');

  // PDF blob
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. Al abrir → trae defaults y pre-rellena inputs
  useEffect(() => {
    if (!open || !ordenId) return;
    produccionApi.etiquetaDefaults(ordenId)
      .then(({ data }) => {
        const d = data as Defaults;
        setDefaults(d);
        setLote(d.lote);
        setCantidad(String(d.cantidad));
        setUnidad(d.unidad ?? 'Kg');
        setContenedorText(d.contenedorText);
        setTitulo(d.titulo);
        setSubtitulo(d.subtitulo);
      })
      .catch((e) => setError(e?.response?.data?.error ?? 'Error cargando datos'));
  }, [open, ordenId]);

  // 2. Cada vez que cambia un input → regenera PDF (debounce 400 ms)
  useEffect(() => {
    if (!open || !ordenId || defaults == null) return;
    let revokeUrl: string | null = null;
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      produccionApi.etiquetaPdf(ordenId, {
        lote: lote.trim() || undefined,
        cantidad: cantidad !== '' && !isNaN(Number(cantidad)) ? Number(cantidad) : undefined,
        unidad: unidad.trim() || undefined,
        contenedorText: contenedorText.trim() || undefined,
        titulo: titulo.trim() || undefined,
        subtitulo: subtitulo,  // Permite vaciarlo explícitamente
      })
        .then((res) => {
          const blob = new Blob([res.data], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          // Revocar el anterior si existe
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          revokeUrl = url;
        })
        .catch((e) => {
          setError(e?.response?.data?.error ?? 'Error al generar etiqueta');
        })
        .finally(() => setLoading(false));
    }, 400);
    return () => {
      clearTimeout(t);
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ordenId, defaults, lote, cantidad, unidad, contenedorText, titulo, subtitulo]);

  // Cleanup blob URL al cerrar
  useEffect(() => {
    if (!open) {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setDefaults(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const imprimir = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      if (pdfUrl) window.open(pdfUrl, '_blank');
    }
  };

  const descargar = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `etiqueta-${lote || numeroOrden || ordenId}.pdf`;
    a.click();
  };

  const descargarEzpx = async () => {
    if (!ordenId) return;
    try {
      const res = await import('../api/client').then(m => m.produccionApi.etiquetaEzpx(ordenId, {
        lote: lote.trim() || undefined,
        cantidad: cantidad !== '' && !isNaN(Number(cantidad)) ? Number(cantidad) : undefined,
        contenedorText: contenedorText.trim() || undefined,
        titulo: titulo.trim() || undefined,
        subtitulo,
      }));
      const blob = new Blob([res.data], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `etiqueta-${lote || numeroOrden || ordenId}.ezpx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch { /* silent */ }
  };

  const resetDefaults = () => {
    if (!defaults) return;
    setLote(defaults.lote);
    setCantidad(String(defaults.cantidad));
    setContenedorText(defaults.contenedorText);
    setTitulo(defaults.titulo);
    setSubtitulo(defaults.subtitulo);
  };

  const valoresModificados = defaults != null && (
    lote !== defaults.lote ||
    Number(cantidad) !== defaults.cantidad ||
    contenedorText !== defaults.contenedorText ||
    titulo !== defaults.titulo ||
    subtitulo !== defaults.subtitulo
  );

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative z-10 w-full max-w-4xl rounded-2xl bg-white shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500">
                  <Printer size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Etiqueta L-800</p>
                  <p className="text-[11px] text-gray-400">
                    {numeroOrden ? `Orden ${numeroOrden} · ` : ''}Formato 150 × 100 mm
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* ── Form editor ── */}
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/40">
                <div className="flex items-center gap-2 mb-3">
                  <Edit3 size={13} className="text-amber-600" />
                  <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Datos de la etiqueta</p>
                  {valoresModificados && (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                      modificada
                    </span>
                  )}
                  {valoresModificados && (
                    <button
                      onClick={resetDefaults}
                      className="ml-auto inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900"
                      title="Restaurar valores del lote real"
                    >
                      <RefreshCw size={11} /> Restaurar
                    </button>
                  )}
                </div>

                {/* ── Fila 1: Subtítulo + Título grande ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Subtítulo <span className="font-normal text-gray-400 normal-case">(línea pequeña)</span>
                    </label>
                    <input
                      type="text"
                      value={subtitulo}
                      onChange={(e) => setSubtitulo(e.target.value)}
                      placeholder="COLA BLANCA 800 TRIACETINA"
                      maxLength={60}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-mono focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Título grande <span className="font-normal text-gray-400 normal-case">(nombre comercial)</span>
                    </label>
                    <input
                      type="text"
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      placeholder="LOGA 800"
                      maxLength={40}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-mono font-bold focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                </div>

                {/* ── Fila 2: Lote + Cantidad + Contenedor ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Lote</label>
                    <input
                      type="text"
                      value={lote}
                      onChange={(e) => setLote(e.target.value.toUpperCase())}
                      placeholder="26E024"
                      maxLength={20}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-mono font-bold focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Contenido</label>
                    <div className="flex items-stretch rounded-md border border-gray-200 focus-within:border-amber-400 overflow-hidden">
                      <input
                        type="number" min="0" step="0.01"
                        value={cantidad}
                        onChange={(e) => setCantidad(e.target.value)}
                        placeholder="200"
                        className="flex-1 px-2.5 py-1.5 text-sm font-mono font-bold outline-none min-w-0"
                      />
                      <select value={unidad} onChange={(e) => setUnidad(e.target.value)}
                        className="bg-gray-50 border-l border-gray-200 px-2 text-sm font-bold outline-none">
                        {['mL','cL','L','g','Kg'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Contenedor <span className="font-normal text-gray-400 normal-case">(texto libre)</span>
                    </label>
                    <input
                      type="text"
                      value={contenedorText}
                      onChange={(e) => setContenedorText(e.target.value)}
                      placeholder="Contenedor nº: 1"
                      maxLength={40}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                </div>

                {/* Medidas pegatina */}
                <div className="mt-3 flex items-center gap-3 text-[10px] text-gray-500">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2 py-1 font-mono">
                    📏 Pegatina: <b className="text-gray-800">150 × 100 mm</b>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-200 px-2 py-1 font-mono">
                    QR: <b className="text-gray-800">~20 × 20 mm</b>
                  </span>
                  <span className="text-gray-400 italic">Al imprimir → tamaño real (sin escalado)</span>
                </div>
              </div>

              {/* ── Preview iframe ── */}
              <div className="bg-gray-100 p-4 flex items-center justify-center min-h-[360px]">
                {error && (
                  <p className="text-sm text-loga-red bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
                )}
                {!error && (
                  <div className="relative w-full">
                    {loading && (
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1 shadow-sm">
                        <span className="h-3 w-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                        Generando…
                      </div>
                    )}
                    {pdfUrl && (
                      <iframe
                        ref={iframeRef}
                        src={pdfUrl}
                        className="w-full bg-white border border-gray-200 shadow-sm rounded"
                        style={{ minHeight: 360, height: 400 }}
                        title="Preview etiqueta"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60 shrink-0">
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">Cerrar</button>
              <div className="flex items-center gap-2">
                <button
                  onClick={descargarEzpx}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40 transition-colors"
                  title="Descarga .ezpx — ábrelo con QLabel para imprimir nativo en GoDEX térmica"
                >
                  <Download size={13} /> .ezpx (GoDEX)
                </button>
                <button
                  onClick={descargar}
                  disabled={!pdfUrl || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-300 disabled:opacity-40 transition-colors"
                >
                  <Download size={13} /> PDF
                </button>
                <button
                  onClick={imprimir}
                  disabled={!pdfUrl || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-40 transition-colors"
                >
                  <Printer size={14} /> Imprimir
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
