-- Parámetros de medida específicos por spec (ej: viscosidad requiere temperatura, husillo, rpm).
-- JSONB permite extender a otras specs sin nuevas columnas.
ALTER TABLE producto_specs
  ADD COLUMN IF NOT EXISTS parametros JSONB;
