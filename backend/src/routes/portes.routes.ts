import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { adminOnly } from '../middleware/auth';
import {
  calcularPortes, listarProvincias,
  getConfigSchenker, setConfigSchenker,
  exportarPaletrapidPlano, exportarPalletwaysPlano,
  reemplazarPaletrapid, reemplazarPalletways,
  type PaletrapidRow, type PalletwaysRow,
} from '../services/portes.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/portes/provincias  — autocomplete UI
router.get('/provincias', async (_req, res) => {
  try {
    const provs = await listarProvincias();
    res.json(provs);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/portes/calcular
router.post('/calcular', async (req, res) => {
  try {
    const { peso, provincia, servicio } = req.body || {};
    const result = await calcularPortes({
      peso: Number(peso),
      provincia: String(provincia || ''),
      servicio: servicio === 'PREMIUM' ? 'PREMIUM' : 'ECONOMY',
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// =================== CONFIG SCHENKER ===================
// GET /api/portes/config — devuelve multiplicadores actuales
router.get('/config', adminOnly, async (_req, res) => {
  try {
    res.json(await getConfigSchenker());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/portes/config — subida/seguro/combustible como fracción (0.219 = 21.9%)
router.put('/config', adminOnly, async (req, res) => {
  try {
    const { subida, seguro, combustible } = req.body || {};
    const cfg = await setConfigSchenker({
      subida: Number(subida),
      seguro: Number(seguro),
      combustible: Number(combustible),
    });
    res.json(cfg);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// =================== TARIFAS — PLANTILLAS ===================
function buildSheet<T>(rows: T[], headers: string[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'tarifas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

router.get('/tarifas/paletrapid/plantilla', adminOnly, async (_req, res) => {
  try {
    const rows = await exportarPaletrapidPlano();
    const buf = buildSheet(rows, ['servicio','provincia','cp','quart','half','light','full_1','full_2','full_3','full_4','mega_1','mega_2','mega_3','mega_4']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tarifas-paletrapid.xlsx"');
    res.send(buf);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/tarifas/palletways/plantilla', adminOnly, async (_req, res) => {
  try {
    const rows = await exportarPalletwaysPlano();
    const buf = buildSheet(rows, ['tipo_pallet','zona','num_pallets','servicio','precio']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tarifas-palletways.xlsx"');
    res.send(buf);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// =================== TARIFAS — IMPORT ===================
// El Excel debe tener una hoja con cabeceras = nombres de columna esperados.
// Acepta xlsx, xls y csv (xlsx-lib autodetecta).
function readWorkbookFromBuffer(buf: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no tiene hojas');
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }) as Record<string, unknown>[];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace('€', '').replace(',', '.').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

router.post('/tarifas/paletrapid/importar', adminOnly, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
    const raw = readWorkbookFromBuffer(req.file.buffer);
    const rows: PaletrapidRow[] = raw.map(r => ({
      servicio: String(r.servicio || '').toUpperCase().trim() as 'ECONOMY' | 'PREMIUM',
      provincia: String(r.provincia || ''),
      cp: r.cp != null && r.cp !== '' ? String(r.cp).padStart(2, '0').slice(0, 5) : null,
      quart: toNum(r.quart), half: toNum(r.half), light: toNum(r.light),
      full_1: toNum(r.full_1), full_2: toNum(r.full_2), full_3: toNum(r.full_3), full_4: toNum(r.full_4),
      mega_1: toNum(r.mega_1), mega_2: toNum(r.mega_2), mega_3: toNum(r.mega_3), mega_4: toNum(r.mega_4),
    }));
    const inserted = await reemplazarPaletrapid(rows);
    res.json({ ok: true, filas_importadas: inserted });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/tarifas/palletways/importar', adminOnly, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
    const raw = readWorkbookFromBuffer(req.file.buffer);
    const rows: PalletwaysRow[] = raw.map(r => ({
      tipo_pallet: String(r.tipo_pallet || '').toUpperCase().trim(),
      zona:        Math.floor(Number(r.zona)),
      num_pallets: Math.floor(Number(r.num_pallets)),
      servicio:    String(r.servicio || '').toUpperCase().trim() as 'ECONOMY' | 'PREMIUM',
      precio:      toNum(r.precio) ?? NaN,
    }));
    const inserted = await reemplazarPalletways(rows);
    res.json({ ok: true, filas_importadas: inserted });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
