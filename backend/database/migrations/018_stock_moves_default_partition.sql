-- =============================================================
-- Migración 018 — DEFAULT partition para stock_moves
-- =============================================================
-- Problema: stock_moves tiene particiones hardcoded 2022..2035. Tras
-- 2035 cualquier INSERT fallará con error opaco "no partition of
-- relation found for row". El sistema deja de aceptar movimientos de
-- stock — fallo total silencioso a 10 años vista.
--
-- Solución: añadir partición DEFAULT que captura cualquier created_at
-- fuera de los rangos definidos. Los nuevos años pueden seguir
-- creándose explícitamente para mantener el particionamiento óptimo,
-- pero la tabla nunca rechaza un INSERT.
--
-- Nota: una partición DEFAULT NO impide crear más particiones
-- explícitas en el futuro mientras estén vacías esos rangos. Sí
-- bloquea ATTACH PARTITION de un rango que ya tiene filas en default.
-- =============================================================

BEGIN;

-- Crea la partición DEFAULT solo si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.stock_moves'::regclass
      AND c.relname = 'stock_moves_default'
  ) THEN
    EXECUTE 'CREATE TABLE public.stock_moves_default PARTITION OF public.stock_moves DEFAULT';
    RAISE NOTICE '[018] partición DEFAULT stock_moves_default creada';
  ELSE
    RAISE NOTICE '[018] partición DEFAULT ya existía — no se hace nada';
  END IF;
END
$$;

COMMIT;

-- =============================================================
-- ROLLBACK manual:
--   BEGIN;
--   DROP TABLE IF EXISTS public.stock_moves_default;
--   COMMIT;
-- =============================================================
