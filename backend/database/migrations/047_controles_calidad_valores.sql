-- Valores específicos por spec en cada control (pH, sólidos, viscosidad, acidez, densidad…).
-- Sustituye los campos legacy ph_valor/solidos_valor/viscosidad_valor por una tabla flexible.
-- Los campos legacy se mantienen por compatibilidad pero la UI usa esta tabla.
CREATE TABLE IF NOT EXISTS controles_calidad_valores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id   UUID NOT NULL REFERENCES controles_calidad(id) ON DELETE CASCADE,
  spec_id      INT REFERENCES spec_catalogo(id) ON DELETE SET NULL,
  nombre       VARCHAR(60) NOT NULL,
  valor        NUMERIC(20,6),
  unidad       VARCHAR(20),
  rango_str    VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS idx_ccv_control ON controles_calidad_valores(control_id);
