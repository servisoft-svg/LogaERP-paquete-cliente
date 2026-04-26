import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db/pool';

describe('Produccion Service', () => {
  let testProductoId: string;
  let testRecetaId: string;
  let testLoteId: string;

  beforeAll(async () => {
    // Create test product (materia prima)
    const { rows: [mp] } = await pool.query(
      `INSERT INTO productos (codigo, nombre, tipo, unidad_medida, stock_minimo)
       VALUES ('TEST-MP-001', 'Test Materia Prima', 'materia_prima', 'kg', 10)
       RETURNING id`
    );

    // Create test product (producto terminado)
    const { rows: [pt] } = await pool.query(
      `INSERT INTO productos (codigo, nombre, tipo, unidad_medida)
       VALUES ('TEST-PT-001', 'Test Producto Terminado', 'producto_terminado', 'kg')
       RETURNING id`
    );
    testProductoId = pt.id;

    // Create test lot with stock
    const { rows: [lote] } = await pool.query(
      `INSERT INTO lotes (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, fecha_entrada)
       VALUES ($1, 'TEST-LOTE-001', 1000, 1000, 'aprobado', CURRENT_DATE)
       RETURNING id`,
      [mp.id]
    );
    testLoteId = lote.id;

    // Set stock
    await pool.query(`UPDATE productos SET stock_actual = 1000 WHERE id = $1`, [mp.id]);

    // Create recipe
    const { rows: [receta] } = await pool.query(
      `INSERT INTO recetas (producto_id, nombre, version, rendimiento)
       VALUES ($1, 'Test Receta', 1, 100)
       RETURNING id`,
      [pt.id]
    );
    testRecetaId = receta.id;

    // Add ingredient
    await pool.query(
      `INSERT INTO ingredientes_receta (receta_id, materia_prima_id, cantidad, porcentaje_merma, unidad_medida)
       VALUES ($1, $2, 50, 0, 'kg')`,
      [receta.id, mp.id]
    );
  });

  afterAll(async () => {
    // Clean up in correct order (respect FK constraints)
    await pool.query(`DELETE FROM stock_moves WHERE motivo LIKE 'Test%' OR motivo LIKE '%TEST%'`);
    await pool.query(`DELETE FROM ordenes_produccion WHERE receta_id = $1`, [testRecetaId]);
    await pool.query(`DELETE FROM ingredientes_receta WHERE receta_id = $1`, [testRecetaId]);
    await pool.query(`DELETE FROM recetas WHERE id = $1`, [testRecetaId]);
    await pool.query(`DELETE FROM lotes WHERE lote_interno LIKE 'TEST-%'`);
    await pool.query(`DELETE FROM productos WHERE codigo LIKE 'TEST-%'`);
    await pool.end();
  });

  it('debe crear una orden de produccion', async () => {
    const { rows: [orden] } = await pool.query(
      `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada)
       VALUES ($1, 100) RETURNING *`,
      [testRecetaId]
    );
    expect(orden).toBeDefined();
    expect(orden.numero_orden).toMatch(/^OP-/);
    expect(orden.estado).toBe('borrador');
    expect(parseFloat(orden.cantidad_planificada)).toBe(100);
  });

  it('stock debe ser positivo', async () => {
    const { rows: [mp] } = await pool.query(
      `SELECT stock_actual FROM productos WHERE codigo = 'TEST-MP-001'`
    );
    expect(parseFloat(mp.stock_actual)).toBeGreaterThan(0);
  });

  it('lote FIFO debe tener stock disponible', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM lotes WHERE lote_interno = 'TEST-LOTE-001' AND estado = 'aprobado' AND cantidad_actual > 0`
    );
    expect(rows.length).toBe(1);
    expect(parseFloat(rows[0].cantidad_actual)).toBe(1000);
  });

  it('no debe crear orden con cantidad <= 0', async () => {
    try {
      await pool.query(
        `INSERT INTO ordenes_produccion (receta_id, cantidad_planificada) VALUES ($1, 0)`,
        [testRecetaId]
      );
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.message).toContain('check');
    }
  });

  it('notificaciones no deben tener duplicados por producto', async () => {
    const { rows } = await pool.query(`
      SELECT producto_id, tipo, COUNT(*) as cnt
      FROM notificaciones
      WHERE leida = FALSE
      GROUP BY producto_id, tipo
      HAVING COUNT(*) > 1
    `);
    expect(rows.length).toBe(0);
  });
});
