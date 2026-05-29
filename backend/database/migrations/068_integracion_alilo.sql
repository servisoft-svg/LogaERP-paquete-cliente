-- Integración con sistema externo "Alilo" (otro ERP en la misma fábrica).
-- Loga es la fuente de verdad del stock. Alilo llama vía HTTP a Loga para
-- descontar stock de productos marcados como compartidos.

-- 1. Flag por producto: solo los que tienen este flag pueden ser consumidos
--    desde Alilo. Por defecto FALSE → ningún producto se expone.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS compartido_alilo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_productos_compartido_alilo
  ON productos (id) WHERE compartido_alilo = TRUE;

-- 2. Nuevo tipo de movimiento para los descuentos solicitados por Alilo.
--    Diferenciado de 'salida' (venta normal) para trazabilidad.
ALTER TYPE public.tipo_movimiento ADD VALUE IF NOT EXISTS 'consumo_externo';

-- 3. Tabla idempotency keys: si Alilo reintenta una llamada con el mismo
--    idempotency_key, devolvemos el resultado anterior sin volver a descontar.
CREATE TABLE IF NOT EXISTS public.integracion_alilo_keys (
  idempotency_key UUID PRIMARY KEY,
  resultado       JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TTL informativo: limpiamos keys > 30 días con job/manual (no urgente).
CREATE INDEX IF NOT EXISTS idx_alilo_keys_created
  ON public.integracion_alilo_keys (created_at);

-- 4. Log de últimas llamadas (auditoría + UI para ver qué pasó).
CREATE TABLE IF NOT EXISTS public.integracion_alilo_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      VARCHAR(100)   NOT NULL,
  payload       JSONB,
  status_code   INTEGER        NOT NULL,
  respuesta     JSONB,
  ip_origen     VARCHAR(50),
  error         TEXT,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alilo_log_created
  ON public.integracion_alilo_log (created_at DESC);
