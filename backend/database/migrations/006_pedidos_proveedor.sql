-- ============================================================
-- 006: Tabla pedidos_proveedor — registra solicitudes de compra
-- a proveedor (email enviado) y vincula con entrada de stock
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pedidos_proveedor (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  producto_id uuid NOT NULL REFERENCES public.productos(id),
  proveedor_id uuid REFERENCES public.proveedores(id),
  -- Solicitud
  cantidad_solicitada numeric(20,6) NOT NULL,
  destinatario_email varchar(255) NOT NULL,
  notas text,
  fecha_solicitud timestamp with time zone DEFAULT now() NOT NULL,
  usuario_solicitud_id uuid REFERENCES public.usuarios(id),
  -- Recepción (se rellena cuando llega el material y se crea el lote)
  lote_id uuid REFERENCES public.lotes(id),
  cantidad_recibida numeric(20,6),
  fecha_recepcion timestamp with time zone,
  -- Estado
  estado varchar(20) DEFAULT 'pendiente' NOT NULL
    CHECK (estado IN ('pendiente', 'recibido', 'parcial', 'cancelado')),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pp_producto ON public.pedidos_proveedor (producto_id);
CREATE INDEX IF NOT EXISTS idx_pp_estado ON public.pedidos_proveedor (estado) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_pp_fecha ON public.pedidos_proveedor (fecha_solicitud DESC);

COMMIT;
