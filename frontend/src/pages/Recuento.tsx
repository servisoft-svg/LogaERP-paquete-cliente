import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Calculator, Check, AlertTriangle } from 'lucide-react';
import { productosApi, lotesApi } from '../api/client';
import type { Producto } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { notify } from '../lib/notify';
import clsx from 'clsx';

interface LoteRecuento {
  id: string;
  lote_interno: string;
  cantidad_actual: string;
  cantidad_contada: string;
  producto_id: string;
}

interface ProductoConLotes {
  producto: Producto;
  lotes: LoteRecuento[];
}

interface Diferencia {
  producto: Producto;
  lote: LoteRecuento;
  sistema: number;
  contado: number;
  diff: number;
}

export default function Recuento() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [datos, setDatos] = useState<ProductoConLotes[]>([]);
  const [diferencias, setDiferencias] = useState<Diferencia[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const prodRes = await productosApi.listar({ activo: 'true' });
      const productos = prodRes.data as Producto[];

      const results: ProductoConLotes[] = [];
      for (const p of productos) {
        const lotesRes = await lotesApi.listar({ producto_id: p.id, estado: 'aprobado' });
        const lotes = (lotesRes.data as { id: string; lote_interno: string; cantidad_actual: string; producto_id: string }[])
          .filter(l => parseFloat(l.cantidad_actual) > 0)
          .map(l => ({
            ...l,
            cantidad_contada: '',
          }));
        if (lotes.length > 0) {
          results.push({ producto: p, lotes });
        }
      }
      setDatos(results);
      setDiferencias(null);
      setApplied(false);
    } catch {
      setError('Error al cargar productos y lotes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const calcularDiferencias = () => {
    const diffs: Diferencia[] = [];
    for (const d of datos) {
      for (const l of d.lotes) {
        if (l.cantidad_contada === '') continue;
        const sistema = parseFloat(l.cantidad_actual);
        const contado = parseFloat(l.cantidad_contada);
        if (isNaN(contado)) continue;
        if (Math.abs(sistema - contado) > 0.001) {
          diffs.push({
            producto: d.producto,
            lote: l,
            sistema,
            contado,
            diff: contado - sistema,
          });
        }
      }
    }
    setDiferencias(diffs);
  };

  const aplicarCambios = async () => {
    if (!diferencias || diferencias.length === 0) return;
    setApplying(true);
    setError('');
    const ejecutar = async () => {
      for (const d of diferencias) {
        await lotesApi.actualizar(d.lote.id, { cantidad_actual: d.contado });
      }
      return diferencias.length;
    };
    try {
      await notify.promise(ejecutar(), {
        loading: 'Aplicando recuento…',
        success: 'Recuento aplicado',
        successDesc: (n) => `${n} lote(s) actualizado(s)`,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al aplicar cambios',
      });
      setApplied(true);
    } catch {
      setError('Error al aplicar cambios');
    } finally {
      setApplying(false);
    }
  };

  const updateContada = (productoIdx: number, loteIdx: number, value: string) => {
    setDatos(prev => {
      const copy = [...prev];
      const lotes = [...copy[productoIdx].lotes];
      lotes[loteIdx] = { ...lotes[loteIdx], cantidad_contada: value };
      copy[productoIdx] = { ...copy[productoIdx], lotes };
      return copy;
    });
    setDiferencias(null);
    setApplied(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/configuracion')}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
          <ClipboardList size={20} className="text-gray-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Recuento de Inventario</h1>
          <p className="text-xs text-gray-400">
            Introduce las cantidades contadas para cada lote y calcula las diferencias
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
          {error}
        </p>
      )}

      {applied && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-2">
          <Check size={16} className="text-emerald-600" />
          <p className="text-xs text-emerald-700 font-medium">
            Recuento aplicado correctamente. Las cantidades de los lotes han sido actualizadas.
          </p>
        </div>
      )}

      {/* Listado de productos con lotes */}
      {datos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No hay productos con lotes activos.</p>
      ) : (
        <div className="space-y-4">
          {datos.map((d, pi) => (
            <div key={d.producto.id} className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="font-mono text-xs text-gray-500">{d.producto.codigo}</span>
                <span className="font-semibold text-sm text-gray-800">{d.producto.nombre}</span>
                <span className="ml-auto text-xs text-gray-400">
                  Stock sistema: {parseFloat(d.producto.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {d.producto.unidad_medida}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {d.lotes.map((l, li) => (
                  <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <span className="font-mono text-gray-600 shrink-0">{l.lote_interno}</span>
                    <span className="text-gray-400 w-28 text-right tabular-nums">
                      Sistema: {parseFloat(l.cantidad_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.cantidad_contada}
                      onChange={e => updateContada(pi, li, e.target.value)}
                      placeholder="Contado"
                      disabled={applied}
                      className="w-28 rounded border border-gray-200 px-2 py-1.5 text-xs text-right font-mono focus:border-blue-400 outline-none disabled:bg-gray-50"
                    />
                    <span className="text-gray-400 text-[10px]">{d.producto.unidad_medida}</span>
                    {l.cantidad_contada !== '' && (() => {
                      const diff = parseFloat(l.cantidad_contada) - parseFloat(l.cantidad_actual);
                      if (isNaN(diff) || Math.abs(diff) < 0.001) return null;
                      return (
                        <span className={clsx('font-semibold tabular-nums', diff > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                        </span>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Botones */}
      {datos.length > 0 && !applied && (
        <div className="flex gap-3">
          <button
            onClick={calcularDiferencias}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition-colors shadow-sm"
          >
            <Calculator size={15} />
            Calcular diferencias
          </button>
        </div>
      )}

      {/* Tabla de diferencias */}
      {diferencias !== null && (
        <div className="space-y-4">
          {diferencias.length === 0 ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-2">
              <Check size={16} className="text-emerald-600" />
              <p className="text-xs text-emerald-700 font-medium">
                No hay diferencias. El inventario coincide con el sistema.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200 bg-amber-50">
                  <AlertTriangle size={15} className="text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">
                    {diferencias.length} diferencia{diferencias.length !== 1 ? 's' : ''} encontrada{diferencias.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {/* Mobile cards */}
                <div className="flex flex-col gap-2 p-3 md:hidden">
                  {diferencias.map((d, i) => (
                    <div key={i} className="rounded-lg border border-amber-100 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-800 truncate">{d.producto.nombre}</p>
                      <p className="text-[11px] font-mono text-gray-500 truncate">{d.lote.lote_interno}</p>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                        <div><p className="text-gray-400">Sistema</p><p className="tabular-nums font-medium text-gray-700">{d.sistema.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p></div>
                        <div><p className="text-gray-400">Contado</p><p className="tabular-nums font-bold text-gray-900">{d.contado.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p></div>
                        <div><p className="text-gray-400">Dif</p><p className={clsx('tabular-nums font-bold', d.diff > 0 ? 'text-emerald-600' : 'text-loga-red')}>{d.diff > 0 ? '+' : ''}{d.diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <table className="hidden md:table min-w-full divide-y divide-amber-100 text-xs">
                  <thead className="bg-amber-50/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 uppercase tracking-wide">Producto</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 uppercase tracking-wide">Lote</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600 uppercase tracking-wide">Sistema</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600 uppercase tracking-wide">Contado</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600 uppercase tracking-wide">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50 bg-white">
                    {diferencias.map((d, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-800">{d.producto.nombre}</td>
                        <td className="px-4 py-2 font-mono text-gray-600">{d.lote.lote_interno}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                          {d.sistema.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-800">
                          {d.contado.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                        </td>
                        <td className={clsx('px-4 py-2 text-right tabular-nums font-bold', d.diff > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                          {d.diff > 0 ? '+' : ''}{d.diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!applied && (
                <button
                  onClick={aplicarCambios}
                  disabled={applying}
                  className="flex items-center gap-2 rounded-lg bg-loga-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors shadow-sm"
                >
                  <Check size={15} />
                  {applying ? 'Aplicando...' : 'Aplicar cambios'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
