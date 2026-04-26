-- 005: Add tipo_orden, cola_id, envase_id to ordenes_produccion for envasado planning
-- Also add formato_label for display

ALTER TABLE ordenes_produccion ADD COLUMN IF NOT EXISTS tipo_orden VARCHAR(20) DEFAULT 'fabricacion';
ALTER TABLE ordenes_produccion ADD COLUMN IF NOT EXISTS cola_id UUID REFERENCES productos(id);
ALTER TABLE ordenes_produccion ADD COLUMN IF NOT EXISTS envase_id UUID REFERENCES productos(id);
ALTER TABLE ordenes_produccion ADD COLUMN IF NOT EXISTS formato_label VARCHAR(50);

-- Update existing envasado orders (identified by notas containing 'Envasado rápido')
UPDATE ordenes_produccion SET tipo_orden = 'envasado' WHERE notas ILIKE '%envasado rápido%' AND tipo_orden = 'fabricacion';

-- Index for filtering by tipo_orden
CREATE INDEX IF NOT EXISTS idx_ordenes_tipo_orden ON ordenes_produccion (tipo_orden);
