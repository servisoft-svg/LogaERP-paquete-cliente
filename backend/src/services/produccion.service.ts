/**
 * produccion.service.ts
 * =====================
 * Núcleo del ERP: Confirmar Orden de Producción.
 *
 * Garantías:
 *  - Transacción SERIALIZABLE → no hay race conditions entre órdenes.
 *  - FIFO: lote que caduca antes (o más antiguo si sin caducidad).
 *  - Si falta stock en cualquier ingrediente → ROLLBACK total.
 *  - NUMERIC vía pg: tratamos los strings como Decimal con parseFloat (suficiente,
 *    ya que la precisión real vive en PostgreSQL con NUMERIC(20,6)).
 */

import { PoolClient } from 'pg';
import { pool, withSerializableTransaction, acquireProductLocks } from '../db/pool';
import { toNum }  from '../types';
import { alertaService } from './alerta.service';
import { automatizacionesService } from './automatizaciones.service';
import { fetchMeteoSnapshot } from './meteo.service';
import { nextLoteCode } from '../lib/loteCode';

interface LoteFIFO {
  id: string;
  cantidad_actual: string;
  fecha_caducidad: Date | null;
  fecha_entrada: Date;
}

interface IngredienteConsumo {
  materia_prima_id: string;
  nombre_mp: string;
  cantidad_base: number;       // cantidad por unidad de rendimiento
  porcentaje_merma: number;
  unidad_medida: string;
}

export interface ResultadoConfirmacion {
  orden_id: string;
  numero_orden: string;
  lote_producido: string;
  consumos: Array<{ producto: string; cantidad_consumida: number; lotes_usados: string[] }>;
}

class ProduccionService {
  /**
   * Confirma una orden de producción:
   *  1. Valida estado (solo 'borrador' o 'confirmada' → en_proceso)
   *  2. Calcula consumos reales con merma
   *  3. FIFO sobre lotes disponibles (estado='aprobado', cantidad_actual>0)
   *  4. Descuenta stock de lotes y de producto
   *  5. Crea lote de producto terminado
   *  6. Registra en stock_moves
   *  7. Actualiza estado de la orden
   *  8. Dispara comprobación de alertas
   */
  async confirmarOrden(
    ordenId: string,
    usuarioId?: string,
    extra?: { ph?: number; foto_url?: string; foto_urls?: string[]; solidos?: number; viscosidad?: number; fecha_fabricacion?: string; cantidad_real_producida?: number; qc_fuera_de_rango?: boolean; registro_limpieza?: string; nota_qc?: string; fecha_inicio_cliente?: string; ingredientes_ajustados?: { materia_prima_id: string; cantidad: number }[] }
  ): Promise<ResultadoConfirmacion> {
    // Closure variables para disparar automatizaciones tras COMMIT
    let prodFinalId: string | null = null;
    let lotePTId: string | null = null;
    const consumedProductIds: string[] = [];
    // qcOk se decide DENTRO de la transacción tras validar server-side (Fix C-3).
    // Inicialmente true; se invalida si algún parámetro está fuera de rango.
    let qcOk = true;
    const desviacionesQC: string[] = [];

    // Snapshot meteorológico ANTES del BEGIN de la transacción (timeout 3s,
    // fail-soft: si falla la API → null, fabricación continúa). Permite
    // correlacionar mermas con condiciones climáticas externas.
    const meteo = await fetchMeteoSnapshot();

    const result = await withSerializableTransaction(async (client) => {
      // ── 1. Cargar orden ────────────────────────────────────────────────
      const { rows: [orden] } = await client.query<{
        id: string; numero_orden: string; receta_id: string;
        cantidad_planificada: string; estado: string;
      }>(
        `SELECT id, numero_orden, receta_id, cantidad_planificada, estado
         FROM ordenes_produccion WHERE id = $1 FOR UPDATE`,
        [ordenId]
      );

      if (!orden) throw new Error('ORDEN_NO_ENCONTRADA');
      if (!['borrador', 'confirmada'].includes(orden.estado)) {
        throw new Error(`ESTADO_INVALIDO:${orden.estado}`);
      }

      const cantidadPlanificada = toNum(orden.cantidad_planificada);

      // ── 2. Cargar receta + ingredientes + RANGOS QC (Fix C-3) ─────────
      const { rows: [receta] } = await client.query<{
        id: string; rendimiento: string; producto_id: string; nombre: string;
        ph_min: string | null; ph_max: string | null;
        solidos_min: string | null; solidos_max: string | null;
        viscosidad_min: string | null; viscosidad_max: string | null;
      }>(
        `SELECT r.id, r.rendimiento, r.producto_id, p.nombre,
                r.ph_min, r.ph_max, r.solidos_min, r.solidos_max,
                r.viscosidad_min, r.viscosidad_max
         FROM recetas r JOIN productos p ON p.id = r.producto_id
         WHERE r.id = $1`,
        [orden.receta_id]
      );

      if (!receta) throw new Error('RECETA_NO_ENCONTRADA');

      // ── Validación QC server-side (Fix C-3) ────────────────────────────
      // ANTES: qcOk se decidía con un boolean del frontend (extra.qc_fuera_de_rango).
      // Cualquier bug FE o payload manipulado podía meter en 'aprobado' un lote
      // fuera de spec. AHORA: backend compara los valores medidos contra los
      // rangos definidos en la receta. El flag del cliente queda solo como
      // hint informativo si el frontend ya lo había detectado primero.
      function fueraDeRango(valor: number | undefined, min: string | null, max: string | null, label: string): void {
        if (valor === undefined || valor === null || !Number.isFinite(valor)) return; // sin medición → no se valida
        const minN = min !== null ? parseFloat(min) : null;
        const maxN = max !== null ? parseFloat(max) : null;
        if (minN !== null && valor < minN) {
          qcOk = false;
          desviacionesQC.push(`${label}=${valor} < min=${minN}`);
        }
        if (maxN !== null && valor > maxN) {
          qcOk = false;
          desviacionesQC.push(`${label}=${valor} > max=${maxN}`);
        }
      }
      fueraDeRango(extra?.ph,         receta.ph_min,         receta.ph_max,         'pH');
      fueraDeRango(extra?.solidos,    receta.solidos_min,    receta.solidos_max,    'sólidos');
      fueraDeRango(extra?.viscosidad, receta.viscosidad_min, receta.viscosidad_max, 'viscosidad');
      // Si el frontend ya marcó fuera de rango pero los valores medidos no
      // se enviaron (operario marcó manualmente "fuera de rango"), respetar
      // esa decisión también.
      if (extra?.qc_fuera_de_rango === true && qcOk) {
        qcOk = false;
        desviacionesQC.push('marcado_manualmente_por_operario');
      }

      const rendimiento = toNum(receta.rendimiento);
      const multiplicador = cantidadPlanificada / rendimiento;

      const { rows: ingredientes } = await client.query<IngredienteConsumo>(
        `SELECT
           ir.materia_prima_id,
           p.nombre AS nombre_mp,
           ir.cantidad::float8 AS cantidad_base,
           ir.porcentaje_merma::float8 AS porcentaje_merma,
           ir.unidad_medida
         FROM ingredientes_receta ir
         JOIN productos p ON p.id = ir.materia_prima_id
         WHERE ir.receta_id = $1`,
        [receta.id]
      );

      if (ingredientes.length === 0) throw new Error('RECETA_SIN_INGREDIENTES');

      // ── 3 & 4. FIFO: descontar cada ingrediente ────��──────────────────
      const consumosLog: ResultadoConfirmacion['consumos'] = [];
      let costeConsumos = 0;

      // Pre-fetch: lock all ingredient products for stock update (avoids N+1 per lote)
      const ingProductIds = ingredientes.map(i => i.materia_prima_id);
      // Advisory lock por producto: serializa con /consumir y otros mutadores de stock.
      // Producto terminado también incluido (se crea lote PT abajo).
      await acquireProductLocks(client, [...ingProductIds, receta.producto_id]);
      const { rows: stockRows } = await client.query<{ id: string; stock_actual: string }>(
        `SELECT id, stock_actual FROM productos WHERE id = ANY($1) FOR UPDATE`,
        [ingProductIds]
      );
      const stockMap = new Map(stockRows.map(r => [r.id, toNum(r.stock_actual)]));

      // Mapa de overrides: materia_prima_id → cantidad ajustada por el operario.
      // Si existe override, se usa esa cantidad para descontar stock en vez de
      // la calculada de la receta (permite ajustes en vivo durante fabricación).
      const overrideMap = new Map<string, number>();
      for (const o of (extra?.ingredientes_ajustados ?? [])) {
        overrideMap.set(o.materia_prima_id, o.cantidad);
      }

      for (const ing of ingredientes) {
        const cantidadTeorica = ing.cantidad_base * multiplicador * (1 + ing.porcentaje_merma / 100);
        const cantidadReal = overrideMap.get(ing.materia_prima_id) ?? cantidadTeorica;

        // Lotes disponibles FIFO (excluir cantidades reservadas)
        const { rows: lotes } = await client.query<LoteFIFO & { precio_compra: string; cantidad_disponible: string }>(
          `SELECT l.id, l.cantidad_actual, l.precio_compra,
             l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id AND r.estado = 'activa'), 0) AS cantidad_disponible,
             l.fecha_caducidad, l.fecha_entrada
           FROM lotes l
           WHERE l.producto_id = $1
             AND l.estado = 'aprobado'
             AND l.cantidad_actual > 0
           ORDER BY
             l.fecha_caducidad ASC NULLS LAST,
             l.fecha_entrada   ASC
           FOR UPDATE`,
          [ing.materia_prima_id]
        );

        const totalDisponible = lotes.reduce((s, l) => s + Math.max(0, toNum(l.cantidad_disponible ?? l.cantidad_actual)), 0);
        if (totalDisponible < cantidadReal) {
          throw new Error(
            `STOCK_INSUFICIENTE:${ing.nombre_mp}:necesario=${cantidadReal.toFixed(6)}:disponible=${totalDisponible.toFixed(6)}`
          );
        }

        // Descontar FIFO lote a lote — batch lote updates + stock_moves
        let restante = cantidadReal;
        const lotesUsados: string[] = [];
        const moveValues: string[] = [];
        const moveParams: unknown[] = [];
        let paramIdx = 1;

        for (const lote of lotes) {
          if (restante <= 0) break;

          const disponible = Math.max(0, toNum(lote.cantidad_disponible ?? lote.cantidad_actual));
          if (disponible <= 0) continue;
          const consumir = Math.min(disponible, restante);
          const nuevoQty = toNum(lote.cantidad_actual) - consumir;

          await client.query(
            `UPDATE lotes SET cantidad_actual = $1::NUMERIC WHERE id = $2`,
            [nuevoQty.toFixed(6), lote.id]
          );

          // Use pre-fetched stock (track running total)
          const antes = stockMap.get(ing.materia_prima_id) ?? 0;
          const despues = antes - consumir;
          stockMap.set(ing.materia_prima_id, despues);

          // Collect stock_move for batch insert
          moveValues.push(`($${paramIdx}, $${paramIdx+1}, 'produccion_consumo', $${paramIdx+2}::NUMERIC, $${paramIdx+3}::NUMERIC, $${paramIdx+4}::NUMERIC, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7})`);
          moveParams.push(
            ing.materia_prima_id, lote.id,
            (-consumir).toFixed(6), antes.toFixed(6), despues.toFixed(6),
            ordenId, usuarioId ?? null, `Consumo en orden ${orden.numero_orden}`
          );
          paramIdx += 8;

          const precioLote = toNum((lote as any).precio_compra ?? '0');
          costeConsumos += consumir * precioLote;

          restante -= consumir;
          lotesUsados.push(lote.id);
        }

        // Batch insert stock_moves for this ingredient
        if (moveValues.length > 0) {
          await client.query(
            `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
             VALUES ${moveValues.join(', ')}`,
            moveParams
          );
        }

        // Single stock update per ingredient (instead of per-lote)
        const finalStock = stockMap.get(ing.materia_prima_id) ?? 0;
        await client.query(
          `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
          [finalStock.toFixed(6), ing.materia_prima_id]
        );

        consumosLog.push({
          producto: ing.nombre_mp,
          cantidad_consumida: cantidadReal,
          lotes_usados: lotesUsados,
        });
        consumedProductIds.push(ing.materia_prima_id);
      }

      // ── 5. Crear lote de producto terminado (usa cantidad_real si disponible) ──
      const cantidadReal = extra?.cantidad_real_producida ?? cantidadPlanificada;
      const merma = cantidadPlanificada - cantidadReal;
      const mermaPct = cantidadPlanificada > 0 ? (merma / cantidadPlanificada) * 100 : 0;

      // Código de lote en formato YYL### (e.g. 26E265). Compartido con creación
      // manual desde lotes.routes — el advisory_xact_lock dentro de nextLoteCode
      // serializa ambos flujos sobre el mismo prefijo mensual.
      const loteInterno = await nextLoteCode(client);

      // Calculate cost from consumed ingredients
      const costePorUd = cantidadReal > 0 ? costeConsumos / cantidadReal : 0;

      // Estado del lote según validación QC server-side (Fix C-3).
      // qcOk se decidió arriba comparando valores medidos contra rangos
      // de la receta. NO se confía en el flag del cliente.
      const loteEstado = qcOk ? 'aprobado' : 'cuarentena';

      // Leer stock ANTES del INSERT para registrar cantidad_antes correcto.
      const { rows: [ptStockAntes] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`,
        [receta.producto_id]
      );
      const antespt = toNum(ptStockAntes.stock_actual);

      const { rows: [lotePT] } = await client.query<{ id: string }>(
        `INSERT INTO lotes
           (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, fecha_entrada, precio_compra)
         VALUES ($1, $2, $3::NUMERIC, $3::NUMERIC, $5::estado_lote, CURRENT_DATE, $4::NUMERIC)
         RETURNING id`,
        [receta.producto_id, loteInterno, cantidadReal.toFixed(6), costePorUd.toFixed(6), loteEstado]
      );
      prodFinalId = receta.producto_id;
      lotePTId = lotePT.id;

      // Tras INSERT, el trigger fn_trg_lotes_stock_actual recalcula
      // productos.stock_actual = SUM(lotes WHERE estado='aprobado').
      //   - Lote 'aprobado'   → stock sube cantidadReal.
      //   - Lote 'cuarentena' → stock NO cambia (lote no disponible hasta aprobarse).
      // NO hacer UPDATE manual aquí: causaría doble conteo en aprobado y suma
      // espuria en cuarentena (bug histórico que el usuario reportó).
      const { rows: [ptStockDespues] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1`,
        [receta.producto_id]
      );
      const despuespt = toNum(ptStockDespues.stock_actual);

      // Stock move: registra producción independientemente del estado del lote.
      // Si lote en cuarentena, antespt == despuespt (stock_actual no varió),
      // pero el move queda como evidencia de que se PRODUJO la cantidad.
      // Cuando QC apruebe el lote, lotes.routes.ts inserta el stock_move 'entrada'
      // con el delta real al pasar de cuarentena → aprobado.
      await client.query(
        `INSERT INTO stock_moves
           (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
         VALUES ($1, $2, 'produccion_salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7, $8)`,
        [
          receta.producto_id,
          lotePT.id,
          cantidadReal.toFixed(6),
          antespt.toFixed(6),
          despuespt.toFixed(6),
          ordenId,
          usuarioId ?? null,
          qcOk
            ? `Producción confirmada orden ${orden.numero_orden}`
            : `Producción orden ${orden.numero_orden} → lote en cuarentena (QC fuera de rango). Stock no disponible hasta aprobación.`,
        ]
      );

      // ── 6. Actualizar orden ───────────────────────────────────────────
      // operario_id: registrar QUIÉN ejecutó la orden. Si la orden ya tenía
      // operario asignado al planificarla, lo sobrescribimos con el ejecutor
      // real (es la persona que pulsa "Confirmar fabricación" y por tanto
      // hace el trabajo). Si usuarioId es NULL (no debería pasar tras login),
      // se preserva el valor previo.
      await client.query(
        `UPDATE ordenes_produccion
         SET estado = 'completada',
             cantidad_producida = $1::NUMERIC,
             cantidad_real_producida = $10::NUMERIC,
             merma_proceso     = $11::NUMERIC,
             merma_pct         = $12::NUMERIC,
             lote_producido_id  = $2,
             fecha_inicio       = COALESCE(fecha_inicio, $13::TIMESTAMPTZ, NOW()),
             fecha_fin          = NOW(),
             ph                 = COALESCE($4, ph),
             foto_url           = COALESCE($5, foto_url),
             foto_urls          = COALESCE($6::JSONB, foto_urls),
             solidos            = COALESCE($7, solidos),
             viscosidad         = COALESCE($8, viscosidad),
             fecha_fabricacion  = COALESCE($9::TIMESTAMPTZ, fecha_fabricacion, NOW()),
             meteo              = COALESCE($14::JSONB, meteo),
             operario_id        = COALESCE($15::UUID, operario_id),
             locked_by          = NULL,
             locked_at          = NULL
         WHERE id = $3`,
        [
          cantidadPlanificada.toFixed(6), lotePT.id, ordenId,
          extra?.ph ?? null,
          extra?.foto_url ?? null,
          extra?.foto_urls && extra.foto_urls.length > 0 ? JSON.stringify(extra.foto_urls) : null,
          extra?.solidos ?? null,
          extra?.viscosidad ?? null,
          extra?.fecha_fabricacion ?? null,
          cantidadReal.toFixed(6),
          merma.toFixed(6),
          mermaPct.toFixed(2),
          extra?.fecha_inicio_cliente ?? null,
          meteo ? JSON.stringify(meteo) : null,
          usuarioId ?? null,
        ]
      );

      // ── 7. QC annotation (inside transaction) ────────────────────────
      // Nota automática del backend si hay desviaciones detectadas server-side
      // (Fix C-3). La nota_qc del operario se concatena además.
      if (!qcOk && desviacionesQC.length > 0) {
        const notaAuto = `[QC server-side] Lote en cuarentena. Desviaciones: ${desviacionesQC.join('; ')}`;
        await client.query(
          `UPDATE ordenes_produccion SET notas = COALESCE(notas, '') || E'\n' || $1 WHERE id = $2`,
          [notaAuto, ordenId]
        );
      }
      if (extra?.nota_qc) {
        await client.query(
          `UPDATE ordenes_produccion SET notas = COALESCE(notas, '') || E'\n' || $1 WHERE id = $2`,
          [extra.nota_qc, ordenId]
        );
      }

      // ── 8. Registro limpieza (inside transaction) ─────────────────────
      if (extra?.registro_limpieza) {
        await client.query(
          `UPDATE ordenes_produccion SET registro_limpieza = $1 WHERE id = $2`,
          [extra.registro_limpieza, ordenId]
        );
        await client.query(
          `UPDATE lotes SET registro_limpieza = $1 WHERE lote_interno = $2`,
          [extra.registro_limpieza, loteInterno]
        );
      }

      // ── 9. Mark linked pedido as fabricado (inside transaction) ────────
      await client.query(
        `UPDATE pedidos SET estado = 'fabricado' WHERE orden_produccion_id = $1 AND estado IN ('confirmado', 'en_produccion')`,
        [ordenId]
      );

      // ── 10. Auditoría ────────────────────────────────────────────────
      await client.query(
        `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
         VALUES ($1, 'CONFIRMAR_PRODUCCION', 'ordenes_produccion', $2, $3)`,
        [usuarioId ?? null, ordenId, `Orden ${orden.numero_orden} confirmada y completada`]
      );

      return {
        orden_id:       ordenId,
        numero_orden:   orden.numero_orden,
        lote_producido: loteInterno,
        consumos:       consumosLog,
      };
    });

    // Post-COMMIT: disparar automatizaciones (fire-and-forget)
    setImmediate(() => {
      if (lotePTId) {
        automatizacionesService.intentarAutoAprobacionLote(lotePTId, qcOk)
          .catch(err => console.error('[auto.aprobacion]', err));
      }
      if (prodFinalId) {
        automatizacionesService.checkStockAndTrigger(prodFinalId)
          .catch(err => console.error('[auto.checkStock]', err));
      }
      for (const mpId of consumedProductIds) {
        automatizacionesService.checkStockAndTrigger(mpId)
          .catch(err => console.error('[auto.checkStock-mp]', err));
      }
    });

    return result;
  }

  /** Crea orden en estado borrador */
  async crearOrden(payload: {
    receta_id: string;
    cantidad_planificada: number;
    fecha_planificada?: string;
    notas?: string;
    operario_id?: string;
    creado_por_id?: string;
    cliente?: string;
    cliente_id?: string;
  }): Promise<{ id: string; numero_orden: string }> {
    const { rows: [orden] } = await pool.query(
      `INSERT INTO ordenes_produccion
         (receta_id, cantidad_planificada, fecha_planificada, notas, operario_id, creado_por_id, cliente, cliente_id)
       VALUES ($1, $2::NUMERIC, $3, $4, $5, $6, $7, $8)
       RETURNING id, numero_orden`,
      [
        payload.receta_id,
        payload.cantidad_planificada.toFixed(6),
        payload.fecha_planificada ?? null,
        payload.notas ?? null,
        payload.operario_id ?? null,
        payload.creado_por_id ?? null,
        payload.cliente ?? null,
        payload.cliente_id ?? null,
      ]
    );
    return orden;
  }

  async listarOrdenes(filtro?: { estado?: string; limit?: number; offset?: number }): Promise<{ rows: unknown[]; total: number }> {
    const limit  = Math.min(filtro?.limit  ?? 100, 500);
    const offset = filtro?.offset ?? 0;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filtro?.estado) {
      conditions.push(`op.estado = $${paramIdx++}`);
      params.push(filtro.estado);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) FROM ordenes_produccion op ${where}`;
    const dataSql = `
      SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre
      FROM ordenes_produccion op
      JOIN recetas r ON r.id = op.receta_id
      JOIN productos p ON p.id = r.producto_id
      ${where}
      ORDER BY op.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, [...params, limit, offset]),
    ]);

    return { rows: dataRes.rows, total: parseInt(countRes.rows[0].count, 10) };
  }
}

export const produccionService = new ProduccionService();
