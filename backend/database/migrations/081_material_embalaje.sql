-- Catálogo de tipos de material de embalaje (Plástico, Cartón, Madera, …).
-- Permite saber cuánto material se consume al fabricar/envasar.
CREATE TABLE IF NOT EXISTS public.tipos_material_embalaje (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(50) NOT NULL UNIQUE,
  orden      INTEGER NOT NULL DEFAULT 0,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tipos_material_orden
  ON public.tipos_material_embalaje (orden, nombre) WHERE activo = TRUE;

INSERT INTO public.tipos_material_embalaje (nombre, orden) VALUES
  ('Plástico', 1),
  ('Cartón',   2),
  ('Madera',   3),
  ('Vidrio',   4),
  ('Metal',    5),
  ('Otros',    99)
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS material_embalaje VARCHAR(50),
  ADD COLUMN IF NOT EXISTS peso_material_vacio_kg NUMERIC(12,6);

CREATE INDEX IF NOT EXISTS idx_productos_material_embalaje
  ON productos (material_embalaje) WHERE material_embalaje IS NOT NULL;
