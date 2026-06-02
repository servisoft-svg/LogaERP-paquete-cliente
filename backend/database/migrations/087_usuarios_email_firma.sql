-- 087_usuarios_email_firma.sql
-- Email de firma / contacto del usuario, separado del email de login.
-- El email_firma se imprime en albaranes, PDFs de trazabilidad, firmas y
-- registros de auditoría como contacto del operario/admin. El email de login
-- (usuarios.email) sigue siendo el que se usa para autenticarse.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS email_firma TEXT;
