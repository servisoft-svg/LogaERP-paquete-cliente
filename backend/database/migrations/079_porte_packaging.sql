-- Cálculo de porte: necesitamos código postal del cliente (para provincia)
-- y pesos de packaging de cada receta de envasado (envase vacío, caja vacía,
-- pale vacío + cómo se agrupan: unidades por caja, cajas por pale). El peso
-- del contenido (líquido) ya vive en recetas_envasado.liquido_cantidad.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(5);

ALTER TABLE recetas_envasado
  ADD COLUMN IF NOT EXISTS peso_envase_vacio_kg NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unidades_por_caja    INTEGER       NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS peso_caja_vacia_kg   NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cajas_por_pale       INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peso_pale_vacio_kg   NUMERIC(10,3) NOT NULL DEFAULT 0;
