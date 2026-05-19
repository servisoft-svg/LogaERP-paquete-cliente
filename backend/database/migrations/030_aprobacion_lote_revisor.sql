-- =============================================================
-- Migración 030 — Aprobación de lote en cuarentena exige revisor + motivo
-- =============================================================
-- Problema:
--   Manual y normativa REACH exigen que cuando un lote en cuarentena
--   (QC fuera de rango) se apruebe, quede registro de QUIÉN aprobó y POR QUÉ.
--   Antes solo había motivo en stock_moves y auditoria — no atado al lote.
--
-- Solución:
--   Añadir a la tabla lotes:
--     - revisor_id   (FK a usuarios.id) → quién firmó la aprobación.
--     - revisado_at  (TIMESTAMPTZ)      → cuándo.
--     - motivo_revision (TEXT)          → texto justificativo (≥10 chars).
--   El endpoint PATCH /api/lotes/:id/estado los rellena al hacer
--   transición cuarentena → aprobado.
-- =============================================================

BEGIN;

ALTER TABLE public.lotes
  ADD COLUMN IF NOT EXISTS revisor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_revision TEXT;

COMMENT ON COLUMN public.lotes.revisor_id IS
  'Usuario que aprobó manualmente un lote desde cuarentena. NULL si nunca pasó por cuarentena.';
COMMENT ON COLUMN public.lotes.revisado_at IS
  'Timestamp de aprobación manual del lote. NULL si nunca pasó por cuarentena.';
COMMENT ON COLUMN public.lotes.motivo_revision IS
  'Justificación textual (≥10 chars) de por qué se aprobó un lote desviado de QC. Auditoría REACH.';

-- Índice para consultas auditoría por revisor.
CREATE INDEX IF NOT EXISTS idx_lotes_revisor ON public.lotes(revisor_id) WHERE revisor_id IS NOT NULL;

COMMIT;
