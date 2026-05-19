-- =============================================================
-- Migración 027 — Anti-ciclo en recetas (defensa preventiva)
-- =============================================================
-- Problema potencial: si existe una cadena recursiva de recetas
-- (producto A usa B como ingrediente, y la receta de B usa A),
-- los triggers de recálculo de coste (migración 026) se llamarían
-- entre ellos en bucle hasta stack overflow PostgreSQL.
--
-- Solución: trigger BEFORE INSERT/UPDATE en ingredientes_receta que
-- recorre el grafo de recetas con CTE recursivo y detecta si añadir
-- el ingrediente cierra un ciclo. Si sí, lanza excepción explícita.
--
-- Casos detectados:
--   - Ciclo directo:    producto A en su propia receta
--   - Ciclo indirecto:  A → B → C → A
-- Profundidad máxima de búsqueda: 20 niveles (suficiente para
-- cualquier producto industrial real, evita falsa-positiva por
-- recetas profundas legítimas).
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_check_ciclo_receta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_producto_final UUID;
  v_ciclo_detectado BOOLEAN;
BEGIN
  -- Producto final de la receta a la que pertenece este ingrediente
  SELECT producto_id INTO v_producto_final
  FROM public.recetas WHERE id = NEW.receta_id;

  -- Ciclo directo: el ingrediente es el propio producto final
  IF NEW.materia_prima_id = v_producto_final THEN
    RAISE EXCEPTION 'Ciclo en receta: un producto no puede ser ingrediente de su propia receta'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ciclo indirecto: recorrer el grafo desde el ingrediente hacia
  -- abajo. Si en algún nivel encontramos el producto final, hay ciclo.
  WITH RECURSIVE descendientes AS (
    -- Nivel 0: el ingrediente que se quiere añadir
    SELECT NEW.materia_prima_id AS producto_id, 0 AS depth
    UNION ALL
    -- Niveles siguientes: los ingredientes de las recetas activas
    -- de cada producto descendiente
    SELECT ir.materia_prima_id, d.depth + 1
    FROM descendientes d
    JOIN public.recetas r ON r.producto_id = d.producto_id AND r.activa = TRUE
    JOIN public.ingredientes_receta ir ON ir.receta_id = r.id
    WHERE d.depth < 20
  )
  SELECT EXISTS(
    SELECT 1 FROM descendientes WHERE producto_id = v_producto_final
  ) INTO v_ciclo_detectado;

  IF v_ciclo_detectado THEN
    RAISE EXCEPTION 'Ciclo en receta: añadir este ingrediente crearía una dependencia circular con el producto final'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_check_ciclo_receta ON public.ingredientes_receta;
CREATE TRIGGER trg_check_ciclo_receta
  BEFORE INSERT OR UPDATE OF materia_prima_id, receta_id ON public.ingredientes_receta
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_ciclo_receta();

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   -- Test ciclo directo (debe fallar):
--   INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, unidad_medida)
--   VALUES (
--     (SELECT id FROM recetas WHERE producto_id = (SELECT id FROM productos WHERE codigo='PT-CB-001') LIMIT 1),
--     (SELECT id FROM productos WHERE codigo='PT-CB-001'),
--     1, 'kg'
--   );
--   -- Esperado: ERROR — Ciclo en receta: un producto no puede ser ingrediente de su propia receta
--
-- ROLLBACK manual:
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_check_ciclo_receta ON public.ingredientes_receta;
--   DROP FUNCTION IF EXISTS public.fn_check_ciclo_receta();
--   COMMIT;
-- =============================================================
