-- Email de archivo: cuando se genera o envía cualquier albarán, una copia
-- adicional se envía a esta dirección para mantener archivo interno (backoffice,
-- contabilidad, etc.). NULL = desactivado.
ALTER TABLE configuracion_global
  ADD COLUMN IF NOT EXISTS email_copia_albaranes VARCHAR(255);

-- Marca por pedido: una vez archivado, no se vuelve a enviar al descargar el
-- PDF (evita spam si el usuario refresca el documento varias veces). El envío
-- por /enviar-albaran siempre añade BCC, independientemente de este flag.
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS albaran_copia_archivada_at TIMESTAMPTZ;
