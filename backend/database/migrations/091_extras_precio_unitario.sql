-- ============================================================
-- 091: Precio unitario en material extra del pedido.
-- Default = 0 (puro coste interno, no facturable).
-- Si > 0, el extra aparece como línea adicional en el albarán PDF
-- y suma al total cobrado al cliente.
-- Al añadir un extra el backend autorellena con productos.precio_venta;
-- el admin lo puede modificar en el modal del pedido.
-- ============================================================

BEGIN;

ALTER TABLE public.pedido_embalajes_extra
  ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(20,6) NOT NULL DEFAULT 0;

COMMIT;
