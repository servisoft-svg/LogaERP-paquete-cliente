-- Auto-bump de recetas.version en cada edición real de la receta.
-- Cuenta como edición cambiar cualquier campo de cabecera (nombre,
-- rendimiento, notas, pasos, rangos QC, tipo) o cualquier ingrediente.
-- Evita doble-bump si la app ya envió un version distinto explícitamente.

-- Quitar la UNIQUE constraint (producto_id, version): impedía bumpear cuando
-- existían versiones antiguas archivadas con número mayor. La trazabilidad
-- se mantiene por (id, updated_at, version) sin necesitar unicidad estricta.
ALTER TABLE public.recetas
  DROP CONSTRAINT IF EXISTS recetas_producto_id_version_key;

CREATE OR REPLACE FUNCTION public.fn_recetas_auto_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  cambio BOOLEAN := FALSE;
BEGIN
  cambio :=
       COALESCE(NEW.nombre,'')      IS DISTINCT FROM COALESCE(OLD.nombre,'')
    OR NEW.rendimiento               IS DISTINCT FROM OLD.rendimiento
    OR COALESCE(NEW.notas,'')        IS DISTINCT FROM COALESCE(OLD.notas,'')
    OR COALESCE(NEW.pasos::text,'')  IS DISTINCT FROM COALESCE(OLD.pasos::text,'')
    OR NEW.ph_min                    IS DISTINCT FROM OLD.ph_min
    OR NEW.ph_max                    IS DISTINCT FROM OLD.ph_max
    OR NEW.solidos_min               IS DISTINCT FROM OLD.solidos_min
    OR NEW.solidos_max               IS DISTINCT FROM OLD.solidos_max
    OR NEW.viscosidad_min            IS DISTINCT FROM OLD.viscosidad_min
    OR NEW.viscosidad_max            IS DISTINCT FROM OLD.viscosidad_max
    OR COALESCE(NEW.tipo_receta,'')  IS DISTINCT FROM COALESCE(OLD.tipo_receta,'')
    OR NEW.producto_id               IS DISTINCT FROM OLD.producto_id;

  -- Solo bump si hay cambio real y la app no incrementó por sí misma.
  IF cambio AND NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recetas_auto_version ON public.recetas;
CREATE TRIGGER trg_recetas_auto_version
BEFORE UPDATE ON public.recetas
FOR EACH ROW EXECUTE FUNCTION public.fn_recetas_auto_version();

-- También cuando cambian los ingredientes (añadir, editar, borrar) — la
-- composición es parte de la receta, así que cuenta como nueva versión.
CREATE OR REPLACE FUNCTION public.fn_recetas_touch_on_ingredientes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.recetas
     SET updated_at = NOW(),
         version = version + 1
   WHERE id = COALESCE(NEW.receta_id, OLD.receta_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
