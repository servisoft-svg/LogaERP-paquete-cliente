-- Permitir dividir el agua (u otros ingredientes en el futuro) en varias
-- entradas dentro de una misma receta, cada una asignada a un paso distinto.
-- Antes: UNIQUE (receta_id, materia_prima_id) impedía repetir un MP.
-- Ahora: se elimina ese constraint y se añade paso_index para ordenar las
-- partes. La validación de duplicados se hace en backend (solo para agua).
ALTER TABLE public.ingredientes_receta
  DROP CONSTRAINT IF EXISTS ingredientes_receta_receta_id_materia_prima_id_key;

ALTER TABLE public.ingredientes_receta
  ADD COLUMN IF NOT EXISTS paso_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_ingredientes_receta_paso
  ON public.ingredientes_receta (receta_id, paso_index)
  WHERE paso_index IS NOT NULL;
