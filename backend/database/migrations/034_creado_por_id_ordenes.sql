-- =============================================================
-- Migración 034 — creado_por_id en ordenes_produccion
-- =============================================================
-- Diferencia entre quién PLANIFICÓ la orden y quién la EJECUTÓ:
--   - creado_por_id: usuario que pulsó "Nueva fabricación" / "Planificar envasado"
--   - operario_id:   usuario que pulsó "Confirmar fabricación" / "Confirmar envasado"
--
-- Necesario para política de borrado: un operario solo puede borrar las
-- órdenes que él mismo creó O ejecutó. Admin borra cualquiera.
-- =============================================================

BEGIN;

ALTER TABLE public.ordenes_produccion
  ADD COLUMN IF NOT EXISTS creado_por_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ordenes_produccion.creado_por_id IS
  'Usuario que CREÓ la orden (planificación). Diferente de operario_id (quien la ejecutó).';

CREATE INDEX IF NOT EXISTS idx_ordenes_produccion_creado_por ON public.ordenes_produccion(creado_por_id) WHERE creado_por_id IS NOT NULL;

COMMIT;
