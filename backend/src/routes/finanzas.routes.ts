import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

let resumenCache: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute — short because invalidated on mutations

/** Call this to force refresh on next request */
export function invalidarCacheFinanzas() { resumenCache = null; }

// GET /api/finanzas/resumen
router.get('/resumen', async (_req, res) => {
  try {
    if (resumenCache && Date.now() - resumenCache.timestamp < CACHE_TTL) {
      return res.json(resumenCache.data);
    }
    // 1. Rentabilidad — cálculo recursivo real:
    //    Envasado: receta envasado (cola granel × peso + envase + etiqueta)
    //    Cola granel: su coste viene de receta fabricación (MP × CMP de lotes)
    //    MP: CMP = coste medio ponderado real de los lotes en stock

    // Pre-load ALL CMPs in one query (avoid N+1)
    const { rows: allCmps } = await pool.query(`
      SELECT p.id,
        COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario, 0) AS cmp
      FROM productos p WHERE p.activo = true
    `);
    const cmpMap: Record<string, number> = {};
    for (const r of allCmps) cmpMap[r.id] = parseFloat(r.cmp ?? '0');
    function getCMP(productoId: string): number {
      return cmpMap[productoId] ?? 0;
    }

    // Cálculo recursivo de coste con desglose completo
    // FIFO: usa precio del lote más antiguo con stock (el que usaría primero)
    // Fabricación: coste_batch / rendimiento = coste por kg
    // Envasado: cola granel (recursivo) + envase + etiqueta
    interface DesgloseItem { nombre: string; cantidad: number; unidad: string; precio_ud: number; coste_linea: number }
    interface CosteResult { coste_ud: number; coste_batch: number; rendimiento: number; desglose: DesgloseItem[] }
    const costeCache: Record<string, CosteResult> = {};

    async function calcularCosteProducto(productoId: string): Promise<CosteResult> {
      if (costeCache[productoId]) return costeCache[productoId];

      const { rows: [receta] } = await pool.query(
        `SELECT id, rendimiento, tipo_receta FROM recetas WHERE producto_id = $1 AND activa = TRUE ORDER BY version DESC LIMIT 1`,
        [productoId]
      );

      if (!receta) {
        const c = getCMP(productoId);
        const r: CosteResult = { coste_ud: c, coste_batch: c, rendimiento: 1, desglose: [] };
        costeCache[productoId] = r;
        return r;
      }

      const { rows: ingredientes } = await pool.query(
        `SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id, p.nombre, p.tipo, p.unidad_medida
         FROM ingredientes_receta ir
         JOIN productos p ON p.id = ir.materia_prima_id
         WHERE ir.receta_id = $1`, [receta.id]
      );

      let costeBatch = 0;
      const desglose: DesgloseItem[] = [];

      for (const ing of ingredientes) {
        const cantReal = parseFloat(ing.cantidad) * (1 + parseFloat(ing.porcentaje_merma) / 100);
        let precioUd: number;

        if (ing.tipo === 'producto_fabricado') {
          const sub = await calcularCosteProducto(ing.materia_prima_id);
          precioUd = sub.coste_ud;
        } else {
          precioUd = getCMP(ing.materia_prima_id);
        }

        const costeLinea = cantReal * precioUd;
        costeBatch += costeLinea;
        desglose.push({
          nombre: ing.nombre,
          cantidad: Math.round(cantReal * 10000) / 10000,
          unidad: ing.unidad_medida,
          precio_ud: Math.round(precioUd * 10000) / 10000,
          coste_linea: Math.round(costeLinea * 10000) / 10000,
        });
      }

      const rendimiento = parseFloat(receta.rendimiento);
      const costeUd = rendimiento > 0 ? costeBatch / rendimiento : costeBatch;
      const r: CosteResult = {
        coste_ud: Math.round(costeUd * 10000) / 10000,
        coste_batch: Math.round(costeBatch * 10000) / 10000,
        rendimiento,
        desglose,
      };
      costeCache[productoId] = r;
      return r;
    }

    // Calcular rentabilidad de todos los productos vendibles
    const { rows: ptProducts } = await pool.query(`
      SELECT p.id, p.codigo, p.nombre, p.tipo, p.precio_venta, p.precio_unitario, p.stock_actual, p.unidad_medida
      FROM productos p WHERE p.tipo IN ('producto_terminado', 'producto_fabricado', 'producto_envasado')
        AND p.activo = TRUE AND p.precio_venta > 0
    `);

    const rentabilidad = [];
    for (const pt of ptProducts) {
      const resultado = await calcularCosteProducto(pt.id);
      const precioVenta = parseFloat(pt.precio_venta ?? '0');
      const margen = precioVenta > 0 ? ((precioVenta - resultado.coste_ud) / precioVenta * 100) : 0;
      const esFabricado = pt.tipo === 'producto_fabricado';
      rentabilidad.push({
        id: pt.id, codigo: pt.codigo, nombre: pt.nombre, tipo: pt.tipo,
        precio_venta: precioVenta,
        precio_coste: resultado.coste_ud,
        coste_batch: resultado.coste_batch,
        rendimiento: resultado.rendimiento,
        // Granel: precio por kg y por 1000kg
        precio_kg: esFabricado ? resultado.coste_ud : undefined,
        precio_1000kg: esFabricado ? Math.round(resultado.coste_ud * 1000 * 100) / 100 : undefined,
        stock_actual: parseFloat(pt.stock_actual),
        unidad_medida: pt.unidad_medida,
        margen_pct: Math.round(margen * 10) / 10,
        beneficio_ud: Math.round((precioVenta - resultado.coste_ud) * 10000) / 10000,
        desglose: resultado.desglose,
      });
    }
    rentabilidad.sort((a, b) => b.margen_pct - a.margen_pct);

    // 2. Inmovilizado en stock — solo usa precio_compra del lote (precision real)
    const { rows: [inmovilizado] } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN p.tipo = 'materia_prima' THEN l.cantidad_actual * l.precio_compra ELSE 0 END), 0) AS valor_mp,
        COALESCE(SUM(CASE WHEN p.tipo = 'producto_fabricado' THEN l.cantidad_actual * l.precio_compra ELSE 0 END), 0) AS valor_fab,
        COALESCE(SUM(CASE WHEN p.tipo = 'producto_envasado' THEN l.cantidad_actual * l.precio_compra ELSE 0 END), 0) AS valor_env,
        COALESCE(SUM(CASE WHEN p.tipo = 'producto_terminado' THEN l.cantidad_actual * l.precio_compra ELSE 0 END), 0) AS valor_pt,
        COALESCE(SUM(CASE WHEN p.tipo = 'material_embalaje' THEN l.cantidad_actual * l.precio_compra ELSE 0 END), 0) AS valor_emb,
        COALESCE(SUM(l.cantidad_actual * l.precio_compra), 0) AS valor_total
      FROM lotes l
      JOIN productos p ON p.id = l.producto_id
      WHERE p.activo = TRUE AND l.estado = 'aprobado' AND l.cantidad_actual > 0 AND l.precio_compra IS NOT NULL
    `);

    // 3. Inmovilizado detallado (top 10 por valor) — usa CMP real de lotes, no precio_unitario
    const { rows: topInmovilizado } = await pool.query(`
      SELECT p.codigo, p.nombre, p.tipo, p.stock_actual, p.unidad_medida,
             COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario) AS precio_unitario,
             ROUND((p.stock_actual * COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario))::NUMERIC, 2) AS valor
      FROM productos p WHERE p.activo = TRUE AND p.stock_actual > 0
        AND COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario) > 0
      ORDER BY p.stock_actual * COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario) DESC
      LIMIT 10
    `);

    // 4. Ventas (pedidos completados)
    const { rows: [ventas] } = await pool.query(`
      SELECT
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(total::NUMERIC), 0) AS facturacion_total,
        COALESCE(SUM(subtotal::NUMERIC), 0) AS subtotal_total,
        COALESCE(SUM(portes::NUMERIC), 0) AS portes_total
      FROM pedidos WHERE estado = 'completado'
    `);

    // 5. Ventas por mes (ultimos 6 meses)
    const { rows: ventasMes } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', updated_at), 'YYYY-MM') AS mes,
        TO_CHAR(DATE_TRUNC('month', updated_at), 'Mon YY') AS mes_label,
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(total::NUMERIC), 0) AS total
      FROM pedidos WHERE estado = 'completado'
        AND updated_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', updated_at)
      ORDER BY mes ASC
    `);

    // 6. Ventas por producto (top 10)
    const { rows: ventasProducto } = await pool.query(`
      SELECT p.nombre, p.codigo,
        COALESCE(SUM(ABS(sm.cantidad::NUMERIC)), 0) AS cantidad_vendida,
        p.unidad_medida,
        p.precio_venta,
        COALESCE(SUM(ABS(sm.cantidad::NUMERIC) * p.precio_venta), 0) AS facturacion
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      WHERE sm.tipo = 'salida' AND p.tipo IN ('producto_terminado', 'producto_fabricado', 'producto_envasado')
      GROUP BY p.id, p.nombre, p.codigo, p.unidad_medida, p.precio_venta
      ORDER BY facturacion DESC
      LIMIT 10
    `);

    // 7. Coste de produccion total — usa precio real del lote consumido
    const { rows: [costeProd] } = await pool.query(`
      SELECT COUNT(DISTINCT op.id) AS num_ordenes,
        COALESCE(SUM(ABS(sm.cantidad::NUMERIC) * COALESCE(l.precio_compra, p.precio_unitario)), 0) AS coste_total
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      LEFT JOIN lotes l ON l.id = sm.lote_id
      JOIN ordenes_produccion op ON op.id = sm.orden_id
      WHERE sm.tipo = 'produccion_consumo' AND op.estado = 'completada'
    `);

    // 8. Producciones rechazadas/canceladas + lotes rechazados
    const { rows: [rechazos] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ordenes_produccion WHERE estado = 'cancelada') AS ordenes_canceladas,
        COALESCE((SELECT SUM(l.cantidad_inicial * COALESCE(l.precio_compra, p.precio_unitario))
          FROM lotes l JOIN productos p ON p.id = l.producto_id
          WHERE l.estado = 'rechazado'), 0) AS valor_rechazado,
        (SELECT COUNT(*) FROM lotes WHERE estado = 'rechazado') AS lotes_rechazados
    `);

    // 9. Clientes activos con pedidos
    const { rows: [clientesInfo] } = await pool.query(`
      SELECT COUNT(DISTINCT cliente_id) AS clientes_activos
      FROM pedidos WHERE estado = 'completado' AND created_at >= NOW() - INTERVAL '12 months'
    `);

    // 10. Mermas — kg perdidos por producto, valorados en EUR
    const { rows: mermaRows } = await pool.query(`
      SELECT
        op.merma_proceso,
        p.nombre AS producto_nombre,
        p.tipo AS producto_tipo,
        p.unidad_medida,
        COALESCE(NULLIF(p.coste_medio_actual, 0), p.precio_unitario, 0) AS coste_kg,
        p.peso_unitario_kg
      FROM ordenes_produccion op
      JOIN recetas r ON r.id = op.receta_id
      JOIN productos p ON p.id = r.producto_id
      WHERE op.estado = 'completada'
        AND op.merma_proceso IS NOT NULL
        AND op.merma_proceso > 0
    `);
    let merma_total_kg = 0;
    let merma_total_eur = 0;
    let merma_unidades_perdidas = 0;
    for (const m of mermaRows) {
      const kg = parseFloat(m.merma_proceso);
      const costeKg = parseFloat(m.coste_kg);
      const pesoUd = parseFloat(m.peso_unitario_kg ?? '1');
      merma_total_kg += kg;
      merma_total_eur += kg * costeKg;
      if (pesoUd > 0) merma_unidades_perdidas += Math.floor(kg / pesoUd);
    }

    const result = {
      rentabilidad,
      rechazos: {
        ordenes_canceladas: parseInt(rechazos.ordenes_canceladas),
        valor_rechazado: parseFloat(rechazos.valor_rechazado),
        lotes_rechazados: parseInt(rechazos.lotes_rechazados),
      },
      clientes_activos: parseInt(clientesInfo.clientes_activos),
      inmovilizado: {
        valor_mp: parseFloat(inmovilizado.valor_mp),
        valor_fab: parseFloat(inmovilizado.valor_fab),
        valor_env: parseFloat(inmovilizado.valor_env),
        valor_pt: parseFloat(inmovilizado.valor_pt),
        valor_emb: parseFloat(inmovilizado.valor_emb),
        valor_total: parseFloat(inmovilizado.valor_total),
      },
      topInmovilizado,
      ventas: {
        num_pedidos: parseInt(ventas.num_pedidos),
        facturacion_total: parseFloat(ventas.facturacion_total),
        subtotal_total: parseFloat(ventas.subtotal_total),
        portes_total: parseFloat(ventas.portes_total),
      },
      ventasMes,
      ventasProducto,
      costeProd: {
        num_ordenes: parseInt(costeProd.num_ordenes),
        coste_total: parseFloat(costeProd.coste_total),
      },
      mermas: {
        total_kg: Math.round(merma_total_kg * 100) / 100,
        total_eur: Math.round(merma_total_eur * 100) / 100,
        unidades_perdidas: merma_unidades_perdidas,
        num_ordenes: mermaRows.length,
      },
    };
    resumenCache = { data: result, timestamp: Date.now() };
    return res.json(result);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/historial-precios — evolucion de precios de compra/venta
router.get('/historial-precios', async (req, res) => {
  try {
    const { producto_id } = req.query;
    let sql = `
      SELECT hp.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
             p.precio_unitario AS precio_actual_compra, p.precio_venta AS precio_actual_venta
      FROM historial_precios hp
      JOIN productos p ON p.id = hp.producto_id
    `;
    const params: string[] = [];
    if (producto_id) { sql += ` WHERE hp.producto_id = $1`; params.push(String(producto_id)); }
    sql += ` ORDER BY hp.created_at DESC LIMIT 100`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/impacto-costes — impacto de subidas de precio en recetas y materias primas
router.get('/impacto-costes', async (_req, res) => {
  try {
    // 1. Impacto por receta: coste anterior vs coste actual para cada receta activa
    const { rows: recetas } = await pool.query(`
      SELECT r.id, r.nombre AS receta_nombre, r.rendimiento,
             pt.nombre AS producto_nombre, pt.codigo AS producto_codigo,
             pt.precio_venta, pt.unidad_medida
      FROM recetas r
      JOIN productos pt ON pt.id = r.producto_id
      WHERE r.activa = TRUE
    `);

    const impactoRecetas = [];
    for (const receta of recetas) {
      const { rows: ingredientes } = await pool.query(`
        SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id,
               mp.nombre AS mp_nombre, mp.precio_unitario AS precio_actual,
               (SELECT hp.precio_anterior FROM historial_precios hp
                WHERE hp.producto_id = ir.materia_prima_id AND hp.tipo = 'compra'
                AND hp.created_at >= NOW() - INTERVAL '90 days'
                ORDER BY hp.created_at ASC LIMIT 1) AS precio_anterior
        FROM ingredientes_receta ir
        JOIN productos mp ON mp.id = ir.materia_prima_id
        WHERE ir.receta_id = $1
      `, [receta.id]);

      let costeActual = 0;
      let costeAnterior = 0;
      const detalleMP: { nombre: string; cantidad: number; precio_anterior: number | null; precio_actual: number; diff: number }[] = [];

      for (const ing of ingredientes) {
        const cantReal = parseFloat(ing.cantidad) * (1 + parseFloat(ing.porcentaje_merma) / 100);
        const pActual = parseFloat(ing.precio_actual);
        const pAnterior = ing.precio_anterior ? parseFloat(ing.precio_anterior) : pActual;

        costeActual += cantReal * pActual;
        costeAnterior += cantReal * pAnterior;
        detalleMP.push({
          nombre: ing.mp_nombre,
          cantidad: cantReal,
          precio_anterior: ing.precio_anterior ? pAnterior : null,
          precio_actual: pActual,
          diff: (pActual - pAnterior) * cantReal,
        });
      }

      const rendimiento = parseFloat(receta.rendimiento);
      const costePorKgActual = rendimiento > 0 ? costeActual / rendimiento : 0;
      const costePorKgAnterior = rendimiento > 0 ? costeAnterior / rendimiento : 0;
      const precioVenta = parseFloat(receta.precio_venta ?? '0');
      const margenActual = precioVenta > 0 ? ((precioVenta - costePorKgActual) / precioVenta * 100) : 0;
      const margenAnterior = precioVenta > 0 ? ((precioVenta - costePorKgAnterior) / precioVenta * 100) : 0;

      impactoRecetas.push({
        receta_nombre: receta.receta_nombre,
        producto_nombre: receta.producto_nombre,
        producto_codigo: receta.producto_codigo,
        unidad_medida: receta.unidad_medida,
        precio_venta: precioVenta,
        coste_anterior: Math.round(costePorKgAnterior * 10000) / 10000,
        coste_actual: Math.round(costePorKgActual * 10000) / 10000,
        margen_anterior: Math.round(margenAnterior * 10) / 10,
        margen_actual: Math.round(margenActual * 10) / 10,
        diff_coste: Math.round((costePorKgActual - costePorKgAnterior) * 10000) / 10000,
        diff_margen: Math.round((margenActual - margenAnterior) * 10) / 10,
        detalle_mp: detalleMP.filter(d => d.precio_anterior !== null),
      });
    }

    // 2. Materias primas con cambio de precio
    const { rows: materiasPrimas } = await pool.query(`
      WITH precio_anterior AS (
        SELECT DISTINCT ON (hp.producto_id) hp.producto_id, hp.precio_anterior
        FROM historial_precios hp
        WHERE hp.tipo = 'compra' AND hp.created_at >= NOW() - INTERVAL '90 days'
        ORDER BY hp.producto_id, hp.created_at ASC
      )
      SELECT p.id, p.codigo, p.nombre, p.unidad_medida,
        p.precio_unitario AS precio_actual,
        pa.precio_anterior,
        CASE WHEN pa.precio_anterior IS NOT NULL AND pa.precio_anterior > 0
          THEN ROUND(((p.precio_unitario - pa.precio_anterior) / pa.precio_anterior * 100)::NUMERIC, 1)
          ELSE 0 END AS variacion_pct
      FROM productos p
      LEFT JOIN precio_anterior pa ON pa.producto_id = p.id
      WHERE p.tipo = 'materia_prima' AND p.activo = TRUE
      ORDER BY ABS(COALESCE(p.precio_unitario - pa.precio_anterior, 0)) DESC
    `);

    return res.json({ impactoRecetas, materiasPrimas });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/exportar/pedidos — CSV export
router.get('/exportar/pedidos', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pd.numero_pedido, pd.estado, pd.cliente_nombre,
             pd.fecha_entrega, pd.subtotal, pd.portes, pd.iva_porcentaje, pd.total,
             pd.created_at
      FROM pedidos pd ORDER BY pd.created_at DESC LIMIT 50000
    `);
    const BOM = '\uFEFF';
    const headers = ['Numero','Estado','Cliente','Fecha entrega','Subtotal','Portes','IVA %','Total','Creado'];
    const lines = rows.map(r => [
      r.numero_pedido, r.estado, r.cliente_nombre ?? '',
      r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleDateString('es-ES') : '',
      parseFloat(r.subtotal ?? 0).toFixed(2),
      parseFloat(r.portes ?? 0).toFixed(2),
      r.iva_porcentaje ?? '21',
      parseFloat(r.total ?? 0).toFixed(2),
      new Date(r.created_at).toLocaleDateString('es-ES'),
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'));

    const csv = BOM + headers.join(';') + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pedidos.csv"');
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/exportar/produccion — CSV export
router.get('/exportar/produccion', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT op.numero_orden, r.nombre AS receta_nombre, p.nombre AS producto_nombre,
             op.cantidad_planificada, op.cantidad_producida, op.estado,
             op.cliente, op.fecha_planificada, op.created_at
      FROM ordenes_produccion op
      JOIN recetas r ON r.id = op.receta_id
      JOIN productos p ON p.id = r.producto_id
      ORDER BY op.created_at DESC LIMIT 50000
    `);
    const BOM = '\uFEFF';
    const headers = ['Numero orden','Receta','Producto','Cant. planificada','Cant. producida','Estado','Cliente','Fecha planificada','Creado'];
    const lines = rows.map(r => [
      r.numero_orden, r.receta_nombre ?? '', r.producto_nombre ?? '',
      parseFloat(r.cantidad_planificada ?? 0).toFixed(2),
      parseFloat(r.cantidad_producida ?? 0).toFixed(2),
      r.estado,
      r.cliente ?? '',
      r.fecha_planificada ? new Date(r.fecha_planificada).toLocaleDateString('es-ES') : '',
      new Date(r.created_at).toLocaleDateString('es-ES'),
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'));

    const csv = BOM + headers.join(';') + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="produccion.csv"');
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/exportar/inventario — CSV export
router.get('/exportar/inventario', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.codigo, p.nombre, p.tipo, p.stock_actual, p.stock_minimo,
             p.unidad_medida, p.precio_unitario, p.precio_venta
      FROM productos p WHERE p.activo = TRUE ORDER BY p.nombre ASC
    `);
    const BOM = '\uFEFF';
    const headers = ['Codigo','Nombre','Tipo','Stock actual','Stock minimo','Unidad','Precio compra','Precio venta'];
    const lines = rows.map(r => [
      r.codigo, r.nombre, r.tipo,
      parseFloat(r.stock_actual ?? 0).toFixed(2),
      parseFloat(r.stock_minimo ?? 0).toFixed(2),
      r.unidad_medida ?? '',
      parseFloat(r.precio_unitario ?? 0).toFixed(4),
      parseFloat(r.precio_venta ?? 0).toFixed(2),
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'));

    const csv = BOM + headers.join(';') + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventario.csv"');
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── PREDICCIÓN DE DEMANDA ─────────────────────────────────────
// Analiza patrones de compra recurrentes y predice próximos pedidos
router.get('/predicciones', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH pedidos_patron AS (
        SELECT
          pd.cliente_id,
          pd.producto_id,
          c.nombre AS cliente_nombre,
          c.email AS cliente_email,
          c.nivel AS cliente_nivel,
          p.nombre AS producto_nombre,
          p.codigo AS producto_codigo,
          p.unidad_medida,
          pd.cantidad,
          pd.created_at,
          LAG(pd.created_at) OVER (PARTITION BY pd.cliente_id, pd.producto_id ORDER BY pd.created_at) AS pedido_anterior
        FROM pedidos pd
        JOIN clientes c ON c.id = pd.cliente_id
        JOIN productos p ON p.id = pd.producto_id
        WHERE pd.estado = 'completado' AND pd.cantidad > 0 AND pd.created_at >= NOW() - INTERVAL '2 years'
      ),
      analisis AS (
        SELECT
          cliente_id, producto_id,
          cliente_nombre, cliente_email, cliente_nivel,
          producto_nombre, producto_codigo, unidad_medida,
          COUNT(*) AS num_pedidos,
          ROUND(AVG(cantidad::NUMERIC)) AS cantidad_media,
          ROUND(SUM(cantidad::NUMERIC)) AS cantidad_total,
          ROUND(AVG(EXTRACT(EPOCH FROM (created_at - pedido_anterior)) / 86400)) AS dias_intervalo,
          -- Desviación: si es baja = muy constante
          ROUND(STDDEV(EXTRACT(EPOCH FROM (created_at - pedido_anterior)) / 86400)) AS dias_desviacion,
          MAX(created_at) AS ultimo_pedido
        FROM pedidos_patron
        WHERE pedido_anterior IS NOT NULL
        GROUP BY cliente_id, producto_id, cliente_nombre, cliente_email, cliente_nivel, producto_nombre, producto_codigo, unidad_medida
        HAVING COUNT(*) >= 2
      )
      SELECT *,
        -- Fecha estimada: basada en el intervalo medio + rango de ±2 días
        TO_CHAR((ultimo_pedido + (dias_intervalo || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada,
        TO_CHAR((ultimo_pedido + ((dias_intervalo - LEAST(dias_desviacion, dias_intervalo * 0.3)) || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada_desde,
        TO_CHAR((ultimo_pedido + ((dias_intervalo + LEAST(dias_desviacion, dias_intervalo * 0.3)) || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada_hasta,
        CASE
          WHEN dias_desviacion IS NULL OR dias_desviacion < dias_intervalo * 0.3 THEN 'alta'
          WHEN dias_desviacion < dias_intervalo * 0.6 THEN 'media'
          ELSE 'baja'
        END AS probabilidad,
        EXTRACT(DAY FROM (ultimo_pedido + (dias_intervalo || ' days')::INTERVAL) - NOW()) AS dias_restantes
      FROM analisis
      WHERE dias_intervalo > 0 AND cantidad_media > 10
      ORDER BY
        -- Priorizar: próximos primero, luego por volumen
        EXTRACT(DAY FROM (ultimo_pedido + (dias_intervalo || ' days')::INTERVAL) - NOW()) ASC,
        cantidad_total DESC
      LIMIT 100
    `);

    const predicciones = rows.map(r => ({
      cliente_nombre: r.cliente_nombre,
      cliente_email: r.cliente_email,
      cliente_nivel: r.cliente_nivel,
      producto_nombre: r.producto_nombre,
      producto_codigo: r.producto_codigo,
      unidad_medida: r.unidad_medida,
      num_pedidos: parseInt(r.num_pedidos),
      cantidad_media: parseFloat(r.cantidad_media),
      cantidad_total: parseFloat(r.cantidad_total),
      dias_intervalo: parseInt(r.dias_intervalo),
      ultimo_pedido: r.ultimo_pedido,
      fecha_estimada: r.fecha_estimada,
      fecha_rango: `${new Date(r.fecha_estimada_desde + 'T12:00').toLocaleDateString('es-ES')} - ${new Date(r.fecha_estimada_hasta + 'T12:00').toLocaleDateString('es-ES')}`,
      dias_restantes: parseInt(r.dias_restantes),
      probabilidad: r.probabilidad,
      urgente: parseInt(r.dias_restantes) <= 60,
      vencido: parseInt(r.dias_restantes) < 0,
    }));

    return res.json(predicciones);
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Error al calcular predicciones.' });
  }
});

// ── INFORME MATERIALES DE EMBALAJE ───────────────────────────
// CSV simple: cuantas unidades de cada material se han usado
router.get('/informe-plastico', async (req, res) => {
  try {
    const desde = req.query.desde as string || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const hasta = req.query.hasta as string || new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(`
      SELECT
        p.codigo,
        p.nombre,
        SUM(ABS(sm.cantidad::NUMERIC)) AS unidades_consumidas
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      WHERE p.tipo = 'material_embalaje'
        AND sm.tipo = 'produccion_consumo'
        AND sm.created_at >= $1::DATE
        AND sm.created_at <= ($2::DATE + INTERVAL '1 day')
      GROUP BY p.id, p.codigo, p.nombre
      ORDER BY unidades_consumidas DESC
    `, [desde, hasta]);

    const totalUds = rows.reduce((s, r) => s + parseFloat(r.unidades_consumidas), 0);

    const BOM = '\uFEFF';
    const sep = ';';
    const headers = ['Codigo', 'Material', 'Unidades consumidas'];
    const lines = rows.map(r => [
      r.codigo,
      r.nombre,
      parseFloat(r.unidades_consumidas).toFixed(0),
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(sep));

    lines.push('');
    lines.push(['', 'TOTAL', totalUds.toFixed(0)].map(v => '"' + v + '"').join(sep));
    lines.push(['', `Periodo: ${desde} a ${hasta}`, ''].map(v => '"' + v + '"').join(sep));

    const csv = BOM + headers.join(sep) + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="materiales-embalaje-${desde.slice(0,4)}.csv"`);
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
