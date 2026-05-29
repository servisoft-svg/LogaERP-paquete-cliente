-- URL del webhook de Alilo para notificarle cambios de stock de productos compartidos.
-- Cuando Loga modifica el stock de un producto con compartido_alilo=TRUE,
-- envía POST firmado con HMAC a este URL para mantener el cache de Alilo al día.
ALTER TABLE integracion_alilo_config
  ADD COLUMN IF NOT EXISTS alilo_webhook_url VARCHAR(300);
