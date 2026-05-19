-- Credenciales OAuth de Google Drive guardadas en BD para subir backups.
-- El refresh_token es lo realmente sensible — se guarda tal cual (no hay master key
-- para cifrarlo aún; mismo nivel de protección que BACKUP_PASSWORD).
ALTER TABLE configuracion_global
  ADD COLUMN IF NOT EXISTS gdrive_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_folder_id     TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_email         TEXT;
