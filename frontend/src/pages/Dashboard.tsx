import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Factory, CheckCircle, Check,
  TrendingDown, CalendarClock, Play,
  ChevronLeft, ChevronRight, Package,
  ShoppingBag, Clock, Sparkles, Mail, X, Trash2,
} from 'lucide-react';
import { stockApi, produccionApi, pedidosApi, configuracionApi, finanzasApi } from '../api/client';
import type { Producto, OrdenProduccion, Notificacion, Pedido } from '../types';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import clsx from 'clsx';

interface BackupStatus {
  fecha: string;
  ok: boolean;
  filename?: string;
  size?: string;
  local?: boolean;
  icloud?: boolean;
  drive?: boolean;
  error?: string;
  driveError?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [productos, setProductos]       = useState<Producto[]>([]);
  const [ordenes, setOrdenes]           = useState<OrdenProduccion[]>([]);
  const [notifs, setNotifs]             = useState<Notificacion[]>([]);
  const [pedidos, setPedidos]           = useState<Pedido[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [emailSugerido, setEmailSugerido] = useState<{ to: string; cliente: string; producto: string; cantidad: number; unidad: string; rango: string } | null>(null);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailExito, setEmailExito] = useState(false);
  const [predicciones, setPredicciones] = useState<{
    cliente_nombre: string; cliente_email: string; cliente_nivel: string;
    producto_nombre: string; producto_codigo: string; unidad_medida: string;
    num_pedidos: number; cantidad_media: number; dias_intervalo: number;
    ultimo_pedido: string; fecha_estimada: string; fecha_rango: string; dias_restantes: number;
    probabilidad: string; urgente: boolean; vencido: boolean;
  }[]>([]);
  const [loading, setLoading]           = useState(true);

  // Calendar + recordatorios
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [recordatorios, setRecordatorios] = useState<{ id: string; fecha: string; titulo: string; descripcion?: string; color: string }[]>([]);
  const [nuevoRec, setNuevoRec] = useState<{ fecha: string; titulo: string; color: string } | null>(null);
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [calFiltros, setCalFiltros] = useState<Set<string>>(() => {
    try { const saved = localStorage.getItem('loga_cal_filtros'); return saved ? new Set(JSON.parse(saved)) : new Set(['pendientes', 'completadas', 'recordatorios']); } catch { return new Set(['pendientes', 'completadas', 'recordatorios']); }
  });
  const [dragItem, setDragItem] = useState<{ id: string; tipo: 'orden' | 'recordatorio' } | null>(null);

  // Persistir filtros
  useEffect(() => {
    localStorage.setItem('loga_cal_filtros', JSON.stringify([...calFiltros]));
  }, [calFiltros]);

  const toggleFiltro = (f: string) => {
    const next = new Set(calFiltros);
    if (f === 'todo') {
      // Todo = activar todos
      ['pendientes', 'completadas', 'recordatorios', 'predicciones'].forEach(x => next.add(x));
    } else if (next.has(f)) {
      next.delete(f);
    } else {
      next.add(f);
    }
    setCalFiltros(next);
  };

  const cargarDatos = useCallback(async () => {
    try {
      const mesActual = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}`;
      const [prodRes, ordRes, notifRes, pedRes] = await Promise.all([
        stockApi.listarProductos(),
        produccionApi.dashboard(mesActual),
        stockApi.notificaciones(false),
        pedidosApi.listar({ limit: '30' }).catch(() => ({ data: [] })),
      ]);
      setProductos(prodRes.data as Producto[]);
      setOrdenes(ordRes.data as OrdenProduccion[]);
      setNotifs(notifRes.data as Notificacion[]);
      setPedidos(pedRes.data as Pedido[]);
      // Backup status + predicciones (solo admin)
      try {
        const bkRes = await configuracionApi.backupStatus();
        setBackupStatus(bkRes.data as BackupStatus);
      } catch { /* no admin */ }
      try {
        const predRes = await finanzasApi.predicciones();
        setPredicciones(predRes.data as typeof predicciones);
      } catch { /* no admin */ }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // Recargar órdenes + recordatorios cuando cambia el mes
  useEffect(() => {
    const mes = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}`;
    produccionApi.dashboard(mes).then(res => setOrdenes(res.data as OrdenProduccion[])).catch(() => {});
    produccionApi.recordatorios(mes).then(res => setRecordatorios(res.data as typeof recordatorios)).catch(() => {});
  }, [calMonth]);

  // Browser notifications
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted' && notifs.length > 0) {
      const uniqueNotifs = Array.from(new Map(notifs.map(n => [n.producto_id, n])).values());
      const notifiedKey = 'loga_notified_' + uniqueNotifs.map(n => n.id).sort().join(',');
      if (sessionStorage.getItem(notifiedKey)) return;
      sessionStorage.setItem(notifiedKey, '1');
      new Notification('Colas Loga - Stock Bajo', {
        body: uniqueNotifs.length + ' producto' + (uniqueNotifs.length > 1 ? 's' : '') + ' con stock bajo',
        icon: '/colas-loga.png',
        tag: 'stock-alert',
      });
    }
  }, [notifs]);

  // Stats
  const hoy = new Date().toISOString().split('T')[0];
  const alertas = productos.filter(p => p.alerta_activa).length;
  const pendientes = ordenes.filter(o => ['borrador', 'confirmada'].includes(o.estado)).length;
  const completadas = ordenes.filter(o => o.estado === 'completada').length;

  // Production chart - last 7 days
  const last7Days = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayOrds = ordenes.filter(o => o.estado === 'completada' && o.fecha_fin?.startsWith(dateStr));
      const kg = dayOrds.reduce((s, o) => s + parseFloat(o.cantidad_producida || '0'), 0);
      days.push({ label: d.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 2), kg, count: dayOrds.length });
    }
    return days;
  }, [ordenes]);
  const maxKg = Math.max(...last7Days.map(d => d.kg), 1);

  // Upcoming fabrications (today + future, not completed/cancelled)
  const proximas = useMemo(() =>
    ordenes.filter(o =>
      ['borrador', 'confirmada', 'en_proceso'].includes(o.estado) &&
      o.fecha_planificada && new Date(o.fecha_planificada).toLocaleDateString('en-CA') >= hoy
    ).sort((a, b) => (a.fecha_planificada ?? '').localeCompare(b.fecha_planificada ?? '')).slice(0, 6),
  [ordenes, hoy]);

  // Calendar data
  const calDays = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=dom
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1; // lunes=0

    const cells: { day: number; dateStr: string; ordenes: OrdenProduccion[] }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: 0, dateStr: '', ordenes: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOrds = ordenes.filter(o => {
        if (o.estado === 'cancelada') return false;
        const raw = o.fecha_planificada ?? o.created_at;
        if (!raw) return false;
        const fecha = new Date(raw).toLocaleDateString('en-CA'); // YYYY-MM-DD local
        return fecha === dateStr;
      });
      cells.push({ day: d, dateStr, ordenes: dayOrds });
    }
    return cells;
  }, [calMonth, ordenes]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* KPI Cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Productos', value: productos.length, icon: Package, color: 'text-gray-700', bg: 'bg-gray-100' },
          { label: 'Stock bajo', value: alertas, icon: TrendingDown, color: alertas > 0 ? 'text-loga-red' : 'text-gray-400', bg: alertas > 0 ? 'bg-red-100' : 'bg-gray-100' },
          { label: 'Pendientes', value: pendientes, icon: Factory, color: pendientes > 0 ? 'text-amber-600' : 'text-gray-400', bg: pendientes > 0 ? 'bg-amber-100' : 'bg-gray-100' },
          { label: 'Completadas', value: completadas, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <div className={clsx('rounded-lg p-2', bg)}><Icon size={16} className={color} /></div>
            </div>
            <p className={clsx('mt-3 text-3xl font-bold tabular-nums', color)}>{value}</p>
          </motion.div>
        ))}
      </section>

      {/* Production chart */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Produccion - Ultimos 7 dias</h2>
        <div className="flex items-end gap-2 h-28">
          {last7Days.map((day) => {
            const pct = maxKg > 0 ? (day.kg / maxKg) * 100 : 0;
            return (
              <div key={day.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-500 font-mono">{day.kg > 0 ? Math.round(day.kg) : ''}</span>
                <div className="w-full bg-gray-100 rounded-t-lg relative" style={{ height: '80px' }}>
                  <div className="absolute bottom-0 left-0 right-0 bg-loga-red rounded-t-lg transition-all duration-500" style={{ height: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-gray-400">{day.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Alerta backup */}
      {isAdmin && backupStatus && !backupStatus.ok && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-loga-red/30 bg-red-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-loga-red text-lg">!</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-loga-red">Error en backup</p>
              <p className="text-xs text-red-400">{backupStatus.error} — {new Date(backupStatus.fecha).toLocaleString('es-ES')}</p>
            </div>
            <a href="/configuracion" className="shrink-0 rounded-lg bg-loga-red px-3 py-1.5 text-xs font-semibold text-white">Ver config</a>
          </div>
        </motion.div>
      )}
      {isAdmin && backupStatus && backupStatus.ok && !backupStatus.drive && backupStatus.driveError && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-amber-300/40 bg-amber-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-700">Backup local OK, pero Drive fallo</p>
              <p className="text-xs text-amber-500">{backupStatus.driveError}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Alerts: stock + caducidad */}
      {(() => {
        const stockNotifs = notifs.filter(n => n.tipo !== 'caducidad');
        const uniqueStock = Array.from(new Map(stockNotifs.map(n => [n.producto_id, n])).values());
        const caducidadNotifs = notifs.filter(n => n.tipo === 'caducidad');
        return (
          <>
            {uniqueStock.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-loga-red/20 bg-red-50 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <TrendingDown size={18} className="text-loga-red mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-loga-red">{uniqueStock.length} producto{uniqueStock.length > 1 ? 's' : ''} con stock bajo</p>
                      <p className="text-xs text-red-400 mt-0.5">{uniqueStock.map(n => n.producto_nombre).join(', ')}</p>
                    </div>
                  </div>
                  <a href="/productos" className="shrink-0 rounded-lg bg-loga-red px-3 py-2 text-xs font-semibold text-white hover:bg-loga-red-dark transition-colors">Reponer stock</a>
                </div>
              </motion.div>
            )}
            {caducidadNotifs.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-amber-300/40 bg-amber-50 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-700">{caducidadNotifs.length} lote{caducidadNotifs.length > 1 ? 's' : ''} proximos a caducar</p>
                      <ul className="text-xs text-amber-600 mt-1 space-y-0.5">{caducidadNotifs.map(n => <li key={n.id}>{n.mensaje}</li>)}</ul>
                    </div>
                  </div>
                  <a href="/lotes" className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 transition-colors">Ver lotes</a>
                </div>
              </motion.div>
            )}
          </>
        );
      })()}

      {/* Calendario de produccion */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft size={16} className="text-gray-500" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900 capitalize">
            {calMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        </div>
        {/* Filtros — multiselección, se mantienen */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-50 overflow-x-auto">
          <button onClick={() => toggleFiltro('todo')}
            className={clsx('rounded-md px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors',
              calFiltros.size >= 4 ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100'
            )}>Todo</button>
          {([
            { v: 'pendientes', l: 'Pendientes' },
            { v: 'completadas', l: 'Completadas' },
            { v: 'recordatorios', l: 'Recordatorios' },
            { v: 'predicciones', l: 'Predicciones' },
          ]).map(f => (
            <button key={f.v} onClick={() => toggleFiltro(f.v)}
              className={clsx('rounded-md px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors',
                calFiltros.has(f.v) ? 'bg-loga-red text-white' : 'text-gray-500 hover:bg-gray-100'
              )}>{f.l}</button>
          ))}
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] font-medium text-gray-400 uppercase border-b border-gray-100 py-2">
          {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(d => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {calDays.map((cell, i) => {
            const isToday = cell.dateStr === hoy;
            const isSelected = cell.dateStr === diaSeleccionado;
            const dayRecs = recordatorios.filter(r => r.fecha === cell.dateStr);
            const dayOrds = cell.ordenes.filter(o => {
              if (o.estado === 'completada') return calFiltros.has('completadas');
              return calFiltros.has('pendientes');
            });
            const totalItems = dayRecs.length + dayOrds.length;

            return (
              <div key={i}
                onClick={() => cell.day > 0 && setDiaSeleccionado(isSelected ? null : cell.dateStr)}
                onDragOver={cell.day > 0 ? (e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-100'); } : undefined}
                onDragLeave={cell.day > 0 ? (e) => { e.currentTarget.classList.remove('bg-blue-100'); } : undefined}
                onDrop={cell.day > 0 ? async (e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('bg-blue-100');
                  const mes = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}`;
                  if (dragItem?.tipo === 'orden') {
                    try {
                      await produccionApi.editar(dragItem.id, { fecha_planificada: cell.dateStr });
                      const res = await produccionApi.dashboard(mes);
                      setOrdenes(res.data as OrdenProduccion[]);
                    } catch {}
                  } else if (dragItem?.tipo === 'recordatorio') {
                    try {
                      await produccionApi.moverRecordatorio(dragItem.id, cell.dateStr);
                      const res = await produccionApi.recordatorios(mes);
                      setRecordatorios(res.data as typeof recordatorios);
                    } catch {}
                  }
                  setDragItem(null);
                } : undefined}
                className={clsx(
                  'min-h-[70px] sm:min-h-[90px] border-b border-r border-gray-50 p-1 cursor-pointer transition-all',
                  cell.day === 0 && 'bg-gray-50/50 cursor-default',
                  isToday && 'bg-red-50/40',
                  isSelected && 'ring-2 ring-inset ring-loga-red bg-red-50/20',
                  !isSelected && cell.day > 0 && 'hover:bg-blue-50/30',
                )}>
                {cell.day > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className={clsx('text-[11px] font-medium', isToday ? 'text-loga-red font-bold' : 'text-gray-500')}>{cell.day}</p>
                      {totalItems > 0 && <span className="w-4 h-4 rounded-full bg-gray-200 text-[8px] font-bold text-gray-600 flex items-center justify-center">{totalItems}</span>}
                    </div>
                    {/* Recordatorios */}
                    {calFiltros.has('recordatorios') && dayRecs.slice(0, 1).map(r => (
                      <div key={r.id}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragItem({ id: r.id, tipo: 'recordatorio' }); }}
                        className={clsx('rounded px-1 py-0.5 mb-0.5 text-[9px] font-medium truncate cursor-grab active:cursor-grabbing leading-tight',
                        r.color === 'red' ? 'bg-red-100 text-red-700' : r.color === 'green' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                      )}>📌 {r.titulo}</div>
                    ))}
                    {/* Predicciones */}
                    {calFiltros.has('predicciones') && predicciones
                      .filter(p => p.dias_restantes > 0 && p.fecha_estimada === cell.dateStr)
                      .slice(0, 2).map((p, pi) => (
                      <div key={`pred-${pi}`} className="rounded px-1 py-0.5 mb-0.5 text-[8px] font-medium truncate bg-purple-50 text-purple-600 border border-purple-200 leading-tight" title={`${p.cliente_nombre} pedirá ${p.cantidad_media} ${p.unidad_medida} de ${p.producto_nombre}`}>
                        {p.cliente_nombre?.split(' ')[0]} · {p.cantidad_media}{p.unidad_medida}
                      </div>
                    ))}
                    {/* Órdenes */}
                    {dayOrds.slice(0, 2).map(o => (
                      <div key={o.id}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragItem({ id: o.id, tipo: 'orden' }); }}
                        className={clsx('rounded px-1 py-0.5 mb-0.5 text-[9px] font-medium truncate cursor-grab active:cursor-grabbing transition-colors leading-tight',
                          o.estado === 'completada' ? 'bg-emerald-100 text-emerald-700' : ['borrador','confirmada'].includes(o.estado) ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        )}
                      >
                        {o.tipo_orden === 'envasado' ? 'ENV' : 'FAB'} {parseFloat(o.cantidad_planificada).toFixed(0)}{o.tipo_orden === 'envasado' ? 'ud' : 'kg'} {o.receta_nombre?.split(' ')[0]}
                      </div>
                    ))}
                    {(dayOrds.length + dayRecs.length) > 3 && <p className="text-[8px] text-gray-400 text-center">+{dayOrds.length + dayRecs.length - 3}</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Panel detalle del día seleccionado */}
      {diaSeleccionado && (() => {
        const dayRecs = recordatorios.filter(r => r.fecha === diaSeleccionado);
        const dayOrds = ordenes.filter(o => {
          const raw = o.fecha_planificada ?? o.created_at;
          return raw && new Date(raw).toLocaleDateString('en-CA') === diaSeleccionado;
        });
        const fechaLabel = new Date(diaSeleccionado + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
        return (
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border-2 border-loga-red/20 bg-white shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 capitalize">{fechaLabel}</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setNuevoRec({ fecha: diaSeleccionado, titulo: '', color: 'indigo' })}
                  className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors">+ Recordatorio</button>
                <button onClick={() => setDiaSeleccionado(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            </div>

            {dayRecs.length === 0 && dayOrds.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">Sin actividad este día</p>
            )}

            {dayRecs.map(r => (
              <div key={r.id} className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 border',
                r.color === 'red' ? 'border-red-200 bg-red-50' : r.color === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50'
              )}>
                <span className="text-sm">📌</span>
                <span className="text-xs font-semibold text-gray-800 flex-1">{r.titulo}</span>
                <button onClick={() => { produccionApi.eliminarRecordatorio(r.id).then(() => setRecordatorios(prev => prev.filter(x => x.id !== r.id))); }}
                  className="text-gray-400 hover:text-loga-red"><Trash2 size={12} /></button>
              </div>
            ))}

            {dayOrds.map(o => (
              <div key={o.id} onClick={() => navigate(o.estado === 'completada' ? `/produccion?detalle_id=${o.id}` : `/produccion?orden_id=${o.id}`)}
                className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 border cursor-pointer hover:shadow-sm transition-all',
                  o.estado === 'completada' ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
                )}>
                <div className={clsx('w-2 h-8 rounded-full shrink-0',
                  o.estado === 'completada' ? 'bg-emerald-500' : 'bg-amber-500'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={clsx('rounded px-1 py-0.5 text-[8px] font-bold uppercase',
                      o.tipo_orden === 'envasado' ? 'bg-emerald-600 text-white' : 'bg-loga-red text-white'
                    )}>{o.tipo_orden === 'envasado' ? 'Envasado' : 'Fabricacion'}</span>
                    <p className="text-xs font-bold text-gray-900 truncate">{o.receta_nombre ?? o.formato_label ?? ''}</p>
                  </div>
                  <p className="text-[10px] text-gray-500">{o.numero_orden} · {parseFloat(o.cantidad_planificada).toLocaleString('es-ES')} {o.tipo_orden === 'envasado' ? 'ud' : 'kg'}{o.cliente ? ` · ${o.cliente}` : ''}</p>
                </div>
                <span className={clsx('rounded-md px-1.5 py-0.5 text-[9px] font-bold',
                  o.estado === 'completada' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                )}>{o.estado}</span>
              </div>
            ))}
          </motion.section>
        );
      })()}

      {/* Predicciones de demanda */}
      {predicciones.length > 0 && (
        <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-indigo-100">
            <Sparkles size={16} className="text-indigo-500" />
            <div>
              <h2 className="text-sm font-bold text-gray-900">Predicción de demanda</h2>
              <p className="text-[10px] text-gray-400">Basado en patrones de compra recurrentes</p>
            </div>
            <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
              {predicciones.filter(p => p.urgente || p.vencido).length} alertas
            </span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
            {[...predicciones]
              .filter(p => p.urgente || p.vencido)
              .sort((a, b) => {
                // Próximos primero (dias_restantes > 0), luego vencidos por menos antiguos
                if (a.dias_restantes > 0 && b.dias_restantes <= 0) return -1;
                if (a.dias_restantes <= 0 && b.dias_restantes > 0) return 1;
                return a.dias_restantes - b.dias_restantes;
              })
              .slice(0, 10).map((pred, i) => (
              <motion.div
                key={`${pred.cliente_nombre}-${pred.producto_codigo}-${i}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={clsx(
                  'px-5 py-3 hover:bg-indigo-50/50 transition-colors',
                  pred.vencido && 'bg-red-50/30'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{pred.cliente_nombre}</p>
                      {pred.cliente_nivel === 'oro' && <span className="rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-1.5 py-0.5 text-[7px] font-black text-white">ORO</span>}
                      {pred.cliente_nivel === 'plata' && <span className="rounded-full bg-gradient-to-r from-gray-300 to-gray-400 px-1.5 py-0.5 text-[7px] font-black text-white">PLATA</span>}
                      {pred.cliente_nivel === 'bronce' && <span className="rounded-full bg-gradient-to-r from-amber-600 to-orange-700 px-1.5 py-0.5 text-[7px] font-black text-white">BRONCE</span>}
                      <span className={clsx(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                        pred.probabilidad === 'alta' ? 'bg-emerald-100 text-emerald-700' :
                        pred.probabilidad === 'media' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-500'
                      )}>
                        {pred.probabilidad === 'alta' ? 'Muy probable' : pred.probabilidad === 'media' ? 'Probable' : 'Posible'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Suele pedir <b className="text-gray-800">{pred.cantidad_media.toLocaleString('es-ES')} {pred.unidad_medida}</b> de <b className="text-indigo-600">{pred.producto_nombre}</b> cada <b>{pred.dias_intervalo} días</b>
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {pred.num_pedidos} pedidos anteriores · Último: {new Date(pred.ultimo_pedido).toLocaleDateString('es-ES')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={clsx(
                      'text-sm font-black tabular-nums',
                      pred.vencido ? 'text-loga-red' : pred.dias_restantes <= 7 ? 'text-amber-600' : 'text-indigo-600'
                    )}>
                      {pred.vencido ? `Hace ${Math.abs(pred.dias_restantes)}d` : `En ${pred.dias_restantes}d`}
                    </p>
                    <p className="text-[10px] text-gray-400">{pred.fecha_rango}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {pred.cliente_email && (
                    <button
                      onClick={() => setEmailSugerido({
                        to: pred.cliente_email, cliente: pred.cliente_nombre,
                        producto: pred.producto_nombre, cantidad: pred.cantidad_media,
                        unidad: pred.unidad_medida, rango: pred.fecha_rango,
                      })}
                      className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <Mail size={9} /> Sugerir pedido
                    </button>
                  )}
                  <button
                    onClick={() => {
                      navigate(`/produccion?producto=${encodeURIComponent(pred.producto_nombre)}&cantidad=${pred.cantidad_media}&unidad=${pred.unidad_medida}&cliente=${encodeURIComponent(pred.cliente_nombre)}`);
                    }}
                    className="flex items-center gap-1 rounded-md bg-loga-red/10 px-2 py-0.5 text-[10px] font-medium text-loga-red hover:bg-loga-red/20 transition-colors"
                  >
                    <Factory size={9} /> Fabricar
                  </button>
                  <button
                    onClick={() => navigate(`/productos?check=${encodeURIComponent(pred.producto_nombre)}&cantidad=${pred.cantidad_media}&unidad=${pred.unidad_medida}&cliente=${encodeURIComponent(pred.cliente_nombre)}`)}
                    className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-100 transition-colors"
                  >
                    <Package size={9} /> Ver stock
                  </button>
                </div>
              </motion.div>
            ))}
            {predicciones.filter(p => !p.urgente && !p.vencido).length > 0 && (
              <div className="px-5 py-2 bg-gray-50/50">
                <p className="text-[10px] text-gray-400">
                  +{predicciones.filter(p => !p.urgente && !p.vencido).length} predicciones a más de 60 días
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Proximas fabricaciones */}
      {proximas.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock size={16} className="text-loga-red" />
            <h2 className="text-base font-semibold text-gray-900">Proximas fabricaciones</h2>
            <span className="text-xs font-medium bg-loga-red text-white rounded-full px-2 py-0.5">{proximas.length}</span>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {proximas.map(o => (
              <motion.div key={o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-400">{o.numero_orden}</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{o.receta_nombre ?? '—'}</p>
                    {o.cliente && <p className="text-xs text-loga-red font-medium">{o.cliente}</p>}
                  </div>
                  <EstadoBadge estado={o.estado} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-800 tabular-nums">
                      {parseFloat(o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      <span className="ml-1 text-xs font-normal text-gray-400">kg</span>
                    </p>
                    <p className="text-[11px] text-gray-400">{o.fecha_planificada ? new Date(o.fecha_planificada).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/produccion?orden_id=${o.id}`)}
                    className="flex items-center gap-1.5 rounded-lg bg-loga-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
                  >
                    <Play size={11} /> Fabricar
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Pedidos recientes */}
      {(() => {
        const pedidosActivos = pedidos.filter(p => p.estado !== 'cancelado').slice(0, 6);
        if (pedidosActivos.length === 0) return null;
        const nuevos = pedidosActivos.filter(p => p.estado === 'nuevo').length;
        return (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} className="text-blue-600" />
                <h2 className="text-base font-semibold text-gray-900">Pedidos</h2>
                {nuevos > 0 && <span className="text-xs font-medium bg-blue-600 text-white rounded-full px-2 py-0.5">{nuevos} nuevos</span>}
              </div>
              <a href="/pedidos" className="text-xs text-blue-600 hover:underline">Ver todos</a>
            </div>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {pedidosActivos.map(p => (
                <div key={p.id} className={clsx(
                  'rounded-xl border p-3 space-y-1.5',
                  p.estado === 'nuevo' ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-gray-400">{p.numero_pedido}</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.cliente_nombre_rel ?? p.cliente_nombre ?? p.cliente_email ?? 'Sin cliente'}</p>
                    </div>
                    <PedidoBadge estado={p.estado} />
                  </div>
                  <p className="text-xs text-gray-600 truncate">
                    {p.producto_nombre_rel ?? p.producto_nombre ?? 'Producto por asignar'}
                    {p.cantidad && <span className="ml-1 font-semibold">{parseFloat(p.cantidad).toLocaleString('es-ES')} {p.unidad_medida ?? 'kg'}</span>}
                  </p>
                  {p.fecha_entrega && (
                    <div className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Clock size={10} />
                      Entrega: {new Date(p.fecha_entrega).toLocaleDateString('es-ES')}
                    </div>
                  )}
                  {p.origen === 'email' && (
                    <span className="inline-block text-[9px] font-medium bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">via email</span>
                  )}
                  {p.estado === 'nuevo' && (
                    <button
                      onClick={async () => {
                        await pedidosApi.editar(p.id, { estado: 'confirmado' });
                        cargarDatos();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      <Check size={12} /> Confirmar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Ultimas ordenes */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Ultimas ordenes</h2>
        <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['N Orden', 'Receta', 'Cliente', 'Cantidad', 'Estado', 'Fecha'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {ordenes.slice(0, 10).map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/produccion?orden_id=${o.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{o.numero_orden}</td>
                  <td className="px-4 py-3 text-gray-900 text-xs">{o.receta_nombre ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{o.cliente ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-600 text-xs">
                    {parseFloat(o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg
                  </td>
                  <td className="px-4 py-3"><EstadoBadge estado={o.estado} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {o.fecha_planificada ? new Date(o.fecha_planificada).toLocaleDateString('es-ES') : new Date(o.created_at).toLocaleDateString('es-ES')}
                  </td>
                </tr>
              ))}
              {ordenes.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">No hay ordenes</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal crear recordatorio */}
      {nuevoRec && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNuevoRec(null)} />
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900">Nuevo recordatorio — {new Date(nuevoRec.fecha + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</h3>
            <input value={nuevoRec.titulo} onChange={e => setNuevoRec({ ...nuevoRec, titulo: e.target.value })} placeholder="¿Qué quieres recordar?" autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 outline-none" />
            <div className="flex gap-2">
              {(['indigo', 'red', 'green'] as const).map(c => (
                <button key={c} onClick={() => setNuevoRec({ ...nuevoRec, color: c })}
                  className={clsx('w-6 h-6 rounded-full border-2 transition-all',
                    c === 'indigo' ? 'bg-indigo-500' : c === 'red' ? 'bg-red-500' : 'bg-emerald-500',
                    nuevoRec.color === c ? 'border-gray-900 scale-110' : 'border-transparent'
                  )} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setNuevoRec(null)} className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button disabled={!nuevoRec.titulo.trim()} onClick={async () => {
                try {
                  await produccionApi.crearRecordatorio(nuevoRec);
                  const mes = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}`;
                  const res = await produccionApi.recordatorios(mes);
                  setRecordatorios(res.data as typeof recordatorios);
                  setNuevoRec(null);
                } catch {}
              }} className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300 transition-colors">
                Guardar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal email sugerencia */}
      {emailSugerido && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setEmailSugerido(null); setEmailExito(false); }} />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-blue-600" />
              <h3 className="text-sm font-bold text-gray-900">Sugerir pedido por email</h3>
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-gray-500">Para: <b className="text-gray-800">{emailSugerido.to}</b></p>
              <p className="text-gray-500">Cliente: <b className="text-gray-800">{emailSugerido.cliente}</b></p>
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-gray-700 leading-relaxed">
                <p>Estimado/a {emailSugerido.cliente},</p>
                <br />
                <p>Según nuestro historial de colaboración, le sugerimos un nuevo pedido de:</p>
                <br />
                <p>• <b>Producto:</b> {emailSugerido.producto}</p>
                <p>• <b>Cantidad habitual:</b> {emailSugerido.cantidad.toLocaleString('es-ES')} {emailSugerido.unidad}</p>
                <p>• <b>Fecha estimada:</b> {emailSugerido.rango}</p>
                <br />
                <p>¿Le preparamos el pedido? Quedamos a su disposición.</p>
                <br />
                <p>Saludos cordiales,<br /><b>Colas Loga</b></p>
              </div>
            </div>
            {emailExito ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                <CheckCircle size={14} className="text-emerald-600" />
                <p className="text-xs font-semibold text-emerald-700">Email enviado correctamente</p>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => { setEmailSugerido(null); setEmailExito(false); }}
                  className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  disabled={enviandoEmail}
                  onClick={async () => {
                    setEnviandoEmail(true);
                    try {
                      await configuracionApi.enviarEmail({
                        to: emailSugerido.to,
                        subject: `Pedido sugerido — ${emailSugerido.producto}`,
                        body: `Estimado/a ${emailSugerido.cliente},\n\nSegún nuestro historial de colaboración, le sugerimos un nuevo pedido de:\n\n• Producto: ${emailSugerido.producto}\n• Cantidad habitual: ${emailSugerido.cantidad.toLocaleString('es-ES')} ${emailSugerido.unidad}\n• Fecha estimada: ${emailSugerido.rango}\n\n¿Le preparamos el pedido?\n\nSaludos,\nColas Loga`,
                      });
                      setEmailExito(true);
                      setTimeout(() => { setEmailSugerido(null); setEmailExito(false); }, 2000);
                    } catch { /* error */ }
                    finally { setEnviandoEmail(false); }
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                >
                  <Mail size={12} />
                  {enviandoEmail ? 'Enviando...' : 'Enviar email'}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: OrdenProduccion['estado'] }) {
  const cfg: Record<OrdenProduccion['estado'], { label: string; cls: string }> = {
    borrador:    { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700' },
    confirmada:  { label: 'Confirmada',  cls: 'bg-blue-100 text-blue-700' },
    en_proceso:  { label: 'En proceso',  cls: 'bg-amber-100 text-amber-700' },
    completada:  { label: 'Completada',  cls: 'bg-emerald-100 text-emerald-700' },
    cancelada:   { label: 'Cancelada',   cls: 'bg-red-100 text-loga-red' },
  };
  const { label, cls } = cfg[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>;
}

function PedidoBadge({ estado }: { estado: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    nuevo:          { label: 'Nuevo',         cls: 'bg-blue-100 text-blue-700' },
    confirmado:     { label: 'Confirmado',    cls: 'bg-amber-100 text-amber-700' },
    en_produccion:  { label: 'En produccion', cls: 'bg-purple-100 text-purple-700' },
    completado:     { label: 'Completado',    cls: 'bg-emerald-100 text-emerald-700' },
    cancelado:      { label: 'Cancelado',     cls: 'bg-red-100 text-loga-red' },
  };
  const { label, cls } = cfg[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{label}</span>;
}
