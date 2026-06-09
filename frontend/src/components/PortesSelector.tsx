import { useEffect, useState, useRef } from 'react';
import { Truck, Trophy, AlertCircle, Loader2 } from 'lucide-react';
import { portesApi, parseApiError } from '../api/client';
import clsx from 'clsx';

type Agencia = 'SCHENKER' | 'PALETRAPID' | 'PALLETWAYS';
type Servicio = 'ECONOMY' | 'PREMIUM';

interface Resultado {
  agencia: Agencia;
  total: number;
  desglose: Record<string, number | string | null>;
  error?: string;
}

interface Respuesta {
  provincia: string;
  zonas: { schenker: string | null; palletways: number | null };
  resultados: Resultado[];
  ganador: Resultado | null;
}

const LABEL: Record<Agencia, string> = {
  SCHENKER:   'Schenker',
  PALETRAPID: 'Paletrapid',
  PALLETWAYS: 'Palletways',
};

function fmtEUR(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n.toFixed(2) : String(v);
}

interface DesgloseSchenker {
  tipo: string; zona: string; escalon_kg: number; base_eur: number; cantidad: number;
  porte_bruto: number; subida_pct: number; porte_con_subida: number;
  seguro_eur: number; combustible_eur: number;
}

function DesgloseAgencia({ agencia, desglose, total }: {
  agencia: Agencia;
  desglose: Record<string, number | string | null>;
  total: number;
}) {
  if (agencia === 'SCHENKER') {
    const d = desglose as unknown as DesgloseSchenker;
    return (
      <dl className="mt-2 space-y-1 text-xs">
        <Row k={`Tabla ${d.tipo} · zona ${d.zona} · escalón ${d.escalon_kg} kg`} v={`${fmtEUR(d.base_eur)} €${d.tipo === 'KGC' ? '/100kg' : '/envío'}`} />
        {d.tipo === 'KGC' && <Row k={`Multiplicar × ${d.cantidad} (peso ÷ 100)`} v={`${fmtEUR(d.porte_bruto)} €`} />}
        <Row k="Porte bruto" v={`${fmtEUR(d.porte_bruto)} €`} muted />
        <Row k={`+ Subida tarifa (${d.subida_pct}%)`} v={`${fmtEUR(d.porte_con_subida - d.porte_bruto)} €`} />
        <Row k="Porte con subida" v={`${fmtEUR(d.porte_con_subida)} €`} muted />
        <Row k="+ Seguro (8%)" v={`${fmtEUR(d.seguro_eur)} €`} />
        <Row k="+ Combustible (9,76%)" v={`${fmtEUR(d.combustible_eur)} €`} />
        <Row k="TOTAL" v={`${fmtEUR(total)} €`} bold />
      </dl>
    );
  }
  if (agencia === 'PALETRAPID') {
    const rango = String(desglose.rango ?? '—').toUpperCase().replace('_', ' ');
    const serv = String(desglose.servicio ?? '');
    return (
      <dl className="mt-2 space-y-1 text-xs">
        <Row k="Rango aplicado" v={rango} />
        <Row k="Servicio" v={serv} />
        <Row k="Precio tarifa" v={`${fmtEUR(desglose.precio_eur)} €`} muted />
        <Row k="TOTAL" v={`${fmtEUR(total)} €`} bold />
      </dl>
    );
  }
  // PALLETWAYS
  const tipo = String(desglose.tipo_pallet ?? '—');
  const zona = String(desglose.zona ?? '—');
  const serv = String(desglose.servicio ?? '');
  return (
    <dl className="mt-2 space-y-1 text-xs">
      <Row k="Tipo pallet" v={tipo} />
      <Row k="Zona" v={zona} />
      <Row k="Servicio" v={serv} />
      <Row k="Precio tarifa" v={`${fmtEUR(desglose.precio_eur)} €`} muted />
      <Row k="TOTAL" v={`${fmtEUR(total)} €`} bold />
    </dl>
  );
}

function Row({ k, v, bold, muted }: { k: string; v: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={clsx('flex justify-between gap-3 items-baseline',
      bold && 'pt-1.5 mt-1 border-t border-gray-300 text-sm font-bold text-gray-900',
      muted && 'text-gray-500 italic',
      !bold && !muted && 'text-gray-700'
    )}>
      <dt className="text-left">{k}</dt>
      <dd className="tabular-nums shrink-0 font-medium">{v}</dd>
    </div>
  );
}

interface Props {
  /** peso bruto sugerido (kg). Sin override del usuario se usa este. */
  pesoSugeridoKg: number;
  /** provincia destino (ya normalizada o texto libre — el backend la normaliza). */
  provincia: string | null;
  /** valor actual elegido (para resaltar). */
  agenciaActual?: string | null;
  /** peso con el que se calculó el porte guardado (si lo hay). */
  pesoActual?: number | null;
  /** callback: el usuario elige una opción. importe en EUR (o null si limpia). */
  onElegir: (data: { agencia: Agencia | null; importe: number | null; pesoUsado: number | null }) => void;
}

export default function PortesSelector({ pesoSugeridoKg, provincia, agenciaActual, pesoActual, onElegir }: Props) {
  const [pesoOverride, setPesoOverride] = useState<string>('');
  const [servicio, setServicio] = useState<Servicio>('ECONOMY');
  const [resp, setResp] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // peso efectivo = override o sugerido
  const pesoEff = pesoOverride !== '' ? parseFloat(pesoOverride) : pesoSugeridoKg;
  const pesoValido = isFinite(pesoEff) && pesoEff > 0;
  const provNorm = (provincia || '').trim();

  // re-calcular con debounce al cambiar peso/provincia/servicio
  useEffect(() => {
    if (!pesoValido || !provNorm) { setResp(null); setErr(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setErr(null);
      try {
        const { data } = await portesApi.calcular({ peso: pesoEff, provincia: provNorm, servicio });
        setResp(data as Respuesta);
      } catch (e) {
        setErr(parseApiError(e).mensaje);
        setResp(null);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [pesoEff, pesoValido, provNorm, servicio]);

  if (!provNorm) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-center gap-1">
        <AlertCircle size={12} /> Necesita CP/provincia del cliente para calcular portes.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-blue-900 text-sm">
          <Truck size={18} /> Calculadora de portes
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Peso (kg)</span>
            <input
              type="number" min="0" step="0.1"
              value={pesoOverride}
              placeholder={pesoSugeridoKg > 0 ? pesoSugeridoKg.toFixed(1) : ''}
              onChange={e => setPesoOverride(e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Servicio</span>
            <select value={servicio} onChange={e => setServicio(e.target.value as Servicio)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value="ECONOMY">Economy</option>
              <option value="PREMIUM">Premium</option>
            </select>
          </label>
        </div>
      </div>

      {!pesoValido && (
        <p className="text-sm text-gray-500">Introduce un peso para comparar precios.</p>
      )}

      {loading && (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Comparando…
        </p>
      )}

      {err && (
        <p className="text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={14} /> {err}
        </p>
      )}

      {resp && (
        <div className="grid grid-cols-1 gap-3">
          {resp.resultados.map(r => {
            const sel = agenciaActual === r.agencia;
            const esGanador = resp.ganador?.agencia === r.agencia;
            const disabled = !!r.error;
            return (
              <button
                key={r.agencia}
                type="button"
                disabled={disabled}
                onClick={() => onElegir({ agencia: r.agencia, importe: r.total, pesoUsado: pesoEff })}
                className={clsx(
                  'rounded-lg border-2 px-4 py-3 text-left transition-all w-full',
                  disabled && 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed',
                  !disabled && sel && 'border-blue-600 bg-blue-100 ring-2 ring-blue-300',
                  !disabled && !sel && esGanador && 'border-emerald-400 bg-emerald-50 hover:border-emerald-500',
                  !disabled && !sel && !esGanador && 'border-gray-200 bg-white hover:border-blue-400'
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    {esGanador && <Trophy size={16} className="text-emerald-600" />}
                    {LABEL[r.agencia]}
                    {esGanador && <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">más barato</span>}
                    {sel && <span className="text-[10px] uppercase font-bold text-blue-700 bg-blue-200 px-1.5 py-0.5 rounded">elegido</span>}
                  </span>
                  {!r.error && (
                    <span className={clsx('text-xl font-bold tabular-nums',
                      sel ? 'text-blue-800' : esGanador ? 'text-emerald-700' : 'text-gray-900')}>
                      {r.total.toFixed(2)} €
                    </span>
                  )}
                </div>
                {r.error
                  ? <span className="text-xs text-gray-500">{r.error}</span>
                  : <DesgloseAgencia agencia={r.agencia} desglose={r.desglose} total={r.total} />
                }
              </button>
            );
          })}
        </div>
      )}

      {agenciaActual && (
        <div className="flex items-center justify-between text-sm text-gray-700 pt-2 border-t border-blue-200/60">
          <span>
            Guardado: <b className="text-gray-900">{LABEL[agenciaActual as Agencia] ?? agenciaActual}</b>
            {pesoActual != null && <> · peso usado <b className="text-gray-900">{pesoActual.toFixed(1)} kg</b></>}
          </span>
          <button type="button"
            onClick={() => onElegir({ agencia: null, importe: null, pesoUsado: null })}
            className="text-red-600 hover:underline font-medium">
            quitar
          </button>
        </div>
      )}
    </div>
  );
}
