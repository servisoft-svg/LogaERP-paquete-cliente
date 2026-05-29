import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';

const router = Router();

// ── Secret HMAC compartido con Alilo ──────────────────────────────
// Prioridad de origen:
//   1. process.env.ALILO_SHARED_SECRET (override opcional)
//   2. tabla integracion_alilo_config (singleton, auto-generado al arrancar)
// Se cachea en memoria tras primer fetch para evitar query en cada request.
let cachedSecret: string | null = null;

export async function getAliloSharedSecret(): Promise<string> {
  if (process.env.ALILO_SHARED_SECRET) return process.env.ALILO_SHARED_SECRET;
  if (cachedSecret) return cachedSecret;

  const { rows: [row] } = await pool.query<{ shared_secret: string }>(
    `SELECT shared_secret FROM integracion_alilo_config WHERE id = 1`
  );
  if (row?.shared_secret) {
    cachedSecret = row.shared_secret;
    return cachedSecret;
  }

  // Sin fila → auto-generar y persistir
  const newSecret = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO integracion_alilo_config (id, shared_secret) VALUES (1, $1)
     ON CONFLICT (id) DO NOTHING`,
    [newSecret]
  );
  // Re-fetch por si otra request lo insertó en paralelo
  const { rows: [final] } = await pool.query<{ shared_secret: string }>(
    `SELECT shared_secret FROM integracion_alilo_config WHERE id = 1`
  );
  cachedSecret = final.shared_secret;
  logger.info('[alilo] secret HMAC auto-generado y persistido en BD');
  return cachedSecret;
}

/**
 * Notifica a Alilo (fire-and-forget) un cambio de stock en un producto compartido.
 * No falla si no hay webhook configurado ni si Alilo no responde — solo log.
 * Firma con el mismo shared_secret de la integración.
 */
export async function notifyAliloStock(opts: {
  codigo: string;          // codigo de Loga (el "original")
  codigo_alilo: string | null; // mapeo si lo hay
  nombre: string;
  stock_actual: number;
  precio_unitario: number;
  unidad: string;
  motivo?: string;
  precio_lote_actual?: number | null;
  lote_actual_interno?: string | null;
}): Promise<void> {
  try {
    const { rows: [cfg] } = await pool.query<{ alilo_webhook_url: string | null }>(
      `SELECT alilo_webhook_url FROM integracion_alilo_config WHERE id = 1`
    );
    const url = cfg?.alilo_webhook_url?.trim();
    if (!url) return;
    const secret = await getAliloSharedSecret();
    if (!secret) return;
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      codigo: opts.codigo,
      codigo_alilo: opts.codigo_alilo,
      nombre: opts.nombre,
      stock_actual: opts.stock_actual,
      precio_unitario: opts.precio_unitario,
      precio_lote_actual: opts.precio_lote_actual ?? null,
      lote_actual_interno: opts.lote_actual_interno ?? null,
      unidad: opts.unidad,
      motivo: opts.motivo ?? 'stock_update',
      timestamp: ts,
    });
    const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    // Timeout corto: el push es best-effort, no bloquea la operación principal
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': String(ts),
          'X-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn('[alilo.notify] status', { status: res.status, codigo: opts.codigo });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // Silencioso: la notificación NO debe romper la operación
    logger.warn('[alilo.notify] error', { e: e instanceof Error ? e.message : String(e) });
  }
}

export async function regenerateAliloSecret(): Promise<string> {
  const newSecret = randomBytes(32).toString('hex');
  await pool.query(
    `UPDATE integracion_alilo_config SET shared_secret = $1, updated_at = now() WHERE id = 1`,
    [newSecret]
  );
  cachedSecret = newSecret;
  logger.info('[alilo] secret HMAC regenerado por admin');
  return newSecret;
}

// Tolerancia de timestamp para evitar replay attacks (5 min).
const MAX_SKEW_SECONDS = 5 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helper: registrar llamada en log ───────────────────────────────
async function logCall(opts: {
  endpoint: string;
  status: number;
  payload?: unknown;
  respuesta?: unknown;
  error?: string;
  ip?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO integracion_alilo_log (endpoint, payload, status_code, respuesta, ip_origen, error)
       VALUES ($1, $2::JSONB, $3, $4::JSONB, $5, $6)`,
      [
        opts.endpoint,
        opts.payload != null ? JSON.stringify(opts.payload) : null,
        opts.status,
        opts.respuesta != null ? JSON.stringify(opts.respuesta) : null,
        opts.ip ?? null,
        opts.error ?? null,
      ]
    );
  } catch (e) {
    logger.error('[alilo] no se pudo guardar log', e);
  }
}

// ── Middleware: verifica HMAC + anti-replay ────────────────────────
// Headers requeridos:
//   X-Timestamp: <unix-seconds>
//   X-Signature: hex(HMAC-SHA256(timestamp + '.' + body, SECRET))
async function verifyHmac(req: Request, res: Response, next: NextFunction): Promise<void> {
  const endpoint = `${req.method} ${req.path}`;
  const ip = req.ip ?? req.socket.remoteAddress ?? undefined;

  const SHARED_SECRET = await getAliloSharedSecret();
  if (!SHARED_SECRET) {
    logCall({ endpoint, status: 503, error: 'Secret HMAC no disponible', ip });
    res.status(503).json({ error: 'Servicio no disponible' });
    return;
  }

  const sigHeader = String(req.header('x-signature') ?? '').trim();
  const tsHeader = String(req.header('x-timestamp') ?? '').trim();

  if (!sigHeader || !tsHeader) {
    logCall({ endpoint, status: 401, error: 'Missing X-Signature or X-Timestamp', ip });
    res.status(401).json({ error: 'Faltan cabeceras X-Signature / X-Timestamp' });
    return;
  }

  // Anti-replay: el timestamp no puede tener > 5 min de skew.
  const ts = parseInt(tsHeader, 10);
  if (!Number.isFinite(ts)) {
    logCall({ endpoint, status: 401, error: 'X-Timestamp inválido', ip });
    res.status(401).json({ error: 'X-Timestamp inválido' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    logCall({ endpoint, status: 401, error: `Timestamp fuera de rango (skew ${now - ts}s)`, ip });
    res.status(401).json({ error: 'Timestamp fuera de rango (clock skew > 5min)' });
    return;
  }

  // Raw body capturado por express.json verify (configurado en index.ts).
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  const expected = createHmac('sha256', SHARED_SECRET).update(`${ts}.${rawBody}`).digest();
  let received: Buffer;
  try {
    received = Buffer.from(sigHeader, 'hex');
  } catch {
    logCall({ endpoint, status: 401, error: 'X-Signature no es hex válido', ip });
    res.status(401).json({ error: 'X-Signature inválida' });
    return;
  }

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    logCall({ endpoint, status: 401, error: 'HMAC mismatch', payload: req.body, ip });
    res.status(401).json({ error: 'Firma HMAC inválida' });
    return;
  }

  next();
}

// ── POST /api/integracion/alilo/consumir ───────────────────────────
// Body: { codigo: string, cantidad: number, motivo?: string, idempotency_key: UUID }
// Resp 200: { ok: true, stock_restante: number, lotes_consumidos: [{lote, cantidad}] }
// Resp 422: { ok: false, error: 'stock_insuficiente', disponible: number }
// Resp 404: { ok: false, error: 'producto_no_encontrado' }
// Resp 403: { ok: false, error: 'producto_no_compartido' }
// Resp 401: firma/timestamp
router.post('/consumir', verifyHmac, async (req: Request, res: Response) => {
  const endpoint = 'POST /consumir';
  const ip = req.ip ?? req.socket.remoteAddress ?? undefined;
  const { codigo, cantidad, motivo, idempotency_key } = req.body ?? {};

  // ── Validación de input ──
  if (typeof codigo !== 'string' || !codigo.trim() || codigo.length > 50) {
    const resp = { ok: false, error: 'codigo_invalido' };
    await logCall({ endpoint, status: 400, payload: req.body, respuesta: resp, ip });
    return res.status(400).json(resp);
  }
  if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0) {
    const resp = { ok: false, error: 'cantidad_invalida' };
    await logCall({ endpoint, status: 400, payload: req.body, respuesta: resp, ip });
    return res.status(400).json(resp);
  }
  if (typeof idempotency_key !== 'string' || !UUID_RE.test(idempotency_key)) {
    const resp = { ok: false, error: 'idempotency_key_invalida' };
    await logCall({ endpoint, status: 400, payload: req.body, respuesta: resp, ip });
    return res.status(400).json(resp);
  }
  const codigoNorm = codigo.trim().toUpperCase();
  const motivoNorm = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : null;

  // ── Idempotency: si ya procesamos esta key → devolver resultado cacheado ──
  const { rows: [existing] } = await pool.query<{ resultado: Record<string, unknown> }>(
    `SELECT resultado FROM integracion_alilo_keys WHERE idempotency_key = $1`,
    [idempotency_key]
  );
  if (existing) {
    await logCall({ endpoint, status: 200, payload: req.body, respuesta: { ...existing.resultado, replayed: true }, ip });
    return res.status(200).json({ ...existing.resultado, replayed: true });
  }

  // ── Transacción atómica: bloquea producto y lotes, descuenta FEFO ──
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Busca por codigo_alilo primero (mapeo cross-sistema), fallback a codigo directo.
    // Bloqueo de fila producto (evita race condition con otra petición).
    const { rows: [producto] } = await client.query<{
      id: string; nombre: string; codigo: string; stock_actual: string;
      compartido_alilo: boolean; unidad_medida: string;
    }>(
      `SELECT id, nombre, codigo, stock_actual, compartido_alilo, unidad_medida
       FROM productos
       WHERE (codigo_alilo = $1 OR codigo = $1) AND activo = TRUE
       ORDER BY (codigo_alilo = $1) DESC
       LIMIT 1
       FOR UPDATE`,
      [codigoNorm]
    );
    if (!producto) {
      await client.query('ROLLBACK');
      const resp = { ok: false, error: 'producto_no_encontrado', codigo: codigoNorm };
      await logCall({ endpoint, status: 404, payload: req.body, respuesta: resp, ip });
      return res.status(404).json(resp);
    }
    if (!producto.compartido_alilo) {
      await client.query('ROLLBACK');
      const resp = { ok: false, error: 'producto_no_compartido', codigo: codigoNorm };
      await logCall({ endpoint, status: 403, payload: req.body, respuesta: resp, ip });
      return res.status(403).json(resp);
    }

    // Stock total disponible (lotes aprobados con cantidad > 0)
    const { rows: lotes } = await client.query<{
      id: string; lote_interno: string; lote_proveedor: string | null;
      cantidad_actual: string; cantidad_inicial: string;
      precio_compra: string | null; porte: string | null;
      fecha_caducidad: string | null; fecha_entrada: string;
      ubicacion: string | null;
      ph: string | null; solidos: string | null; viscosidad: string | null;
    }>(
      `SELECT id, lote_interno, lote_proveedor, cantidad_actual, cantidad_inicial,
              precio_compra, porte, fecha_caducidad, fecha_entrada,
              ubicacion, ph, solidos, viscosidad
       FROM lotes
       WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
       ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC
       FOR UPDATE`,
      [producto.id]
    );
    const disponible = lotes.reduce((s, l) => s + parseFloat(l.cantidad_actual), 0);

    if (disponible < cantidad) {
      await client.query('ROLLBACK');
      const resp = {
        ok: false, error: 'stock_insuficiente',
        codigo: codigoNorm, solicitado: cantidad, disponible,
      };
      await logCall({ endpoint, status: 422, payload: req.body, respuesta: resp, ip });
      return res.status(422).json(resp);
    }

    // Descuenta FEFO: va tomando del primer lote hasta cubrir cantidad
    let restante = cantidad;
    const lotesConsumidos: {
      lote: string;
      lote_proveedor: string | null;
      cantidad: number;
      precio_compra: number | null;
      porte: number | null;
      fecha_caducidad: string | null;
      fecha_entrada: string | null;
      ubicacion: string | null;
      ph: number | null;
      solidos: number | null;
      viscosidad: number | null;
    }[] = [];
    for (const lote of lotes) {
      if (restante <= 0) break;
      const disponibleLote = parseFloat(lote.cantidad_actual);
      const tomar = Math.min(disponibleLote, restante);

      const antes = disponibleLote;
      const despues = antes - tomar;

      // Decrementar lote (trigger fn_trg_lotes_stock_actual recalcula productos.stock_actual)
      await client.query(
        `UPDATE lotes SET cantidad_actual = $1::NUMERIC WHERE id = $2`,
        [despues.toFixed(6), lote.id]
      );

      // Registrar movimiento con tipo 'consumo_externo' (visible en trazabilidad)
      await client.query(
        `INSERT INTO stock_moves
           (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_externa, motivo)
         VALUES ($1, $2, 'consumo_externo', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
        [
          producto.id, lote.id,
          tomar.toFixed(6), antes.toFixed(6), despues.toFixed(6),
          `alilo:${idempotency_key}`,
          motivoNorm ? `Consumo Alilo — ${motivoNorm}` : 'Consumo Alilo',
        ]
      );

      const parseNum = (v: string | null): number | null => v != null ? parseFloat(v) : null;
      lotesConsumidos.push({
        lote: lote.lote_interno,
        lote_proveedor: lote.lote_proveedor,
        cantidad: tomar,
        precio_compra: parseNum(lote.precio_compra),
        porte: parseNum(lote.porte),
        fecha_caducidad: lote.fecha_caducidad,
        fecha_entrada: lote.fecha_entrada,
        ubicacion: lote.ubicacion,
        ph: parseNum(lote.ph),
        solidos: parseNum(lote.solidos),
        viscosidad: parseNum(lote.viscosidad),
      });
      restante -= tomar;
    }

    // Releer stock_actual después del descuento (los triggers lo actualizan)
    const { rows: [stockNow] } = await client.query<{ stock_actual: string }>(
      `SELECT stock_actual FROM productos WHERE id = $1`,
      [producto.id]
    );

    const resultado = {
      ok: true,
      codigo: producto.codigo,
      nombre: producto.nombre,
      unidad: producto.unidad_medida,
      consumido: cantidad,
      stock_restante: parseFloat(stockNow.stock_actual),
      lotes_consumidos: lotesConsumidos,
      timestamp: new Date().toISOString(),
    };

    // Guardar idempotency key con el resultado.
    // ON CONFLICT DO NOTHING + RETURNING evita la race entre dos peticiones
    // simultáneas con misma key: la segunda recibe NULL aquí y devolvemos
    // el resultado cacheado por la primera (consistente).
    const { rows: insertResult } = await client.query<{ idempotency_key: string }>(
      `INSERT INTO integracion_alilo_keys (idempotency_key, resultado) VALUES ($1, $2::JSONB)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [idempotency_key, JSON.stringify(resultado)]
    );

    if (insertResult.length === 0) {
      // Otra petición concurrente ya procesó esta key — rollback nuestro descuento
      // y devolver el resultado de la primera (única fuente de verdad).
      await client.query('ROLLBACK');
      const { rows: [first] } = await pool.query<{ resultado: Record<string, unknown> }>(
        `SELECT resultado FROM integracion_alilo_keys WHERE idempotency_key = $1`,
        [idempotency_key]
      );
      const resp = first ? { ...first.resultado, replayed: true } : { ok: false, error: 'race_condition' };
      await logCall({ endpoint, status: 200, payload: req.body, respuesta: resp, ip });
      return res.status(200).json(resp);
    }

    await client.query('COMMIT');
    await logCall({ endpoint, status: 200, payload: req.body, respuesta: resultado, ip });
    // Notifica a Alilo (fire-and-forget) — actualiza su cache de stock
    const { rows: [provInfo] } = await pool.query<{
      codigo_alilo: string | null; precio_unitario: string;
    }>(`SELECT codigo_alilo, precio_unitario FROM productos WHERE id = $1`, [producto.id]);
    notifyAliloStock({
      codigo: producto.codigo,
      codigo_alilo: provInfo?.codigo_alilo ?? null,
      nombre: producto.nombre,
      stock_actual: parseFloat(stockNow.stock_actual),
      precio_unitario: parseFloat(provInfo?.precio_unitario ?? '0'),
      unidad: producto.unidad_medida,
      motivo: `Consumo por Alilo (${codigoNorm})`,
    }).catch(() => {/* silencioso */});
    return res.status(200).json(resultado);
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    // Mensaje interno (BD, query…) NO se expone al cliente.
    const msgInterno = err instanceof Error ? err.message : 'Error';
    logger.error('[alilo.consumir]', { err: msgInterno });
    const respCliente = { ok: false, error: 'internal_error' };
    await logCall({ endpoint, status: 500, payload: req.body, respuesta: respCliente, ip, error: msgInterno });
    return res.status(500).json(respCliente);
  } finally {
    client.release();
  }
});

// ── POST /api/integracion/alilo/stock ──────────────────────────────
// Devuelve stock + precio de un producto compartido. HMAC-authenticated.
// Body: { codigo }   (mismo formato que /consumir, sin idempotency_key)
router.post('/stock', verifyHmac, async (req: Request, res: Response) => {
  const { codigo } = req.body ?? {};
  if (typeof codigo !== 'string' || !codigo.trim() || codigo.length > 50) {
    return res.status(400).json({ ok: false, error: 'codigo_invalido' });
  }
  const codigoNorm = codigo.trim().toUpperCase();
  try {
    const { rows: [producto] } = await pool.query<{
      id: string; codigo: string; nombre: string;
      stock_actual: string; precio_unitario: string; unidad_medida: string;
      compartido_alilo: boolean;
    }>(
      `SELECT id, codigo, nombre, stock_actual, precio_unitario, unidad_medida, compartido_alilo
       FROM productos
       WHERE (codigo_alilo = $1 OR codigo = $1) AND activo = TRUE
       ORDER BY (codigo_alilo = $1) DESC
       LIMIT 1`,
      [codigoNorm]
    );
    if (!producto) return res.status(404).json({ ok: false, error: 'producto_no_encontrado' });
    if (!producto.compartido_alilo) return res.status(403).json({ ok: false, error: 'producto_no_compartido' });
    // Precio del lote FEFO (el próximo a consumir) — más realista que precio_unitario de ficha
    const { rows: [fefo] } = await pool.query<{ precio_compra: string | null; lote_interno: string }>(
      `SELECT precio_compra, lote_interno
       FROM lotes
       WHERE producto_id = $1 AND estado = 'aprobado' AND cantidad_actual > 0
       ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC
       LIMIT 1`,
      [producto.id]
    );
    return res.json({
      ok: true,
      codigo: producto.codigo,
      nombre: producto.nombre,
      stock_actual: parseFloat(producto.stock_actual),
      precio_unitario: parseFloat(producto.precio_unitario),
      precio_lote_actual: fefo?.precio_compra ? parseFloat(fefo.precio_compra) : null,
      lote_actual_interno: fefo?.lote_interno ?? null,
      unidad: producto.unidad_medida,
    });
  } catch (err) {
    logger.error('[alilo.stock]', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── POST /api/integracion/alilo/lotes ──────────────────────────────
// Devuelve los lotes activos (estado=aprobado, cantidad_actual>0) de un
// producto compartido con Alilo. HMAC-authenticated.
// Body: { codigo }   — código Loga o codigo_alilo
router.post('/lotes', verifyHmac, async (req: Request, res: Response) => {
  const { codigo } = req.body ?? {};
  if (typeof codigo !== 'string' || !codigo.trim() || codigo.length > 50) {
    return res.status(400).json({ ok: false, error: 'codigo_invalido' });
  }
  const codigoNorm = codigo.trim().toUpperCase();
  try {
    const { rows: [producto] } = await pool.query<{
      id: string; codigo: string; nombre: string; unidad_medida: string;
      compartido_alilo: boolean;
    }>(
      `SELECT id, codigo, nombre, unidad_medida, compartido_alilo
       FROM productos
       WHERE (codigo_alilo = $1 OR codigo = $1) AND activo = TRUE
       ORDER BY (codigo_alilo = $1) DESC
       LIMIT 1`,
      [codigoNorm]
    );
    if (!producto) return res.status(404).json({ ok: false, error: 'producto_no_encontrado' });
    if (!producto.compartido_alilo) return res.status(403).json({ ok: false, error: 'producto_no_compartido' });

    const { rows: lotes } = await pool.query(
      `SELECT id, lote_interno, lote_proveedor,
              cantidad_inicial, cantidad_actual,
              precio_compra, COALESCE(porte, 0) AS porte,
              precio_unitario_total, unidad_precio,
              fecha_fabricacion, fecha_caducidad, fecha_entrada,
              estado, ubicacion, observaciones,
              ph, solidos, viscosidad
       FROM lotes
       WHERE producto_id = $1
         AND estado = 'aprobado'
         AND cantidad_actual > 0
       ORDER BY fecha_caducidad ASC NULLS LAST, fecha_entrada ASC`,
      [producto.id]
    );
    return res.json({
      ok: true,
      codigo: producto.codigo,
      nombre: producto.nombre,
      unidad: producto.unidad_medida,
      lotes,
    });
  } catch (err) {
    logger.error('[alilo.lotes]', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── GET /api/integracion/alilo/status ──────────────────────────────
// Health check público (no requiere HMAC).
router.get('/status', async (_req, res) => {
  const secret = await getAliloSharedSecret();
  res.json({
    ok: true,
    integracion: 'alilo',
    activo: !!secret,
    timestamp: new Date().toISOString(),
  });
});

export default router;
