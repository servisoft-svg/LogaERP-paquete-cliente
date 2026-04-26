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
import { pool, withSerializableTransaction } from '../db/pool';
import { toNum }  from '../types';
import { alertaService } from './alerta.service';

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
    extra?: { ph?: number; foto_url?: string; foto_urls?: string[]; solidos?: number; viscosidad?: number; fecha_fabricacion?: string; cantidad_real_producida?: number }
  ): Promise<ResultadoConfirmacion> {
    return withSerializableTransaction(async (client) => {
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

      // ── 2. Cargar receta + ingredientes ───────────────────────────────
      const { rows: [receta] } = await client.query<{
        id: string; rendimiento: string; producto_id: string; nombre: string;
      }>(
        `SELECT r.id, r.rendimiento, r.producto_id, p.nombre
         FROM recetas r JOIN productos p ON p.id = r.producto_id
         WHERE r.id = $1`,
        [orden.receta_id]
      );

      if (!receta) throw new Error('RECETA_NO_ENCONTRADA');

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

      // ── 3 & 4. FIFO: descontar cada ingrediente ───────────────────────
      const consumosLog: ResultadoConfirmacion['consumos'] = [];
      let costeConsumos = 0; // Accumulate total cost of consumed ingredients

      for (const ing of ingredientes) {
        // Cantidad real considerando merma
        const cantidadNeta = ing.cantidad_base * multiplicador;
        const cantidadReal = cantidadNeta * (1 + ing.porcentaje_merma / 100);

        // Lotes disponibles FIFO (excluir cantidades reservadas)
        const { rows: lotes } = await client.query<LoteFIFO & { precio_compra: string }>(
          `SELECT l.id, l.cantidad_actual, l.precio_compra,
             l.cantidad_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.lote_id = l.id), 0) AS cantidad_disponible,
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

        // Verificar suficiencia total (sobre disponible, no reservado)
        const totalDisponible = lotes.reduce((s, l) => s + Math.max(0, toNum((l as any).cantidad_disponible ?? l.cantidad_actual)), 0);
        if (totalDisponible < cantidadReal) {
          throw new Error(
            `STOCK_INSUFICIENTE:${ing.nombre_mp}:necesario=${cantidadReal.toFixed(6)}:disponible=${totalDisponible.toFixed(6)}`
          );
        }

        // Descontar FIFO lote a lote
        let restante = cantidadReal;
        const lotesUsados: string[] = [];

        for (const lote of lotes) {
          if (restante <= 0) break;

          const disponible = Math.max(0, toNum((lote as any).cantidad_disponible ?? lote.cantidad_actual));
          if (disponible <= 0) continue;
          const consumir   = Math.min(disponible, restante);
          const nuevoQty   = disponible - consumir;

          // Actualizar lote
          await client.query(
            `UPDATE lotes SET cantidad_actual = $1::NUMERIC WHERE id = $2`,
            [nuevoQty.toFixed(6), lote.id]
          );

          // Stock move de consumo
          const { rows: [stockAntes] } = await client.query<{ stock_actual: string }>(
            `SELECT stock_actual FROM productos WHERE id = $1`,
            [ing.materia_prima_id]
          );
          const antes   = toNum(stockAntes.stock_actual);
          const despues = antes - consumir;

          await client.query(
            `UPDATE productos SET stock_actual = $1::NUMERIC WHERE id = $2`,
            [despues.toFixed(6), ing.materia_prima_id]
          );

          await client.query(
            `INSERT INTO stock_moves
               (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, orden_id, usuario_id, motivo)
             VALUES ($1, $2, 'produccion_consumo', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7, $8)`,
            [
              ing.materia_prima_id,
              lote.id,
              (-consumir).toFixed(6),
              antes.toFixed(6),
              despues.toFixed(6),
              ordenId,
              usuarioId ?? null,
              `Consumo en orden ${orden.numero_orden}`,
            ]
          );

          // Accumulate cost
          const precioLote = parseFloat((lote as any).precio_compra ?? '0');
          costeConsumos += consumir * precioLote;

          restante -= consumir;
          lotesUsados.push(lote.id);
        }

        consumosLog.push({
          producto: ing.nombre_mp,
          cantidad_consumida: cantidadReal,
          lotes_usados: lotesUsados,
        });
      }

      // ── 5. Crear lote de producto terminado (usa cantidad_real si disponible) ──
      const cantidadReal = extra?.cantidad_real_producida ?? cantidadPlanificada;
      const merma = cantidadPlanificada - cantidadReal;
      const mermaPct = cantidadPlanificada > 0 ? (merma / cantidadPlanificada) * 100 : 0;

      const loteInterno = `PT-${orden.numero_orden}-${Date.now()}`;

      // Calculate cost from consumed ingredients
      const costePorUd = cantidadReal > 0 ? costeConsumos / cantidadReal : 0;

      const { rows: [lotePT] } = await client.query<{ id: string }>(
        `INSERT INTO lotes
           (producto_id, lote_interno, cantidad_inicial, cantidad_actual, estado, fecha_entrada, precio_compra)
         VALUES ($1, $2, $3::NUMERIC, $3::NUMERIC, 'aprobado', CURRENT_DATE, $4::NUMERIC)
         RETURNING id`,
        [receta.producto_id, loteInterno, cantidadReal.toFixed(6), costePorUd.toFixed(6)]
      );

      // Actualizar stock producto terminado (con version para optimistic locking)
      const { rows: [ptStock] } = await client.query<{ stock_actual: string; version: string }>(
        `SELECT stock_actual, version FROM productos WHERE id = $1 FOR UPDATE`,
        [receta.producto_id]
      );
      const antespt   = toNum(ptStock.stock_actual);
      const despuespt = antespt + cantidadReal;

      await client.query(
        `UPDATE productos SET stock_actual = $1::NUMERIC, version = version + 1 WHERE id = $2`,
        [despuespt.toFixed(6), receta.producto_id]
      );

      // Stock move de entrada producto terminado
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
          `Producción confirmada orden ${orden.numero_orden}`,
        ]
      );

      // ── 6. Actualizar orden ───────────────────────────────────────────
      await client.query(
        `UPDATE ordenes_produccion
         SET estado = 'completada',
             cantidad_producida = $1::NUMERIC,
             cantidad_real_producida = $10::NUMERIC,
             merma_proceso     = $11::NUMERIC,
             merma_pct         = $12::NUMERIC,
             lote_producido_id  = $2,
             fecha_inicio       = COALESCE(fecha_inicio, NOW()),
             fecha_fin          = NOW(),
             ph                 = COALESCE($4, ph),
             foto_url           = COALESCE($5, foto_url),
             foto_urls          = COALESCE($6::JSONB, foto_urls),
             solidos            = COALESCE($7, solidos),
             viscosidad         = COALESCE($8, viscosidad),
             fecha_fabricacion  = COALESCE($9::TIMESTAMPTZ, fecha_fabricacion, NOW()),
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
        ]
      );

      // ── 7. Auditoría ─────────────────────────────────────────────────
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
  }

  /** Crea orden en estado borrador */
  async crearOrden(payload: {
    receta_id: string;
    cantidad_planificada: number;
    fecha_planificada?: string;
    notas?: string;
    operario_id?: string;
    cliente?: string;
    cliente_id?: string;
  }): Promise<{ id: string; numero_orden: string }> {
    const { rows: [orden] } = await pool.query(
      `INSERT INTO ordenes_produccion
         (receta_id, cantidad_planificada, fecha_planificada, notas, operario_id, cliente, cliente_id)
       VALUES ($1, $2::NUMERIC, $3, $4, $5, $6, $7)
       RETURNING id, numero_orden`,
      [
        payload.receta_id,
        payload.cantidad_planificada.toFixed(6),
        payload.fecha_planificada ?? null,
        payload.notas ?? null,
        payload.operario_id ?? null,
        payload.cliente ?? null,
        payload.cliente_id ?? null,
      ]
    );
    return orden;
  }

  async listarOrdenes(filtro?: { estado?: string }): Promise<unknown[]> {
    let sql = `
      SELECT op.*, r.nombre AS receta_nombre, p.nombre AS producto_nombre
      FROM ordenes_produccion op
      JOIN recetas r ON r.id = op.receta_id
      JOIN productos p ON p.id = r.producto_id
    `;
    const params: string[] = [];
    if (filtro?.estado) {
      sql += ` WHERE op.estado = $1`;
      params.push(filtro.estado);
    }
    sql += ` ORDER BY op.created_at DESC LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    return rows;
  }
}

export const produccionService = new ProduccionService();
