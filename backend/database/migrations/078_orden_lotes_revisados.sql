-- Revisión pre-fabricación: el admin firma los lotes elegidos una vez y
-- desde ese momento cualquier operario que abra la OF entra directo a producción
-- sin ver el modal de revisión. Persistimos también el override de lotes
-- (qué lote concreto se asigna a cada ingrediente) para que el operario vea
-- los mismos lotes que firmó el admin.

ALTER TABLE ordenes_produccion
  ADD COLUMN IF NOT EXISTS lotes_revisados_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lotes_revisados_por_id  UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS lotes_override          JSONB;
