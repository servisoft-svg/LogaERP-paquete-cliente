-- =============================================================
-- Migración 026 — Precio de coste auto-calculado desde receta
-- =============================================================
-- Comportamiento solicitado:
--   - Si un producto tiene receta activa, su precio_unitario (coste)
--     se calcula automáticamente como el coste recursivo de la receta:
--       SUM(ingrediente.cantidad × CMP_ingrediente × (1 + merma%)) / rendimiento
--   - Si el usuario edita manualmente el precio en la UI, se respeta
--     su modificación (precio_coste_manual = TRUE).
--   - Cuando cambia la receta o el CMP de los ingredientes, el precio
--     se recalcula automáticamente — siempre que no esté en modo manual.
--
-- Implementación:
--   1. Columna productos.precio_coste_manual BOOLEAN DEFAULT FALSE
--   2. Función fn_calcular_coste_receta(producto_id) → NUMERIC (read-only)
--   3. Función fn_actualizar_coste_si_no_manual(producto_id) → VOID
--      (actualiza productos.precio_unitario si no manual)
--   4. Trigger en ingredientes_receta → recalcula al cambiar receta
--   5. Trigger en recetas (UPDATE rendimiento/activa) → recalcula
--   6. Trigger en lotes (CMP cambia) → recalcula productos que usan
--      este ingrediente en alguna receta activa
--
-- Idempotente. Rollback documentado al final.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Columna nueva — flag de override manual
-- ---------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='productos' AND column_name='precio_coste_manual'
  ) THEN
    ALTER TABLE public.productos
      ADD COLUMN precio_coste_manual BOOLEAN NOT NULL DEFAULT FALSE;
    COMMENT ON COLUMN public.productos.precio_coste_manual IS
      'Si TRUE, precio_unitario es manual y NO se sobrescribe por el cálculo automático desde receta. Si FALSE (default), el sistema lo recalcula tras cambios en receta o CMP de ingredientes.';
    RAISE NOTICE '[026] productos.precio_coste_manual creada';
  ELSE
    RAISE NOTICE '[026] productos.precio_coste_manual ya existía';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 2) Función read-only: calcular coste recursivo desde receta
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_coste_receta(p_producto_id UUID)
RETURNS NUMERIC(20,6)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tipo_producto TEXT;
  v_tipo_receta TEXT;
  v_receta_id UUID;
  v_rendimiento NUMERIC(20,6);
  v_coste_total NUMERIC(20,6) := 0;
BEGIN
  -- Tipo del producto → determina qué receta buscar
  SELECT tipo::text INTO v_tipo_producto
  FROM public.productos WHERE id = p_producto_id;

  v_tipo_receta := CASE
    WHEN v_tipo_producto = 'producto_envasado'  THEN 'envasado'
    WHEN v_tipo_producto = 'producto_fabricado' THEN 'fabricacion'
    ELSE NULL
  END;

  IF v_tipo_receta IS NULL THEN RETURN NULL; END IF;

  -- Receta activa más reciente
  SELECT id, rendimiento INTO v_receta_id, v_rendimiento
  FROM public.recetas
  WHERE producto_id = p_producto_id
    AND tipo_receta = v_tipo_receta
    AND activa = TRUE
  ORDER BY version DESC
  LIMIT 1;

  IF v_receta_id IS NULL OR v_rendimiento IS NULL OR v_rendimiento <= 0 THEN
    RETURN NULL;
  END IF;

  -- Suma del coste de cada ingrediente:
  --   cantidad × (1 + merma%) × CMP_o_precio
  -- CMP del ingrediente = COALESCE(coste_medio_actual, precio_unitario, 0)
  SELECT COALESCE(SUM(
    ir.cantidad
    * (1 + ir.porcentaje_merma::NUMERIC / 100)
    * COALESCE(NULLIF(ip.coste_medio_actual, 0), ip.precio_unitario, 0)
  ), 0)
  INTO v_coste_total
  FROM public.ingredientes_receta ir
  JOIN public.productos ip ON ip.id = ir.materia_prima_id
  WHERE ir.receta_id = v_receta_id;

  IF v_coste_total <= 0 THEN RETURN NULL; END IF;

  RETURN (v_coste_total / v_rendimiento)::NUMERIC(20,6);
END
$$;

GRANT EXECUTE ON FUNCTION public.fn_calcular_coste_receta(UUID) TO PUBLIC;

-- ---------------------------------------------------------------
-- 3) Función SECURITY DEFINER: actualiza el precio del producto
--    SOLO si no está en modo manual.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_actualizar_coste_si_no_manual(p_producto_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_es_manual BOOLEAN;
  v_nuevo_coste NUMERIC(20,6);
  v_actual NUMERIC(20,6);
BEGIN
  -- Si está en modo manual, NO tocar
  SELECT precio_coste_manual, precio_unitario INTO v_es_manual, v_actual
  FROM public.productos WHERE id = p_producto_id;

  IF v_es_manual THEN RETURN; END IF;

  v_nuevo_coste := public.fn_calcular_coste_receta(p_producto_id);

  -- Si no hay receta válida, no hacer nada (preserva el valor existente)
  IF v_nuevo_coste IS NULL THEN RETURN; END IF;

  -- Solo UPDATE si cambia el valor (evita triggers cascada inútiles)
  IF v_actual IS DISTINCT FROM v_nuevo_coste THEN
    UPDATE public.productos
    SET precio_unitario = v_nuevo_coste,
        updated_at = NOW()
    WHERE id = p_producto_id
      AND precio_coste_manual = FALSE;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.fn_actualizar_coste_si_no_manual(UUID) TO PUBLIC;

-- ---------------------------------------------------------------
-- 4) Trigger en ingredientes_receta: recalcular cuando cambian
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_ingredientes_receta_coste()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_producto_id UUID;
BEGIN
  -- Encontrar producto final de la receta afectada
  SELECT producto_id INTO v_producto_id
  FROM public.recetas
  WHERE id = COALESCE(NEW.receta_id, OLD.receta_id);

  IF v_producto_id IS NOT NULL THEN
    PERFORM public.fn_actualizar_coste_si_no_manual(v_producto_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_ingredientes_receta_coste ON public.ingredientes_receta;
CREATE TRIGGER trg_ingredientes_receta_coste
  AFTER INSERT OR UPDATE OR DELETE ON public.ingredientes_receta
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ingredientes_receta_coste();

-- ---------------------------------------------------------------
-- 5) Trigger en recetas: recalcular si cambia rendimiento o activa
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_recetas_coste()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_actualizar_coste_si_no_manual(NEW.producto_id);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo recalcular si cambió algo relevante
    IF NEW.rendimiento IS DISTINCT FROM OLD.rendimiento
       OR NEW.activa IS DISTINCT FROM OLD.activa
       OR NEW.tipo_receta IS DISTINCT FROM OLD.tipo_receta THEN
      PERFORM public.fn_actualizar_coste_si_no_manual(NEW.producto_id);
      IF NEW.producto_id <> OLD.producto_id THEN
        PERFORM public.fn_actualizar_coste_si_no_manual(OLD.producto_id);
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.fn_actualizar_coste_si_no_manual(OLD.producto_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_recetas_coste ON public.recetas;
CREATE TRIGGER trg_recetas_coste
  AFTER INSERT OR UPDATE OR DELETE ON public.recetas
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recetas_coste();

-- ---------------------------------------------------------------
-- 6) Trigger en lotes: cuando cambia el CMP de un producto que es
--    INGREDIENTE de alguna receta activa, recalcular coste de los
--    productos finales que usan ese ingrediente.
--
--    Este trigger es complementario al trg_lotes_cmp (migración 024).
--    Orden de ejecución: AFTER (después que CMP ya está actualizado).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_lotes_coste_recursivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_producto_id UUID;
  v_producto_final UUID;
BEGIN
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);

  -- Encontrar todos los productos cuyas recetas activas usan este
  -- producto como ingrediente, y recalcular su coste.
  FOR v_producto_final IN
    SELECT DISTINCT r.producto_id
    FROM public.recetas r
    JOIN public.ingredientes_receta ir ON ir.receta_id = r.id
    WHERE ir.materia_prima_id = v_producto_id
      AND r.activa = TRUE
  LOOP
    PERFORM public.fn_actualizar_coste_si_no_manual(v_producto_final);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_lotes_coste_recursivo ON public.lotes;
CREATE TRIGGER trg_lotes_coste_recursivo
  AFTER INSERT OR UPDATE OR DELETE ON public.lotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lotes_coste_recursivo();

-- ---------------------------------------------------------------
-- 7) Recálculo inicial one-time para productos con receta activa
--    (los que NO están en modo manual — todos en este momento).
-- ---------------------------------------------------------------
DO $resync$
DECLARE
  v_producto_id UUID;
  v_count INT := 0;
BEGIN
  FOR v_producto_id IN
    SELECT DISTINCT p.id
    FROM public.productos p
    JOIN public.recetas r ON r.producto_id = p.id AND r.activa = TRUE
    WHERE p.precio_coste_manual = FALSE
  LOOP
    PERFORM public.fn_actualizar_coste_si_no_manual(v_producto_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[026] coste recalculado en % productos con receta activa', v_count;
END
$resync$;

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT codigo, nombre, precio_unitario::float8, precio_coste_manual,
--          public.fn_calcular_coste_receta(id)::float8 AS coste_calculado
--   FROM productos
--   WHERE tipo IN ('producto_fabricado', 'producto_envasado')
--   ORDER BY nombre LIMIT 20;
--
-- ROLLBACK manual:
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_lotes_coste_recursivo ON public.lotes;
--   DROP TRIGGER IF EXISTS trg_recetas_coste ON public.recetas;
--   DROP TRIGGER IF EXISTS trg_ingredientes_receta_coste ON public.ingredientes_receta;
--   DROP FUNCTION IF EXISTS public.fn_trg_lotes_coste_recursivo();
--   DROP FUNCTION IF EXISTS public.fn_trg_recetas_coste();
--   DROP FUNCTION IF EXISTS public.fn_trg_ingredientes_receta_coste();
--   DROP FUNCTION IF EXISTS public.fn_actualizar_coste_si_no_manual(UUID);
--   DROP FUNCTION IF EXISTS public.fn_calcular_coste_receta(UUID);
--   ALTER TABLE public.productos DROP COLUMN IF EXISTS precio_coste_manual;
--   COMMIT;
-- =============================================================
