-- Campos extra para el pedido a proveedor: precio estimado + número correlativo + PDF generado.
ALTER TABLE pedidos_proveedor
  ADD COLUMN IF NOT EXISTS numero_solicitud  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS precio_unitario   NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS importe_total     NUMERIC(20,6);

-- Secuencia simple para correlativo de solicitudes (SP-AAAA-NNNNN)
CREATE SEQUENCE IF NOT EXISTS seq_solicitud_compra START 1;
