-- Precio unitario total = precio_compra + porte/cantidad_inicial. Es lo que
-- realmente cuesta cada unidad del lote (materia + transporte repartido).
-- Se guarda como columna GENERATED para no desincronizarse jamás.
-- Permite saber a posteriori cuánto fue puramente porte sumando porte de
-- todos los lotes de un periodo.
ALTER TABLE public.lotes
  ADD COLUMN IF NOT EXISTS precio_unitario_total NUMERIC(20,6)
  GENERATED ALWAYS AS (
    COALESCE(precio_compra, 0) +
    CASE WHEN cantidad_inicial > 0
         THEN COALESCE(porte, 0) / cantidad_inicial
         ELSE 0
    END
  ) STORED;
