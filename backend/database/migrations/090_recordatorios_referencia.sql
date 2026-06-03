-- ============================================================
-- 090: Recordatorios pueden enlazar a un recurso (producto, lote,
-- orden de producción, pedido). Útil para que un admin avise al
-- operario "revisar lote X" con un chip clickable.
--
-- También añadimos índice para acelerar consultas por destinatario.
-- ============================================================

BEGIN;

ALTER TABLE public.recordatorios
  ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(32),  -- 'producto'|'lote'|'orden'|'pedido'
  ADD COLUMN IF NOT EXISTS referencia_id   UUID;

CREATE INDEX IF NOT EXISTS idx_recordatorios_referencia
  ON public.recordatorios (referencia_tipo, referencia_id)
  WHERE referencia_id IS NOT NULL;

COMMIT;
