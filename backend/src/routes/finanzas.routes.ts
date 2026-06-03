import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// Cache por año — los KPIs temporales (facturación, ventas/mes, top productos,
// coste producción, mermas, clientes activos) se filtran por año seleccionado.
// El estado actual (inmovilizado, rentabilidad, precios MP) ignora el año.
const resumenCacheByYear = new Map<number, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute — short because invalidated on mutations

/** Call this to force refresh on next request (limpia cache de TODOS los años) */
export function invalidarCacheFinanzas() { resumenCacheByYear.clear(); }

// GET /api/finanzas/resumen?año=2026  (default: año actual)
router.get('/resumen', async (req, res) => {
  try {
    const añoQuery = parseInt(String(req.query.año ?? req.query.anio ?? req.query.year ?? ''), 10);
    const año = Number.isFinite(añoQuery) && añoQuery >= 2000 && añoQuery <= 2100
      ? añoQuery
      : new Date().getFullYear();

    const cached = resumenCacheByYear.get(año);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }
    // 1. Rentabilidad — cálculo "cheapest-first":
    //    Para cada ingrediente, asignar la cantidad necesaria empezando por
    //    el lote APROBADO con precio_compra más bajo, y subir al siguiente
    //    cuando ese lote se agote. Si no hay stock suficiente, completa con
    //    el precio ficha (precio_unitario) del producto.
    //
    //    Ejemplo: receta necesita 10 kg de Persulfato.
    //      Lote A: 5 kg a 3,66 €/kg
    //      Lote B: 50 kg a 3,82 €/kg
    //      → coste = 5 × 3,66 + 5 × 3,82 = 37,40 € → 3,74 €/kg efectivo
    //
    //    Esto sustituye el cálculo previo basado en CMP. Refleja el coste
    //    REAL al que la siguiente fabricación arrancará.

    // Pre-load lotes aprobados con stock>0 ordenados por precio ASC.
    // Una sola query → agrupados en memoria por producto.
    const { rows: lotesAprobados } = await pool.query<{ producto_id: string; cantidad_actual: string; precio_compra: string | null }>(`
      SELECT producto_id, cantidad_actual, precio_compra
      FROM lotes
      WHERE estado = 'aprobado' AND cantidad_actual > 0
      ORDER BY producto_id, precio_compra ASC NULLS LAST, fecha_entrada ASC
    `);
    const lotesPorProducto: Record<string, Array<{ cantidad: number; precio: number }>> = {};
    for (const l of lotesAprobados) {
      const arr = lotesPorProducto[l.producto_id] ?? (lotesPorProducto[l.producto_id] = []);
      const precio = l.precio_compra !== null ? parseFloat(l.precio_compra) : 0;
      arr.push({ cantidad: parseFloat(l.cantidad_actual), precio });
    }

    // Pre-load CMP + precio ficha (fallback cuando no hay lotes suficientes).
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

    const precioMap: Record<string, number> = {};
    for (const r of allCmps) precioMap[r.id] = parseFloat(r.cmp ?? '0');
    const { rows: prodPrecios } = await pool.query(
      `SELECT id, COALESCE(precio_unitario, 0) AS precio FROM productos WHERE activo = TRUE`
    );
    for (const r of prodPrecios) precioMap[r.id] = parseFloat(r.precio ?? '0');

    // Pre-load MAX precio_compra de lotes aprobados con stock — para "coste
    // futuro" del desglose: precio del lote más caro disponible (lo que
    // pagarás cuando el barato se agote). Mismo criterio que impacto-costes.
    const { rows: stockMaxRows } = await pool.query<{ producto_id: string; precio_max: string | null }>(
      `SELECT producto_id, MAX(precio_compra) AS precio_max
       FROM lotes
       WHERE estado = 'aprobado' AND cantidad_actual > 0
         AND precio_compra IS NOT NULL AND precio_compra > 0
       GROUP BY producto_id`
    );
    const stockMaxMap: Record<string, number> = {};
    for (const r of stockMaxRows) {
      if (r.precio_max !== null) stockMaxMap[r.producto_id] = parseFloat(r.precio_max);
    }

    /**
     * Asigna `cantNecesaria` del producto consumiendo lotes aprobados de más
     * barato a más caro. Si no hay stock suficiente, completa el resto al
     * precio ficha (fallback) — así el desglose nunca queda subvalorado.
     * Devuelve { coste_total, precio_efectivo_por_unidad }.
     */
    function costeCheapestFirst(productoId: string, cantNecesaria: number): {
      coste: number; precioEfectivo: number;
      costeFuturo: number; precioFuturo: number;
    } {
      if (cantNecesaria <= 0) return { coste: 0, precioEfectivo: 0, costeFuturo: 0, precioFuturo: 0 };
      const fallback = precioMap[productoId] ?? getCMP(productoId);
      const lotes = lotesPorProducto[productoId] ?? [];
      let restante = cantNecesaria;
      let coste = 0;
      for (const lote of lotes) {
        if (restante <= 0) break;
        const tomar = Math.min(lote.cantidad, restante);
        coste += tomar * (lote.precio > 0 ? lote.precio : fallback);
        restante -= tomar;
      }
      if (restante > 0) coste += restante * fallback;
      // Coste futuro: precio del lote más caro disponible (mismo criterio
      // que impacto-costes). Sin stock → fallback al precio ficha.
      const precioMaxStock = stockMaxMap[productoId] ?? fallback;
      const costeFuturo = cantNecesaria * precioMaxStock;
      return {
        coste, precioEfectivo: coste / cantNecesaria,
        costeFuturo, precioFuturo: precioMaxStock,
      };
    }

    interface DesgloseItem {
      nombre: string; cantidad: number; unidad: string;
      precio_ud: number; coste_linea: number;
      precio_ud_futuro: number; coste_linea_futuro: number;
    }
    interface CosteResult {
      coste_ud: number; coste_batch: number; rendimiento: number;
      coste_ud_futuro: number; coste_batch_futuro: number;
      desglose: DesgloseItem[];
    }
    const costeCache: Record<string, CosteResult> = {};

    async function calcularCosteProducto(productoId: string): Promise<CosteResult> {
      if (costeCache[productoId]) return costeCache[productoId];

      // Buscar receta activa
      const { rows: [prodInfo] } = await pool.query<{ tipo: string }>(
        `SELECT tipo::text AS tipo FROM productos WHERE id = $1`, [productoId]
      );
      const tipoEsperado = prodInfo?.tipo === 'producto_envasado' ? 'envasado'
                         : prodInfo?.tipo === 'producto_fabricado' ? 'fabricacion'
                         : null;

      const { rows: [receta] } = await pool.query(
        tipoEsperado
          ? `SELECT id, rendimiento FROM recetas
             WHERE producto_id = $1 AND activa = TRUE AND tipo_receta = $2
             ORDER BY version DESC LIMIT 1`
          : `SELECT id, rendimiento FROM recetas
             WHERE producto_id = $1 AND activa = TRUE
             ORDER BY version DESC LIMIT 1`,
        tipoEsperado ? [productoId, tipoEsperado] : [productoId]
      );

      // Sin receta: usa precio ficha o CMP como coste (no hay desglose).
      if (!receta) {
        const c = precioMap[productoId] ?? getCMP(productoId);
        const r: CosteResult = {
          coste_ud: c, coste_batch: c, rendimiento: 1,
          coste_ud_futuro: c, coste_batch_futuro: c, desglose: [],
        };
        costeCache[productoId] = r;
        return r;
      }

      const rendimiento = parseFloat(receta.rendimiento);

      // Construir desglose iterando ingredientes — coste por linea calculado
      // por "cheapest-first" sobre los lotes aprobados disponibles.
      const { rows: ingredientes } = await pool.query(
        `SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id, p.nombre, p.tipo, p.unidad_medida
         FROM ingredientes_receta ir
         JOIN productos p ON p.id = ir.materia_prima_id
         WHERE ir.receta_id = $1`, [receta.id]
      );

      const desglose: DesgloseItem[] = [];
      let costeBatch = 0;
      let costeBatchFuturo = 0;
      for (const ing of ingredientes) {
        const cantReal = parseFloat(ing.cantidad) * (1 + parseFloat(ing.porcentaje_merma) / 100);
        const { coste, precioEfectivo, costeFuturo, precioFuturo } =
          costeCheapestFirst(ing.materia_prima_id, cantReal);
        costeBatch += coste;
        costeBatchFuturo += costeFuturo;
        desglose.push({
          nombre: ing.nombre,
          cantidad: Math.round(cantReal * 10000) / 10000,
          unidad: ing.unidad_medida,
          // precio_ud mostrado = precio efectivo ponderado de los lotes consumidos.
          precio_ud: Math.round(precioEfectivo * 10000) / 10000,
          coste_linea: Math.round(coste * 10000) / 10000,
          precio_ud_futuro: Math.round(precioFuturo * 10000) / 10000,
          coste_linea_futuro: Math.round(costeFuturo * 10000) / 10000,
        });
      }

      // coste_ud autoritativo = suma del desglose / rendimiento (NO el precio
      // ficha del producto). Refleja el coste real de fabricar 1 unidad ahora
      // mismo con los lotes que tienes en almacén.
      const costeUd = rendimiento > 0 ? costeBatch / rendimiento : costeBatch;
      const costeUdFuturo = rendimiento > 0 ? costeBatchFuturo / rendimiento : costeBatchFuturo;
      const r: CosteResult = {
        coste_ud: Math.round(costeUd * 10000) / 10000,
        coste_batch: Math.round(costeBatch * 10000) / 10000,
        rendimiento,
        coste_ud_futuro: Math.round(costeUdFuturo * 10000) / 10000,
        coste_batch_futuro: Math.round(costeBatchFuturo * 10000) / 10000,
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

    // Pre-fetch historical prices (PVP + cost basis) for margin variation.
    // Tomamos el cambio MÁS RECIENTE con precio_anterior > 0 (ignoramos
    // entradas de "creación" donde el precio anterior es 0).
    const { rows: histPvpRows } = await pool.query(`
      SELECT DISTINCT ON (producto_id) producto_id, precio_anterior
      FROM historial_precios
      WHERE tipo = 'venta' AND created_at >= NOW() - INTERVAL '90 days'
        AND precio_anterior > 0
      ORDER BY producto_id, created_at DESC
    `);
    const pvpAnteriorMap: Record<string, number> = {};
    for (const r of histPvpRows) pvpAnteriorMap[r.producto_id] = parseFloat(r.precio_anterior);

    const { rows: histCostRows } = await pool.query(`
      SELECT DISTINCT ON (producto_id) producto_id, precio_anterior
      FROM historial_precios
      WHERE tipo = 'compra' AND created_at >= NOW() - INTERVAL '90 days'
        AND precio_anterior > 0
      ORDER BY producto_id, created_at DESC
    `);
    const costAnteriorMap: Record<string, number> = {};
    for (const r of histCostRows) costAnteriorMap[r.producto_id] = parseFloat(r.precio_anterior);

    const rentabilidad = [];
    for (const pt of ptProducts) {
      const resultado = await calcularCosteProducto(pt.id);
      const precioVenta = parseFloat(pt.precio_venta ?? '0');
      const margen = precioVenta > 0 ? ((precioVenta - resultado.coste_ud) / precioVenta * 100) : 0;
      const esFabricado = pt.tipo === 'producto_fabricado';

      // Dynamic margin variation: Margen_Act vs Margen_Ref (historical PVP + historical costs)
      const pvpAnt = pvpAnteriorMap[pt.id] ?? precioVenta;
      // Approximate anterior cost: use cost from ingredient price history if available
      // For simplicity, use the same recursive cost but substitute CMP with historical prices
      // A pragmatic approach: compute coste_anterior from the recipe's ingredient price history
      let costeAnterior = resultado.coste_ud; // default: same as current
      if (resultado.desglose.length > 0) {
        let costeBatchAnt = 0;
        for (const d of resultado.desglose) {
          // Look up if this ingredient had a historical price
          const histPrecio = costAnteriorMap[
            // Find the ingredient product ID by name match (we don't have ID in desglose)
            // Fallback: use current price
            Object.keys(costAnteriorMap).find(id => {
              // We'll do a second approach below
              return false;
            }) ?? ''
          ];
          costeBatchAnt += d.coste_linea; // default to current
        }
        // Better approach: query ingredient-level history for this product's recipe
        const { rows: [receta] } = await pool.query(
          `SELECT id, rendimiento FROM recetas WHERE producto_id = $1 AND activa = TRUE ORDER BY version DESC LIMIT 1`,
          [pt.id]
        );
        if (receta) {
          const { rows: ings } = await pool.query(`
            SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id
            FROM ingredientes_receta ir WHERE ir.receta_id = $1
          `, [receta.id]);
          let batchAnt = 0;
          for (const ing of ings) {
            const cantReal = parseFloat(ing.cantidad) * (1 + parseFloat(ing.porcentaje_merma) / 100);
            const precioAnt = costAnteriorMap[ing.materia_prima_id] ?? getCMP(ing.materia_prima_id);
            batchAnt += cantReal * precioAnt;
          }
          const rend = parseFloat(receta.rendimiento);
          costeAnterior = rend > 0 ? Math.round(batchAnt / rend * 10000) / 10000 : batchAnt;
        }
      }

      const margenRef = pvpAnt > 0 ? ((pvpAnt - costeAnterior) / pvpAnt * 100) : 0;
      const diffMargen = Math.round((margen - margenRef) * 10) / 10;

      // Health semaphore
      const costeSubio = resultado.coste_ud > costeAnterior + 0.0001;
      const pvpSubio = precioVenta > pvpAnt + 0.0001;
      const pvpBajo = precioVenta < pvpAnt - 0.0001;
      let salud = '';
      if (diffMargen === 0)                     salud = '';
      else if (costeSubio && diffMargen >= 0)   salud = 'Subida de costes compensada con actualizacion de PVP.';
      else if (costeSubio && diffMargen < 0)    salud = 'Tus costes han subido. Margen en peligro.';
      else if (pvpBajo && diffMargen < 0)       salud = 'Has bajado el PVP sin reducir costes. Rentabilidad menor.';
      else if (!costeSubio && diffMargen > 0)   salud = 'Costes estables o reducidos. Margen mejorado.';

      rentabilidad.push({
        id: pt.id, codigo: pt.codigo, nombre: pt.nombre, tipo: pt.tipo,
        precio_venta: precioVenta,
        precio_coste: resultado.coste_ud,
        coste_batch: resultado.coste_batch,
        coste_ud_futuro: resultado.coste_ud_futuro,
        coste_batch_futuro: resultado.coste_batch_futuro,
        rendimiento: resultado.rendimiento,
        precio_kg: esFabricado ? resultado.coste_ud : undefined,
        precio_1000kg: esFabricado ? Math.round(resultado.coste_ud * 1000 * 100) / 100 : undefined,
        stock_actual: parseFloat(pt.stock_actual),
        unidad_medida: pt.unidad_medida,
        margen_pct: Math.round(margen * 10) / 10,
        margen_ref: Math.round(margenRef * 10) / 10,
        diff_margen: diffMargen,
        salud: salud || undefined,
        pvp_anterior: Math.round(pvpAnt * 100) / 100,
        beneficio_ud: Math.round((precioVenta - resultado.coste_ud) * 10000) / 10000,
        desglose: resultado.desglose,
      });
    }
    rentabilidad.sort((a, b) => b.margen_pct - a.margen_pct);

    // 2. Inmovilizado en stock — valoración a coste con fallback:
    //    1º coste real del lote (precio_compra) si existe
    //    2º coste medio del producto (coste_medio_actual)
    //    3º precio_unitario configurado en la ficha del producto
    //    4º 0 (sin coste asignado, no contribuye)
    // Esto asegura que añadir un producto con coste pero sin lotes
    // (ej: stock inicial cargado) sí aparece en la valoración.
    const { rows: [inmovilizado] } = await pool.query(`
      WITH lote_val AS (
        SELECT
          p.id AS producto_id, p.tipo,
          SUM(l.cantidad_actual *
              COALESCE(
                NULLIF(l.precio_compra, 0),
                NULLIF(p.coste_medio_actual, 0),
                NULLIF(p.precio_unitario, 0),
                0
              )) AS valor_lotes,
          SUM(l.cantidad_actual) AS stock_lotes
        FROM lotes l
        JOIN productos p ON p.id = l.producto_id
        WHERE p.activo = TRUE AND l.estado = 'aprobado' AND l.cantidad_actual > 0
        GROUP BY p.id, p.tipo
      ),
      stock_resto AS (
        -- Stock_actual del producto que NO está cubierto por lotes (legacy o ajustes)
        SELECT
          p.id AS producto_id, p.tipo,
          GREATEST(0, p.stock_actual - COALESCE(lv.stock_lotes, 0)) AS resto,
          COALESCE(NULLIF(p.coste_medio_actual, 0), NULLIF(p.precio_unitario, 0), 0) AS coste
        FROM productos p
        LEFT JOIN lote_val lv ON lv.producto_id = p.id
        WHERE p.activo = TRUE AND p.stock_actual > 0
      ),
      todo AS (
        SELECT producto_id, tipo, valor_lotes AS valor FROM lote_val
        UNION ALL
        SELECT producto_id, tipo, (resto * coste) AS valor FROM stock_resto
      )
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'materia_prima' THEN valor ELSE 0 END), 0) AS valor_mp,
        COALESCE(SUM(CASE WHEN tipo = 'producto_fabricado' THEN valor ELSE 0 END), 0) AS valor_fab,
        COALESCE(SUM(CASE WHEN tipo = 'producto_envasado' THEN valor ELSE 0 END), 0) AS valor_env,
        COALESCE(SUM(CASE WHEN tipo = 'producto_terminado' THEN valor ELSE 0 END), 0) AS valor_pt,
        COALESCE(SUM(CASE WHEN tipo = 'material_embalaje' THEN valor ELSE 0 END), 0) AS valor_emb,
        COALESCE(SUM(valor), 0) AS valor_total
      FROM todo
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

    // 4. Ventas (pedidos completados del año)
    const { rows: [ventas] } = await pool.query(`
      SELECT
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(total::NUMERIC), 0) AS facturacion_total,
        COALESCE(SUM(subtotal::NUMERIC), 0) AS subtotal_total,
        COALESCE(SUM(portes::NUMERIC), 0) AS portes_total
      FROM pedidos
      WHERE estado = 'completado' AND EXTRACT(YEAR FROM updated_at) = $1
    `, [año]);

    // 5. Ventas por mes — los 12 meses del año seleccionado
    const { rows: ventasMes } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', updated_at), 'YYYY-MM') AS mes,
        TO_CHAR(DATE_TRUNC('month', updated_at), 'Mon YY') AS mes_label,
        COUNT(*) AS num_pedidos,
        COALESCE(SUM(total::NUMERIC), 0) AS total
      FROM pedidos
      WHERE estado = 'completado' AND EXTRACT(YEAR FROM updated_at) = $1
      GROUP BY DATE_TRUNC('month', updated_at)
      ORDER BY mes ASC
    `, [año]);

    // 6. Ventas por producto (top 10) del año — pedidos completados, precio histórico
    const { rows: ventasProducto } = await pool.query(`
      SELECT p.nombre, p.codigo,
        COALESCE(SUM(lp.cantidad::NUMERIC), 0) AS cantidad_vendida,
        p.unidad_medida,
        p.precio_venta,
        COALESCE(SUM(lp.cantidad::NUMERIC * COALESCE(lp.precio_unitario::NUMERIC, p.precio_venta::NUMERIC, 0)), 0) AS facturacion
      FROM lineas_pedido lp
      JOIN pedidos pd ON pd.id = lp.pedido_id
      JOIN productos p ON p.id = lp.producto_id
      WHERE pd.estado = 'completado' AND EXTRACT(YEAR FROM pd.updated_at) = $1
      GROUP BY p.id, p.nombre, p.codigo, p.unidad_medida, p.precio_venta
      ORDER BY facturacion DESC
      LIMIT 10
    `, [año]);

    // 7. Coste de produccion del año — usa precio real del lote consumido.
    //    Filtramos por sm.created_at (fecha real del consumo) en lugar de
    //    op.updated_at, que está corrupto por seeds posteriores que tocaron
    //    todas las órdenes históricas. La migración 029 limpió duplicados
    //    de stock_moves y añadió UNIQUE(id,created_at) para prevenirlos.
    const { rows: [costeProd] } = await pool.query(`
      SELECT COUNT(DISTINCT sm.orden_id) AS num_ordenes,
        COALESCE(SUM(ABS(sm.cantidad::NUMERIC) * COALESCE(l.precio_compra, p.precio_unitario)), 0) AS coste_total
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      LEFT JOIN lotes l ON l.id = sm.lote_id
      JOIN ordenes_produccion op ON op.id = sm.orden_id
      WHERE sm.tipo = 'produccion_consumo' AND op.estado = 'completada'
        AND EXTRACT(YEAR FROM sm.created_at) = $1
    `, [año]);

    // 8. Producciones rechazadas/canceladas + lotes rechazados del año
    const { rows: [rechazos] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ordenes_produccion
          WHERE estado = 'cancelada' AND EXTRACT(YEAR FROM created_at) = $1) AS ordenes_canceladas,
        COALESCE((SELECT SUM(l.cantidad_inicial * COALESCE(l.precio_compra, p.precio_unitario))
          FROM lotes l JOIN productos p ON p.id = l.producto_id
          WHERE l.estado = 'rechazado'
            AND EXTRACT(YEAR FROM l.created_at) = $1), 0) AS valor_rechazado,
        (SELECT COUNT(*) FROM lotes
          WHERE estado = 'rechazado' AND EXTRACT(YEAR FROM created_at) = $1) AS lotes_rechazados
    `, [año]);

    // 9. Clientes activos con pedidos del año
    const { rows: [clientesInfo] } = await pool.query(`
      SELECT COUNT(DISTINCT cliente_id) AS clientes_activos
      FROM pedidos
      WHERE estado = 'completado' AND EXTRACT(YEAR FROM updated_at) = $1
    `, [año]);

    // 10. Mermas del año — kg perdidos por producto, valorados en EUR.
    //     Filtra por COALESCE(fecha_fin, created_at): seeds históricos no
    //     setean fecha_fin, así que created_at es la mejor aproximación.
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
        AND EXTRACT(YEAR FROM COALESCE(op.fecha_fin, op.created_at)) = $1
    `, [año]);
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
      año,
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
    resumenCacheByYear.set(año, { data: result, timestamp: Date.now() });
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

// GET /api/finanzas/impacto-costes — variación margen anterior vs FUTURO proyectado
// Coste actual = futuro proyectado (fn_028) — refleja lo que costará al recomprar MP a precio ficha.
// Coste anterior = mismo cálculo pero con precio_anterior de historial_precios para las MP que cambiaron.
router.get('/impacto-costes', async (_req, res) => {
  try {
    const { rows: recetas } = await pool.query(`
      SELECT r.id, r.nombre AS receta_nombre, r.rendimiento, r.tipo_receta,
             pt.id AS producto_id, pt.nombre AS producto_nombre, pt.codigo AS producto_codigo,
             pt.tipo AS producto_tipo, pt.precio_venta, pt.unidad_medida
      FROM recetas r
      JOIN productos pt ON pt.id = r.producto_id
      WHERE r.activa = TRUE
    `);

    // Precarga: por cada producto, MIN y MAX precio_compra de lotes aprobados
    // con stock>0. Una sola query agregada para evitar N consultas en el bucle.
    //   - precio_min  → lote más barato (es lo que consumes primero, cheapest-first)
    //   - precio_max  → lote más caro disponible (lo que consumirás cuando los baratos
    //                   se agoten, mientras sigan disponibles los actuales)
    const { rows: stockPrices } = await pool.query<{
      producto_id: string; precio_min: string | null; precio_max: string | null;
    }>(`
      SELECT producto_id,
             MIN(precio_compra) AS precio_min,
             MAX(precio_compra) AS precio_max
      FROM lotes
      WHERE estado = 'aprobado'
        AND cantidad_actual > 0
        AND precio_compra IS NOT NULL
        AND precio_compra > 0
      GROUP BY producto_id
    `);
    const stockPriceMap = new Map<string, { min: number; max: number }>();
    for (const r of stockPrices) {
      if (r.precio_min !== null && r.precio_max !== null) {
        stockPriceMap.set(r.producto_id, {
          min: parseFloat(r.precio_min),
          max: parseFloat(r.precio_max),
        });
      }
    }

    const impactoRecetas = [];
    for (const receta of recetas) {
      // Ingredientes: precio actual = precio_unitario ficha (futuro); precio anterior = historial
      const { rows: ingredientes } = await pool.query(`
        SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id,
               mp.nombre AS mp_nombre, mp.tipo AS mp_tipo, mp.precio_unitario AS precio_actual,
               (SELECT hp.precio_anterior FROM historial_precios hp
                WHERE hp.producto_id = ir.materia_prima_id AND hp.tipo = 'compra'
                AND hp.created_at >= NOW() - INTERVAL '90 days'
                AND hp.precio_anterior > 0
                ORDER BY hp.created_at DESC LIMIT 1) AS precio_anterior
        FROM ingredientes_receta ir
        JOIN productos mp ON mp.id = ir.materia_prima_id
        WHERE ir.receta_id = $1
      `, [receta.id]);

      const { rows: [pvpHist] } = await pool.query(`
        SELECT hp.precio_anterior
        FROM historial_precios hp
        WHERE hp.producto_id = $1 AND hp.tipo = 'venta'
          AND hp.created_at >= NOW() - INTERVAL '90 days'
          AND hp.precio_anterior > 0
        ORDER BY hp.created_at DESC LIMIT 1
      `, [receta.producto_id]);

      // Coste actual = futuro proyectado por unidad (recursivo, ya divide por rendimiento)
      const { rows: [costeFutRow] } = await pool.query(
        `SELECT public.fn_calcular_coste_receta_futuro($1) AS coste`,
        [receta.producto_id]
      );
      const costePorKgActual = parseFloat(costeFutRow?.coste ?? '0');

      // Coste anterior: mismo cálculo recursivo pero sustituyendo precio de las MP que cambiaron
      // por su precio_anterior. Para fabricados anidados usamos también su futuro (aproximación).
      // Además incluimos precio_stock_min/max (lote barato/caro actualmente en almacén).
      let costeAnteriorBatch = 0;
      let costeStockMinBatch = 0;
      let costeStockMaxBatch = 0;
      const detalleMP: {
        nombre: string;
        cantidad: number;
        precio_anterior: number | null;
        precio_actual: number;       // ficha / coste futuro recursivo
        precio_stock_min: number;    // lote más barato (o ficha si sin stock)
        precio_stock_max: number;    // lote más caro (o ficha si sin stock)
        stock_source: 'lots' | 'recursive' | 'ficha';
        diff: number;
      }[] = [];

      for (const ing of ingredientes) {
        const cantReal = parseFloat(ing.cantidad) * (1 + parseFloat(ing.porcentaje_merma) / 100);
        const esIntermedio = ing.mp_tipo === 'producto_fabricado' || ing.mp_tipo === 'producto_envasado';
        let pActual: number;
        if (esIntermedio) {
          const { rows: [r2] } = await pool.query(
            `SELECT public.fn_calcular_coste_receta_futuro($1) AS c`, [ing.materia_prima_id]
          );
          pActual = parseFloat(r2?.c ?? ing.precio_actual ?? '0');
        } else {
          pActual = parseFloat(ing.precio_actual);
        }
        const pAnterior = ing.precio_anterior ? parseFloat(ing.precio_anterior) : pActual;
        costeAnteriorBatch += cantReal * pAnterior;

        // Stock min/max del ingrediente.
        //   1. Si el ingrediente tiene lotes propios en stock con precio_compra → usar MIN/MAX.
        //      (Funciona tanto para MP como para granel/envasado producidos in-house.)
        //   2. Si es intermedio sin lotes en stock → calcular recursivamente min/max
        //      a partir de sus propias materias primas (caso "Cola Blanca Autoadhesiva
        //      sin stock pero VAM tiene 2,20 - 3,20").
        //   3. Fallback final: pActual (precio ficha) en ambos.
        const stockP = stockPriceMap.get(ing.materia_prima_id);
        let pStockMin: number;
        let pStockMax: number;
        let stockSource: 'lots' | 'recursive' | 'ficha';

        if (stockP) {
          pStockMin = stockP.min;
          pStockMax = stockP.max;
          stockSource = 'lots';
        } else if (esIntermedio) {
          // Recursivo: calcular el coste min/max del granel a partir de los precios
          // de SUS materias primas (un nivel de profundidad — suficiente para granel→envasado).
          const { rows: subIngs } = await pool.query<{
            cantidad: string; porcentaje_merma: string; materia_prima_id: string;
            precio_actual: string;
          }>(
            `SELECT ir.cantidad, ir.porcentaje_merma, ir.materia_prima_id,
                    mp.precio_unitario AS precio_actual
             FROM ingredientes_receta ir
             JOIN productos mp ON mp.id = ir.materia_prima_id
             WHERE ir.receta_id = (
               SELECT id FROM recetas
               WHERE producto_id = $1 AND activa = TRUE
               ORDER BY version DESC LIMIT 1
             )`,
            [ing.materia_prima_id]
          );
          const { rows: [recetaSub] } = await pool.query<{ rendimiento: string }>(
            `SELECT rendimiento FROM recetas WHERE producto_id = $1 AND activa = TRUE
             ORDER BY version DESC LIMIT 1`,
            [ing.materia_prima_id]
          );
          if (subIngs.length > 0 && recetaSub) {
            let costeMinSub = 0;
            let costeMaxSub = 0;
            for (const si of subIngs) {
              const cantSub = parseFloat(si.cantidad) * (1 + parseFloat(si.porcentaje_merma) / 100);
              const subStock = stockPriceMap.get(si.materia_prima_id);
              const sMin = subStock ? subStock.min : parseFloat(si.precio_actual ?? '0');
              const sMax = subStock ? subStock.max : parseFloat(si.precio_actual ?? '0');
              costeMinSub += cantSub * sMin;
              costeMaxSub += cantSub * sMax;
            }
            const rendSub = parseFloat(recetaSub.rendimiento);
            pStockMin = rendSub > 0 ? costeMinSub / rendSub : pActual;
            pStockMax = rendSub > 0 ? costeMaxSub / rendSub : pActual;
            stockSource = 'recursive';
          } else {
            pStockMin = pActual;
            pStockMax = pActual;
            stockSource = 'ficha';
          }
        } else {
          pStockMin = pActual;
          pStockMax = pActual;
          stockSource = 'ficha';
        }
        costeStockMinBatch += cantReal * pStockMin;
        costeStockMaxBatch += cantReal * pStockMax;

        detalleMP.push({
          nombre: ing.mp_nombre,
          cantidad: cantReal,
          precio_anterior: ing.precio_anterior ? pAnterior : null,
          precio_actual: pActual,
          precio_stock_min: pStockMin,
          precio_stock_max: pStockMax,
          stock_source: stockSource,
          diff: (pActual - pAnterior) * cantReal,
        });
      }

      const rendimiento = parseFloat(receta.rendimiento);
      const costePorKgAnterior = rendimiento > 0 ? costeAnteriorBatch / rendimiento : 0;

      // Dynamic margin: use historical PVP for anterior, current PVP for actual
      const pvpActual = parseFloat(receta.precio_venta ?? '0');
      const pvpAnterior = pvpHist ? parseFloat(pvpHist.precio_anterior) : pvpActual;
      const margenActual = pvpActual > 0 ? ((pvpActual - costePorKgActual) / pvpActual * 100) : 0;
      const margenAnterior = pvpAnterior > 0 ? ((pvpAnterior - costePorKgAnterior) / pvpAnterior * 100) : 0;
      const diffMargen = margenActual - margenAnterior;

      // Determine health semaphore tooltip
      const costeSubio = costePorKgActual > costePorKgAnterior + 0.0001;
      const pvpSubio = pvpActual > pvpAnterior + 0.0001;
      const pvpBajo = pvpActual < pvpAnterior - 0.0001;
      let salud: string;
      if (costeSubio && diffMargen >= 0)      salud = 'Subida de costes compensada con actualizacion de PVP.';
      else if (costeSubio && diffMargen < 0)  salud = 'Tus costes han subido. Margen en peligro.';
      else if (pvpBajo && diffMargen < 0)     salud = 'Has bajado el PVP sin reducir costes. Rentabilidad menor.';
      else if (!costeSubio && diffMargen > 0) salud = 'Costes estables o reducidos. Margen mejorado.';
      else                                    salud = 'Sin variacion significativa.';

      // Coste por batch = coste/unidad × rendimiento. Misma lógica, solo agrego dato derivado.
      const costeBatchActual = costePorKgActual * rendimiento;
      // costeAnteriorBatch ya está calculado arriba (acumulador del bucle ingredientes).
      const costeStockMinPorUd = rendimiento > 0 ? costeStockMinBatch / rendimiento : 0;
      const costeStockMaxPorUd = rendimiento > 0 ? costeStockMaxBatch / rendimiento : 0;

      impactoRecetas.push({
        receta_nombre: receta.receta_nombre,
        producto_nombre: receta.producto_nombre,
        producto_codigo: receta.producto_codigo,
        producto_tipo: receta.producto_tipo,        // 'producto_fabricado' | 'producto_envasado'
        tipo_receta: receta.tipo_receta,            // 'fabricacion' | 'envasado'
        unidad_medida: receta.unidad_medida,
        rendimiento,
        pvp_anterior: Math.round(pvpAnterior * 100) / 100,
        pvp_actual: Math.round(pvpActual * 100) / 100,
        precio_venta: pvpActual,
        coste_anterior: Math.round(costePorKgAnterior * 10000) / 10000,
        coste_actual: Math.round(costePorKgActual * 10000) / 10000,
        coste_batch_anterior: Math.round(costeAnteriorBatch * 100) / 100,
        coste_batch_actual: Math.round(costeBatchActual * 100) / 100,
        // Coste con stock real actual (mín = barato, máx = caro):
        coste_stock_min: Math.round(costeStockMinPorUd * 10000) / 10000,
        coste_stock_max: Math.round(costeStockMaxPorUd * 10000) / 10000,
        coste_stock_min_batch: Math.round(costeStockMinBatch * 100) / 100,
        coste_stock_max_batch: Math.round(costeStockMaxBatch * 100) / 100,
        margen_anterior: Math.round(margenAnterior * 10) / 10,
        margen_actual: Math.round(margenActual * 10) / 10,
        diff_coste: Math.round((costePorKgActual - costePorKgAnterior) * 10000) / 10000,
        diff_margen: Math.round(diffMargen * 10) / 10,
        salud,
        // Devolvemos TODOS los ingredientes (no solo los que cambiaron). Para
        // productos nuevos sin historial, el desglose sigue siendo útil:
        // muestra coste de cola + envase + materiales con sus precios actuales.
        // Frontend distingue: precio_anterior=null → "sin histórico", solo muestra
        // precio actual y coste línea.
        detalle_mp: detalleMP,
      });
    }

    // 2. Materias primas con cambio de precio
    // Tomamos el PRECIO INMEDIATAMENTE ANTERIOR al actual (entrada más reciente
    // del historial con precio_anterior > 0), no el más antiguo. Si hubo varias
    // subidas (0→3→5), queremos mostrar 3→5, no 0→5.
    const { rows: materiasPrimas } = await pool.query(`
      WITH precio_anterior AS (
        SELECT DISTINCT ON (hp.producto_id) hp.producto_id, hp.precio_anterior
        FROM historial_precios hp
        WHERE hp.tipo = 'compra'
          AND hp.created_at >= NOW() - INTERVAL '90 days'
          AND hp.precio_anterior > 0
        ORDER BY hp.producto_id, hp.created_at DESC
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

// Helper año: query string ?año=2026 — default año actual
function resolverAño(req: { query: Record<string, unknown> }): number {
  const v = parseInt(String(req.query.año ?? req.query.anio ?? req.query.year ?? ''), 10);
  return Number.isFinite(v) && v >= 2000 && v <= 2100 ? v : new Date().getFullYear();
}

// GET /api/finanzas/exportar/pedidos?año=2026 — CSV export del año
router.get('/exportar/pedidos', async (req, res) => {
  try {
    const año = resolverAño(req);
    const { rows } = await pool.query(`
      SELECT pd.numero_pedido, pd.estado, pd.cliente_nombre,
             pd.fecha_entrega, pd.subtotal, pd.portes, pd.iva_porcentaje, pd.total,
             pd.created_at
      FROM pedidos pd
      WHERE EXTRACT(YEAR FROM pd.created_at) = $1
      ORDER BY pd.created_at DESC LIMIT 50000
    `, [año]);
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
    res.setHeader('Content-Disposition', `attachment; filename="pedidos-${año}.csv"`);
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/finanzas/exportar/produccion?año=2026 — CSV export del año
router.get('/exportar/produccion', async (req, res) => {
  try {
    const año = resolverAño(req);
    const { rows } = await pool.query(`
      SELECT op.numero_orden, r.nombre AS receta_nombre, p.nombre AS producto_nombre,
             op.cantidad_planificada, op.cantidad_producida, op.estado,
             op.cliente, op.fecha_planificada, op.created_at
      FROM ordenes_produccion op
      JOIN recetas r ON r.id = op.receta_id
      JOIN productos p ON p.id = r.producto_id
      WHERE EXTRACT(YEAR FROM op.created_at) = $1
      ORDER BY op.created_at DESC LIMIT 50000
    `, [año]);
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
    res.setHeader('Content-Disposition', `attachment; filename="produccion-${año}.csv"`);
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

// ── PREDICCIÓN DE DEMANDA (v2) ────────────────────────────────
// v2: pedidos recientes pesan más (decay 180d), mediana en lugar de media,
// factor tendencia 90d/90d previos, estado activo/dormido, timeline últimos 5.
router.get('/predicciones', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          pd.cliente_id, pd.producto_id,
          c.nombre AS cliente_nombre, c.email AS cliente_email, c.nivel AS cliente_nivel,
          p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.unidad_medida,
          pd.cantidad, pd.created_at,
          LAG(pd.created_at) OVER (PARTITION BY pd.cliente_id, pd.producto_id ORDER BY pd.created_at) AS pedido_anterior,
          -- Decay: pedido de hoy=1.0, hace 180d≈0.37, hace 1 año≈0.13
          EXP(- EXTRACT(EPOCH FROM (NOW() - pd.created_at))/86400.0/180.0) AS w_decay
        FROM pedidos pd
        JOIN clientes c ON c.id = pd.cliente_id
        JOIN productos p ON p.id = pd.producto_id
        WHERE pd.estado = 'completado' AND pd.cantidad > 0
          AND pd.created_at >= NOW() - INTERVAL '2 years'
      ),
      gaps AS (
        SELECT
          cliente_id, producto_id,
          cliente_nombre, cliente_email, cliente_nivel,
          producto_nombre, producto_codigo, unidad_medida,
          cantidad, created_at, w_decay,
          EXTRACT(EPOCH FROM (created_at - pedido_anterior))/86400.0 AS gap
        FROM base
        WHERE pedido_anterior IS NOT NULL
      ),
      analisis AS (
        SELECT
          cliente_id, producto_id,
          MAX(cliente_nombre) AS cliente_nombre,
          MAX(cliente_email) AS cliente_email,
          MAX(cliente_nivel) AS cliente_nivel,
          MAX(producto_nombre) AS producto_nombre,
          MAX(producto_codigo) AS producto_codigo,
          MAX(unidad_medida) AS unidad_medida,
          (COUNT(*) + 1)::INT AS num_pedidos,
          -- Intervalo PONDERADO por decay reciente
          ROUND( SUM(gap * w_decay) / NULLIF(SUM(w_decay), 0) )::INT AS dias_intervalo,
          ROUND(STDDEV(gap))::INT AS dias_desviacion,
          -- MEDIANA cantidad (anti outlier). Sigue como cantidad_media para
          -- compatibilidad con consumidores existentes.
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cantidad::NUMERIC))::NUMERIC AS cantidad_media,
          ROUND(SUM(cantidad::NUMERIC))::NUMERIC AS cantidad_total,
          MAX(created_at) AS ultimo_pedido,
          COALESCE(SUM(cantidad::NUMERIC) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days'), 0) AS qty_90d,
          COALESCE(SUM(cantidad::NUMERIC) FILTER (
            WHERE created_at >= NOW() - INTERVAL '180 days'
              AND created_at <  NOW() - INTERVAL '90 days'
          ), 0) AS qty_prev90d
        FROM gaps
        GROUP BY cliente_id, producto_id
        HAVING COUNT(*) >= 2
      ),
      ultimos AS (
        SELECT cliente_id, producto_id,
          json_agg(json_build_object(
            'fecha', TO_CHAR(created_at, 'YYYY-MM-DD'),
            'cantidad', cantidad
          ) ORDER BY created_at DESC) AS lista
        FROM (
          SELECT cliente_id, producto_id, created_at, cantidad,
                 ROW_NUMBER() OVER (PARTITION BY cliente_id, producto_id ORDER BY created_at DESC) AS rn
          FROM pedidos
          WHERE estado = 'completado' AND cantidad > 0
            AND created_at >= NOW() - INTERVAL '2 years'
        ) p
        WHERE rn <= 5
        GROUP BY cliente_id, producto_id
      )
      SELECT a.*,
        COALESCE(u.lista, '[]'::json) AS ultimos_pedidos,
        CASE
          WHEN qty_prev90d > 0 THEN LEAST(1.5, GREATEST(0.5, qty_90d / qty_prev90d))
          ELSE 1.0
        END AS factor_tendencia,
        ROUND(cantidad_media *
          CASE WHEN qty_prev90d > 0 THEN LEAST(1.5, GREATEST(0.5, qty_90d / qty_prev90d)) ELSE 1.0 END
        )::NUMERIC AS cantidad_esperada,
        CASE
          WHEN EXTRACT(DAY FROM NOW() - ultimo_pedido) > 2 * dias_intervalo THEN 'dormido'
          ELSE 'activo'
        END AS estado,
        TO_CHAR((ultimo_pedido + (dias_intervalo || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada,
        TO_CHAR((ultimo_pedido + ((dias_intervalo - LEAST(COALESCE(dias_desviacion, 0), dias_intervalo * 0.3)) || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada_desde,
        TO_CHAR((ultimo_pedido + ((dias_intervalo + LEAST(COALESCE(dias_desviacion, 0), dias_intervalo * 0.3)) || ' days')::INTERVAL)::DATE, 'YYYY-MM-DD') AS fecha_estimada_hasta,
        CASE
          WHEN dias_desviacion IS NULL OR dias_desviacion < dias_intervalo * 0.3 THEN 'alta'
          WHEN dias_desviacion < dias_intervalo * 0.6 THEN 'media'
          ELSE 'baja'
        END AS probabilidad,
        EXTRACT(DAY FROM (ultimo_pedido + (dias_intervalo || ' days')::INTERVAL) - NOW())::INT AS dias_restantes
      FROM analisis a
      LEFT JOIN ultimos u ON u.cliente_id = a.cliente_id AND u.producto_id = a.producto_id
      WHERE dias_intervalo > 0 AND cantidad_media > 10
      ORDER BY
        CASE WHEN EXTRACT(DAY FROM NOW() - ultimo_pedido) > 2 * dias_intervalo THEN 1 ELSE 0 END ASC,
        EXTRACT(DAY FROM (ultimo_pedido + (dias_intervalo || ' days')::INTERVAL) - NOW()) ASC,
        cantidad_total DESC
      LIMIT 150
    `);

    const predicciones = rows.map(r => {
      const factor = parseFloat(r.factor_tendencia);
      const tendencia = factor > 1.05 ? 'subiendo' : factor < 0.95 ? 'bajando' : 'estable';
      return {
        cliente_nombre: r.cliente_nombre,
        cliente_email: r.cliente_email,
        cliente_nivel: r.cliente_nivel,
        producto_nombre: r.producto_nombre,
        producto_codigo: r.producto_codigo,
        unidad_medida: r.unidad_medida,
        num_pedidos: parseInt(r.num_pedidos),
        cantidad_media: parseFloat(r.cantidad_media),
        cantidad_esperada: parseFloat(r.cantidad_esperada),
        cantidad_total: parseFloat(r.cantidad_total),
        dias_intervalo: parseInt(r.dias_intervalo),
        ultimo_pedido: r.ultimo_pedido,
        fecha_estimada: r.fecha_estimada,
        fecha_rango: `${new Date(r.fecha_estimada_desde + 'T12:00').toLocaleDateString('es-ES')} - ${new Date(r.fecha_estimada_hasta + 'T12:00').toLocaleDateString('es-ES')}`,
        dias_restantes: parseInt(r.dias_restantes),
        probabilidad: r.probabilidad,
        urgente: parseInt(r.dias_restantes) <= 60,
        vencido: parseInt(r.dias_restantes) < 0,
        estado: r.estado as 'activo' | 'dormido',
        factor_tendencia: factor,
        tendencia: tendencia as 'subiendo' | 'bajando' | 'estable',
        tendencia_pct: Math.round((factor - 1) * 100),
        ultimos_pedidos: (r.ultimos_pedidos || []) as { fecha: string; cantidad: string }[],
      };
    });

    return res.json(predicciones);
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Error al calcular predicciones.' });
  }
});

// ── INFORME PLÁSTICO (Ley 7/2022) ──────────────────────────
// Cubre TODOS los productos tipo 'material_embalaje' con consumo en el periodo,
// independientemente de si tienen peso_plastico configurado. Los que no lo tengan
// aparecen marcados como "PESO NO CONFIGURADO" para que el admin sepa qué falta
// declarar (anti-falsa-omisión Hacienda).
router.get('/informe-plastico', async (req, res) => {
  try {
    const desde = req.query.desde as string || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const hasta = req.query.hasta as string || new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(`
      SELECT
        p.codigo,
        p.nombre,
        p.peso_plastico_kg,
        p.unidades_por_envase,
        COALESCE(p.precio_unitario, 0) AS precio_ud,
        SUM(ABS(sm.cantidad::NUMERIC)) AS unidades_consumidas,
        COUNT(DISTINCT sm.orden_id) AS num_ordenes,
        MIN(sm.created_at)::DATE AS primera_fecha,
        MAX(sm.created_at)::DATE AS ultima_fecha
      FROM stock_moves sm
      JOIN productos p ON p.id = sm.producto_id
      WHERE p.tipo = 'material_embalaje'
        AND sm.tipo = 'produccion_consumo'
        AND sm.created_at >= $1::DATE
        AND sm.created_at <= ($2::DATE + INTERVAL '1 day')
      GROUP BY p.id, p.codigo, p.nombre, p.peso_plastico_kg, p.unidades_por_envase, p.precio_unitario
      ORDER BY unidades_consumidas DESC
    `, [desde, hasta]);

    // Multiplicador caja: si un envase tiene unidades_por_envase > 1 (ej. caja
    // de 40 botes), las unidades plásticas reales son consumo × unidades_por_envase.
    // Para envases sueltos (bidón, garrafa) el multiplicador es 1.
    const calcMultBote = (r: any): number => {
      const upe = r.unidades_por_envase;
      return upe !== null && upe !== undefined && Number(upe) > 0 ? Number(upe) : 1;
    };

    const TASA_PLASTICO = 0.45; // EUR/kg (tasa vigente Ley 7/2022)
    // Total de botes plásticos individuales (ya expandido por unidades_por_envase).
    const totalBotes = rows.reduce((s, r) => s + parseFloat(r.unidades_consumidas) * calcMultBote(r), 0);
    const totalEnvases = rows.reduce((s, r) => s + parseFloat(r.unidades_consumidas), 0);
    const totalKgPlastico = rows.reduce(
      (s, r) => s + parseFloat(r.unidades_consumidas) * calcMultBote(r) * (r.peso_plastico_kg !== null && r.peso_plastico_kg !== undefined ? parseFloat(r.peso_plastico_kg) : 0),
      0,
    );
    const totalCoste = rows.reduce((s, r) => s + parseFloat(r.unidades_consumidas) * parseFloat(r.precio_ud), 0);
    const impuestoPlastico = totalKgPlastico * TASA_PLASTICO;

    // Materiales sin peso configurado → riesgo declaración incompleta.
    const sinPesoConfigurado = rows
      .filter(r => r.peso_plastico_kg === null || r.peso_plastico_kg === undefined)
      .map(r => `${r.codigo} (${r.nombre})`);

    const BOM = '\uFEFF';
    const sep = ';';
    const headers = ['Codigo', 'Material', 'Botes/uds por envase', 'Peso plastico/bote (kg)', 'Envases consumidos', 'Botes plasticos totales', 'Kg plastico total', 'Coste material (EUR)', 'Num ordenes', 'Primera fecha', 'Ultima fecha'];
    const lines = rows.map(r => {
      const envases = parseFloat(r.unidades_consumidas);
      const mult = calcMultBote(r);
      const botesTotal = envases * mult;
      const tienePeso = r.peso_plastico_kg !== null && r.peso_plastico_kg !== undefined;
      const pesoBote = tienePeso ? parseFloat(r.peso_plastico_kg) : 0;
      const pesoLabel = tienePeso ? pesoBote.toFixed(4) : 'PESO NO CONFIGURADO';
      const kgTotalLabel = tienePeso ? (botesTotal * pesoBote).toFixed(4) : 'REVISAR';
      return [
        r.codigo, r.nombre,
        mult.toString(),
        pesoLabel,
        envases.toFixed(0),
        botesTotal.toFixed(0),
        kgTotalLabel,
        (envases * parseFloat(r.precio_ud)).toFixed(2),
        r.num_ordenes,
        r.primera_fecha, r.ultima_fecha,
      ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(sep);
    });

    lines.push('');
    lines.push(['', 'TOTALES', '', '', totalEnvases.toFixed(0), totalBotes.toFixed(0), totalKgPlastico.toFixed(4), totalCoste.toFixed(2), '', '', ''].map(v => '"' + v + '"').join(sep));
    lines.push(['', `IMPUESTO PLASTICO (${totalKgPlastico.toFixed(2)} kg x ${TASA_PLASTICO} EUR/kg)`, '', '', '', '', '', impuestoPlastico.toFixed(2), '', '', ''].map(v => '"' + v + '"').join(sep));
    lines.push(['', `Periodo: ${desde} a ${hasta}`, '', '', '', '', '', '', '', '', ''].map(v => '"' + v + '"').join(sep));
    if (sinPesoConfigurado.length > 0) {
      lines.push('');
      lines.push(['', `AVISO: ${sinPesoConfigurado.length} materiales sin peso_plastico configurado — declaración incompleta. Revisar y configurar peso por bote en cada ficha de producto:`, '', '', '', '', '', '', '', '', ''].map(v => '"' + v + '"').join(sep));
      for (const codigo of sinPesoConfigurado) {
        lines.push(['', codigo, '', '', '', '', '', '', '', '', ''].map(v => '"' + v + '"').join(sep));
      }
    }

    const csv = BOM + headers.join(sep) + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-plastico-${desde.slice(0,4)}.csv"`);
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── INFORME MATERIALES (todos los materiales agrupados) ─────────────────────
// Regla de contabilización (def. usuario):
//   - El consumo de embalaje SOLO cuenta cuando el pedido cliente está
//     **confirmado / en_produccion / completado** (es decir, NO nuevo y NO
//     cancelado). La fabricación/envasado interno NO suma — sumamos por venta,
//     no por producción.
//   - Si un pedido confirmado se cancela, deja de aparecer automáticamente
//     (la query se recalcula en vivo en cada descarga; no hay snapshot).
//
// Fuente: para cada línea de pedido contabilizable, buscamos la receta de
// envasado del producto envasado (PE) y expandimos a sus componentes:
//   envase          → 1 unidad × cantidad_pe (envases_por_bote)
//   etiqueta        → etiquetas_por_bote × cantidad_pe
//   caja            → ceil(cantidad_pe / unidades_por_caja)
// El palet (peso_pale_vacio_kg) se suma como bloque sintético "Madera" porque
// no es un producto referenciado, sólo un peso libre en la receta.
router.get('/informe-materiales', async (req, res) => {
  try {
    const desde = req.query.desde as string || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const hasta = req.query.hasta as string || new Date().toISOString().slice(0, 10);

    // Periodo: pedidos cuyo `created_at` cae en el rango. Si el pedido se
    // cancela posteriormente queda fuera por el filtro de estado.
    const ESTADOS_VALIDOS = ['confirmado', 'en_produccion', 'completado'];

    const { rows } = await pool.query<{
      codigo: string;
      nombre: string;
      material_embalaje: string | null;
      peso_material_vacio_kg: string | null;
      unidades_por_envase: string | null;
      envases_consumidos: string;
      num_ordenes: number;
    }>(`
      WITH lineas_periodo AS (
        SELECT
          lp.producto_id AS pe_id,
          lp.cantidad::NUMERIC AS unidades_pe,
          ped.id AS pedido_id
        FROM lineas_pedido lp
        JOIN pedidos ped ON ped.id = lp.pedido_id
        WHERE ped.estado::text = ANY($3::text[])
          AND ped.created_at >= $1::DATE
          AND ped.created_at < ($2::DATE + INTERVAL '1 day')
      ),
      -- Multiplicador M = envases por unidad PE.
      -- Si la receta lleva caja con multiplicador (productos.unidades_por_envase > 1),
      -- M = ese multiplicador. Si no, M = envases_por_bote (default 1).
      embalaje_consumido AS (
        -- Envase: M × unidades_pe
        SELECT re.envase_id AS material_id,
               l.unidades_pe *
                 GREATEST(
                   CASE WHEN re.lleva_caja AND re.caja_id IS NOT NULL
                        THEN COALESCE((SELECT pcaja.unidades_por_envase FROM productos pcaja WHERE pcaja.id = re.caja_id), re.envases_por_bote, 1)
                        ELSE re.envases_por_bote
                   END,
                 1) AS unidades,
               l.pedido_id
          FROM lineas_periodo l
          JOIN recetas_envasado re ON re.producto_envasado_id = l.pe_id AND re.activa = TRUE
         WHERE re.envase_id IS NOT NULL
        UNION ALL
        -- Etiqueta: etiquetas_por_bote × unidades_pe (por unidad PE, no por envase)
        SELECT re.etiqueta_id,
               l.unidades_pe * GREATEST(re.etiquetas_por_bote, 0),
               l.pedido_id
          FROM lineas_periodo l
          JOIN recetas_envasado re ON re.producto_envasado_id = l.pe_id AND re.activa = TRUE
         WHERE re.etiqueta_id IS NOT NULL
        UNION ALL
        -- Caja: usar lp.caja_id explícito si está (modelo nuevo PE=bote).
        -- Si no, caer a receta envasado (modelo legacy donde PE=caja).
        SELECT lp.caja_id AS material_id, lp.cantidad_cajas::NUMERIC AS unidades, ped.id AS pedido_id
          FROM lineas_pedido lp
          JOIN pedidos ped ON ped.id = lp.pedido_id
         WHERE ped.estado::text = ANY($3::text[])
           AND ped.created_at >= $1::DATE
           AND ped.created_at < ($2::DATE + INTERVAL '1 day')
           AND lp.caja_id IS NOT NULL AND lp.cantidad_cajas > 0
        UNION ALL
        SELECT re.caja_id, l.unidades_pe, l.pedido_id
          FROM lineas_periodo l
          JOIN recetas_envasado re ON re.producto_envasado_id = l.pe_id AND re.activa = TRUE
          JOIN lineas_pedido lp2 ON lp2.pedido_id = l.pedido_id AND lp2.producto_id = l.pe_id
         WHERE re.lleva_caja = TRUE AND re.caja_id IS NOT NULL
           AND lp2.caja_id IS NULL   -- solo si no hay caja_id explícita
        UNION ALL
        -- Venta directa de material_embalaje (ej. cliente compra 50 botes sueltos):
        -- la línea ES el material; cuenta 1:1.
        SELECT lp.producto_id AS material_id, lp.cantidad::NUMERIC AS unidades, ped.id AS pedido_id
          FROM lineas_pedido lp
          JOIN pedidos ped ON ped.id = lp.pedido_id
          JOIN productos p ON p.id = lp.producto_id AND p.tipo = 'material_embalaje'
         WHERE ped.estado::text = ANY($3::text[])
           AND ped.created_at >= $1::DATE
           AND ped.created_at < ($2::DATE + INTERVAL '1 day')
      )
      SELECT
        p.codigo,
        p.nombre,
        p.material_embalaje,
        p.peso_material_vacio_kg,
        p.unidades_por_envase,
        SUM(ec.unidades) AS envases_consumidos,
        COUNT(DISTINCT ec.pedido_id)::INT AS num_ordenes
      FROM embalaje_consumido ec
      JOIN productos p ON p.id = ec.material_id
      WHERE p.tipo = 'material_embalaje'
      GROUP BY p.id, p.codigo, p.nombre, p.material_embalaje, p.peso_material_vacio_kg, p.unidades_por_envase
      ORDER BY p.material_embalaje NULLS LAST, p.codigo
    `, [desde, hasta, ESTADOS_VALIDOS]);

    // Palets: peso suelto en kg, agrupado como línea sintética bajo "Madera".
    // Una caja por cada `unidades_por_caja`; un palet por cada `cajas_por_pale`.
    const { rows: palets } = await pool.query<{ peso_kg: string; pedidos: number }>(`
      WITH lineas_periodo AS (
        SELECT lp.producto_id AS pe_id, lp.cantidad::NUMERIC AS unidades_pe, ped.id AS pedido_id
        FROM lineas_pedido lp
        JOIN pedidos ped ON ped.id = lp.pedido_id
        WHERE ped.estado::text = ANY($3::text[])
          AND ped.created_at >= $1::DATE
          AND ped.created_at < ($2::DATE + INTERVAL '1 day')
      )
      SELECT
        COALESCE(SUM(
          CEIL(
            CEIL(l.unidades_pe / GREATEST(re.unidades_por_caja, 1)::NUMERIC)
            / GREATEST(re.cajas_por_pale, 1)::NUMERIC
          ) * re.peso_pale_vacio_kg
        ), 0)::NUMERIC AS peso_kg,
        COUNT(DISTINCT l.pedido_id)::INT AS pedidos
      FROM lineas_periodo l
      JOIN recetas_envasado re ON re.producto_envasado_id = l.pe_id AND re.activa = TRUE
      WHERE re.cajas_por_pale > 0 AND re.peso_pale_vacio_kg > 0
    `, [desde, hasta, ESTADOS_VALIDOS]);

    const palet_kg = parseFloat(palets[0]?.peso_kg ?? '0');
    const palet_pedidos = palets[0]?.pedidos ?? 0;

    // Catálogo completo de material_embalaje — para inferencia por nombre PE
    // cuando no hay receta_envasado activa.
    const { rows: mesCatalogo } = await pool.query<{
      id: string;
      codigo: string;
      nombre: string;
      material_embalaje: string | null;
      peso_material_vacio_kg: string | null;
      unidades_por_envase: string | null;
    }>(
      `SELECT id, codigo, nombre, material_embalaje, peso_material_vacio_kg, unidades_por_envase
       FROM productos WHERE tipo = 'material_embalaje' AND activo = TRUE
       ORDER BY codigo`
    );

    // Pedidos cuyo PE no tiene receta_envasado activa: caen FUERA del cómputo.
    // Lo más típico: PE duplicados por error (typos, "amar" → "cola amarila").
    // Los listamos al final del CSV para que el admin sepa qué falta mapear.
    const { rows: sinReceta } = await pool.query<{
      pe_codigo: string;
      pe_nombre: string;
      pe_tipo: string;
      unidades: string;
      num_pedidos: number;
    }>(`
      SELECT
        p.codigo AS pe_codigo,
        p.nombre AS pe_nombre,
        p.tipo::text AS pe_tipo,
        SUM(lp.cantidad::NUMERIC) AS unidades,
        COUNT(DISTINCT ped.id)::INT AS num_pedidos
      FROM lineas_pedido lp
      JOIN pedidos ped ON ped.id = lp.pedido_id
      JOIN productos p ON p.id = lp.producto_id
      LEFT JOIN recetas_envasado re ON re.producto_envasado_id = lp.producto_id AND re.activa = TRUE
      WHERE ped.estado::text = ANY($3::text[])
        AND ped.created_at >= $1::DATE
        AND ped.created_at < ($2::DATE + INTERVAL '1 day')
        AND p.tipo = 'producto_envasado'
        AND re.id IS NULL
        -- material_embalaje vendido directo SÍ se cuenta (rama UNION arriba),
        -- así que sólo flagueamos PEs sin receta.
      GROUP BY p.id, p.codigo, p.nombre, p.tipo
      ORDER BY SUM(lp.cantidad::NUMERIC) DESC
    `, [desde, hasta, ESTADOS_VALIDOS]);

    type Detalle = {
      codigo: string;
      nombre: string;
      envases: number;
      multiplicador: number;
      piezas: number;
      peso_unitario_kg: number;
      peso_total_kg: number;
      num_ordenes: number;
      tiene_peso: boolean;
    };

    const grupos = new Map<string, Detalle[]>();
    const sinMaterial: Detalle[] = [];
    const sinPeso: Detalle[] = [];

    for (const r of rows) {
      const envases = parseFloat(r.envases_consumidos);
      const mult = r.unidades_por_envase && Number(r.unidades_por_envase) > 0
        ? Number(r.unidades_por_envase) : 1;
      const piezas = envases * mult;
      const tienePeso = r.peso_material_vacio_kg !== null && r.peso_material_vacio_kg !== undefined;
      const pesoUd = tienePeso ? parseFloat(r.peso_material_vacio_kg!) : 0;
      const pesoTotal = piezas * pesoUd;

      const detalle: Detalle = {
        codigo: r.codigo,
        nombre: r.nombre,
        envases,
        multiplicador: mult,
        piezas,
        peso_unitario_kg: pesoUd,
        peso_total_kg: pesoTotal,
        num_ordenes: r.num_ordenes,
        tiene_peso: tienePeso,
      };

      const material = r.material_embalaje?.trim() || null;
      if (!material) {
        sinMaterial.push(detalle);
        continue;
      }
      if (!tienePeso) sinPeso.push(detalle);
      if (!grupos.has(material)) grupos.set(material, []);
      grupos.get(material)!.push(detalle);
    }

    // ── Extras de pedido ───────────────────────────────────────────────────
    // pedido_embalajes_extra: ME añadido manualmente a un pedido (palets, film,
    // etc.) que NO va en albarán/factura. Se suma 1:1 al material correspondiente.
    const { rows: extras } = await pool.query<{
      producto_id: string;
      codigo: string;
      nombre: string;
      material_embalaje: string | null;
      peso_material_vacio_kg: string | null;
      unidades_por_envase: string | null;
      cantidad_total: string;
      num_pedidos: number;
    }>(`
      SELECT p.id AS producto_id, p.codigo, p.nombre,
             p.material_embalaje, p.peso_material_vacio_kg, p.unidades_por_envase,
             SUM(pe.cantidad)::NUMERIC AS cantidad_total,
             COUNT(DISTINCT pe.pedido_id)::INT AS num_pedidos
        FROM pedido_embalajes_extra pe
        JOIN pedidos ped ON ped.id = pe.pedido_id
        JOIN productos p ON p.id = pe.producto_id
       WHERE ped.estado::text = ANY($3::text[])
         AND ped.created_at >= $1::DATE
         AND ped.created_at < ($2::DATE + INTERVAL '1 day')
       GROUP BY p.id, p.codigo, p.nombre, p.material_embalaje, p.peso_material_vacio_kg, p.unidades_por_envase
    `, [desde, hasta, ESTADOS_VALIDOS]);

    for (const e of extras) {
      const envases = parseFloat(e.cantidad_total);
      const mult = e.unidades_por_envase && Number(e.unidades_por_envase) > 0
        ? Number(e.unidades_por_envase) : 1;
      const piezas = envases * mult;
      const tienePeso = e.peso_material_vacio_kg !== null && e.peso_material_vacio_kg !== undefined;
      const pesoUd = tienePeso ? parseFloat(e.peso_material_vacio_kg!) : 0;
      const detalle: Detalle = {
        codigo: e.codigo + ' (extra)',
        nombre: e.nombre,
        envases,
        multiplicador: mult,
        piezas,
        peso_unitario_kg: pesoUd,
        peso_total_kg: piezas * pesoUd,
        num_ordenes: e.num_pedidos,
        tiene_peso: tienePeso,
      };
      const material = e.material_embalaje?.trim() || null;
      if (!material) { sinMaterial.push(detalle); continue; }
      if (!tienePeso) sinPeso.push(detalle);
      if (!grupos.has(material)) grupos.set(material, []);
      grupos.get(material)!.push(detalle);
    }

    // Palets: línea sintética bajo "Madera". No son productos referenciados,
    // sólo viven como peso_pale_vacio_kg en recetas_envasado.
    if (palet_kg > 0) {
      if (!grupos.has('Madera')) grupos.set('Madera', []);
      grupos.get('Madera')!.push({
        codigo: '— palet',
        nombre: 'Palets (peso suelto desde recetas_envasado)',
        envases: palet_pedidos,
        multiplicador: 1,
        piezas: palet_pedidos,
        peso_unitario_kg: palet_pedidos > 0 ? palet_kg / palet_pedidos : 0,
        peso_total_kg: palet_kg,
        num_ordenes: palet_pedidos,
        tiene_peso: true,
      });
    }

    // Orden de materiales — preferimos el orden del catálogo si existe.
    const { rows: tipos } = await pool.query<{ nombre: string; orden: number }>(
      `SELECT nombre, orden FROM tipos_material_embalaje WHERE activo = TRUE`
    );
    const ordenMaterial = new Map(tipos.map(t => [t.nombre, t.orden]));
    const materialesOrdenados = [...grupos.keys()].sort((a, b) => {
      const oa = ordenMaterial.get(a) ?? 1000;
      const ob = ordenMaterial.get(b) ?? 1000;
      return oa - ob || a.localeCompare(b);
    });

    // ── Construir CSV ──────────────────────────────────────────────────────
    // Locale ES: separador campo `;`, decimal `,`. Excel-ES interpreta "0.200"
    // como 200 (punto = miles); para evitarlo formateamos números con coma.
    const BOM = '﻿';
    const sep = ';';
    const num = (n: number, dec = 3): string => n.toFixed(dec).replace('.', ',');
    const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const fila = (vals: unknown[]) => vals.map(q).join(sep);

    const lines: string[] = [];
    lines.push(fila(['Informe de materiales de embalaje', '', '', '', '', '', '']));
    lines.push(fila([`Periodo: ${desde} a ${hasta}`, '', '', '', '', '', '']));
    lines.push(fila(['Base: pedidos confirmados/en producción/completados (excluye nuevos y cancelados)', '', '', '', '', '', '']));
    lines.push('');

    let granTotalKg = 0;
    let granTotalPiezas = 0;
    const resumenPorMaterial: Array<{ material: string; kg: number; piezas: number; productos: number }> = [];

    for (const material of materialesOrdenados) {
      const detalles = grupos.get(material)!;
      const totalKg = detalles.reduce((s, d) => s + d.peso_total_kg, 0);
      const totalPiezas = detalles.reduce((s, d) => s + d.piezas, 0);
      granTotalKg += totalKg;
      granTotalPiezas += totalPiezas;
      resumenPorMaterial.push({ material, kg: totalKg, piezas: totalPiezas, productos: detalles.length });

      // Cabecera bloque material
      lines.push(fila([`=== ${material.toUpperCase()} ===`, '', '', '', '', '', '']));
      lines.push(fila([`Total: ${num(totalKg)} kg`, `${num(totalPiezas, 0)} piezas`, `${detalles.length} productos`, '', '', '', '']));
      lines.push(fila(['Código', 'Producto', 'Envases consumidos', 'Multiplicador', 'Piezas totales', 'Peso vacío (kg/ud)', 'Peso total (kg)', 'Nº órdenes']));
      // Detalles ordenados por peso descendente dentro del material
      const detallesOrden = [...detalles].sort((a, b) => b.peso_total_kg - a.peso_total_kg);
      for (const d of detallesOrden) {
        lines.push(fila([
          d.codigo,
          d.nombre,
          num(d.envases, 0),
          d.multiplicador,
          num(d.piezas, 0),
          d.tiene_peso ? num(d.peso_unitario_kg, 4) : 'SIN PESO',
          d.tiene_peso ? num(d.peso_total_kg) : 'REVISAR',
          d.num_ordenes,
        ]));
      }
      lines.push('');
    }

    // Resumen final
    lines.push(fila(['=== RESUMEN ===', '', '', '', '', '', '', '']));
    lines.push(fila(['Material', 'Peso total (kg)', 'Piezas totales', 'Nº productos', '', '', '', '']));
    for (const r of resumenPorMaterial) {
      lines.push(fila([r.material, num(r.kg), num(r.piezas, 0), r.productos, '', '', '', '']));
    }
    lines.push(fila(['TOTAL', num(granTotalKg), num(granTotalPiezas, 0), '', '', '', '', '']));

    // Productos sin material asignado
    if (sinMaterial.length > 0) {
      lines.push('');
      lines.push(fila([`⚠ SIN MATERIAL ASIGNADO (${sinMaterial.length} productos consumidos en periodo)`, '', '', '', '', '', '', '']));
      lines.push(fila(['Código', 'Producto', 'Envases consumidos', 'Acción', '', '', '', '']));
      for (const d of sinMaterial.sort((a, b) => b.envases - a.envases)) {
        lines.push(fila([d.codigo, d.nombre, num(d.envases, 0), 'Asignar material en ficha', '', '', '', '']));
      }
    }

    // Productos con material pero sin peso
    if (sinPeso.length > 0) {
      lines.push('');
      lines.push(fila([`⚠ SIN PESO ASIGNADO (${sinPeso.length} productos — no cuentan en kg totales)`, '', '', '', '', '', '', '']));
      lines.push(fila(['Código', 'Producto', 'Envases consumidos', 'Acción', '', '', '', '']));
      for (const d of sinPeso.sort((a, b) => b.envases - a.envases)) {
        lines.push(fila([d.codigo, d.nombre, num(d.envases, 0), 'Configurar peso_material_vacio_kg', '', '', '', '']));
      }
    }

    // Pedidos con PE vendido pero SIN receta de envasado: no se contabilizan.
    // Causa típica: PE duplicado por error en la creación de fórmulas.
    if (sinReceta.length > 0) {
      const totalUnidades = sinReceta.reduce((s, r) => s + parseFloat(r.unidades), 0);
      const totalPedidos = sinReceta.reduce((s, r) => s + r.num_pedidos, 0);
      lines.push('');
      lines.push(fila([
        `⚠ PEDIDOS NO CONTABILIZADOS — PE sin receta de envasado activa (${sinReceta.length} productos · ${num(totalUnidades, 0)} ud · ${totalPedidos} pedidos)`,
        '', '', '', '', '', '', '',
      ]));
      lines.push(fila(['Código PE', 'Producto envasado', 'Unidades vendidas', 'Nº pedidos', 'Acción', '', '', '']));
      for (const r of sinReceta) {
        lines.push(fila([
          r.pe_codigo,
          r.pe_nombre,
          num(parseFloat(r.unidades), 0),
          r.num_pedidos,
          'Crear receta envasado en Escandallo (sin receta no se contabiliza)',
          '', '', '',
        ]));
      }
    }

    const csv = BOM + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-materiales-${desde.slice(0,4)}.csv"`);
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
