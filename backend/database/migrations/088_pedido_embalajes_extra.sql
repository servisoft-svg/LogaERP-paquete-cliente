-- ============================================================
-- 088: Material de embalaje EXTRA por pedido.
--
-- Caso: un pedido puede necesitar materiales que NO figuran en la
-- receta de envasado y que NO se facturan al cliente (p. ej. 2 palets
-- para transporte, film, sacos extra…). Deben:
--   - NO aparecer en albarán ni factura (no son lineas_pedido)
--   - SÍ contabilizarse en el informe-materiales (Hacienda / Ley 7/2022)
--
-- Tabla sidecar, solo lectura desde finanzas/informe. Edición admin.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pedido_embalajes_extra (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad    NUMERIC(20,6) NOT NULL CHECK (cantidad > 0),
  notas       TEXT,
  creado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ped_emb_extra_pedido
  ON public.pedido_embalajes_extra (pedido_id);
CREATE INDEX IF NOT EXISTS idx_ped_emb_extra_producto
  ON public.pedido_embalajes_extra (producto_id);

COMMIT;
