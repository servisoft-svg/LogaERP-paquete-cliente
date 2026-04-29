import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Percent, Mail, Bell, Eye, EyeOff, SendHorizontal, HardDrive, Building } from 'lucide-react';
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
    <div className="animate-fade-in space-y-8 max-w-3xl">
      {/* Cabecera */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
          <Settings size={20} className="text-gray-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Configuración</h1>
          <p className="text-xs text-gray-400">Parámetros globales del ERP</p>
        </div>
      </div>

      {/* Sección: datos de empresa */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Building size={15} className="text-loga-red" />
          <h2 className="text-sm font-semibold text-gray-800">Datos de la Empresa</h2>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-gray-400">Estos datos aparecen en albaranes, facturas y PDFs.</p>
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
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Percent size={15} className="text-loga-red" />
          <h2 className="text-sm font-semibold text-gray-800">Alertas de Stock</h2>
        </div>
        <div className="px-5 py-5 space-y-4">
          <FormField
            label="Umbral de alerta (%)"
            hint="Porcentaje POR ENCIMA del stock mínimo para activar alerta naranja. Ej: 20 = naranja cuando stock ≤ mínimo × 1.20"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={config?.porcentaje_alerta ?? '20'}
                onChange={(e) => setConfig((c) => c ? { ...c, porcentaje_alerta: e.target.value } : c)}
                className="w-32"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </FormField>
        </div>
      </section>

      {/* Sección: email */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Mail size={15} className="text-loga-red" />
          <h2 className="text-sm font-semibold text-gray-800">Email de Pedidos</h2>
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
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSmtpPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </FormField>

          {/* Botón Probar SMTP */}
          <div className="flex items-center gap-3">
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
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
            >
              <SendHorizontal size={13} />
              {testSmtpLoading ? 'Enviando…' : 'Probar SMTP'}
            </button>
            {testSmtpResult && (
              <p className={`text-xs ${testSmtpResult.startsWith('Error') ? 'text-loga-red' : 'text-emerald-600'}`}>
                {testSmtpResult}
              </p>
            )}
          </div>

          {/* Editor + Preview en columnas */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
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
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3 min-h-[220px]">
                {/* Asunto */}
                <div>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Asunto</span>
                  <p className="mt-0.5 text-xs font-semibold text-gray-800 bg-white rounded-lg px-3 py-1.5 border border-gray-100">
                    Pedido {EJEMPLO.producto} — Fábrica Loga
                  </p>
                </div>
                {/* De */}
                <div>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">De</span>
                  <p className="mt-0.5 text-xs text-gray-600 bg-white rounded-lg px-3 py-1.5 border border-gray-100">
                    {config?.email_remitente || 'erp@loga.es'}
                  </p>
                </div>
                {/* Cuerpo */}
                <div>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cuerpo</span>
                  <pre className="mt-0.5 text-xs text-gray-700 bg-white rounded-lg px-3 py-2.5 border border-gray-100 whitespace-pre-wrap font-sans leading-relaxed min-h-[80px]">
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

      {/* Guardar configuración global */}
      {errorConfig && (
        <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
          {errorConfig}
        </p>
      )}
      {savedConfig && (
        <p className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-700">
          Configuración guardada correctamente.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={guardarConfig}
          disabled={savingConfig}
          className="flex items-center gap-2 rounded-lg bg-loga-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors shadow-sm"
        >
          <Save size={15} />
          {savingConfig ? 'Guardando…' : 'Guardar configuración'}
        </button>
        <button
          onClick={handleRecheck}
          disabled={recheckLoading}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
        >
          <Bell size={15} />
          {recheckLoading ? 'Evaluando…' : 'Re-evaluar alertas ahora'}
        </button>
      </div>
      {recheckResult && (
        <p className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
          {recheckResult}
        </p>
      )}

      {/* Sección: niveles de cliente */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <Settings size={15} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-800">Niveles de cliente (medallas)</h2>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-xs text-gray-500">
            Umbrales de consumo total en EUR para asignar nivel al cliente. Se recalcula automáticamente al guardar.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Bronce (EUR)" hint="Mínimo para bronce">
              <Input
                type="number" min="0" step="1000"
                value={config?.nivel_bronce ?? '20000'}
                onChange={e => setConfig(c => c ? { ...c, nivel_bronce: e.target.value } : c)}
                className="text-center"
              />
            </FormField>
            <FormField label="Plata (EUR)" hint="Mínimo para plata">
              <Input
                type="number" min="0" step="1000"
                value={config?.nivel_plata ?? '80000'}
                onChange={e => setConfig(c => c ? { ...c, nivel_plata: e.target.value } : c)}
                className="text-center"
              />
            </FormField>
            <FormField label="Oro (EUR)" hint="Mínimo para oro">
              <Input
                type="number" min="0" step="1000"
                value={config?.nivel_oro ?? '150000'}
                onChange={e => setConfig(c => c ? { ...c, nivel_oro: e.target.value } : c)}
                className="text-center"
              />
            </FormField>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="inline-flex rounded-full bg-gradient-to-r from-amber-600 to-orange-700 px-1.5 py-0.5 text-[7px] font-black text-white">BRONCE</span>
            <span className="inline-flex rounded-full bg-gradient-to-r from-gray-300 to-gray-400 px-1.5 py-0.5 text-[7px] font-black text-white">PLATA</span>
            <span className="inline-flex rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-1.5 py-0.5 text-[7px] font-black text-white">ORO</span>
            <span>— Se asignan automáticamente según consumo del cliente</span>
          </div>
          <button
            onClick={guardarConfig}
            disabled={savingConfig}
            className="flex items-center gap-2 rounded-lg bg-loga-red px-4 py-2 text-xs font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors shadow-sm"
          >
            <Save size={13} />
            {savingConfig ? 'Guardando…' : 'Guardar niveles'}
          </button>
          {savedConfig && (
            <p className="text-xs text-emerald-600 font-medium">Niveles guardados y clientes recalculados.</p>
          )}
        </div>
      </section>

      {/* Sección: backup */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <HardDrive size={15} className="text-loga-red" />
          <h2 className="text-sm font-semibold text-gray-800">Backup de Base de Datos</h2>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-xs text-gray-500">
            Genera una copia cifrada de la base de datos. Se conservan 2 copias locales (hoy + ayer) y 10 en Google Drive.
          </p>
          <div className="flex items-center gap-3">
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
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:bg-gray-300 transition-colors shadow-sm"
            >
              <HardDrive size={13} />
              {backupLoading ? 'Creando backup…' : 'Crear Backup Ahora'}
            </button>
            {backupResult && (
              <p className={`text-xs ${backupResult.startsWith('Error') ? 'text-loga-red' : 'text-emerald-600'}`}>
                {backupResult}
              </p>
            )}
          </div>
          {/* Lista de backups disponibles */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-600">Backups disponibles</p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { data } = await configuracionApi.listarBackups();
                    setBackupsList(data as typeof backupsList);
                  } catch { setBackupsList([]); }
                }}
                className="text-[11px] text-blue-600 hover:underline font-medium"
              >
                Actualizar lista
              </button>
            </div>
            {backupsList.length === 0 ? (
              <p className="text-xs text-gray-400">Pulsa "Actualizar lista" para ver los backups disponibles.</p>
            ) : (
              <div className="space-y-1.5">
                {backupsList.map(b => (
                  <div key={b.filename} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <HardDrive size={14} className="text-gray-400 shrink-0" />
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
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      {restoreLoading ? 'Restaurando…' : 'Restaurar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {restoreResult && (
              <p className={`text-xs mt-2 ${restoreResult.startsWith('Error') ? 'text-loga-red' : 'text-emerald-600 font-semibold'}`}>
                {restoreResult}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Historial de actividad */}
      <section className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-800">Historial de actividad</h2>
          <span className="text-[10px] text-gray-400">ultimas 50 entradas</span>
        </div>
        <div className="overflow-x-auto">
          {auditoria.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-gray-400">No hay entradas de auditoria.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Fecha', 'Usuario', 'Accion', 'Detalle'].map(h => (
                    <th key={h} className="px-4 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {auditoria.map((a: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(a.fecha).toLocaleString('es-ES')}</td>
                    <td className="px-4 py-2 font-medium text-gray-700">{a.usuario_nombre ?? 'Sistema'}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{a.accion}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{a.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

    </div>
  );
}
