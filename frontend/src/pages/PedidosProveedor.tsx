import { useEffect, useState, useMemo } from 'react';
import { Download, Filter, ShoppingBag, FileText, Mail } from 'lucide-react';
import { stockApi } from '../api/client';
import api from '../api/client';
import clsx from 'clsx';

interface PedidoProveedor {
  id: string;
  numero_solicitud?: string | null;
  producto_id: string;
  producto_codigo: string;
  producto_nombre: string;
  unidad_medida: string;
  proveedor_nombre?: string;
  cantidad_solicitada: string;
  cantidad_recibida?: string | null;
  precio_unitario?: string | null;
  importe_total?: string | null;
  destinatario_email: string;
  notas?: string | null;
  fecha_solicitud: string;
  fecha_recepcion?: string | null;
  lead_time_horas?: string | null;
  estado: 'borrador' | 'enviado' | 'pendiente' | 'completado' | 'cancelado';
  origen: 'manual' | 'automatizacion';
}

const ESTADO_COLOR: Record<string, string> = {
  borrador:    'bg-gray-100 text-gray-700',
  enviado:     'bg-blue-100 text-blue-700',
  pendiente:   'bg-amber-100 text-amber-700',
  completado:  'bg-emerald-100 text-emerald-700',
  cancelado:   'bg-red-100 text-loga-red',
};

export default function PedidosProveedor() {
  const [pedidos, setPedidos] = useState<PedidoProveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await stockApi.pedidosProveedor(filtroEstado ? { estado: filtroEstado } : {});
      setPedidos(data as PedidoProveedor[]);
    } catch { setPedidos([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, [filtroEstado]);

  const filtrados = useMemo(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = norm(busqueda.trim());
    if (!q) return pedidos;
    return pedidos.filter(p =>
      norm(p.producto_nombre).includes(q) ||
      norm(p.producto_codigo).includes(q) ||
      norm(p.proveedor_nombre ?? '').includes(q) ||
      norm(p.numero_solicitud ?? '').includes(q) ||
      norm(p.destinatario_email).includes(q)
    );
  }, [pedidos, busqueda]);

  const descargarPdf = async (id: string, numero?: string | null) => {
    try {
      const res = await api.get(`/stock/pedidos-proveedor/${id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${numero ?? 'solicitud'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch { /* notify */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag size={22} /> Solicitudes de compra
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Historial de peticiones de reposición a proveedores</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-gray-500"><Filter size={12} /> Filtros:</div>
        {(['', 'borrador', 'enviado', 'pendiente', 'completado', 'cancelado'] as const).map((e) => (
          <button
            key={e || 'todos'}
            onClick={() => setFiltroEstado(e)}
            className={clsx(
              'text-xs px-3 py-1 rounded-full font-medium transition-colors',
              filtroEstado === e ? 'bg-loga-red text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {e || 'Todos'}
          </button>
        ))}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto, proveedor, email…"
          className="flex-1 min-w-[200px] rounded-lg border border-gray-200 px-3 py-1 text-xs"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <ShoppingBag size={28} className="mx-auto mb-2 text-gray-200" />
            Sin solicitudes
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Nº</th>
                  <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                  <th className="text-left px-3 py-2 font-semibold">Producto</th>
                  <th className="text-left px-3 py-2 font-semibold">Proveedor</th>
                  <th className="text-right px-3 py-2 font-semibold">Cantidad</th>
                  <th className="text-right px-3 py-2 font-semibold">Importe</th>
                  <th className="text-center px-3 py-2 font-semibold">Estado</th>
                  <th className="text-left px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{p.numero_solicitud ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{new Date(p.fecha_solicitud).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-800">{p.producto_nombre}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{p.producto_codigo}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{p.proveedor_nombre ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {parseFloat(p.cantidad_solicitada).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}
                      {p.cantidad_recibida && (
                        <p className="text-[10px] text-emerald-600">Recibido: {parseFloat(p.cantidad_recibida).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {p.importe_total != null ? `${parseFloat(p.importe_total).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={clsx('inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', ESTADO_COLOR[p.estado] ?? 'bg-gray-100')}>
                        {p.estado}
                      </span>
                      {p.origen === 'automatizacion' && (
                        <p className="text-[9px] text-purple-500 mt-0.5">auto</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[180px]">
                      <a href={`mailto:${p.destinatario_email}`} className="hover:text-loga-red inline-flex items-center gap-1">
                        <Mail size={11} /> {p.destinatario_email}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => descargarPdf(p.id, p.numero_solicitud)}
                        title="Descargar PDF"
                        className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 inline-flex items-center gap-1"
                      >
                        <FileText size={13} /> <Download size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
