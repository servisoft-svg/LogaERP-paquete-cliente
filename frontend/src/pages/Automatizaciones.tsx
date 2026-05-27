/**
 * Automatizaciones — vista basada en reglas creadas por el usuario.
 *
 * Reemplaza el panel anterior de toggles globales. Cada regla = trigger + acción.
 * El usuario las crea con el botón "+" → wizard step-by-step.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Plus, Mail, Factory, Package, ShieldCheck, ShieldX, Bell, ArrowRight, RefreshCw,
  Trash2, Copy, Play, Pencil, AlertTriangle, CheckCircle2, X, ChevronRight, ChevronLeft,
  Activity, History, Eye, Sparkles, RotateCw, Power, Settings,
} from 'lucide-react';
import { automatizacionesApi, productosApi, proveedoresApi, clientesApi } from '../api/client';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import { notify } from '../lib/notify';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

interface ConfigAuto {
  auto_completar_pedidos_con_stock: boolean;
  auto_email_albaran: boolean;
  auto_email_albaran_clientes: string[] | null;
  auto_email_trazabilidad_fabricado: boolean;
  auto_fabricar_desde_pedido: boolean;
  auto_envasar_desde_pedido: boolean;
  backup_auto_activo: boolean;
  backup_auto_hora: string;
  backup_auto_ultima: string | null;
}

// ─── Types ─────────────────────────────────────────────────────
type TriggerTipo = 'stock_bajo_minimo' | 'stock_cero' | 'lote_qc_ok' | 'lote_qc_fuera_rango' | 'pedido_confirmado' | 'manual';
type AccionTipo = 'email_proveedor' | 'crear_orden_compra' | 'crear_orden_fabricacion' | 'crear_orden_envasado' | 'aprobar_lote' | 'rechazar_lote' | 'notificar';

interface Regla {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  icono: string;
  color: string;
  trigger_tipo: TriggerTipo;
  trigger_config: Record<string, unknown>;
  accion_tipo: AccionTipo;
  accion_config: Record<string, unknown>;
  ultima_ejecucion: string | null;
  ultimo_resultado: string | null;
  ejecuciones_count: number;
  ejecuciones_exito: number;
  ejecuciones_fallo: number;
  productos: { id: string; codigo: string; nombre: string }[];
}

interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  unidad_medida: string;
  stock_actual: string;
  stock_minimo: string;
  proveedor_id: string | null;
}

interface LogRow {
  id: string;
  tipo: string;
  resultado: string;
  detalle: Record<string, unknown>;
  error_msg: string | null;
  created_at: string;
  producto_codigo: string | null;
  producto_nombre: string | null;
  orden_numero: string | null;
  retry_count: number;
}

// ─── Plantillas ────────────────────────────────────────────────
interface Plantilla {
  id: string;
  titulo: string;
  descripcion: string;
  icono: typeof Mail;
  color: string;
  gradient: string;
  trigger: TriggerTipo;
  accion: AccionTipo;
  aplica_a: ('materia_prima' | 'material_embalaje' | 'producto_fabricado' | 'producto_envasado')[];
  // Steps to ask
  steps: ('productos' | 'umbral' | 'cantidad' | 'destinatario' | 'nombre')[];
  // Plantillas tipo 'sistema' no abren wizard; toggleconfig directo
  sistema?: { configKey: keyof ConfigAuto; valor: boolean };
}

const PLANTILLAS: Plantilla[] = [
  {
    id: 'email-proveedor',
    titulo: 'Email automático al proveedor',
    descripcion: 'Cuando una materia prima baje del mínimo, manda email pidiendo reposición.',
    icono: Mail,
    color: 'indigo',
    gradient: 'from-indigo-500 to-blue-600',
    trigger: 'stock_bajo_minimo',
    accion: 'email_proveedor',
    aplica_a: ['materia_prima', 'material_embalaje'],
    steps: ['productos', 'cantidad', 'destinatario', 'nombre'],
  },
  {
    id: 'orden-compra',
    titulo: 'Orden de compra borrador',
    descripcion: 'Crea una orden borrador (sin enviar email). Tú decides cuándo enviarla.',
    icono: Package,
    color: 'blue',
    gradient: 'from-blue-500 to-cyan-600',
    trigger: 'stock_bajo_minimo',
    accion: 'crear_orden_compra',
    aplica_a: ['materia_prima', 'material_embalaje'],
    steps: ['productos', 'cantidad', 'nombre'],
  },
  {
    id: 'orden-fabricacion',
    titulo: 'Crear orden de fabricación',
    descripcion: 'Cuando un producto granel baje del mínimo, programa una orden de producción.',
    icono: Factory,
    color: 'red',
    gradient: 'from-red-500 to-rose-600',
    trigger: 'stock_bajo_minimo',
    accion: 'crear_orden_fabricacion',
    aplica_a: ['producto_fabricado'],
    steps: ['productos', 'cantidad', 'nombre'],
  },
  {
    id: 'orden-envasado',
    titulo: 'Crear orden de envasado',
    descripcion: 'Cuando un producto envasado baje del mínimo, programa la orden de envasado.',
    icono: Package,
    color: 'amber',
    gradient: 'from-amber-500 to-orange-600',
    trigger: 'stock_bajo_minimo',
    accion: 'crear_orden_envasado',
    aplica_a: ['producto_envasado'],
    steps: ['productos', 'cantidad', 'nombre'],
  },
  {
    id: 'aprobar-lote',
    titulo: 'Aprobar lotes con QC OK',
    descripcion: 'Cada lote nuevo con todos los parámetros de calidad dentro de rango se aprueba solo.',
    icono: ShieldCheck,
    color: 'emerald',
    gradient: 'from-emerald-500 to-teal-600',
    trigger: 'lote_qc_ok',
    accion: 'aprobar_lote',
    aplica_a: ['producto_fabricado', 'producto_envasado'],
    steps: ['productos', 'nombre'],
  },
  {
    id: 'rechazar-lote',
    titulo: 'Rechazar lotes fuera de rango',
    descripcion: 'Lotes con QC fuera de rango se rechazan automáticamente y bajan a 0.',
    icono: ShieldX,
    color: 'rose',
    gradient: 'from-rose-500 to-pink-600',
    trigger: 'lote_qc_fuera_rango',
    accion: 'rechazar_lote',
    aplica_a: ['producto_fabricado', 'producto_envasado'],
    steps: ['productos', 'nombre'],
  },
  // ─── Sistema (toggles globales — sin wizard) ───────────────
  {
    id: 'auto-completar-pedido',
    titulo: 'Auto-completar pedidos con stock',
    descripcion: 'Al confirmar un pedido con stock suficiente, descuenta lotes FEFO y lo deja completado sin tocar nada.',
    icono: CheckCircle2,
    color: 'emerald',
    gradient: 'from-emerald-500 to-teal-600',
    trigger: 'pedido_confirmado',
    accion: 'notificar',
    aplica_a: [],
    steps: [],
    sistema: { configKey: 'auto_completar_pedidos_con_stock', valor: true },
  },
  {
    id: 'auto-email-trazabilidad',
    titulo: 'Aviso de fabricación + trazabilidad',
    descripcion: 'Cuando el pedido pasa a fabricado, manda email al cliente con la trazabilidad (sin datos económicos).',
    icono: Mail,
    color: 'indigo',
    gradient: 'from-indigo-500 to-purple-600',
    trigger: 'manual',
    accion: 'notificar',
    aplica_a: [],
    steps: [],
    sistema: { configKey: 'auto_email_trazabilidad_fabricado', valor: true },
  },
  {
    id: 'auto-email-albaran',
    titulo: 'Enviar albarán por email al cliente',
    descripcion: 'Al completar un pedido, manda PDF albarán + trazabilidad + fotos al email del cliente automáticamente.',
    icono: Mail,
    color: 'blue',
    gradient: 'from-blue-500 to-cyan-600',
    trigger: 'manual',
    accion: 'notificar',
    aplica_a: [],
    steps: [],
    sistema: { configKey: 'auto_email_albaran', valor: true },
  },
  {
    id: 'backup-nocturno',
    titulo: 'Backup nocturno cifrado',
    descripcion: 'Cada noche hace un backup completo (DB + uploads) cifrado AES-256. Sube a Google Drive si rclone está OK.',
    icono: ShieldCheck,
    color: 'indigo',
    gradient: 'from-indigo-500 to-purple-600',
    trigger: 'manual',
    accion: 'notificar',
    aplica_a: [],
    steps: [],
    sistema: { configKey: 'backup_auto_activo', valor: true },
  },
];

const TRIGGER_LABEL: Record<TriggerTipo, string> = {
  stock_bajo_minimo: 'Stock baja del mínimo',
  stock_cero: 'Stock llega a 0',
  lote_qc_ok: 'Lote con QC OK',
  lote_qc_fuera_rango: 'Lote con QC fuera de rango',
  pedido_confirmado: 'Pedido confirmado',
  manual: 'Sólo manual',
};

const ACCION_LABEL: Record<AccionTipo, { label: string; icon: typeof Mail }> = {
  email_proveedor:         { label: 'Enviar email al proveedor',     icon: Mail },
  crear_orden_compra:      { label: 'Crear orden de compra',         icon: Package },
  crear_orden_fabricacion: { label: 'Crear orden de fabricación',    icon: Factory },
  crear_orden_envasado:    { label: 'Crear orden de envasado',       icon: Package },
  aprobar_lote:            { label: 'Aprobar lote',                  icon: ShieldCheck },
  rechazar_lote:           { label: 'Rechazar lote',                 icon: ShieldX },
  notificar:               { label: 'Notificar',                     icon: Bell },
};

// ═══════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════
export default function Automatizaciones() {
  const { isAdmin } = useAuth();
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [config, setConfig] = useState<ConfigAuto | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string; email?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'reglas' | 'historial'>('reglas');
  const [albaranClientesOpen, setAlbaranClientesOpen] = useState(false);

  // Wizard / picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wizardPlantilla, setWizardPlantilla] = useState<Plantilla | null>(null);
  const [editandoRegla, setEditandoRegla] = useState<Regla | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [rR, rP, rL, rC, rCli] = await Promise.all([
        automatizacionesApi.reglas(),
        productosApi.listar({ activo: 'true' }),
        automatizacionesApi.log({ limit: 100 }),
        automatizacionesApi.getConfig(),
        clientesApi.listar({}).catch(() => ({ data: [] })),
      ]);
      setReglas(rR.data as Regla[]);
      setProductos(rP.data as Producto[]);
      const ld = rL.data as { rows: LogRow[]; total: number };
      setLog(ld.rows);
      setLogTotal(ld.total);
      setConfig(rC.data as ConfigAuto);
      setClientes(rCli.data as typeof clientes);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const setCfg = async (key: keyof ConfigAuto, value: unknown) => {
    if (!config) return;
    setConfig({ ...config, [key]: value as never });
    try {
      await automatizacionesApi.setConfig({ [key]: value });
      notify.success('Configuración guardada');
    } catch { cargar(); }
  };

  useEffect(() => { cargar(); }, [cargar]);

  // Stats agregados
  const stats = useMemo(() => {
    const activas = reglas.filter(r => r.activa).length;
    const ejecHoy = log.filter(l => {
      const d = new Date(l.created_at);
      return d.toDateString() === new Date().toDateString();
    }).length;
    const erroresHoy = log.filter(l => {
      const d = new Date(l.created_at);
      return d.toDateString() === new Date().toDateString() && (l.resultado === 'fallo_definitivo' || l.tipo === 'error');
    }).length;
    return { activas, total: reglas.length, ejecHoy, erroresHoy };
  }, [reglas, log]);

  const toggleActiva = async (r: Regla) => {
    setReglas(prev => prev.map(x => x.id === r.id ? { ...x, activa: !x.activa } : x));
    try {
      await automatizacionesApi.reglaEditar(r.id, { activa: !r.activa });
      notify.success(r.activa ? 'Regla desactivada' : 'Regla activada');
    } catch { cargar(); }
  };

  const eliminar = async (r: Regla) => {
    if (!confirm(`¿Eliminar la regla "${r.nombre}"?`)) return;
    try {
      await automatizacionesApi.reglaEliminar(r.id);
      notify.success('Regla eliminada');
      cargar();
    } catch { /* */ }
  };

  const duplicar = async (r: Regla) => {
    try {
      await automatizacionesApi.reglaDuplicar(r.id);
      notify.success('Regla duplicada');
      cargar();
    } catch { /* */ }
  };

  const ejecutar = async (r: Regla) => {
    try {
      await notify.promise(
        automatizacionesApi.reglaEjecutar(r.id),
        { loading: 'Ejecutando regla…', success: 'Regla disparada' }
      );
      cargar();
    } catch { /* */ }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;

  return (
    <div className="animate-fade-in space-y-6 pb-20">
      {/* ═══ Hero header con stats ══════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-loga-red via-rose-600 to-pink-600 p-6 shadow-lg">
        <div className="absolute -top-12 -right-12 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm shadow-inner">
              <Sparkles size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Automatizaciones</h1>
              <p className="text-xs text-white/80">Tus reglas que el sistema ejecuta solo</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setPickerOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-loga-red shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5">
              <Plus size={16} className="transition-transform group-hover:rotate-90" />
              Nueva automatización
            </button>
          )}
        </div>

        <div className="relative mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Activas" value={stats.activas} sub={`/ ${stats.total} total`} icon={Zap} />
          <StatCard label="Ejecuciones hoy" value={stats.ejecHoy} icon={Activity} />
          <StatCard label="Errores hoy" value={stats.erroresHoy} icon={AlertTriangle} highlight={stats.erroresHoy > 0} />
          <StatCard label="Productos cubiertos" value={new Set(reglas.flatMap(r => r.productos.map(p => p.id))).size} icon={Package} />
        </div>
      </div>

      {/* ═══ Tabs ═══════════════════════════════════════════ */}
      <div className="flex items-center gap-2 border-b border-gray-100 overflow-x-auto">
        {([
          { v: 'reglas', l: 'Reglas', i: Zap, c: stats.total },
          { v: 'historial', l: 'Historial', i: History, c: logTotal },
        ] as const).map(({ v, l, i: I, c }) => (
          <button key={v} onClick={() => setTab(v)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-bold transition-colors border-b-2 -mb-px shrink-0',
              tab === v
                ? 'border-loga-red text-loga-red'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            )}>
            <I size={14} /> {l}
            {c > 0 && (
              <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-mono',
                tab === v ? 'bg-loga-red/10 text-loga-red' : 'bg-gray-100 text-gray-500'
              )}>{c}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Tab: Reglas (sistema + usuarios) ══════════════ */}
      {tab === 'reglas' && (
        <>
          {config && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <SistemaReglaCard
                icon={Factory}
                color="red"
                titulo="Auto-fabricar desde pedido"
                descripcion="Confirmas un pedido sin stock y se crea la orden de fabricación con todos los datos."
                cuando="Pedido confirmado sin stock granel"
                hacer="Crear orden producción + asignar cliente + fecha + linkar pedido"
                value={config.auto_fabricar_desde_pedido}
                onChange={v => setCfg('auto_fabricar_desde_pedido', v)}
                onRun={async () => {
                  try {
                    await notify.promise(
                      automatizacionesApi.sistemaRun('auto_fabricar_pedido'),
                      { loading: 'Procesando pedidos pendientes…', success: 'Procesado' }
                    );
                    cargar();
                  } catch { /* */ }
                }}
                disabled={!isAdmin}
                ultima={ultimaPor(log, 'auto_fabricar_pedido')}
              />
              <SistemaReglaCard
                icon={CheckCircle2}
                color="emerald"
                titulo="Auto-completar pedido con stock"
                descripcion="Confirmas un pedido y se completa solo si hay stock."
                cuando="Pedido confirmado con stock suficiente"
                hacer="Consumir lotes FEFO + marcar completado"
                value={config.auto_completar_pedidos_con_stock}
                onChange={v => setCfg('auto_completar_pedidos_con_stock', v)}
                onRun={async () => {
                  try {
                    const { data } = await notify.promise(
                      automatizacionesApi.sistemaRun('auto_completar_pedido'),
                      { loading: 'Procesando confirmados…', success: (d) => `Procesados ${(d as { data: { procesados: number } }).data.procesados}` }
                    );
                    void data;
                    cargar();
                  } catch { /* */ }
                }}
                disabled={!isAdmin}
                ultima={ultimaPor(log, 'auto_completar_pedido')}
              />
              <SistemaReglaCard
                icon={Mail}
                color="indigo"
                titulo="Aviso de fabricación + trazabilidad"
                descripcion="Al fabricar el pedido, manda email al cliente con la trazabilidad (sin datos económicos)."
                cuando="Pedido pasa a fabricado/envasado"
                hacer="Email cliente con PDF trazabilidad sin costes"
                value={config.auto_email_trazabilidad_fabricado}
                onChange={v => setCfg('auto_email_trazabilidad_fabricado', v)}
                disabled={!isAdmin}
                ultima={ultimaPor(log, 'trazabilidad_fabricado')}
              />
              <SistemaReglaCard
                icon={Mail}
                color="blue"
                titulo="Enviar albarán por email"
                descripcion="Al completar pedido, manda PDF al cliente."
                cuando="Pedido completado y cliente con email"
                hacer="Enviar PDF albarán + trazabilidad + fotos"
                value={config.auto_email_albaran}
                onChange={v => setCfg('auto_email_albaran', v)}
                onRun={async () => {
                  try {
                    await notify.promise(
                      automatizacionesApi.sistemaRun('albaran_cliente'),
                      { loading: 'Enviando albaranes pendientes…', success: 'Albaranes enviados' }
                    );
                    cargar();
                  } catch { /* */ }
                }}
                onEdit={() => setAlbaranClientesOpen(true)}
                disabled={!isAdmin}
                ultima={ultimaPor(log, 'albaran_cliente')}
              >
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 text-[11px]">
                  <span className="flex items-center gap-1.5 text-gray-500"><Settings size={11} /> Clientes</span>
                  <span className="font-bold text-gray-700">
                    {!config.auto_email_albaran_clientes
                      ? 'Todos'
                      : config.auto_email_albaran_clientes.length === 0
                        ? 'Ninguno'
                        : `${config.auto_email_albaran_clientes.length} seleccionado${config.auto_email_albaran_clientes.length !== 1 ? 's' : ''}`}
                  </span>
                </div>
              </SistemaReglaCard>
              <SistemaReglaCard
                icon={ShieldCheck}
                color="indigo"
                titulo="Backup nocturno cifrado"
                descripcion="Cada noche backup completo cifrado AES-256."
                cuando={`Cada noche a las ${(config.backup_auto_hora ?? '02:00:00').slice(0, 5)}`}
                hacer="Backup DB + uploads + subida a Google Drive"
                value={config.backup_auto_activo}
                onChange={v => setCfg('backup_auto_activo', v)}
                onRun={async () => {
                  try {
                    await notify.promise(
                      automatizacionesApi.sistemaRun('backup_nocturno'),
                      { loading: 'Lanzando backup…', success: 'Backup ejecutado' }
                    );
                    cargar();
                  } catch { /* */ }
                }}
                disabled={!isAdmin}
                ultima={config.backup_auto_ultima ?? ultimaPor(log, 'backup_nocturno')}
              >
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hora</label>
                  <input
                    type="time"
                    value={(config.backup_auto_hora ?? '02:00:00').slice(0, 5)}
                    onChange={e => setCfg('backup_auto_hora', e.target.value + ':00')}
                    disabled={!isAdmin || !config.backup_auto_activo}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs font-mono focus:border-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
              </SistemaReglaCard>
            </div>
          )}

          {reglas.length === 0 ? (
            <div className="mt-4">
              <EmptyState onCreate={() => setPickerOpen(true)} canCreate={isAdmin} />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mt-2 pt-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Reglas por producto</p>
                <span className="text-[10px] text-gray-400">{reglas.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {reglas.map(r => (
                  <ReglaCard
                    key={r.id}
                    regla={r}
                    productos={productos}
                    isAdmin={isAdmin}
                    onToggle={() => toggleActiva(r)}
                    onEdit={() => setEditandoRegla(r)}
                    onDuplicate={() => duplicar(r)}
                    onDelete={() => eliminar(r)}
                    onRun={() => ejecutar(r)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ═══ Tab: Historial ═════════════════════════════════ */}
      {tab === 'historial' && <HistorialView log={log} reglas={reglas} onRefresh={cargar} />}

      {/* ═══ Modal: filtrar clientes para albarán ═════════ */}
      <AnimatePresence>
        {albaranClientesOpen && config && (
          <AlbaranClientesModal
            clientes={clientes}
            seleccionados={config.auto_email_albaran_clientes}
            onClose={() => setAlbaranClientesOpen(false)}
            onSave={async (lista) => {
              await setCfg('auto_email_albaran_clientes', lista);
              setAlbaranClientesOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ═══ Picker de plantillas ══════════════════════════ */}
      <AnimatePresence>
        {pickerOpen && <PlantillaPicker
          config={config}
          onClose={() => setPickerOpen(false)}
          onPick={async (p) => {
            setPickerOpen(false);
            if (p.sistema && config) {
              await setCfg(p.sistema.configKey, p.sistema.valor);
              setTab('reglas');
              return;
            }
            setWizardPlantilla(p);
          }}
        />}
      </AnimatePresence>

      {/* ═══ Wizard ════════════════════════════════════════ */}
      <AnimatePresence>
        {(wizardPlantilla || editandoRegla) && (
          <ReglaWizard
            plantilla={wizardPlantilla}
            editando={editandoRegla}
            productos={productos}
            onClose={() => { setWizardPlantilla(null); setEditandoRegla(null); }}
            onSaved={() => { setWizardPlantilla(null); setEditandoRegla(null); cargar(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// StatCard
// ═══════════════════════════════════════════════════════════════
function SistemaReglaCard({ icon: Icon, color, titulo, descripcion, cuando, hacer, value, onChange, onRun, onEdit, disabled, ultima, children }: {
  icon: typeof Mail; color: 'emerald' | 'blue' | 'indigo' | 'red';
  titulo: string; descripcion: string; cuando: string; hacer: string;
  value: boolean; onChange: (v: boolean) => void;
  onRun?: () => void; onEdit?: () => void;
  disabled?: boolean;
  ultima: string | null;
  children?: React.ReactNode;
}) {
  const cc = colorClasses(color);
  const fechaUltimaStr = ultima
    ? new Date(ultima).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Nunca ejecutada';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-2xl border bg-white shadow-sm overflow-hidden transition-all hover:shadow-md',
        value ? 'border-gray-100' : 'border-gray-100 opacity-70'
      )}>
      {/* Header colorizado */}
      <div className={clsx(
        'px-4 py-3 bg-gradient-to-r border-b flex items-start justify-between gap-2',
        cc.gradient,
        cc.border
      )}>
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl shrink-0', cc.iconBg)}>
            <Icon size={16} className={cc.iconColor} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-bold text-gray-900 truncate">{titulo}</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                Sistema
              </span>
            </div>
            <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{descripcion}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          disabled={disabled}
          title={value ? 'Desactivar' : 'Activar'}
          className={clsx(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            value ? 'bg-emerald-500' : 'bg-gray-300',
            disabled && 'opacity-50 cursor-not-allowed'
          )}>
          <span aria-hidden className={clsx(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200',
            value ? 'translate-x-5' : 'translate-x-0'
          )} />
        </button>
      </div>

      {/* CUANDO → HACER visual (mismo estilo que ReglaCard) */}
      <div className="px-4 py-4 space-y-2">
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">CUANDO</p>
          <p className="text-xs font-semibold text-gray-700 leading-snug">{cuando}</p>
        </div>
        <div className="flex justify-center">
          <ArrowRight size={14} className="text-gray-300" />
        </div>
        <div className={clsx('rounded-lg border px-3 py-2', cc.cardBorder, cc.cardBg)}>
          <p className={clsx('text-[9px] font-bold uppercase tracking-wider', cc.textStrong)}>HACER</p>
          <p className="text-xs font-semibold text-gray-800 leading-snug">{hacer}</p>
        </div>
        {children}
      </div>

      {/* Footer — estilo ReglaCard */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] text-gray-500 min-w-0">
          <span className="truncate">{fechaUltimaStr}</span>
        </div>
        {!disabled && (
          <div className="flex items-center gap-0.5">
            {onRun && (
              <button onClick={onRun} title="Disparar ahora"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-loga-red hover:text-white transition-colors">
                <Play size={12} />
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} title="Configurar"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-500 hover:text-white transition-colors">
                <Pencil size={12} />
              </button>
            )}
            <button onClick={() => onChange(!value)} title={value ? 'Pausar' : 'Reanudar'}
              className={clsx('rounded-lg p-1.5 transition-colors',
                value
                  ? 'text-gray-400 hover:bg-amber-500 hover:text-white'
                  : 'text-gray-400 hover:bg-emerald-500 hover:text-white'
              )}>
              <Power size={12} />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AlbaranClientesModal({ clientes, seleccionados, onClose, onSave }: {
  clientes: { id: string; nombre: string; email?: string }[];
  seleccionados: string[] | null;
  onClose: () => void;
  onSave: (lista: string[] | null) => Promise<void>;
}) {
  const [modo, setModo] = useState<'todos' | 'seleccion'>(seleccionados === null ? 'todos' : 'seleccion');
  const [ids, setIds] = useState<string[]>(seleccionados ?? []);
  const [busca, setBusca] = useState('');
  const filtrados = clientes.filter(c => !busca || c.nombre.toLowerCase().includes(busca.toLowerCase()));
  const toggle = (id: string) => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        className="relative z-10 w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-gray-900">Filtro de clientes</h2>
            <p className="text-xs text-gray-500 mt-0.5">¿A qué clientes mandar el albarán automático?</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setModo('todos')}
              className={clsx('rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors',
                modo === 'todos' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600')}>
              Todos los clientes
            </button>
            <button onClick={() => setModo('seleccion')}
              className={clsx('rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors',
                modo === 'seleccion' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600')}>
              Solo seleccionados
            </button>
          </div>
          {modo === 'seleccion' && (
            <>
              <input
                value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-loga-red outline-none" />
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {filtrados.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Sin clientes</p>}
                {filtrados.map(c => {
                  const sel = ids.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => toggle(c.id)}
                      className={clsx('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        sel ? 'bg-blue-50' : 'hover:bg-white')}>
                      <div className={clsx('h-4 w-4 rounded border-2 flex items-center justify-center shrink-0',
                        sel ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white')}>
                        {sel && <CheckCircle2 size={10} className="text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">{c.nombre}</p>
                        {c.email && <p className="text-[10px] text-gray-500 truncate">{c.email}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500"><b>{ids.length}</b> cliente{ids.length !== 1 ? 's' : ''} seleccionado{ids.length !== 1 ? 's' : ''}</p>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => onSave(modo === 'todos' ? null : ids)}
            className="rounded-xl bg-loga-red px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-red-700">
            Guardar
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Mapeo legible de claves de detalle → etiqueta humana
const DET_LABEL: Record<string, string> = {
  accion: 'Acción',
  motivo: 'Motivo',
  regla: 'Regla',
  pedido: 'Pedido',
  orden: 'Orden',
  numero_orden: 'Orden',
  producto: 'Producto',
  cantidad: 'Cantidad',
  unidad: 'Unidad',
  destinatario: 'Email',
  fecha_planificada: 'Fecha planificada',
  necesario: 'Necesario',
  reservado_propio: 'Reservado propio',
  libre_no_reservado: 'Stock libre',
  bloqueado_por: 'Bloqueado por',
  archivo: 'Archivo',
  tamano: 'Tamaño',
  drive: 'Subido a Drive',
  retry_count: 'Reintentos',
  receta_id: 'Receta',
  tip: 'Tip',
  cliente_id: 'Cliente',
};

function fmtDetVal(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'cantidad' || k === 'necesario' || k === 'reservado_propio' || k === 'libre_no_reservado') {
    return Number(v as number | string).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  }
  if (k === 'drive') return v ? 'Sí' : 'No';
  if (typeof v === 'string' && v.length > 80) return v.slice(0, 80) + '…';
  return String(v);
}

function DetalleGrid({ detalle }: { detalle: Record<string, unknown> }) {
  const entries = Object.entries(detalle ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  // Tip al final, motivo y accion al principio
  entries.sort(([a], [b]) => {
    const order = ['accion', 'motivo', 'pedido', 'orden', 'numero_orden', 'producto', 'cantidad', 'unidad', 'destinatario'];
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    if (a === 'tip') return 1;
    if (b === 'tip') return -1;
    return a.localeCompare(b);
  });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className={clsx('flex gap-1.5 items-baseline min-w-0', k === 'tip' && 'sm:col-span-2 italic text-gray-500 mt-0.5')}>
          <span className="text-gray-400 shrink-0">{DET_LABEL[k] ?? k.replace(/_/g, ' ')}:</span>
          <span className="font-medium text-gray-700 truncate">{fmtDetVal(k, v)}</span>
        </div>
      ))}
    </div>
  );
}

function ultimaPor(log: LogRow[], accion: string): string | null {
  const m = log.find(l => (l.detalle as { accion?: string })?.accion === accion);
  return m?.created_at ?? null;
}

const TIPO_LOG_LABEL: Record<string, string> = {
  orden_compra_creada: 'Orden compra creada',
  email_proveedor_enviado: 'Email proveedor enviado',
  orden_fabricacion_creada: 'Orden fabricación creada',
  orden_envasado_creada: 'Orden envasado creada',
  lote_aprobado_qc: 'Lote aprobado QC',
  duplicado_evitado: 'Duplicado evitado',
  error: 'Error',
  backup_creado: 'Copia backup',
  pedido_auto_completado: 'Pedido auto-completado',
  albaran_email_enviado: 'Albarán enviado',
  pedido_auto_fabricar: 'Orden auto-fabricación',
  pedido_auto_envasar: 'Orden auto-envasado',
  trazabilidad_email_enviada: 'Trazabilidad enviada',
};
function tipoLabel(t: string): string {
  return TIPO_LOG_LABEL[t] ?? t.replace(/_/g, ' ');
}

function StatCard({ label, value, sub, icon: Icon, highlight }: { label: string; value: number; sub?: string; icon: typeof Zap; highlight?: boolean }) {
  return (
    <div className={clsx(
      'rounded-xl p-3 backdrop-blur-sm border transition-colors',
      highlight ? 'bg-amber-400/30 border-amber-200/40' : 'bg-white/15 border-white/20'
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/80 font-bold">
        <Icon size={11} /> {label}
      </div>
      <p className="text-2xl font-black tabular-nums text-white mt-1 leading-none">{value}</p>
      {sub && <p className="text-[10px] text-white/70 mt-0.5">{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Empty state
// ═══════════════════════════════════════════════════════════════
function EmptyState({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gradient-to-b from-gray-50/50 to-white py-16 px-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-loga-red/10">
        <Zap size={26} className="text-loga-red" />
      </div>
      <h3 className="mt-4 text-base font-bold text-gray-900">Aún no tienes reglas</h3>
      <p className="mt-1 text-sm text-gray-500 max-w-sm mx-auto">
        Crea tu primera automatización: dile al sistema qué hacer cuando algo pase y olvídate.
      </p>
      {canCreate && (
        <button onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-loga-red px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-200 hover:bg-loga-red-dark transition-colors">
          <Plus size={15} /> Crear mi primera regla
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ReglaCard
// ═══════════════════════════════════════════════════════════════
function ReglaCard({ regla, isAdmin, onToggle, onEdit, onDuplicate, onDelete, onRun }: {
  regla: Regla; productos: Producto[]; isAdmin: boolean;
  onToggle: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onRun: () => void;
}) {
  const acc = ACCION_LABEL[regla.accion_tipo] ?? ACCION_LABEL.notificar;
  const Icon = acc.icon;
  const ratio = regla.ejecuciones_count > 0
    ? Math.round((regla.ejecuciones_exito / regla.ejecuciones_count) * 100)
    : null;
  const fechaUltima = regla.ultima_ejecucion ? new Date(regla.ultima_ejecucion) : null;
  const fechaUltimaStr = fechaUltima
    ? fechaUltima.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Nunca ejecutada';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={clsx(
        'rounded-2xl border bg-white shadow-sm overflow-hidden transition-all hover:shadow-md',
        regla.activa ? 'border-gray-100' : 'border-gray-100 opacity-60'
      )}>
      {/* Header colorizado */}
      <div className={clsx(
        'px-4 py-3 bg-gradient-to-r border-b flex items-start justify-between gap-2',
        colorClasses(regla.color).gradient,
        colorClasses(regla.color).border
      )}>
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl shrink-0', colorClasses(regla.color).iconBg)}>
            <Icon size={16} className={colorClasses(regla.color).iconColor} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">{regla.nombre}</p>
            {regla.descripcion && <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{regla.descripcion}</p>}
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            role="switch"
            aria-checked={regla.activa}
            onClick={onToggle}
            title={regla.activa ? 'Desactivar' : 'Activar'}
            className={clsx(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              regla.activa ? 'bg-emerald-500' : 'bg-gray-300'
            )}>
            <span aria-hidden className={clsx(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
              regla.activa ? 'translate-x-5' : 'translate-x-0'
            )} />
          </button>
        )}
      </div>

      {/* IF → THEN visual */}
      <div className="px-4 py-4 space-y-2">
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">CUANDO</p>
          <p className="text-xs font-semibold text-gray-700 leading-snug">{TRIGGER_LABEL[regla.trigger_tipo]}</p>
          {regla.productos.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">
              {regla.productos.length === 1
                ? regla.productos[0].nombre
                : `${regla.productos.length} producto${regla.productos.length !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>

        <div className="flex justify-center">
          <ArrowRight size={14} className="text-gray-300" />
        </div>

        <div className={clsx('rounded-lg border px-3 py-2', colorClasses(regla.color).cardBorder, colorClasses(regla.color).cardBg)}>
          <p className={clsx('text-[9px] font-bold uppercase tracking-wider', colorClasses(regla.color).textStrong)}>HACER</p>
          <p className="text-xs font-semibold text-gray-800 leading-snug">{acc.label}</p>
          {regla.accion_config?.cantidad_fija !== undefined && (
            <p className="text-[10px] text-gray-500 mt-0.5">Cantidad fija: {String(regla.accion_config.cantidad_fija)}</p>
          )}
          {regla.accion_config?.destinatario_email !== undefined && (
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">Email: {String(regla.accion_config.destinatario_email)}</p>
          )}
        </div>
      </div>

      {/* Footer: stats + actions */}
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><Activity size={10} /> {regla.ejecuciones_count}</span>
          {ratio !== null && (
            <span className={clsx('flex items-center gap-1 font-semibold',
              ratio >= 90 ? 'text-emerald-600' : ratio >= 60 ? 'text-amber-600' : 'text-loga-red'
            )}>
              <CheckCircle2 size={10} /> {ratio}% éxito
            </span>
          )}
          <span className="hidden sm:inline truncate">· {fechaUltimaStr}</span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-0.5">
            <button onClick={onRun} title="Ejecutar ahora"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-loga-red hover:text-white transition-colors">
              <Play size={12} />
            </button>
            <button onClick={onEdit} title="Editar"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-500 hover:text-white transition-colors">
              <Pencil size={12} />
            </button>
            <button onClick={onDuplicate} title="Duplicar"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-500 hover:text-white transition-colors">
              <Copy size={12} />
            </button>
            <button onClick={onDelete} title="Eliminar"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-500 hover:text-white transition-colors">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function colorClasses(color: string) {
  const map: Record<string, { gradient: string; border: string; iconBg: string; iconColor: string; cardBg: string; cardBorder: string; textStrong: string }> = {
    indigo: { gradient: 'from-indigo-50 to-white', border: 'border-indigo-100', iconBg: 'bg-indigo-500', iconColor: 'text-white', cardBg: 'bg-indigo-50/50', cardBorder: 'border-indigo-200', textStrong: 'text-indigo-700' },
    blue: { gradient: 'from-blue-50 to-white', border: 'border-blue-100', iconBg: 'bg-blue-500', iconColor: 'text-white', cardBg: 'bg-blue-50/50', cardBorder: 'border-blue-200', textStrong: 'text-blue-700' },
    red: { gradient: 'from-red-50 to-white', border: 'border-red-100', iconBg: 'bg-loga-red', iconColor: 'text-white', cardBg: 'bg-red-50/50', cardBorder: 'border-red-200', textStrong: 'text-red-700' },
    amber: { gradient: 'from-amber-50 to-white', border: 'border-amber-100', iconBg: 'bg-amber-500', iconColor: 'text-white', cardBg: 'bg-amber-50/50', cardBorder: 'border-amber-200', textStrong: 'text-amber-700' },
    emerald: { gradient: 'from-emerald-50 to-white', border: 'border-emerald-100', iconBg: 'bg-emerald-500', iconColor: 'text-white', cardBg: 'bg-emerald-50/50', cardBorder: 'border-emerald-200', textStrong: 'text-emerald-700' },
    rose: { gradient: 'from-rose-50 to-white', border: 'border-rose-100', iconBg: 'bg-rose-500', iconColor: 'text-white', cardBg: 'bg-rose-50/50', cardBorder: 'border-rose-200', textStrong: 'text-rose-700' },
  };
  return map[color] ?? map.red;
}

// ═══════════════════════════════════════════════════════════════
// Picker plantillas
// ═══════════════════════════════════════════════════════════════
function PlantillaPicker({ onClose, onPick, config }: { onClose: () => void; onPick: (p: Plantilla) => void; config: ConfigAuto | null }) {
  const reglas = PLANTILLAS.filter(p => !p.sistema);
  const sistema = PLANTILLAS.filter(p => p.sistema);
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative z-10 w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-gray-900">¿Qué quieres automatizar?</h2>
            <p className="text-xs text-gray-500 mt-0.5">Elige una plantilla y la configuras paso a paso</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        {/* Sección reglas por producto */}
        <div className="px-5 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Reglas por producto</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 pb-5">
          {reglas.map(p => {
            const Icon = p.icono;
            return (
              <button key={p.id} onClick={() => onPick(p)}
                className="group relative text-left rounded-2xl border border-gray-100 bg-white p-4 hover:border-gray-300 hover:shadow-lg transition-all overflow-hidden">
                <div className={clsx(
                  'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
                  p.gradient
                )} />
                <div className={clsx(
                  'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                  p.gradient
                )}>
                  <Icon size={20} className="text-white" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-gray-900">{p.titulo}</h3>
                <p className="mt-1 text-xs text-gray-500 leading-snug">{p.descripcion}</p>
                <ChevronRight size={14} className="absolute top-4 right-4 text-gray-300 group-hover:text-gray-700 group-hover:translate-x-1 transition-all" />
              </button>
            );
          })}
        </div>
        {/* Sección sistema (toggles globales) */}
        <div className="px-5 border-t border-gray-100 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Comportamientos del sistema</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 pb-6">
          {sistema.map(p => {
            const Icon = p.icono;
            const activa = !!(p.sistema && config && config[p.sistema.configKey] === true);
            return (
              <button key={p.id} onClick={() => onPick(p)}
                className={clsx(
                  'group relative text-left rounded-2xl border bg-white p-4 hover:border-gray-300 hover:shadow-lg transition-all overflow-hidden',
                  activa ? 'border-emerald-300' : 'border-gray-100'
                )}>
                <div className={clsx(
                  'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
                  p.gradient
                )} />
                <div className="flex items-start justify-between gap-2">
                  <div className={clsx(
                    'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                    p.gradient
                  )}>
                    <Icon size={20} className="text-white" />
                  </div>
                  {activa && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                      <CheckCircle2 size={10} /> Activa
                    </span>
                  )}
                </div>
                <h3 className="mt-3 text-sm font-bold text-gray-900">{p.titulo}</h3>
                <p className="mt-1 text-xs text-gray-500 leading-snug">{p.descripcion}</p>
                <ChevronRight size={14} className="absolute top-4 right-4 text-gray-300 group-hover:text-gray-700 group-hover:translate-x-1 transition-all" />
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Wizard
// ═══════════════════════════════════════════════════════════════
function ReglaWizard({ plantilla, editando, productos, onClose, onSaved }: {
  plantilla: Plantilla | null;
  editando: Regla | null;
  productos: Producto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialPlantilla: Plantilla = plantilla ?? PLANTILLAS.find(p => p.accion === editando?.accion_tipo) ?? PLANTILLAS[0];
  const [step, setStep] = useState(0);
  const [productoIds, setProductoIds] = useState<string[]>(editando?.productos.map(p => p.id) ?? []);
  const [cantidadFija, setCantidadFija] = useState<string>(String(editando?.accion_config?.cantidad_fija ?? ''));
  const [destinatario, setDestinatario] = useState<string>(String(editando?.accion_config?.destinatario_email ?? ''));
  const [nombre, setNombre] = useState<string>(editando?.nombre ?? initialPlantilla.titulo);
  const [activa, setActiva] = useState<boolean>(editando?.activa ?? true);
  const [activarDesde, setActivarDesde] = useState<string>(String((editando?.trigger_config as { activar_desde?: string } | undefined)?.activar_desde ?? ''));
  const [umbralCustom, setUmbralCustom] = useState<string>(String((editando?.trigger_config as { umbral?: number | string } | undefined)?.umbral ?? ''));
  const [saving, setSaving] = useState(false);
  const [proveedoresMap, setProveedoresMap] = useState<Record<string, { email?: string; nombre?: string }>>({});

  useEffect(() => {
    proveedoresApi.listar()
      .then(({ data }) => {
        const map: typeof proveedoresMap = {};
        for (const p of data as { id: string; nombre?: string; email?: string }[]) map[p.id] = p;
        setProveedoresMap(map);
      })
      .catch(() => {});
  }, []);

  const productosFiltrados = useMemo(() => {
    return productos.filter(p => initialPlantilla.aplica_a.includes(p.tipo as never));
  }, [productos, initialPlantilla]);

  const steps = initialPlantilla.steps;
  const stepName = steps[step];

  const guardar = async () => {
    setSaving(true);
    try {
      const payload = {
        nombre,
        descripcion: initialPlantilla.descripcion,
        activa,
        icono: initialPlantilla.id,
        color: initialPlantilla.color,
        trigger_tipo: initialPlantilla.trigger,
        trigger_config: {
          ...(activarDesde ? { activar_desde: activarDesde } : {}),
          ...(umbralCustom && !isNaN(Number(umbralCustom)) ? { umbral: Number(umbralCustom) } : {}),
        },
        accion_tipo: initialPlantilla.accion,
        accion_config: {
          ...(cantidadFija ? { cantidad_fija: parseFloat(cantidadFija) } : {}),
          ...(destinatario ? { destinatario_email: destinatario } : {}),
        },
        producto_ids: productoIds,
      };
      if (editando) {
        await automatizacionesApi.reglaEditar(editando.id, payload);
        notify.success('Regla actualizada');
      } else {
        await automatizacionesApi.reglaCrear(payload);
        notify.success('Regla creada');
      }
      onSaved();
    } catch { /* notif */ }
    finally { setSaving(false); }
  };

  const next = () => setStep(s => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep(s => Math.max(s - 1, 0));

  // Auto-fill destinatario cuando seleccionan 1 producto con proveedor
  useEffect(() => {
    if (initialPlantilla.accion === 'email_proveedor' && productoIds.length === 1 && !destinatario) {
      const prod = productos.find(p => p.id === productoIds[0]);
      if (prod?.proveedor_id) {
        const prov = proveedoresMap[prod.proveedor_id];
        if (prov?.email) setDestinatario(prov.email);
      }
    }
  }, [productoIds, productos, proveedoresMap, initialPlantilla.accion, destinatario]);

  const canNext = (() => {
    if (stepName === 'productos') return productoIds.length > 0;
    if (stepName === 'destinatario') return !!destinatario;
    if (stepName === 'nombre') return !!nombre.trim();
    return true;
  })();

  const PIcon = initialPlantilla.icono;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative z-10 w-full sm:max-w-xl max-h-[92vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header gradient */}
        <div className={clsx('relative px-5 py-4 bg-gradient-to-r', initialPlantilla.gradient)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <PIcon size={18} className="text-white" />
              </div>
              <div>
                <p className="text-xs font-bold text-white/80 uppercase tracking-wider">{editando ? 'Editar regla' : 'Nueva regla'}</p>
                <h2 className="text-base font-black text-white truncate">{initialPlantilla.titulo}</h2>
              </div>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-white/70 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-3">
            {steps.map((s, i) => (
              <div key={s + i} className={clsx(
                'flex-1 h-1.5 rounded-full transition-colors',
                i <= step ? 'bg-white' : 'bg-white/25'
              )} />
            ))}
          </div>
          <p className="text-[10px] text-white/80 mt-1">Paso {step + 1} de {steps.length}</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {stepName === 'productos' && (
            <Step
              titulo="¿Qué productos vigilamos?"
              descripcion="Elige uno o varios. Si dejas vacío no se guardará."
            >
              <ProductoMultiSelect
                productos={productosFiltrados}
                value={productoIds}
                onChange={setProductoIds}
              />
              {productosFiltrados.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                  No hay productos del tipo necesario para esta plantilla.
                </p>
              )}
            </Step>
          )}

          {stepName === 'cantidad' && (
            <Step
              titulo="Cantidad a pedir/producir"
              descripcion="Si lo dejas vacío, el sistema calcula la cantidad sugerida (mínimo + safety stock)."
            >
              <div className="space-y-3">
                <input
                  type="number" min="0" step="0.01"
                  value={cantidadFija}
                  onChange={e => setCantidadFija(e.target.value)}
                  placeholder="Cantidad fija (opcional)"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base font-mono text-center focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none" />
                <div className="rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-3 text-[11px] text-gray-600">
                  <Sparkles size={12} className="inline text-blue-500 mr-1" />
                  Si lo dejas vacío: <b>cantidad = stock_mínimo × (1 + safety%) − stock_actual</b>
                </div>
              </div>
            </Step>
          )}

          {stepName === 'destinatario' && (
            <Step
              titulo="¿A qué email enviar?"
              descripcion="Por defecto, el email del proveedor del producto. Puedes sobreescribirlo aquí."
            >
              <input
                type="email"
                value={destinatario}
                onChange={e => setDestinatario(e.target.value)}
                placeholder="proveedor@empresa.com"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none" />
            </Step>
          )}

          {stepName === 'nombre' && (
            <Step titulo="Ponle nombre" descripcion="Algo que recuerdes después.">
              <input
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Reposición acetato 95%"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base font-bold focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none" />
              <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
                <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)}
                  className="h-4 w-4 rounded text-loga-red focus:ring-loga-red" />
                Activar la regla al guardar
              </label>

              {initialPlantilla.trigger === 'stock_bajo_minimo' && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-3">
                  <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Condiciones extra (opcionales)</p>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">
                      Umbral custom
                    </label>
                    <input
                      type="number" step="0.01" min="0"
                      value={umbralCustom}
                      onChange={(e) => setUmbralCustom(e.target.value)}
                      placeholder="Ej: 100 (usa stock mínimo del producto si vacío)"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm w-full"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Si lo dejas vacío usa el stock mínimo definido en cada producto.</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">
                      Activar desde
                    </label>
                    <input
                      type="date"
                      value={activarDesde}
                      onChange={(e) => setActivarDesde(e.target.value)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Por defecto la regla actúa siempre. Si pones fecha, no se ejecuta hasta ese día.</p>
                  </div>
                </div>
              )}

              {/* Resumen */}
              <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Resumen</p>
                <div className="flex items-center gap-2 text-xs">
                  <Power size={12} className="text-gray-400" />
                  <span className="font-semibold">Cuando:</span>
                  <span className="text-gray-700">{TRIGGER_LABEL[initialPlantilla.trigger]}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Settings size={12} className="text-gray-400" />
                  <span className="font-semibold">Productos:</span>
                  <span className="text-gray-700">{productoIds.length} seleccionado{productoIds.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <ArrowRight size={12} className="text-gray-400" />
                  <span className="font-semibold">Hacer:</span>
                  <span className="text-gray-700">{ACCION_LABEL[initialPlantilla.accion].label}</span>
                </div>
                {cantidadFija && (
                  <div className="flex items-center gap-2 text-xs">
                    <Package size={12} className="text-gray-400" />
                    <span className="font-semibold">Cantidad:</span>
                    <span className="text-gray-700">{cantidadFija}</span>
                  </div>
                )}
                {destinatario && (
                  <div className="flex items-center gap-2 text-xs">
                    <Mail size={12} className="text-gray-400" />
                    <span className="font-semibold">Email:</span>
                    <span className="text-gray-700 truncate">{destinatario}</span>
                  </div>
                )}
              </div>
            </Step>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-between gap-2">
          <button onClick={step === 0 ? onClose : prev}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50">
            {step === 0 ? <><X size={14} /> Cancelar</> : <><ChevronLeft size={14} /> Atrás</>}
          </button>
          {step < steps.length - 1 ? (
            <button onClick={next} disabled={!canNext}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all bg-gradient-to-r',
                initialPlantilla.gradient,
                !canNext && 'opacity-40 cursor-not-allowed'
              )}>
              Siguiente <ChevronRight size={14} />
            </button>
          ) : (
            <button onClick={guardar} disabled={!canNext || saving}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all bg-gradient-to-r',
                initialPlantilla.gradient,
                (!canNext || saving) && 'opacity-50 cursor-not-allowed'
              )}>
              {saving ? <RotateCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {editando ? 'Guardar cambios' : 'Crear regla'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Step({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-black text-gray-900 tracking-tight">{titulo}</h3>
        {descripcion && <p className="text-xs text-gray-500 mt-0.5">{descripcion}</p>}
      </div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ProductoMultiSelect
// ═══════════════════════════════════════════════════════════════
function ProductoMultiSelect({ productos, value, onChange }: {
  productos: Producto[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [busca, setBusca] = useState('');
  const filtered = productos.filter(p => {
    const q = busca.toLowerCase();
    return !q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q);
  });
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  };
  return (
    <div className="space-y-2">
      <input
        value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Buscar producto…"
        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none" />
      <div className="rounded-xl border border-gray-100 bg-gray-50/50 max-h-72 overflow-y-auto divide-y divide-gray-100">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin resultados</p>
        ) : filtered.map(p => {
          const sel = value.includes(p.id);
          const stockBajo = parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo);
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                sel ? 'bg-loga-red/5' : 'hover:bg-white'
              )}>
              <div className={clsx(
                'h-4 w-4 rounded border-2 flex items-center justify-center transition-colors shrink-0',
                sel ? 'bg-loga-red border-loga-red' : 'border-gray-300 bg-white'
              )}>
                {sel && <CheckCircle2 size={10} className="text-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800 truncate">{p.nombre}</p>
                <p className="text-[10px] font-mono text-gray-400">{p.codigo}</p>
              </div>
              <div className="text-right">
                <p className={clsx('text-xs tabular-nums font-bold', stockBajo ? 'text-loga-red' : 'text-emerald-600')}>
                  {parseFloat(p.stock_actual).toLocaleString('es-ES')}
                </p>
                <p className="text-[9px] text-gray-400">/ mín {parseFloat(p.stock_minimo).toLocaleString('es-ES')}</p>
              </div>
            </button>
          );
        })}
      </div>
      {value.length > 0 && (
        <p className="text-[11px] text-gray-500">
          <b>{value.length}</b> producto{value.length !== 1 ? 's' : ''} seleccionado{value.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Historial
// ═══════════════════════════════════════════════════════════════
function HistorialView({ log, onRefresh }: { log: LogRow[]; reglas: Regla[]; onRefresh: () => void }) {
  if (log.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white py-16 text-center">
        <Eye size={28} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-400">Sin ejecuciones todavía. Las reglas aparecerán aquí cuando se disparen.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{log.length} entrada{log.length !== 1 ? 's' : ''} recientes</p>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
          <RefreshCw size={12} /> Recargar
        </button>
      </div>
      {log.map(l => {
        const isError = l.resultado === 'fallo_definitivo' || l.tipo === 'error';
        const isPendiente = l.resultado === 'pendiente_reintento';
        const isExito = l.resultado === 'exito';
        const fecha = new Date(l.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return (
          <div key={l.id} className={clsx(
            'rounded-xl border bg-white shadow-sm p-3',
            isError ? 'border-red-200 bg-red-50/30' : isPendiente ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100'
          )}>
            <div className="flex items-start gap-2.5">
              {isError ? <AlertTriangle size={14} className="text-loga-red shrink-0 mt-0.5" />
                : isPendiente ? <RotateCw size={14} className="text-amber-500 shrink-0 mt-0.5" />
                : isExito ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                : <Activity size={14} className="text-gray-400 shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold text-gray-900">
                    {tipoLabel(l.tipo)}
                    {l.resultado !== 'exito' && <span className="ml-1 text-[10px] font-normal text-gray-500">— {l.resultado.replace(/_/g, ' ')}</span>}
                  </p>
                  <p className="text-[10px] text-gray-400">{fecha}</p>
                </div>
                {l.producto_nombre && <p className="text-[11px] text-gray-700 truncate">{l.producto_nombre} <span className="font-mono text-gray-400">{l.producto_codigo}</span></p>}
                <DetalleGrid detalle={l.detalle} />
                {l.error_msg && <p className="text-[11px] text-red-700 bg-red-50 rounded px-2 py-1 mt-1 font-mono">{l.error_msg}</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
