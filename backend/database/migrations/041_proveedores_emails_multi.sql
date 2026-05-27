-- Emails adicionales por proveedor + memoria del último envío
-- email_principal sigue en columna `email` (compat).
-- emails_adicionales: lista opcional con copias/alternativos.
-- ultimos_destinatarios: a quién se mandó la última solicitud (para pre-marcar UI).
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS emails_adicionales TEXT[],
  ADD COLUMN IF NOT EXISTS ultimos_destinatarios TEXT[];
