import { useEffect, useRef, useState } from 'react';
import { Truck, Download, Upload, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { portesApi, parseApiError } from '../api/client';
import clsx from 'clsx';

interface ConfigSchenker { subida: number; seguro: number; combustible: number; actualizado_at?: string }

function pctToFraction(s: string): number {
  return Number(s.replace(',', '.')) / 100;
}
function fractionToPct(f: number): string {
  return (f * 100).toFixed(2).replace(/\.?0+$/, '');
}

export default function PortesConfigSection() {
  // Schenker config
  const [subidaPct, setSubidaPct] = useState('');
  const [seguroPct, setSeguroPct] = useState('');
  const [combustPct, setCombustPct] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actualizadoAt, setActualizadoAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Import
  const filePalRef = useRef<HTMLInputElement>(null);
  const fileWayRef = useRef<HTMLInputElement>(null);
  const [importMsgPal, setImportMsgPal] = useState<{ tipo: 'ok'|'err'; texto: string } | null>(null);
  const [importMsgWay, setImportMsgWay] = useState<{ tipo: 'ok'|'err'; texto: string } | null>(null);
  const [importingPal, setImportingPal] = useState(false);
  const [importingWay, setImportingWay] = useState(false);

  useEffect(() => {
    portesApi.getConfig().then(r => {
      const c = r.data as ConfigSchenker;
      setSubidaPct(fractionToPct(c.subida));
      setSeguroPct(fractionToPct(c.seguro));
      setCombustPct(fractionToPct(c.combustible));
      setActualizadoAt(c.actualizado_at ?? null);
    }).catch(e => setErr(parseApiError(e).mensaje))
      .finally(() => setLoading(false));
  }, []);

  async function guardar() {
    setSaving(true); setSaved(false); setErr(null);
    try {
      const { data } = await portesApi.setConfig({
        subida: pctToFraction(subidaPct),
        seguro: pctToFraction(seguroPct),
        combustible: pctToFraction(combustPct),
      });
      const c = data as ConfigSchenker;
      setActualizadoAt(c.actualizado_at ?? new Date().toISOString());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(parseApiError(e).mensaje);
    } finally {
      setSaving(false);
    }
  }

  async function descargar(api: () => Promise<{ data: Blob }>, filename: string) {
    const { data } = await api();
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function importar(
    file: File,
    api: (f: File) => Promise<{ data: { ok?: boolean; filas_importadas?: number } }>,
    setMsg: (m: { tipo: 'ok'|'err'; texto: string } | null) => void,
    setImporting: (b: boolean) => void,
  ) {
    setImporting(true); setMsg(null);
    try {
      const { data } = await api(file);
      setMsg({ tipo: 'ok', texto: `${data.filas_importadas ?? 0} filas importadas. Tarifas actualizadas.` });
    } catch (e) {
      setMsg({ tipo: 'err', texto: parseApiError(e).mensaje });
    } finally {
      setImporting(false);
    }
  }

  return (
    <section id="portes" className="scroll-mt-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
        <Truck size={16} className="text-loga-red" />
        <h2 className="text-sm font-semibold text-gray-800">Portes</h2>
      </header>

      <div className="p-5 space-y-6">
        {/* === SCHENKER MULTIPLICADORES === */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Schenker — multiplicadores</h3>
          <p className="text-xs text-gray-500 mb-3">
            Aplican sobre el porte base de la tabla Schenker. Combustible cambia mensualmente.
          </p>

          {loading ? (
            <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Cargando…</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="block text-xs text-gray-600 mb-1">Subida tarifa (%)</span>
                <input type="number" step="0.01" min="0" max="500" value={subidaPct}
                  onChange={e => setSubidaPct(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-600 mb-1">Seguro (%)</span>
                <input type="number" step="0.01" min="0" max="100" value={seguroPct}
                  onChange={e => setSeguroPct(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-600 mb-1">Combustible (%)</span>
                <input type="number" step="0.01" min="0" max="100" value={combustPct}
                  onChange={e => setCombustPct(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              </label>
            </div>
          )}

          <div className="flex items-center gap-3 mt-3">
            <button type="button" onClick={guardar} disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-md bg-loga-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Guardar
            </button>
            {saved && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={14}/> Guardado</span>}
            {err && <span className="text-xs text-red-700 flex items-center gap-1"><AlertCircle size={14}/> {err}</span>}
            {actualizadoAt && (
              <span className="text-[11px] text-gray-400 ml-auto">
                Última edición: {new Date(actualizadoAt).toLocaleString('es-ES')}
              </span>
            )}
          </div>
        </div>

        {/* === PALETRAPID IMPORT === */}
        <div className="border-t border-gray-100 pt-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Paletrapid — tarifas</h3>
          <p className="text-xs text-gray-500 mb-3">
            Descarga el Excel actual, edita los precios, vuelve a subirlo. Se reemplazan TODAS las filas.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button"
              onClick={() => descargar(portesApi.plantillaPaletrapid, 'tarifas-paletrapid.xlsx')}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              <Download size={14} /> Descargar Excel actual
            </button>
            <input ref={filePalRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                importar(f, portesApi.importarPaletrapid, setImportMsgPal, setImportingPal);
                e.target.value = '';
              }} />
            <button type="button" onClick={() => filePalRef.current?.click()} disabled={importingPal}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {importingPal ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Subir Excel actualizado
            </button>
            {importMsgPal && (
              <span className={clsx('text-xs flex items-center gap-1',
                importMsgPal.tipo === 'ok' ? 'text-emerald-700' : 'text-red-700')}>
                {importMsgPal.tipo === 'ok' ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/>}
                {importMsgPal.texto}
              </span>
            )}
          </div>
        </div>

        {/* === PALLETWAYS IMPORT === */}
        <div className="border-t border-gray-100 pt-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Palletways — tarifas</h3>
          <p className="text-xs text-gray-500 mb-3">
            Mismo flujo. Columnas del Excel: <code className="text-[11px] bg-gray-100 px-1 rounded">tipo_pallet, zona, num_pallets, servicio, precio</code>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button"
              onClick={() => descargar(portesApi.plantillaPalletways, 'tarifas-palletways.xlsx')}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              <Download size={14} /> Descargar Excel actual
            </button>
            <input ref={fileWayRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                importar(f, portesApi.importarPalletways, setImportMsgWay, setImportingWay);
                e.target.value = '';
              }} />
            <button type="button" onClick={() => fileWayRef.current?.click()} disabled={importingWay}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {importingWay ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Subir Excel actualizado
            </button>
            {importMsgWay && (
              <span className={clsx('text-xs flex items-center gap-1',
                importMsgWay.tipo === 'ok' ? 'text-emerald-700' : 'text-red-700')}>
                {importMsgWay.tipo === 'ok' ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/>}
                {importMsgWay.texto}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
