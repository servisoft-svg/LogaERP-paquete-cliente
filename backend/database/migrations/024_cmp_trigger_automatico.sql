-- =============================================================
-- Migración 024 — CMP automático vía trigger en lotes
-- =============================================================
-- Problema crítico: productos.coste_medio_actual nunca se recalculaba
-- automáticamente. El campo se seteaba manualmente o quedaba en 0/precio
-- inicial. Todas las métricas financieras (margen, valor inventario,
-- coste producto envasado, rentabilidad) usaban un "CMP" estático que
-- NO reflejaba la realidad de los lotes en stock.
--
-- Si la cola subía 30% en compras nuevas, el sistema seguía calculando
-- márgenes con precio antiguo → decisiones de pricing erróneas, posible
-- venta a pérdidas sin detectar.
--
-- Solución: trigger AFTER INSERT/UPDATE/DELETE en lotes que recalcula
-- coste_medio_actual del producto afectado:
--
--   CMP = SUM(precio_compra × cantidad_actual) / SUM(cantidad_actual)
--   filtrando lotes WHERE estado='aprobado' AND cantidad_actual > 0
--
-- Disparadores:
--   - INSERT: nuevo lote entra → recalcula
--   - UPDATE de cantidad_actual o estado o precio_compra → recalcula
--   - DELETE de lote → recalcula
--
-- Performance: el SUM se hace solo de los lotes del producto afectado,
-- típicamente <100 filas. Coste despreciable.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Función que recalcula CMP para un producto dado
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_cmp(p_producto_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cmp NUMERIC(20,6);
  v_total_cant NUMERIC(20,6);
  v_total_valor NUMERIC(20,6);
BEGIN
  SELECT
    COALESCE(SUM(precio_compra * cantidad_actual), 0),
    COALESCE(SUM(cantidad_actual), 0)
  INTO v_total_valor, v_total_cant
  FROM public.lotes
  WHERE producto_id = p_producto_id
    AND estado = 'aprobado'
    AND cantidad_actual > 0;

  IF v_total_cant > 0 THEN
    v_cmp := v_total_valor / v_total_cant;
  ELSE
    -- Sin lotes con stock: preservar último CMP conocido (no resetear a 0
    -- para no perder referencia de coste cuando el producto se agota
    -- temporalmente). Si nunca hubo lotes, queda lo que estuviese.
    RETURN;
  END IF;

  UPDATE public.productos
  SET coste_medio_actual = v_cmp,
      updated_at = NOW()
  WHERE id = p_producto_id
    AND COALESCE(coste_medio_actual, 0) <> v_cmp; -- evitar UPDATE si no cambia
END
$$;

GRANT EXECUTE ON FUNCTION public.fn_recalcular_cmp(UUID) TO PUBLIC;

-- ---------------------------------------------------------------
-- 2) Trigger AFTER INSERT/UPDATE/DELETE en lotes
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_lotes_cmp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- INSERT: usar NEW
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_recalcular_cmp(NEW.producto_id);
    RETURN NEW;
  END IF;

  -- UPDATE: si cambia algo relevante para CMP, recalcular.
  -- Si cambia el producto_id (raro pero posible), recalcular AMBOS.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.producto_id <> OLD.producto_id THEN
      PERFORM public.fn_recalcular_cmp(OLD.producto_id);
      PERFORM public.fn_recalcular_cmp(NEW.producto_id);
    ELSIF NEW.cantidad_actual IS DISTINCT FROM OLD.cantidad_actual
       OR NEW.estado IS DISTINCT FROM OLD.estado
       OR NEW.precio_compra IS DISTINCT FROM OLD.precio_compra THEN
      PERFORM public.fn_recalcular_cmp(NEW.producto_id);
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: usar OLD
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_recalcular_cmp(OLD.producto_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_lotes_cmp ON public.lotes;
CREATE TRIGGER trg_lotes_cmp
  AFTER INSERT OR UPDATE OR DELETE ON public.lotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lotes_cmp();

-- ---------------------------------------------------------------
-- 3) Recálculo inicial para TODOS los productos con lotes
--    (one-time, idempotente — no hace daño re-ejecutar)
-- ---------------------------------------------------------------
DO $resync$
DECLARE
  v_producto_id UUID;
  v_count INT := 0;
BEGIN
  FOR v_producto_id IN
    SELECT DISTINCT producto_id FROM public.lotes
    WHERE estado = 'aprobado' AND cantidad_actual > 0
  LOOP
    PERFORM public.fn_recalcular_cmp(v_producto_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[024] CMP recalculado para % productos con lotes activos', v_count;
END
$resync$;

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT p.codigo, p.nombre, p.coste_medio_actual,
--          COUNT(l.id) AS num_lotes,
--          SUM(l.cantidad_actual) AS stock_total,
--          ROUND(SUM(l.precio_compra * l.cantidad_actual) / NULLIF(SUM(l.cantidad_actual), 0), 4) AS cmp_calculado
--   FROM productos p
--   LEFT JOIN lotes l ON l.producto_id = p.id AND l.estado='aprobado' AND l.cantidad_actual > 0
--   WHERE p.tipo IN ('materia_prima', 'producto_fabricado')
--   GROUP BY p.id, p.codigo, p.nombre, p.coste_medio_actual
--   ORDER BY p.nombre LIMIT 20;
--
-- Esperado: coste_medio_actual ≈ cmp_calculado para productos con lotes.
--
-- ROLLBACK manual:
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_lotes_cmp ON public.lotes;
--   DROP FUNCTION IF EXISTS public.fn_trg_lotes_cmp();
--   DROP FUNCTION IF EXISTS public.fn_recalcular_cmp(UUID);
--   COMMIT;
-- =============================================================
