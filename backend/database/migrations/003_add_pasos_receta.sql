-- Add pasos (steps) column to recetas table
ALTER TABLE public.recetas ADD COLUMN IF NOT EXISTS pasos jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.recetas.pasos IS 'Pasos de fabricación: [{fase, titulo, descripcion, temperatura, duracion_min, ingredientes_ids, color}]';
