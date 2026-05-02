-- =============================================================
-- Migración 023 — productos.unidades_por_envase (multiplicador explícito)
-- =============================================================
-- Problema crítico: el código detectaba el multiplicador caja/palé con
-- una regex sobre el NOMBRE del envase: /(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i
-- Cualquier nombre fuera del patrón ("Caja18", "Cajas-18", "BOX 18",
-- "Pallet60") devolvía multiplicador=1 → consumo de cola, etiquetas y
-- envases x18 (o lo que sea) MENOR del real. Fallo silencioso, sin error
-- visible, stock contable diverge del físico.
--
-- Solución:
--   1. Columna explícita unidades_por_envase (NULL = unidad simple).
--   2. Backfill one-time: extraer del nombre con la misma regex (preserva
--      comportamiento actual donde funcionaba).
--   3. Constraint de tipo: solo aplicable a material_embalaje.
--
-- Tras esta migración, el código usa la columna; el regex queda solo como
-- red de seguridad si la columna es NULL.
-- =============================================================

BEGIN;

-- 1) Columna nueva, nullable
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidades_por_envase INTEGER;

-- 2) Constraint: si está set, debe ser >= 1. NULL permitido para no-envases.
DO $$ BEGIN
  ALTER TABLE public.productos
    ADD CONSTRAINT productos_unidades_por_envase_check
    CHECK (unidades_por_envase IS NULL OR unidades_por_envase >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) Backfill one-time: extraer multiplicador del nombre actual.
--    Misma regex que el código TS para preservar comportamiento.
--    Solo aplica a material_embalaje sin valor previo.
UPDATE public.productos
SET unidades_por_envase = (
  CAST(
    SUBSTRING(nombre FROM '(?i)(?:caja|pal[eé]|palet)\s*(?:de\s*)?([0-9]+)')
    AS INTEGER
  )
)
WHERE tipo = 'material_embalaje'
  AND unidades_por_envase IS NULL
  AND nombre ~* '(?:caja|pal[eé]|palet)\s*(?:de\s*)?[0-9]+';

-- 4) Comentario descriptivo
COMMENT ON COLUMN public.productos.unidades_por_envase IS
  'Multiplicador para envases tipo caja/palé. Si una caja contiene 18 frascos, valor=18. NULL = envase unidad. Solo aplica a tipo=material_embalaje.';

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT codigo, nombre, unidades_por_envase
--   FROM productos
--   WHERE tipo='material_embalaje' AND unidades_por_envase IS NOT NULL
--   ORDER BY nombre;
--
-- Esperado: cajas/palés con su multiplicador correcto.
-- Si alguno está mal: editar manualmente con UPDATE puntual.
-- =============================================================
