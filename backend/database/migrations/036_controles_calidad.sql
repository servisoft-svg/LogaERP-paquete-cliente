-- Control de calidad: 3 tipos de registros en una sola tabla
-- (analitico MP / limpieza de depositos / mantenimiento de equipos)

CREATE TABLE IF NOT EXISTS controles_calidad (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('analitico','limpieza','mantenimiento')),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Campos analitico de materias primas
  lote_codigo         TEXT,
  metodo              TEXT,
  producto_id         UUID REFERENCES productos(id) ON DELETE SET NULL,
  producto_nombre     TEXT,
  ph_spec             TEXT,
  ph_valor            NUMERIC(6,2),
  solidos_spec        TEXT,
  solidos_valor       NUMERIC(6,2),
  viscosidad_spec     TEXT,
  viscosidad_valor    NUMERIC(10,2),

  -- Campos limpieza / mantenimiento
  deposito_equipo     TEXT,
  accion              TEXT,

  -- Comunes
  resultado           VARCHAR(20) CHECK (resultado IN ('apto','no_apto','correcto','pendiente','revisar')),
  observaciones       TEXT,

  -- Firma del operario que lo hace
  firmado_por_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  firmado_por_nombre  TEXT,
  firmado_at          TIMESTAMPTZ,

  -- Metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_tipo_fecha   ON controles_calidad(tipo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cc_producto     ON controles_calidad(producto_id) WHERE producto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cc_firmado_por  ON controles_calidad(firmado_por_id) WHERE firmado_por_id IS NOT NULL;
