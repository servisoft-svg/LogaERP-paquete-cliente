/**
 * Historial de actividad · auditoría con filtros, búsqueda y agrupación por OF/pedido.
 * Se usa dentro de la página de Configuración como una sección autónoma — gestiona
 * su propio estado y fetching.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { History, Search, X, Filter, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { configuracionApi } from '../api/client';

interface AuditEntry {
  id: string;
  fecha: string;
  accion: string;
  tabla_afectada: string | null;
  registro_id: string | null;
  motivo: string | null;
  usuario_nombre: string | null;
  usuario_rol?: string | null;
}

interface AccionAgg { accion: string; total: number }

// Mapeo accion → color + categoría visible.
const ACCION_META: Record<string, { color: string; bg: string; cat: string; label?: string }> = {
  CREAR_PEDIDO:              { color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',       cat: 'Pedidos', label: 'Crear pedido' },
  CANCELAR_PEDIDO:           { color: 'text-loga-red',    bg: 'bg-red-50 border-red-200',         cat: 'Pedidos', label: 'Cancelar pedido' },
  CAMBIO_ESTADO_PEDIDO:      { color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-200',   cat: 'Pedidos', label: 'Cambio estado pedido' },
  CONSUMIR_PEDIDO:           { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Pedidos', label: 'Consumir stock' },
  ENVIO_EMAIL_PEDIDO:        { color: 'text-violet-700',  bg: 'bg-violet-50 border-violet-200',   cat: 'Pedidos', label: 'Email pedido' },
  PEDIDO_STOCK:              { color: 'text-cyan-700',    bg: 'bg-cyan-50 border-cyan-200',       cat: 'Stock', label: 'Pedido a proveedor' },
  CREAR_ORDEN:               { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     cat: 'Producción', label: 'Crear OF' },
  CONFIRMAR_PRODUCCION:      { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Producción', label: 'Confirmar OF' },
  ELIMINAR_ORDEN_PRODUCCION: { color: 'text-loga-red',    bg: 'bg-red-50 border-red-200',         cat: 'Producción', label: 'Eliminar OF' },
  REVERTIR_ORDEN_PRODUCCION: { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   cat: 'Producción', label: 'Revertir OF' },
  FIRMA_REVISION_OF:         { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Producción', label: 'Firma revisión OF' },
  ECHAR_INGREDIENTE:         { color: 'text-amber-800',   bg: 'bg-amber-100 border-amber-300',    cat: 'Producción', label: 'Echar ingrediente' },
  REVERTIR_ECHADA:           { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   cat: 'Producción', label: 'Revertir echada' },
  ENVASADO_EJECUTADO:        { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Producción', label: 'Envasado ejecutado' },
  ENTRADA_STOCK:             { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Stock', label: 'Entrada stock' },
  MODIFICAR_LOTE:            { color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',       cat: 'Stock', label: 'Modificar lote' },
  CAMBIO_ESTADO_LOTE:        { color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-200',   cat: 'Stock', label: 'Cambio estado lote' },
  CREAR_CLIENTE:             { color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',       cat: 'Clientes', label: 'Crear cliente' },
  ARCHIVAR_CLIENTE:          { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     cat: 'Clientes', label: 'Archivar cliente' },
  RECUPERAR_CLIENTE:         { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Clientes', label: 'Recuperar cliente' },
  CAMBIO_PRECIO:             { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     cat: 'Productos', label: 'Cambio precio' },
  ELIMINAR_PRODUCTO:         { color: 'text-loga-red',    bg: 'bg-red-50 border-red-200',         cat: 'Productos', label: 'Eliminar producto' },
  CAMBIAR_CONFIGURACION:     { color: 'text-gray-700',    bg: 'bg-gray-100 border-gray-200',      cat: 'Sistema', label: 'Cambiar config.' },
  BACKUP_MANUAL:             { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', cat: 'Sistema', label: 'Backup' },
  RESTORE_BACKUP:            { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   cat: 'Sistema', label: 'Restore' },
};
const meta = (accion: string) => ACCION_META[accion] ?? { color: 'text-gray-700', bg: 'bg-gray-100 border-gray-200', cat: 'Otros', label: accion };

// Rangos rápidos de fecha
const RANGOS = [
  { id: 'all', label: 'Todo' },
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
] as const;

function rangoToISOs(id: string): { desde?: string; hasta?: string } {
  if (id === 'all') return {};
  const now = new Date();
  if (id === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { desde: start.toISOString() };
  }
  if (id === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { desde: start.toISOString() };
  }
  if (id === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { desde: start.toISOString() };
  }
  return {};
}

// Extrae el número de OF/pedido del motivo (p.ej. "OP-2026-00092 · ..." → "OP-2026-00092").
function extraerNumero(motivo: string | null): string | null {
  if (!motivo) return null;
  const m = motivo.match(/\b((?:OP|PED|OC|EM)-\d{4}-\d{4,6})\b/);
  return m ? m[1] : null;
}

export default function HistorialActividad() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acciones, setAcciones] = useState<AccionAgg[]>([]);

  // Filtros
  const [q, setQ] = useState('');
  const [rango, setRango] = useState<string>('all');
  const [accionesSel, setAccionesSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [filtroOF, setFiltroOF] = useState<string | null>(null); // cuando se hace click en una fila con OF

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { desde, hasta } = rangoToISOs(rango);
      const params: Record<string, string | number | undefined> = {
        q: q.trim() || undefined,
        accion: accionesSel.size > 0 ? Array.from(accionesSel).join(',') : undefined,
        desde, hasta, limit,
      };
      // Filtro por OF: se hace en cliente porque la BD solo guarda el número en `motivo`
      const { data } = await configuracionApi.auditoria(params);
      let rows = data as AuditEntry[];
      if (filtroOF) {
        rows = rows.filter(r => (r.motivo ?? '').includes(filtroOF));
      }
      setEntries(rows);
    } catch {
      setEntries([]);
    } finally { setLoading(false); }
  }, [q, rango, accionesSel, limit, filtroOF]);

  useEffect(() => { cargar(); }, [cargar]);

  // Cargar lista de acciones únicas (chips) una sola vez
  useEffect(() => {
    configuracionApi.auditoriaAcciones()
      .then(({ data }) => setAcciones(data as AccionAgg[]))
      .catch(() => setAcciones([]));
  }, []);

  // Acciones agrupadas por categoría para los chips
  const accionesPorCat = useMemo(() => {
    const map = new Map<string, AccionAgg[]>();
    for (const a of acciones) {
      const cat = meta(a.accion).cat;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(a);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [acciones]);

  const toggleAccion = (a: string) => {
    setAccionesSel(prev => {
      const s = new Set(prev);
      if (s.has(a)) s.delete(a); else s.add(a);
      return s;
    });
  };

  const hayFiltros = q.trim() || rango !== 'all' || accionesSel.size > 0 || filtroOF;
  const limpiar = () => { setQ(''); setRango('all'); setAccionesSel(new Set()); setFiltroOF(null); };

  return (
    <section id="historial" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-100/60 to-transparent">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
          <History size={15} />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-800">Historial de actividad</h2>
          <p className="text-[11px] text-gray-400">
            Registro inalterable de todas las acciones del ERP · busca por texto, OF o pedido para ver su línea de tiempo
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
          {loading ? '…' : `${entries.length} de ${limit}`}
        </span>
      </div>

      {/* Filtros */}
      <div className="px-5 py-3 border-b border-gray-100 space-y-3 bg-gray-50/40">
        {/* Búsqueda + fecha + límite */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar: OF, pedido, usuario, cliente, producto…"
              className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-7 py-1.5 text-[11px] outline-none focus:border-loga-red transition-colors"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-loga-red">
                <X size={11} />
              </button>
            )}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {RANGOS.map(r => (
              <button
                key={r.id}
                onClick={() => setRango(r.id)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors flex items-center gap-1',
                  rango === r.id ? 'bg-loga-red text-white' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {r.id === 'today' && <Calendar size={9} />}
                {r.label}
              </button>
            ))}
          </div>
          <select
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value, 10))}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-loga-red"
          >
            {[50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {hayFiltros && (
            <button
              type="button"
              onClick={limpiar}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-gray-500 hover:text-loga-red hover:border-loga-red transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Chip OF activa */}
        {filtroOF && (
          <div className="inline-flex items-center gap-2 rounded-lg bg-loga-red/10 border border-loga-red/30 px-3 py-1.5 text-[11px]">
            <Filter size={11} className="text-loga-red" />
            <span className="text-loga-red font-bold">Línea de tiempo de {filtroOF}</span>
            <button onClick={() => setFiltroOF(null)} className="text-loga-red hover:text-loga-red-dark">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Chips por acción agrupados por categoría */}
        {accionesPorCat.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Filtrar por acción</p>
            <div className="flex flex-wrap gap-1.5">
              {accionesPorCat.map(([cat, lista]) => (
                <div key={cat} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
                  <span className="px-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-wider">{cat}</span>
                  {lista.map(a => {
                    const m = meta(a.accion);
                    const activa = accionesSel.has(a.accion);
                    return (
                      <button
                        key={a.accion}
                        onClick={() => toggleAccion(a.accion)}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors border',
                          activa
                            ? `${m.bg} ${m.color} border-current shadow-sm`
                            : 'border-transparent text-gray-500 hover:bg-gray-50'
                        )}
                      >
                        {m.label}
                        <span className={clsx('text-[8px] tabular-nums', activa ? 'opacity-80' : 'opacity-50')}>{a.total}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="px-5 py-12 text-center text-xs text-gray-400">Cargando…</div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <History size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-xs text-gray-400">{hayFiltros ? 'Sin coincidencias con los filtros aplicados.' : 'No hay entradas de auditoría.'}</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="bg-gray-50/60 sticky top-0 z-10">
              <tr>
                {['Fecha', 'Usuario', 'Acción', 'Detalle'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map((a, i) => {
                const m = meta(a.accion);
                const numero = extraerNumero(a.motivo);
                return (
                  <tr key={a.id ?? i} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap font-mono text-[11px]">
                      {new Date(a.fecha).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-700">
                      {a.usuario_nombre ?? 'Sistema'}
                      {a.usuario_rol && <span className="ml-1 text-[9px] text-gray-400 uppercase">{a.usuario_rol}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx('inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', m.bg, m.color)}>
                        {m.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      <p className="leading-snug">{a.motivo || <span className="text-gray-300">—</span>}</p>
                      {numero && !filtroOF && (
                        <button
                          type="button"
                          onClick={() => setFiltroOF(numero)}
                          className="mt-0.5 text-[10px] text-loga-red hover:underline font-bold"
                        >
                          Ver línea de tiempo de {numero} →
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
