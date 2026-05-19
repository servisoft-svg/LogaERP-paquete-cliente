-- Unidad en la que se compró este lote: kg, L, ud, g, etc.
-- NULL = usar unidad_medida del producto (compatibilidad lotes antiguos).
ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS unidad_precio VARCHAR(10);
