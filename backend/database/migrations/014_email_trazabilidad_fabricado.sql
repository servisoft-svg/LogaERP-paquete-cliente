-- ============================================================
-- 014: Email automático de trazabilidad cuando pedido pasa a fabricado
-- Mensaje al cliente: "Producto fabricado, en breve será enviado"
-- Adjunta PDF trazabilidad SIN datos económicos
-- ============================================================

BEGIN;

ALTER TABLE configuracion_automatizaciones
    ADD COLUMN IF NOT EXISTS auto_email_trazabilidad_fabricado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pedidos
    ADD COLUMN IF NOT EXISTS trazabilidad_enviada BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS trazabilidad_enviada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trazabilidad_enviada_a VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_pedidos_trazabilidad_pendiente
    ON pedidos (estado, trazabilidad_enviada)
    WHERE estado IN ('fabricado', 'envasado') AND trazabilidad_enviada = FALSE;

ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'trazabilidad_email_enviada';

COMMIT;
