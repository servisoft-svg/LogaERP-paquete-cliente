-- Snapshots completos de cada versión de receta (cabecera + ingredientes)
-- para poder ver el histórico y restaurar una versión antigua.
CREATE TABLE IF NOT EXISTS public.recetas_historial (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id   UUID NOT NULL REFERENCES public.recetas(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,
  motivo      TEXT,
  usuario_id  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recetas_historial_receta
  ON public.recetas_historial (receta_id, created_at DESC);
