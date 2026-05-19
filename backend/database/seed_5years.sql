-- ══════════════════════════════════════════════════════════════
-- SEED 5 AÑOS DE DATOS — Colas Loga ERP
-- Clientes, pedidos, fabricaciones, envasados, lotes, stock_moves
-- Periodo: 2022-01-01 a 2026-04-24
-- ══════════════════════════════════════════════════════════════

-- Sin transacción para que errores parciales no aborten todo

-- ── 50 CLIENTES ──────────────────────────────────────────────
INSERT INTO clientes (nombre, email, telefono, nif, direccion, notas) VALUES
('Gullon SA', 'compras@gullon.es', '947361100', 'A09000143', 'Avda. de la Estación s/n, Aguilar de Campoo', 'Cliente principal cartonaje'),
('Carpintería Hermanos López', 'info@hnoslopez.es', '916543210', 'B12345678', 'C/ Madera 14, Madrid', 'Cola D2 estándar'),
('Muebles García', 'pedidos@mueblesgarcia.com', '963217654', 'B23456789', 'Pol. Ind. Fuente del Jarro, Paterna', ''),
('Encuadernaciones del Norte', 'admin@encnorte.es', '944123456', 'B34567890', 'C/ Bilbao 23, Vitoria', 'Encuadernación + PSA'),
('Packaging Solutions SL', 'logistics@packsol.es', '934567890', 'B45678901', 'C/ Industria 45, Barcelona', 'Cartonaje rápida'),
('Ferretería El Clavo', 'ferreteria@elclavo.es', '918765432', 'B56789012', 'C/ Mayor 8, Alcalá de Henares', 'Botes pequeños D2'),
('Bricomart Ibérica', 'compras@bricomart.es', '912345678', 'A67890123', 'C/ Logística 1, Getafe', 'Grandes volúmenes'),
('Maderas del Sur', 'info@maderassur.es', '954321098', 'B78901234', 'Pol. Ind. La Red, Sevilla', 'Cola rápida'),
('Artes Gráficas Levante', 'produccion@aglevan.es', '965432109', 'B89012345', 'C/ Imprenta 7, Alicante', 'PSA + Encuadernación'),
('Embalajes Industriales SA', 'ventas@embind.es', '976543210', 'A90123456', 'Pol. Ind. Malpica, Zaragoza', 'Hotmelt'),
('Talleres Martín', 'taller@martin.es', '923456789', 'B01234567', 'C/ Taller 3, Salamanca', ''),
('Adhesivos del Cantábrico', 'info@adhcant.es', '942345678', 'B11111111', 'C/ Puerto 12, Santander', 'Distribuidor'),
('Papelera del Ebro', 'compras@papelebro.es', '976123456', 'B22222222', 'C/ Papel 1, Zaragoza', ''),
('Carpintería Moderna SL', 'admin@carpmod.es', '913456789', 'B33333333', 'C/ Roble 45, Madrid', ''),
('Industrias Laminados SA', 'pedidos@laminados.es', '934123456', 'A44444444', 'Pol. Ind. Zona Franca, Barcelona', 'Grandes pedidos mensuales'),
('Envases Plásticos Reunidos', 'logistica@epr.es', '961234567', 'B55555555', 'C/ Envase 8, Valencia', ''),
('Distribuciones Pérez', 'dist@perez.es', '945678901', 'B66666666', 'C/ Distribución 3, Bilbao', 'Distribuidor zona norte'),
('Muebles Artesanos del Duero', 'info@artduero.es', '983456789', 'B77777777', 'C/ Artesano 11, Valladolid', ''),
('Gráficas del Mediterráneo', 'produccion@grafmed.es', '968901234', 'B88888888', 'C/ Gráfica 22, Murcia', 'Hotmelt lomos'),
('Cooperativa Maderera Astur', 'coop@madastur.es', '985678901', 'F99999999', 'C/ Coop 5, Oviedo', ''),
('Ferretería Central', 'ventas@ferrcentral.es', '921234567', 'B10101010', 'Plaza Mayor 1, Segovia', 'Botes 75g y 250g'),
('Brico Hogar Madrid', 'compras@bricohogar.es', '917654321', 'B20202020', 'C/ Bricolaje 15, Leganés', ''),
('Carpintería Industrial Norte', 'cin@cin.es', '948765432', 'B30303030', 'Pol. Ind. Landaben, Pamplona', 'Cola rápida 5kg'),
('Packaging Express', 'info@packexpress.es', '933456789', 'B40404040', 'C/ Express 7, Hospitalet', ''),
('Talleres de la Meseta', 'info@tallermeseta.es', '925678901', 'B50505050', 'C/ Meseta 3, Toledo', '')
ON CONFLICT DO NOTHING;

-- ── GENERAR DATOS MASIVOS ────────────────────────────────────
-- Usamos generate_series para crear miles de registros

-- Lotes de materias primas (entrada mensual durante 5 años = ~60 lotes por MP)
INSERT INTO lotes (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, precio_compra, fecha_entrada, created_at)
SELECT
  mp.id,
  'LH-' || mp.codigo || '-' || TO_CHAR(fecha, 'YYMM') || '-' || LPAD((ROW_NUMBER() OVER (PARTITION BY mp.id ORDER BY fecha))::TEXT, 3, '0'),
  CASE
    WHEN mp.codigo = 'MP-001' THEN 800 + (RANDOM() * 400)::INT  -- VAM
    WHEN mp.codigo = 'MP-004' THEN 500 + (RANDOM() * 300)::INT  -- Agua
    WHEN mp.codigo = 'MP-002' THEN 40 + (RANDOM() * 30)::INT    -- PVOH
    ELSE 10 + (RANDOM() * 40)::INT
  END,
  GREATEST(0, CASE
    WHEN fecha < '2026-01-01' THEN 0  -- lotes viejos agotados
    ELSE (RANDOM() * 100)::INT
  END),
  'aprobado',
  mp.precio_unitario * (0.9 + RANDOM() * 0.2),  -- variación ±10%
  fecha::DATE,
  fecha
FROM productos mp
CROSS JOIN generate_series('2022-01-15'::TIMESTAMP, '2026-04-15'::TIMESTAMP, '45 days'::INTERVAL) AS fecha
WHERE mp.tipo = 'materia_prima'
ON CONFLICT DO NOTHING;

-- Stock moves de entrada (para cada lote creado arriba)
INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, motivo, created_at)
SELECT
  l.producto_id, l.id, 'entrada', l.cantidad_inicial, 0, l.cantidad_inicial,
  'Entrada proveedor', l.created_at
FROM lotes l
WHERE l.lote_interno LIKE 'LH-%' AND l.estado = 'aprobado';

-- ── ORDENES DE PRODUCCIÓN (fabricación) — ~800 órdenes en 5 años ──
INSERT INTO ordenes_produccion (receta_id, cantidad_planificada, fecha_planificada, estado, cliente, notas, created_at, updated_at)
SELECT
  r.id,
  CASE
    WHEN r.nombre LIKE '%D2%' THEN (500 + (RANDOM() * 1000)::INT)
    WHEN r.nombre LIKE '%Rápida%' THEN (300 + (RANDOM() * 700)::INT)
    WHEN r.nombre LIKE '%PSA%' THEN (200 + (RANDOM() * 500)::INT)
    ELSE 500
  END,
  fecha::DATE,
  'completada',
  (ARRAY['Gullon SA', 'Bricomart Ibérica', 'Packaging Solutions SL', 'Maderas del Sur', 'Industrias Laminados SA', NULL, NULL])[1 + (RANDOM() * 6)::INT],
  NULL,
  fecha,
  fecha + INTERVAL '2 hours'
FROM recetas r
CROSS JOIN generate_series('2022-02-01'::TIMESTAMP, '2026-04-20'::TIMESTAMP, '6 days'::INTERVAL) AS fecha
WHERE r.tipo_receta = 'fabricacion' AND r.activa = TRUE
ON CONFLICT DO NOTHING;

-- ── PEDIDOS — ~1500 pedidos en 5 años ────────────────────────
INSERT INTO pedidos (cliente_id, cliente_nombre, producto_id, cantidad, unidad_medida, estado, fecha_entrega, origen, notas, subtotal, total, created_at, updated_at)
SELECT
  c.id,
  c.nombre,
  p.id,
  CASE
    WHEN p.tipo = 'producto_envasado' THEN (10 + (RANDOM() * 200)::INT)
    ELSE (100 + (RANDOM() * 900)::INT)
  END,
  p.unidad_medida,
  (ARRAY['completado', 'completado', 'completado', 'completado', 'confirmado', 'nuevo'])[1 + (RANDOM() * 5)::INT],
  (fecha + INTERVAL '7 days')::DATE,
  CASE WHEN RANDOM() > 0.7 THEN 'email' ELSE 'manual' END,
  NULL,
  CASE WHEN p.tipo = 'producto_envasado' THEN (RANDOM() * 500 + 50)::NUMERIC(10,2) ELSE (RANDOM() * 5000 + 200)::NUMERIC(10,2) END,
  CASE WHEN p.tipo = 'producto_envasado' THEN (RANDOM() * 600 + 60)::NUMERIC(10,2) ELSE (RANDOM() * 6000 + 240)::NUMERIC(10,2) END,
  fecha,
  CASE WHEN RANDOM() > 0.3 THEN fecha + INTERVAL '3 days' ELSE fecha END
FROM (
  SELECT fecha FROM generate_series('2022-01-10'::TIMESTAMP, '2026-04-20'::TIMESTAMP, '1 day'::INTERVAL) AS fecha
  WHERE EXTRACT(DOW FROM fecha) BETWEEN 1 AND 5  -- solo días laborables
    AND RANDOM() < 0.35  -- ~35% de días tienen pedido
) fechas
CROSS JOIN LATERAL (
  SELECT id, nombre FROM clientes WHERE activo = TRUE ORDER BY RANDOM() LIMIT 1
) c
CROSS JOIN LATERAL (
  SELECT id, tipo, unidad_medida FROM productos
  WHERE tipo IN ('producto_fabricado', 'producto_envasado') AND activo = TRUE
  ORDER BY RANDOM() LIMIT 1
) p
ON CONFLICT DO NOTHING;

-- ── STOCK MOVES de producción (consumo simulado) ─────────────
-- Para cada orden completada, crear stock_moves de consumo
INSERT INTO stock_moves (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, motivo, created_at)
SELECT
  mp.id,
  'produccion_consumo',
  -(ir.cantidad * op.cantidad_planificada / r.rendimiento),
  100,
  100 - (ir.cantidad * op.cantidad_planificada / r.rendimiento),
  op.id,
  'Consumo fabricación ' || op.id::TEXT,
  op.created_at
FROM ordenes_produccion op
JOIN recetas r ON r.id = op.receta_id
JOIN ingredientes_receta ir ON ir.receta_id = r.id
JOIN productos mp ON mp.id = ir.materia_prima_id
WHERE op.estado = 'completada'
  AND op.created_at < '2026-04-01'  -- no las más recientes
ON CONFLICT DO NOTHING;

-- Stock moves de salida (producción → producto terminado)
INSERT INTO stock_moves (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, motivo, created_at)
SELECT
  r.producto_id,
  'produccion_salida',
  op.cantidad_planificada,
  0,
  op.cantidad_planificada,
  op.id,
  'Producción ' || op.id::TEXT,
  op.created_at + INTERVAL '1 hour'
FROM ordenes_produccion op
JOIN recetas r ON r.id = op.receta_id
WHERE op.estado = 'completada'
  AND op.created_at < '2026-04-01'
ON CONFLICT DO NOTHING;

-- ── VENTAS (stock_moves de salida por pedidos completados) ───
INSERT INTO stock_moves (producto_id, tipo, cantidad, cantidad_antes, cantidad_despues, motivo, created_at)
SELECT
  pd.producto_id,
  'salida',
  -pd.cantidad,
  pd.cantidad + 100,
  100,
  'Pedido ' || pd.numero_pedido,
  pd.updated_at
FROM pedidos pd
WHERE pd.estado = 'completado' AND pd.producto_id IS NOT NULL AND pd.cantidad > 0
  AND pd.created_at < '2026-04-01'
ON CONFLICT DO NOTHING;

-- ── HISTORIAL DE PRECIOS (variaciones a lo largo de 5 años) ──
INSERT INTO historial_precios (producto_id, tipo, precio_anterior, precio_nuevo, motivo, created_at)
SELECT
  p.id,
  'compra',
  p.precio_unitario * (0.85 + (RANDOM() * 0.15)),
  p.precio_unitario * (0.95 + (RANDOM() * 0.1)),
  'Actualización precio proveedor',
  fecha
FROM productos p
CROSS JOIN generate_series('2022-06-01'::TIMESTAMP, '2026-03-01'::TIMESTAMP, '90 days'::INTERVAL) AS fecha
WHERE p.tipo = 'materia_prima'
ON CONFLICT DO NOTHING;

-- ── LOGIN LOGS (simular accesos) ─────────────────────────────
INSERT INTO login_logs (usuario_id, email, ip, user_agent, exito, created_at)
SELECT
  u.id,
  u.email,
  '192.168.1.' || (10 + (RANDOM() * 240)::INT),
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/' || (90 + (RANDOM() * 30)::INT) || '.0',
  RANDOM() > 0.05,  -- 95% éxito
  fecha
FROM usuarios u
CROSS JOIN generate_series('2022-01-02'::TIMESTAMP, '2026-04-23'::TIMESTAMP, '8 hours'::INTERVAL) AS fecha
WHERE RANDOM() < 0.15
ON CONFLICT DO NOTHING;

-- ── SINCRONIZAR STOCK DE TODOS LOS PRODUCTOS ─────────────────
UPDATE productos p SET stock_actual = (
  SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l
  WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
);

-- Fin seed

-- Verificar
SELECT 'clientes' AS tabla, COUNT(*) FROM clientes
UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos
UNION ALL SELECT 'ordenes_produccion', COUNT(*) FROM ordenes_produccion
UNION ALL SELECT 'lotes', COUNT(*) FROM lotes
UNION ALL SELECT 'stock_moves', COUNT(*) FROM stock_moves
UNION ALL SELECT 'historial_precios', COUNT(*) FROM historial_precios
UNION ALL SELECT 'login_logs', COUNT(*) FROM login_logs
ORDER BY 1;
