-- ============================================================
-- 013: Toggles auto-fabricar / auto-envasar desde pedido
-- Cuando un pedido necesita fabricación (no hay stock granel) o
-- envasado (no hay stock envasado) y existe receta activa,
-- el sistema crea automáticamente la orden con todos los datos.
-- ============================================================

BEGIN;

ALTER TABLE configuracion_automatizaciones
    ADD COLUMN IF NOT EXISTS auto_fabricar_desde_pedido BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_envasar_desde_pedido  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'pedido_auto_fabricar';
ALTER TYPE tipo_automatizacion ADD VALUE IF NOT EXISTS 'pedido_auto_envasar';

COMMIT;
