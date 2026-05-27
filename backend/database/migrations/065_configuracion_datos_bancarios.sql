-- Datos bancarios editables desde Configuración (aparecen en el PDF de
-- pedidos a proveedor). Texto libre — el operario pone lo que quiera (banco,
-- oficina, IBAN, "Enviar por…", etc.).
ALTER TABLE public.configuracion_global
  ADD COLUMN IF NOT EXISTS datos_bancarios TEXT;
