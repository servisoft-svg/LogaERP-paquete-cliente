-- Extender tabla recordatorios para alertas con hora + destinatarios + flags.
-- La columna `fecha` (date) se mantiene por compatibilidad con el calendario actual.
-- `programado_para` (con hora) es el momento exacto en que la alerta debe sonar.
ALTER TABLE recordatorios
  ADD COLUMN IF NOT EXISTS programado_para     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS destinatarios       UUID[],
  ADD COLUMN IF NOT EXISTS destinatario_roles  TEXT[],
  ADD COLUMN IF NOT EXISTS con_sonido          BOOLEAN DEFAULT TRUE NOT NULL,
  ADD COLUMN IF NOT EXISTS con_notificacion    BOOLEAN DEFAULT TRUE NOT NULL,
  ADD COLUMN IF NOT EXISTS entregados_por      UUID[] DEFAULT '{}'::UUID[],
  ADD COLUMN IF NOT EXISTS origen              VARCHAR(30) DEFAULT 'manual';

-- Backfill: recordatorios pre-existentes se asignan al creador como destinatario único
UPDATE recordatorios
SET destinatarios = ARRAY[usuario_id]
WHERE destinatarios IS NULL AND usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recordatorios_programado_para
  ON recordatorios(programado_para)
  WHERE programado_para IS NOT NULL;
