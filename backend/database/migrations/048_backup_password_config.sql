-- Permite configurar BACKUP_PASSWORD desde la UI (no solo desde env).
-- Si NULL, sigue usándose la variable de entorno como antes.
ALTER TABLE configuracion_global
  ADD COLUMN IF NOT EXISTS backup_password TEXT;
