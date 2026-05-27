-- Dosificaciones parciales por orden de fabricación.
-- Permite al operario registrar cada echada de materia prima por separado
-- (ej: 140 L de agua → 40 L ahora, 30 L luego, 70 L pendiente). Cada inserción
-- aquí se acompaña de un stock_move tipo 'produccion_consumo' descontando del
-- lote correspondiente — es decir, el stock baja en tiempo real.
CREATE TABLE IF NOT EXISTS public.dosificaciones_orden (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id     UUID NOT NULL REFERENCES public.ordenes_produccion(id) ON DELETE RESTRICT,
  producto_id  UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  lote_id      UUID REFERENCES public.lotes(id) ON DELETE RESTRICT,
  cantidad     NUMERIC(20,6) NOT NULL CHECK (cantidad > 0),
  unidad_medida VARCHAR(20) NOT NULL DEFAULT 'kg',
  operario_id  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dosif_orden    ON public.dosificaciones_orden (orden_id);
CREATE INDEX IF NOT EXISTS idx_dosif_orden_mp ON public.dosificaciones_orden (orden_id, producto_id);
