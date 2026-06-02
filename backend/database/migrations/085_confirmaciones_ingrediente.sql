-- Confirmaciones manuales de ingredientes por OF.
-- Cada fila representa: "el operario X confirmó (pulsó OK / escaneó) el
-- ingrediente Y de la orden Z el día W". Es el source-of-truth para que el
-- estado sobreviva a recargas de página, cambios de operario y restarts.
CREATE TABLE IF NOT EXISTS public.confirmaciones_ingrediente (
  orden_id              UUID NOT NULL REFERENCES ordenes_produccion(id) ON DELETE CASCADE,
  ingrediente_receta_id UUID NOT NULL REFERENCES ingredientes_receta(id) ON DELETE CASCADE,
  confirmado_por_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  confirmado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (orden_id, ingrediente_receta_id)
);

CREATE INDEX IF NOT EXISTS idx_confirmaciones_orden
  ON public.confirmaciones_ingrediente(orden_id);
