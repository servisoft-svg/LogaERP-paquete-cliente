-- Antes: cada cambio de ingrediente bumpeaba version. Si el usuario añadía
-- 5 ingredientes y guardaba la cabecera, version saltaba de v7 a v13.
-- Ahora: los cambios en ingredientes_receta solo actualizan updated_at; la
-- version sube exclusivamente cuando se edita la cabecera (PUT /recetas/:id).
CREATE OR REPLACE FUNCTION public.fn_recetas_touch_on_ingredientes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.recetas
     SET updated_at = NOW()
   WHERE id = COALESCE(NEW.receta_id, OLD.receta_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
