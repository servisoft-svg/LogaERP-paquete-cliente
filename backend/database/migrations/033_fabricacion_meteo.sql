-- =============================================================
-- Migración 033 — Registro meteorológico automático en fabricación
-- =============================================================
-- Objetivo:
--   Capturar las condiciones climáticas externas en el momento exacto
--   de confirmar una orden de fabricación, para análisis posterior de
--   correlación entre meteo y mermas / desviaciones de calidad.
--
-- Diseño:
--   - JSONB directamente en ordenes_produccion (no tabla nueva).
--   - NULL si la llamada a Open-Meteo falla → no bloquea fabricación.
--   - Se rellena en produccion.service.ts confirmarOrden() antes del
--     BEGIN de la transacción principal (timeout 3s, fail-soft).
--
-- Estructura esperada:
--   {
--     "temperatura":       21.4,    -- °C  (temperature_2m)
--     "humedad":           68,      -- %   (relative_humidity_2m)
--     "sensacion_termica": 20.1,    -- °C  (apparent_temperature)
--     "precipitacion":     0.0,     -- mm  (precipitation)
--     "weather_code":      2,       -- WMO code
--     "presion":           1013.2,  -- hPa (surface_pressure)
--     "viento_velocidad":  14.5,    -- km/h (wind_speed_10m)
--     "viento_direccion":  220,     -- °  (wind_direction_10m)
--     "viento_rafagas":    22.1,    -- km/h (wind_gusts_10m)
--     "timestamp_utc":     "2026-05-07T10:32:00Z",
--     "fuente":            "open-meteo"
--   }
-- =============================================================

BEGIN;

ALTER TABLE public.ordenes_produccion
  ADD COLUMN IF NOT EXISTS meteo JSONB;

COMMENT ON COLUMN public.ordenes_produccion.meteo IS
  'Snapshot meteorológico (Open-Meteo) en el momento de confirmar la orden. NULL si fetch falló. Para correlación merma vs clima.';

-- Índice GIN opcional para queries del tipo `meteo @> ''{"weather_code": 2}''`
-- o filtrado por rangos de temperatura. Solo crearlo si la tabla es grande.
-- (Comentado por defecto — descomentar cuando haya volumen.)
-- CREATE INDEX IF NOT EXISTS idx_ordenes_produccion_meteo ON public.ordenes_produccion USING GIN (meteo);

COMMIT;

-- =============================================================
-- Verificación:
--   SELECT id, numero_orden, meteo
--   FROM ordenes_produccion
--   WHERE estado = 'completada' AND meteo IS NOT NULL
--   ORDER BY fecha_fin DESC LIMIT 5;
--
-- Análisis correlación merma vs meteo:
--   SELECT numero_orden, merma_pct,
--          (meteo->>'temperatura')::float AS temp,
--          (meteo->>'humedad')::int       AS humedad
--   FROM ordenes_produccion
--   WHERE estado = 'completada' AND meteo IS NOT NULL
--   ORDER BY merma_pct DESC;
-- =============================================================
