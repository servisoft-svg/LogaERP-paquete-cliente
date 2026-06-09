-- ============================================================
-- 097: Mapeo OFICIAL de zonas Schenker (PDF "TARIFAS DB-SCHENCKER
-- COLUMNAS"). Reemplaza el mapeo aproximado de la migración 095.
-- Origen: Palencia (Trans-Jelabel) → la asignación de columnas no
-- coincide con distancia, es la oficial del transportista.
-- ============================================================

BEGIN;

UPDATE public.portes_zonas_envio SET zona_schenker = '01'
 WHERE provincia IN ('BURGOS','LEON','SALAMANCA','SEGOVIA','VALLADOLID','ZAMORA','PALENCIA');

UPDATE public.portes_zonas_envio SET zona_schenker = '02'
 WHERE provincia IN ('AVILA','CIUDAD REAL','A CORUNA','CUENCA','GUADALAJARA','LUGO','MADRID','ORENSE','ASTURIAS','PONTEVEDRA','TOLEDO');

UPDATE public.portes_zonas_envio SET zona_schenker = '03'
 WHERE provincia IN ('ALAVA','GERONA','GUIPUZCOA','HUESCA','LERIDA','LA RIOJA','NAVARRA','CANTABRIA','SORIA','TARRAGONA','TERUEL','VIZCAYA','ZARAGOZA');

UPDATE public.portes_zonas_envio SET zona_schenker = '04'
 WHERE provincia IN ('ALICANTE','BARCELONA','VALENCIA');

UPDATE public.portes_zonas_envio SET zona_schenker = '05'
 WHERE provincia IN ('ALBACETE','CASTELLON','CORDOBA','HUELVA','JAEN','MALAGA','MURCIA','SEVILLA');

UPDATE public.portes_zonas_envio SET zona_schenker = '06'
 WHERE provincia IN ('ALMERIA','BADAJOZ','CACERES','CADIZ','GRANADA',
                     'BALEARES','MALLORCA','IBIZA','MENORCA',
                     'ISLAS CANARIAS','CEUTA','MELILLA');

COMMIT;
