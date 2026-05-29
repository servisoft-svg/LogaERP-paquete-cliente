-- Sub-categoría para productos terminados (fabricados + envasados).
-- Solo 2 valores fijos (no editables desde UI como MP/ME):
--   'propia'   → Fabricación propia
--   'terceros' → Fabricados por terceros
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS subcategoria_pf VARCHAR(20);

-- Check constraint para forzar los valores válidos (NULL permitido = sin clasificar)
ALTER TABLE productos
  DROP CONSTRAINT IF EXISTS productos_subcategoria_pf_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_subcategoria_pf_check
  CHECK (subcategoria_pf IS NULL OR subcategoria_pf IN ('propia', 'terceros'));

CREATE INDEX IF NOT EXISTS idx_productos_subcategoria_pf
  ON productos (subcategoria_pf) WHERE subcategoria_pf IS NOT NULL;
