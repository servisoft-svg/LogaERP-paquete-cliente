import { useEffect, useState } from 'react';
import { Copy, Check, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff, Key } from 'lucide-react';
import clsx from 'clsx';
import { configuracionApi } from '../api/client';
import { notify } from '../lib/notify';

interface AliloStatus {
  activo: boolean;
  url: string;
  shared_secret: string;
  productos_compartidos: { codigo: string; nombre: string; unidad_medida: string; stock_actual: string }[];
  instrucciones: string;
}

interface AliloLog {
  id: string;
  endpoint: string;
  payload: Record<string, unknown> | null;
  status_code: number;
  respuesta: Record<string, unknown> | null;
  ip_origen: string | null;
  error: string | null;
  created_at: string;
}

function statusBadge(code: number) {
  if (code >= 200 && code < 300) return { txt: code, cls: 'bg-emerald-100 text-emerald-700' };
  if (code === 401 || code === 403) return { txt: code, cls: 'bg-red-100 text-red-700' };
  if (code === 404 || code === 422) return { txt: code, cls: 'bg-amber-100 text-amber-700' };
  return { txt: code, cls: 'bg-gray-100 text-gray-700' };
}

export default function IntegracionAlilo() {
  const [status, setStatus] = useState<AliloStatus | null>(null);
  const [log, setLog] = useState<AliloLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [regenerando, setRegenerando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        configuracionApi.aliloStatus(),
        configuracionApi.aliloLog(),
      ]);
      setStatus(s.data as AliloStatus);
      setLog(l.data as AliloLog[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); }, []);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      notify.error('No se pudo copiar');
    }
  };

  const ejemploCurl = status ? `# 1. Genera idempotency key (UUID v4) y timestamp
KEY=$(uuidgen)
TS=$(date +%s)
BODY='{"codigo":"MP-001","cantidad":12.5,"motivo":"fabricacion-alilo-1234","idempotency_key":"'$KEY'"}'

# 2. Firma con HMAC-SHA256 del SECRET compartido
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "TU_ALILO_SHARED_SECRET" -hex | awk '{print $2}')

# 3. POST a Loga
curl -X POST "${status.url}" \\
  -H "Content-Type: application/json" \\
  -H "X-Timestamp: $TS" \\
  -H "X-Signature: $SIG" \\
  -d "$BODY"` : '';

  const ejemploNode = status ? `import crypto from 'node:crypto';

async function consumirEnLoga(codigo, cantidad, motivo, SECRET) {
  const idempotencyKey = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ codigo, cantidad, motivo, idempotency_key: idempotencyKey });
  const signature = crypto.createHmac('sha256', SECRET)
    .update(\`\${ts}.\${body}\`)
    .digest('hex');

  const res = await fetch('${status.url}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timestamp': String(ts),
      'X-Signature': signature,
    },
    body,
  });
  return res.json();
}` : '';

  if (loading) {
    return (
      <div className="px-5 py-6 flex items-center justify-center">
        <span className="h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!status) {
    return <p className="px-5 py-4 text-sm text-gray-400 italic">No se pudo cargar el estado.</p>;
  }

  return (
    <div className="px-5 py-5 space-y-5">
      {/* Estado */}
      <div className={clsx(
        'flex items-start gap-3 rounded-xl border p-3',
        status.activo ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40',
      )}>
        {status.activo
          ? <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 shrink-0" />
          : <AlertCircle  size={18} className="text-amber-600  mt-0.5 shrink-0" />
        }
        <div className="flex-1">
          <p className={clsx('text-sm font-semibold', status.activo ? 'text-emerald-800' : 'text-amber-800')}>
            {status.activo ? 'Integración activa' : 'Integración deshabilitada'}
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">{status.instrucciones}</p>
        </div>
        <button
          onClick={cargar}
          className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
          title="Recargar"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* URL del endpoint */}
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">URL del endpoint</p>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <code className="flex-1 text-[11px] font-mono text-gray-700 break-all">{status.url}</code>
          <button
            onClick={() => copy(status.url, 'url')}
            className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
          >
            {copied === 'url' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Shared secret (HMAC) — auto-generado al arrancar Loga */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Key size={11} className="text-violet-600" /> Shared Secret HMAC
          </p>
          <button
            onClick={async () => {
              if (!confirm('¿Regenerar el secret? Tendrás que actualizar el secret en Alilo también o las llamadas dejarán de funcionar.')) return;
              setRegenerando(true);
              try {
                await configuracionApi.aliloRegenerarSecret();
                notify.success('Secret regenerado');
                await cargar();
              } catch { notify.error('Error al regenerar'); }
              finally { setRegenerando(false); }
            }}
            disabled={regenerando}
            className="inline-flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 disabled:opacity-40"
          >
            <RefreshCw size={11} className={clsx(regenerando && 'animate-spin')} /> Regenerar
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2">
          <code className="flex-1 text-[11px] font-mono text-violet-900 break-all select-all">
            {showSecret ? status.shared_secret : '•'.repeat(Math.min(status.shared_secret.length, 64))}
          </code>
          <button
            onClick={() => setShowSecret(s => !s)}
            className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
            title={showSecret ? 'Ocultar' : 'Mostrar'}
          >
            {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={() => copy(status.shared_secret, 'secret')}
            className="rounded-md p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
            title="Copiar"
          >
            {copied === 'secret' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          </button>
        </div>
        <p className="text-[10px] text-gray-500 mt-1.5">
          Auto-generado al arrancar Loga. Cópialo y pégalo en la configuración del sistema Alilo para que pueda autenticar.
        </p>
      </div>

      {/* Productos compartidos */}
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
          Productos compartidos ({status.productos_compartidos.length})
        </p>
        {status.productos_compartidos.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic rounded-lg border border-dashed border-gray-200 px-3 py-3">
            Sin productos compartidos. Marca el checkbox "🔗 Producto compartido con Alilo" en algún producto.
          </p>
        ) : (
          <div className="rounded-lg border border-violet-100 bg-violet-50/30 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-violet-50/60 text-violet-700">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Código</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Nombre</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Stock</th>
                </tr>
              </thead>
              <tbody>
                {status.productos_compartidos.map((p) => (
                  <tr key={p.codigo} className="border-t border-violet-100/60">
                    <td className="px-3 py-1.5 font-mono text-violet-800">{p.codigo}</td>
                    <td className="px-3 py-1.5 text-gray-700">{p.nombre}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ejemplos de código */}
      <details className="rounded-xl border border-gray-200 bg-gray-50/40 open:bg-white">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-700">
          📋 Ejemplo de llamada (para el sistema Alilo)
        </summary>
        <div className="px-3 pb-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-gray-500 uppercase">Bash / curl</p>
              <button onClick={() => copy(ejemploCurl, 'curl')} className="text-[10px] text-violet-600 hover:underline">
                {copied === 'curl' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="rounded-md bg-gray-900 text-gray-100 p-3 text-[10px] font-mono overflow-x-auto leading-relaxed">{ejemploCurl}</pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-gray-500 uppercase">Node.js</p>
              <button onClick={() => copy(ejemploNode, 'node')} className="text-[10px] text-violet-600 hover:underline">
                {copied === 'node' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="rounded-md bg-gray-900 text-gray-100 p-3 text-[10px] font-mono overflow-x-auto leading-relaxed">{ejemploNode}</pre>
          </div>
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
            <b>⚠ ALILO_SHARED_SECRET</b>: define el mismo valor en <code className="bg-amber-100 px-1 rounded">backend/.env</code> de Loga
            (variable <code className="bg-amber-100 px-1 rounded">ALILO_SHARED_SECRET</code>) y en la configuración de Alilo.
            Genera uno con: <code className="bg-amber-100 px-1 rounded">openssl rand -hex 32</code>
          </div>
        </div>
      </details>

      {/* Log */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Últimas llamadas ({log.length})</p>
          <button onClick={cargar} className="text-[10px] text-violet-600 hover:underline inline-flex items-center gap-1">
            <RefreshCw size={10} /> Recargar
          </button>
        </div>
        {log.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic rounded-lg border border-dashed border-gray-200 px-3 py-3">
            Sin llamadas registradas todavía.
          </p>
        ) : (
          <div className="rounded-lg border border-gray-100 overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="text-gray-500">
                  <th className="px-2 py-1.5 text-left font-medium">Hora</th>
                  <th className="px-2 py-1.5 text-left font-medium">Endpoint</th>
                  <th className="px-2 py-1.5 text-center font-medium">Status</th>
                  <th className="px-2 py-1.5 text-left font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => {
                  const b = statusBadge(l.status_code);
                  const payloadStr = l.payload
                    ? `${(l.payload as any).codigo ?? '?'} ×${(l.payload as any).cantidad ?? '?'}`
                    : '—';
                  return (
                    <tr key={l.id} className="border-t border-gray-50">
                      <td className="px-2 py-1.5 font-mono text-gray-400 whitespace-nowrap">
                        {new Date(l.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-gray-600 truncate max-w-[120px]" title={l.endpoint}>{l.endpoint}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums', b.cls)}>
                          {b.txt}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-600 truncate max-w-[180px]" title={l.error ?? payloadStr}>
                        {l.error ?? payloadStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
