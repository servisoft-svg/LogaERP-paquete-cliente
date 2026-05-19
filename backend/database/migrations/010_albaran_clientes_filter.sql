-- ============================================================
-- 010: Filtrar auto-email-albaran por lista de clientes específica
-- NULL = aplica a todos los clientes (default)
-- Array vacío = no aplica a nadie
-- Array con UUIDs = aplica solo a esos clientes
-- ============================================================

BEGIN;

ALTER TABLE configuracion_automatizaciones
    ADD COLUMN IF NOT EXISTS auto_email_albaran_clientes UUID[];

COMMENT ON COLUMN configuracion_automatizaciones.auto_email_albaran_clientes IS
    'Filtro opcional: lista de cliente_ids a los que aplicar auto-email-albaran. NULL = todos.';

COMMIT;
