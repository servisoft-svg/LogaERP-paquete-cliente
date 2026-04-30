-- ============================================================
-- 007: Automatizaciones — disparadores automáticos al bajar stock
--
-- Tablas:
--   automatizaciones_log         — historial de cada ejecución
--   configuracion_automatizaciones — toggles globales (single row)
--
-- Columnas extra en productos para overrides por-producto.
--
-- Estado de pedidos_proveedor amplía con 'borrador' (creado por automatización
-- antes de enviar email) y 'enviado' (email ya enviado, pendiente recepción).
-- ============================================================

BEGIN;

-- ─── 1. configuracion_automatizaciones (single row id=1) ────────
CREATE TABLE IF NOT EXISTS configuracion_automatizaciones (
    id                          SMALLINT PRIMARY KEY DEFAULT 1,
    -- Toggles globales
    auto_compra_activa          BOOLEAN  NOT NULL DEFAULT TRUE,
    auto_email_proveedor        BOOLEAN  NOT NULL DEFAULT TRUE,
    auto_fabricacion_activa     BOOLEAN  NOT NULL DEFAULT TRUE,
    auto_envasado_activa        BOOLEAN  NOT NULL DEFAULT TRUE,
    auto_aprobacion_qc          BOOLEAN  NOT NULL DEFAULT FALSE,
    -- Defaults para producto sin override
    safety_stock_pct_default    NUMERIC(5,2) NOT NULL DEFAULT 20.00
                                    CHECK (safety_stock_pct_default >= 0 AND safety_stock_pct_default <= 200),
    dias_anticipacion_default   SMALLINT NOT NULL DEFAULT 2
                                    CHECK (dias_anticipacion_default >= 0 AND dias_anticipacion_default <= 30),
    ventana_antiduplicado_dias  SMALLINT NOT NULL DEFAULT 5
                                    CHECK (ventana_antiduplicado_dias >= 1 AND ventana_antiduplicado_dias <= 30),
    -- Email retry
    email_max_reintentos        SMALLINT NOT NULL DEFAULT 3
                                    CHECK (email_max_reintentos >= 0 AND email_max_reintentos <= 10),
    email_intervalo_reintento_min SMALLINT NOT NULL DEFAULT 10
                                    CHECK (email_intervalo_reintento_min >= 1),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT solo_una_fila_auto CHECK (id = 1)
);

INSERT INTO configuracion_automatizaciones (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Columnas override por-producto ─────────────────────────
ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS auto_email_proveedor BOOLEAN,
    ADD COLUMN IF NOT EXISTS auto_compra_activa   BOOLEAN,
    ADD COLUMN IF NOT EXISTS auto_fabricacion_activa BOOLEAN,
    ADD COLUMN IF NOT EXISTS auto_envasado_activa BOOLEAN,
    ADD COLUMN IF NOT EXISTS safety_stock_pct     NUMERIC(5,2)
        CHECK (safety_stock_pct IS NULL OR (safety_stock_pct >= 0 AND safety_stock_pct <= 200)),
    ADD COLUMN IF NOT EXISTS dias_anticipacion    SMALLINT
        CHECK (dias_anticipacion IS NULL OR (dias_anticipacion >= 0 AND dias_anticipacion <= 30)),
    ADD COLUMN IF NOT EXISTS cantidad_promedio_mensual NUMERIC(20,6);

COMMENT ON COLUMN productos.auto_email_proveedor IS 'Override por producto. NULL = usa default global.';
COMMENT ON COLUMN productos.safety_stock_pct IS 'Override % safety stock. NULL = usa default global.';
COMMENT ON COLUMN productos.dias_anticipacion IS 'Días entre detección y fecha planificada. NULL = global.';
COMMENT ON COLUMN productos.cantidad_promedio_mensual IS 'Manual override del consumo promedio. NULL = se calcula desde stock_moves últimos 90d.';

-- ─── 3. automatizaciones_log ───────────────────────────────────
CREATE TYPE tipo_automatizacion AS ENUM (
    'orden_compra_creada',
    'email_proveedor_enviado',
    'orden_fabricacion_creada',
    'orden_envasado_creada',
    'lote_aprobado_qc',
    'duplicado_evitado',
    'error'
);

CREATE TYPE resultado_automatizacion AS ENUM (
    'exito',
    'pendiente_reintento',
    'fallo_definitivo',
    'omitido'
);

CREATE TABLE IF NOT EXISTS automatizaciones_log (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            tipo_automatizacion NOT NULL,
    resultado       resultado_automatizacion NOT NULL DEFAULT 'exito',
    -- Contexto
    producto_id     UUID         REFERENCES productos(id) ON DELETE SET NULL,
    proveedor_id    UUID         REFERENCES proveedores(id) ON DELETE SET NULL,
    orden_compra_id UUID         REFERENCES pedidos_proveedor(id) ON DELETE SET NULL,
    orden_id        UUID         REFERENCES ordenes_produccion(id) ON DELETE SET NULL,
    lote_id         UUID         REFERENCES lotes(id) ON DELETE SET NULL,
    -- Detalles
    detalle         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    error_msg       TEXT,
    -- Retry
    retry_count     SMALLINT     NOT NULL DEFAULT 0
                        CHECK (retry_count >= 0),
    next_retry_at   TIMESTAMPTZ,
    -- Audit
    leida           BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autlog_created    ON automatizaciones_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autlog_producto   ON automatizaciones_log (producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autlog_pendiente  ON automatizaciones_log (resultado, next_retry_at)
    WHERE resultado = 'pendiente_reintento';
CREATE INDEX IF NOT EXISTS idx_autlog_no_leidas  ON automatizaciones_log (leida, created_at DESC)
    WHERE leida = FALSE;

-- ─── 4. Ampliar estados de pedidos_proveedor ───────────────────
-- Permite 'borrador' (creado por automatización, sin email enviado)
-- y 'enviado' (email enviado, pendiente recepción).
ALTER TABLE pedidos_proveedor
    DROP CONSTRAINT IF EXISTS pedidos_proveedor_estado_check;

ALTER TABLE pedidos_proveedor
    ADD CONSTRAINT pedidos_proveedor_estado_check
        CHECK (estado IN ('borrador', 'enviado', 'pendiente', 'completado', 'cancelado'));

ALTER TABLE pedidos_proveedor
    ADD COLUMN IF NOT EXISTS origen VARCHAR(20) DEFAULT 'manual'
        CHECK (origen IN ('manual', 'automatizacion'));

CREATE INDEX IF NOT EXISTS idx_pp_borrador
    ON pedidos_proveedor (producto_id, fecha_solicitud DESC)
    WHERE estado IN ('borrador', 'enviado');

COMMIT;
