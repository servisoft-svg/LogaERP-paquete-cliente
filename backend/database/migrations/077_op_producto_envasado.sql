-- producto_envasado_id directamente en la orden — el PE que se está produciendo.
-- Antes se derivaba vía receta_envasado_id → recetas_envasado.producto_envasado_id,
-- pero las órdenes one-off (sin receta guardada) quedaban con NULL.
ALTER TABLE ordenes_produccion
  ADD COLUMN IF NOT EXISTS producto_envasado_id UUID REFERENCES productos(id) ON DELETE SET NULL;
