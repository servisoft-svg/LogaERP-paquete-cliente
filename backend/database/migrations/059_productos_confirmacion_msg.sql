-- Mensaje de confirmación opcional asociado a una materia prima. Si está
-- definido, durante la fabricación se pide al operario confirmar este mensaje
-- antes de finalizar la orden (ej: "¿has echado todo del tanque 2?",
-- "¿has verificado la viscosidad?"). NULL = no se pide nada.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS confirmacion_msg TEXT;
