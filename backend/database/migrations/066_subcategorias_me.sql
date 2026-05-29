-- Catálogo editable de sub-categorías para material de embalaje (Bote, Caja,
-- Etiqueta, Tapón, Otros). Permite clasificar los embalajes según su rol y
-- mostrar en la UI solo el campo relevante (kg de cola dentro / botes por caja).
CREATE TABLE IF NOT EXISTS public.subcategorias_me (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(50) NOT NULL UNIQUE,
  orden      INTEGER NOT NULL DEFAULT 0,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subcat_me_orden
  ON public.subcategorias_me (orden, nombre) WHERE activo = TRUE;

-- Seed inicial (idempotente)
INSERT INTO public.subcategorias_me (nombre, orden) VALUES
  ('Bote', 1),
  ('Caja', 2),
  ('Etiqueta', 3),
  ('Tapón', 4),
  ('Otros', 99)
ON CONFLICT (nombre) DO NOTHING;

-- Columna en productos (solo aplica cuando tipo = 'material_embalaje')
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS subcategoria_me VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_productos_subcategoria_me
  ON productos (subcategoria_me) WHERE subcategoria_me IS NOT NULL;
