/**
 * Rutas de automatizaciones.
 *  GET    /config              — leer toggles globales
 *  PUT    /config              — actualizar toggles (admin)
 *  GET    /productos           — overrides por producto
 *  PUT    /productos/:id       — set override (admin)
 *  GET    /log                 — historial paginado, filtros
 *  GET    /log/no-leidas       — count + lista para toast polling
 *  POST   /log/:id/retry       — forzar reintento (admin)
 *  POST   /log/marcar-leidas   — marcar batch como leídas
 *  POST   /test/:productoId    — disparar manualmente (admin, debug)
 */
import { Router } from 'express';
import { pool } from '../db/pool';
import { adminOnly } from '../middleware/auth';
import { automatizacionesService } from '../services/automatizaciones.service';

const router = Router();

// ── Config ─────────────────────────────────────────────────────
router.get('/config', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM configuracion_automatizaciones WHERE id = 1`);
    res.json(rows[0] ?? null);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.put('/config', adminOnly, async (req, res) => {
  try {
    const allowed = [
      'auto_compra_activa', 'auto_email_proveedor', 'auto_fabricacion_activa',
      'auto_envasado_activa', 'auto_aprobacion_qc', 'safety_stock_pct_default',
      'dias_anticipacion_default', 'ventana_antiduplicado_dias',
      'email_max_reintentos', 'email_intervalo_reintento_min',
      'auto_completar_pedidos_con_stock', 'auto_email_albaran',
      'auto_email_albaran_clientes', 'auto_email_trazabilidad_fabricado',
      'auto_fabricar_desde_pedido', 'auto_envasar_desde_pedido',
      'backup_auto_activo', 'backup_auto_hora',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const k of allowed) {
      if (k in req.body) {
        const v = req.body[k];
        // Cast explícito por columnas que necesitan tipo SQL específico
        if (k === 'auto_email_albaran_clientes') {
          sets.push(`${k} = $${idx++}::uuid[]`);
          params.push(v === null ? null : (Array.isArray(v) ? v : []));
        } else if (k === 'backup_auto_hora') {
          sets.push(`${k} = $${idx++}::time`);
          params.push(v);
        } else {
          sets.push(`${k} = $${idx++}`);
          params.push(v);
        }
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'sin_cambios' });
    sets.push(`updated_at = NOW()`);
    await pool.query(
      `UPDATE configuracion_automatizaciones SET ${sets.join(', ')} WHERE id = 1`,
      params
    );
    automatizacionesService.invalidateConfig();
    const { rows } = await pool.query(`SELECT * FROM configuracion_automatizaciones WHERE id = 1`);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── Overrides por producto ────────────────────────────────────
router.get('/productos', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, nombre, tipo, unidad_medida, stock_actual, stock_minimo,
              proveedor_id,
              auto_email_proveedor, auto_compra_activa, auto_fabricacion_activa,
              auto_envasado_activa, safety_stock_pct, dias_anticipacion,
              cantidad_promedio_mensual
       FROM productos
       WHERE activo = TRUE
       ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.put('/productos/:id', adminOnly, async (req, res) => {
  try {
    const allowed = [
      'auto_email_proveedor', 'auto_compra_activa', 'auto_fabricacion_activa',
      'auto_envasado_activa', 'safety_stock_pct', 'dias_anticipacion',
      'cantidad_promedio_mensual',
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const k of allowed) {
      if (k in req.body) {
        sets.push(`${k} = $${idx++}`);
        params.push(req.body[k]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'sin_cambios' });
    params.push(req.params.id);
    await pool.query(
      `UPDATE productos SET ${sets.join(', ')} WHERE id = $${idx}`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── Historial log ─────────────────────────────────────────────
router.get('/log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const tipo = req.query.tipo as string | undefined;
    const resultado = req.query.resultado as string | undefined;
    const productoId = req.query.producto_id as string | undefined;

    const conds: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (tipo) { conds.push(`l.tipo = $${idx++}::tipo_automatizacion`); params.push(tipo); }
    if (resultado) { conds.push(`l.resultado = $${idx++}::resultado_automatizacion`); params.push(resultado); }
    if (productoId) { conds.push(`l.producto_id = $${idx++}`); params.push(productoId); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT l.*,
              p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.unidad_medida,
              pv.nombre AS proveedor_nombre,
              op.numero_orden AS orden_numero,
              pp.estado       AS orden_compra_estado
       FROM automatizaciones_log l
       LEFT JOIN productos p ON p.id = l.producto_id
       LEFT JOIN proveedores pv ON pv.id = l.proveedor_id
       LEFT JOIN ordenes_produccion op ON op.id = l.orden_id
       LEFT JOIN pedidos_proveedor pp ON pp.id = l.orden_compra_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM automatizaciones_log l ${where}`,
      params
    );
    res.json({ rows, total: count?.total ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/log/no-leidas', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.tipo::text AS tipo, l.resultado::text AS resultado,
              l.detalle, l.error_msg, l.created_at,
              l.orden_id, l.orden_compra_id,
              p.codigo AS producto_codigo, p.nombre AS producto_nombre,
              op.numero_orden AS orden_numero
       FROM automatizaciones_log l
       LEFT JOIN productos p ON p.id = l.producto_id
       LEFT JOIN ordenes_produccion op ON op.id = l.orden_id
       WHERE l.leida = FALSE
       ORDER BY l.created_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/log/marcar-leidas', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (ids && ids.length > 0) {
      await pool.query(`UPDATE automatizaciones_log SET leida = TRUE WHERE id = ANY($1::uuid[])`, [ids]);
    } else {
      await pool.query(`UPDATE automatizaciones_log SET leida = TRUE WHERE leida = FALSE`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/log/:id/retry', adminOnly, async (req, res) => {
  try {
    const { rows: [log] } = await pool.query<{
      id: string; tipo: string; producto_id: string; orden_compra_id: string | null;
      retry_count: number; detalle: { cantidad?: number };
    }>(
      `SELECT id, tipo::text AS tipo, producto_id, orden_compra_id, retry_count, detalle
       FROM automatizaciones_log WHERE id = $1`,
      [req.params.id]
    );
    if (!log) return res.status(404).json({ error: 'log_no_encontrado' });
    if (log.tipo !== 'email_proveedor_enviado') {
      return res.status(400).json({ error: 'solo_emails_son_reintentables' });
    }
    if (!log.orden_compra_id) return res.status(400).json({ error: 'sin_orden_compra' });

    const { rows: [prod] } = await pool.query(
      `SELECT p.id, p.codigo, p.nombre, p.tipo::text AS tipo, p.unidad_medida,
              p.stock_actual, p.stock_minimo, p.proveedor_id, p.granel_id, p.activo,
              p.auto_email_proveedor, p.auto_compra_activa, p.auto_fabricacion_activa,
              p.auto_envasado_activa, p.safety_stock_pct, p.dias_anticipacion,
              p.cantidad_promedio_mensual,
              pv.email AS proveedor_email, pv.nombre AS proveedor_nombre
       FROM productos p LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
       WHERE p.id = $1`,
      [log.producto_id]
    );
    if (!prod) return res.status(404).json({ error: 'producto_no_encontrado' });

    const cantidad = Number(log.detalle?.cantidad ?? 0);
    await automatizacionesService.intentarEmailProveedor(prod, log.orden_compra_id, cantidad, log.retry_count + 1);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/test/:productoId', adminOnly, async (req, res) => {
  try {
    await automatizacionesService.checkStockAndTrigger(req.params.productoId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// Disparar manualmente reglas sistema sobre estado actual
router.post('/sistema/:accion/run', adminOnly, async (req, res) => {
  try {
    const { accion } = req.params;
    if (accion === 'auto_fabricar_pedido') {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM pedidos
         WHERE estado = 'confirmado' AND orden_produccion_id IS NULL
         ORDER BY created_at DESC LIMIT 50`
      );
      let procesados = 0;
      for (const p of rows) {
        await automatizacionesService.autoFabricarPedido(p.id);
        procesados++;
      }
      return res.json({ ok: true, procesados });
    }
    if (accion === 'auto_completar_pedido') {
      // Disparo manual: procesa TODOS los confirmados/fabricados/envasados
      // (sin ventana de tiempo) hasta un máximo de 50.
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM pedidos
         WHERE estado IN ('confirmado', 'fabricado', 'envasado')
         ORDER BY created_at DESC LIMIT 50`
      );
      let procesados = 0;
      for (const p of rows) {
        await automatizacionesService.autoCompletarPedido(p.id);
        procesados++;
      }
      return res.json({ ok: true, procesados });
    }
    if (accion === 'albaran_cliente') {
      const { rows: [cfgRow] } = await pool.query<{ auto_email_albaran_clientes: string[] | null }>(
        `SELECT auto_email_albaran_clientes FROM configuracion_automatizaciones WHERE id = 1`
      );
      const filtro = cfgRow?.auto_email_albaran_clientes;
      const params: unknown[] = [];
      let extra = '';
      if (Array.isArray(filtro)) {
        if (filtro.length === 0) return res.json({ ok: true, procesados: 0 });
        extra = ' AND p.cliente_id = ANY($1::uuid[])';
        params.push(filtro);
      }
      const { rows } = await pool.query<{ id: string }>(
        `SELECT p.id FROM pedidos p
         WHERE p.estado = 'completado'
           AND p.albaran_enviado = FALSE
           AND COALESCE(p.cliente_email, (SELECT email FROM clientes WHERE id = p.cliente_id)) IS NOT NULL
           ${extra}
         ORDER BY p.created_at DESC LIMIT 50`,
        params
      );
      let procesados = 0;
      for (const p of rows) {
        await automatizacionesService.autoEmailAlbaran(p.id);
        procesados++;
      }
      return res.json({ ok: true, procesados });
    }
    if (accion === 'backup_nocturno') {
      await automatizacionesService.tickBackupNocturno(true);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'accion_desconocida' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ════════════════════════════════════════════════════════════
// Reglas — CRUD + ejecutar manual
// ════════════════════════════════════════════════════════════
router.get('/reglas', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(
                (SELECT json_agg(json_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre))
                 FROM regla_productos rp JOIN productos p ON p.id = rp.producto_id
                 WHERE rp.regla_id = r.id),
                '[]'::json
              ) AS productos
       FROM automatizaciones_reglas r
       ORDER BY r.activa DESC, r.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/reglas/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(
                (SELECT json_agg(p.id) FROM regla_productos rp JOIN productos p ON p.id = rp.producto_id WHERE rp.regla_id = r.id),
                '[]'::json
              ) AS producto_ids
       FROM automatizaciones_reglas r WHERE r.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'regla_no_encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/reglas', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      nombre, descripcion, activa = true, icono = 'zap', color = 'red',
      trigger_tipo, trigger_config = {}, accion_tipo, accion_config = {},
      producto_ids = [],
    } = req.body;
    if (!nombre || !trigger_tipo || !accion_tipo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'nombre, trigger_tipo y accion_tipo son obligatorios' });
    }
    const userId = (req as { user?: { id?: string } }).user?.id ?? null;
    const { rows: [regla] } = await client.query(
      `INSERT INTO automatizaciones_reglas
         (nombre, descripcion, activa, icono, color,
          trigger_tipo, trigger_config, accion_tipo, accion_config, creado_por)
       VALUES ($1, $2, $3, $4, $5,
               $6::trigger_automatizacion, $7::jsonb, $8::accion_automatizacion, $9::jsonb, $10)
       RETURNING id`,
      [nombre, descripcion ?? null, activa, icono, color,
       trigger_tipo, JSON.stringify(trigger_config),
       accion_tipo, JSON.stringify(accion_config), userId]
    );
    if (Array.isArray(producto_ids) && producto_ids.length > 0) {
      for (const pid of producto_ids) {
        await client.query(
          `INSERT INTO regla_productos (regla_id, producto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [regla.id, pid]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, id: regla.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  } finally {
    client.release();
  }
});

router.put('/reglas/:id', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowed = ['nombre', 'descripcion', 'activa', 'icono', 'color',
                     'trigger_tipo', 'trigger_config', 'accion_tipo', 'accion_config'];
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const k of allowed) {
      if (k in req.body) {
        if (k === 'trigger_config' || k === 'accion_config') {
          sets.push(`${k} = $${idx++}::jsonb`);
          params.push(JSON.stringify(req.body[k]));
        } else if (k === 'trigger_tipo') {
          sets.push(`${k} = $${idx++}::trigger_automatizacion`);
          params.push(req.body[k]);
        } else if (k === 'accion_tipo') {
          sets.push(`${k} = $${idx++}::accion_automatizacion`);
          params.push(req.body[k]);
        } else {
          sets.push(`${k} = $${idx++}`);
          params.push(req.body[k]);
        }
      }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(req.params.id);
      await client.query(
        `UPDATE automatizaciones_reglas SET ${sets.join(', ')} WHERE id = $${idx}`,
        params
      );
    }
    if (Array.isArray(req.body.producto_ids)) {
      await client.query(`DELETE FROM regla_productos WHERE regla_id = $1`, [req.params.id]);
      for (const pid of req.body.producto_ids) {
        await client.query(
          `INSERT INTO regla_productos (regla_id, producto_id) VALUES ($1, $2)`,
          [req.params.id, pid]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  } finally {
    client.release();
  }
});

router.delete('/reglas/:id', adminOnly, async (req, res) => {
  try {
    await pool.query(`DELETE FROM automatizaciones_reglas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/reglas/:id/ejecutar', adminOnly, async (req, res) => {
  try {
    const productoId = req.body?.producto_id as string | undefined;
    await automatizacionesService.ejecutarReglaManual(req.params.id, productoId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/reglas/:id/duplicar', adminOnly, async (req, res) => {
  try {
    const { rows: [orig] } = await pool.query(
      `SELECT * FROM automatizaciones_reglas WHERE id = $1`, [req.params.id]
    );
    if (!orig) return res.status(404).json({ error: 'no_encontrada' });
    const { rows: [nueva] } = await pool.query(
      `INSERT INTO automatizaciones_reglas
         (nombre, descripcion, activa, icono, color, trigger_tipo, trigger_config, accion_tipo, accion_config)
       VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [`${orig.nombre} (copia)`, orig.descripcion, orig.icono, orig.color,
       orig.trigger_tipo, orig.trigger_config, orig.accion_tipo, orig.accion_config]
    );
    await pool.query(
      `INSERT INTO regla_productos (regla_id, producto_id)
       SELECT $1, producto_id FROM regla_productos WHERE regla_id = $2`,
      [nueva.id, req.params.id]
    );
    res.json({ ok: true, id: nueva.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
