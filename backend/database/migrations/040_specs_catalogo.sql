-- ============================================================================
-- Catálogo flexible de especificaciones físico-químicas
-- ----------------------------------------------------------------------------
-- Reemplaza las columnas hardcoded solidos_min/max, ph_min/max, viscosidad_min/max
-- en productos y los valores hardcoded solidos/ph/viscosidad en lotes por un
-- sistema flexible donde cada producto define qué specs requiere y cada lote
-- registra los valores medidos para esas specs.
--
-- Las columnas viejas se MANTIENEN por compatibilidad. La UI nueva usa estas
-- tablas; si están vacías para un producto, cae a las columnas legacy.
-- ============================================================================

-- Catálogo global de specs disponibles
CREATE TABLE IF NOT EXISTS spec_catalogo (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  unidad      VARCHAR(20),
  decimales   SMALLINT DEFAULT 2 CHECK (decimales >= 0 AND decimales <= 6),
  rango_min   NUMERIC,
  rango_max   NUMERIC,
  activo      BOOLEAN DEFAULT true NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Specs asignadas a cada producto con rangos requeridos
CREATE TABLE IF NOT EXISTS producto_specs (
  producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  spec_id     INT  NOT NULL REFERENCES spec_catalogo(id) ON DELETE RESTRICT,
  min_valor   NUMERIC,
  max_valor   NUMERIC,
  orden       SMALLINT DEFAULT 0,
  PRIMARY KEY (producto_id, spec_id)
);
CREATE INDEX IF NOT EXISTS idx_producto_specs_producto ON producto_specs(producto_id);

-- Valores medidos en cada lote
CREATE TABLE IF NOT EXISTS lote_specs (
  lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  spec_id INT  NOT NULL REFERENCES spec_catalogo(id) ON DELETE RESTRICT,
  valor   NUMERIC,
  PRIMARY KEY (lote_id, spec_id)
);
CREATE INDEX IF NOT EXISTS idx_lote_specs_lote ON lote_specs(lote_id);

-- Seed: specs comunes en químico/cosmético
INSERT INTO spec_catalogo (nombre, unidad, decimales, rango_min, rango_max) VALUES
  ('pH',                NULL,   2, 0,    14),
  ('Sólidos',           '%',    2, 0,    100),
  ('Viscosidad',        'cP',   2, 0,    999999),
  ('Densidad',          'g/mL', 4, 0,    20),
  ('Acidez',            'mg KOH/g', 2, 0, 999),
  ('Punto de ebullición', '°C', 1, -50,  500),
  ('Punto de fusión',   '°C',   1, -50,  500),
  ('Punto de inflamación', '°C', 1, -50, 500),
  ('Índice de refracción', NULL, 4, 1,   2),
  ('Color',             'Gardner', 1, 0, 18),
  ('Humedad',           '%',    2, 0,    100),
  ('Pureza',            '%',    2, 0,    100)
ON CONFLICT (nombre) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Migración de datos legacy: copia columnas viejas a las nuevas tablas
-- ----------------------------------------------------------------------------

-- Productos: copia solidos_min/max, ph_min/max, viscosidad_min/max → producto_specs
INSERT INTO producto_specs (producto_id, spec_id, min_valor, max_valor, orden)
SELECT p.id, sc.id, p.solidos_min, p.solidos_max, 0
FROM productos p
CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'Sólidos'
  AND (p.solidos_min IS NOT NULL OR p.solidos_max IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO producto_specs (producto_id, spec_id, min_valor, max_valor, orden)
SELECT p.id, sc.id, p.ph_min, p.ph_max, 1
FROM productos p
CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'pH'
  AND (p.ph_min IS NOT NULL OR p.ph_max IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO producto_specs (producto_id, spec_id, min_valor, max_valor, orden)
SELECT p.id, sc.id, p.viscosidad_min, p.viscosidad_max, 2
FROM productos p
CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'Viscosidad'
  AND (p.viscosidad_min IS NOT NULL OR p.viscosidad_max IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Lotes: copia solidos, ph, viscosidad → lote_specs
INSERT INTO lote_specs (lote_id, spec_id, valor)
SELECT l.id, sc.id, l.solidos
FROM lotes l CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'Sólidos' AND l.solidos IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO lote_specs (lote_id, spec_id, valor)
SELECT l.id, sc.id, l.ph
FROM lotes l CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'pH' AND l.ph IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO lote_specs (lote_id, spec_id, valor)
SELECT l.id, sc.id, l.viscosidad
FROM lotes l CROSS JOIN spec_catalogo sc
WHERE sc.nombre = 'Viscosidad' AND l.viscosidad IS NOT NULL
ON CONFLICT DO NOTHING;
