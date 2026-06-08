// Galería de fotos del pedido empaquetado · respaldo ante incidencias.
// Operario sube 1-N fotos del bulto antes de cerrar el pedido. Se muestran
// como miniaturas dentro del modal Consumir; click para abrir grande; botón
// X para borrar. Las fotos viven en backend/uploads y se sirven con token.
import { useEffect, useState } from 'react';
import { Camera, X, Maximize2 } from 'lucide-react';
import { pedidosApi } from '../api/client';
import { notify } from '../lib/notify';

interface Props {
  pedidoId: string;
  numeroPedido: string;
}

export default function FotosPedidoSection({ pedidoId }: Props) {
  const [fotos, setFotos] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';

  useEffect(() => {
    pedidosApi.listarFotos(pedidoId).then(r => {
      const data = r.data as { fotos: string[] };
      setFotos(data.fotos ?? []);
    }).catch(() => setFotos([]));
  }, [pedidoId]);

  const subir = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try {
      const r = await pedidosApi.subirFotos(pedidoId, Array.from(files));
      const data = r.data as { fotos: string[] };
      setFotos(data.fotos ?? []);
      notify.success(`${files.length} foto${files.length !== 1 ? 's' : ''} subida${files.length !== 1 ? 's' : ''}`);
    } catch (e: any) {
      // Pulla el mensaje real del backend (formato / tamaño) en lugar del genérico.
      const msg = e?.response?.data?.error
        ?? e?.response?.data?.error_info?.mensaje
        ?? e?.response?.data?.mensaje
        ?? 'No se pudieron subir las fotos';
      notify.error(typeof msg === 'string' ? msg : 'No se pudieron subir las fotos');
    }
    finally { setSubiendo(false); }
  };

  const borrar = async (url: string) => {
    if (!confirm('¿Borrar esta foto?')) return;
    const filename = url.split('/').pop() ?? '';
    try {
      await pedidosApi.borrarFoto(pedidoId, filename);
      setFotos(prev => prev.filter(f => f !== url));
    } catch { notify.error('No se pudo borrar'); }
  };

  const fotoUrl = (url: string) => `${url}?token=${encodeURIComponent(token)}`;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {fotos.slice(0, 3).map(f => (
          <button key={f} onClick={() => setLightbox(f)}
            className="relative w-10 h-10 rounded-md overflow-hidden border-2 border-gray-200 hover:border-indigo-400 transition-colors">
            <img src={fotoUrl(f)} alt="foto pedido" className="w-full h-full object-cover" />
          </button>
        ))}
        {fotos.length > 3 && (
          <button onClick={() => setLightbox(fotos[3])}
            className="w-10 h-10 rounded-md border-2 border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-600 hover:bg-gray-100">
            +{fotos.length - 3}
          </button>
        )}
        <label className="inline-flex items-center gap-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 cursor-pointer">
          <Camera size={12} />
          {subiendo ? 'Subiendo…' : fotos.length > 0 ? 'Más fotos' : 'Subir fotos'}
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={e => subir(e.target.files)} disabled={subiendo} />
        </label>
      </div>
      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={fotoUrl(lightbox)} alt="foto" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" />
            <div className="absolute top-2 right-2 flex gap-2">
              <button onClick={() => { borrar(lightbox); setLightbox(null); }}
                title="Borrar"
                className="rounded-full bg-red-600 hover:bg-red-700 text-white p-2 shadow-lg">
                <X size={16} />
              </button>
              <button onClick={() => setLightbox(null)}
                title="Cerrar"
                className="rounded-full bg-gray-800 hover:bg-gray-900 text-white p-2 shadow-lg">
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
