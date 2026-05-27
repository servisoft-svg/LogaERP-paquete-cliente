-- Cuando se añade/edita/borra un ingrediente, actualiza updated_at de la
-- receta padre. Sin esto, la fecha de "última edición" no reflejaba cambios
-- en la composición — solo en cabecera (nombre, rendimiento, notas, pasos…).
CREATE OR REPLACE FUNCTION public.fn_recetas_touch_on_ingredientes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.recetas
     SET updated_at = NOW()
   WHERE id = COALESCE(NEW.receta_id, OLD.receta_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recetas_touch_on_ingredientes ON public.ingredientes_receta;
CREATE TRIGGER trg_recetas_touch_on_ingredientes
AFTER INSERT OR UPDATE OR DELETE ON public.ingredientes_receta
FOR EACH ROW EXECUTE FUNCTION public.fn_recetas_touch_on_ingredientes();
