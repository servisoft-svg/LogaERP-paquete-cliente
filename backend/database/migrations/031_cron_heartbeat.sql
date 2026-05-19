-- =============================================================
-- Migración 031 — Heartbeat de crons internos
-- =============================================================
-- Problema:
--   Los crons internos (sweepPedidos cada 90s, sweepStockReglas cada 5min,
--   tickBackupNocturno cada 60s, procesarReintentosEmail cada 5min) se
--   ejecutan vía setInterval. Si callback lanza una excepción no capturada
--   o el proceso muere, NO HAY AVISO. Pedidos sin auto-completar, albaranes
--   sin enviar, días de retraso descubiertos por queja de cliente.
--
-- Solución:
--   Tabla cron_heartbeat: cada cron escribe `ultimo_run` al terminar OK.
--   Endpoint /api/health/cron lee tabla, calcula edad de cada heartbeat.
--   Si edad > umbral (configurable por cron) → estado='caido'.
--   Frontend pollea cada 60s y dispara sileo.error si algún cron caído.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_heartbeat (
  nombre        TEXT PRIMARY KEY,
  ultimo_run    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_status TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  ultimo_error  TEXT,
  intervalo_ms  INTEGER NOT NULL,            -- intervalo esperado entre ticks
  umbral_ms     INTEGER NOT NULL,            -- umbral para considerar caido (= 3 * intervalo típicamente)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-poblar con los 4 crons existentes para que aparezcan desde el primer
-- arranque aunque aún no hayan ejecutado. Umbral = 3x intervalo + 30s margen.
INSERT INTO public.cron_heartbeat (nombre, intervalo_ms, umbral_ms) VALUES
  ('sweep_pedidos',          90000,   300000),  -- 90s, alerta si >5min
  ('sweep_stock_reglas',     300000,  960000),  -- 5min, alerta si >16min
  ('backup_nocturno_tick',   60000,   240000),  -- 60s, alerta si >4min
  ('retry_email_proveedor',  300000,  960000)   -- 5min, alerta si >16min
ON CONFLICT (nombre) DO NOTHING;

COMMENT ON TABLE public.cron_heartbeat IS
  'Heartbeat de crons internos (setInterval). Watchdog vía /api/health/cron.';

COMMIT;
