-- ============================================================
-- 096: Pedidos guardan qué agencia de portes se ha elegido y
-- con qué peso se calculó (para auditoría y reimpresión).
-- La columna `portes` (importe) ya existe en pedidos.
-- ============================================================

BEGIN;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS porte_agencia  TEXT,
  ADD COLUMN IF NOT EXISTS porte_peso_kg  NUMERIC(10,2);

COMMIT;
