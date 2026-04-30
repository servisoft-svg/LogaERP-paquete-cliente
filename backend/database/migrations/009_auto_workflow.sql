-- ============================================================
-- 009: Toggles para automatizaciones de flujo de trabajo
-- (no son reglas por-producto sino comportamientos sistema)
-- ============================================================

BEGIN;

ALTER TABLE configuracion_automatizaciones
    ADD COLUMN IF NOT EXISTS auto_completar_pedidos_con_stock BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_email_albaran               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS backup_auto_activo               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS backup_auto_hora                 TIME    NOT NULL DEFAULT '02:00:00',
    ADD COLUMN IF NOT EXISTS backup_auto_ultima               TIMESTAMPTZ;

COMMENT ON COLUMN configuracion_automatizaciones.auto_completar_pedidos_con_stock IS
    'Al confirmar un pedido con stock suficiente del producto envasado, descuenta lotes FEFO y marca completado.';
COMMENT ON COLUMN configuracion_automatizaciones.auto_email_albaran IS
    'Al completar un pedido, envía PDF albarán al email del cliente.';
COMMENT ON COLUMN configuracion_automatizaciones.backup_auto_activo IS
    'Cron interno realiza backup completo cifrado cada noche a backup_auto_hora.';

COMMIT;
