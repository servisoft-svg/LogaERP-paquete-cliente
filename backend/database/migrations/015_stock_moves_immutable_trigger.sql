-- =============================================================
-- Migración 015 — stock_moves immutability via trigger (no rules)
-- =============================================================
-- Problema: las RULE no_delete_stock_moves / no_update_stock_moves usan
-- "DO INSTEAD NOTHING", que silenciosamente descartan DELETE/UPDATE sin
-- error. Cualquier código que intente borrar un stock_move cree haber
-- tenido éxito pero la fila sigue ahí, o viceversa: cualquier corrección
-- intentada se pierde sin aviso.
--
-- Solución: reemplazar las rules por un trigger BEFORE que lanza una
-- excepción explícita. La inmutabilidad sigue garantizada y los intentos
-- erróneos producen un error visible (rollback de la transacción).
-- =============================================================

BEGIN;

-- 1) Quitar las rules silenciosas si existen
DROP RULE IF EXISTS no_delete_stock_moves ON public.stock_moves;
DROP RULE IF EXISTS no_update_stock_moves ON public.stock_moves;

-- 2) Función que rechaza cualquier DELETE/UPDATE
CREATE OR REPLACE FUNCTION public.fn_stock_moves_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'stock_moves es inmutable: % no permitido en %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'feature_not_supported';
END;
$$;

-- 3) Trigger BEFORE DELETE OR UPDATE
DROP TRIGGER IF EXISTS trg_stock_moves_immutable ON public.stock_moves;
CREATE TRIGGER trg_stock_moves_immutable
  BEFORE DELETE OR UPDATE ON public.stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.fn_stock_moves_immutable();

COMMIT;

-- =============================================================
-- ROLLBACK manual (no automático) — solo si fuese necesario revertir:
-- =============================================================
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_stock_moves_immutable ON public.stock_moves;
--   DROP FUNCTION IF EXISTS public.fn_stock_moves_immutable();
--   CREATE RULE no_delete_stock_moves AS ON DELETE TO public.stock_moves DO INSTEAD NOTHING;
--   CREATE RULE no_update_stock_moves AS ON UPDATE TO public.stock_moves DO INSTEAD NOTHING;
--   COMMIT;
-- =============================================================
