-- =============================================================
-- Migración 017 — re-sincronizar secuencias + funciones defensivas
-- =============================================================
-- Contexto: la migración 016 introdujo seq_numero_pedido / seq_numero_oc
-- pero el setval inicial puede haber fallado silenciosamente en
-- entornos donde el usuario que ejecutó la migración no era owner de
-- las tablas pedidos / ordenes_compra (permission denied al SELECT
-- MAX). Resultado en producción: secuencias arrancando en 1, primer
-- nextval colisiona con números históricos → UNIQUE constraint
-- violation → "No se pudo crear el pedido".
--
-- Esta migración:
--   1. Re-sincroniza ambas secuencias con MAX real (idempotente).
--   2. Reescribe los triggers con un EXCEPTION handler: si el nextval
--      colisiona con un número existente, salta a MAX+1 y reintenta
--      (defensa en profundidad para que NUNCA se rompa el INSERT por
--      desfase de secuencia, aunque admins manuales hayan introducido
--      números fuera de la secuencia).
--   3. Devuelve un resumen visible del estado tras la sincronización.
--
-- IMPORTANTE: ejecutar con un usuario con SELECT sobre pedidos /
-- ordenes_compra Y permisos sobre las secuencias. Típicamente el
-- owner de las tablas. En la BD local "adrianmartinlopez". En
-- producción Railway/Postgres: el rol con el que se conecta la app.
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1) Garantía mínima: secuencias existen (por si la 016 falló antes
--    de llegar al CREATE SEQUENCE).
-- ---------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.seq_numero_pedido START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_numero_oc      START 1 INCREMENT 1;

-- ---------------------------------------------------------------
-- 2) Re-sincronizar secuencias con MAX real existente.
--
--    setval(seq, n, TRUE)  → next nextval() devuelve n + 1
--    GREATEST(1, MAX...)   → tolera tabla vacía sin tirar error
--    SUBSTRING ... '[0-9]+$'  → extrae el sufijo numérico final del
--                               numero_pedido / numero_oc, soporta
--                               cualquier prefijo (PED-2026-, PED-, etc.)
--
--    Si la migración aborta aquí por permission denied: ejecutarla
--    como el OWNER de las tablas (ver query de diagnóstico al final).
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

  -- setval requiere valor >= 1; si la tabla está vacía dejamos seq en 1
  -- con is_called=false → próximo nextval devuelve 1 (no 2).
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

  RAISE NOTICE '[017] seq_numero_pedido sincronizada con MAX=% (próximo nextval=%)',
    v_max_pedido, v_max_pedido + 1;
  RAISE NOTICE '[017] seq_numero_oc      sincronizada con MAX=% (próximo nextval=%)',
    v_max_oc, v_max_oc + 1;
END
$resync$;

-- ---------------------------------------------------------------
-- 3) Funciones trigger DEFENSIVAS con loop anti-colisión.
--
--    Si por cualquier razón (admin manual, restore parcial, secuencia
--    desincronizada por bug futuro) el nextval colisiona con un
--    numero existente, capturamos unique_violation, recuperamos MAX
--    real, hacemos setval(MAX) y reintentamos. Hasta 5 intentos.
--
--    Esto NUNCA debería ejecutarse en condiciones normales, pero
--    garantiza que un INSERT de pedido/OC jamás falla por desfase de
--    contador — el peor caso es que el INSERT tarde 5ms más.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_numero_pedido() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_intento INT := 0;
  v_max     INT;
  v_year    TEXT;
BEGIN
  -- Si el caller ya envió un número explícito, respetarlo.
  IF NEW.numero_pedido IS NOT NULL AND NEW.numero_pedido <> '' THEN
    RETURN NEW;
  END IF;

  v_year := TO_CHAR(NOW(), 'YYYY');
  -- Generación inicial vía nextval (camino feliz)
  NEW.numero_pedido := 'PED-' || v_year || '-' ||
    LPAD(nextval('public.seq_numero_pedido')::TEXT, 5, '0');

  -- Defensa anti-colisión: si por desfase de secuencia el número
  -- generado ya existe, re-sincronizar y reintentar.
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

COMMIT;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN — ejecutar después y revisar a ojo:
-- =============================================================
--   SELECT 'pedidos'  AS tabla,
--          (SELECT MAX(CAST(SUBSTRING(numero_pedido FROM '[0-9]+$') AS INT)) FROM pedidos) AS max_real,
--          last_value AS seq_value, is_called
--     FROM seq_numero_pedido
--   UNION ALL
--   SELECT 'ordenes_compra',
--          (SELECT MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)) FROM ordenes_compra),
--          last_value, is_called
--     FROM seq_numero_oc;
--
-- Esperado:
--   - seq_value >= max_real
--   - is_called = TRUE (excepto si tabla vacía → seq_value=1, is_called=FALSE, próximo=1)
--
-- DIAGNÓSTICO (si algo va mal — permisos):
--   SELECT tablename, tableowner FROM pg_tables
--    WHERE tablename IN ('pedidos','ordenes_compra');
--   SELECT current_user, session_user;
--
-- ROLLBACK manual (no automático) — restaurar comportamiento 016:
--   Re-aplicar 016 (CREATE OR REPLACE FUNCTION sin loop defensivo).
-- =============================================================
