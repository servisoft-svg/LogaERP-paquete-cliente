import { pool } from '../db/pool';

export type Servicio = 'ECONOMY' | 'PREMIUM';
export type AgenciaId = 'SCHENKER' | 'PALETRAPID' | 'PALLETWAYS';

export interface CalcInput {
  peso: number;             // kg
  provincia: string;        // texto libre (se normaliza)
  servicio?: Servicio;      // default ECONOMY
}

export interface CalcResultado {
  agencia: AgenciaId;
  total: number;            // EUR
  desglose: Record<string, number | string | null>;
  error?: string;
}

export interface CalcResponse {
  provincia: string;
  zonas: { schenker: string | null; palletways: number | null };
  resultados: CalcResultado[];
  ganador: CalcResultado | null;
}

// ------------------ utils ------------------
export function normalizaProvincia(p: string): string {
  const repl: Record<string, string> = {
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N',
    'á': 'A', 'é': 'E', 'í': 'I', 'ó': 'O', 'ú': 'U', 'ñ': 'N',
  };
  let s = (p || '').toUpperCase().trim();
  for (const [k, v] of Object.entries(repl)) s = s.split(k).join(v);
  return s;
}

async function getZonas(provincia: string): Promise<{ schenker: string | null; palletways: number | null }> {
  const { rows } = await pool.query<{ zona_schenker: string | null; zona_palletways: number | null }>(
    `SELECT zona_schenker, zona_palletways FROM portes_zonas_envio WHERE provincia = $1`,
    [provincia]
  );
  if (!rows[0]) return { schenker: null, palletways: null };
  return { schenker: rows[0].zona_schenker, palletways: rows[0].zona_palletways };
}

// ------------------ SCHENKER ------------------
const SCHENKER_EXP_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const SCHENKER_KGC_STEPS = [200, 300, 500, 750, 1000, 2000, 3000, 5000, 8000, 10000, 20000];

export async function calcularSchenker(peso: number, zona: string | null): Promise<CalcResultado> {
  const r: CalcResultado = { agencia: 'SCHENKER', total: NaN, desglose: {} };
  if (!zona) { r.error = 'Sin zona Schenker para esta provincia'; return r; }

  // peso=100 → EXP[100] (no KGC[200])
  const tipo: 'EXP' | 'KGC' = peso <= 100 ? 'EXP' : 'KGC';
  const steps = tipo === 'EXP' ? SCHENKER_EXP_STEPS : SCHENKER_KGC_STEPS;
  let escalon: number | null = null;
  for (const s of steps) {
    if (peso <= s) { escalon = s; break; }
  }
  if (escalon === null) escalon = steps[steps.length - 1]; // tope

  const { rows } = await pool.query<{ precio: string }>(
    `SELECT precio FROM portes_schenker WHERE tipo=$1 AND hasta_kg=$2 AND zona=$3`,
    [tipo, escalon, zona]
  );
  if (!rows[0]) { r.error = `Sin tarifa Schenker ${tipo}/${escalon}/${zona}`; return r; }

  const base = parseFloat(rows[0].precio);
  const cantidad = tipo === 'KGC' ? peso / 100 : 1;
  const porteBruto = base * cantidad;

  const { rows: cfgRows } = await pool.query<{ subida: string; seguro: string; combustible: string }>(
    `SELECT subida, seguro, combustible FROM portes_schenker_config WHERE id=1`
  );
  const cfg = cfgRows[0];
  const subida = cfg ? parseFloat(cfg.subida) : 0.219;
  const seguroPct = cfg ? parseFloat(cfg.seguro) : 0.08;
  const combPct = cfg ? parseFloat(cfg.combustible) : 0.0976;

  const porte = porteBruto * (1 + subida);
  const seguro = porte * seguroPct;
  const combust = porte * combPct;
  const total = porte + seguro + combust;

  r.total = +total.toFixed(2);
  r.desglose = {
    tipo, zona, escalon_kg: escalon, base_eur: base, cantidad: +cantidad.toFixed(2),
    porte_bruto: +porteBruto.toFixed(2),
    subida_pct: +(subida * 100).toFixed(2),
    porte_con_subida: +porte.toFixed(2),
    seguro_eur: +seguro.toFixed(2),
    combustible_eur: +combust.toFixed(2),
  };
  return r;
}

// ------------------ PALETRAPID ------------------
// Columnas: rangos por capacidad de palet (altura/peso). Como "tamaño da igual"
// → de las columnas cuya capacidad de peso cubre el envío, escogemos la más barata.
const PALETRAPID_COLS = [
  { key: 'quart',  maxKg: 350 },
  { key: 'half',   maxKg: 650 },   // PDF dice 650 (altura 140cm)
  { key: 'light',  maxKg: 500 },   // PDF dice 500 (altura 245cm)
  { key: 'full_1', maxKg: 900 },
  { key: 'mega_1', maxKg: 1200 },
];

export async function calcularPaletrapid(
  peso: number, provincia: string, _numPallets: number, servicio: Servicio
): Promise<CalcResultado> {
  const r: CalcResultado = { agencia: 'PALETRAPID', total: NaN, desglose: {} };
  const { rows } = await pool.query(
    `SELECT * FROM portes_paletrapid WHERE servicio=$1 AND provincia=$2`,
    [servicio, provincia]
  );
  if (!rows[0]) { r.error = `Sin tarifa Paletrapid para ${provincia}/${servicio}`; return r; }
  const t = rows[0] as Record<string, string | null>;

  if (peso > 1200) { r.error = 'Peso > 1200kg no soportado en Paletrapid'; return r; }

  // De las columnas que cubren el peso, elige la más barata
  const candidatos = PALETRAPID_COLS
    .filter(c => peso <= c.maxKg)
    .map(c => ({ key: c.key, precio: t[c.key] ? parseFloat(String(t[c.key])) : NaN }))
    .filter(c => isFinite(c.precio));
  if (!candidatos.length) { r.error = 'Sin precios disponibles'; return r; }
  candidatos.sort((a, b) => a.precio - b.precio);
  const ganador = candidatos[0];

  r.total = +ganador.precio.toFixed(2);
  r.desglose = { rango: ganador.key, servicio, precio_eur: ganador.precio };
  return r;
}

// ------------------ PALLETWAYS ------------------
const PALLET_TIPOS = [
  { key: 'MINIQ',   maxKg: 150 },
  { key: 'QUARTER', maxKg: 300 },
  { key: 'XLIGHT',  maxKg: 450 },
  { key: 'HALF',    maxKg: 600 },
  { key: 'EURO',    maxKg: 900 },
  { key: 'FULL',    maxKg: 1200 },
];

export async function calcularPalletways(
  peso: number, zona: number | null, _numPallets: number, servicio: Servicio
): Promise<CalcResultado> {
  const r: CalcResultado = { agencia: 'PALLETWAYS', total: NaN, desglose: {} };
  if (zona === null) { r.error = 'Sin zona Palletways para esta provincia'; return r; }
  if (peso > 1200) { r.error = 'Peso > 1200kg no soportado en Palletways'; return r; }

  // De los tipos cuyo peso máximo cubre el envío, busca el precio más barato (1 palet).
  const candidatos = PALLET_TIPOS.filter(t => peso <= t.maxKg);
  if (!candidatos.length) { r.error = 'Sin tipo de pallet aplicable'; return r; }

  const { rows } = await pool.query<{ tipo_pallet: string; precio: string }>(
    `SELECT tipo_pallet, precio FROM portes_palletways
      WHERE tipo_pallet = ANY($1) AND zona=$2 AND num_pallets=1 AND servicio=$3
      ORDER BY precio ASC LIMIT 1`,
    [candidatos.map(c => c.key), zona, servicio]
  );
  if (!rows[0]) { r.error = `Sin tarifa Palletways en zona ${zona}/${servicio}`; return r; }

  const precio = parseFloat(rows[0].precio);
  r.total = +precio.toFixed(2);
  r.desglose = { tipo_pallet: rows[0].tipo_pallet, zona, servicio, precio_eur: precio };
  return r;
}

// ------------------ ORQUESTADOR ------------------
export async function calcularPortes(input: CalcInput): Promise<CalcResponse> {
  const peso = Number(input.peso);
  if (!isFinite(peso) || peso <= 0) throw new Error('peso inválido');
  const provincia = normalizaProvincia(input.provincia);
  if (!provincia) throw new Error('provincia requerida');
  const servicio: Servicio = input.servicio === 'PREMIUM' ? 'PREMIUM' : 'ECONOMY';

  const zonas = await getZonas(provincia);

  const [schenker, paletrapid, palletways] = await Promise.all([
    calcularSchenker(peso, zonas.schenker),
    calcularPaletrapid(peso, provincia, 1, servicio),
    calcularPalletways(peso, zonas.palletways, 1, servicio),
  ]);

  const resultados = [schenker, paletrapid, palletways];
  const validos = resultados.filter(r => isFinite(r.total));
  validos.sort((a, b) => a.total - b.total);
  const ganador = validos[0] || null;

  return { provincia, zonas, resultados, ganador };
}

export async function listarProvincias(): Promise<string[]> {
  const { rows } = await pool.query<{ provincia: string }>(
    `SELECT provincia FROM portes_zonas_envio ORDER BY provincia`
  );
  return rows.map(r => r.provincia);
}

// ============== CONFIG SCHENKER ==============
export interface ConfigSchenker {
  subida: number;
  seguro: number;
  combustible: number;
  actualizado_at?: string;
}

export async function getConfigSchenker(): Promise<ConfigSchenker> {
  const { rows } = await pool.query<{ subida: string; seguro: string; combustible: string; actualizado_at: string }>(
    `SELECT subida, seguro, combustible, actualizado_at FROM portes_schenker_config WHERE id=1`
  );
  if (!rows[0]) return { subida: 0.219, seguro: 0.08, combustible: 0.0976 };
  return {
    subida: parseFloat(rows[0].subida),
    seguro: parseFloat(rows[0].seguro),
    combustible: parseFloat(rows[0].combustible),
    actualizado_at: rows[0].actualizado_at,
  };
}

export async function setConfigSchenker(c: { subida: number; seguro: number; combustible: number }): Promise<ConfigSchenker> {
  for (const [k, v] of Object.entries(c)) {
    if (!Number.isFinite(v) || v < 0 || v > 5) throw new Error(`Valor inválido en ${k}: ${v}`);
  }
  await pool.query(
    `INSERT INTO portes_schenker_config (id, subida, seguro, combustible, actualizado_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET subida=$1, seguro=$2, combustible=$3, actualizado_at=NOW()`,
    [c.subida, c.seguro, c.combustible]
  );
  return getConfigSchenker();
}

// ============== IMPORT TARIFAS ==============
// Reemplaza por completo las filas de portes_paletrapid usando un array
// de filas previamente parseado del Excel subido.
export interface PaletrapidRow {
  servicio: 'ECONOMY' | 'PREMIUM';
  provincia: string;
  cp?: string | null;
  quart?: number | null;
  half?: number | null;
  light?: number | null;
  full_1?: number | null; full_2?: number | null; full_3?: number | null; full_4?: number | null;
  mega_1?: number | null; mega_2?: number | null; mega_3?: number | null; mega_4?: number | null;
}

export async function reemplazarPaletrapid(rows: PaletrapidRow[]): Promise<number> {
  if (!rows.length) throw new Error('No hay filas válidas en el Excel');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM portes_paletrapid`);
    let inserted = 0;
    for (const r of rows) {
      const prov = normalizaProvincia(r.provincia);
      if (!prov || (r.servicio !== 'ECONOMY' && r.servicio !== 'PREMIUM')) continue;
      await client.query(
        `INSERT INTO portes_paletrapid (servicio, provincia, cp, quart, half, light, full_1, full_2, full_3, full_4, mega_1, mega_2, mega_3, mega_4)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
        [r.servicio, prov, r.cp ?? null,
         r.quart ?? null, r.half ?? null, r.light ?? null,
         r.full_1 ?? null, r.full_2 ?? null, r.full_3 ?? null, r.full_4 ?? null,
         r.mega_1 ?? null, r.mega_2 ?? null, r.mega_3 ?? null, r.mega_4 ?? null]
      );
      inserted++;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface PalletwaysRow {
  tipo_pallet: string;       // MINIQ|QUARTER|XLIGHT|HALF|EURO|FULL
  zona: number;              // 1..11
  num_pallets: number;       // 1..5
  servicio: 'ECONOMY' | 'PREMIUM';
  precio: number;
}

export async function reemplazarPalletways(rows: PalletwaysRow[]): Promise<number> {
  if (!rows.length) throw new Error('No hay filas válidas en el Excel');
  const VALID_TIPOS = ['MINIQ','QUARTER','XLIGHT','HALF','EURO','FULL'];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM portes_palletways`);
    let inserted = 0;
    for (const r of rows) {
      const tipo = String(r.tipo_pallet || '').toUpperCase().trim();
      if (!VALID_TIPOS.includes(tipo)) continue;
      if (r.servicio !== 'ECONOMY' && r.servicio !== 'PREMIUM') continue;
      const zona = Math.floor(Number(r.zona));
      const np   = Math.floor(Number(r.num_pallets));
      const precio = Number(r.precio);
      if (!Number.isFinite(zona) || !Number.isFinite(np) || !Number.isFinite(precio)) continue;
      if (zona < 1 || zona > 20 || np < 1 || np > 10) continue;
      await client.query(
        `INSERT INTO portes_palletways (tipo_pallet, zona, num_pallets, servicio, precio)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [tipo, zona, np, r.servicio, precio]
      );
      inserted++;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Export "long format" (1 fila por celda) — el más robusto para parseo.
export async function exportarPaletrapidPlano(): Promise<PaletrapidRow[]> {
  const { rows } = await pool.query(
    `SELECT servicio, provincia, cp, quart, half, light,
            full_1, full_2, full_3, full_4, mega_1, mega_2, mega_3, mega_4
       FROM portes_paletrapid ORDER BY servicio, provincia`
  );
  return rows as PaletrapidRow[];
}

export async function exportarPalletwaysPlano(): Promise<PalletwaysRow[]> {
  const { rows } = await pool.query<PalletwaysRow>(
    `SELECT tipo_pallet, zona, num_pallets, servicio, precio
       FROM portes_palletways ORDER BY tipo_pallet, zona, num_pallets, servicio`
  );
  return rows.map(r => ({ ...r, zona: Number(r.zona), num_pallets: Number(r.num_pallets), precio: Number(r.precio) }));
}
