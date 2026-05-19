-- Specs físico-químicas de materias primas + valores medidos por lote.
-- Productos: rangos aceptables (ej: pH entre 4.5 y 8). NULL = sin spec.
-- Lotes: valor concreto medido al recepcionar el lote. NULL = no medido.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS solidos_min     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS solidos_max     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ph_min          NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS ph_max          NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS viscosidad_min  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS viscosidad_max  NUMERIC(10,2);

ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS solidos     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ph          NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS viscosidad  NUMERIC(10,2);
