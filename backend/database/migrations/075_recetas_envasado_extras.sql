-- Extras opcionales en la receta de envasado: cualquier otro material
-- (cinta, film retráctil, tapones, sellos, palé, etc.) con cantidad por bote.
-- Formato: [{ "producto_id": uuid, "cantidad_por_bote": numeric }]
ALTER TABLE recetas_envasado
  ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '[]'::jsonb;
