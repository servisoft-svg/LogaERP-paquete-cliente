-- ============================================================
-- 011: Marcar pedidos cuyo albarán ya fue enviado por email
-- para evitar reenvíos accidentales.
-- ============================================================

BEGIN;

ALTER TABLE pedidos
    ADD COLUMN IF NOT EXISTS albaran_enviado BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS albaran_enviado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS albaran_enviado_a VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_pedidos_albaran_pendiente
    ON pedidos (estado, albaran_enviado)
    WHERE estado = 'completado' AND albaran_enviado = FALSE;

COMMIT;
