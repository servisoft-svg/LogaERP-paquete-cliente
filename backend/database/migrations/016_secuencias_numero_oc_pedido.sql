-- =============================================================
-- Migración 016 — secuencias para numero_oc y numero_pedido (anti-race)
-- =============================================================
-- Problema: fn_numero_oc() y fn_numero_pedido() calculaban el siguiente
-- número con `MAX(...) + 1` sin lock. Dos INSERT concurrentes podían
-- generar el mismo número y violar el UNIQUE constraint (uno fallaba
-- con error opaco).
--
-- Solución: usar secuencias dedicadas con `nextval()`, igual que ya hace
-- fn_numero_orden(seq_numero_orden). nextval() es atómico y nunca
-- devuelve dos veces el mismo valor.
--
-- Sincronización inicial: setval(seq, MAX(existente)) garantiza que la
-- secuencia arranca por encima del último número en uso, evitando
-- colisiones con datos históricos.
-- =============================================================

BEGIN;

-- 1) Secuencias dedicadas (idempotente)
CREATE SEQUENCE IF NOT EXISTS public.seq_numero_oc      START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_numero_pedido  START 1 INCREMENT 1;

-- 2) Sincronizar con el MAX existente (extrae el sufijo numérico).
-- COALESCE con 0 + setval(seq, n, false) → próximo nextval devuelve n+1.
-- Si tabla vacía, próximo nextval devuelve 1.
SELECT setval(
  'public.seq_numero_oc',
  GREATEST(
    1,
    (SELECT COALESCE(MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)), 0) FROM public.ordenes_compra)
  ),
  TRUE  -- TRUE = el siguiente nextval devuelve MAX+1
);

SELECT setval(
  'public.seq_numero_pedido',
  GREATEST(
    1,
    (SELECT COALESCE(MAX(CAST(SUBSTRING(numero_pedido FROM '[0-9]+$') AS INT)), 0) FROM public.pedidos)
  ),
  TRUE
);

-- 3) Reescribir las funciones para usar nextval (atómico)
CREATE OR REPLACE FUNCTION public.fn_numero_oc() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero_oc IS NULL OR NEW.numero_oc = '' THEN
    NEW.numero_oc := 'OC-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      LPAD(nextval('public.seq_numero_oc')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_numero_pedido() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero_pedido IS NULL OR NEW.numero_pedido = '' THEN
    NEW.numero_pedido := 'PED-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      LPAD(nextval('public.seq_numero_pedido')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- =============================================================
-- ROLLBACK manual:
-- =============================================================
--   BEGIN;
--   CREATE OR REPLACE FUNCTION public.fn_numero_oc() RETURNS trigger
--   LANGUAGE plpgsql AS $$ BEGIN
--     NEW.numero_oc := 'OC-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
--       LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(numero_oc FROM '[0-9]+$') AS INT)), 0) + 1
--             FROM ordenes_compra)::TEXT, 5, '0');
--     RETURN NEW; END $$;
--   -- (idem fn_numero_pedido)
--   DROP SEQUENCE IF EXISTS public.seq_numero_oc;
--   DROP SEQUENCE IF EXISTS public.seq_numero_pedido;
--   COMMIT;
-- =============================================================
