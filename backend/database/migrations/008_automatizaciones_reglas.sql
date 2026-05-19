-- ============================================================
-- 008: Reglas de automatización configurables por usuario.
--
-- Cada regla = trigger + acción. El usuario las crea desde la UI
-- mediante un wizard. Reemplaza los toggles globales genéricos
-- (la tabla configuracion_automatizaciones se mantiene solo como
-- defaults de safety_stock/anticipación/retry).
-- ============================================================

BEGIN;

-- ENUMs envueltos en DO/EXCEPTION → idempotentes para re-runs.
DO $$ BEGIN
  CREATE TYPE trigger_automatizacion AS ENUM (
      'stock_bajo_minimo',     -- producto baja de stock_minimo
      'stock_cero',            -- producto llega a 0
      'lote_qc_ok',            -- lote nuevo con QC dentro de rango
      'lote_qc_fuera_rango',   -- lote nuevo con QC fuera de rango (cuarentena)
      'pedido_confirmado',     -- pedido cambia a confirmado
      'manual'                 -- solo se dispara con botón "Ejecutar"
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE accion_automatizacion AS ENUM (
      'email_proveedor',
      'crear_orden_compra',
      'crear_orden_fabricacion',
      'crear_orden_envasado',
      'aprobar_lote',
      'rechazar_lote',
      'notificar'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS automatizaciones_reglas (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(120) NOT NULL,
    descripcion     TEXT,
    activa          BOOLEAN      NOT NULL DEFAULT TRUE,
    icono           VARCHAR(40)  NOT NULL DEFAULT 'zap',
    color           VARCHAR(20)  NOT NULL DEFAULT 'red',
    -- Trigger
    trigger_tipo    trigger_automatizacion NOT NULL,
    trigger_config  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Acción
    accion_tipo     accion_automatizacion  NOT NULL,
    accion_config   JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Stats
    ultima_ejecucion        TIMESTAMPTZ,
    ultimo_resultado        VARCHAR(40),
    ejecuciones_count       INTEGER NOT NULL DEFAULT 0,
    ejecuciones_exito       INTEGER NOT NULL DEFAULT 0,
    ejecuciones_fallo       INTEGER NOT NULL DEFAULT 0,
    -- Audit
    creado_por      UUID         REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reglas_activas ON automatizaciones_reglas (activa, trigger_tipo) WHERE activa = TRUE;
CREATE INDEX idx_reglas_trigger ON automatizaciones_reglas (trigger_tipo);

-- Tabla puente: una regla puede aplicar a varios productos específicos.
-- NULL = aplica a todos los productos del tipo correspondiente al trigger.
CREATE TABLE IF NOT EXISTS regla_productos (
    regla_id     UUID NOT NULL REFERENCES automatizaciones_reglas(id) ON DELETE CASCADE,
    producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    PRIMARY KEY (regla_id, producto_id)
);

CREATE INDEX idx_regla_prod_producto ON regla_productos (producto_id);

-- Vincular log con regla (opcional, por trazabilidad)
ALTER TABLE automatizaciones_log
    ADD COLUMN IF NOT EXISTS regla_id UUID REFERENCES automatizaciones_reglas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_autlog_regla ON automatizaciones_log (regla_id, created_at DESC) WHERE regla_id IS NOT NULL;

COMMIT;
