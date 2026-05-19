-- ============================================================
-- 005: Fix missing columns, tables, constraints, FKs & indexes
-- Resolves: B2, B3, A1, A2, A3 from pre-production audit
-- ============================================================

BEGIN;

-- ── B2: Missing columns in productos ────────────────────────
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;

-- ── B2: Missing columns in ordenes_produccion ───────────────
ALTER TABLE public.ordenes_produccion
  ADD COLUMN IF NOT EXISTS cantidad_real_producida numeric(20,6),
  ADD COLUMN IF NOT EXISTS merma_proceso numeric(20,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merma_pct numeric(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone;

-- ── B3: Create reservas_stock table ─────────────────────────
CREATE TABLE IF NOT EXISTS public.reservas_stock (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  lote_id uuid NOT NULL,
  cantidad numeric(20,6) NOT NULL CHECK (cantidad > 0),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT fk_reservas_pedido  FOREIGN KEY (pedido_id)  REFERENCES public.pedidos(id)  ON DELETE CASCADE,
  CONSTRAINT fk_reservas_producto FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reservas_lote    FOREIGN KEY (lote_id)    REFERENCES public.lotes(id)    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reservas_lote ON public.reservas_stock (lote_id);
CREATE INDEX IF NOT EXISTS idx_reservas_pedido ON public.reservas_stock (pedido_id);
CREATE INDEX IF NOT EXISTS idx_reservas_producto ON public.reservas_stock (producto_id);

-- ── A1: Missing CHECK constraints ───────────────────────────
-- precio_venta must be >= 0
DO $$ BEGIN
  ALTER TABLE public.productos ADD CONSTRAINT productos_precio_venta_check CHECK (precio_venta >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- stock_moves.cantidad must be != 0
DO $$ BEGIN
  ALTER TABLE public.stock_moves ADD CONSTRAINT stock_moves_cantidad_nonzero CHECK (cantidad <> 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── A1: Make critical nullable columns NOT NULL where safe ──
-- lineas_pedido: cantidad, precio_unitario, subtotal
ALTER TABLE public.lineas_pedido
  ALTER COLUMN cantidad SET DEFAULT 0,
  ALTER COLUMN precio_unitario SET DEFAULT 0,
  ALTER COLUMN subtotal SET DEFAULT 0;
UPDATE public.lineas_pedido SET cantidad = 0 WHERE cantidad IS NULL;
UPDATE public.lineas_pedido SET precio_unitario = 0 WHERE precio_unitario IS NULL;
UPDATE public.lineas_pedido SET subtotal = 0 WHERE subtotal IS NULL;
ALTER TABLE public.lineas_pedido
  ALTER COLUMN cantidad SET NOT NULL,
  ALTER COLUMN precio_unitario SET NOT NULL,
  ALTER COLUMN subtotal SET NOT NULL;

-- Add positive checks on lineas_pedido
DO $$ BEGIN
  ALTER TABLE public.lineas_pedido ADD CONSTRAINT lineas_pedido_cantidad_positive CHECK (cantidad > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.lineas_pedido ADD CONSTRAINT lineas_pedido_precio_positive CHECK (precio_unitario >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── A1: Unique constraints on business identifiers ──────────
-- clientes.nif unique (ignore nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_nif_unique
  ON public.clientes (nif) WHERE nif IS NOT NULL AND nif <> '';

-- proveedores.email unique (ignore nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_email_unique
  ON public.proveedores (email) WHERE email IS NOT NULL AND email <> '';

-- ── A2: Missing foreign keys ────────────────────────────────
-- ordenes_produccion.operario_id → usuarios
DO $$ BEGIN
  ALTER TABLE public.ordenes_produccion
    ADD CONSTRAINT fk_ordenes_operario FOREIGN KEY (operario_id)
    REFERENCES public.usuarios(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ordenes_produccion.locked_by → usuarios
DO $$ BEGIN
  ALTER TABLE public.ordenes_produccion
    ADD CONSTRAINT fk_ordenes_locked_by FOREIGN KEY (locked_by)
    REFERENCES public.usuarios(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Missing columns referenced in code but not in schema ────
-- productos: additional fields used by finanzas, envasado, plastic report
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS coste_medio_actual numeric(20,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peso_unitario_kg numeric(12,6),
  ADD COLUMN IF NOT EXISTS peso_plastico_kg numeric(12,6),
  ADD COLUMN IF NOT EXISTS granel_id uuid REFERENCES public.productos(id),
  ADD COLUMN IF NOT EXISTS caducidad_meses integer,
  ADD COLUMN IF NOT EXISTS sds_url text;

-- ordenes_produccion: envasado-specific fields
ALTER TABLE public.ordenes_produccion
  ADD COLUMN IF NOT EXISTS tipo_orden varchar(20) DEFAULT 'fabricacion',
  ADD COLUMN IF NOT EXISTS cola_id uuid,
  ADD COLUMN IF NOT EXISTS envase_id uuid,
  ADD COLUMN IF NOT EXISTS formato_label varchar(255),
  ADD COLUMN IF NOT EXISTS registro_limpieza text;

-- lotes: registro_limpieza, precio_compra if missing
ALTER TABLE public.lotes
  ADD COLUMN IF NOT EXISTS registro_limpieza text,
  ADD COLUMN IF NOT EXISTS precio_compra numeric(20,6) DEFAULT 0;

-- pedidos: additional fields for email/webhook orders
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cliente_email varchar(255),
  ADD COLUMN IF NOT EXISTS producto_nombre varchar(255),
  ADD COLUMN IF NOT EXISTS email_asunto text,
  ADD COLUMN IF NOT EXISTS email_cuerpo text,
  ADD COLUMN IF NOT EXISTS origen varchar(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS orden_produccion_id uuid;

-- ── A3: Missing indexes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ordenes_operario ON public.ordenes_produccion (operario_id) WHERE operario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente_id ON public.ordenes_produccion (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON public.productos (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sm_usuario ON public.stock_moves (usuario_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservas_lote_cantidad ON public.reservas_stock (lote_id, cantidad);

COMMIT;
