-- =============================================================
-- Migración 025 — stock_actual auto-sincronizado desde lotes aprobados
-- =============================================================
-- Problema crítico de consistencia:
--   - productos.stock_actual era mantenido MANUALMENTE por código TS:
--     "stock_actual = stock_actual ± delta". Frágil:
--       * Si entran lotes en cuarentena, ¿se suma a stock_actual o no?
--         Algunos sitios sí, otros no. Inconsistente.
--       * Si un lote pasa de aprobado→cuarentena, ¿se descuenta de
--         stock_actual? Algunos call sites sí, otros no.
--       * Validación de stock antes de pedido usa stock_actual (incluye
--         cuarentena en algunos casos), pero al consumir falla porque
--         lotes aprobados no cubren la cantidad.
--
-- Solución definitiva:
--   1. fn_stock_disponible(producto_id): única fuente de verdad.
--      = SUM(cantidad_actual) lotes WHERE estado='aprobado' AND
--      cantidad_actual > 0.
--   2. fn_recalcular_stock_actual(producto_id): UPDATE productos.
--      stock_actual con el valor calculado.
--   3. Trigger AFTER INSERT/UPDATE/DELETE en lotes que llama a (2).
--   4. Recálculo inicial one-time para todos los productos con lotes.
--
-- Tras esto:
--   - productos.stock_actual SIEMPRE refleja lotes aprobados con stock>0.
--   - Si una rutina TS hace "stock_actual = stock_actual - X", el siguiente
--     cambio de lote lo re-sincroniza. La autoridad es el trigger.
--   - Vista productos_disponibles para queries de finanzas/UI que
--     necesiten stock disponible explícito junto a otros campos.
--
-- Mismo patrón que la migración 024 (CMP). SECURITY DEFINER + GRANT
-- EXECUTE para roles app sin privilegios de owner.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Función pública: stock disponible de un producto
--    Devuelve SUM(cantidad_actual) de lotes aprobados con stock>0.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stock_disponible(p_producto_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(cantidad_actual), 0)::NUMERIC(20,6)
  FROM public.lotes
  WHERE producto_id = p_producto_id
    AND estado = 'aprobado'
    AND cantidad_actual > 0;
$$;

GRANT EXECUTE ON FUNCTION public.fn_stock_disponible(UUID) TO PUBLIC;

-- ---------------------------------------------------------------
-- 2) Función SECURITY DEFINER que actualiza productos.stock_actual
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_stock_actual(p_producto_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nuevo NUMERIC(20,6);
BEGIN
  v_nuevo := public.fn_stock_disponible(p_producto_id);

  UPDATE public.productos
  SET stock_actual = v_nuevo,
      updated_at = NOW()
  WHERE id = p_producto_id
    AND stock_actual IS DISTINCT FROM v_nuevo; -- evitar UPDATE si no cambia
END
$$;

GRANT EXECUTE ON FUNCTION public.fn_recalcular_stock_actual(UUID) TO PUBLIC;

-- ---------------------------------------------------------------
-- 3) Trigger AFTER INSERT/UPDATE/DELETE en lotes
--    Misma estrategia que el trigger CMP (migración 024).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_lotes_stock_actual()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_recalcular_stock_actual(NEW.producto_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.producto_id <> OLD.producto_id THEN
      PERFORM public.fn_recalcular_stock_actual(OLD.producto_id);
      PERFORM public.fn_recalcular_stock_actual(NEW.producto_id);
    ELSIF NEW.cantidad_actual IS DISTINCT FROM OLD.cantidad_actual
       OR NEW.estado IS DISTINCT FROM OLD.estado THEN
      PERFORM public.fn_recalcular_stock_actual(NEW.producto_id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_recalcular_stock_actual(OLD.producto_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_lotes_stock_actual ON public.lotes;
CREATE TRIGGER trg_lotes_stock_actual
  AFTER INSERT OR UPDATE OR DELETE ON public.lotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lotes_stock_actual();

-- ---------------------------------------------------------------
-- 4) Recálculo inicial: todos los productos con lotes
--    Esto puede CORREGIR drift histórico — esperado.
-- ---------------------------------------------------------------
DO $resync$
DECLARE
  v_producto_id UUID;
  v_count INT := 0;
  v_ajustados INT := 0;
  v_old NUMERIC(20,6);
  v_new NUMERIC(20,6);
BEGIN
  FOR v_producto_id IN
    SELECT DISTINCT producto_id FROM public.lotes
  LOOP
    SELECT stock_actual INTO v_old FROM public.productos WHERE id = v_producto_id;
    PERFORM public.fn_recalcular_stock_actual(v_producto_id);
    SELECT stock_actual INTO v_new FROM public.productos WHERE id = v_producto_id;
    v_count := v_count + 1;
    IF v_old IS DISTINCT FROM v_new THEN
      v_ajustados := v_ajustados + 1;
      RAISE NOTICE '[025] producto % stock_actual: % → %', v_producto_id, v_old, v_new;
    END IF;
  END LOOP;
  RAISE NOTICE '[025] verificados % productos, % ajustados', v_count, v_ajustados;
END
$resync$;

-- ---------------------------------------------------------------
-- 5) Vista helper para queries que necesiten ambos campos
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.productos_con_disponible AS
SELECT
  p.*,
  public.fn_stock_disponible(p.id) AS stock_disponible,
  COALESCE((
    SELECT SUM(l.cantidad_actual) FROM public.lotes l
    WHERE l.producto_id = p.id AND l.estado = 'cuarentena' AND l.cantidad_actual > 0
  ), 0)::NUMERIC(20,6) AS stock_en_cuarentena
FROM public.productos p;

GRANT SELECT ON public.productos_con_disponible TO PUBLIC;

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT codigo, nombre, stock_actual, stock_disponible, stock_en_cuarentena
--   FROM productos_con_disponible
--   WHERE stock_actual <> stock_disponible OR stock_en_cuarentena > 0
--   ORDER BY nombre LIMIT 20;
--
--   Esperado: stock_actual = stock_disponible (siempre, gracias al trigger).
--   stock_en_cuarentena visible aparte.
--
-- ROLLBACK manual:
--   BEGIN;
--   DROP VIEW IF EXISTS public.productos_con_disponible;
--   DROP TRIGGER IF EXISTS trg_lotes_stock_actual ON public.lotes;
--   DROP FUNCTION IF EXISTS public.fn_trg_lotes_stock_actual();
--   DROP FUNCTION IF EXISTS public.fn_recalcular_stock_actual(UUID);
--   DROP FUNCTION IF EXISTS public.fn_stock_disponible(UUID);
--   COMMIT;
-- =============================================================
