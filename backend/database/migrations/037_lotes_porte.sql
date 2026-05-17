-- Coste de porte/transporte al recibir un lote.
-- Se suma al precio total para calcular el coste real del lote.
ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS porte NUMERIC(20,6) DEFAULT 0;
