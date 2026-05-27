-- Email pedido al proveedor programado para una fecha/hora futura.
CREATE TABLE IF NOT EXISTS pedidos_programados (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  destinatarios TEXT[] NOT NULL,
  cantidad      NUMERIC(20,6) NOT NULL,
  notas         TEXT,
  cuerpo_personalizado TEXT,
  programado_para TIMESTAMPTZ NOT NULL,
  enviado       BOOLEAN DEFAULT FALSE NOT NULL,
  enviado_at    TIMESTAMPTZ,
  intento_at    TIMESTAMPTZ,
  error_msg     TEXT,
  creado_por    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_programados_pendientes
  ON pedidos_programados(programado_para)
  WHERE enviado = FALSE;
