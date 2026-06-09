-- ============================================================
-- 094: Recordatorios pueden enlazar a clientes y proveedores.
-- (ej. "Llamar a proveedor X", "Reunión con cliente Y").
-- Reusa el patrón polimórfico de migración 090 + cascade 093.
-- ============================================================

BEGIN;

-- Triggers AFTER DELETE para limpiar recordatorios huérfanos cuando
-- se elimina (hard delete) un cliente o proveedor.
-- Reusa fn_recordatorios_cascade_delete() definida en migración 093.

DROP TRIGGER IF EXISTS trg_recordatorios_cascade_cliente ON public.clientes;
CREATE TRIGGER trg_recordatorios_cascade_cliente
AFTER DELETE ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('cliente');

DROP TRIGGER IF EXISTS trg_recordatorios_cascade_proveedor ON public.proveedores;
CREATE TRIGGER trg_recordatorios_cascade_proveedor
AFTER DELETE ON public.proveedores
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('proveedor');

-- Limpieza one-shot: borrar recordatorios huérfanos preexistentes
-- (por si alguien creó un recordatorio con referencia_tipo='cliente' o
-- 'proveedor' antes de esta migración).
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'cliente'
   AND NOT EXISTS (SELECT 1 FROM public.clientes x WHERE x.id = r.referencia_id);
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'proveedor'
   AND NOT EXISTS (SELECT 1 FROM public.proveedores x WHERE x.id = r.referencia_id);

COMMIT;
