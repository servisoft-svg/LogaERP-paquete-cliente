-- =============================================================
-- Migración 019 — FKs faltantes + índices para JOINs/WHEREs comunes
-- =============================================================
-- Hallazgos auditoría:
--   - stock_moves.usuario_id sin FK → orphans si user borrado
--   - ordenes_compra.proveedor_id sin índice → seq scan en "OCs por proveedor"
--   - pedidos.producto_id sin índice → seq scan en "pedidos por producto"
--
-- PostgreSQL 16: las FK sí se propagan automáticamente a particiones
-- de tablas particionadas (desde PG12+). NOT VALID + VALIDATE permite
-- añadir FKs sin lock pesado en tablas grandes.
--
-- Índices: CREATE INDEX CONCURRENTLY no se permite dentro de
-- transacción → esta migración usa CREATE INDEX normal (asume tabla
-- pequeña/medio en este punto). Para tablas grandes en producción,
-- considerar variantes CONCURRENTLY ejecutadas fuera del fichero.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) FK stock_moves.usuario_id → usuarios(id) ON DELETE SET NULL
--    SET NULL preserva el histórico aunque el usuario sea borrado.
--    PG16 no soporta NOT VALID en FKs sobre particionadas, así que
--    se añade con validación inmediata. Para tablas grandes esto
--    requiere SHARE ROW EXCLUSIVE lock — aceptable en mantenimiento.
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_huerfanos INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.stock_moves'::regclass
      AND conname  = 'stock_moves_usuario_id_fkey'
  ) THEN
    RAISE NOTICE '[019] FK stock_moves.usuario_id ya existía';
    RETURN;
  END IF;

  -- Pre-check: contar huérfanos para mensaje claro si hay
  SELECT COUNT(*) INTO v_huerfanos
  FROM public.stock_moves sm
  WHERE sm.usuario_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = sm.usuario_id);

  IF v_huerfanos > 0 THEN
    -- Limpiar huérfanos antes de añadir FK (preservando audit con NULL)
    UPDATE public.stock_moves SET usuario_id = NULL
    WHERE usuario_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = usuario_id);
    RAISE NOTICE '[019] limpiados % stock_moves con usuario_id huérfano (set NULL)', v_huerfanos;
  END IF;

  ALTER TABLE public.stock_moves
    ADD CONSTRAINT stock_moves_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
    ON DELETE SET NULL;
  RAISE NOTICE '[019] FK stock_moves.usuario_id creada';
END
$$;

-- ---------------------------------------------------------------
-- 2) Índices para JOINs/WHEREs comunes (los que faltaban según auditoría)
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_oc_proveedor
  ON public.ordenes_compra (proveedor_id) WHERE proveedor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_producto
  ON public.pedidos (producto_id) WHERE producto_id IS NOT NULL;

-- Notificaciones: índice parcial UNIQUE para evitar duplicados de
-- alertas no leídas por (producto_id, tipo) — la tabla ya tiene
-- ON CONFLICT en el código pero sin la unique no funciona.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_producto_tipo_unread
  ON public.notificaciones (producto_id, tipo)
  WHERE leida = FALSE;

-- Reservas stock: índice compuesto para "reservas por pedido + lote"
CREATE INDEX IF NOT EXISTS idx_reservas_pedido_lote
  ON public.reservas_stock (pedido_id, lote_id);

COMMIT;

-- =============================================================
-- ROLLBACK manual:
--   BEGIN;
--   ALTER TABLE public.stock_moves DROP CONSTRAINT IF EXISTS stock_moves_usuario_id_fkey;
--   DROP INDEX IF EXISTS idx_oc_proveedor;
--   DROP INDEX IF EXISTS idx_pedidos_producto;
--   DROP INDEX IF EXISTS idx_notif_producto_tipo_unread;
--   DROP INDEX IF EXISTS idx_reservas_pedido_lote;
--   COMMIT;
-- =============================================================
