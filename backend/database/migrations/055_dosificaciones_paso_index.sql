-- Permite asociar cada echada parcial al índice del paso de la receta en que
-- se realizó. Con esto el frontend puede redistribuir el sobrante de un paso
-- al siguiente (ej: si pasaron 30 kg planificados pero el operario echó 28,
-- los 2 restantes se suman a la sugerencia del próximo paso).
ALTER TABLE public.dosificaciones_orden
  ADD COLUMN IF NOT EXISTS paso_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_dosif_paso
  ON public.dosificaciones_orden (orden_id, paso_index)
  WHERE paso_index IS NOT NULL;
