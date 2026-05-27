-- Soporte "pendiente → confirmado" para mantenimiento y limpieza.
-- estado='pendiente' significa "programado para hacer pero no realizado todavía".
-- Al confirmar, se rellena confirmado_por_* y estado pasa a 'completado'.
ALTER TABLE controles_calidad
  ADD COLUMN IF NOT EXISTS estado                VARCHAR(20) DEFAULT 'completado' NOT NULL,
  ADD COLUMN IF NOT EXISTS confirmado_por_id     UUID,
  ADD COLUMN IF NOT EXISTS confirmado_por_nombre VARCHAR(150),
  ADD COLUMN IF NOT EXISTS confirmado_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_controles_calidad_pendientes
  ON controles_calidad(tipo, estado)
  WHERE estado = 'pendiente';
