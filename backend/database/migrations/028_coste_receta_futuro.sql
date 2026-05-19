-- =============================================================
-- Migración 028 — Coste futuro proyectado desde receta
-- =============================================================
-- Distinción funcional:
--   * COSTE REAL/ACTUAL → productos.precio_unitario (auto-mantenido
--     por trigger 026 fn_actualizar_coste_si_no_manual). Usa CMP de
--     lotes existentes — refleja lo que YA se ha pagado.
--     Pantalla Productos muestra este valor.
--
--   * COSTE FUTURO/PROYECTADO → fn_calcular_coste_receta_futuro.
--     Usa precio_unitario (ficha) de las MP — refleja lo que costará
--     producir cuando los lotes actuales se agoten y haya que comprar
--     a los precios actuales del proveedor (las "subidas de precios").
--     Pantalla Finanzas usa este valor para rentabilidad y márgenes.
--
-- Implementación: función recursiva (depth 20) que para cada
-- ingrediente decide:
--   - Si MP/embalaje (tipo terminal) → precio_unitario ficha (futuro).
--   - Si fabricado/envasado con receta → recurse.
--   - Si fabricado/envasado sin receta → precio_unitario almacenado.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_calcular_coste_receta_futuro(
  p_producto_id UUID,
  p_depth INT DEFAULT 0
) RETURNS NUMERIC(20,6)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_tipo TEXT;
  v_tipo_receta TEXT;
  v_receta_id UUID;
  v_rendimiento NUMERIC(20,6);
  v_coste_total NUMERIC(20,6) := 0;
  v_ing RECORD;
  v_precio_ing NUMERIC(20,6);
BEGIN
  -- Protección contra recursión patológica (debería bloquear 027 antes,
  -- pero por seguridad).
  IF p_depth > 20 THEN RETURN 0; END IF;

  SELECT tipo::text INTO v_tipo
  FROM public.productos WHERE id = p_producto_id;

  v_tipo_receta := CASE
    WHEN v_tipo = 'producto_envasado'  THEN 'envasado'
    WHEN v_tipo = 'producto_fabricado' THEN 'fabricacion'
    ELSE NULL
  END;

  -- Hoja: MP, embalaje, terminado-sin-receta → precio ficha
  IF v_tipo_receta IS NULL THEN
    SELECT COALESCE(precio_unitario, 0) INTO v_precio_ing
    FROM public.productos WHERE id = p_producto_id;
    RETURN COALESCE(v_precio_ing, 0);
  END IF;

  -- Receta activa
  SELECT id, rendimiento INTO v_receta_id, v_rendimiento
  FROM public.recetas
  WHERE producto_id = p_producto_id
    AND tipo_receta = v_tipo_receta
    AND activa = TRUE
  ORDER BY version DESC LIMIT 1;

  -- Sin receta válida: caer al precio almacenado (lo mejor que tenemos)
  IF v_receta_id IS NULL OR v_rendimiento IS NULL OR v_rendimiento <= 0 THEN
    SELECT COALESCE(precio_unitario, 0) INTO v_precio_ing
    FROM public.productos WHERE id = p_producto_id;
    RETURN COALESCE(v_precio_ing, 0);
  END IF;

  -- Sumar coste recursivo de cada ingrediente
  FOR v_ing IN
    SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id
    FROM public.ingredientes_receta ir
    WHERE ir.receta_id = v_receta_id
  LOOP
    v_precio_ing := public.fn_calcular_coste_receta_futuro(
      v_ing.materia_prima_id, p_depth + 1
    );
    v_coste_total := v_coste_total
      + v_ing.cantidad
      * (1 + COALESCE(v_ing.porcentaje_merma, 0)::NUMERIC / 100)
      * COALESCE(v_precio_ing, 0);
  END LOOP;

  IF v_coste_total <= 0 THEN RETURN 0; END IF;
  RETURN (v_coste_total / v_rendimiento)::NUMERIC(20,6);
END
$$;

GRANT EXECUTE ON FUNCTION public.fn_calcular_coste_receta_futuro(UUID, INT) TO PUBLIC;

COMMIT;

-- =============================================================
-- VERIFICACIÓN:
--   SELECT codigo, nombre,
--          precio_unitario::float8 AS coste_real,
--          public.fn_calcular_coste_receta_futuro(id)::float8 AS coste_futuro
--   FROM productos
--   WHERE tipo IN ('producto_fabricado','producto_envasado')
--     AND activo = TRUE
--   ORDER BY nombre LIMIT 20;
--
-- ROLLBACK manual:
--   DROP FUNCTION IF EXISTS public.fn_calcular_coste_receta_futuro(UUID, INT);
-- =============================================================
