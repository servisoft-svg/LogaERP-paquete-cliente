-- Versionado con debounce: 7 cambios seguidos cuentan como 1 sola edición
-- (v4 → v5). Si pasan más de 30s sin tocar la receta, el siguiente cambio
-- inicia una nueva versión.
--   - `version_updated_at` marca la última vez que la version subió.
--   - Cualquier cambio (cabecera o ingrediente) bumpa solo si el último bump
--     fue hace más de 30 segundos.

ALTER TABLE public.recetas
  ADD COLUMN IF NOT EXISTS version_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Auto-version en UPDATE de cabecera con debounce.
CREATE OR REPLACE FUNCTION public.fn_recetas_auto_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  cambio BOOLEAN := FALSE;
  ventana INTERVAL := INTERVAL '30 seconds';
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

  IF cambio AND NEW.version = OLD.version THEN
    IF (NOW() - OLD.version_updated_at) > ventana THEN
      NEW.version := OLD.version + 1;
      NEW.version_updated_at := NOW();
    END IF;
  ELSIF NEW.version <> OLD.version THEN
    -- Cuando la app fuerza una version concreta (ej. restaurar), sincronizar.
    NEW.version_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger en ingredientes_receta: solo updated_at + posible bump con debounce.
CREATE OR REPLACE FUNCTION public.fn_recetas_touch_on_ingredientes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ventana INTERVAL := INTERVAL '30 seconds';
  rid UUID := COALESCE(NEW.receta_id, OLD.receta_id);
  ultBump TIMESTAMPTZ;
BEGIN
  SELECT version_updated_at INTO ultBump FROM public.recetas WHERE id = rid;
  IF ultBump IS NULL OR (NOW() - ultBump) > ventana THEN
    UPDATE public.recetas
       SET updated_at = NOW(),
           version = version + 1,
           version_updated_at = NOW()
     WHERE id = rid;
  ELSE
    UPDATE public.recetas SET updated_at = NOW() WHERE id = rid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
