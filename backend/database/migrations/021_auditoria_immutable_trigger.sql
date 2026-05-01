-- =============================================================
-- Migración 021 — auditoria immutable (mismo patrón que stock_moves)
-- =============================================================
-- La tabla auditoria registra acciones de usuarios para trazabilidad
-- legal/operativa. Sin protección, un atacante con acceso a BD
-- (vector: SQL injection futura, credenciales filtradas) podría
-- borrar evidencia o reescribir el histórico.
--
-- Patrón idéntico a la migración 015 sobre stock_moves: trigger
-- BEFORE DELETE OR UPDATE que lanza excepción explícita. La
-- inserción sigue siendo libre (append-only).
--
-- Si en algún momento legítimo se necesita limpiar auditoria (purga
-- por GDPR, compactación de filas obsoletas), DESACTIVAR el trigger
-- temporalmente con ALTER TABLE ... DISABLE TRIGGER y re-activar.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_auditoria_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'auditoria es append-only: % no permitido', TG_OP
    USING ERRCODE = 'feature_not_supported';
END;
$$;

DROP TRIGGER IF EXISTS trg_auditoria_immutable ON public.auditoria;
CREATE TRIGGER trg_auditoria_immutable
  BEFORE DELETE OR UPDATE ON public.auditoria
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_immutable();

COMMIT;

-- =============================================================
-- ROLLBACK manual:
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_auditoria_immutable ON public.auditoria;
--   DROP FUNCTION IF EXISTS public.fn_auditoria_immutable();
--   COMMIT;
-- =============================================================
