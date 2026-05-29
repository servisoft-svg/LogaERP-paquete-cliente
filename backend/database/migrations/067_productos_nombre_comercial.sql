-- Nombre comercial opcional para productos. Usado en etiquetas/albaranes
-- cuando el nombre técnico/interno es distinto del nombre con que se vende.
-- Si está NULL → cae al nombre normal.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR(200);
