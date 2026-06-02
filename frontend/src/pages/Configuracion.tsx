import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, Save, Percent, Mail, Bell, Eye, EyeOff, SendHorizontal, HardDrive, Building,
  ShieldCheck, History, Award, CheckCircle2, AlertCircle, Info, Database, ChevronRight, Beaker, Package,
  Search, X,
} from 'lucide-react';
import clsx from 'clsx';
import { configuracionApi } from '../api/client';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import CatalogoSpecs from '../components/CatalogoSpecs';
import CatalogoSubcategorias from '../components/CatalogoSubcategorias';
import IntegracionAlilo from '../components/IntegracionAlilo';
import HistorialActividad from '../components/HistorialActividad';
import { FormField, Input, Textarea } from '../components/FormField';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';

const EJEMPLO = {
  producto:  'Acetato de Vinilo (VAM)',
  cantidad:  '500',
  unidad:    'kg',
  proveedor: 'Química del Norte S.L.',
};


interface Config {
  porcentaje_alerta: string;
  plantilla_email:   string;
  email_remitente:   string;
  smtp_user:         string;
  smtp_pass_set:     string;
  empresa_nombre:    string;
  empresa_cif:       string;
  empresa_direccion: string;
  empresa_telefono:  string;
  empresa_web:       string;
  nivel_bronce:      string;
  nivel_plata:       string;
  nivel_oro:         string;
  datos_bancarios?:  string;
  email_copia_albaranes?: string;
}

// Estructura semántica del sidebar — agrupada por dominio.
// Cada grupo se renderiza con un header pequeño en uppercase y sus secciones
// debajo. Los IDs deben coincidir con los `<section id="...">` del contenido.
interface TocItem { id: string; label: string; icon: typeof Building; desc?: string }
interface TocGroup { titulo: string; items: TocItem[] }
const TOC_GROUPS: TocGroup[] = [
  {
    titulo: 'Esenciales',
    items: [
      { id: 'empresa', label: 'Datos de empresa', icon: Building, desc: 'Razón social, CIF, dirección, banco' },
      { id: 'alertas', label: 'Alertas de stock', icon: Percent,  desc: 'Umbral relativo al mínimo' },
    ],
  },
  {
    titulo: 'Comunicación',
    items: [
      { id: 'email', label: 'Email de pedidos', icon: Mail, desc: 'SMTP, plantilla, copia de archivo' },
    ],
  },
  {
    titulo: 'Catálogos editables',
    items: [
      { id: 'specs',            label: 'Specs físico-químicas', icon: Beaker,  desc: 'pH, sólidos, viscosidad…' },
      { id: 'subcategorias-mp', label: 'Sub-categorías MP',     icon: Beaker,  desc: 'Familias químicas' },
      { id: 'subcategorias-me', label: 'Sub-categorías ME',     icon: Package, desc: 'Bote, caja, etiqueta…' },
      { id: 'tipos-material',   label: 'Materiales embalaje',   icon: Package, desc: 'Plástico, cartón, madera…' },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { id: 'niveles', label: 'Niveles de clientes', icon: Award, desc: 'Umbrales Oro, Plata, Bronce' },
    ],
  },
  {
    titulo: 'Integraciones',
    items: [
      { id: 'integracion-alilo', label: 'Alilo', icon: ShieldCheck, desc: 'API HMAC con Alilo' },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { id: 'backup',    label: 'Backup',    icon: Database, desc: 'Copia cifrada + Google Drive' },
      { id: 'historial', label: 'Historial', icon: History,  desc: 'Auditoría de cambios' },
    ],
  },
];
const TOC_FLAT = TOC_GROUPS.flatMap(g => g.items);

export default function Configuracion() {
  const [config, setConfig]       = useState<Config | null>(null);
  const [loading, setLoading]     = useState(true);
  const [smtpPass, setSmtpPass]           = useState('');
  const [showSmtpPass, setShowSmtpPass]   = useState(false);
  const [savingConfig, setSavingConfig]   = useState(false);
  const [savedConfig, setSavedConfig]     = useState(false);
  const [errorConfig, setErrorConfig]     = useState('');
  const [recheckResult, setRecheckResult] = useState<string | null>(null);
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [testSmtpLoading, setTestSmtpLoading] = useState(false);
  const [testSmtpResult, setTestSmtpResult]   = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupResult, setBackupResult]   = useState<string | null>(null);
  const [backupsList, setBackupsList]     = useState<{ filename: string; size: string; date: string }[]>([]);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [backupPassStatus, setBackupPassStatus] = useState<{ configurada: boolean; origen: string; longitud: number } | null>(null);
  const [backupPassNueva, setBackupPassNueva] = useState('');
  const [backupPassVisible, setBackupPassVisible] = useState(false);
  const [backupPassSaving, setBackupPassSaving] = useState(false);
  const [gdriveStatus, setGdriveStatus] = useState<{ client_id_configurado: boolean; autorizado: boolean; email: string | null; folder_id: string | null } | null>(null);
  const [gdriveClientId, setGdriveClientId] = useState('');
  const [gdriveClientSecret, setGdriveClientSecret] = useState('');
  const [gdriveFolderId, setGdriveFolderId] = useState('');
  const [gdriveSaving, setGdriveSaving] = useState(false);
  // auditoria queda gestionada por <HistorialActividad/>; ya no se necesita aquí.
  // Snapshot inicial para detectar cambios sin guardar (save bar sticky)
  const [configInicial, setConfigInicial] = useState<Config | null>(null);
  // Sidebar: búsqueda + scroll-spy
  const [tocBuscar, setTocBuscar] = useState('');
  const [seccionActiva, setSeccionActiva] = useState<string>('empresa');

  // Scroll-spy: detecta qué sección está visible en el viewport
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const visibles = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visibles[0]?.target.id) setSeccionActiva(visibles[0].target.id);
      },
      { rootMargin: '-15% 0px -60% 0px', threshold: [0, 0.2, 0.5, 1] }
    );
    TOC_FLAT.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [loading]);

  // ¿Hay cambios sin guardar respecto al snapshot inicial?
  const hayCambios = useMemo(() => {
    if (!config || !configInicial) return false;
    if (smtpPass) return true;
    const claves: (keyof Config)[] = [
      'porcentaje_alerta', 'plantilla_email', 'email_remitente', 'smtp_user',
      'empresa_nombre', 'empresa_cif', 'empresa_direccion', 'empresa_telefono', 'empresa_web',
      'nivel_bronce', 'nivel_plata', 'nivel_oro', 'datos_bancarios', 'email_copia_albaranes',
    ];
    return claves.some(k => (config[k] ?? '') !== (configInicial[k] ?? ''));
  }, [config, configInicial, smtpPass]);

  // Aviso si intenta salir con cambios sin guardar
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hayCambios) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hayCambios]);

  // TOC filtrado por búsqueda (acento-insensible)
  const toc = useMemo(() => {
    if (!tocBuscar.trim()) return TOC_GROUPS;
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = norm(tocBuscar);
    return TOC_GROUPS
      .map(g => ({ ...g, items: g.items.filter(it => norm(it.label).includes(q) || norm(it.desc ?? '').includes(q)) }))
      .filter(g => g.items.length > 0);
  }, [tocBuscar]);

  // Audit log
  // auditLog removed — using auditoria state below



  const cargar = useCallback(async () => {
    try {
      const cfgRes = await configuracionApi.obtener();
      const cfg = cfgRes.data as Config;
      setConfig(cfg);
      setConfigInicial(cfg);
    } catch {
      setErrorConfig('Error al cargar la configuración');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Carga estado de la password de backup y de Google Drive
  useEffect(() => {
    configuracionApi.backupPasswordStatus()
      .then(({ data }) => setBackupPassStatus(data as { configurada: boolean; origen: string; longitud: number }))
      .catch(() => {});
    configuracionApi.gdriveStatus()
      .then(({ data }) => setGdriveStatus(data as any))
      .catch(() => {});
    // Si volvemos del callback OAuth (?gdrive_code=xxx en la URL), intercambiar token
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code && state === 'gdrive') {
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      configuracionApi.gdriveCallback(code, redirectUri)
        .then(({ data }) => {
          notify.success('Google Drive conectado', { description: (data as { email?: string }).email ?? '' });
          window.history.replaceState(null, '', window.location.pathname + '#specs');
          configuracionApi.gdriveStatus().then(({ data: s }) => setGdriveStatus(s as any));
        })
        .catch((e) => notify.error('Error al conectar Drive', { description: e?.response?.data?.error ?? '' }));
    }
  }, []);

  const handleRecheck = async () => {
    setRecheckLoading(true);
    setRecheckResult(null);
    try {
      const { data } = await configuracionApi.recheckAlertas();
      const d = data as { productos_bajos: number; notificaciones_creadas: number };
      setRecheckResult(`${d.productos_bajos} producto(s) bajo mínimos. ${d.notificaciones_creadas} notificación(es) nueva(s) creada(s).`);
    } catch {
      setRecheckResult('Error al re-evaluar.');
    } finally {
      setRecheckLoading(false);
    }
  };

  const guardarConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    setErrorConfig('');
    setSavedConfig(false);
    const payload = {
      porcentaje_alerta: Number(config.porcentaje_alerta),
      plantilla_email:   config.plantilla_email,
      email_remitente:   config.email_remitente,
      smtp_user:         config.smtp_user || undefined,
      smtp_pass_enc:     smtpPass || undefined,
      empresa_nombre:    config.empresa_nombre,
      empresa_cif:       config.empresa_cif,
      empresa_direccion: config.empresa_direccion,
      empresa_telefono:  config.empresa_telefono,
      empresa_web:       config.empresa_web,
      nivel_bronce:      config.nivel_bronce ? Number(config.nivel_bronce) : undefined,
      nivel_plata:       config.nivel_plata ? Number(config.nivel_plata) : undefined,
      nivel_oro:         config.nivel_oro ? Number(config.nivel_oro) : undefined,
      datos_bancarios:   config.datos_bancarios ?? '',
      email_copia_albaranes: config.email_copia_albaranes ?? '',
    };
    try {
      const res = await notify.promise(configuracionApi.editar(payload), {
        loading: 'Guardando configuración…',
        success: 'Configuración guardada',
        successDesc: (
          <ToastBlock title={config.empresa_nombre}>
            <ToastField label="CIF" value={config.empresa_cif} />
            <ToastField label="Email remitente" value={config.email_remitente} span={2} />
            <ToastField label="Alerta stock" value={`${config.porcentaje_alerta}%`} />
            <ToastField label="SMTP" value={smtpPass ? 'contraseña actualizada' : ''} />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar',
      });
      setConfig(res.data as Config);
      setConfigInicial(res.data as Config);
      setSmtpPass('');
      setSavedConfig(true);
      setTimeout(() => setSavedConfig(false), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorConfig(msg ?? 'Error al guardar');
    } finally {
      setSavingConfig(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-32">
      {/* Hero · compacto */}
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-loga-red to-loga-red-dark text-white shadow-md shadow-red-100">
            <Settings size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Configuración</h1>
            <p className="text-xs text-gray-500">Parámetros globales del ERP · empresa, comunicación, catálogos, integraciones, sistema</p>
          </div>
        </div>
        {hayCambios && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Cambios sin guardar
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-8 max-w-7xl">
        {/* TOC sticky · agrupado + scroll-spy + búsqueda */}
        <aside className="hidden lg:block">
          <nav className="sticky top-6 space-y-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
            {/* Buscador */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={tocBuscar}
                onChange={e => setTocBuscar(e.target.value)}
                placeholder="Buscar configuración…"
                className="w-full rounded-lg border border-gray-200 bg-gray-50/50 pl-7 pr-7 py-1.5 text-[11px] outline-none focus:border-loga-red focus:bg-white transition-colors"
              />
              {tocBuscar && (
                <button
                  type="button"
                  onClick={() => setTocBuscar('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-loga-red"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Grupos */}
            {toc.length === 0 && (
              <p className="text-[10px] text-gray-400 italic px-2 py-3 text-center">Sin coincidencias</p>
            )}
            {toc.map(grupo => (
              <div key={grupo.titulo} className="space-y-0.5">
                <p className="px-2 pt-2 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider">{grupo.titulo}</p>
                {grupo.items.map(({ id, label, icon: Icon, desc }) => {
                  const activa = seccionActiva === id;
                  return (
                    <a
                      key={id}
                      href={`#${id}`}
                      title={desc}
                      className={clsx(
                        'group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                        activa
                          ? 'bg-loga-red/10 text-loga-red font-bold shadow-sm border border-loga-red/20'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-loga-red font-medium'
                      )}
                      aria-current={activa ? 'true' : undefined}
                    >
                      <Icon size={12} className={activa ? 'text-loga-red' : 'text-gray-400 group-hover:text-loga-red'} />
                      <span className="flex-1 truncate">{label}</span>
                      {activa && <ChevronRight size={11} className="text-loga-red" />}
                    </a>
                  );
                })}
              </div>
            ))}

            {/* Atajo: ir arriba */}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="w-full text-[10px] text-gray-400 hover:text-gray-700 px-2 py-1 transition-colors text-center border-t border-gray-100 pt-2 mt-2"
            >
              ↑ Volver arriba
            </button>
          </nav>
        </aside>

        {/* Contenido */}
        <div className="space-y-6 min-w-0">

          {/* Sección: datos de empresa */}
          <section id="empresa" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100/70 text-blue-600">
                <Building size={15} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Datos de la Empresa</h2>
                <p className="text-[11px] text-gray-400">Aparecen en albaranes, facturas y PDFs</p>
              </div>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Razon social">
                  <Input
                    value={config?.empresa_nombre ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, empresa_nombre: e.target.value } : c)}
                    placeholder="Colas Loga S.L."
                  />
                </FormField>
                <FormField label="CIF / NIF">
                  <Input
                    value={config?.empresa_cif ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, empresa_cif: e.target.value } : c)}
                    placeholder="B12345678"
                  />
                </FormField>
              </div>
              <FormField label="Direccion">
                <Input
                  value={config?.empresa_direccion ?? ''}
                  onChange={(e) => setConfig((c) => c ? { ...c, empresa_direccion: e.target.value } : c)}
                  placeholder="Poligono Industrial, Nave 5, 28001 Madrid"
                />
              </FormField>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Telefono">
                  <Input
                    value={config?.empresa_telefono ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, empresa_telefono: e.target.value } : c)}
                    placeholder="900 000 000"
                  />
                </FormField>
                <FormField label="Web">
                  <Input
                    value={config?.empresa_web ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, empresa_web: e.target.value } : c)}
                    placeholder="www.colasloga.es"
                  />
                </FormField>
              </div>
              <FormField
                label="Datos bancarios"
                hint="Aparece en el PDF de Pedido a Proveedores. Ej: 'BBVA · Oficina de Aguilar de Campoo · ES12 3456 7890 1234 5678 9012 · Enviar por: «Número de cuenta»'"
              >
                <Textarea
                  rows={3}
                  value={config?.datos_bancarios ?? ''}
                  onChange={(e) => setConfig((c) => c ? { ...c, datos_bancarios: e.target.value } : c)}
                  placeholder="Banco · Oficina · IBAN · Forma de envío"
                />
              </FormField>
            </div>
          </section>

          {/* Sección: alertas de stock */}
          <section id="alertas" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50/70 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100/70 text-amber-600">
                <Percent size={15} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Alertas de Stock</h2>
                <p className="text-[11px] text-gray-400">Umbral relativo al stock mínimo</p>
              </div>
            </div>
            <div className="px-5 py-5 space-y-4">
              <FormField
                label="Umbral de alerta (%)"
                hint="Porcentaje POR ENCIMA del stock mínimo para activar alerta naranja. Ej: 20 = naranja cuando stock ≤ mínimo × 1.20"
              >
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={config?.porcentaje_alerta ?? '20'}
                      onChange={(e) => setConfig((c) => c ? { ...c, porcentaje_alerta: e.target.value } : c)}
                      className="w-32 pr-8 text-center font-semibold"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">%</span>
                  </div>
                  <span className="rounded-full bg-amber-50 border border-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                    naranja al ≤ mínimo × {(1 + Number(config?.porcentaje_alerta ?? 20) / 100).toFixed(2)}
                  </span>
                </div>
              </FormField>
            </div>
          </section>

          {/* Sección: email */}
          <section id="email" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100/70 text-indigo-600">
                <Mail size={15} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Email de Pedidos</h2>
                <p className="text-[11px] text-gray-400">Configura SMTP y plantilla del cuerpo</p>
              </div>
            </div>
            <div className="px-5 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Email remitente (FROM)">
                  <Input
                    type="email"
                    value={config?.email_remitente ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, email_remitente: e.target.value } : c)}
                    placeholder="erp@loga.es"
                  />
                </FormField>
                <FormField label="Usuario SMTP (cuenta Gmail)">
                  <Input
                    type="email"
                    value={config?.smtp_user ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, smtp_user: e.target.value } : c)}
                    placeholder="tumail@gmail.com"
                  />
                </FormField>
              </div>

              <FormField
                label="Email de archivo de albaranes"
                hint="Cada albarán generado o enviado se enviará también (BCC) a esta dirección. Dejar vacío para desactivar."
              >
                <Input
                  type="email"
                  value={config?.email_copia_albaranes ?? ''}
                  onChange={(e) => setConfig((c) => c ? { ...c, email_copia_albaranes: e.target.value } : c)}
                  placeholder="archivo@loga.es"
                />
              </FormField>

              <FormField
                label="Contraseña de aplicación SMTP"
                hint={config?.smtp_pass_set ? 'Ya configurada — escribe aquí para cambiarla' : 'Genera una en Google → Seguridad → Contraseñas de aplicaciones'}
              >
                <div className="relative">
                  <Input
                    type={showSmtpPass ? 'text' : 'password'}
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder={config?.smtp_pass_set ? '••••••••  (dejar vacío para no cambiar)' : 'abcdefghijklmnop'}
                    className="pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {config?.smtp_pass_set && (
                    <span className="absolute -top-1 right-12 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                      <ShieldCheck size={9} /> guardada
                    </span>
                  )}
                </div>
              </FormField>

              {/* Botón Probar SMTP */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    setTestSmtpLoading(true);
                    setTestSmtpResult(null);
                    try {
                      const { data } = await notify.promise(configuracionApi.testSmtp(), {
                        loading: 'Enviando email de prueba…',
                        success: (r) => {
                          const d = (r as { data: { ok?: boolean; error?: string } }).data;
                          return d.ok ? 'Email de prueba enviado' : `Error SMTP`;
                        },
                        successDesc: (
                          <ToastBlock>
                            <ToastField label="Usuario" value={config?.smtp_user} span={2} />
                            <ToastField label="Remitente" value={config?.email_remitente} span={2} />
                            <ToastField label="Host" value="smtp.gmail.com:587" span={2} />
                          </ToastBlock>
                        ),
                        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al probar SMTP',
                      });
                      const d = data as { ok?: boolean; error?: string };
                      setTestSmtpResult(d.ok ? 'Email de prueba enviado correctamente.' : `Error: ${d.error}`);
                    } catch (err: unknown) {
                      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                      setTestSmtpResult(msg ?? 'Error al probar SMTP');
                    } finally {
                      setTestSmtpLoading(false);
                    }
                  }}
                  disabled={testSmtpLoading}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-indigo-200 disabled:opacity-50 transition-all shadow-sm"
                >
                  <SendHorizontal size={13} />
                  {testSmtpLoading ? 'Enviando…' : 'Probar SMTP'}
                </button>
                {testSmtpResult && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${testSmtpResult.startsWith('Error') ? 'bg-red-50 text-loga-red border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                    {testSmtpResult.startsWith('Error') ? <AlertCircle size={11}/> : <CheckCircle2 size={11}/>}
                    {testSmtpResult}
                  </span>
                )}
              </div>

              {/* Editor + Preview en columnas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Editor */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700">
                    Plantilla del cuerpo del email
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Variables disponibles:{' '}
                    {['producto', 'cantidad', 'unidad', 'proveedor', 'saludo', 'hola'].map((v) => (
                      <code
                        key={v}
                        title="Click para copiar"
                        onClick={() => navigator.clipboard.writeText(`{{${v}}}`)}
                        className="mx-0.5 rounded bg-gray-100 px-1 text-gray-600 cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                      >{`{{${v}}}`}</code>
                    ))}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    <code className="rounded bg-gray-100 px-1 text-gray-600">{`{{saludo}}`}</code> → <span className="text-gray-600">"Buenos días"</span> (6:00-13:59), <span className="text-gray-600">"Buenas tardes"</span> (14:00-20:59) o <span className="text-gray-600">"Buenas noches"</span> (21:00-5:59).
                    <br/>
                    <code className="rounded bg-gray-100 px-1 text-gray-600">{`{{hola}}`}</code> → <span className="text-gray-600">"Hola, buenos días"</span> (etc.). Hora de Madrid en el momento del envío. <span className="italic">Haz click en una variable para copiarla.</span>
                  </p>
                  <Textarea
                    rows={10}
                    value={config?.plantilla_email ?? ''}
                    onChange={(e) => setConfig((c) => c ? { ...c, plantilla_email: e.target.value } : c)}
                    className="font-mono text-xs"
                  />
                </div>

                {/* Preview */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Eye size={12} className="text-gray-400" />
                    <p className="text-xs font-medium text-gray-700">Vista previa (con datos de ejemplo)</p>
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-blue-50/30 to-white p-4 space-y-3 min-h-[220px] shadow-inner">
                    {/* Asunto */}
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Asunto</span>
                      <p className="mt-0.5 text-xs font-semibold text-gray-800 bg-white rounded-lg px-3 py-1.5 border border-gray-100 shadow-sm">
                        Pedido {EJEMPLO.producto} — Fábrica Loga
                      </p>
                    </div>
                    {/* De */}
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">De</span>
                      <p className="mt-0.5 text-xs text-gray-600 bg-white rounded-lg px-3 py-1.5 border border-gray-100 shadow-sm">
                        {config?.email_remitente || 'erp@loga.es'}
                      </p>
                    </div>
                    {/* Cuerpo */}
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cuerpo</span>
                      <pre className="mt-0.5 text-xs text-gray-700 bg-white rounded-lg px-3 py-2.5 border border-gray-100 whitespace-pre-wrap font-sans leading-relaxed min-h-[80px] shadow-sm">
                        {(() => {
                          const horaMadrid = parseInt(
                            new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }),
                            10
                          );
                          let saludo = 'Buenos días';
                          if (horaMadrid >= 14 && horaMadrid < 21) saludo = 'Buenas tardes';
                          else if (horaMadrid >= 21 || horaMadrid < 6) saludo = 'Buenas noches';
                          return (config?.plantilla_email ?? '')
                            .replace(/\{\{producto\}\}/g, EJEMPLO.producto)
                            .replace(/\{\{cantidad\}\}/g, EJEMPLO.cantidad)
                            .replace(/\{\{unidad\}\}/g, EJEMPLO.unidad)
                            .replace(/\{\{proveedor\}\}/g, EJEMPLO.proveedor)
                            .replace(/\{\{saludo\}\}/g, saludo)
                            .replace(/\{\{hola\}\}/g, `Hola, ${saludo.toLowerCase()}`)
                            || '(escribe la plantilla a la izquierda)';
                        })()}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Status messages globales */}
          {errorConfig && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-loga-red shadow-sm">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p>{errorConfig}</p>
            </div>
          )}
          {recheckResult && (
            <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 shadow-sm">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>{recheckResult}</p>
            </div>
          )}

          {/* Sección: niveles de cliente */}
          <section id="niveles" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50/70 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100/70 text-amber-600">
                <Award size={15} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Niveles de cliente</h2>
                <p className="text-[11px] text-gray-400">Umbrales de consumo (EUR) — recálculo automático al guardar</p>
              </div>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Bronce */}
                <div className="relative rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/40 to-orange-50/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-600 to-orange-700 px-2 py-0.5 text-[9px] font-black text-white shadow-sm">
                      <Award size={9} /> BRONCE
                    </span>
                    <span className="text-[10px] text-amber-700/60 font-semibold">desde</span>
                  </div>
                  <FormField label="" hint="Mínimo para bronce">
                    <Input
                      type="number" min="0" step="1000"
                      value={config?.nivel_bronce ?? '20000'}
                      onChange={e => setConfig(c => c ? { ...c, nivel_bronce: e.target.value } : c)}
                      className="text-center font-bold text-base bg-white"
                    />
                  </FormField>
                </div>
                {/* Plata */}
                <div className="relative rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-gray-300 to-gray-400 px-2 py-0.5 text-[9px] font-black text-white shadow-sm">
                      <Award size={9} /> PLATA
                    </span>
                    <span className="text-[10px] text-gray-500 font-semibold">desde</span>
                  </div>
                  <FormField label="" hint="Mínimo para plata">
                    <Input
                      type="number" min="0" step="1000"
                      value={config?.nivel_plata ?? '80000'}
                      onChange={e => setConfig(c => c ? { ...c, nivel_plata: e.target.value } : c)}
                      className="text-center font-bold text-base bg-white"
                    />
                  </FormField>
                </div>
                {/* Oro */}
                <div className="relative rounded-xl border border-yellow-200 bg-gradient-to-br from-yellow-50 to-amber-100/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-2 py-0.5 text-[9px] font-black text-white shadow-sm">
                      <Award size={9} /> ORO
                    </span>
                    <span className="text-[10px] text-yellow-700 font-semibold">desde</span>
                  </div>
                  <FormField label="" hint="Mínimo para oro">
                    <Input
                      type="number" min="0" step="1000"
                      value={config?.nivel_oro ?? '150000'}
                      onChange={e => setConfig(c => c ? { ...c, nivel_oro: e.target.value } : c)}
                      className="text-center font-bold text-base bg-white"
                    />
                  </FormField>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <Info size={11} /> Las medallas se asignan automáticamente según el consumo total del cliente.
              </p>
            </div>
          </section>

          {/* Sección: catálogo de specs */}
          <section id="specs" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100/70 text-blue-600">
                <Beaker size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Catálogo de especificaciones</h2>
                <p className="text-[11px] text-gray-400">Parámetros físico-químicos que tus productos pueden requerir</p>
              </div>
            </div>
            <CatalogoSpecs />
          </section>

          {/* Sección: sub-categorías de materias primas */}
          <section id="subcategorias-mp" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-purple-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100/70 text-purple-600">
                <Beaker size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Sub-categorías de materias primas</h2>
                <p className="text-[11px] text-gray-400">Familias químicas: resina, agua, pigmento… Clasifican las MP.</p>
              </div>
            </div>
            <CatalogoSubcategorias
              color="purple"
              api={{
                listar:   configuracionApi.listarSubcategoriasMP,
                crear:    configuracionApi.crearSubcategoriaMP,
                editar:   configuracionApi.editarSubcategoriaMP,
                eliminar: configuracionApi.eliminarSubcategoriaMP,
              }}
              descripcion="Familias químicas usadas para clasificar materias primas (Resina, Agua, Pigmento…). Renombrar aquí propaga el cambio a todos los productos que la tengan asignada."
              placeholderNueva="Nueva sub-categoría (ej. Tensioactivo)"
            />
          </section>

          {/* Sección: sub-categorías de material de embalaje */}
          <section id="subcategorias-me" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100/70 text-amber-600">
                <Package size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Sub-categorías de material de embalaje</h2>
                <p className="text-[11px] text-gray-400">Bote, Caja, Etiqueta, Tapón… El tipo determina qué campo se pide al crear el producto.</p>
              </div>
            </div>
            <CatalogoSubcategorias
              color="amber"
              api={{
                listar:   configuracionApi.listarSubcategoriasME,
                crear:    configuracionApi.crearSubcategoriaME,
                editar:   configuracionApi.editarSubcategoriaME,
                eliminar: configuracionApi.eliminarSubcategoriaME,
              }}
              descripcion="Clasifica los embalajes por rol: Bote/Garrafa (contienen cola, indica kg dentro), Caja (multiplica botes), Etiqueta/Tapón/Otro (consumibles). El modal de Producto mostrará solo el campo relevante."
              placeholderNueva="Nueva sub-categoría (ej. Bolsa)"
            />
          </section>

          {/* Sección: tipos de material de embalaje (Plástico, Cartón…) */}
          <section id="tipos-material" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-orange-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100/70 text-orange-600">
                <Package size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Materiales de embalaje</h2>
                <p className="text-[11px] text-gray-400">Plástico, Cartón, Madera, Vidrio… Permite saber cuánto material gasta cada fabricación.</p>
              </div>
            </div>
            <CatalogoSubcategorias
              color="amber"
              api={{
                listar:   configuracionApi.listarTiposMaterial,
                crear:    configuracionApi.crearTipoMaterial,
                editar:   configuracionApi.editarTipoMaterial,
                eliminar: configuracionApi.eliminarTipoMaterial,
              }}
              descripcion="Cada embalaje (bote, caja, palé…) puede llevar asignado un material y su peso vacío en la ficha del producto. Al renombrar aquí se propaga a los productos que lo tengan."
              placeholderNueva="Nuevo material (ej. PET, Aluminio)"
            />
          </section>

          {/* Sección: integración Alilo */}
          <section id="integracion-alilo" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100/70 text-violet-600">
                <ShieldCheck size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Integración Alilo</h2>
                <p className="text-[11px] text-gray-400">El otro sistema en la fábrica puede descontar stock vía API HMAC. Activar con <code className="text-violet-600">ALILO_SHARED_SECRET</code> en .env.</p>
              </div>
            </div>
            <IntegracionAlilo />
          </section>

          {/* Sección: backup */}
          <section id="backup" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100/70 text-emerald-600">
                <Database size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Backup de Base de Datos</h2>
                <p className="text-[11px] text-gray-400">Copia cifrada — 2 locales (hoy + ayer) y 10 en Google Drive</p>
              </div>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    setBackupLoading(true);
                    setBackupResult(null);
                    try {
                      const { data } = await notify.promise(configuracionApi.backup(), {
                        loading: 'Creando backup…',
                        success: 'Backup completado',
                        successDesc: (r) => {
                          const d = (r as { data: { filename?: string; size?: string; local?: boolean; drive?: boolean; driveError?: string } }).data;
                          return (
                            <ToastBlock title={d.filename}>
                              <ToastField label="Tamaño" value={d.size} />
                              <ToastField label="Local" value={d.local ? 'OK' : 'NO'} />
                              <ToastField label="Drive" value={d.drive ? 'OK' : (d.driveError ? `Falló: ${d.driveError}` : 'no')} />
                            </ToastBlock>
                          );
                        },
                        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al crear backup',
                      });
                      const d = data as { ok?: boolean; mensaje?: string; error?: string; local?: boolean; drive?: boolean; driveError?: string; filename?: string };
                      if (d.local) {
                        const detalle = d.drive ? 'local + Drive OK' : `local OK · Drive falló (${d.driveError ?? 'desconocido'})`;
                        setBackupResult(`Backup ${d.filename} — ${detalle}`);
                      } else {
                        setBackupResult(`Error: ${d.error ?? 'sin detalle'}`);
                      }
                    } catch (err: unknown) {
                      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                      setBackupResult(msg ?? 'Error al crear backup');
                    } finally {
                      setBackupLoading(false);
                    }
                  }}
                  disabled={backupLoading}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-gray-900 to-gray-700 px-4 py-2 text-xs font-semibold text-white hover:from-gray-800 hover:to-gray-600 disabled:opacity-60 transition-all shadow-md shadow-gray-200"
                >
                  <HardDrive size={13} />
                  {backupLoading ? 'Creando backup…' : 'Crear Backup Ahora'}
                </button>
                {backupResult && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${backupResult.startsWith('Error') ? 'bg-red-50 text-loga-red border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                    {backupResult.startsWith('Error') ? <AlertCircle size={11}/> : <CheckCircle2 size={11}/>}
                    {backupResult}
                  </span>
                )}
              </div>

              {/* Contraseña de cifrado del backup */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Contraseña de cifrado / Drive</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Cifra cada backup antes de subirlo a Google Drive. Necesaria también para restaurarlo.
                    </p>
                  </div>
                  {backupPassStatus && (
                    <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${backupPassStatus.configurada ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {backupPassStatus.configurada ? `Configurada · ${backupPassStatus.longitud} chars (${backupPassStatus.origen})` : 'Sin configurar'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={backupPassVisible ? 'text' : 'password'}
                      value={backupPassNueva}
                      onChange={(e) => setBackupPassNueva(e.target.value)}
                      placeholder="Nueva contraseña (mín. 12 caracteres)"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono pr-9 focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setBackupPassVisible(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      title={backupPassVisible ? 'Ocultar' : 'Mostrar'}
                    >
                      {backupPassVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={async () => {
                      if (backupPassNueva.length < 12) {
                        setBackupResult('Error: la contraseña debe tener al menos 12 caracteres');
                        return;
                      }
                      if (!window.confirm('IMPORTANTE: si cambias la contraseña, los backups anteriores NO se podrán restaurar con la nueva. Anota la nueva clave en un sitio seguro. ¿Continuar?')) return;
                      setBackupPassSaving(true);
                      try {
                        await configuracionApi.backupPasswordSet(backupPassNueva);
                        notify.success('Contraseña actualizada');
                        setBackupPassNueva('');
                        const { data } = await configuracionApi.backupPasswordStatus();
                        setBackupPassStatus(data as any);
                      } catch (err: unknown) {
                        notify.error('Error', { description: (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '' });
                      } finally { setBackupPassSaving(false); }
                    }}
                    disabled={backupPassSaving || backupPassNueva.length < 12}
                    className="rounded-lg bg-loga-red px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    {backupPassSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
                <p className="text-[10px] text-amber-700">
                  ⚠ Anota esta contraseña fuera del ERP. Sin ella no podrás restaurar ningún backup.
                </p>
              </div>

              {/* Google Drive OAuth */}
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Google Drive — copia en la nube</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Tras crear el backup local cifrado, se sube a tu Drive automáticamente.
                    </p>
                  </div>
                  {gdriveStatus && (
                    <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${
                      gdriveStatus.autorizado ? 'bg-emerald-100 text-emerald-700'
                      : gdriveStatus.client_id_configurado ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {gdriveStatus.autorizado ? `Conectado · ${gdriveStatus.email ?? ''}`
                       : gdriveStatus.client_id_configurado ? 'Credenciales OK, sin autorizar'
                       : 'Sin configurar'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={gdriveClientId}
                    onChange={(e) => setGdriveClientId(e.target.value)}
                    placeholder="Client ID (xxx.apps.googleusercontent.com)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono"
                  />
                  <input
                    type="password"
                    value={gdriveClientSecret}
                    onChange={(e) => setGdriveClientSecret(e.target.value)}
                    placeholder="Client Secret"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <input
                  value={gdriveFolderId}
                  onChange={(e) => setGdriveFolderId(e.target.value)}
                  placeholder="Folder ID (opcional — id de la carpeta de Drive donde subir)"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!gdriveClientId.trim() || !gdriveClientSecret.trim()) {
                        notify.error('Client ID y Secret obligatorios'); return;
                      }
                      setGdriveSaving(true);
                      try {
                        await configuracionApi.gdriveSave({
                          client_id: gdriveClientId.trim(),
                          client_secret: gdriveClientSecret.trim(),
                          folder_id: gdriveFolderId.trim() || undefined,
                        });
                        setGdriveClientSecret('');
                        notify.success('Credenciales guardadas');
                        const { data } = await configuracionApi.gdriveStatus();
                        setGdriveStatus(data as any);
                      } catch (err: any) {
                        notify.error('Error', { description: err?.response?.data?.error ?? '' });
                      } finally { setGdriveSaving(false); }
                    }}
                    disabled={gdriveSaving}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
                  >
                    {gdriveSaving ? 'Guardando…' : 'Guardar credenciales'}
                  </button>

                  {gdriveStatus?.client_id_configurado && !gdriveStatus.autorizado && (
                    <button
                      onClick={async () => {
                        try {
                          const redirectUri = `${window.location.origin}${window.location.pathname}`;
                          const { data } = await configuracionApi.gdriveAuthorize(redirectUri);
                          // Guardamos state para identificar el callback
                          const url = new URL((data as any).url);
                          url.searchParams.set('state', 'gdrive');
                          window.location.href = url.toString();
                        } catch (err: any) {
                          notify.error('Error', { description: err?.response?.data?.error ?? '' });
                        }
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Autorizar acceso a Drive
                    </button>
                  )}

                  {gdriveStatus?.autorizado && (
                    <button
                      onClick={async () => {
                        if (!window.confirm('¿Desconectar Drive? Los backups dejarán de subirse automáticamente.')) return;
                        try {
                          await configuracionApi.gdriveDisconnect();
                          notify.success('Drive desconectado');
                          const { data } = await configuracionApi.gdriveStatus();
                          setGdriveStatus(data as any);
                        } catch { /* */ }
                      }}
                      className="rounded-lg bg-red-50 text-loga-red px-3 py-1.5 text-xs font-semibold border border-red-200 hover:bg-red-100"
                    >
                      Desconectar
                    </button>
                  )}
                </div>

                <div className="text-[10px] text-gray-500 space-y-0.5">
                  <p>1. En Google Cloud Console crea un OAuth 2.0 Client (tipo Web).</p>
                  <p>2. <b>Authorized redirect URI</b>: copia esta URL exactamente <code className="bg-white px-1 rounded">{typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''}</code></p>
                  <p>3. Habilita la API "Google Drive API" en tu proyecto.</p>
                  <p>4. Pega Client ID + Secret, guarda, y autoriza.</p>
                </div>
              </div>

              {/* Lista de backups disponibles */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-700">Backups disponibles</p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { data } = await configuracionApi.listarBackups();
                        setBackupsList(data as typeof backupsList);
                      } catch { setBackupsList([]); }
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline font-medium"
                  >
                    Actualizar lista
                  </button>
                </div>
                {backupsList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
                    <Database size={20} className="mx-auto text-gray-300 mb-1.5" />
                    <p className="text-xs text-gray-400">Pulsa "Actualizar lista" para ver los backups disponibles.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {backupsList.map(b => (
                      <div key={b.filename} className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                          <HardDrive size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono font-semibold text-gray-700 truncate">{b.filename}</p>
                          <p className="text-[10px] text-gray-400">{b.date} · {b.size}</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`¿Restaurar ${b.filename}?\n\nEsto REEMPLAZARÁ todos los datos actuales con los del backup. Esta acción no se puede deshacer.`)) return;
                            setRestoreLoading(true);
                            setRestoreResult(null);
                            try {
                              const { data } = await notify.promise(configuracionApi.restaurarBackup(b.filename), {
                                loading: 'Restaurando backup…',
                                success: 'Backup restaurado',
                                successDesc: 'Recarga la página',
                                error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al restaurar',
                              });
                              const d = data as { ok?: boolean; message?: string };
                              setRestoreResult(d.ok ? 'Backup restaurado correctamente. Recarga la página.' : `Error: ${d.message}`);
                            } catch (err: unknown) {
                              const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                              setRestoreResult(msg ?? 'Error al restaurar');
                            } finally {
                              setRestoreLoading(false);
                            }
                          }}
                          disabled={restoreLoading}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50 transition-all"
                        >
                          {restoreLoading ? 'Restaurando…' : 'Restaurar'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {restoreResult && (
                  <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${restoreResult.startsWith('Error') ? 'bg-red-50 border border-red-100 text-loga-red' : 'bg-emerald-50 border border-emerald-100 text-emerald-700 font-semibold'}`}>
                    {restoreResult.startsWith('Error') ? <AlertCircle size={12} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={12} className="mt-0.5 shrink-0" />}
                    <p>{restoreResult}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Historial de actividad · con buscador y filtros */}
          <HistorialActividad />
          {/* (sección renderizada por componente externo abajo) */}

        </div>
      </div>

      {/* Sticky save bar · contextual: solo si hay cambios o se está guardando.
          Indica claramente qué pasa, ofrece descartar, y mantiene el botón
          guardar siempre accesible. */}
      {(hayCambios || savedConfig || savingConfig) && (
        <div className={clsx(
          'fixed bottom-0 left-0 right-0 z-30 border-t backdrop-blur-md transition-colors',
          hayCambios
            ? 'border-amber-200 bg-amber-50/95 shadow-[0_-6px_24px_rgba(245,158,11,0.15)]'
            : 'border-gray-100 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]'
        )}>
          <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-3 flex-wrap">
            {hayCambios && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-bold text-amber-900">Cambios sin guardar</span>
                <button
                  onClick={() => { if (configInicial) setConfig(configInicial); setSmtpPass(''); }}
                  className="text-[11px] text-gray-500 hover:text-loga-red underline decoration-dotted ml-2"
                >
                  Descartar
                </button>
              </div>
            )}
            {savedConfig && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-200 px-3 py-1 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={12} /> Guardado correctamente
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={handleRecheck}
              disabled={recheckLoading}
              className="hidden sm:flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
            >
              <Bell size={13} />
              {recheckLoading ? 'Evaluando…' : 'Re-evaluar alertas'}
            </button>
            <button
              onClick={guardarConfig}
              disabled={savingConfig || !hayCambios}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-loga-red to-loga-red-dark px-5 py-2 text-xs font-bold text-white hover:shadow-lg hover:shadow-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-red-100"
            >
              <Save size={13} />
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        </div>
      )}

      {/* Botón "Re-evaluar alertas" siempre visible cuando no hay cambios pendientes. */}
      {!hayCambios && !savedConfig && !savingConfig && (
        <div className="fixed bottom-6 right-6 z-20">
          <button
            onClick={handleRecheck}
            disabled={recheckLoading}
            className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-lg"
          >
            <Bell size={13} />
            {recheckLoading ? 'Evaluando…' : 'Re-evaluar alertas'}
          </button>
        </div>
      )}

    </div>
  );
}
