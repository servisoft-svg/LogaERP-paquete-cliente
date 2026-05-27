// Tipo de cambio EUR <-> divisa. Cache en memoria (15 min) para no martillear la API.
import { Router } from 'express';

const router = Router();

const MONEDAS_SOPORTADAS = ['USD', 'CNY', 'GBP', 'JPY', 'CHF', 'MXN', 'BRL', 'CAD', 'AUD'];
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry { rates: Record<string, number>; fetchedAt: number; }
let cache: CacheEntry | null = null;

async function fetchRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rates;
  try {
    // ECB (Frankfurter): gratis, sin auth, base EUR.
    const symbols = MONEDAS_SOPORTADAS.join(',');
    const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${symbols}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { rates?: Record<string, number> };
    if (!data.rates) throw new Error('respuesta sin rates');
    cache = { rates: data.rates, fetchedAt: Date.now() };
    return data.rates;
  } catch (e) {
    // Si la API falla y hay cache vieja, devuélvela. Si no, valores aproximados.
    if (cache) return cache.rates;
    return { USD: 1.08, CNY: 7.85, GBP: 0.85, JPY: 165, CHF: 0.95, MXN: 19, BRL: 5.5, CAD: 1.47, AUD: 1.63 };
  }
}

router.get('/', async (_req, res) => {
  try {
    const rates = await fetchRates();
    res.json({
      base: 'EUR',
      rates,
      monedas: ['EUR', ...MONEDAS_SOPORTADAS],
      cached_at: cache?.fetchedAt ?? Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/:divisa', async (req, res) => {
  try {
    const div = req.params.divisa.toUpperCase();
    if (div === 'EUR') return res.json({ from: 'EUR', to: 'EUR', rate: 1 });
    const rates = await fetchRates();
    const rate = rates[div];
    if (!rate) return res.status(404).json({ error: `Divisa no soportada: ${div}` });
    // Devolvemos cuanto vale 1 unidad de la divisa en EUR (factor para convertir → EUR).
    res.json({ from: div, to: 'EUR', rate: 1 / rate, divisa_por_eur: rate });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
