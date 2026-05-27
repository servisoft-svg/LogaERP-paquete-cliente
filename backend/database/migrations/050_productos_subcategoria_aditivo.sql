-- Sub-categoría libre para materias primas (resina, agua, otros, ...) y
-- bandera "es aditivo" para distinguir materias primas que son aditivos.
-- Ambos campos solo tienen sentido cuando tipo = 'materia_prima'.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS subcategoria_mp VARCHAR(50),
  ADD COLUMN IF NOT EXISTS es_aditivo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_productos_subcategoria_mp
  ON productos (subcategoria_mp) WHERE subcategoria_mp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_productos_es_aditivo
  ON productos (es_aditivo) WHERE es_aditivo = TRUE;
