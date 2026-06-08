-- ============================================================
-- 093: Borrar recordatorios cuando se elimina la referencia.
-- recordatorios.referencia_tipo + referencia_id es una asociación
-- polimórfica → no se puede usar FK simple. Usamos triggers AFTER
-- DELETE en cada tabla referenciada que limpia recordatorios.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recordatorios_cascade_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT := TG_ARGV[0];
BEGIN
  DELETE FROM public.recordatorios
   WHERE referencia_tipo = v_tipo
     AND referencia_id   = OLD.id;
  RETURN OLD;
END;
$$;

-- Ordenes de producción
DROP TRIGGER IF EXISTS trg_recordatorios_cascade_orden ON public.ordenes_produccion;
CREATE TRIGGER trg_recordatorios_cascade_orden
AFTER DELETE ON public.ordenes_produccion
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('orden');

-- Pedidos
DROP TRIGGER IF EXISTS trg_recordatorios_cascade_pedido ON public.pedidos;
CREATE TRIGGER trg_recordatorios_cascade_pedido
AFTER DELETE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('pedido');

-- Productos
DROP TRIGGER IF EXISTS trg_recordatorios_cascade_producto ON public.productos;
CREATE TRIGGER trg_recordatorios_cascade_producto
AFTER DELETE ON public.productos
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('producto');

-- Lotes
DROP TRIGGER IF EXISTS trg_recordatorios_cascade_lote ON public.lotes;
CREATE TRIGGER trg_recordatorios_cascade_lote
AFTER DELETE ON public.lotes
FOR EACH ROW
EXECUTE FUNCTION public.fn_recordatorios_cascade_delete('lote');

-- Limpieza one-shot: borrar recordatorios huérfanos existentes
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'orden'
   AND NOT EXISTS (SELECT 1 FROM public.ordenes_produccion x WHERE x.id = r.referencia_id);
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'pedido'
   AND NOT EXISTS (SELECT 1 FROM public.pedidos x WHERE x.id = r.referencia_id);
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'producto'
   AND NOT EXISTS (SELECT 1 FROM public.productos x WHERE x.id = r.referencia_id);
DELETE FROM public.recordatorios r
 WHERE r.referencia_tipo = 'lote'
   AND NOT EXISTS (SELECT 1 FROM public.lotes x WHERE x.id = r.referencia_id);

COMMIT;
