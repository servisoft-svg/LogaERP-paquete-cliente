-- =============================================================
-- Migración 029 — Limpieza de duplicados en stock_moves
-- =============================================================
-- Bug detectado: stock_moves (tabla particionada) tenía rows físicas
-- duplicadas (misma id, mismo created_at, mismo todo). Causa probable:
-- seed_5years.sql ejecutado múltiples veces sin limpiar. Como la tabla
-- no tenía PRIMARY KEY (solo `id` con default UUID, sin constraint),
-- nada lo evitaba.
--
-- Impacto: SUM sobre stock_moves contaba duplicados → coste de
-- producción y mermas inflados ~10-50% según año.
--
-- Pasos:
--   1. Desactivar trg_stock_moves_immutable (BEFORE DELETE bloquea)
--   2. DELETE manteniendo solo 1 row por (id, created_at) — el menor
--      ctid (físicamente primero) en cada partición
--   3. Reactivar trigger
--   4. Crear índice UNIQUE (id, created_at) — equivalente a PK para
--      tablas particionadas, previene futuros duplicados
--
-- Idempotente: si no hay duplicados el DELETE no borra nada y el
-- índice UNIQUE detecta que ya existe.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Desactivar trigger inmutable temporalmente
-- ---------------------------------------------------------------
ALTER TABLE public.stock_moves DISABLE TRIGGER trg_stock_moves_immutable;

-- ---------------------------------------------------------------
-- 2) Reportar cuántos duplicados hay antes de borrar
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_total INT;
  v_unicos INT;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT (id, created_at))
  INTO v_total, v_unicos
  FROM public.stock_moves;
  RAISE NOTICE '[029] stock_moves antes: % rows, % únicos → % duplicados',
    v_total, v_unicos, (v_total - v_unicos);
END $$;

-- ---------------------------------------------------------------
-- 3) Borrar duplicados manteniendo el ctid menor por cada (id, created_at)
--    Como duplicados son rows físicamente IDÉNTICAS, todos viven en la
--    misma partición (mismo created_at), así que ctid sirve para distinguir.
-- ---------------------------------------------------------------
DELETE FROM public.stock_moves a
USING public.stock_moves b
WHERE a.id = b.id
  AND a.created_at = b.created_at
  AND a.ctid > b.ctid;

-- ---------------------------------------------------------------
-- 4) Reportar resultado
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_total INT;
  v_unicos INT;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT (id, created_at))
  INTO v_total, v_unicos
  FROM public.stock_moves;
  RAISE NOTICE '[029] stock_moves después: % rows, % únicos', v_total, v_unicos;
END $$;

-- ---------------------------------------------------------------
-- 5) Reactivar trigger inmutable
-- ---------------------------------------------------------------
ALTER TABLE public.stock_moves ENABLE TRIGGER trg_stock_moves_immutable;

-- ---------------------------------------------------------------
-- 6) Constraint UNIQUE (id, created_at) — para tablas particionadas
--    debe incluir la columna de partición. Equivalente a PK.
-- ---------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_moves_id_created_at_unique'
  ) THEN
    ALTER TABLE public.stock_moves
      ADD CONSTRAINT stock_moves_id_created_at_unique UNIQUE (id, created_at);
    RAISE NOTICE '[029] UNIQUE (id, created_at) creado';
  ELSE
    RAISE NOTICE '[029] UNIQUE (id, created_at) ya existía';
  END IF;
END $$;

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT COUNT(*), COUNT(DISTINCT id) FROM stock_moves;
--   -- ambos deben coincidir (todos los IDs únicos)
--
--   -- Test prevención: este INSERT debe fallar
--   -- INSERT INTO stock_moves (id, ...) SELECT id, ... FROM stock_moves LIMIT 1;
--
-- ROLLBACK manual:
--   ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_id_created_at_unique;
--   -- (los duplicados borrados NO se pueden recuperar — eran idénticos)
-- =============================================================
