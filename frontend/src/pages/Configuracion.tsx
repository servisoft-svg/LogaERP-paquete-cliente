import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, Percent, Mail, Bell, Eye, EyeOff, SendHorizontal, HardDrive, Building,
  ShieldCheck, History, Award, CheckCircle2, AlertCircle, Info, Database, ChevronRight,
} from 'lucide-react';
import { configuracionApi } from '../api/client';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
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
}

const TOC = [
  { id: 'empresa',  label: 'Empresa',     icon: Building },
  { id: 'alertas',  label: 'Alertas',     icon: Percent },
  { id: 'email',    label: 'Email',       icon: Mail },
  { id: 'niveles',  label: 'Niveles',     icon: Award },
  { id: 'backup',   label: 'Backup',      icon: Database },
  { id: 'historial',label: 'Historial',   icon: History },
];

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
  const [auditoria, setAuditoria]         = useState<{ id: string; accion: string; tabla_afectada: string; registro_id: string; motivo: string; created_at: string; usuario_nombre?: string }[]>([]);

  // Audit log
  // auditLog removed — using auditoria state below



  const cargar = useCallback(async () => {
    try {
      const [cfgRes, auditRes] = await Promise.all([
        configuracionApi.obtener(),
        configuracionApi.auditoria().catch(() => ({ data: [] })),
      ]);
      const cfg = cfgRes.data as Config;
      setConfig(cfg);
      setAuditoria(auditRes.data as typeof auditoria);
    } catch {
      setErrorConfig('Error al cargar la configuración');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

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
    <div className="animate-fade-in pb-28">
      {/* Hero */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-gradient-to-br from-white via-gray-50 to-red-50/40 px-6 py-6 shadow-sm">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-loga-red/5 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-loga-red to-loga-red-dark text-white shadow-md shadow-red-200">
            <Settings size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Configuración</h1>
            <p className="text-xs text-gray-500">Parámetros globales del ERP — empresa, alertas, email, niveles y respaldos</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-8 max-w-6xl">
        {/* TOC sticky */}
        <aside className="hidden lg:block">
          <nav className="sticky top-6 space-y-1 rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
            {TOC.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-loga-red transition-colors"
              >
                <Icon size={13} className="text-gray-400 group-hover:text-loga-red" />
                <span className="flex-1">{label}</span>
                <ChevronRight size={12} className="text-gray-300 group-hover:text-loga-red" />
              </a>
            ))}
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
                    {['{​{producto}}', '{​{cantidad}}', '{​{unidad}}', '{​{proveedor}}'].map((v) => (
                      <code key={v} className="mx-0.5 rounded bg-gray-100 px-1 text-gray-600">{v}</code>
                    ))}
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
                        {(config?.plantilla_email ?? '')
                          .replace(/\{\{producto\}\}/g, EJEMPLO.producto)
                          .replace(/\{\{cantidad\}\}/g, EJEMPLO.cantidad)
                          .replace(/\{\{unidad\}\}/g, EJEMPLO.unidad)
                          .replace(/\{\{proveedor\}\}/g, EJEMPLO.proveedor)
                          || '(escribe la plantilla a la izquierda)'}
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
                          const d = (r as { data: { filename?: string; size?: string; local?: boolean; drive?: boolean } }).data;
                          return (
                            <ToastBlock title={d.filename}>
                              <ToastField label="Tamaño" value={d.size} />
                              <ToastField label="Destinos" value={[d.local && 'local', d.drive && 'Drive'].filter(Boolean).join(' · ') || ''} />
                            </ToastBlock>
                          );
                        },
                        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al crear backup',
                      });
                      const d = data as { ok?: boolean; mensaje?: string; error?: string };
                      setBackupResult(d.ok ? d.mensaje ?? 'Backup completado.' : `Error: ${d.error}`);
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

          {/* Historial de actividad */}
          <section id="historial" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-100/60 to-transparent">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                <History size={15} />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-800">Historial de actividad</h2>
                <p className="text-[11px] text-gray-400">Últimas 50 entradas de auditoría</p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{auditoria.length}</span>
            </div>
            <div className="overflow-x-auto">
              {auditoria.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <History size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs text-gray-400">No hay entradas de auditoría.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50/60">
                    <tr>
                      {['Fecha', 'Usuario', 'Accion', 'Detalle'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {auditoria.map((a: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap font-mono text-[11px]">{new Date(a.fecha).toLocaleString('es-ES')}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-700">{a.usuario_nombre ?? 'Sistema'}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{a.accion}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate">{a.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white/85 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3 flex-wrap">
          {savedConfig && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 size={12} /> Guardado
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={handleRecheck}
            disabled={recheckLoading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
          >
            <Bell size={13} />
            {recheckLoading ? 'Evaluando…' : 'Re-evaluar alertas'}
          </button>
          <button
            onClick={guardarConfig}
            disabled={savingConfig}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-loga-red to-loga-red-dark px-5 py-2 text-xs font-semibold text-white hover:shadow-lg hover:shadow-red-200 disabled:opacity-60 disabled:hover:shadow-none transition-all shadow-md shadow-red-100"
          >
            <Save size={13} />
            {savingConfig ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </div>

    </div>
  );
}
