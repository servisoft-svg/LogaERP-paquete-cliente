-- Archivado de clientes inactivos (≥2 años sin pedido).
-- NO se eliminan nunca: solo se mueven a la lista de archivados, desde donde
-- pueden recuperarse manualmente o automáticamente (al crear un pedido nuevo
-- para ellos).

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS archivado_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archivado_motivo  TEXT,
  ADD COLUMN IF NOT EXISTS archivado_por_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Índice parcial: la búsqueda en pedidos por defecto solo mira activos
-- (archivado_at IS NULL). Con 10k clientes esto sigue siendo O(log n).
CREATE INDEX IF NOT EXISTS idx_clientes_no_archivados
  ON clientes(nombre) WHERE archivado_at IS NULL AND activo = TRUE;

-- Índice secundario para la pestaña "Archivados", ordenada por fecha de archivo.
CREATE INDEX IF NOT EXISTS idx_clientes_archivados_orden
  ON clientes(archivado_at DESC) WHERE archivado_at IS NOT NULL;
