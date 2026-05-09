/**
 * Recuento de inventario — UI optimizada para tablet en planta.
 *
 * Layout:
 *   - Desktop/tablet (≥md): 2 columnas (lista 2/3 + calculadora sticky 1/3).
 *   - Móvil: lista en columna única + calculadora flotante (FAB → modal bottom).
 *
 * Flujo:
 *   1. Carga productos+lotes una vez (POST-mount).
 *   2. Operario busca/filtra producto, toca un campo "Contado" → ese lote queda
 *      activo (highlight). La calculadora se enlaza visualmente.
 *   3. Operario suma cantidades en la calculadora (M+, M-) y pulsa "Enviar al
 *      lote activo" → el resultado se vuelca al input.
 *   4. Calcular diferencias → revisar tabla → Aplicar.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Calculator as CalculatorIcon, Check, AlertTriangle,
  Search, Eye, EyeOff, ChevronDown, ChevronUp, X, Trash2, Wand2,
} from 'lucide-react';
import { productosApi, lotesApi } from '../api/client';
import type { Producto } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import CalculadoraRecuento from '../components/CalculadoraRecuento';
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

interface LoteActivo {
  productoIdx: number;
  loteIdx: number;
  lote_interno: string;
  producto_nombre: string;
  unidad: string;
}

const STORAGE_KEY = 'loga.recuento.borrador.v1';

/** Normaliza input: acepta coma o punto como decimal. Vacío → ''. */
function normalizarNumero(raw: string): string {
  if (!raw) return '';
  // Reemplazar coma por punto. Permitir solo dígitos, punto, signo - .
  const limpio = raw.replace(',', '.').replace(/[^\d.\-]/g, '');
  // Solo un punto
  const partes = limpio.split('.');
  if (partes.length > 2) return partes[0] + '.' + partes.slice(1).join('');
  return limpio;
}

export default function Recuento() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [datos, setDatos] = useState<ProductoConLotes[]>([]);
  const [diferencias, setDiferencias] = useState<Diferencia[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const [loteActivo, setLoteActivo] = useState<LoteActivo | null>(null);
  const [calcAbierta, setCalcAbierta] = useState(false); // móvil
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // 2 requests totales (antes N+1: 1 productos + N lotes por producto).
      // Sobre ngrok el flujo viejo daba 30s+ y saturaba el navegador. Ahora
      // se carga en 2 round-trips paralelos.
      const [prodRes, lotesRes] = await Promise.all([
        productosApi.listar({ activo: 'true' }),
        lotesApi.listar({ estado: 'aprobado' }),
      ]);
      const productos = prodRes.data as Producto[];
      const allLotes = lotesRes.data as { id: string; lote_interno: string; cantidad_actual: string; producto_id: string }[];

      // Agrupar lotes por producto_id en cliente.
      const lotesPorProducto = new Map<string, typeof allLotes>();
      for (const l of allLotes) {
        if (parseFloat(l.cantidad_actual) <= 0) continue;
        if (!lotesPorProducto.has(l.producto_id)) lotesPorProducto.set(l.producto_id, []);
        lotesPorProducto.get(l.producto_id)!.push(l);
      }

      const results: ProductoConLotes[] = [];
      for (const p of productos) {
        const lotesProd = lotesPorProducto.get(p.id) ?? [];
        if (lotesProd.length === 0) continue;
        results.push({
          producto: p,
          lotes: lotesProd.map(l => ({ ...l, cantidad_contada: '' })),
        });
      }

      // Restaurar borrador desde localStorage si existe (clave por lote_id).
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const draft = JSON.parse(raw) as Record<string, string>;
          for (const r of results) {
            for (const l of r.lotes) {
              if (draft[l.id] !== undefined) l.cantidad_contada = draft[l.id];
            }
          }
        }
      } catch { /* draft corrupto, ignora */ }

      setDatos(results);
      setDiferencias(null);
      setApplied(false);
    } catch {
      setError('Error al cargar productos y lotes');
    } finally {
      setLoading(false);
    }
  }, []);

  // Persistencia: cada vez que cambian los datos, guardar borrador en localStorage.
  // Solo el campo cantidad_contada de cada lote (clave: lote_id).
  useEffect(() => {
    if (loading || datos.length === 0) return;
    try {
      const draft: Record<string, string> = {};
      for (const r of datos) {
        for (const l of r.lotes) {
          if (l.cantidad_contada !== '') draft[l.id] = l.cantidad_contada;
        }
      }
      if (Object.keys(draft).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* QuotaExceeded u otro: ignora */ }
  }, [datos, loading]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Filtrado ──────────────────────────────────────────────────
  const datosFiltrados = useMemo(() => {
    let result = datos;
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      result = result.filter(d => {
        const nom = d.producto.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const cod = d.producto.codigo.toLowerCase();
        return nom.includes(q) || cod.includes(q);
      });
    }
    if (soloPendientes) {
      result = result.filter(d => d.lotes.some(l => l.cantidad_contada === ''));
    }
    return result;
  }, [datos, busqueda, soloPendientes]);

  // ── Estadísticas de progreso ─────────────────────────────────
  const stats = useMemo(() => {
    let totalLotes = 0;
    let contados = 0;
    let conDiferencia = 0;
    for (const d of datos) {
      for (const l of d.lotes) {
        totalLotes++;
        if (l.cantidad_contada !== '') {
          contados++;
          const diff = parseFloat(l.cantidad_contada) - parseFloat(l.cantidad_actual);
          if (!isNaN(diff) && Math.abs(diff) > 0.001) conDiferencia++;
        }
      }
    }
    return { totalLotes, contados, conDiferencia };
  }, [datos]);

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
    // Confirmación explícita: el usuario está sobreescribiendo el stock antiguo.
    const lineas = diferencias.slice(0, 5).map(d =>
      `• ${d.producto.nombre} (${d.lote.lote_interno}): ${d.sistema.toFixed(2)} → ${d.contado.toFixed(2)} ${d.producto.unidad_medida}`
    ).join('\n');
    const extra = diferencias.length > 5 ? `\n…y ${diferencias.length - 5} más` : '';
    const ok = confirm(
      `Vas a SUSTITUIR la cantidad antigua por la nueva en ${diferencias.length} lote${diferencias.length !== 1 ? 's' : ''}:\n\n${lineas}${extra}\n\nLa cantidad anterior se borra. Cada cambio queda registrado en stock_moves para auditoría. ¿Confirmas?`
    );
    if (!ok) return;

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
      // Limpiar borrador local — el conteo ya está aplicado en BD.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    } catch {
      setError('Error al aplicar cambios');
    } finally {
      setApplying(false);
    }
  };

  const updateContada = (productoIdx: number, loteIdx: number, value: string) => {
    const norm = normalizarNumero(value);
    setDatos(prev => {
      const copy = [...prev];
      const lotes = [...copy[productoIdx].lotes];
      lotes[loteIdx] = { ...lotes[loteIdx], cantidad_contada: norm };
      copy[productoIdx] = { ...copy[productoIdx], lotes };
      return copy;
    });
    setDiferencias(null);
    setApplied(false);
  };

  /** Borra todos los conteos (limpia localStorage también). */
  const borrarTodo = () => {
    if (!confirm('¿Borrar todas las cantidades contadas? Esta acción no se puede deshacer.')) return;
    setDatos(prev => prev.map(d => ({
      ...d,
      lotes: d.lotes.map(l => ({ ...l, cantidad_contada: '' })),
    })));
    setDiferencias(null);
    setApplied(false);
    setLoteActivo(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    notify.info('Recuento borrado', { description: 'Todas las cantidades contadas se han limpiado.' });
  };

  /** TEST: rellena todos los lotes con su cantidad actual del sistema.
   *  Útil para verificar que el flujo funciona (debería dar 0 diferencias). */
  const rellenarConInventario = () => {
    if (!confirm('Esto es un MODO PRUEBA: rellena todos los lotes con su cantidad actual del sistema. Si todo va bien, "Calcular diferencias" mostrará 0. ¿Continuar?')) return;
    setDatos(prev => prev.map(d => ({
      ...d,
      lotes: d.lotes.map(l => ({ ...l, cantidad_contada: l.cantidad_actual })),
    })));
    setDiferencias(null);
    setApplied(false);
    notify.success('Modo prueba activo', { description: 'Cantidades rellenadas con el inventario actual. Pulsa "Calcular diferencias" — debería ser 0.' });
  };

  const toggleColapsado = (id: string) => {
    setColapsados(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const focusLote = (productoIdx: number, loteIdx: number, lote: LoteRecuento, productoNombre: string, unidad: string) => {
    setLoteActivo({
      productoIdx,
      loteIdx,
      lote_interno: lote.lote_interno,
      producto_nombre: productoNombre,
      unidad,
    });
  };

  const recibirDeCalculadora = (valor: number) => {
    if (!loteActivo) return;
    updateContada(loteActivo.productoIdx, loteActivo.loteIdx, String(valor));
    notify.success('Valor enviado', { description: `${valor} → ${loteActivo.lote_interno}` });
    // Auto-focus al siguiente lote no contado para ergonomía
    setTimeout(() => avanzarSiguienteLote(), 100);
  };

  const avanzarSiguienteLote = () => {
    if (!loteActivo) return;
    let foundNext = false;
    for (let pi = loteActivo.productoIdx; pi < datos.length; pi++) {
      const lotes = datos[pi].lotes;
      const startLi = pi === loteActivo.productoIdx ? loteActivo.loteIdx + 1 : 0;
      for (let li = startLi; li < lotes.length; li++) {
        if (lotes[li].cantidad_contada === '' && lotes[li].id !== datos[loteActivo.productoIdx].lotes[loteActivo.loteIdx].id) {
          const key = `${pi}-${li}`;
          inputRefs.current.get(key)?.focus();
          inputRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          focusLote(pi, li, lotes[li], datos[pi].producto.nombre, datos[pi].producto.unidad_medida);
          foundNext = true;
          return;
        }
      }
    }
    if (!foundNext) setLoteActivo(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  const progresoPct = stats.totalLotes > 0 ? (stats.contados / stats.totalLotes) * 100 : 0;

  return (
    <div className="animate-fade-in">
      {/* Cabecera con progreso */}
      <div className="mb-4 rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-gray-50 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate('/configuracion')}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-loga-red/10">
            <ClipboardList size={22} className="text-loga-red" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900">Recuento de Inventario</h1>
            <p className="text-xs text-gray-500">
              Cuenta lotes con la calculadora lateral · enlaza un campo tocándolo
            </p>
          </div>
          {/* Stats */}
          <div className="hidden md:flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Progreso</p>
              <p className="text-lg font-bold text-gray-900 tabular-nums">{stats.contados}<span className="text-gray-400 text-sm">/{stats.totalLotes}</span></p>
            </div>
            {stats.conDiferencia > 0 && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Diferencias</p>
                <p className="text-lg font-bold text-amber-600 tabular-nums">{stats.conDiferencia}</p>
              </div>
            )}
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300"
            style={{ width: `${progresoPct}%` }}
          />
        </div>

        {/* Búsqueda + filtros */}
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar producto o código…"
              className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-loga-red focus:ring-1 focus:ring-loga-red outline-none"
              style={{ fontSize: '16px' }}
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => setSoloPendientes(p => !p)}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
              soloPendientes
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {soloPendientes ? <EyeOff size={12} /> : <Eye size={12} />}
            {soloPendientes ? 'Solo pendientes' : 'Ver todos'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
          {error}
        </p>
      )}

      {applied && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-2">
          <Check size={16} className="text-emerald-600" />
          <p className="text-xs text-emerald-700 font-medium">
            Recuento aplicado correctamente. Las cantidades de los lotes han sido actualizadas.
          </p>
        </div>
      )}

      {/* Layout 2 columnas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* COLUMNA IZQUIERDA: lista */}
        <div className="md:col-span-2 space-y-3">
          {datos.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
              <ClipboardList size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No hay productos con lotes activos.</p>
            </div>
          ) : datosFiltrados.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
              <Search size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">Sin resultados para "{busqueda}".</p>
            </div>
          ) : (
            datosFiltrados.map((d) => {
              const realIdx = datos.indexOf(d);
              const lotesContados = d.lotes.filter(l => l.cantidad_contada !== '').length;
              const colapsado = colapsados.has(d.producto.id);
              const todosContados = lotesContados === d.lotes.length;
              return (
                <div
                  key={d.producto.id}
                  className={clsx(
                    'rounded-xl border bg-white shadow-sm overflow-hidden transition-all',
                    todosContados ? 'border-emerald-200' : 'border-gray-100'
                  )}
                >
                  <button
                    onClick={() => toggleColapsado(d.producto.id)}
                    className="w-full flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white hover:from-gray-100 transition-colors text-left"
                  >
                    <span className="font-mono text-[11px] text-gray-500 shrink-0">{d.producto.codigo}</span>
                    <span className="font-semibold text-sm text-gray-800 truncate flex-1">{d.producto.nombre}</span>
                    <span className={clsx(
                      'text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-full',
                      todosContados ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                    )}>
                      {lotesContados}/{d.lotes.length}
                    </span>
                    <span className="text-[11px] text-gray-400 hidden sm:inline">
                      Stock: {parseFloat(d.producto.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {d.producto.unidad_medida}
                    </span>
                    {colapsado ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronUp size={14} className="text-gray-400" />}
                  </button>

                  {!colapsado && (
                    <div className="divide-y divide-gray-50">
                      {d.lotes.map((l, li) => {
                        const isActive = loteActivo?.productoIdx === realIdx && loteActivo?.loteIdx === li;
                        const sistema = parseFloat(l.cantidad_actual);
                        const contadoNum = l.cantidad_contada !== '' ? parseFloat(l.cantidad_contada) : null;
                        const diff = contadoNum !== null && !isNaN(contadoNum) ? contadoNum - sistema : null;
                        const hasDiff = diff !== null && Math.abs(diff) > 0.001;
                        const isOk = diff !== null && Math.abs(diff) < 0.001;
                        const key = `${realIdx}-${li}`;

                        return (
                          <div
                            key={l.id}
                            className={clsx(
                              'flex items-center gap-3 px-4 py-3 transition-colors',
                              isActive && 'bg-loga-red/5 ring-1 ring-loga-red/20',
                              !isActive && 'hover:bg-gray-50'
                            )}
                          >
                            <span className="font-mono text-[11px] text-gray-600 w-32 truncate shrink-0">{l.lote_interno}</span>
                            <span className="text-[11px] text-gray-400 tabular-nums shrink-0 w-24 text-right">
                              {sistema.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                            </span>
                            <input
                              ref={(el) => { if (el) inputRefs.current.set(key, el); }}
                              type="text"
                              inputMode="decimal"
                              value={l.cantidad_contada}
                              onChange={e => updateContada(realIdx, li, e.target.value)}
                              onFocus={() => focusLote(realIdx, li, l, d.producto.nombre, d.producto.unidad_medida)}
                              placeholder="Contado (acepta , o .)"
                              disabled={applied}
                              className={clsx(
                                'flex-1 min-w-[80px] max-w-[140px] rounded-lg border px-3 py-2.5 text-right font-mono font-semibold tabular-nums transition-all',
                                'focus:outline-none focus:ring-2',
                                isActive
                                  ? 'border-loga-red ring-loga-red/30 bg-white'
                                  : isOk
                                    ? 'border-emerald-200 bg-emerald-50 ring-emerald-200'
                                    : hasDiff
                                      ? 'border-amber-200 bg-amber-50 ring-amber-200'
                                      : 'border-gray-200 bg-white ring-loga-red/30 focus:border-loga-red',
                                'disabled:bg-gray-50',
                              )}
                              style={{ fontSize: '16px' }}
                            />
                            <span className="text-[10px] text-gray-400 w-6">{d.producto.unidad_medida}</span>
                            <div className="w-20 text-right shrink-0">
                              {diff !== null && !isNaN(diff) && hasDiff && (
                                <span className={clsx('font-bold tabular-nums text-xs', diff > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                                  {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                                </span>
                              )}
                              {isOk && <Check size={14} className="text-emerald-600 ml-auto" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Botones de acción */}
          {datos.length > 0 && !applied && (
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={calcularDiferencias}
                disabled={stats.contados === 0}
                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <CalculatorIcon size={15} />
                Calcular diferencias ({stats.contados})
              </button>

              <button
                onClick={borrarTodo}
                disabled={stats.contados === 0}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-loga-red hover:border-loga-red/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Borra todas las cantidades contadas (también del borrador local)"
              >
                <Trash2 size={14} />
                Borrar todo
              </button>

              <button
                onClick={rellenarConInventario}
                className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                title="MODO PRUEBA: rellena con la cantidad actual del sistema. Calcular diferencias debería dar 0."
              >
                <Wand2 size={14} />
                Rellenar con inventario (test)
              </button>

              {stats.contados > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400 italic">
                  <Check size={11} className="text-emerald-500" />
                  Borrador guardado automáticamente
                </span>
              )}
            </div>
          )}

          {/* Tabla de diferencias */}
          {diferencias !== null && (
            <div className="space-y-3 pt-2">
              {diferencias.length === 0 ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4 flex items-center gap-2">
                  <Check size={18} className="text-emerald-600" />
                  <p className="text-sm text-emerald-700 font-medium">
                    No hay diferencias. El inventario coincide con el sistema.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/30 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200 bg-amber-50">
                      <AlertTriangle size={15} className="text-amber-600" />
                      <span className="text-sm font-semibold text-amber-800">
                        {diferencias.length} diferencia{diferencias.length !== 1 ? 's' : ''} encontrada{diferencias.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="divide-y divide-amber-100">
                      {diferencias.map((d, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 text-xs items-center bg-white hover:bg-gray-50">
                          <div className="col-span-5">
                            <p className="font-medium text-gray-800 truncate">{d.producto.nombre}</p>
                            <p className="font-mono text-[10px] text-gray-400 truncate">{d.lote.lote_interno}</p>
                          </div>
                          <div className="col-span-2 text-right tabular-nums text-gray-500">{d.sistema.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</div>
                          <div className="col-span-2 text-right tabular-nums font-bold text-gray-900">{d.contado.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</div>
                          <div className={clsx('col-span-3 text-right tabular-nums font-bold', d.diff > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                            {d.diff > 0 ? '+' : ''}{d.diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {d.producto.unidad_medida}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {!applied && (
                    <button
                      onClick={aplicarCambios}
                      disabled={applying}
                      className="flex items-center gap-2 rounded-xl bg-loga-red px-5 py-3 text-sm font-bold text-white hover:brightness-110 disabled:bg-gray-300 transition-all shadow-sm shadow-loga-red/20"
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

        {/* COLUMNA DERECHA: calculadora sticky (desktop/tablet) */}
        <div className="hidden md:block">
          <div className="sticky top-20">
            <CalculadoraRecuento
              loteActivo={loteActivo ? {
                lote_interno: loteActivo.lote_interno,
                producto_nombre: loteActivo.producto_nombre,
                unidad: loteActivo.unidad,
              } : null}
              onEnviar={recibirDeCalculadora}
            />
          </div>
        </div>
      </div>

      {/* Calculadora flotante en móvil */}
      <div className="md:hidden">
        {!calcAbierta && (
          <button
            onClick={() => setCalcAbierta(true)}
            className="fixed bottom-24 right-4 z-30 flex items-center justify-center w-14 h-14 rounded-full bg-loga-red text-white shadow-2xl shadow-loga-red/40 active:scale-95 transition-transform"
            aria-label="Abrir calculadora"
          >
            <CalculatorIcon size={24} />
          </button>
        )}
        {calcAbierta && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-fade-in"
              onClick={() => setCalcAbierta(false)}
            />
            <div className="fixed inset-x-2 bottom-2 z-50 max-h-[85vh] overflow-y-auto animate-slide-up">
              <button
                onClick={() => setCalcAbierta(false)}
                className="absolute top-3 right-3 z-10 rounded-full bg-white/90 p-1.5 shadow"
              >
                <X size={14} />
              </button>
              <CalculadoraRecuento
                loteActivo={loteActivo ? {
                  lote_interno: loteActivo.lote_interno,
                  producto_nombre: loteActivo.producto_nombre,
                  unidad: loteActivo.unidad,
                } : null}
                onEnviar={(v) => {
                  recibirDeCalculadora(v);
                  setCalcAbierta(false);
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
