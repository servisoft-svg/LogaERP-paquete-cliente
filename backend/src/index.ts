import express, { Request } from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import compression from 'compression';
import dotenv  from 'dotenv';
import path    from 'path';
import fs      from 'fs';
import http    from 'http';

import produccionRoutes      from './routes/produccion.routes';
import stockRoutes            from './routes/stock.routes';
import lotesRoutes            from './routes/lotes.routes';
import productosRoutes        from './routes/productos.routes';
import recetasRoutes          from './routes/recetas.routes';
import recetasEnvasadoRoutes  from './routes/recetasEnvasado.routes';
import proveedoresRoutes      from './routes/proveedores.routes';
import clientesRoutes         from './routes/clientes.routes';
import pedidosRoutes, { webhookHandler } from './routes/pedidos.routes';
import configuracionRoutes    from './routes/configuracion.routes';
import controlesCalidadRoutes from './routes/controles-calidad.routes';
import specsRoutes             from './routes/specs.routes';
import recordatoriosRoutes     from './routes/recordatorios.routes';
import pedidosProgramadosRoutes from './routes/pedidos-programados.routes';
import cambioRoutes              from './routes/cambio.routes';
import facturasRoutes            from './routes/facturas.routes';
import { emailService } from './services/email.service';
import finanzasRoutes         from './routes/finanzas.routes';
import authRoutes             from './routes/auth.routes';
import { authMiddleware, adminOnly, verifyToken } from './middleware/auth';
import { traceIdMiddleware } from './middleware/traceId';
import { auditoriaMiddleware } from './middleware/auditoria';
import { pool }          from './db/pool';
import { queuesHealthy } from './queues/index';
import { logger }        from './lib/logger';
import { automatizacionesService } from './services/automatizaciones.service';
import { cronHeartbeat } from './services/cron-heartbeat.service';
import automatizacionesRoutes from './routes/automatizaciones.routes';
import integracionAliloRoutes from './routes/integracionAlilo.routes';
import { bootstrapDatabase, inspectAllSequences } from './db/bootstrap';
import { runMigrations } from './db/migrations';
import { errorHandler, notFoundApi } from './middleware/errorHandler';

dotenv.config();

// ── Validate required env vars ──────────────────────────────
const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'] as const;
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const app  = express();
const PORT = process.env.PORT ?? 3001;

app.use(helmet({
  // CSP desactivado: la app corre en LAN local (sin internet expuesto), donde la
  // protección contra XSS via CSP aporta poco y rompe Google Fonts + el inline
  // bootstrap de Vite. Si algún día se expone público con HTTPS, reactivar.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // HSTS solo cuando hay HTTPS real. En HTTP fuerza upgrade que rompe el cliente.
  hsts: process.env.HSTS === 'true' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(compression());

// ── Servir frontend compilado ANTES de cualquier middleware que pueda fallar
// (auditoría, rate limiter, traceId, etc). Los assets son archivos puros, no
// necesitan auditarse ni autenticarse. Esto evita 500 espurios cuando
// middlewares posteriores tienen errores.
const FRONTEND_DIST_EARLY = path.resolve(process.cwd(), '..', 'frontend', 'dist');
if (fs.existsSync(path.join(FRONTEND_DIST_EARLY, 'index.html'))) {
  app.use(express.static(FRONTEND_DIST_EARLY, { maxAge: '1h', index: false }));
}

// Trace ID: UUID por request → propagado a logs, headers, SQL
app.use(traceIdMiddleware);

// Global rate limit: 200 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  message: { error: 'Demasiadas peticiones. Espere un momento.' },
});
app.use('/api/', globalLimiter);

// Request logging con trace ID
// Log todos los métodos excepto OPTIONS (CORS preflight, ruidoso).
app.use((req, _res, next) => {
  if (req.method !== 'OPTIONS') {
    logger.info(`${req.method} ${req.path}`, { traceId: req.traceId, user: (req as any).user?.id ?? 'anon' });
  }
  next();
});
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
  console.error('CORS_ORIGIN must be set in production');
  process.exit(1);
}
// Validar formato URL de CORS_ORIGIN si está definido (anti typo
// silencioso). Acepta listado separado por comas para múltiples orígenes.
if (corsOrigin) {
  const origins = corsOrigin.split(',').map(s => s.trim()).filter(Boolean);
  for (const o of origins) {
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/.test(o)) {
      console.error(`CORS_ORIGIN inválido: "${o}" — debe ser una URL http(s)://`);
      process.exit(1);
    }
  }
}
// CORS — acepta lista del env + patrones ngrok/dominios túnel automáticamente
const allowList = corsOrigin
  ? corsOrigin.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:4173'];
const tunnelPatterns = [/\.ngrok-free\.app$/i, /\.ngrok\.io$/i, /\.ngrok\.app$/i, /\.loca\.lt$/i, /\.trycloudflare\.com$/i];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // herramientas/curl
    if (allowList.includes(origin)) return cb(null, true);
    try {
      const u = new URL(origin);
      // Cualquier localhost / 127.0.0.1 / 192.168.x / 10.x / 172.x (LAN) y túneles → permitir.
      // En producción el ERP corre tras el mismo origen así que esto cubre todos los casos.
      if (
        u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1' ||
        /^192\.168\./.test(u.hostname) || /^10\./.test(u.hostname) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(u.hostname) ||
        tunnelPatterns.some(p => p.test(u.hostname))
      ) return cb(null, true);
    } catch { /* ignore */ }
    return cb(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({
  limit: '1mb',
  // Captura el body crudo para que la verificación HMAC use el JSON bit-exacto
  // que envió el cliente (sin re-serializar) — requisito para Integración Alilo.
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
  },
}));
app.use(auditoriaMiddleware);
// Uploads protegidos por token (JWT con algoritmo pinneado vía verifyToken).
// La validación de ownership real se hace en uploadsAuthMiddleware (Fix #6).
import { uploadsAuthMiddleware } from './middleware/uploadsAuth';
app.use('/uploads', uploadsAuthMiddleware, express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Health check de la BD: verifica triggers críticos + invariantes.
// [H4.2 audit v3] Detecta drift silencioso tras restore mal aplicado, migración
// fallida o trigger desactivado manualmente. Devuelve 503 si algo no cuadra.
app.get('/api/health/db', authMiddleware, adminOnly, async (_req, res) => {
  try {
    // 1. Verifica que los triggers críticos están activos.
    // NOTA: trg_alerta_stock fue sustituido por alertaService.checkStockMinimo()
    // en código (sistema más fiable, no depende de NOTIFY+LISTEN). Lo retiramos
    // de la lista de "críticos". Si necesitas restaurarlo, ver schema.sql.
    const TRIGGERS_CRITICOS = [
      'trg_lotes_stock_actual',  // 025 — sincroniza productos.stock_actual
      'trg_lotes_cmp',            // 024 — sincroniza productos.coste_medio_actual
      'trg_numero_orden',         // schema — correlativo OP
      'trg_numero_pedido',        // schema — correlativo PED
      'trg_stock_moves_immutable', // 015 — bloquea UPDATE/DELETE en stock_moves (legal trazabilidad)
    ];
    const { rows: triggers } = await pool.query<{ trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE trigger_schema = 'public' AND trigger_name = ANY($1::text[])`,
      [TRIGGERS_CRITICOS]
    );
    const triggersActivos = new Set(triggers.map(t => t.trigger_name));
    const triggersFaltantes = TRIGGERS_CRITICOS.filter(t => !triggersActivos.has(t));

    // 2. Invariante: productos.stock_actual == SUM(lotes aprobados con stock>0)
    // Comprobado sobre TODOS los productos activos (rápido, índice por producto_id)
    const { rows: drift } = await pool.query<{ id: string; codigo: string; nombre: string; stock_actual: string; suma_lotes: string }>(
      `SELECT p.id, p.codigo, p.nombre, p.stock_actual,
              COALESCE((SELECT SUM(cantidad_actual) FROM lotes
                        WHERE producto_id = p.id AND estado = 'aprobado' AND cantidad_actual > 0), 0) AS suma_lotes
       FROM productos p
       WHERE p.activo = TRUE
         AND ABS(p.stock_actual - COALESCE((SELECT SUM(cantidad_actual) FROM lotes
                                            WHERE producto_id = p.id AND estado = 'aprobado' AND cantidad_actual > 0), 0)) > 0.001`
    );

    // 3. Verifica tablas críticas existen
    const TABLAS_CRITICAS = [
      'productos', 'lotes', 'stock_moves', 'pedidos', 'ordenes_produccion',
      'sesiones_revocadas', 'cron_heartbeat', 'auditoria',
    ];
    // Acepta r (regular table) y p (partitioned table). stock_moves es 'p'
    // por la migración 004 (particiones por año).
    const { rows: tablas } = await pool.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relkind IN ('r','p') AND relname = ANY($1::text[])`,
      [TABLAS_CRITICAS]
    );
    const tablasFaltantes = TABLAS_CRITICAS.filter(t => !tablas.find(r => r.relname === t));

    const ok = triggersFaltantes.length === 0 && drift.length === 0 && tablasFaltantes.length === 0;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      triggers: {
        esperados: TRIGGERS_CRITICOS,
        activos: Array.from(triggersActivos),
        faltantes: triggersFaltantes,
      },
      tablas: {
        esperadas: TABLAS_CRITICAS,
        faltantes: tablasFaltantes,
      },
      stock_drift: {
        productos_descuadrados: drift.length,
        muestra: drift.slice(0, 10).map(d => ({
          codigo: d.codigo,
          nombre: d.nombre,
          stock_actual: parseFloat(d.stock_actual),
          suma_lotes: parseFloat(d.suma_lotes),
          delta: parseFloat(d.stock_actual) - parseFloat(d.suma_lotes),
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Error consultando salud BD',
    });
  }
});

// Health check de los crons internos. Frontend pollea para detectar
// si algún cron lleva más tiempo que su umbral sin ejecutar (caído).
app.get('/api/health/cron', authMiddleware, async (_req, res) => {
  try {
    const estado = await cronHeartbeat.getEstado();
    const algunCaido = estado.some(c => c.caido);
    res.status(algunCaido ? 503 : 200).json({
      status: algunCaido ? 'degraded' : 'ok',
      crons: estado,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err instanceof Error ? err.message : 'Error' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redis = await queuesHealthy().catch(() => false);
    // Estado secuencias gestionadas (read-only). Si alguna unhealthy,
    // el INSERT seguirá funcionando vía trigger defensivo runtime,
    // pero esto sirve a monitoring para alertar.
    const sequences = await inspectAllSequences().catch(() => []);
    const sequencesHealthy = sequences.length > 0 && sequences.every(s => s.healthy);
    res.json({
      status: sequencesHealthy ? 'ok' : 'degraded',
      db: 'connected',
      redis: redis ? 'connected' : 'unavailable',
      sequences: sequences.map(s => ({
        name: s.name,
        seqValue: s.seqValue,
        maxReal: s.maxReal,
        healthy: s.healthy,
        ...(s.error ? { error: s.error } : {}),
      })),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

// Public routes (no auth)
app.use('/api/auth', authRoutes);

// Public webhook (before auth middleware) — rate limit por cliente_email,
// con fallback a IP. Antes el límite era 30/min por IP (43k pedidos/día con
// un único token comprometido). Ahora 5/min por email + 60/min global por IP.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Demasiadas peticiones webhook para este email. Espera 1 min.' },
  keyGenerator: (req) => {
    // Preferir cliente_email del body. Fallback a IP NORMALIZADA con
    // ipKeyGenerator (express-rate-limit v8 lo exige para evitar bypass
    // por usuarios IPv6 distintos del mismo /64 — el helper agrupa /64).
    const email = (req.body?.cliente_email || req.body?.email || '').toString().toLowerCase().trim();
    return email || ipKeyGenerator(req.ip ?? '');
  },
  standardHeaders: true,
  legacyHeaders: false,
});
const webhookGlobalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Webhook saturado. Reintenta en 1 min.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/pedidos/webhook', webhookGlobalLimiter, webhookLimiter, webhookHandler);

// Protected routes (need token)
app.use('/api/productos',     authMiddleware, productosRoutes);
app.use('/api/recetas',       authMiddleware, recetasRoutes);
app.use('/api/recetas-envasado', authMiddleware, recetasEnvasadoRoutes);
app.use('/api/produccion',    authMiddleware, produccionRoutes);
app.use('/api/lotes',         authMiddleware, lotesRoutes);
app.use('/api/stock',         authMiddleware, stockRoutes);
app.use('/api/proveedores',   authMiddleware, proveedoresRoutes);
app.use('/api/clientes',      authMiddleware, clientesRoutes);
app.use('/api/pedidos',       authMiddleware, pedidosRoutes);
app.use('/api/finanzas',      authMiddleware, adminOnly, finanzasRoutes);
app.use('/api/configuracion', authMiddleware, adminOnly, configuracionRoutes);
app.use('/api/automatizaciones', authMiddleware, adminOnly, automatizacionesRoutes);
// Integración externa Alilo — autenticada por HMAC (no JWT). Llamada desde otro PC en la LAN.
app.use('/api/integracion/alilo', integracionAliloRoutes);
app.use('/api/controles-calidad', authMiddleware, controlesCalidadRoutes);
app.use('/api/specs',         authMiddleware, specsRoutes);
app.use('/api/recordatorios', authMiddleware, recordatoriosRoutes);
app.use('/api/pedidos-programados', authMiddleware, pedidosProgramadosRoutes);
app.use('/api/cambio',        authMiddleware, cambioRoutes);
// /api/facturas — auth per-handler: /parse usa Bearer normal,
// /file usa token via query param (iframe no envía Authorization).
app.use('/api/facturas',      facturasRoutes);

// ── PRODUCCIÓN: servir frontend compilado desde el mismo backend ───────────
// Si existe ../frontend/dist (build) sirvemos esos archivos. SPA fallback con
// index.html para que el router de React maneje cualquier ruta no-/api.
const FRONTEND_DIST = path.resolve(process.cwd(), '..', 'frontend', 'dist');
if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  logger.info(`[startup] Sirviendo frontend desde ${FRONTEND_DIST}`);
  app.use(express.static(FRONTEND_DIST, { maxAge: '1h' }));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.use(notFoundApi);
app.use(errorHandler);

// Iniciar workers BullMQ si Redis está disponible
queuesHealthy().then((ok) => {
  if (ok) {
    import('./queues/workers').then(w => w.startWorkers());
  } else {
    logger.warn('Redis no disponible — colas desactivadas (PDFs/emails inline)');
  }
}).catch(() => {});

const server = http.createServer(app);

// Bootstrap DB SIEMPRE en cada arranque: garantiza que secuencias y
// funciones trigger defensivas están en estado correcto, sin depender
// de que un operario haya aplicado las migraciones manualmente.
// Idempotente, fail-soft (logea pero no impide arrancar — el trigger
// defensivo runtime sigue siendo red de seguridad si esto falla).
// Override: BOOTSTRAP_DB=false para saltarlo (útil en debugging).
async function startup() {
  // 1. Aplicar migraciones pendientes ANTES de bootstrap (puede crear tablas
  //    que el bootstrap necesita verificar). Auto-baseline si BD pre-existente.
  //    Fail-fast: si una migración falla, NO arranca — datos intactos.
  if (process.env.SKIP_MIGRATIONS !== 'true') {
    try {
      await runMigrations();
    } catch (err) {
      // Log detallado (stack + objeto completo) para no quedarnos sin diagnostico.
      const msg = err instanceof Error ? (err.message || err.stack || 'sin mensaje') : String(err);
      logger.error('[startup] FALLO APLICANDO MIGRACIONES', {
        msg,
        stack: err instanceof Error ? err.stack : undefined,
        raw: err,
      });
      // Si MIGRATIONS_FAIL_SOFT=true, arranca igualmente (modo recovery). Default: muere.
      if (process.env.MIGRATIONS_FAIL_SOFT === 'true') {
        logger.warn('[startup] continuando pese al fallo (MIGRATIONS_FAIL_SOFT=true)');
      } else {
        process.exit(1);
      }
    }
  } else {
    logger.warn('[startup] migraciones SALTADAS por SKIP_MIGRATIONS=true');
  }

  if (process.env.BOOTSTRAP_DB !== 'false') {
    try {
      const result = await bootstrapDatabase();
      if (!result.ok) {
        logger.warn(`[startup] bootstrap completó con avisos (${result.errors.length} errores). Backend arranca igualmente — trigger defensivo runtime activo.`);
      }
    } catch (err) {
      logger.error('[startup] bootstrap fallo total — backend arranca igualmente', { err });
    }
  } else {
    logger.info('[startup] bootstrap DESACTIVADO por BOOTSTRAP_DB=false');
  }

  // Escucha explícita en 0.0.0.0 (todas las IPv4). Evita problemas en macOS
  // donde el default IPv6 (::) provoca ECONNREFUSED desde clients IPv4 (vite proxy).
  server.listen(Number(PORT), '0.0.0.0', () => {
    logger.info(`Loga ERP Backend corriendo en puerto ${PORT}`);
  });

  // Listener de cambios de stock para webhook Alilo (LISTEN/NOTIFY)
  const { startAliloStockListener } = await import('./services/aliloStockListener.service');
  startAliloStockListener().catch(err =>
    logger.error('[startup] alilo stock listener', { err: err?.message ?? err }));
}
startup();

// Cron interno: reintentar emails de automatización cada 5 min
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const retryTimer = setInterval(() => {
  automatizacionesService.procesarReintentosEmail()
    .then(n => {
      if (n > 0) logger.info(`[auto.retry] ${n} reintentos procesados`);
      return cronHeartbeat.tick('retry_email_proveedor', 'ok');
    })
    .catch(err => {
      logger.error('[auto.retry] error', { err });
      return cronHeartbeat.tick('retry_email_proveedor', 'error', err);
    });
}, RETRY_INTERVAL_MS);
retryTimer.unref();

// Cron interno: backup nocturno (chequea cada minuto, idempotente)
const BACKUP_INTERVAL_MS = 60 * 1000;
const backupTimer = setInterval(() => {
  automatizacionesService.tickBackupNocturno()
    .then(() => cronHeartbeat.tick('backup_nocturno_tick', 'ok'))
    .catch(err => {
      logger.error('[auto.backup] error', { err });
      return cronHeartbeat.tick('backup_nocturno_tick', 'error', err);
    });
}, BACKUP_INTERVAL_MS);
backupTimer.unref();

// Cron interno: barrer pedidos pendientes de auto-completar y albarán cada 90s.
// Idempotente: cada acción tiene anti-dupe (albaran_enviado=true / estado completado).
const SWEEP_INTERVAL_MS = 90 * 1000;
const sweepTimer = setInterval(() => {
  automatizacionesService.sweepPedidos()
    .then(() => cronHeartbeat.tick('sweep_pedidos', 'ok'))
    .catch(err => {
      logger.error('[auto.sweep] error', { err });
      return cronHeartbeat.tick('sweep_pedidos', 'error', err);
    });
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

// Cron stock: cada 5 min comprueba productos bajo mínimo cubiertos por reglas
// activas y dispara las acciones (creación orden, email, etc.). Anti-dupe interno.
const STOCK_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const stockSweepTimer = setInterval(() => {
  automatizacionesService.sweepStockReglas()
    .then(() => cronHeartbeat.tick('sweep_stock_reglas', 'ok'))
    .catch(err => {
      logger.error('[auto.stock-sweep] error', { err });
      return cronHeartbeat.tick('sweep_stock_reglas', 'error', err);
    });
}, STOCK_SWEEP_INTERVAL_MS);
stockSweepTimer.unref();

// Cron emails programados: cada 60s envía los pedidos_programados vencidos.
const PEDIDOS_PROG_INTERVAL_MS = 60 * 1000;
const pedidosProgTimer = setInterval(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.id, pp.producto_id, pp.destinatarios, pp.cantidad, pp.notas, pp.cuerpo_personalizado
       FROM pedidos_programados pp
       WHERE pp.enviado = FALSE AND pp.programado_para <= NOW()
       LIMIT 10`
    );
    for (const pp of rows) {
      try {
        await emailService.enviarPedidoStock({
          producto_id: pp.producto_id,
          destinatario: (pp.destinatarios as string[]).join(', '),
          cantidad_sugerida: Number(pp.cantidad),
          notas_adicionales: pp.notas ?? undefined,
          cuerpo_personalizado: pp.cuerpo_personalizado ?? undefined,
        });
        await pool.query(
          `UPDATE pedidos_programados SET enviado = TRUE, enviado_at = NOW(), intento_at = NOW() WHERE id = $1`,
          [pp.id]
        );
      } catch (e) {
        await pool.query(
          `UPDATE pedidos_programados SET intento_at = NOW(), error_msg = $1 WHERE id = $2`,
          [(e as Error).message, pp.id]
        );
      }
    }
    await cronHeartbeat.tick('pedidos_programados', 'ok');
  } catch (err) {
    logger.error('[pedidos-programados] error', { err });
    await cronHeartbeat.tick('pedidos_programados', 'error', err as Error);
  }
}, PEDIDOS_PROG_INTERVAL_MS);
pedidosProgTimer.unref();

// Disparar una primera vez al arrancar (10s después para que la app esté lista)
setTimeout(() => {
  automatizacionesService.sweepStockReglas()
    .then(() => cronHeartbeat.tick('sweep_stock_reglas', 'ok'))
    .catch(err => logger.error('[auto.stock-sweep:initial] error', { err }));
}, 10_000);

// Auto-archivado de clientes inactivos (≥2 años sin pedido). Corre 1 vez al
// día. Idempotente: solo afecta a clientes que aún no estén archivados.
const CLIENTES_ARCHIVO_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const archivarClientesInactivos = async () => {
  try {
    const { rows } = await pool.query<{ id: string; nombre: string }>(
      `UPDATE clientes c
         SET archivado_at = NOW(),
             archivado_motivo = 'Auto-archivado por inactividad ≥24 meses'
       WHERE c.archivado_at IS NULL
         AND c.activo = TRUE
         AND EXISTS (
           SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM pedidos p
           WHERE p.cliente_id = c.id
             AND p.created_at > NOW() - INTERVAL '24 months'
         )
       RETURNING c.id, c.nombre`
    );
    if (rows.length > 0) {
      logger.info(`[clientes.auto-archivado] ${rows.length} clientes archivados por inactividad ≥24 meses`);
    }
    await cronHeartbeat.tick('archivado_clientes', 'ok');
  } catch (err) {
    logger.error('[clientes.auto-archivado] error', { err });
    await cronHeartbeat.tick('archivado_clientes', 'error').catch(() => undefined);
  }
};
const archivoClientesTimer = setInterval(archivarClientesInactivos, CLIENTES_ARCHIVO_INTERVAL_MS);
archivoClientesTimer.unref();
// Primera pasada 30s después de arrancar (no en el path crítico)
setTimeout(archivarClientesInactivos, 30_000);

// ── Graceful shutdown ───────────────────────────────────────
function shutdown(signal: string) {
  logger.info(`${signal} recibido — cerrando servidor...`);
  server.close(async () => {
    logger.info('HTTP server cerrado');
    try { await pool.end(); } catch { /* already closed */ }
    logger.info('Pool DB cerrado');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => { logger.error('Shutdown timeout — forzando salida'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
