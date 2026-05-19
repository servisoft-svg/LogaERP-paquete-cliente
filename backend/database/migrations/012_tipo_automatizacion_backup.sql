-- ============================================================
-- 012: Añadir tipos específicos al enum tipo_automatizacion
-- para que el historial muestre eventos distinguibles.
-- ============================================================

BEGIN;

-- Añadir nuevos valores al enum (no se pueden duplicar)
ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'backup_creado';
ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'pedido_auto_completado';
ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'albaran_email_enviado';

COMMIT;
