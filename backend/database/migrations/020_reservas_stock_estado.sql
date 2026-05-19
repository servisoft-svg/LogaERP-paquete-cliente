-- =============================================================
-- Migración 020 — reservas_stock.estado (audit-preserving)
-- =============================================================
-- Antes: cuando un pedido completa su consumo (/consumir o
-- autoCompletarPedido), las filas de reservas_stock se borraban con
-- DELETE. Esto perdía la trazabilidad de qué pedido consumió qué
-- lote y abría una ventana en la que el cálculo
-- "cantidad_disponible = cantidad_actual - SUM(reservas)" podía
-- divergir entre dos transacciones concurrentes (la reserva ya no
-- existe pero el descuento al lote aún no se ve).
--
-- Ahora: cada reserva tiene estado ('activa', 'consumida', 'cancelada').
--   - INSERT  → 'activa'
--   - /consumir + autoCompletarPedido → UPDATE 'consumida'
--   - PUT pedido (regenera reservas) → DELETE+INSERT (acepable: cambio
--     de líneas implica recalcular)
--   - DELETE pedido cancelado → DELETE (sin auditar, fila no relevante)
--
-- Las queries de "reservado" filtran WHERE estado = 'activa'.
-- Idempotente.
-- =============================================================

BEGIN;

-- 1) Añadir columna si no existe
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reservas_stock' AND column_name='estado'
  ) THEN
    ALTER TABLE public.reservas_stock
      ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'activa';
    ALTER TABLE public.reservas_stock
      ADD CONSTRAINT reservas_stock_estado_check
      CHECK (estado IN ('activa', 'consumida', 'cancelada'));
    RAISE NOTICE '[020] reservas_stock.estado creada (default=activa)';
  ELSE
    RAISE NOTICE '[020] reservas_stock.estado ya existía';
  END IF;
END $$;

-- 2) Índice parcial para queries "reservas activas" — el filtro común.
--    El existente idx_reservas_pedido_lote (creado en 019) NO incluye
--    estado, así que es complementario, no redundante.
CREATE INDEX IF NOT EXISTS idx_reservas_activas
  ON public.reservas_stock (lote_id, producto_id)
  WHERE estado = 'activa';

COMMIT;

-- =============================================================
-- ROLLBACK manual:
--   BEGIN;
--   DROP INDEX IF EXISTS idx_reservas_activas;
--   ALTER TABLE public.reservas_stock DROP CONSTRAINT IF EXISTS reservas_stock_estado_check;
--   ALTER TABLE public.reservas_stock DROP COLUMN IF EXISTS estado;
--   COMMIT;
-- =============================================================
