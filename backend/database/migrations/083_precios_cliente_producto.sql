-- Precio "habitual" de cada producto por cliente. Se actualiza cada vez que se
-- crea/edita un pedido con una línea para esa combinación. El frontend lo lee
-- al elegir el producto y lo pre-rellena (el usuario puede sobrescribirlo).
CREATE TABLE IF NOT EXISTS public.precios_cliente_producto (
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio_unitario NUMERIC(20,6) NOT NULL CHECK (precio_unitario >= 0),
  num_usos        INTEGER NOT NULL DEFAULT 1,
  ultimo_uso_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cliente_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_pcp_cliente
  ON public.precios_cliente_producto (cliente_id, ultimo_uso_at DESC);

-- Backfill: hidratar con los pedidos históricos (último precio usado por cliente+producto).
INSERT INTO public.precios_cliente_producto (cliente_id, producto_id, precio_unitario, num_usos, ultimo_uso_at)
SELECT
  pd.cliente_id,
  lp.producto_id,
  (lp.precio_unitario)::NUMERIC(20,6) AS precio_unitario,
  COUNT(*)::INT AS num_usos,
  MAX(pd.created_at) AS ultimo_uso_at
FROM pedidos pd
JOIN lineas_pedido lp ON lp.pedido_id = pd.id
WHERE pd.cliente_id IS NOT NULL
  AND lp.producto_id IS NOT NULL
  AND lp.precio_unitario IS NOT NULL
  AND (lp.precio_unitario)::NUMERIC > 0
GROUP BY pd.cliente_id, lp.producto_id, lp.precio_unitario
ON CONFLICT (cliente_id, producto_id) DO NOTHING;
