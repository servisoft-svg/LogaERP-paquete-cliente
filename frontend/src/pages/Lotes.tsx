import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, Layers, Calendar, MapPin, GitBranch, X } from 'lucide-react';
import Paginacion from '../components/Paginacion';
import { lotesApi, productosApi } from '../api/client';
import type { Lote, EstadoLote, Producto } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { TANQUE_COLORES } from '../components/TanqueBadge';
import Modal from '../components/Modal';
import { FormField, Input, Select, Textarea } from '../components/FormField';
import clsx from 'clsx';

const ESTADO_CFG: Record<EstadoLote, { label: string; cls: string }> = {
  aprobado:   { label: 'Aprobado',   cls: 'bg-emerald-100 text-emerald-700' },
  cuarentena: { label: 'Cuarentena', cls: 'bg-amber-100 text-amber-700'     },
  rechazado:  { label: 'Rechazado',  cls: 'bg-red-100 text-loga-red'        },
};

interface FormLote {
  producto_id:     string;
  lote_proveedor:  string;
  cantidad:        string;
  fecha_fabricacion: string;
  fecha_caducidad: string;
  ubicacion:       string;
  observaciones:   string;
  tanque:          number | null;
  // Valores físico-químicos medidos del lote
  solidos:    string;
  ph:         string;
  viscosidad: string;
}

interface TrazabilidadItem {
  tipo: string;
  cantidad: string;
  created_at: string;
  numero_orden: string | null;
  estado: string | null;
  producto_nombre: string;
  producto_codigo: string;
}

const EMPTY_FORM: FormLote = {
  producto_id: '', lote_proveedor: '', cantidad: '',
  fecha_fabricacion: '', fecha_caducidad: '', ubicacion: '', observaciones: '',
  tanque: null,
  solidos: '', ph: '', viscosidad: '',
};

export default function Lotes() {
  const [lotes, setLotes]         = useState<Lote[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busqueda, setBusqueda]   = useState('');
  const [filtroEstado] = useState<EstadoLote | ''>('');
  const [filtroTipoProd, setFiltroTipoProd] = useState<'' | 'materia_prima' | 'producto_fabricado' | 'producto_terminado' | 'producto_envasado' | 'material_embalaje'>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState<FormLote>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [errorForm, setErrorForm] = useState('');
  const [paginaLote, setPaginaLote] = useState(1);
  const POR_PAGINA_LOTE = 50;
  const [trazaLote, setTrazaLote]         = useState<Lote | null>(null);
  const [trazaData, setTrazaData]         = useState<TrazabilidadItem[]>([]);
  const [trazaOrdenes, setTrazaOrdenes]   = useState<Record<string, any>>({});
  const [ordenesExpandidas, setOrdenesExpandidas] = useState<Set<string>>(new Set());
  const toggleOrden = (id: string) => setOrdenesExpandidas(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [trazaLoading, setTrazaLoading]   = useState(false);
  const [historialEstado, setHistorialEstado] = useState<{
    revisor: { nombre: string; rol: string; revisado_at: string; motivo: string } | null;
    cambios: { id: string; accion: string; motivo: string | null; created_at: string; usuario_nombre: string | null; usuario_rol: string | null }[];
  } | null>(null);
  const trazaRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (busqueda)     params.busqueda = busqueda;
      if (filtroEstado) params.estado   = filtroEstado;
      const [lotRes, prodRes] = await Promise.all([
        lotesApi.listar(params),
        productosApi.listar({ activo: true }),
      ]);
      setLotes(lotRes.data as Lote[]);
      setProductos(prodRes.data as Producto[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [busqueda, filtroEstado]);

  useEffect(() => {
    setPaginaLote(1);
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [cargar]);

  // abrirNuevo eliminado — los lotes se crean automáticamente al recibir stock.

  const handleCrear = async () => {
    if (!form.producto_id || !form.cantidad || Number(form.cantidad) <= 0) {
      setErrorForm('Producto y cantidad son obligatorios');
      return;
    }
    setSaving(true);
    setErrorForm('');
    try {
      await lotesApi.crear({
        producto_id:       form.producto_id,
        lote_proveedor:    form.lote_proveedor || null,
        cantidad:          Number(form.cantidad),
        fecha_fabricacion: form.fecha_fabricacion || null,
        fecha_caducidad:   form.fecha_caducidad   || null,
        ubicacion:         form.ubicacion          || null,
        observaciones:     form.observaciones      || null,
        tanque:            form.tanque,
        solidos:    form.solidos    !== '' ? Number(form.solidos)    : null,
        ph:         form.ph         !== '' ? Number(form.ph)         : null,
        viscosidad: form.viscosidad !== '' ? Number(form.viscosidad) : null,
      });
      setModalOpen(false);
      cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorForm(msg ?? 'Error al crear el lote');
    } finally {
      setSaving(false);
    }
  };

  // cambiarEstado eliminado — flujo de cuarentena/rechazo no se usa.

  const verTrazabilidad = async (lote: Lote) => {
    setTrazaLote(lote);
    setTrazaLoading(true);
    setHistorialEstado(null);
    try {
      const [trazaRes, histRes] = await Promise.all([
        lotesApi.trazabilidad(lote.id),
        lotesApi.historialEstado(lote.id).catch(() => null),
      ]);
      // Backend ahora devuelve {moves, ordenes}. Compatibilidad con respuesta legacy (array).
      const raw = trazaRes.data as any;
      const moves = Array.isArray(raw) ? raw : (raw?.moves ?? []);
      const ords = Array.isArray(raw) ? {} : (raw?.ordenes ?? {});
      setTrazaData(moves as TrazabilidadItem[]);
      setTrazaOrdenes(ords);
      // Por defecto, expandir todas las órdenes mencionadas
      const ids = new Set<string>();
      for (const m of moves) if ((m as any).orden_id && ords[(m as any).orden_id]) ids.add((m as any).orden_id);
      setOrdenesExpandidas(ids);
      if (histRes) {
        setHistorialEstado(histRes.data as typeof historialEstado);
      }
      setTimeout(() => trazaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch {
      setTrazaData([]);
    } finally {
      setTrazaLoading(false);
    }
  };

  const esProximoCaducar = (fecha?: string) => {
    if (!fecha) return false;
    const diff = new Date(fecha).getTime() - Date.now();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  };

  const productoSeleccionado = productos.find((p) => p.id === form.producto_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Gestión de Lotes</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {lotes.length} lote{lotes.length !== 1 ? 's' : ''} · Orden FIFO (caducidad → entrada)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Búsqueda */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar lote…"
              className="pl-8 w-full sm:w-44"
            />
          </div>

          {/* Filtro por tipo de producto */}
          <div className="flex items-center gap-1 flex-wrap">
            <Filter size={13} className="text-gray-400" />
            {([
              { v: '',                    label: 'Todos' },
              { v: 'materia_prima',       label: 'MP' },
              { v: 'producto_fabricado',  label: 'Fabricado' },
              { v: 'producto_envasado',   label: 'Envasado' },
              { v: 'material_embalaje',   label: 'Embalaje' },
            ] as const).map(({ v, label }) => (
              <button key={v} onClick={() => setFiltroTipoProd(v as typeof filtroTipoProd)}
                className={clsx('rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                  filtroTipoProd === v
                    ? 'bg-loga-red text-white'
                    : 'border border-gray-200 text-gray-600 hover:border-gray-300 bg-white')}>
                {label}
              </button>
            ))}
          </div>

          {/* Botón "Nuevo lote" eliminado — los lotes se crean automáticamente al recibir stock. */}
        </div>
      </div>

      {/* Grid de lotes */}
      {lotes.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-gray-300">
          <Layers size={48} className="mb-3" />
          <p className="text-sm text-gray-400">No hay lotes que mostrar</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lotes
            .filter(lote => !filtroTipoProd || (lote as any).producto_tipo === filtroTipoProd)
            .slice((paginaLote - 1) * POR_PAGINA_LOTE, paginaLote * POR_PAGINA_LOTE).map((lote, i) => {
            const caducaCerca = esProximoCaducar(lote.fecha_caducidad);
            const cfg = ESTADO_CFG[lote.estado];
            const cantActual  = parseFloat(lote.cantidad_actual);
            const cantInicial = parseFloat(lote.cantidad_inicial);
            const pct = cantInicial > 0 ? (cantActual / cantInicial) * 100 : 0;

            return (
              <motion.div
                key={lote.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={clsx(
                  'rounded-xl border bg-white p-5 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow',
                  caducaCerca && lote.estado === 'aprobado' ? 'border-amber-300' : 'border-gray-100'
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono font-semibold text-gray-900 truncate">{lote.lote_interno}</p>
                    {lote.lote_proveedor && (
                      <p className="text-[10px] text-gray-400 truncate">Prov: {lote.lote_proveedor}</p>
                    )}
                  </div>
                  <span className={clsx('shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5', cfg.cls)}>
                    {cfg.label}
                  </span>
                </div>

                {/* Producto */}
                <div className="text-xs font-medium text-gray-700 truncate">
                  {lote.producto_codigo} — {lote.producto_nombre}
                </div>

                {/* Cantidad */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Restante</span>
                    <span className="font-semibold text-gray-900 tabular-nums">
                      {cantActual.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      <span className="ml-1 font-normal text-gray-400">{lote.unidad_medida}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <motion.div
                      className={clsx(
                        'h-full rounded-full',
                        pct < 20 ? 'bg-loga-red' : pct < 50 ? 'bg-amber-400' : 'bg-emerald-500'
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, pct)}%` }}
                      transition={{ delay: i * 0.04 + 0.2, duration: 0.5 }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 text-right">
                    {pct.toFixed(0)}% del inicial ({cantInicial.toLocaleString('es-ES', { maximumFractionDigits: 2 })})
                  </p>
                </div>

                {/* Metadatos */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-400">
                  {lote.fecha_caducidad && (
                    <span className={clsx('flex items-center gap-1', caducaCerca ? 'text-amber-600 font-medium' : '')}>
                      <Calendar size={10} />
                      {caducaCerca && '⚠ '}Cad: {new Date(lote.fecha_caducidad).toLocaleDateString('es-ES')}
                    </span>
                  )}
                  {lote.ubicacion && (
                    <span className="flex items-center gap-1">
                      <MapPin size={10} /> {lote.ubicacion}
                    </span>
                  )}
                </div>

                {/* Tanque físico — solo muestra el chip del tanque asignado. Click
                    abre selector inline. Antes mostrábamos los 4 (T1/T2/T3/T4)
                    siempre, lo cual era ruidoso y confuso: cada lote solo está en
                    uno (o en ninguno). */}
                <div className="flex items-center flex-wrap gap-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">Tanque:</span>
                  {lote.tanque == null ? (
                    <details className="relative">
                      <summary className="list-none cursor-pointer rounded-md border border-dashed border-gray-300 px-2 py-1 text-[10px] font-medium text-gray-500 hover:border-gray-500 hover:bg-gray-50">
                        Asignar tanque…
                      </summary>
                      <div className="absolute z-20 mt-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                        {[1, 2, 3, 4].map(n => {
                          const c = TANQUE_COLORES[n];
                          return (
                            <button
                              key={n}
                              onClick={async () => {
                                try {
                                  await lotesApi.actualizar(lote.id, { tanque: n });
                                  setLotes(prev => prev.map(l => l.id === lote.id ? { ...l, tanque: n } : l));
                                } catch { /* */ }
                              }}
                              title={`Asignar a tanque ${n}`}
                              className={clsx('rounded-md w-8 h-8 text-[11px] font-black tabular-nums transition-all', c.bg, c.text, `hover:ring-2 hover:${c.ring}`)}
                            >T{n}</button>
                          );
                        })}
                      </div>
                    </details>
                  ) : (() => {
                    const c = TANQUE_COLORES[lote.tanque];
                    return (
                      <details className="relative">
                        <summary className={clsx('list-none cursor-pointer rounded-md w-8 h-8 flex items-center justify-center text-[11px] font-black tabular-nums shadow-sm ring-2', c.bg, c.text, c.ring)}>
                          T{lote.tanque}
                        </summary>
                        <div className="absolute z-20 mt-1 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                          {[1, 2, 3, 4].filter(n => n !== lote.tanque).map(n => {
                            const cc = TANQUE_COLORES[n];
                            return (
                              <button
                                key={n}
                                onClick={async () => {
                                  try {
                                    await lotesApi.actualizar(lote.id, { tanque: n });
                                    setLotes(prev => prev.map(l => l.id === lote.id ? { ...l, tanque: n } : l));
                                  } catch { /* */ }
                                }}
                                title={`Mover a tanque ${n}`}
                                className={clsx('rounded-md w-8 h-8 text-[11px] font-black tabular-nums transition-all', cc.bg, cc.text, `hover:ring-2 hover:${cc.ring}`)}
                              >T{n}</button>
                            );
                          })}
                          <button
                            onClick={async () => {
                              try {
                                await lotesApi.actualizar(lote.id, { tanque: null });
                                setLotes(prev => prev.map(l => l.id === lote.id ? { ...l, tanque: null } : l));
                              } catch { /* */ }
                            }}
                            title="Quitar del tanque"
                            className="rounded-md w-8 h-8 text-[11px] font-bold text-gray-500 border border-gray-200 hover:border-loga-red hover:text-loga-red transition-colors"
                          >×</button>
                        </div>
                      </details>
                    );
                  })()}
                </div>

                {/* Acciones de cambio de estado quitadas — el flujo no usa cuarentena/rechazo */}

                {/* Trazabilidad */}
                <button
                  onClick={() => verTrazabilidad(lote)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <GitBranch size={11} /> Trazabilidad
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {(() => {
        const lotesVisibles = lotes.filter(l => !filtroTipoProd || (l as any).producto_tipo === filtroTipoProd);
        return <Paginacion pagina={paginaLote} totalPaginas={Math.ceil(lotesVisibles.length / POR_PAGINA_LOTE)} onChange={setPaginaLote} totalItems={lotesVisibles.length} porPagina={POR_PAGINA_LOTE} />;
      })()}

      {/* Panel trazabilidad */}
      {trazaLote && (
        <motion.div
          ref={trazaRef}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-md space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <GitBranch size={14} className="text-loga-red" />
                Trazabilidad: {trazaLote.lote_interno}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {trazaLote.producto_codigo} — {trazaLote.producto_nombre}
              </p>
            </div>
            <button
              onClick={() => setTrazaLote(null)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Historial de estado: revisor + motivo + cambios auditoría */}
          {historialEstado && (historialEstado.revisor || historialEstado.cambios.length > 0) && (
            <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-4 mb-3">
              <h4 className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                Historial de estado
              </h4>

              {/* Bloque revisor (lote aprobado tras cuarentena) */}
              {historialEstado.revisor && (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 mb-3">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">
                    ✓ Aprobado tras revisión QC
                  </p>
                  <p className="text-xs text-emerald-900 italic font-medium leading-relaxed mb-2">
                    "{historialEstado.revisor.motivo}"
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-emerald-800">
                    <span>
                      Por <b>{historialEstado.revisor.nombre}</b>
                      {historialEstado.revisor.rol === 'admin' && <span className="ml-1 inline-block rounded bg-emerald-200 px-1 text-[9px]">admin</span>}
                    </span>
                    <span>·</span>
                    <span>{new Date(historialEstado.revisor.revisado_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              )}

              {/* Timeline de todos los cambios */}
              {historialEstado.cambios.length > 0 && (
                <ol className="space-y-2">
                  {historialEstado.cambios.map((c) => {
                    const fmt = (a: string) => a === 'CAMBIO_ESTADO_LOTE' ? 'Cambio de estado'
                      : a === 'ENTRADA_STOCK' ? 'Entrada de stock'
                      : a === 'MODIFICAR_LOTE' ? 'Modificación de cantidad'
                      : a;
                    const colorAccion = c.accion === 'CAMBIO_ESTADO_LOTE' ? 'bg-amber-100 text-amber-800'
                      : c.accion === 'ENTRADA_STOCK' ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600';
                    return (
                      <li key={c.id} className="flex gap-2.5 text-xs">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            <span className={clsx('inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', colorAccion)}>
                              {fmt(c.accion)}
                            </span>
                            <span className="text-[10px] text-gray-500 tabular-nums">
                              {new Date(c.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {c.usuario_nombre && (
                              <span className="text-[10px] text-gray-500">
                                · por <b className="text-gray-700">{c.usuario_nombre}</b>
                                {c.usuario_rol === 'admin' && <span className="ml-0.5 text-[9px] text-amber-600">(admin)</span>}
                              </span>
                            )}
                          </div>
                          {c.motivo && (
                            <p className="text-gray-700 italic leading-snug pl-1 border-l-2 border-amber-200">
                              "{c.motivo}"
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {trazaLoading ? (
            <div className="flex justify-center py-8">
              <SpinnerColaBlanca size="sm" />
            </div>
          ) : trazaData.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              No hay movimientos registrados para este lote
            </p>
          ) : (
            <div className="rounded-lg border border-gray-100 overflow-hidden overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {['Tipo', 'Cantidad', 'Producto', 'Orden', 'Estado Orden', 'Fecha'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {trazaData.map((mov, idx) => {
                    const ordenId = (mov as any).orden_id;
                    const orden = ordenId ? trazaOrdenes[ordenId] : null;
                    const isExpanded = ordenId ? ordenesExpandidas.has(ordenId) : false;
                    return (
                      <React.Fragment key={idx}>
                        <tr className={clsx('transition-colors',
                          orden ? 'cursor-pointer hover:bg-blue-50/40' : 'hover:bg-gray-50')}
                          onClick={() => { if (orden && ordenId) toggleOrden(ordenId); }}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {/* Chevron a la izquierda */}
                              {orden && (
                                <span className="text-[10px] text-blue-600 w-3 inline-block shrink-0">{isExpanded ? '▼' : '▶'}</span>
                              )}
                              {!orden && <span className="w-3 inline-block shrink-0" />}
                              <span className={clsx(
                                'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                                mov.tipo === 'consumo' ? 'bg-red-50 text-loga-red' :
                                mov.tipo === 'produccion' ? 'bg-emerald-50 text-emerald-700' :
                                'bg-gray-100 text-gray-600'
                              )}>
                                {mov.tipo}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums font-medium text-gray-900">
                            {parseFloat(mov.cantidad).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {mov.producto_codigo} — {mov.producto_nombre}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-500">
                            {mov.numero_orden ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{mov.estado ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-400">
                            {new Date(mov.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                        {isExpanded && orden && (
                          <tr className="bg-blue-50/30">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="space-y-2.5">
                                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-blue-100 pb-1.5">
                                  <div>
                                    <p className="font-mono text-xs font-bold text-gray-900">{orden.numero_orden}</p>
                                    <p className="text-[10px] text-gray-500">
                                      {orden.producto_codigo} — {orden.producto_nombre}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[10px] text-gray-500">Operario</p>
                                    <p className="text-xs font-bold text-gray-900">{orden.operario_nombre ?? '—'}
                                      {orden.operario_rol && <span className="text-[10px] text-gray-400 font-normal"> ({orden.operario_rol})</span>}
                                    </p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                                  <Stat label="Cantidad real" value={orden.cantidad_real_producida ? `${parseFloat(orden.cantidad_real_producida).toLocaleString('es-ES', { maximumFractionDigits: 2 })}` : '—'} />
                                  <Stat label="Cantidad plan" value={orden.cantidad_planificada ? `${parseFloat(orden.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })}` : '—'} />
                                  <Stat label="Duración" value={orden.duracion_segundos ? formatDur(orden.duracion_segundos) : '—'} />
                                  <Stat label="Fecha fin" value={orden.fecha_fin ? new Date(orden.fecha_fin).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} />
                                </div>
                                {(orden.ph || orden.solidos || orden.viscosidad) && (
                                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                                    {orden.ph && <Stat label="pH" value={orden.ph} accent="purple" />}
                                    {orden.solidos && <Stat label="Sólidos %" value={orden.solidos} accent="amber" />}
                                    {orden.viscosidad && <Stat label="Viscosidad" value={orden.viscosidad} accent="cyan" />}
                                  </div>
                                )}
                                {(orden.consumos ?? []).length > 0 && (
                                  <div>
                                    <p className="text-[9px] uppercase tracking-wider font-bold text-blue-700 mb-1">
                                      Ingredientes consumidos ({orden.consumos.length})
                                    </p>
                                    <div className="rounded-md border border-blue-100 overflow-hidden">
                                      <table className="w-full text-[10px]">
                                        <thead className="bg-blue-50/50 text-gray-500">
                                          <tr>
                                            <th className="text-left py-1 px-2 font-medium">Producto</th>
                                            <th className="text-left py-1 px-2 font-medium">Lote</th>
                                            <th className="text-right py-1 px-2 font-medium">Cantidad</th>
                                            <th className="text-right py-1 px-2 font-medium">Precio</th>
                                            <th className="text-right py-1 px-2 font-medium">Coste</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-blue-50">
                                          {orden.consumos.map((c: any, ci: number) => {
                                            const qty = Math.abs(parseFloat(c.cantidad));
                                            const pre = parseFloat(c.precio_unitario ?? '0');
                                            return (
                                              <tr key={ci} className="hover:bg-white">
                                                <td className="py-0.5 px-2 text-gray-900">{c.producto_nombre} <span className="text-gray-400 font-mono">{c.producto_codigo}</span></td>
                                                <td className="py-0.5 px-2 font-mono text-gray-600">{c.lote_interno ?? '—'}</td>
                                                <td className="py-0.5 px-2 text-right tabular-nums">{qty.toLocaleString('es-ES', { maximumFractionDigits: 3 })} <span className="text-gray-400">{c.unidad_medida}</span></td>
                                                <td className="py-0.5 px-2 text-right tabular-nums text-gray-500">{pre > 0 ? `${pre.toFixed(4)} €` : '—'}</td>
                                                <td className="py-0.5 px-2 text-right tabular-nums font-semibold text-gray-900">{pre > 0 ? `${(qty * pre).toFixed(2)} €` : '—'}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Modal crear lote */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo Lote"
        subtitle="El lote entrará en estado Cuarentena hasta que sea aprobado"
      >
        <div className="space-y-4">
          <FormField label="Producto" required>
            <Select
              value={form.producto_id}
              onChange={(e) => setForm((f) => ({ ...f, producto_id: e.target.value }))}
            >
              <option value="">— Seleccionar producto —</option>
              <optgroup label="Materias Primas">
                {productos.filter((p) => p.tipo === 'materia_prima').map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                ))}
              </optgroup>
              <optgroup label="Productos Terminados">
                {productos.filter((p) => p.tipo === 'producto_terminado').map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                ))}
              </optgroup>
              <optgroup label="Material de Embalaje">
                {productos.filter((p) => p.tipo === 'material_embalaje').map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                ))}
              </optgroup>
            </Select>
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label={`Cantidad (${productoSeleccionado?.unidad_medida ?? 'ud'})`} required>
              <Input
                type="number" min="0.001" step="0.001"
                value={form.cantidad}
                onChange={(e) => setForm((f) => ({ ...f, cantidad: e.target.value }))}
                placeholder="0.000"
              />
            </FormField>
            <FormField label="Lote proveedor (ref.)">
              <Input
                value={form.lote_proveedor}
                onChange={(e) => setForm((f) => ({ ...f, lote_proveedor: e.target.value }))}
                placeholder="REF-PROVEEDOR-001"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Fecha de fabricación">
              <Input
                type="date"
                value={form.fecha_fabricacion}
                onChange={(e) => setForm((f) => ({ ...f, fecha_fabricacion: e.target.value }))}
              />
            </FormField>
            <FormField label="Fecha de caducidad">
              <Input
                type="date"
                value={form.fecha_caducidad}
                onChange={(e) => setForm((f) => ({ ...f, fecha_caducidad: e.target.value }))}
              />
            </FormField>
          </div>

          <FormField label="Ubicación en almacén">
            <Input
              value={form.ubicacion}
              onChange={(e) => setForm((f) => ({ ...f, ubicacion: e.target.value }))}
              placeholder="Estante A-03, Cámara 2…"
            />
          </FormField>

          <FormField label="Tanque físico" hint="Asigna tanque 1–4 si el lote ocupa uno. Opcional.">
            <div className="flex flex-wrap items-center gap-1.5">
              {[1, 2, 3, 4].map(n => {
                const activo = form.tanque === n;
                const c = TANQUE_COLORES[n];
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, tanque: activo ? null : n }))}
                    className={
                      activo
                        ? `rounded-lg ${c.bg} ${c.text} ring-2 ${c.ring} w-11 h-11 font-black text-sm shadow-md tabular-nums`
                        : 'rounded-lg bg-white text-gray-500 border border-gray-200 hover:border-gray-400 w-11 h-11 font-bold text-sm transition-all tabular-nums'
                    }
                  >T{n}</button>
                );
              })}
              {form.tanque != null && (
                <button type="button" onClick={() => setForm(f => ({ ...f, tanque: null }))}
                  className="ml-1 text-[10px] text-gray-400 hover:text-loga-red">Sin tanque</button>
              )}
            </div>
          </FormField>

          {/* ── Valores físico-químicos medidos del lote ── */}
          {(() => {
            const prod = productos.find(p => p.id === form.producto_id) as any;
            // Solo mostrar si el producto tiene al menos una spec definida
            const hasAnySpec = prod && (
              prod.solidos_min != null || prod.solidos_max != null ||
              prod.ph_min != null || prod.ph_max != null ||
              prod.viscosidad_min != null || prod.viscosidad_max != null
            );
            if (!hasAnySpec) return null;

            const rangeStr = (min: any, max: any, unit = '') => {
              if (min == null && max == null) return null;
              const fmt = (v: any) => v != null ? parseFloat(v).toString() : '?';
              return `Rango: ${fmt(min)}–${fmt(max)}${unit}`;
            };
            const checkOk = (val: string, min: any, max: any): boolean | null => {
              if (val === '') return null;
              const n = Number(val);
              if (isNaN(n)) return null;
              if (min != null && n < parseFloat(min)) return false;
              if (max != null && n > parseFloat(max)) return false;
              return true;
            };
            const okSolidos = checkOk(form.solidos, prod.solidos_min, prod.solidos_max);
            const okPh      = checkOk(form.ph, prod.ph_min, prod.ph_max);
            const okVisc    = checkOk(form.viscosidad, prod.viscosidad_min, prod.viscosidad_max);

            return (
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
                <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Valores medidos del lote</p>

                {(prod.solidos_min != null || prod.solidos_max != null) && (
                  <FormField label="% Sólidos" hint={rangeStr(prod.solidos_min, prod.solidos_max, ' %') ?? undefined}>
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.01"
                        value={form.solidos}
                        onChange={(e) => setForm((f) => ({ ...f, solidos: e.target.value }))}
                        placeholder="Ej: 49.50"
                      />
                      {okSolidos === false && <span className="text-xs text-loga-red font-semibold">Fuera de rango ⚠</span>}
                      {okSolidos === true  && <span className="text-xs text-emerald-600 font-semibold">OK ✓</span>}
                    </div>
                  </FormField>
                )}

                {(prod.ph_min != null || prod.ph_max != null) && (
                  <FormField label="pH" hint={rangeStr(prod.ph_min, prod.ph_max) ?? undefined}>
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.01"
                        value={form.ph}
                        onChange={(e) => setForm((f) => ({ ...f, ph: e.target.value }))}
                        placeholder="Ej: 6.5"
                      />
                      {okPh === false && <span className="text-xs text-loga-red font-semibold">Fuera de rango ⚠</span>}
                      {okPh === true  && <span className="text-xs text-emerald-600 font-semibold">OK ✓</span>}
                    </div>
                  </FormField>
                )}

                {(prod.viscosidad_min != null || prod.viscosidad_max != null) && (
                  <FormField label="Viscosidad (cP)" hint={rangeStr(prod.viscosidad_min, prod.viscosidad_max, ' cP') ?? undefined}>
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.01"
                        value={form.viscosidad}
                        onChange={(e) => setForm((f) => ({ ...f, viscosidad: e.target.value }))}
                        placeholder="Ej: 1200"
                      />
                      {okVisc === false && <span className="text-xs text-loga-red font-semibold">Fuera de rango ⚠</span>}
                      {okVisc === true  && <span className="text-xs text-emerald-600 font-semibold">OK ✓</span>}
                    </div>
                  </FormField>
                )}
              </div>
            );
          })()}

          <FormField label="Observaciones">
            <Textarea
              rows={2}
              value={form.observaciones}
              onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))}
              placeholder="Notas de inspección, condiciones de entrega…"
            />
          </FormField>

          {errorForm && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
              {errorForm}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCrear}
              disabled={saving}
              className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors"
            >
              {saving ? 'Creando…' : 'Crear Lote'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: 'purple' | 'amber' | 'cyan' }) {
  const accentCls = accent === 'purple' ? 'text-purple-700 bg-purple-50'
    : accent === 'amber' ? 'text-amber-700 bg-amber-50'
    : accent === 'cyan' ? 'text-cyan-700 bg-cyan-50'
    : 'text-gray-700 bg-white';
  return (
    <div className={clsx('rounded border px-1.5 py-1', accentCls, accent ? 'border-transparent' : 'border-gray-100')}>
      <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500">{label}</p>
      <p className="text-[11px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

function formatDur(seg: number): string {
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}m ${seg % 60}s`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}
