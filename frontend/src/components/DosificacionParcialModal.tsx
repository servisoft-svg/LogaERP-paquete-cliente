import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Droplet, FlaskConical, RefreshCw } from 'lucide-react';
import { produccionApi, lotesApi } from '../api/client';
import { notify } from '../lib/notify';
import Modal from './Modal';
import SpinnerColaBlanca from './SpinnerColaBlanca';
import clsx from 'clsx';

interface Props {
  ordenId: string | null;
  onClose: () => void;
  onChange?: () => void;
}

interface DosifItem {
  ingrediente_id: string;
  producto_id: string;
  nombre: string;
  codigo: string;
  subcategoria_mp?: string | null;
  es_aditivo?: boolean;
  unidad_medida: string;
  planificado: number;
  echado: number;
  pendiente: number;
  stock_actual: number;
}

interface Dosif {
  id: string;
  producto_id: string;
  lote_id?: string | null;
  cantidad: string;
  unidad_medida: string;
  notas?: string | null;
  created_at: string;
  lote_interno?: string | null;
  operario_nombre?: string | null;
}

interface LoteOpt {
  id: string;
  lote_interno: string;
  cantidad_actual: string;
  fecha_caducidad?: string;
}

export default function DosificacionParcialModal({ ordenId, onClose, onChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DosifItem[]>([]);
  const [dosificaciones, setDosificaciones] = useState<Dosif[]>([]);
  const [numero, setNumero] = useState<string>('');
  const [estado, setEstado] = useState<string>('');
  const [activeIng, setActiveIng] = useState<string | null>(null);
  const [cant, setCant] = useState<string>('');
  const [loteSel, setLoteSel] = useState<string>('');
  const [notas, setNotas] = useState<string>('');
  const [posting, setPosting] = useState(false);
  const [lotesByProd, setLotesByProd] = useState<Record<string, LoteOpt[]>>({});

  const cargar = useCallback(async () => {
    if (!ordenId) return;
    setLoading(true);
    try {
      const { data } = await produccionApi.listarDosificaciones(ordenId);
      const d = data as { orden: { numero_orden: string; estado: string }; items: DosifItem[]; dosificaciones: Dosif[] };
      setItems(d.items);
      setDosificaciones(d.dosificaciones);
      setNumero(d.orden.numero_orden);
      setEstado(d.orden.estado);
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al cargar dosificaciones');
    } finally {
      setLoading(false);
    }
  }, [ordenId]);

  useEffect(() => { cargar(); }, [cargar]);

  const cargarLotes = async (productoId: string) => {
    if (lotesByProd[productoId]) return;
    try {
      const { data } = await lotesApi.listar({ producto_id: productoId, estado: 'aprobado' });
      const ls = (data as LoteOpt[]).filter(l => parseFloat(l.cantidad_actual) > 0);
      setLotesByProd(prev => ({ ...prev, [productoId]: ls }));
    } catch {
      setLotesByProd(prev => ({ ...prev, [productoId]: [] }));
    }
  };

  const abrirEchada = async (item: DosifItem) => {
    setActiveIng(item.producto_id);
    const sugerida = Math.min(item.pendiente, item.stock_actual);
    setCant(sugerida > 0 ? sugerida.toFixed(3) : '');
    setLoteSel('');
    setNotas('');
    await cargarLotes(item.producto_id);
  };

  const ordenInactiva = !['borrador', 'confirmada', 'en_proceso'].includes(estado);

  const guardarEchada = async () => {
    if (!ordenId || !activeIng) return;
    const c = parseFloat(cant);
    if (!Number.isFinite(c) || c <= 0) {
      notify.error('Cantidad inválida');
      return;
    }
    setPosting(true);
    try {
      await produccionApi.dosificar(ordenId, {
        producto_id: activeIng,
        lote_id: loteSel || null,
        cantidad: c,
        notas: notas.trim() || undefined,
      });
      notify.success('Echada registrada');
      setActiveIng(null);
      setCant('');
      setLoteSel('');
      setNotas('');
      // Refrescar lotes del producto (cantidad cambió)
      setLotesByProd(prev => { const cp = { ...prev }; delete cp[activeIng]; return cp; });
      await cargar();
      onChange?.();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al registrar echada');
    } finally {
      setPosting(false);
    }
  };

  const revertir = async (d: Dosif) => {
    if (!ordenId) return;
    if (!confirm(`¿Revertir echada de ${parseFloat(d.cantidad).toFixed(3)} ${d.unidad_medida}? Devuelve el stock al lote.`)) return;
    try {
      await produccionApi.revertirDosificacion(ordenId, d.id);
      notify.success('Echada revertida');
      // Invalidar lotes para refrescar disponibles
      setLotesByProd(prev => { const cp = { ...prev }; delete cp[d.producto_id]; return cp; });
      await cargar();
      onChange?.();
    } catch (e: any) {
      notify.error(e?.response?.data?.error ?? 'Error al revertir');
    }
  };

  const dosifPorProducto = (productoId: string) => dosificaciones.filter(d => d.producto_id === productoId);

  if (!ordenId) return null;

  return (
    <Modal
      open={!!ordenId}
      onClose={onClose}
      title={`Dosificación parcial · ${numero}`}
      subtitle={ordenInactiva ? `Orden ${estado} — sólo lectura` : 'Registra cada echada de materia prima. Descuenta stock al instante.'}
      maxWidth="max-w-3xl"
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <SpinnerColaBlanca />
        </div>
      ) : (
        <div className="space-y-3 p-3 sm:p-4">
          {items.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">Sin ingredientes en la receta.</p>
          )}

          {items.map((item) => {
            const pct = item.planificado > 0 ? Math.min(100, (item.echado / item.planificado) * 100) : 0;
            const completo = item.pendiente <= 0.001;
            const echadasItem = dosifPorProducto(item.producto_id);
            const editing = activeIng === item.producto_id;

            return (
              <div
                key={item.ingrediente_id}
                className={clsx(
                  'rounded-xl border bg-white p-3 transition-colors',
                  completo ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200',
                  editing && 'ring-2 ring-loga-red/50 border-loga-red/40'
                )}
              >
                {/* Cabecera ingrediente */}
                <div className="flex items-start gap-2">
                  <div className={clsx(
                    'shrink-0 mt-0.5 h-7 w-7 rounded-full flex items-center justify-center',
                    item.es_aditivo ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                  )}>
                    {item.es_aditivo ? <FlaskConical size={14} /> : <Droplet size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.nombre}</p>
                      <span className="text-[10px] font-mono text-gray-400">{item.codigo}</span>
                      {item.subcategoria_mp && (
                        <span className="text-[10px] rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{item.subcategoria_mp}</span>
                      )}
                      {item.es_aditivo && (
                        <span className="text-[10px] rounded px-1.5 py-0.5 bg-purple-100 text-purple-700 font-medium">Aditivo</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 tabular-nums">
                      Plan: <b className="text-gray-700">{item.planificado.toFixed(3)} {item.unidad_medida}</b>
                      <span className="mx-1.5">·</span>
                      Echado: <b className={completo ? 'text-emerald-600' : 'text-gray-700'}>{item.echado.toFixed(3)}</b>
                      <span className="mx-1.5">·</span>
                      Pte: <b className={completo ? 'text-emerald-600' : 'text-loga-red'}>{item.pendiente.toFixed(3)}</b>
                      <span className="mx-1.5 text-gray-300">|</span>
                      Stock: <span className="text-gray-500">{item.stock_actual.toFixed(1)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => (editing ? setActiveIng(null) : abrirEchada(item))}
                    disabled={ordenInactiva || completo}
                    className={clsx(
                      'shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
                      ordenInactiva || completo
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : editing
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-loga-red text-white hover:bg-loga-red-dark'
                    )}
                  >
                    <Plus size={13} />
                    {completo ? 'Completo' : editing ? 'Cancelar' : 'Echar'}
                  </button>
                </div>

                {/* Barra progreso */}
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={clsx('h-full transition-all', completo ? 'bg-emerald-500' : 'bg-loga-red')}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Inline form añadir echada */}
                {editing && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Cantidad ({item.unidad_medida})</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={cant}
                          onChange={(e) => setCant(e.target.value)}
                          autoFocus
                          className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-loga-red/50"
                        />
                        <div className="mt-1 flex gap-1 text-[10px]">
                          {[25, 50, 75, 100].map(pct => {
                            const v = (item.pendiente * pct / 100);
                            return (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setCant(v.toFixed(3))}
                                className="rounded px-1.5 py-0.5 bg-white border border-gray-200 text-gray-600 hover:border-loga-red hover:text-loga-red"
                              >
                                {pct}% pte ({v.toFixed(2)})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Lote (opcional, FIFO si vacío)</label>
                        <select
                          value={loteSel}
                          onChange={(e) => setLoteSel(e.target.value)}
                          className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-loga-red/50"
                        >
                          <option value="">— FIFO (caducidad) —</option>
                          {(lotesByProd[item.producto_id] ?? []).map(l => (
                            <option key={l.id} value={l.id}>
                              {l.lote_interno} · {parseFloat(l.cantidad_actual).toFixed(2)} {item.unidad_medida}
                              {l.fecha_caducidad ? ` · cad ${l.fecha_caducidad}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Notas (opcional)"
                      value={notas}
                      onChange={(e) => setNotas(e.target.value)}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-loga-red/50"
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => setActiveIng(null)}
                        disabled={posting}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={guardarEchada}
                        disabled={posting}
                        className="inline-flex items-center gap-1 rounded-md bg-loga-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-loga-red-dark disabled:opacity-50"
                      >
                        {posting ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                        Registrar echada
                      </button>
                    </div>
                  </div>
                )}

                {/* Historial de echadas previas para esta MP */}
                {echadasItem.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {echadasItem.map(d => (
                      <div key={d.id} className="flex items-center gap-2 text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1">
                        <span className="font-mono tabular-nums text-gray-700">
                          {parseFloat(d.cantidad).toFixed(3)} {d.unidad_medida}
                        </span>
                        {d.lote_interno && <span className="text-gray-400">· lote {d.lote_interno}</span>}
                        <span className="text-gray-400">· {new Date(d.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        {d.operario_nombre && <span className="text-gray-400">· {d.operario_nombre}</span>}
                        {d.notas && <span className="italic text-gray-400 truncate">"{d.notas}"</span>}
                        {!ordenInactiva && (
                          <button
                            onClick={() => revertir(d)}
                            className="ml-auto text-loga-red hover:bg-red-50 rounded p-0.5"
                            title="Revertir esta echada"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
