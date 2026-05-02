/**
 * Automatizaciones — disparadores tras cambios de stock.
 *
 * Lógica:
 *   1. Tras COMMIT de cualquier mutación de stock, llamar checkStockAndTrigger(productoId).
 *   2. Si stock_actual <= stock_minimo y producto.activo:
 *        - materia_prima         → orden compra borrador + email proveedor
 *        - producto_fabricado    → orden fabricación borrador
 *        - producto_envasado     → orden envasado borrador
 *   3. Anti-duplicado: existe orden borrador/confirmada del mismo producto en
 *      ventana_antiduplicado_dias días → omitir (log tipo='duplicado_evitado').
 *   4. Cantidad: stock_minimo * (1 + safety_pct/100) - stock_actual
 *      (mínimo cantidad_promedio_mensual si está disponible).
 *   5. Cada acción → fila en automatizaciones_log.
 *
 * El servicio NO lanza excepciones al exterior: captura todo y lo registra como
 * resultado='fallo_definitivo' para no romper la respuesta HTTP del caller.
 */

import { pool, acquireProductLocks } from '../db/pool';
import { emailService } from './email.service';

interface ConfigAuto {
  auto_compra_activa: boolean;
  auto_email_proveedor: boolean;
  auto_fabricacion_activa: boolean;
  auto_envasado_activa: boolean;
  auto_aprobacion_qc: boolean;
  auto_completar_pedidos_con_stock: boolean;
  auto_email_albaran: boolean;
  auto_email_albaran_clientes: string[] | null;
  auto_email_trazabilidad_fabricado: boolean;
  auto_fabricar_desde_pedido: boolean;
  auto_envasar_desde_pedido: boolean;
  backup_auto_activo: boolean;
  backup_auto_hora: string;
  backup_auto_ultima: string | null;
  safety_stock_pct_default: string;
  dias_anticipacion_default: number;
  ventana_antiduplicado_dias: number;
  email_max_reintentos: number;
  email_intervalo_reintento_min: number;
}

class OmitidoError extends Error {
  constructor(public motivo: string) { super(motivo); this.name = 'OmitidoError'; }
}

interface ReglaCargada {
  id: string;
  nombre: string;
  trigger_tipo: string;
  trigger_config: Record<string, unknown>;
  accion_tipo: string;
  accion_config: Record<string, unknown>;
}

interface ProductoCtx {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  unidad_medida: string;
  stock_actual: string;
  stock_minimo: string;
  proveedor_id: string | null;
  proveedor_email: string | null;
  proveedor_nombre: string | null;
  granel_id: string | null;
  activo: boolean;
  // Overrides
  auto_email_proveedor: boolean | null;
  auto_compra_activa: boolean | null;
  auto_fabricacion_activa: boolean | null;
  auto_envasado_activa: boolean | null;
  safety_stock_pct: string | null;
  dias_anticipacion: number | null;
  cantidad_promedio_mensual: string | null;
}

class AutomatizacionesService {
  // Cache de config 30s para no martillar DB en cada movimiento
  private configCache: { value: ConfigAuto; ts: number } | null = null;
  private readonly CONFIG_TTL_MS = 30_000;

  async getConfig(): Promise<ConfigAuto> {
    const now = Date.now();
    if (this.configCache && now - this.configCache.ts < this.CONFIG_TTL_MS) {
      return this.configCache.value;
    }
    const { rows } = await pool.query<ConfigAuto>(
      `SELECT * FROM configuracion_automatizaciones WHERE id = 1`
    );
    if (!rows[0]) throw new Error('CONFIG_AUTOMATIZACIONES_NO_ENCONTRADA');
    this.configCache = { value: rows[0], ts: now };
    return rows[0];
  }

  invalidateConfig(): void {
    this.configCache = null;
  }

  /**
   * Entrada principal: tras cualquier mutación de stock evalúa las reglas
   * activas que tengan trigger 'stock_bajo_minimo' o 'stock_cero' y matcheen
   * el producto. Cada regla decide su propia acción.
   */
  async checkStockAndTrigger(productoId: string): Promise<void> {
    try {
      const prod = await this.loadProducto(productoId);
      if (!prod || !prod.activo) return;

      const stockActual = parseFloat(prod.stock_actual);
      const stockMinimo = parseFloat(prod.stock_minimo);

      const eventos: string[] = [];
      if (stockActual <= 0) eventos.push('stock_cero');
      if (stockMinimo > 0 && stockActual <= stockMinimo) eventos.push('stock_bajo_minimo');
      if (eventos.length === 0) return;

      const reglas = await this.cargarReglasActivas(eventos, productoId);
      for (const r of reglas) {
        await this.ejecutarRegla(r, prod);
      }
    } catch (err) {
      console.error('[automatizaciones.checkStockAndTrigger]', err);
    }
  }

  /** Hook al crear lote desde producción: dispara reglas con trigger lote_qc_*. */
  async onLoteCreado(loteId: string, productoId: string, qcOk: boolean): Promise<void> {
    try {
      const prod = await this.loadProducto(productoId);
      if (!prod) return;
      const evento = qcOk ? 'lote_qc_ok' : 'lote_qc_fuera_rango';
      const reglas = await this.cargarReglasActivas([evento], productoId);
      for (const r of reglas) {
        await this.ejecutarRegla(r, prod, { lote_id: loteId, qc_ok: qcOk });
      }
    } catch (err) {
      console.error('[automatizaciones.onLoteCreado]', err);
    }
  }

  // Backwards-compat: el service expone aún intentarAutoAprobacionLote pero ahora redirige
  async intentarAutoAprobacionLote(loteId: string, qcOk: boolean): Promise<void> {
    if (!qcOk) return;
    const { rows } = await pool.query<{ producto_id: string }>(
      `SELECT producto_id FROM lotes WHERE id = $1`, [loteId]
    );
    if (!rows[0]) return;
    return this.onLoteCreado(loteId, rows[0].producto_id, true);
  }

  /** Cargar reglas activas que matcheen el trigger y el producto. */
  private async cargarReglasActivas(triggers: string[], productoId: string): Promise<ReglaCargada[]> {
    const { rows } = await pool.query<ReglaCargada>(
      `SELECT r.id, r.nombre, r.trigger_tipo::text AS trigger_tipo, r.trigger_config,
              r.accion_tipo::text AS accion_tipo, r.accion_config
       FROM automatizaciones_reglas r
       WHERE r.activa = TRUE
         AND r.trigger_tipo::text = ANY($1::text[])
         AND (
           NOT EXISTS (SELECT 1 FROM regla_productos rp WHERE rp.regla_id = r.id)
           OR EXISTS (SELECT 1 FROM regla_productos rp WHERE rp.regla_id = r.id AND rp.producto_id = $2)
         )`,
      [triggers, productoId]
    );
    return rows;
  }

  /** Ejecuta UNA regla. Cada acción tiene anti-duplicado propio. */
  private async ejecutarRegla(regla: ReglaCargada, prod: ProductoCtx, ctx?: { lote_id?: string; qc_ok?: boolean }): Promise<void> {
    const cfg = await this.getConfig();
    try {
      // Anti-duplicado para acciones que crean órdenes
      if (
        regla.accion_tipo === 'crear_orden_compra' ||
        regla.accion_tipo === 'email_proveedor' ||
        regla.accion_tipo === 'crear_orden_fabricacion' ||
        regla.accion_tipo === 'crear_orden_envasado'
      ) {
        const ventana = (regla.accion_config?.ventana_dias as number) ?? cfg.ventana_antiduplicado_dias;
        if (await this.existeBorradorReciente(prod, ventana)) {
          await this.log({
            tipo: 'duplicado_evitado',
            resultado: 'omitido',
            producto_id: prod.id,
            regla_id: regla.id,
            detalle: { motivo: 'orden_pendiente_en_ventana', regla: regla.nombre },
          });
          await this.bumpStats(regla.id, 'omitido');
          return;
        }
      }

      const cantidad = this.calcularCantidadConRegla(prod, regla, cfg);

      switch (regla.accion_tipo) {
        case 'crear_orden_compra':
          await this.crearOrdenCompraDesdeRegla(prod, cantidad, regla, false);
          break;
        case 'email_proveedor':
          await this.crearOrdenCompraDesdeRegla(prod, cantidad, regla, true);
          break;
        case 'crear_orden_fabricacion':
          await this.crearOrdenFabricacion(prod, cantidad, regla);
          break;
        case 'crear_orden_envasado':
          await this.crearOrdenEnvasado(prod, cantidad, regla);
          break;
        case 'aprobar_lote':
          if (ctx?.lote_id && ctx.qc_ok) await this.aprobarLote(ctx.lote_id, prod, regla);
          break;
        case 'rechazar_lote':
          if (ctx?.lote_id && ctx.qc_ok === false) await this.rechazarLote(ctx.lote_id, prod, regla);
          break;
        case 'notificar':
          await this.log({
            tipo: 'orden_compra_creada', // reusa enum existente como evento info
            resultado: 'exito',
            producto_id: prod.id,
            regla_id: regla.id,
            detalle: { mensaje: regla.accion_config?.mensaje ?? regla.nombre, cantidad },
          });
          break;
      }
      await this.bumpStats(regla.id, 'exito');
    } catch (err) {
      if (err instanceof OmitidoError) {
        // Skip silencioso: ya quedó loggeado como 'omitido'. No cuenta como fallo.
        await this.bumpStats(regla.id, 'omitido');
        return;
      }
      console.error(`[ejecutarRegla:${regla.nombre}]`, err);
      await this.log({
        tipo: 'error',
        resultado: 'fallo_definitivo',
        producto_id: prod.id,
        regla_id: regla.id,
        error_msg: err instanceof Error ? err.message : String(err),
        detalle: { regla: regla.nombre },
      }).catch(() => {});
      await this.bumpStats(regla.id, 'fallo');
    }
  }

  private async bumpStats(reglaId: string, resultado: string): Promise<void> {
    const extra = resultado === 'exito' ? ', ejecuciones_exito = ejecuciones_exito + 1'
      : resultado === 'fallo' ? ', ejecuciones_fallo = ejecuciones_fallo + 1'
      : '';
    await pool.query(
      `UPDATE automatizaciones_reglas
       SET ejecuciones_count = ejecuciones_count + 1${extra},
           ultima_ejecucion = NOW(),
           ultimo_resultado = $2
       WHERE id = $1`,
      [reglaId, resultado]
    );
  }

  /** Cantidad dependiendo de configuración de la regla, fallback al cálculo por defecto. */
  private calcularCantidadConRegla(prod: ProductoCtx, regla: ReglaCargada, cfg: ConfigAuto): number {
    const cant = regla.accion_config?.cantidad_fija;
    if (cant && Number(cant) > 0) return Number(cant);
    const safetyOverride = regla.accion_config?.safety_stock_pct;
    if (safetyOverride !== undefined && safetyOverride !== null) {
      const stockActual = parseFloat(prod.stock_actual);
      const stockMin = parseFloat(prod.stock_minimo);
      const objetivo = stockMin * (1 + Number(safetyOverride) / 100);
      return Math.max(objetivo - stockActual, 0);
    }
    return this.calcularCantidad(prod, cfg);
  }

  // Wrapper: crear orden de compra y opcionalmente enviar email
  private async crearOrdenCompraDesdeRegla(
    prod: ProductoCtx, cantidad: number, regla: ReglaCargada, conEmail: boolean,
  ): Promise<void> {
    if (!prod.proveedor_id || !prod.proveedor_email) {
      await this.log({
        tipo: 'duplicado_evitado',
        resultado: 'omitido',
        producto_id: prod.id,
        regla_id: regla.id,
        detalle: {
          motivo: 'producto_sin_proveedor',
          producto: prod.nombre,
          regla: regla.nombre,
          tip: 'Asigna un proveedor al producto en su ficha para que la regla funcione.',
        },
      });
      throw new OmitidoError('producto_sin_proveedor');
    }
    const destEmail = (regla.accion_config?.destinatario_email as string) || prod.proveedor_email;
    const { rows: [orden] } = await pool.query<{ id: string }>(
      `INSERT INTO pedidos_proveedor
         (producto_id, proveedor_id, cantidad_solicitada, destinatario_email, estado, origen, notas)
       VALUES ($1, $2, $3::NUMERIC, $4, 'borrador', 'automatizacion', $5)
       RETURNING id`,
      [
        prod.id, prod.proveedor_id, cantidad.toFixed(6), destEmail,
        `Regla "${regla.nombre}": stock ${prod.stock_actual} ≤ mínimo ${prod.stock_minimo}`,
      ]
    );
    await this.log({
      tipo: 'orden_compra_creada',
      resultado: 'exito',
      producto_id: prod.id,
      proveedor_id: prod.proveedor_id,
      orden_compra_id: orden.id,
      regla_id: regla.id,
      detalle: { cantidad, unidad: prod.unidad_medida, regla: regla.nombre },
    });
    if (conEmail) {
      const prodConDestEmail = { ...prod, proveedor_email: destEmail };
      await this.intentarEmailProveedor(prodConDestEmail, orden.id, cantidad, 0, regla.id);
    }
  }

  private async aprobarLote(loteId: string, prod: ProductoCtx, regla: ReglaCargada): Promise<void> {
    await pool.query(`UPDATE lotes SET estado = 'aprobado', updated_at = NOW() WHERE id = $1 AND estado = 'cuarentena'`, [loteId]);
    await this.log({
      tipo: 'lote_aprobado_qc',
      resultado: 'exito',
      producto_id: prod.id,
      lote_id: loteId,
      regla_id: regla.id,
      detalle: { regla: regla.nombre },
    });
  }

  private async rechazarLote(loteId: string, prod: ProductoCtx, regla: ReglaCargada): Promise<void> {
    await pool.query(`UPDATE lotes SET estado = 'rechazado', cantidad_actual = 0, updated_at = NOW() WHERE id = $1 AND estado = 'cuarentena'`, [loteId]);
    await this.log({
      tipo: 'lote_aprobado_qc',
      resultado: 'exito',
      producto_id: prod.id,
      lote_id: loteId,
      regla_id: regla.id,
      detalle: { regla: regla.nombre, accion: 'rechazado' },
    });
  }

  /** Disparar manualmente todas las reglas con trigger='manual' o ejecutar una específica. */
  async ejecutarReglaManual(reglaId: string, productoId?: string): Promise<void> {
    const { rows } = await pool.query<ReglaCargada>(
      `SELECT id, nombre, trigger_tipo::text AS trigger_tipo, trigger_config,
              accion_tipo::text AS accion_tipo, accion_config
       FROM automatizaciones_reglas WHERE id = $1`,
      [reglaId]
    );
    if (!rows[0]) throw new Error('REGLA_NO_ENCONTRADA');
    const regla = rows[0];

    let prodIds: string[] = [];
    if (productoId) prodIds = [productoId];
    else {
      const { rows: ps } = await pool.query<{ producto_id: string }>(
        `SELECT producto_id FROM regla_productos WHERE regla_id = $1`, [reglaId]
      );
      prodIds = ps.map(p => p.producto_id);
    }
    for (const pid of prodIds) {
      const prod = await this.loadProducto(pid);
      if (prod) await this.ejecutarRegla(regla, prod);
    }
  }

  // ── Carga de contexto ────────────────────────────────────────
  private async loadProducto(productoId: string): Promise<ProductoCtx | null> {
    const { rows } = await pool.query<ProductoCtx>(
      `SELECT
         p.id, p.codigo, p.nombre, p.tipo::text AS tipo, p.unidad_medida,
         p.stock_actual, p.stock_minimo, p.proveedor_id, p.granel_id, p.activo,
         p.auto_email_proveedor, p.auto_compra_activa, p.auto_fabricacion_activa,
         p.auto_envasado_activa, p.safety_stock_pct, p.dias_anticipacion,
         p.cantidad_promedio_mensual,
         pv.email AS proveedor_email, pv.nombre AS proveedor_nombre
       FROM productos p
       LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
       WHERE p.id = $1`,
      [productoId]
    );
    return rows[0] ?? null;
  }

  // ── Anti-duplicado ───────────────────────────────────────────
  private async existeBorradorReciente(prod: ProductoCtx, ventanaDias: number): Promise<boolean> {
    if (prod.tipo === 'materia_prima' || prod.tipo === 'material_embalaje' || prod.tipo === 'producto_terminado') {
      const { rows } = await pool.query(
        `SELECT 1 FROM pedidos_proveedor
         WHERE producto_id = $1
           AND estado IN ('borrador', 'enviado', 'pendiente')
           AND fecha_solicitud >= NOW() - ($2 || ' days')::interval
         LIMIT 1`,
        [prod.id, String(ventanaDias)]
      );
      return rows.length > 0;
    }
    // Para fabricación/envasado: buscar receta y verificar orden borrador/confirmada
    const { rows } = await pool.query(
      `SELECT 1 FROM ordenes_produccion op
       JOIN recetas r ON r.id = op.receta_id
       WHERE r.producto_id = $1
         AND op.estado IN ('borrador', 'confirmada', 'en_proceso')
         AND op.created_at >= NOW() - ($2 || ' days')::interval
       LIMIT 1`,
      [prod.id, String(ventanaDias)]
    );
    return rows.length > 0;
  }

  // ── Cálculo cantidad ──────────────────────────────────────────
  private calcularCantidad(prod: ProductoCtx, cfg: ConfigAuto): number {
    const stockActual = parseFloat(prod.stock_actual);
    const stockMin = parseFloat(prod.stock_minimo);
    const safetyPct = prod.safety_stock_pct
      ? parseFloat(prod.safety_stock_pct)
      : parseFloat(cfg.safety_stock_pct_default);
    const promedio = prod.cantidad_promedio_mensual ? parseFloat(prod.cantidad_promedio_mensual) : 0;
    const objetivo = stockMin * (1 + safetyPct / 100);
    const necesario = Math.max(objetivo - stockActual, 0);
    return Math.max(necesario, promedio);
  }

  private flagOrDefault(override: boolean | null, defaultVal: boolean): boolean {
    return override === null ? defaultVal : override;
  }

  // ── Crear orden compra (borrador) + email ─────────────────────
  private async crearOrdenCompra(prod: ProductoCtx, cantidad: number, cfg: ConfigAuto): Promise<void> {
    if (!prod.proveedor_id || !prod.proveedor_email) {
      await this.log({
        tipo: 'orden_compra_creada',
        resultado: 'fallo_definitivo',
        producto_id: prod.id,
        error_msg: 'PRODUCTO_SIN_PROVEEDOR',
        detalle: { cantidad },
      });
      return;
    }
    const { rows: [orden] } = await pool.query<{ id: string }>(
      `INSERT INTO pedidos_proveedor
         (producto_id, proveedor_id, cantidad_solicitada, destinatario_email, estado, origen, notas)
       VALUES ($1, $2, $3::NUMERIC, $4, 'borrador', 'automatizacion', $5)
       RETURNING id`,
      [
        prod.id, prod.proveedor_id, cantidad.toFixed(6), prod.proveedor_email,
        `Pedido automático: stock ${prod.stock_actual} ≤ mínimo ${prod.stock_minimo}`,
      ]
    );

    await this.log({
      tipo: 'orden_compra_creada',
      resultado: 'exito',
      producto_id: prod.id,
      proveedor_id: prod.proveedor_id,
      orden_compra_id: orden.id,
      detalle: {
        cantidad,
        unidad: prod.unidad_medida,
        stock_actual: parseFloat(prod.stock_actual),
        stock_minimo: parseFloat(prod.stock_minimo),
      },
    });

    // Email automático
    if (this.flagOrDefault(prod.auto_email_proveedor, cfg.auto_email_proveedor)) {
      await this.intentarEmailProveedor(prod, orden.id, cantidad, 0);
    }
  }

  /**
   * Intenta enviar el email. Si falla, deja log con resultado=pendiente_reintento
   * y next_retry_at calculado. El cron de retry lo recogerá.
   */
  async intentarEmailProveedor(
    prod: ProductoCtx,
    ordenCompraId: string,
    cantidad: number,
    retryCount: number,
    reglaId?: string,
  ): Promise<void> {
    const cfg = await this.getConfig();
    try {
      await emailService.enviarPedidoStock({
        destinatario: prod.proveedor_email!,
        producto_id: prod.id,
        cantidad_sugerida: cantidad,
        notas_adicionales: `Pedido automático generado por sistema (stock ${prod.stock_actual} ≤ mínimo ${prod.stock_minimo}).`,
      });
      // Marcar orden como enviada
      await pool.query(
        `UPDATE pedidos_proveedor SET estado = 'enviado' WHERE id = $1 AND estado = 'borrador'`,
        [ordenCompraId]
      );
      await this.log({
        tipo: 'email_proveedor_enviado',
        resultado: 'exito',
        producto_id: prod.id,
        proveedor_id: prod.proveedor_id,
        orden_compra_id: ordenCompraId,
        regla_id: reglaId,
        detalle: { cantidad, destinatario: prod.proveedor_email, retry_count: retryCount },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nuevoCount = retryCount + 1;
      const definitivo = nuevoCount >= cfg.email_max_reintentos;
      const nextRetry = definitivo
        ? null
        : new Date(Date.now() + cfg.email_intervalo_reintento_min * 60_000);
      await this.log({
        tipo: 'email_proveedor_enviado',
        resultado: definitivo ? 'fallo_definitivo' : 'pendiente_reintento',
        producto_id: prod.id,
        proveedor_id: prod.proveedor_id,
        orden_compra_id: ordenCompraId,
        regla_id: reglaId,
        error_msg: msg,
        retry_count: retryCount,
        next_retry_at: nextRetry,
        detalle: { cantidad, destinatario: prod.proveedor_email },
      });
    }
  }

  // ── Crear orden fabricación (borrador) ─────────────────────────
  private async crearOrdenFabricacion(prod: ProductoCtx, cantidad: number, regla?: ReglaCargada): Promise<void> {
    const cfg = await this.getConfig();
    const { rows: [receta] } = await pool.query<{ id: string; rendimiento: string }>(
      `SELECT id, rendimiento FROM recetas
       WHERE producto_id = $1 AND tipo_receta = 'fabricacion' AND activa = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [prod.id]
    );
    if (!receta) {
      await this.log({
        tipo: 'orden_fabricacion_creada',
        resultado: 'fallo_definitivo',
        producto_id: prod.id,
        error_msg: 'SIN_RECETA_FABRICACION_ACTIVA',
        detalle: { cantidad },
      });
      return;
    }

    // Cantidad ajustada al rendimiento de la receta (al menos 1 batch)
    const rendimiento = parseFloat(receta.rendimiento);
    const batches = Math.max(1, Math.ceil(cantidad / rendimiento));
    const cantidadFinal = batches * rendimiento;
    const dias = prod.dias_anticipacion ?? cfg.dias_anticipacion_default;
    const fechaPlanificada = new Date(Date.now() + dias * 86_400_000)
      .toISOString().slice(0, 10);

    const { rows: [orden] } = await pool.query<{ id: string; numero_orden: string }>(
      `INSERT INTO ordenes_produccion
         (numero_orden, receta_id, cantidad_planificada, fecha_planificada, estado, tipo_orden, notas)
       VALUES (
         'OP-AUTO-' || to_char(NOW(), 'YYYYMMDD-HH24MISS'),
         $1, $2::NUMERIC, $3::DATE, 'borrador', 'fabricacion', $4
       )
       RETURNING id, numero_orden`,
      [
        receta.id, cantidadFinal.toFixed(6), fechaPlanificada,
        `Auto-generada: stock ${prod.stock_actual} ≤ mínimo ${prod.stock_minimo}`,
      ]
    );

    await this.log({
      tipo: 'orden_fabricacion_creada',
      resultado: 'exito',
      producto_id: prod.id,
      orden_id: orden.id,
      regla_id: regla?.id,
      detalle: {
        numero_orden: orden.numero_orden,
        cantidad: cantidadFinal,
        unidad: prod.unidad_medida,
        receta_id: receta.id,
        fecha_planificada: fechaPlanificada,
      },
    });
  }

  // ── Crear orden envasado (borrador) ────────────────────────────
  private async crearOrdenEnvasado(prod: ProductoCtx, cantidad: number, regla?: ReglaCargada): Promise<void> {
    const cfg = await this.getConfig();
    const { rows: [receta] } = await pool.query<{ id: string; rendimiento: string }>(
      `SELECT id, rendimiento FROM recetas
       WHERE producto_id = $1 AND tipo_receta = 'envasado' AND activa = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [prod.id]
    );
    if (!receta) {
      await this.log({
        tipo: 'orden_envasado_creada',
        resultado: 'fallo_definitivo',
        producto_id: prod.id,
        error_msg: 'SIN_RECETA_ENVASADO_ACTIVA',
        detalle: { cantidad },
      });
      return;
    }
    const dias = prod.dias_anticipacion ?? cfg.dias_anticipacion_default;
    const fechaPlanificada = new Date(Date.now() + dias * 86_400_000)
      .toISOString().slice(0, 10);

    // Cantidad: redondear a unidades enteras (envasado se planifica por uds)
    const cantidadUd = Math.max(1, Math.ceil(cantidad));

    // Derivar cola/envase desde los ingredientes de la receta de envasado.
    // Necesario para que el flujo de "Envasar" desde la lista resuelva productos.
    const { rows: ings } = await pool.query<{ materia_prima_id: string; tipo: string }>(
      `SELECT ir.materia_prima_id, p.tipo::text AS tipo
       FROM ingredientes_receta ir JOIN productos p ON p.id = ir.materia_prima_id
       WHERE ir.receta_id = $1`,
      [receta.id]
    );
    const colaId = ings.find(i => i.tipo === 'producto_fabricado')?.materia_prima_id ?? null;
    const envaseId = ings.find(i => i.tipo === 'material_embalaje')?.materia_prima_id ?? null;
    const formatoLabel = envaseId
      ? (await pool.query<{ nombre: string }>(`SELECT nombre FROM productos WHERE id = $1`, [envaseId])).rows[0]?.nombre ?? null
      : null;

    const { rows: [orden] } = await pool.query<{ id: string; numero_orden: string }>(
      `INSERT INTO ordenes_produccion
         (numero_orden, receta_id, cantidad_planificada, fecha_planificada, estado, tipo_orden,
          producto_final_id, cola_id, envase_id, formato_label, notas)
       VALUES (
         'OE-AUTO-' || to_char(NOW(), 'YYYYMMDD-HH24MISS'),
         $1, $2::NUMERIC, $3::DATE, 'borrador', 'envasado',
         $4, $5, $6, $7, $8
       )
       RETURNING id, numero_orden`,
      [
        receta.id, cantidadUd.toFixed(0), fechaPlanificada,
        prod.id, colaId, envaseId, formatoLabel,
        `Auto-generada: stock ${prod.stock_actual} ≤ mínimo ${prod.stock_minimo}`,
      ]
    );

    await this.log({
      tipo: 'orden_envasado_creada',
      resultado: 'exito',
      producto_id: prod.id,
      orden_id: orden.id,
      regla_id: regla?.id,
      detalle: {
        numero_orden: orden.numero_orden,
        cantidad: cantidadUd,
        unidad: 'ud',
        receta_id: receta.id,
        fecha_planificada: fechaPlanificada,
      },
    });
  }

  // ── Cron retry email ──────────────────────────────────────────
  /**
   * Recoge logs con resultado='pendiente_reintento' y next_retry_at <= NOW()
   * y los reintenta. Llamado desde setInterval en index.ts.
   */
  async procesarReintentosEmail(): Promise<number> {
    try {
      const { rows: pendientes } = await pool.query<{
        id: string; producto_id: string; orden_compra_id: string; retry_count: number;
        cantidad: number;
      }>(
        `SELECT id, producto_id, orden_compra_id, retry_count,
                (detalle->>'cantidad')::NUMERIC AS cantidad
         FROM automatizaciones_log
         WHERE tipo = 'email_proveedor_enviado'
           AND resultado = 'pendiente_reintento'
           AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT 20`
      );
      let procesados = 0;
      for (const p of pendientes) {
        const prod = await this.loadProducto(p.producto_id);
        if (!prod) continue;
        // Marcar el log antiguo como procesado (resultado fallo_definitivo si no se va a reintentar)
        await pool.query(
          `UPDATE automatizaciones_log SET next_retry_at = NULL WHERE id = $1`,
          [p.id]
        );
        await this.intentarEmailProveedor(prod, p.orden_compra_id, Number(p.cantidad), p.retry_count + 1);
        procesados++;
      }
      return procesados;
    } catch (err) {
      console.error('[automatizaciones.procesarReintentosEmail]', err);
      return 0;
    }
  }

  // ════════════════════════════════════════════════════════════
  // Workflow: auto-completar pedido + auto-email albarán
  // ════════════════════════════════════════════════════════════

  /**
   * Llamado tras cambiar estado de un pedido a 'confirmado'.
   * Si config.auto_completar_pedidos_con_stock=ON y hay stock suficiente del
   * producto envasado, ejecuta el consumo FEFO y deja el pedido en 'completado'.
   */
  async autoCompletarPedido(pedidoId: string): Promise<void> {
    let pedidoNumero: string | null = null;
    try {
      const cfg = await this.getConfig();
      if (!cfg.auto_completar_pedidos_con_stock) return;

      // Toda la operación en UNA SOLA transacción SERIALIZABLE:
      //   1. Lock pedido (NOWAIT) — si otro proceso lo tiene, salir sin ruido
      //   2. Validar estado y stock disponible
      //   3. Consumir FIFO + actualizar stock
      //   4. Borrar reservas + estado='completado'
      //   5. COMMIT (libera lock atómicamente)
      //
      // Antes (Fix #11): se hacía COMMIT inmediato después del lock pre-emptivo
      // y luego se abría una nueva transacción para el consumo. Eso dejaba una
      // ventana en la que otro proceso podía cancelar el pedido o modificarlo
      // entre lock y consumo → consumición sobre pedido cancelado.
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        // 1) Lock pedido + estado
        let pedido: { id: string; estado: string; numero_pedido: string; cliente_email: string | null } | undefined;
        try {
          const { rows } = await client.query<{
            id: string; estado: string; numero_pedido: string; cliente_email: string | null;
          }>(
            `SELECT p.id, p.estado, p.numero_pedido,
                    COALESCE(p.cliente_email, c.email) AS cliente_email
             FROM pedidos p
             LEFT JOIN clientes c ON c.id = p.cliente_id
             WHERE p.id = $1
             FOR UPDATE OF p NOWAIT`,
            [pedidoId]
          );
          pedido = rows[0];
        } catch (lockErr: unknown) {
          const code = (lockErr as { code?: string })?.code;
          if (code === '55P03') {
            // lock_not_available — otro proceso ya lo está tratando, salir limpio
            await client.query('ROLLBACK').catch(() => {});
            return;
          }
          throw lockErr;
        }

        if (!pedido || !['confirmado', 'fabricado', 'envasado'].includes(pedido.estado)) {
          await client.query('ROLLBACK');
          return;
        }
        pedidoNumero = pedido.numero_pedido;

        // 2) Cargar líneas + advisory locks por producto + validación stock
        const { rows: lineas } = await client.query<{
          producto_id: string; cantidad: string; reservado: string; libre: string;
          producto_nombre: string; bloqueado_por: string | null;
        }>(
          `SELECT lp.producto_id, lp.cantidad, p.nombre AS producto_nombre,
                  COALESCE((
                    SELECT SUM(rs.cantidad) FROM reservas_stock rs
                    WHERE rs.pedido_id = $1 AND rs.producto_id = lp.producto_id AND rs.estado = 'activa'
                  ), 0) AS reservado,
                  COALESCE((
                    SELECT SUM(GREATEST(0, l.cantidad_actual
                           - COALESCE((SELECT SUM(rs.cantidad) FROM reservas_stock rs WHERE rs.lote_id = l.id AND rs.pedido_id <> $1 AND rs.estado = 'activa'), 0)))
                    FROM lotes l WHERE l.producto_id = lp.producto_id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
                  ), 0) AS libre,
                  (SELECT string_agg(DISTINCT pp.numero_pedido, ', ')
                   FROM reservas_stock rs2 JOIN pedidos pp ON pp.id = rs2.pedido_id
                   WHERE rs2.producto_id = lp.producto_id AND rs2.pedido_id <> $1 AND rs2.estado = 'activa') AS bloqueado_por
           FROM lineas_pedido lp JOIN productos p ON p.id = lp.producto_id
           WHERE lp.pedido_id = $1`,
          [pedidoId]
        );

        if (lineas.length > 0) {
          await acquireProductLocks(client, lineas.map(l => l.producto_id));
        }

        const insuficiente = lineas.find(l => {
          const cantidad = parseFloat(l.cantidad);
          const reservado = parseFloat(l.reservado);
          const libre = parseFloat(l.libre);
          return reservado < cantidad - 0.001 && libre < cantidad - 0.001;
        });
        if (insuficiente) {
          await client.query('ROLLBACK');
          await this.log({
            tipo: 'duplicado_evitado',
            resultado: 'omitido',
            detalle: {
              motivo: 'stock_bloqueado_por_otros_pedidos',
              pedido: pedido.numero_pedido,
              producto: insuficiente.producto_nombre,
              necesario: insuficiente.cantidad,
              reservado_propio: insuficiente.reservado,
              libre_no_reservado: insuficiente.libre,
              bloqueado_por: insuficiente.bloqueado_por,
            },
          });
          return;
        }

        // 3) Consumir FIFO + actualizar stock por decremento atómico
        for (const item of lineas) {
          let restante = parseFloat(item.cantidad);
          const { rows: lotes } = await client.query<{
            id: string; cantidad_actual: string; disponible: string;
          }>(
            `SELECT l.id, l.cantidad_actual,
                    l.cantidad_actual - COALESCE((SELECT SUM(rs.cantidad) FROM reservas_stock rs WHERE rs.lote_id = l.id AND rs.pedido_id <> $2 AND rs.estado = 'activa'), 0) AS disponible
             FROM lotes l WHERE l.producto_id = $1 AND l.estado = 'aprobado' AND l.cantidad_actual > 0
             ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC FOR UPDATE`,
            [item.producto_id, pedidoId]
          );
          for (const lote of lotes) {
            if (restante <= 0) break;
            const disp = parseFloat(lote.disponible);
            if (disp <= 0) continue;
            const consumir = Math.min(disp, restante);
            const stockAntes = parseFloat(lote.cantidad_actual);
            const stockDespues = stockAntes - consumir;
            await client.query(
              `UPDATE lotes SET cantidad_actual = cantidad_actual - $1::NUMERIC WHERE id = $2`,
              [consumir.toFixed(6), lote.id]
            );
            await client.query(
              `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, motivo)
               VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6)`,
              [item.producto_id, lote.id, (-consumir).toFixed(6), stockAntes.toFixed(6), stockDespues.toFixed(6),
               `Auto-completar pedido ${pedido.numero_pedido}`]
            );
            restante -= consumir;
          }
          if (restante > 0.001) throw new Error(`STOCK_AGOTADO_DURANTE_AUTO:${item.producto_nombre}`);
          // [Eliminado tras hot-fix C-5 trigger]: el UPDATE lotes anterior
          // ya disparó fn_trg_lotes_stock_actual que recalculó productos.stock_actual.
          // Restar de nuevo causaba doble descuento → CHECK violation visto en
          // pedido PED-2026-01344 con error "stock_actual_check".
        }

        // 4) Cerrar pedido
        await client.query(`UPDATE reservas_stock SET estado = 'consumida' WHERE pedido_id = $1 AND estado = 'activa'`, [pedidoId]);
        await client.query(`UPDATE pedidos SET estado = 'completado' WHERE id = $1`, [pedidoId]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => console.error('[autoCompletarPedido] ROLLBACK fallo', rbErr));
        throw err;
      } finally {
        client.release();
      }

      await this.log({
        tipo: 'pedido_auto_completado',
        resultado: 'exito',
        detalle: { accion: 'auto_completar_pedido', pedido: pedidoNumero ?? pedidoId },
      });

      // Enviar albarán automáticamente si toggle ON
      await this.autoEmailAlbaran(pedidoId);
    } catch (err) {
      console.error('[autoCompletarPedido]', err);
      await this.log({
        tipo: 'error',
        resultado: 'fallo_definitivo',
        error_msg: err instanceof Error ? err.message : String(err),
        detalle: { accion: 'auto_completar_pedido', pedido_id: pedidoId },
      }).catch(() => {});
    }
  }

  /**
   * Llamado tras completar un pedido. Si config.auto_email_albaran=ON y el
   * cliente tiene email → envía PDF albarán + trazabilidad.
   */
  async autoEmailAlbaran(pedidoId: string): Promise<void> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.auto_email_albaran) return;

      const { rows: [pedido] } = await pool.query<{
        id: string; numero_pedido: string; cliente_email: string | null; cliente_id: string | null;
        albaran_enviado: boolean;
      }>(
        `SELECT p.id, p.numero_pedido, p.cliente_id, p.albaran_enviado,
                COALESCE(p.cliente_email, c.email) AS cliente_email
         FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
         WHERE p.id = $1`,
        [pedidoId]
      );

      // Skip si el albarán de este pedido ya se envió
      if (pedido?.albaran_enviado) {
        await this.log({
          tipo: 'duplicado_evitado',
          resultado: 'omitido',
          detalle: { motivo: 'albaran_ya_enviado', pedido: pedido.numero_pedido },
        });
        return;
      }

      // Filtro por clientes: si la lista no es null, solo aplica a esos clientes.
      // Salidas silenciosas (sin log) — son condiciones esperadas, no eventos.
      if (Array.isArray(cfg.auto_email_albaran_clientes)) {
        if (cfg.auto_email_albaran_clientes.length === 0) return;
        if (!pedido?.cliente_id || !cfg.auto_email_albaran_clientes.includes(pedido.cliente_id)) return;
      }

      if (!pedido || !pedido.cliente_email) {
        await this.log({
          tipo: 'duplicado_evitado',
          resultado: 'omitido',
          detalle: { motivo: pedido ? 'cliente_sin_email' : 'pedido_no_encontrado', pedido_id: pedidoId },
        });
        return;
      }

      const { pedidoAlbaranService } = await import('./pedido-albaran.service.js');
      await pedidoAlbaranService.enviarAlbaran(pedidoId, pedido.cliente_email);

      // Marcar como enviado para que no se reintente
      await pool.query(
        `UPDATE pedidos SET albaran_enviado = TRUE, albaran_enviado_at = NOW(), albaran_enviado_a = $1
         WHERE id = $2`,
        [pedido.cliente_email, pedidoId]
      );

      await this.log({
        tipo: 'albaran_email_enviado',
        resultado: 'exito',
        detalle: { accion: 'albaran_cliente', pedido: pedido.numero_pedido, destinatario: pedido.cliente_email },
      });
    } catch (err) {
      console.error('[autoEmailAlbaran]', err);
      await this.log({
        tipo: 'error',
        resultado: 'fallo_definitivo',
        error_msg: err instanceof Error ? err.message : String(err),
        detalle: { accion: 'auto_email_albaran', pedido_id: pedidoId },
      }).catch(() => {});
    }
  }

  /**
   * Crear orden de fabricación automáticamente desde un pedido confirmado
   * que necesita producción (no hay stock granel).
   * Solo dispara si toggle ON, pedido en confirmado/nuevo, producto fabricable
   * (granel = producto_fabricado del producto pedido o del producto envasado).
   */
  async autoFabricarPedido(pedidoId: string): Promise<void> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.auto_fabricar_desde_pedido) return;

      const { rows: [pedido] } = await pool.query<{
        id: string; numero_pedido: string; estado: string; cliente_id: string | null;
        cliente_nombre: string | null; fecha_entrega: string | null; orden_produccion_id: string | null;
      }>(
        `SELECT id, numero_pedido, estado, cliente_id, cliente_nombre, fecha_entrega, orden_produccion_id
         FROM pedidos WHERE id = $1`, [pedidoId]
      );
      if (!pedido || pedido.estado !== 'confirmado' || pedido.orden_produccion_id) return;

      // Líneas con producto_id del granel a producir.
      // Para producto_envasado: el granel es producto.granel_id
      // Para producto_fabricado: el granel es el propio producto
      const { rows: lineas } = await pool.query<{
        producto_id: string; cantidad: string; producto_nombre: string;
        producto_tipo: string; granel_id: string | null;
      }>(
        `SELECT lp.producto_id, lp.cantidad, p.nombre AS producto_nombre,
                p.tipo::text AS producto_tipo, p.granel_id
         FROM lineas_pedido lp JOIN productos p ON p.id = lp.producto_id
         WHERE lp.pedido_id = $1`, [pedidoId]
      );
      if (lineas.length === 0) return;

      // Procesa cada línea individualmente. La primera no envasada con receta dispara la orden.
      for (const l of lineas) {
        const granelId = l.producto_tipo === 'producto_envasado' ? l.granel_id : l.producto_id;
        if (!granelId) continue;

        const { rows: [granel] } = await pool.query<{
          id: string; nombre: string; stock_actual: string;
        }>(`SELECT id, nombre, stock_actual FROM productos WHERE id = $1`, [granelId]);
        if (!granel) continue;

        const cantidadKg = parseFloat(l.cantidad); // si es envasado, peso = unidades*peso_unit
        // Para envasado se complica calcular kg desde uds; saltamos si es envasado y no hay datos
        // Solo activamos para granel directo de momento.
        if (l.producto_tipo !== 'producto_fabricado') continue;
        if (parseFloat(granel.stock_actual) >= cantidadKg) continue; // hay stock suficiente

        // Anti-dupe: no crear si ya hay orden borrador/confirmada/en_proceso de este granel
        // dentro de la ventana configurada (cfg.ventana_antiduplicado_dias). Antes
        // hardcoded 5 días — ahora consistente con el resto de acciones automáticas.
        const ventanaDias = Math.max(1, Number(cfg.ventana_antiduplicado_dias) || 5);
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM ordenes_produccion op JOIN recetas r ON r.id = op.receta_id
           WHERE r.producto_id = $1 AND op.estado IN ('borrador','confirmada','en_proceso')
             AND op.created_at >= NOW() - ($2 || ' days')::interval LIMIT 1`,
          [granelId, ventanaDias]
        );
        if (dup.length > 0) {
          await this.log({
            tipo: 'duplicado_evitado', resultado: 'omitido',
            detalle: { motivo: 'orden_ya_pendiente', producto: granel.nombre, pedido: pedido.numero_pedido },
          });
          continue;
        }

        const { rows: [receta] } = await pool.query<{ id: string; rendimiento: string }>(
          `SELECT id, rendimiento FROM recetas
           WHERE producto_id = $1 AND tipo_receta = 'fabricacion' AND activa = TRUE
           ORDER BY created_at DESC LIMIT 1`, [granelId]
        );
        if (!receta) {
          await this.log({
            tipo: 'duplicado_evitado', resultado: 'omitido',
            detalle: { motivo: 'sin_receta_fabricacion', producto: granel.nombre, pedido: pedido.numero_pedido },
          });
          continue;
        }

        const rendimiento = parseFloat(receta.rendimiento);
        const cantidadFinal = Math.max(rendimiento, cantidadKg);
        const fecha = pedido.fecha_entrega ?? new Date(Date.now() + (cfg.dias_anticipacion_default ?? 2) * 86_400_000).toISOString().slice(0, 10);

        // Crear orden en estado 'borrador'. NUNCA en 'confirmada' desde aquí:
        // confirmar = descontar stock real, y eso debe ser una acción explícita
        // (operario o llamada directa a produccionService.confirmarOrden), no
        // un side-effect implícito de un trigger automático. Crear en borrador
        // garantiza que no hay descuento doble si esta función se reentra.
        const { rows: [orden] } = await pool.query<{ id: string; numero_orden: string }>(
          `INSERT INTO ordenes_produccion
             (numero_orden, receta_id, cantidad_planificada, fecha_planificada, estado, tipo_orden,
              cliente, cliente_id, notas)
           VALUES (
             'OP-AUTO-' || to_char(NOW(), 'YYYYMMDD-HH24MISS'),
             $1, $2::NUMERIC, $3::DATE, 'borrador', 'fabricacion',
             $4, $5, $6
           )
           RETURNING id, numero_orden`,
          [
            receta.id, cantidadFinal.toFixed(6), fecha,
            pedido.cliente_nombre, pedido.cliente_id,
            `Auto-creada desde pedido ${pedido.numero_pedido}`,
          ]
        );

        // Linkar pedido + cambiar estado.
        // Pedido pasa a 'en_produccion' aunque la orden esté en borrador: el
        // operario debe revisar/confirmar la orden. orden_produccion_id ya
        // linkado evita re-creación si autoFabricarPedido se reentra.
        await pool.query(
          `UPDATE pedidos SET orden_produccion_id = $1, estado = 'en_produccion' WHERE id = $2`,
          [orden.id, pedidoId]
        );

        await this.log({
          tipo: 'pedido_auto_fabricar',
          resultado: 'exito',
          detalle: {
            accion: 'auto_fabricar_pedido',
            pedido: pedido.numero_pedido,
            orden: orden.numero_orden,
            producto: granel.nombre,
            cantidad: cantidadFinal,
            unidad: 'kg',
            fecha_planificada: fecha,
          },
        });
        return; // un pedido = una orden, no procesar más líneas
      }
    } catch (err) {
      console.error('[autoFabricarPedido]', err);
    }
  }

  /**
   * Sweep periódico (cron interno) — procesa pedidos pendientes:
   *   - confirmado/fabricado/envasado → autoCompletarPedido (si toggle ON)
   *   - completado sin albarán enviado → autoEmailAlbaran (si toggle ON)
   *
   * Es idempotente porque cada acción tiene su propia anti-duplicación.
   */
  /**
   * Avisar al cliente con la trazabilidad cuando su pedido pasa a 'fabricado'.
   * Mensaje: "Producto fabricado, en breve será enviado". Adjunta PDF
   * trazabilidad sin datos económicos. Marca pedidos.trazabilidad_enviada=true.
   */
  async autoEmailTrazabilidadFabricado(pedidoId: string): Promise<void> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.auto_email_trazabilidad_fabricado) return;

      const { rows: [pedido] } = await pool.query<{
        id: string; numero_pedido: string; estado: string; cliente_email: string | null;
        cliente_id: string | null; orden_produccion_id: string | null;
        trazabilidad_enviada: boolean;
      }>(
        `SELECT p.id, p.numero_pedido, p.estado, p.cliente_id, p.orden_produccion_id, p.trazabilidad_enviada,
                COALESCE(p.cliente_email, c.email) AS cliente_email
         FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
         WHERE p.id = $1`, [pedidoId]
      );
      if (!pedido) return;
      if (pedido.trazabilidad_enviada) return;
      if (!['fabricado', 'envasado', 'completado'].includes(pedido.estado)) return;
      if (!pedido.orden_produccion_id) return;
      if (!pedido.cliente_email) {
        await this.log({
          tipo: 'duplicado_evitado', resultado: 'omitido',
          detalle: { motivo: 'cliente_sin_email', pedido: pedido.numero_pedido, accion: 'trazabilidad_fabricado' },
        });
        return;
      }

      // Filtro por clientes (mismo que albarán) — silencioso
      if (Array.isArray(cfg.auto_email_albaran_clientes)) {
        if (cfg.auto_email_albaran_clientes.length === 0) return;
        if (!pedido.cliente_id || !cfg.auto_email_albaran_clientes.includes(pedido.cliente_id)) return;
      }

      const { pedidoAlbaranService } = await import('./pedido-albaran.service.js');
      await pedidoAlbaranService.enviarTrazabilidadFabricado(pedidoId, pedido.cliente_email);

      await pool.query(
        `UPDATE pedidos SET trazabilidad_enviada = TRUE, trazabilidad_enviada_at = NOW(), trazabilidad_enviada_a = $1 WHERE id = $2`,
        [pedido.cliente_email, pedidoId]
      );
      await this.log({
        tipo: 'trazabilidad_email_enviada',
        resultado: 'exito',
        detalle: { accion: 'trazabilidad_fabricado', pedido: pedido.numero_pedido, destinatario: pedido.cliente_email },
      });
    } catch (err) {
      console.error('[autoEmailTrazabilidadFabricado]', err);
      await this.log({
        tipo: 'error', resultado: 'fallo_definitivo',
        error_msg: err instanceof Error ? err.message : String(err),
        detalle: { accion: 'trazabilidad_fabricado', pedido_id: pedidoId },
      }).catch(() => {});
    }
  }

  /**
   * Sweep periódico de stock — recorre productos activos cuyo stock_actual
   * está por debajo de stock_minimo Y dispara checkStockAndTrigger.
   * Cubre el caso de productos que ya estaban bajo mínimo desde hace tiempo
   * (sin mutaciones recientes) — los hooks de mutación no los procesarían.
   * El anti-duplicado interno evita crear órdenes redundantes.
   */
  async sweepStockReglas(): Promise<void> {
    try {
      // Solo productos referenciados por al menos UNA regla activa (evita escanear todos)
      const { rows } = await pool.query<{ id: string }>(
        `SELECT DISTINCT p.id
         FROM productos p
         WHERE p.activo = TRUE
           AND p.stock_minimo > 0
           AND p.stock_actual <= p.stock_minimo
           AND (
             EXISTS (
               SELECT 1 FROM regla_productos rp
               JOIN automatizaciones_reglas r ON r.id = rp.regla_id
               WHERE rp.producto_id = p.id AND r.activa = TRUE
                 AND r.trigger_tipo IN ('stock_bajo_minimo', 'stock_cero')
             )
             OR EXISTS (
               -- Reglas sin filtro de producto (aplican a todo)
               SELECT 1 FROM automatizaciones_reglas r
               WHERE r.activa = TRUE
                 AND r.trigger_tipo IN ('stock_bajo_minimo', 'stock_cero')
                 AND NOT EXISTS (SELECT 1 FROM regla_productos rp2 WHERE rp2.regla_id = r.id)
             )
           )
         LIMIT 200`
      );
      for (const p of rows) {
        await this.checkStockAndTrigger(p.id);
      }
    } catch (err) {
      console.error('[sweepStockReglas]', err);
    }
  }

  async sweepPedidos(): Promise<void> {
    try {
      const cfg = await this.getConfig();
      if (cfg.auto_fabricar_desde_pedido) {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id FROM pedidos
           WHERE estado = 'confirmado' AND orden_produccion_id IS NULL
           ORDER BY created_at ASC LIMIT 50`
        );
        for (const p of rows) {
          await this.autoFabricarPedido(p.id);
        }
      }
      if (cfg.auto_completar_pedidos_con_stock) {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id FROM pedidos
           WHERE estado IN ('confirmado', 'fabricado', 'envasado')
           ORDER BY created_at ASC LIMIT 50`
        );
        for (const p of rows) {
          await this.autoCompletarPedido(p.id);
        }
      }
      if (cfg.auto_email_trazabilidad_fabricado) {
        const filtro2 = cfg.auto_email_albaran_clientes;
        const params2: unknown[] = [];
        let extra2 = '';
        if (Array.isArray(filtro2)) {
          if (filtro2.length === 0) {
            // saltamos sin querer procesar
          } else {
            extra2 = ' AND p.cliente_id = ANY($1::uuid[])';
            params2.push(filtro2);
          }
        }
        if (!Array.isArray(filtro2) || filtro2.length > 0) {
          const { rows: r2 } = await pool.query<{ id: string }>(
            `SELECT p.id FROM pedidos p
             WHERE p.estado IN ('fabricado','envasado','completado')
               AND p.trazabilidad_enviada = FALSE
               AND p.orden_produccion_id IS NOT NULL
               AND COALESCE(p.cliente_email, (SELECT email FROM clientes WHERE id = p.cliente_id)) IS NOT NULL
               ${extra2}
             ORDER BY p.created_at ASC LIMIT 50`, params2
          );
          for (const p of r2) await this.autoEmailTrazabilidadFabricado(p.id);
        }
      }
      if (cfg.auto_email_albaran) {
        // Si hay filtro de clientes, restringimos en query para no procesar
        // (y omitir/loguear) cientos de pedidos de clientes fuera del filtro.
        const filtro = cfg.auto_email_albaran_clientes;
        const params: unknown[] = [];
        let extra = '';
        if (Array.isArray(filtro)) {
          if (filtro.length === 0) return; // filtro vacío = nadie aplica
          extra = ' AND p.cliente_id = ANY($1::uuid[])';
          params.push(filtro);
        }
        const { rows } = await pool.query<{ id: string }>(
          `SELECT p.id FROM pedidos p
           WHERE p.estado = 'completado'
             AND p.albaran_enviado = FALSE
             AND COALESCE(p.cliente_email, (SELECT email FROM clientes WHERE id = p.cliente_id)) IS NOT NULL
             ${extra}
           ORDER BY p.created_at ASC LIMIT 50`,
          params
        );
        for (const p of rows) {
          await this.autoEmailAlbaran(p.id);
        }
      }
    } catch (err) {
      console.error('[sweepPedidos]', err);
    }
  }

  // ════════════════════════════════════════════════════════════
  // Backup automático nocturno
  // ════════════════════════════════════════════════════════════
  /**
   * Llamado por cron interno cada minuto (idempotente). Comprueba si
   * config.backup_auto_activo y la hora actual ≥ backup_auto_hora y la última
   * ejecución fue hace >12h. Lanza backup.
   */
  async tickBackupNocturno(force = false): Promise<void> {
    try {
      const cfg = await this.getConfig();
      if (!force && !cfg.backup_auto_activo) return;

      const ahora = new Date();
      const [hh, mm] = (cfg.backup_auto_hora ?? '02:00:00').split(':').map(Number);
      const horaProgramada = new Date(ahora);
      horaProgramada.setHours(hh ?? 2, mm ?? 0, 0, 0);

      if (!force) {
        // Aún no llegó la hora programada de hoy
        if (ahora < horaProgramada) return;
        // Si ya hay backup posterior a la hora programada de HOY → skip
        if (cfg.backup_auto_ultima) {
          const ultima = new Date(cfg.backup_auto_ultima);
          if (ultima >= horaProgramada) return;
        }
      }

      const { ejecutarBackup } = await import('./backup.service.js');
      const resultado = await ejecutarBackup();
      await pool.query(
        `UPDATE configuracion_automatizaciones SET backup_auto_ultima = NOW() WHERE id = 1`
      );
      this.invalidateConfig();

      await this.log({
        tipo: 'backup_creado',
        resultado: 'exito',
        detalle: { accion: 'backup_nocturno', archivo: resultado?.filename ?? '?', tamano: resultado?.size ?? null, drive: resultado?.drive },
      });
    } catch (err) {
      console.error('[tickBackupNocturno]', err);
      await this.log({
        tipo: 'error',
        resultado: 'fallo_definitivo',
        error_msg: err instanceof Error ? err.message : String(err),
        detalle: { accion: 'backup_nocturno' },
      }).catch(() => {});
    }
  }

  // ── Helper interno: insert log ────────────────────────────────
  private async log(entry: {
    tipo: string;
    resultado: string;
    producto_id?: string;
    proveedor_id?: string | null;
    orden_compra_id?: string | null;
    orden_id?: string | null;
    lote_id?: string | null;
    regla_id?: string | null;
    detalle: Record<string, unknown>;
    error_msg?: string;
    retry_count?: number;
    next_retry_at?: Date | null;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO automatizaciones_log
         (tipo, resultado, producto_id, proveedor_id, orden_compra_id, orden_id, lote_id,
          regla_id, detalle, error_msg, retry_count, next_retry_at)
       VALUES ($1::tipo_automatizacion, $2::resultado_automatizacion,
               $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
      [
        entry.tipo, entry.resultado,
        entry.producto_id ?? null, entry.proveedor_id ?? null,
        entry.orden_compra_id ?? null, entry.orden_id ?? null, entry.lote_id ?? null,
        entry.regla_id ?? null,
        JSON.stringify(entry.detalle), entry.error_msg ?? null,
        entry.retry_count ?? 0, entry.next_retry_at ?? null,
      ]
    );
  }
}

export const automatizacionesService = new AutomatizacionesService();
