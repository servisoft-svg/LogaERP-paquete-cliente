-- Trigger que dispara NOTIFY 'alilo_stock_change' cuando cambia stock_actual
-- o precio_unitario de un producto compartido con Alilo.
-- Un listener Node (services/aliloStockListener.service.ts) escucha y empuja
-- el webhook a Alilo.
--
-- Cubre TODOS los caminos de cambio de stock: compras, ajustes, fabricación,
-- consumo Alilo (vía /consumir), inserción/eliminación de lotes, etc.

CREATE OR REPLACE FUNCTION fn_notify_alilo_stock_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.compartido_alilo = TRUE
     AND (OLD.stock_actual IS DISTINCT FROM NEW.stock_actual
       OR OLD.precio_unitario IS DISTINCT FROM NEW.precio_unitario
       OR OLD.nombre IS DISTINCT FROM NEW.nombre
       OR OLD.codigo_alilo IS DISTINCT FROM NEW.codigo_alilo) THEN
    PERFORM pg_notify(
      'alilo_stock_change',
      json_build_object(
        'producto_id', NEW.id,
        'codigo', NEW.codigo,
        'codigo_alilo', NEW.codigo_alilo,
        'nombre', NEW.nombre,
        'stock_actual', NEW.stock_actual,
        'precio_unitario', NEW.precio_unitario,
        'unidad', NEW.unidad_medida,
        'old_stock', OLD.stock_actual,
        'changed_at', extract(epoch from now())
      )::text
    );
  END IF;
  -- Cuando un producto pasa de NO compartido → compartido, también notifica
  -- (estado inicial de sincronización).
  IF (OLD.compartido_alilo IS DISTINCT FROM NEW.compartido_alilo)
     AND NEW.compartido_alilo = TRUE THEN
    PERFORM pg_notify(
      'alilo_stock_change',
      json_build_object(
        'producto_id', NEW.id,
        'codigo', NEW.codigo,
        'codigo_alilo', NEW.codigo_alilo,
        'nombre', NEW.nombre,
        'stock_actual', NEW.stock_actual,
        'precio_unitario', NEW.precio_unitario,
        'unidad', NEW.unidad_medida,
        'old_stock', 0,
        'changed_at', extract(epoch from now())
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_alilo_stock ON productos;
CREATE TRIGGER trg_notify_alilo_stock
  AFTER UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_notify_alilo_stock_change();
