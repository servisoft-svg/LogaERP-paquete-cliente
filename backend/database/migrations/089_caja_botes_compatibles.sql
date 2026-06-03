-- ============================================================
-- 089: Vinculación cajas ↔ botes compatibles.
--
-- Cada caja de embalaje (ME subcategoría Caja) tiene una lista de botes
-- (PE o frasco-ME) que físicamente caben en ella. Al hacer un pedido, el
-- sistema busca las cajas compatibles con el bote pedido:
--   - 1 sola compatible → autoseleccionada
--   - varias → desplegable
--   - ninguna → línea sin caja (botes sueltos)
--
-- Además: en cada línea de pedido guardamos cómo se reparte la cantidad
-- pedida (cajas completas + botes sueltos), y qué caja se usó.
-- ============================================================

BEGIN;

-- Tabla M2M caja ↔ bote
CREATE TABLE IF NOT EXISTS public.caja_botes_compatibles (
  caja_id  UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  bote_id  UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (caja_id, bote_id)
);

CREATE INDEX IF NOT EXISTS idx_caja_botes_caja ON public.caja_botes_compatibles (caja_id);
CREATE INDEX IF NOT EXISTS idx_caja_botes_bote ON public.caja_botes_compatibles (bote_id);

-- Cuántos botes caben dentro de la caja (override del genérico unidades_por_envase).
-- Si NULL se usa unidades_por_envase. Se prefiere este nuevo campo en flujos
-- de pedido-bote por claridad semántica.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS botes_por_caja INTEGER;

-- Líneas de pedido: desglose cajas/sueltos + qué caja se usó.
-- cantidad sigue = total botes (cajas × N + sueltos) por compat con flujo existente.
ALTER TABLE public.lineas_pedido
  ADD COLUMN IF NOT EXISTS cantidad_cajas NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_botes_sueltos NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caja_id UUID REFERENCES public.productos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lineas_pedido_caja ON public.lineas_pedido (caja_id) WHERE caja_id IS NOT NULL;

COMMIT;
