-- ============================================================
-- ERP LOGA — Seed de datos
-- Productos, recetas y datos de prueba para cola blanca
-- Ejecutar DESPUÉS de schema.sql
-- ============================================================

BEGIN;

-- ============================================================
-- PROVEEDORES adicionales
-- ============================================================
INSERT INTO proveedores (id, nombre, email, telefono, direccion) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Celanese Ibérica S.L.',      'pedidos@celanese.es',     '+34 915 100 001', 'Pol. Ind. Norte, Madrid'),
    ('a1000000-0000-0000-0000-000000000002', 'Kuraray Europe GmbH',        'sales@kuraray.es',        '+34 932 200 002', 'Barcelona'),
    ('a1000000-0000-0000-0000-000000000003', 'Brenntag Química S.A.',      'ventas@brenntag.es',      '+34 916 300 003', 'Alcobendas, Madrid'),
    ('a1000000-0000-0000-0000-000000000004', 'Air Liquide España S.A.',    'industrial@airliquide.es','+34 917 400 004', 'Madrid'),
    ('a1000000-0000-0000-0000-000000000005', 'Fardis Embalajes S.L.',      'compras@fardis.es',       '+34 943 500 005', 'Irún, Guipúzcoa');


-- ============================================================
-- MATERIAS PRIMAS
-- ============================================================
INSERT INTO productos (id, codigo, nombre, descripcion, tipo, unidad_medida, stock_actual, stock_minimo, stock_maximo, precio_unitario, proveedor_id) VALUES

-- Base química cola blanca (VAc emulsion)
('b1000000-0000-0000-0000-000000000001', 'MP-001', 'Acetato de Vinilo (VAM)',
    'Monómero principal para polimerización. Pureza ≥99,5%. Inflamable, almacenar <25°C.',
    'materia_prima', 'kg', 2500.000000, 500.000000, 5000.000000, 1.85,
    'a1000000-0000-0000-0000-000000000001'),

('b1000000-0000-0000-0000-000000000002', 'MP-002', 'PVOH Mowiol 4-88 (Alcohol Polivinílico)',
    'Coloide protector, grado parcialmente hidrolizado 88%. Fundamental para estabilidad de emulsión.',
    'materia_prima', 'kg', 800.000000, 200.000000, 1500.000000, 4.20,
    'a1000000-0000-0000-0000-000000000002'),

('b1000000-0000-0000-0000-000000000003', 'MP-003', 'PVOH Mowiol 20-98 (Alcohol Polivinílico HV)',
    'Coloide protector alta viscosidad, grado 98% hidrolizado. Para recetas de alta resistencia.',
    'materia_prima', 'kg', 300.000000, 100.000000, 800.000000, 5.10,
    'a1000000-0000-0000-0000-000000000002'),

('b1000000-0000-0000-0000-000000000004', 'MP-004', 'Agua Desmineralizada',
    'Agua tratada por ósmosis inversa. Conductividad <5 μS/cm. Producción interna.',
    'materia_prima', 'kg', 10000.000000, 2000.000000, 20000.000000, 0.05,
    NULL),

('b1000000-0000-0000-0000-000000000005', 'MP-005', 'Persulfato Amónico',
    'Iniciador de polimerización radical. Pureza ≥98%. Almacenar en frío y seco.',
    'materia_prima', 'kg', 120.000000, 30.000000, 300.000000, 3.60,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000006', 'MP-006', 'Acetato Sódico (Buffer)',
    'Regulador de pH. Mantiene pH 4,5-5,5 durante polimerización.',
    'materia_prima', 'kg', 200.000000, 50.000000, 400.000000, 0.95,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000007', 'MP-007', 'DBP (Dibutilftalato) Plastificante',
    'Plastificante para mejorar flexibilidad película seca. ECHA: revisar sustitución.',
    'materia_prima', 'kg', 450.000000, 100.000000, 800.000000, 2.30,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000008', 'MP-008', 'Antiespumante Tego Antifoam 1488',
    'Silicona antiespumante de alta eficacia. Dosis 0,1-0,3 % sobre producto.',
    'materia_prima', 'kg', 80.000000, 20.000000, 150.000000, 9.80,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000009', 'MP-009', 'Ácido Acético Glacial (Ajuste pH)',
    'Corrección de pH final. Pureza ≥99%. Corrosivo.',
    'materia_prima', 'kg', 100.000000, 25.000000, 200.000000, 1.10,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000010', 'MP-010', 'Proxel GXL (Conservante Biocida)',
    'Preservante para estabilidad microbiológica. BPR conforme. Dosis 0,05-0,15%.',
    'materia_prima', 'kg', 30.000000, 10.000000, 80.000000, 28.50,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000011', 'MP-011', 'Ácido Bórico (Reticulante)',
    'Reticulante para cola blanca autoadhesiva PSA. Aumenta resistencia en caliente.',
    'materia_prima', 'kg', 60.000000, 15.000000, 150.000000, 1.80,
    'a1000000-0000-0000-0000-000000000003'),

('b1000000-0000-0000-0000-000000000012', 'MP-012', 'Rosin Éster (Resina Tackificante)',
    'Resina de colofonia esterificada. Aumenta adhesividad en formulaciones PSA.',
    'materia_prima', 'kg', 200.000000, 50.000000, 500.000000, 3.40,
    'a1000000-0000-0000-0000-000000000003'),

-- Materiales de embalaje
('b1000000-0000-0000-0000-000000000020', 'ME-001', 'Garrafa HDPE 10 L con tapón',
    'Envase para producto terminado. Homologado ONU para líquidos.',
    'material_embalaje', 'ud', 500.000000, 100.000000, 1000.000000, 1.25,
    'a1000000-0000-0000-0000-000000000005'),

('b1000000-0000-0000-0000-000000000021', 'ME-002', 'Bote PET 1 kg con tapón seguridad',
    'Envase para producto terminado 1 kg.',
    'material_embalaje', 'ud', 1000.000000, 200.000000, 2000.000000, 0.38,
    'a1000000-0000-0000-0000-000000000005'),

('b1000000-0000-0000-0000-000000000022', 'ME-003', 'Bidón HDPE 25 kg',
    'Envase industrial para cola blanca a granel.',
    'material_embalaje', 'ud', 200.000000, 50.000000, 400.000000, 3.90,
    'a1000000-0000-0000-0000-000000000005'),

('b1000000-0000-0000-0000-000000000023', 'ME-004', 'Etiqueta adhesiva producto terminado',
    'Etiqueta impresa con código QR y ficha de seguridad. 10x6 cm.',
    'material_embalaje', 'ud', 3000.000000, 500.000000, 6000.000000, 0.04,
    'a1000000-0000-0000-0000-000000000005');


-- ============================================================
-- PRODUCTOS TERMINADOS
-- (de la lista real de Loga)
-- ============================================================
INSERT INTO productos (id, codigo, nombre, descripcion, tipo, unidad_medida, stock_actual, stock_minimo, stock_maximo, precio_unitario) VALUES

('c1000000-0000-0000-0000-000000000001', 'PT-CB-001', 'Cola Blanca Estándar D2',
    'Adhesivo vinílico de emulsión. Tiempo abierto 5-8 min. Conforme EN 204 D2. Envase 10 L y 25 kg.',
    'producto_terminado', 'kg', 850.000000, 200.000000, 2000.000000, 2.80),

('c1000000-0000-0000-0000-000000000002', 'PT-CB-002', 'Cola Blanca Rápida D2',
    'Adhesivo vinílico fraguado rápido. Tiempo abierto 2-3 min. Mayor contenido en sólidos. EN 204 D2.',
    'producto_terminado', 'kg', 420.000000, 100.000000, 1200.000000, 3.20),

('c1000000-0000-0000-0000-000000000003', 'PT-CB-003', 'Cola Blanca Autoadhesiva',
    'Adhesivo vinílico PSA con reticulante. Adhesión permanente en frío. Artes gráficas.',
    'producto_terminado', 'kg', 180.000000, 50.000000, 600.000000, 5.40),

('c1000000-0000-0000-0000-000000000004', 'PT-CA-001', 'Cola Amarilla D2',
    'Emulsión PVAc con carga mineral. Color amarillo ámbar. Alta rigidez. Madera. EN 204 D2.',
    'producto_terminado', 'kg', 310.000000, 80.000000, 800.000000, 3.05),

('c1000000-0000-0000-0000-000000000005', 'PT-CB-004', 'Cola Blanca Cola Tinte 1 kg',
    'Cola blanca pigmentable base agua. Para teñido decorativo. Bote 1 kg.',
    'producto_terminado', 'kg', 95.000000, 30.000000, 300.000000, 4.10);


-- ============================================================
-- RECETA 1: Cola Blanca Estándar D2 — batch 1.000 kg
-- ============================================================
INSERT INTO recetas (id, producto_id, nombre, version, rendimiento, notas) VALUES
(
    'd1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    'Cola Blanca Estándar D2 — v1',
    1,
    1000.000000,  -- rendimiento: 1.000 kg de producto terminado por batch
    'Reactor 2.000 L. Temperatura polimerización 75-80°C. Añadir VAM en dosificación controlada 2h. pH final 4,8-5,2. Sólidos: 50±1%. Viscosidad Brookfield 20.000-30.000 mPas.'
);

-- Ingredientes Receta 1 (proporciones sobre 1.000 kg producto)
INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida) VALUES
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 480.000000, 0.50, 'kg'),  -- VAM 48%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 440.000000, 0.00, 'kg'),  -- Agua 44%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',  36.000000, 0.20, 'kg'),  -- PVOH 4-88 3,6%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005',   2.400000, 0.10, 'kg'),  -- Persulfato 0,24%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000006',   1.600000, 0.00, 'kg'),  -- Acetato Na 0,16%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007',  30.000000, 0.10, 'kg'),  -- DBP 3%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000008',   0.800000, 0.00, 'kg'),  -- Antiespumante 0,08%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000009',   0.600000, 0.00, 'kg'),  -- Ác. Acético 0,06%
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000010',   0.600000, 0.00, 'kg');  -- Proxel 0,06%


-- ============================================================
-- RECETA 2: Cola Blanca Rápida D2 — batch 1.000 kg
-- ============================================================
INSERT INTO recetas (id, producto_id, nombre, version, rendimiento, notas) VALUES
(
    'd1000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000002',
    'Cola Blanca Rápida D2 — v1',
    1,
    1000.000000,
    'Mayor contenido sólidos (55%). PVOH HV para viscosidad alta. Dosificación VAM más rápida (90 min). Temp. 78-82°C. Viscosidad objetivo 40.000-60.000 mPas.'
);

INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida) VALUES
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 520.000000, 0.50, 'kg'),  -- VAM 52%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000004', 380.000000, 0.00, 'kg'),  -- Agua 38%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',  28.000000, 0.20, 'kg'),  -- PVOH 4-88 2,8%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003',  20.000000, 0.20, 'kg'),  -- PVOH 20-98 2%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005',   2.800000, 0.10, 'kg'),  -- Persulfato 0,28%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006',   1.800000, 0.00, 'kg'),  -- Acetato Na 0,18%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007',  35.000000, 0.10, 'kg'),  -- DBP 3,5%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000008',   1.000000, 0.00, 'kg'),  -- Antiespumante 0,1%
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000009',   0.700000, 0.00, 'kg'),  -- Ác. Acético
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000010',   0.700000, 0.00, 'kg');  -- Proxel


-- ============================================================
-- RECETA 3: Cola Blanca Autoadhesiva PSA — batch 500 kg
-- ============================================================
INSERT INTO recetas (id, producto_id, nombre, version, rendimiento, notas) VALUES
(
    'd1000000-0000-0000-0000-000000000003',
    'c1000000-0000-0000-0000-000000000003',
    'Cola Blanca Autoadhesiva PSA — v1',
    1,
    500.000000,
    'Batch 500 kg (reactor pequeño). Incorporar resina tackificante al 5% al final. Reticular con ác. bórico 0,3%. Tg objetivo -15°C. Peel 90°: >10 N/25mm. Artes gráficas y encuadernación.'
);

INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida) VALUES
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 230.000000, 0.50, 'kg'),  -- VAM 46%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000004', 195.000000, 0.00, 'kg'),  -- Agua 39%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002',  15.000000, 0.20, 'kg'),  -- PVOH 4-88 3%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000005',   1.200000, 0.10, 'kg'),  -- Persulfato
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000006',   0.800000, 0.00, 'kg'),  -- Acetato Na
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000007',  15.000000, 0.10, 'kg'),  -- DBP 3%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000012',  25.000000, 0.20, 'kg'),  -- Resina tackif. 5%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000011',   1.500000, 0.05, 'kg'),  -- Ác. Bórico 0,3%
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008',   0.400000, 0.00, 'kg'),  -- Antiespumante
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009',   0.350000, 0.00, 'kg'),  -- Ác. Acético
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000010',   0.250000, 0.00, 'kg');  -- Proxel


-- ============================================================
-- LOTES — Materias primas en almacén (estado: aprobado)
-- ============================================================
INSERT INTO lotes (id, producto_id, lote_interno, lote_proveedor, cantidad_inicial, cantidad_actual,
                   fecha_fabricacion, fecha_caducidad, fecha_entrada, estado, ubicacion) VALUES

('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
    'LMP-2026-001', 'CEL-VAM-260301', 2500.000000, 2500.000000,
    '2026-03-01', '2026-09-01', '2026-03-05', 'aprobado', 'Almacén Químico — Área Inflamables'),

('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',
    'LMP-2026-002', 'KUR-PVOH488-260210', 800.000000, 800.000000,
    '2026-02-10', '2028-02-10', '2026-02-15', 'aprobado', 'Almacén Seco — Estantería A1'),

('e1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003',
    'LMP-2026-003', 'KUR-PVOH2098-260210', 300.000000, 300.000000,
    '2026-02-10', '2028-02-10', '2026-02-15', 'aprobado', 'Almacén Seco — Estantería A2'),

('e1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004',
    'LMP-2026-004', NULL, 10000.000000, 10000.000000,
    '2026-04-18', NULL, '2026-04-18', 'aprobado', 'Depósito Agua Desmineralizada'),

('e1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005',
    'LMP-2026-005', 'BRE-PS-260315', 120.000000, 120.000000,
    '2026-03-15', '2027-03-15', '2026-03-20', 'aprobado', 'Almacén Seco — Frigorífico'),

('e1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000007',
    'LMP-2026-006', 'BRE-DBP-260201', 450.000000, 450.000000,
    '2026-02-01', '2028-02-01', '2026-02-08', 'aprobado', 'Almacén Químico — Área General'),

('e1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000008',
    'LMP-2026-007', 'TEGO-AF1488-260101', 80.000000, 80.000000,
    '2026-01-01', '2028-01-01', '2026-01-10', 'aprobado', 'Almacén Químico — Estantería B3'),

('e1000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000012',
    'LMP-2026-008', 'BRE-ROSIN-260301', 200.000000, 200.000000,
    '2026-03-01', '2027-09-01', '2026-03-10', 'aprobado', 'Almacén Seco — Estantería B1');


-- ============================================================
-- LOTES — Productos terminados en almacén
-- ============================================================
INSERT INTO lotes (id, producto_id, lote_interno, cantidad_inicial, cantidad_actual,
                   fecha_fabricacion, fecha_caducidad, fecha_entrada, estado, ubicacion) VALUES

('e1000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000001',
    'LPT-2026-001', 850.000000, 850.000000,
    '2026-04-01', '2028-04-01', '2026-04-01', 'aprobado', 'Almacén PT — Zona CB Estándar'),

('e1000000-0000-0000-0000-000000000011', 'c1000000-0000-0000-0000-000000000002',
    'LPT-2026-002', 420.000000, 420.000000,
    '2026-04-05', '2028-04-05', '2026-04-05', 'aprobado', 'Almacén PT — Zona CB Rápida'),

('e1000000-0000-0000-0000-000000000012', 'c1000000-0000-0000-0000-000000000003',
    'LPT-2026-003', 180.000000, 180.000000,
    '2026-04-10', '2027-10-10', '2026-04-10', 'aprobado', 'Almacén PT — Zona PSA');


-- ============================================================
-- STOCK MOVES — Entradas iniciales de materias primas
-- (registra el stock inicial como movimiento de entrada)
-- ============================================================
INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues,
                          referencia_externa, motivo) VALUES

('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
    'entrada', 2500.000000, 0.000000, 2500.000000,
    'ALBA-2026-0312', 'Compra inicial VAM — pedido Q1 2026'),

('b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002',
    'entrada', 800.000000, 0.000000, 800.000000,
    'ALBA-2026-0210', 'Compra inicial PVOH 4-88'),

('b1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003',
    'entrada', 300.000000, 0.000000, 300.000000,
    'ALBA-2026-0210', 'Compra inicial PVOH 20-98'),

('b1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004',
    'entrada', 10000.000000, 0.000000, 10000.000000,
    'PROD-INTERNO', 'Producción agua desmineralizada planta'),

('b1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005',
    'entrada', 120.000000, 0.000000, 120.000000,
    'ALBA-2026-0322', 'Compra persulfato amónico Q1 2026'),

('b1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000006',
    'entrada', 450.000000, 0.000000, 450.000000,
    'ALBA-2026-0208', 'Compra plastificante DBP'),

('b1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-000000000007',
    'entrada', 80.000000, 0.000000, 80.000000,
    'ALBA-2026-0110', 'Compra antiespumante anual'),

('b1000000-0000-0000-0000-000000000012', 'e1000000-0000-0000-0000-000000000008',
    'entrada', 200.000000, 0.000000, 200.000000,
    'ALBA-2026-0310', 'Compra resina tackificante PSA');


-- ============================================================
-- STOCK MOVES — Salidas de PT (simulan ventas recientes)
-- ============================================================
INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues,
                          referencia_externa, motivo) VALUES

-- Venta CB Estándar
('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000010',
    'salida', -150.000000, 1000.000000, 850.000000,
    'ALB-CLI-2026-0412', 'Entrega cliente Encuadernaciones García'),

-- Venta CB Rápida
('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000011',
    'salida', -80.000000, 500.000000, 420.000000,
    'ALB-CLI-2026-0415', 'Entrega cliente Artes Gráficas Martín');


-- ============================================================
-- ÓRDENES DE PRODUCCIÓN — 2 órdenes completadas + 1 planificada
-- ============================================================
INSERT INTO ordenes_produccion (id, numero_orden, receta_id, cantidad_planificada, cantidad_producida,
                                  estado, lote_producido_id, fecha_planificada, fecha_inicio, fecha_fin, notas) VALUES

('f1000000-0000-0000-0000-000000000001',
    'OP-2026-00001',
    'd1000000-0000-0000-0000-000000000001',
    1000.000000, 1000.000000,
    'completada',
    'e1000000-0000-0000-0000-000000000010',
    '2026-04-01', '2026-04-01 07:00:00+02', '2026-04-01 18:30:00+02',
    'Batch Q1. Control pH final: 5,0. Sólidos: 50,3%. Viscosidad: 24.500 mPas. Aprobado QC.'),

('f1000000-0000-0000-0000-000000000002',
    'OP-2026-00002',
    'd1000000-0000-0000-0000-000000000002',
    1000.000000, 1000.000000,
    'completada',
    'e1000000-0000-0000-0000-000000000011',
    '2026-04-05', '2026-04-05 07:00:00+02', '2026-04-05 17:00:00+02',
    'Batch CB Rápida. Viscosidad: 48.200 mPas. pH: 4,9. Aprobado QC.'),

('f1000000-0000-0000-0000-000000000003',
    'OP-2026-00003',
    'd1000000-0000-0000-0000-000000000003',
    500.000000, 0.000000,
    'confirmada',
    NULL,
    '2026-04-22', NULL, NULL,
    'Planificada semana próxima. Revisar stock resina tackificante antes de iniciar.');


COMMIT;
