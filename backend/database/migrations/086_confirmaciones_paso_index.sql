-- 086_confirmaciones_paso_index.sql
-- Scopea las confirmaciones de ingredientes por paso. Un mismo ingrediente
-- puede aparecer en varios pasos (vía pasos.ingredientes_ids) — y el operario
-- quiere que cada paso tenga su propio checklist independiente:
-- "cuando paso de paso, nada confirmado en el siguiente". Esto solo se logra
-- haciendo paso_index parte de la PK.

ALTER TABLE public.confirmaciones_ingrediente
  ADD COLUMN IF NOT EXISTS paso_index INT NOT NULL DEFAULT -1;

ALTER TABLE public.confirmaciones_ingrediente
  DROP CONSTRAINT IF EXISTS confirmaciones_ingrediente_pkey;

ALTER TABLE public.confirmaciones_ingrediente
  ADD PRIMARY KEY (orden_id, ingrediente_receta_id, paso_index);
