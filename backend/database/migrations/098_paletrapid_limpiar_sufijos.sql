-- ============================================================
-- 098: Limpia sufijos " (X)" en provincia de portes_paletrapid.
-- Bug: la migración 095 original guardó "BARCELONA (1)" y
-- "MADRID (1)" (sufijo del PDF). El cálculo de portes busca
-- por "BARCELONA" o "MADRID" exactos y no encontraba nada.
--
-- Esta migración:
--   1) Normaliza filas existentes quitando " (...)" del final.
--   2) Si tras renombrar choca con una fila legítima, la duplicada
--      se elimina (la legítima ya estaba con el nombre limpio).
-- ============================================================

BEGIN;

-- Borra duplicados que quedarían al renombrar (mantén el ya limpio)
DELETE FROM public.portes_paletrapid p
 WHERE p.provincia ~ ' \([^)]*\)$'
   AND EXISTS (
     SELECT 1 FROM public.portes_paletrapid q
      WHERE q.servicio = p.servicio
        AND q.provincia = regexp_replace(p.provincia, ' \([^)]*\)$', '')
   );

-- Renombra los restantes
UPDATE public.portes_paletrapid
   SET provincia = regexp_replace(provincia, ' \([^)]*\)$', '')
 WHERE provincia ~ ' \([^)]*\)$';

-- Mismo saneo en portes_zonas_envio por si el seed inicial lo arrastró
DELETE FROM public.portes_zonas_envio p
 WHERE p.provincia ~ ' \([^)]*\)$'
   AND EXISTS (
     SELECT 1 FROM public.portes_zonas_envio q
      WHERE q.provincia = regexp_replace(p.provincia, ' \([^)]*\)$', '')
   );

UPDATE public.portes_zonas_envio
   SET provincia = regexp_replace(provincia, ' \([^)]*\)$', '')
 WHERE provincia ~ ' \([^)]*\)$';

COMMIT;
