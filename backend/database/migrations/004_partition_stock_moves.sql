-- ============================================================
-- Particionado de stock_moves por año (rango en created_at)
-- Proyección: 180M filas en 10 años → ~18M/año/partición
-- PostgreSQL usa Index Pruning: solo escanea particiones relevantes
-- ============================================================

BEGIN;

-- 1. Renombrar tabla original
ALTER TABLE public.stock_moves RENAME TO stock_moves_old;

-- 2. Crear tabla particionada con misma estructura
CREATE TABLE public.stock_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    lote_id uuid,
    tipo public.tipo_movimiento NOT NULL,
    cantidad numeric(20,6) NOT NULL,
    cantidad_antes numeric(20,6) NOT NULL,
    cantidad_despues numeric(20,6) NOT NULL,
    orden_id uuid,
    referencia_externa character varying(255),
    usuario_id uuid,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
) PARTITION BY RANGE (created_at);

-- 3. Crear particiones (2024-2035, cubre 10+ años)
CREATE TABLE stock_moves_2024 PARTITION OF stock_moves FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE stock_moves_2025 PARTITION OF stock_moves FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE stock_moves_2026 PARTITION OF stock_moves FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE stock_moves_2027 PARTITION OF stock_moves FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE stock_moves_2028 PARTITION OF stock_moves FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');
CREATE TABLE stock_moves_2029 PARTITION OF stock_moves FOR VALUES FROM ('2029-01-01') TO ('2030-01-01');
CREATE TABLE stock_moves_2030 PARTITION OF stock_moves FOR VALUES FROM ('2030-01-01') TO ('2031-01-01');
CREATE TABLE stock_moves_2031 PARTITION OF stock_moves FOR VALUES FROM ('2031-01-01') TO ('2032-01-01');
CREATE TABLE stock_moves_2032 PARTITION OF stock_moves FOR VALUES FROM ('2032-01-01') TO ('2033-01-01');
CREATE TABLE stock_moves_2033 PARTITION OF stock_moves FOR VALUES FROM ('2033-01-01') TO ('2034-01-01');
CREATE TABLE stock_moves_2034 PARTITION OF stock_moves FOR VALUES FROM ('2034-01-01') TO ('2035-01-01');
CREATE TABLE stock_moves_2035 PARTITION OF stock_moves FOR VALUES FROM ('2035-01-01') TO ('2036-01-01');

-- 4. Índices en tabla padre (se propagan a particiones automáticamente)
CREATE INDEX idx_sm_producto_created ON stock_moves (producto_id, created_at DESC);
CREATE INDEX idx_sm_lote ON stock_moves (lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX idx_sm_orden ON stock_moves (orden_id) WHERE orden_id IS NOT NULL;
CREATE INDEX idx_sm_tipo_created ON stock_moves (tipo, created_at DESC);

-- 5. Migrar datos existentes
INSERT INTO stock_moves SELECT * FROM stock_moves_old;

-- 6. Borrar tabla antigua
DROP TABLE stock_moves_old;

COMMIT;

-- NOTA: Las queries con WHERE created_at BETWEEN '2026-01-01' AND '2026-12-31'
-- solo tocarán la partición stock_moves_2026 (Index Pruning automático).
-- Las queries sin filtro de fecha escanean TODAS las particiones en paralelo.
-- Para consultas globales pesadas, usar: SET max_parallel_workers_per_gather = 4;
