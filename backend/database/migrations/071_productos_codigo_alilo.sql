-- Código del mismo producto en el sistema Alilo. Permite mapear:
--   productos.codigo (Loga)        ↔    productos.codigo_alilo (lo que Alilo manda)
--
-- Cuando Alilo llama a POST /api/integracion/alilo/consumir con un codigo,
-- el endpoint busca primero por codigo_alilo; si no encuentra, fallback a codigo.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS codigo_alilo VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_alilo
  ON productos (codigo_alilo) WHERE codigo_alilo IS NOT NULL;
