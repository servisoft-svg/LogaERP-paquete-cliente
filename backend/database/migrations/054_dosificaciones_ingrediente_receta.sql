-- Para soportar agua dividida en varias partes (varias filas en
-- ingredientes_receta para el mismo producto), añadimos referencia a la fila
-- concreta de la receta a la que pertenece cada echada. Así el frontend puede
-- mostrar el "echado / pendiente" por parte, no agregado por producto.
ALTER TABLE public.dosificaciones_orden
  ADD COLUMN IF NOT EXISTS ingrediente_receta_id UUID
    REFERENCES public.ingredientes_receta(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dosif_ingrediente
  ON public.dosificaciones_orden (orden_id, ingrediente_receta_id)
  WHERE ingrediente_receta_id IS NOT NULL;
