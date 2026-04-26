-- ============================================================
-- ERP LOGA — Schema PostgreSQL
-- Fábrica de Cola Blanca (Adhesivos Vinílicos)
-- Precisión: NUMERIC(20,6) siempre. Nunca FLOAT.
-- Double-Entry Inventory: stock_moves inmutable.
-- ============================================================

BEGIN;

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE estado_lote       AS ENUM ('cuarentena', 'aprobado', 'rechazado');
CREATE TYPE tipo_movimiento   AS ENUM ('entrada', 'salida', 'ajuste', 'produccion_consumo', 'produccion_salida', 'merma');
CREATE TYPE estado_orden      AS ENUM ('borrador', 'confirmada', 'en_proceso', 'completada', 'cancelada');
CREATE TYPE tipo_producto     AS ENUM ('materia_prima', 'producto_terminado', 'material_embalaje');

-- ============================================================
-- CONFIGURACION GLOBAL
-- ============================================================
CREATE TABLE configuracion_global (
    id                  SMALLINT PRIMARY KEY DEFAULT 1,
    porcentaje_alerta   NUMERIC(5,2) NOT NULL DEFAULT 20.00
                            CHECK (porcentaje_alerta >= 0 AND porcentaje_alerta <= 100),
    plantilla_email     TEXT NOT NULL DEFAULT
        'Estimado proveedor,\n\nNecesitamos reponer el producto: {{producto}}\nCantidad sugerida: {{cantidad}} {{unidad}}\n\nPor favor confirme disponibilidad y plazo de entrega.\n\nSaludos,\nFábrica Loga',
    email_remitente     VARCHAR(255) NOT NULL DEFAULT 'erp@loga.es',
    smtp_host           VARCHAR(255) NOT NULL DEFAULT 'smtp.gmail.com',
    smtp_port           SMALLINT    NOT NULL DEFAULT 587,
    smtp_user           VARCHAR(255) NOT NULL DEFAULT '',
    smtp_pass_enc       TEXT        NOT NULL DEFAULT '',  -- almacenar cifrado
    CONSTRAINT solo_una_fila CHECK (id = 1)
);

INSERT INTO configuracion_global DEFAULT VALUES;

-- ============================================================
-- PROVEEDORES
-- ============================================================
CREATE TABLE proveedores (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    telefono        VARCHAR(50),
    direccion       TEXT,
    activo          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRODUCTOS
-- ============================================================
CREATE TABLE productos (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          VARCHAR(50)     NOT NULL UNIQUE,
    nombre          VARCHAR(255)    NOT NULL,
    descripcion     TEXT,
    tipo            tipo_producto   NOT NULL DEFAULT 'materia_prima',
    unidad_medida   VARCHAR(20)     NOT NULL DEFAULT 'kg',
    stock_actual    NUMERIC(20,6)   NOT NULL DEFAULT 0
                        CHECK (stock_actual >= 0),
    stock_minimo    NUMERIC(20,6)   NOT NULL DEFAULT 0
                        CHECK (stock_minimo >= 0),
    stock_maximo    NUMERIC(20,6)   NOT NULL DEFAULT 0
                        CHECK (stock_maximo >= 0),
    precio_unitario NUMERIC(20,6)   NOT NULL DEFAULT 0
                        CHECK (precio_unitario >= 0),
    proveedor_id    UUID            REFERENCES proveedores(id) ON DELETE SET NULL,
    activo          BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LOTES
-- ============================================================
CREATE TABLE lotes (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID            NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    lote_interno        VARCHAR(100)    NOT NULL UNIQUE,
    lote_proveedor      VARCHAR(100),
    cantidad_inicial    NUMERIC(20,6)   NOT NULL CHECK (cantidad_inicial > 0),
    cantidad_actual     NUMERIC(20,6)   NOT NULL CHECK (cantidad_actual >= 0),
    fecha_fabricacion   DATE,
    fecha_caducidad     DATE,
    fecha_entrada       DATE            NOT NULL DEFAULT CURRENT_DATE,
    estado              estado_lote     NOT NULL DEFAULT 'cuarentena',
    ubicacion           VARCHAR(100),
    observaciones       TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT caducidad_posterior CHECK (
        fecha_caducidad IS NULL OR fecha_fabricacion IS NULL OR fecha_caducidad > fecha_fabricacion
    )
);

-- Índice para FIFO: primero caduca antes, luego más antiguo
CREATE INDEX idx_lotes_fifo ON lotes (
    producto_id,
    estado,
    fecha_caducidad ASC NULLS LAST,
    fecha_entrada ASC
) WHERE estado = 'aprobado' AND cantidad_actual > 0;

-- ============================================================
-- RECETAS
-- ============================================================
CREATE TABLE recetas (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id     UUID            NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    nombre          VARCHAR(255)    NOT NULL,
    version         SMALLINT        NOT NULL DEFAULT 1,
    rendimiento     NUMERIC(20,6)   NOT NULL DEFAULT 1 CHECK (rendimiento > 0), -- unidades producidas por batch
    activa          BOOLEAN         NOT NULL DEFAULT TRUE,
    notas           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (producto_id, version)
);

-- ============================================================
-- INGREDIENTES DE RECETA
-- ============================================================
CREATE TABLE ingredientes_receta (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    receta_id       UUID            NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
    materia_prima_id UUID           NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad        NUMERIC(20,6)   NOT NULL CHECK (cantidad > 0),
    porcentaje_merma NUMERIC(5,2)   NOT NULL DEFAULT 0
                        CHECK (porcentaje_merma >= 0 AND porcentaje_merma < 100),
    unidad_medida   VARCHAR(20)     NOT NULL DEFAULT 'kg',
    UNIQUE (receta_id, materia_prima_id)
);

-- ============================================================
-- ÓRDENES DE PRODUCCIÓN
-- ============================================================
CREATE TABLE ordenes_produccion (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_orden        VARCHAR(50)     NOT NULL UNIQUE,  -- e.g. OP-2024-0001
    receta_id           UUID            NOT NULL REFERENCES recetas(id) ON DELETE RESTRICT,
    cantidad_planificada NUMERIC(20,6)  NOT NULL CHECK (cantidad_planificada > 0),
    cantidad_producida  NUMERIC(20,6)   NOT NULL DEFAULT 0 CHECK (cantidad_producida >= 0),
    estado              estado_orden    NOT NULL DEFAULT 'borrador',
    lote_producido_id   UUID            REFERENCES lotes(id),
    fecha_planificada   DATE,
    fecha_inicio        TIMESTAMPTZ,
    fecha_fin           TIMESTAMPTZ,
    operario_id         UUID,           -- FK futura a usuarios
    notas               TEXT,\n    ph                  NUMERIC(5,2),\n    foto_url            TEXT,\n    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Secuencia para número de orden
CREATE SEQUENCE seq_numero_orden START 1 INCREMENT 1;

-- ============================================================
-- STOCK MOVES — DOBLE ENTRADA, INMUTABLE
-- ============================================================
CREATE TABLE stock_moves (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID            NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    lote_id             UUID            REFERENCES lotes(id) ON DELETE RESTRICT,
    tipo                tipo_movimiento NOT NULL,
    cantidad            NUMERIC(20,6)   NOT NULL,  -- positivo=entrada, negativo=salida
    cantidad_antes      NUMERIC(20,6)   NOT NULL,
    cantidad_despues    NUMERIC(20,6)   NOT NULL,
    orden_id            UUID            REFERENCES ordenes_produccion(id),
    referencia_externa  VARCHAR(255),   -- nº albarán, factura, etc.
    usuario_id          UUID,
    motivo              TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
    -- SIN updated_at: este registro es INMUTABLE
);

-- REGLA: prohibir UPDATE y DELETE en stock_moves
CREATE RULE no_update_stock_moves AS ON UPDATE TO stock_moves DO INSTEAD NOTHING;
CREATE RULE no_delete_stock_moves AS ON DELETE TO stock_moves DO INSTEAD NOTHING;

-- Índices para reportes
CREATE INDEX idx_stock_moves_producto ON stock_moves (producto_id, created_at DESC);
CREATE INDEX idx_stock_moves_lote     ON stock_moves (lote_id, created_at DESC);
CREATE INDEX idx_stock_moves_orden    ON stock_moves (orden_id) WHERE orden_id IS NOT NULL;

-- ============================================================
-- AUDITORÍA
-- ============================================================
CREATE TABLE auditoria (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      UUID,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accion          VARCHAR(50) NOT NULL,   -- CREATE, UPDATE, DELETE, LOGIN, etc.
    tabla_afectada  VARCHAR(100) NOT NULL,
    registro_id     UUID,
    datos_antes     JSONB,
    datos_despues   JSONB,
    motivo          TEXT        NOT NULL DEFAULT '',  -- obligatorio en ediciones manuales
    ip_origen       INET
);

CREATE INDEX idx_auditoria_fecha         ON auditoria (fecha DESC);
CREATE INDEX idx_auditoria_tabla_registro ON auditoria (tabla_afectada, registro_id);

-- ============================================================
-- NOTIFICACIONES INTERNAS
-- ============================================================
CREATE TABLE notificaciones (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            VARCHAR(50) NOT NULL DEFAULT 'alerta_stock',
    titulo          VARCHAR(255) NOT NULL,
    mensaje         TEXT        NOT NULL,
    producto_id     UUID        REFERENCES productos(id) ON DELETE CASCADE,
    leida           BOOLEAN     NOT NULL DEFAULT FALSE,
    email_enviado   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notificaciones_no_leidas ON notificaciones (leida, created_at DESC) WHERE leida = FALSE;

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_productos_updated_at
    BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_lotes_updated_at
    BEFORE UPDATE ON lotes
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_recetas_updated_at
    BEFORE UPDATE ON recetas
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_ordenes_updated_at
    BEFORE UPDATE ON ordenes_produccion
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- TRIGGER: alerta de reposición al mover stock
-- ============================================================
CREATE OR REPLACE FUNCTION fn_check_alerta_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_porcentaje    NUMERIC(5,2);
    v_umbral        NUMERIC(20,6);
    v_producto      RECORD;
BEGIN
    -- Solo actuar en salidas
    IF NEW.cantidad >= 0 THEN RETURN NEW; END IF;

    SELECT porcentaje_alerta INTO v_porcentaje FROM configuracion_global WHERE id = 1;

    SELECT p.id, p.nombre, p.codigo, p.stock_actual, p.stock_maximo, p.unidad_medida
    INTO v_producto
    FROM productos p WHERE p.id = NEW.producto_id;

    v_umbral := v_producto.stock_maximo * v_porcentaje / 100;

    IF v_producto.stock_actual <= v_umbral AND v_producto.stock_maximo > 0 THEN
        INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
        VALUES (
            'alerta_stock',
            'Stock bajo: ' || v_producto.nombre,
            'El producto ' || v_producto.codigo || ' - ' || v_producto.nombre ||
            ' tiene stock actual de ' || v_producto.stock_actual || ' ' || v_producto.unidad_medida ||
            ' (umbral: ' || v_umbral || ' ' || v_producto.unidad_medida || ').',
            v_producto.id
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alerta_stock
    AFTER INSERT ON stock_moves
    FOR EACH ROW EXECUTE FUNCTION fn_check_alerta_stock();

-- ============================================================
-- TRIGGER: número de orden automático
-- ============================================================
CREATE OR REPLACE FUNCTION fn_numero_orden()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_orden IS NULL OR NEW.numero_orden = '' THEN
        NEW.numero_orden := 'OP-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                            LPAD(nextval('seq_numero_orden')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_numero_orden
    BEFORE INSERT ON ordenes_produccion
    FOR EACH ROW EXECUTE FUNCTION fn_numero_orden();

-- ============================================================
-- CONSTRAINT: stock_actual nunca negativo (doble seguridad)
-- ============================================================
-- Ya cubierto por CHECK (stock_actual >= 0) en productos.
-- El trigger de alerta va AFTER INSERT en stock_moves.
-- La lógica de descuento actualiza productos.stock_actual dentro de la TX.

-- ============================================================
-- DATOS INICIALES (seed mínimo)
-- ============================================================
INSERT INTO proveedores (nombre, email, telefono) VALUES
    ('Química del Norte S.L.',     'pedidos@quimicanorte.es',  '+34 912 000 001'),
    ('Emulsiones Ibéricas S.A.',   'compras@emulsiones.es',    '+34 913 000 002'),
    ('Plastificantes Europa Ltda.','ventas@plasteuropa.es',    '+34 914 000 003');

COMMIT;
