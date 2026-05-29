-- Las órdenes de tipo 'envasado' usan prefijo EM- en lugar de OP-.
-- Mantiene su propia secuencia independiente para que la numeración sea
-- continua (EM-2026-00001, EM-2026-00002, ...).

CREATE SEQUENCE IF NOT EXISTS seq_numero_orden_em;

CREATE OR REPLACE FUNCTION public.fn_numero_orden()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.numero_orden IS NULL OR NEW.numero_orden = '' THEN
    IF NEW.tipo_orden = 'envasado' THEN
      NEW.numero_orden := 'EM-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                          LPAD(nextval('seq_numero_orden_em')::TEXT, 5, '0');
    ELSE
      NEW.numero_orden := 'OP-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                          LPAD(nextval('seq_numero_orden')::TEXT, 5, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
