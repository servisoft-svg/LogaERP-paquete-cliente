-- =============================================================
-- Migración 022 — SECURITY DEFINER en funciones de numeración
--                  + GRANT permisos a roles consumidores
-- =============================================================
-- Contexto del problema:
--   En producción el rol con el que se conecta la app NO suele ser
--   owner de las tablas/funciones (típico Railway, Supabase, RDS).
--   Sin permisos USAGE sobre las secuencias y EXECUTE sobre las
--   funciones trigger, los INSERT en pedidos / ordenes_compra fallan
--   con "permission denied" — y el operario humano no tiene forma
--   simple de saber qué ejecutar para arreglarlo.
--
-- Solución definitiva:
--   1. Las funciones fn_numero_pedido / fn_numero_oc se declaran
--      SECURITY DEFINER → se ejecutan con los permisos del OWNER
--      (quien ejecuta esta migración), no del rol que hace el INSERT.
--   2. GRANT EXECUTE en las funciones a PUBLIC → cualquier rol puede
--      invocarlas (a través del trigger BEFORE INSERT).
--   3. GRANT USAGE en las secuencias a PUBLIC → por si alguien las
--      consulta directamente.
--   4. SET search_path en las funciones para evitar ataques de
--      hijacking de search_path (mejor práctica con SECURITY DEFINER).
--
-- Resultado: cualquier rol que pueda INSERT en pedidos/ordenes_compra
-- puede generar números automáticamente, sin permisos directos sobre
-- la secuencia. El trigger defensivo de la migración 017 sigue
-- activo como red de seguridad anti-colisión.
--
-- IMPORTANTE: ejecutar esta migración con el rol OWNER de las tablas
-- (típicamente postgres / superuser de la plataforma). Una sola vez.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Re-crear funciones con SECURITY DEFINER + search_path fijo
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_numero_pedido() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_intento INT := 0;
  v_max     INT;
  v_year    TEXT;
BEGIN
  IF NEW.numero_pedido IS NOT NULL AND NEW.numero_pedido <> '' THEN
    RETURN NEW;
  END IF;

  v_year := TO_CHAR(NOW(), 'YYYY');
  NEW.numero_pedido := 'PED-' || v_year || '-' ||
    LPAD(nextval('public.seq_numero_pedido')::TEXT, 5, '0');

  -- Loop anti-colisión: si el nextval generado ya existe (desfase
  -- de secuencia por restore/admin manual), re-sync y reintenta.
  WHILE v_intento < 5 AND EXISTS (
    SELECT 1 FROM public.pedidos WHERE numero_pedido = NEW.numero_pedido
  ) LOOP
    v_intento := v_intento + 1;
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_pedido FROM '[0-9]+$') AS INT)), 0)
      INTO v_max FROM public.pedidos;
    PERFORM setval('public.seq_numero_pedido', v_max, TRUE);
    NEW.numero_pedido := 'PED-' || v_year || '-' ||
      LPAD(nextval('public.seq_numero_pedido')::TEXT, 5, '0');
    RAISE WARNING '[fn_numero_pedido] secuencia desincronizada — re-sync intento %, nuevo numero=%',
      v_intento, NEW.numero_pedido;
  END LOOP;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_numero_oc() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_intento INT := 0;
  v_max     INT;
  v_year    TEXT;
BEGIN
  IF NEW.numero_oc IS NOT NULL AND NEW.numero_oc <> '' THEN
    RETURN NEW;
  END IF;

  v_year := TO_CHAR(NOW(), 'YYYY');
  NEW.numero_oc := 'OC-' || v_year || '-' ||
    LPAD(nextval('public.seq_numero_oc')::TEXT, 5, '0');

  WHILE v_intento < 5 AND EXISTS (
    SELECT 1 FROM public.ordenes_compra WHERE numero_oc = NEW.numero_oc
  ) LOOP
    v_intento := v_intento + 1;
    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)), 0)
      INTO v_max FROM public.ordenes_compra;
    PERFORM setval('public.seq_numero_oc', v_max, TRUE);
    NEW.numero_oc := 'OC-' || v_year || '-' ||
      LPAD(nextval('public.seq_numero_oc')::TEXT, 5, '0');
    RAISE WARNING '[fn_numero_oc] secuencia desincronizada — re-sync intento %, nuevo numero=%',
      v_intento, NEW.numero_oc;
  END LOOP;

  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------
-- 2) GRANTs explícitos para cualquier rol consumidor
--    (incluido el rol app aunque no sea owner)
-- ---------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_numero_pedido() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_numero_oc()     TO PUBLIC;

-- USAGE: invocar nextval/currval. SELECT: leer last_value (para
-- /api/health). Sin UPDATE: el rol app no debe poder hacer setval
-- directamente — solo a través del trigger SECURITY DEFINER.
GRANT USAGE, SELECT ON SEQUENCE public.seq_numero_pedido TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE public.seq_numero_oc     TO PUBLIC;

-- ---------------------------------------------------------------
-- 3) Re-sincronización inicial (idempotente)
-- ---------------------------------------------------------------
DO $resync$
DECLARE
  v_max_pedido INT;
  v_max_oc     INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_pedido FROM '[0-9]+$') AS INT)), 0)
    INTO v_max_pedido FROM public.pedidos;
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)), 0)
    INTO v_max_oc FROM public.ordenes_compra;

  IF v_max_pedido > 0 THEN
    PERFORM setval('public.seq_numero_pedido', v_max_pedido, TRUE);
  ELSE
    PERFORM setval('public.seq_numero_pedido', 1, FALSE);
  END IF;

  IF v_max_oc > 0 THEN
    PERFORM setval('public.seq_numero_oc', v_max_oc, TRUE);
  ELSE
    PERFORM setval('public.seq_numero_oc', 1, FALSE);
  END IF;

  RAISE NOTICE '[022] seq_numero_pedido sincronizada con MAX=% (próximo=%)',
    v_max_pedido, v_max_pedido + 1;
  RAISE NOTICE '[022] seq_numero_oc      sincronizada con MAX=% (próximo=%)',
    v_max_oc, v_max_oc + 1;
END
$resync$;

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN:
--   SELECT proname, prosecdef AS security_definer, proconfig
--     FROM pg_proc
--    WHERE proname IN ('fn_numero_pedido', 'fn_numero_oc');
--   -- Esperado: prosecdef = TRUE, proconfig = {search_path=public, pg_temp}
--
--   -- Como rol app, intentar INSERT pedido — debe funcionar:
--   INSERT INTO pedidos (cantidad, unidad_medida, cliente_nombre)
--     VALUES (1, 'kg', 'TEST') RETURNING numero_pedido;
-- =============================================================
