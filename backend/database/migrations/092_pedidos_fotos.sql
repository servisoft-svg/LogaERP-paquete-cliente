-- ============================================================
-- 092: Fotos del pedido empaquetado (respaldo ante incidencias).
-- foto_urls: JSONB array de filenames (mismo patrón que ordenes_produccion).
-- Los archivos físicos viven en backend/uploads/pedidos/ y se sirven con
-- uploadsAuthMiddleware (token JWT + ownership check).
-- ============================================================

BEGIN;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS foto_urls JSONB DEFAULT '[]'::jsonb;

-- Permitir uploadsAuthMiddleware verificar ownership de fotos del pedido.
-- (El middleware ya consulta ordenes_produccion.foto_urls; añadimos pedidos
-- al barrido — se ajusta en el código del middleware tras la migración.)

COMMIT;
