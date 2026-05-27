-- Catálogo editable de sub-categorías para materias primas (resina, agua,
-- pigmento, disolvente, conservante…). Antes vivían hardcoded en el frontend;
-- ahora el admin las edita desde Configuración.
CREATE TABLE IF NOT EXISTS public.subcategorias_mp (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(50) NOT NULL UNIQUE,
  orden      INTEGER NOT NULL DEFAULT 0,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subcat_mp_orden ON public.subcategorias_mp (orden, nombre) WHERE activo = TRUE;

-- Seed valores iniciales (idempotente)
INSERT INTO public.subcategorias_mp (nombre, orden) VALUES
  ('Resina', 1),
  ('Agua', 2),
  ('Pigmento', 3),
  ('Disolvente', 4),
  ('Conservante', 5),
  ('Otros', 99)
ON CONFLICT (nombre) DO NOTHING;
