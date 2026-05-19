/**
 * Meteo snapshot vía Open-Meteo (gratuita, sin API key).
 * Se invoca en produccion.confirmarOrden() ANTES del BEGIN de la transacción
 * con timeout 3s. Si falla, devuelve null y la fabricación continúa.
 *
 * Nunca lanza: el caller siempre recibe { meteo: object | null }.
 */

import { logger } from '../lib/logger';

// Coordenadas fábrica Loga (configurables vía env si se mueve la planta).
const LAT = process.env.METEO_LAT ? parseFloat(process.env.METEO_LAT) : 42.783431;
const LON = process.env.METEO_LON ? parseFloat(process.env.METEO_LON) : -4.251632;
const TIMEZONE = 'Europe/Madrid';
const TIMEOUT_MS = 3000;

const CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'surface_pressure',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',');

export interface MeteoSnapshot {
  temperatura: number;
  humedad: number;
  sensacion_termica: number;
  precipitacion: number;
  weather_code: number;
  presion: number;
  viento_velocidad: number;
  viento_direccion: number;
  viento_rafagas: number;
  timestamp_utc: string;
  fuente: 'open-meteo';
}

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  weather_code?: number;
  surface_pressure?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
}

function mapMeteo(current: OpenMeteoCurrent | undefined): MeteoSnapshot | null {
  if (!current) return null;
  // Si los campos críticos no vienen, considera respuesta inválida.
  if (current.temperature_2m === undefined || current.relative_humidity_2m === undefined) {
    return null;
  }
  return {
    temperatura:       Number(current.temperature_2m),
    humedad:           Number(current.relative_humidity_2m),
    sensacion_termica: Number(current.apparent_temperature ?? current.temperature_2m),
    precipitacion:     Number(current.precipitation ?? 0),
    weather_code:      Number(current.weather_code ?? 0),
    presion:           Number(current.surface_pressure ?? 0),
    viento_velocidad:  Number(current.wind_speed_10m ?? 0),
    viento_direccion:  Number(current.wind_direction_10m ?? 0),
    viento_rafagas:    Number(current.wind_gusts_10m ?? 0),
    timestamp_utc:     new Date().toISOString(),
    fuente:            'open-meteo',
  };
}

export async function fetchMeteoSnapshot(): Promise<MeteoSnapshot | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=${CURRENT_VARS}&timezone=${encodeURIComponent(TIMEZONE)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      logger.warn('[meteo] HTTP no OK, sin datos meteo', { status: res.status });
      return null;
    }
    const data = await res.json() as { current?: OpenMeteoCurrent };
    return mapMeteo(data.current);
  } catch (err) {
    // Timeout, DNS, sin red, JSON inválido → todo el mismo tratamiento.
    logger.warn('[meteo] fetch failed, continuing without climate data', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
