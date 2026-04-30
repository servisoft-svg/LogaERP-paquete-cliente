import express from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import dotenv  from 'dotenv';
import path    from 'path';
import http    from 'http';

import produccionRoutes      from './routes/produccion.routes';
import stockRoutes            from './routes/stock.routes';
import lotesRoutes            from './routes/lotes.routes';
import productosRoutes        from './routes/productos.routes';
import recetasRoutes          from './routes/recetas.routes';
import proveedoresRoutes      from './routes/proveedores.routes';
import clientesRoutes         from './routes/clientes.routes';
import pedidosRoutes, { webhookHandler } from './routes/pedidos.routes';
import configuracionRoutes    from './routes/configuracion.routes';
import finanzasRoutes         from './routes/finanzas.routes';
import authRoutes             from './routes/auth.routes';
import { authMiddleware, adminOnly, verifyToken } from './middleware/auth';
import { traceIdMiddleware } from './middleware/traceId';
import { auditoriaMiddleware } from './middleware/auditoria';
import { pool }          from './db/pool';
import { queuesHealthy } from './queues/index';
import { logger }        from './lib/logger';
import { automatizacionesService } from './services/automatizaciones.service';
import automatizacionesRoutes from './routes/automatizaciones.routes';

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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
app.use(compression());

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
app.use((req, _res, next) => {
  if (req.method !== 'GET') {
    logger.info(`${req.method} ${req.path}`, { traceId: req.traceId, user: (req as any).user?.id ?? 'anon' });
  }
  next();
});
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
  console.error('CORS_ORIGIN must be set in production');
  process.exit(1);
}
app.use(cors({
  origin: corsOrigin || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
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

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redis = await queuesHealthy().catch(() => false);
    res.json({ status: 'ok', db: 'connected', redis: redis ? 'connected' : 'unavailable', uptime: process.uptime(), timestamp: new Date().toISOString() });
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
    const email = (req.body?.cliente_email || req.body?.email || '').toString().toLowerCase().trim();
    return email || req.ip || 'unknown';
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
app.use('/api/produccion',    authMiddleware, produccionRoutes);
app.use('/api/lotes',         authMiddleware, lotesRoutes);
app.use('/api/stock',         authMiddleware, stockRoutes);
app.use('/api/proveedores',   authMiddleware, proveedoresRoutes);
app.use('/api/clientes',      authMiddleware, clientesRoutes);
app.use('/api/pedidos',       authMiddleware, pedidosRoutes);
app.use('/api/finanzas',      authMiddleware, adminOnly, finanzasRoutes);
app.use('/api/configuracion', authMiddleware, adminOnly, configuracionRoutes);
app.use('/api/automatizaciones', authMiddleware, automatizacionesRoutes);

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`[Global Error] ${err.message}`, { traceId: req.traceId, stack: err.stack });
  res.status(500).json({ error: 'Error interno del servidor', traceId: req.traceId });
});

// Iniciar workers BullMQ si Redis está disponible
queuesHealthy().then((ok) => {
  if (ok) {
    import('./queues/workers').then(w => w.startWorkers());
  } else {
    logger.warn('Redis no disponible — colas desactivadas (PDFs/emails inline)');
  }
}).catch(() => {});

const server = http.createServer(app);

server.listen(PORT, () => {
  logger.info(`Loga ERP Backend corriendo en puerto ${PORT}`);
});

// Cron interno: reintentar emails de automatización cada 5 min
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const retryTimer = setInterval(() => {
  automatizacionesService.procesarReintentosEmail()
    .then(n => { if (n > 0) logger.info(`[auto.retry] ${n} reintentos procesados`); })
    .catch(err => logger.error('[auto.retry] error', { err }));
}, RETRY_INTERVAL_MS);
retryTimer.unref();

// Cron interno: backup nocturno (chequea cada minuto, idempotente)
const BACKUP_INTERVAL_MS = 60 * 1000;
const backupTimer = setInterval(() => {
  automatizacionesService.tickBackupNocturno()
    .catch(err => logger.error('[auto.backup] error', { err }));
}, BACKUP_INTERVAL_MS);
backupTimer.unref();

// Cron interno: barrer pedidos pendientes de auto-completar y albarán cada 90s.
// Idempotente: cada acción tiene anti-dupe (albaran_enviado=true / estado completado).
const SWEEP_INTERVAL_MS = 90 * 1000;
const sweepTimer = setInterval(() => {
  automatizacionesService.sweepPedidos()
    .catch(err => logger.error('[auto.sweep] error', { err }));
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

// Cron stock: cada 5 min comprueba productos bajo mínimo cubiertos por reglas
// activas y dispara las acciones (creación orden, email, etc.). Anti-dupe interno.
const STOCK_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const stockSweepTimer = setInterval(() => {
  automatizacionesService.sweepStockReglas()
    .catch(err => logger.error('[auto.stock-sweep] error', { err }));
}, STOCK_SWEEP_INTERVAL_MS);
stockSweepTimer.unref();
// Disparar una primera vez al arrancar (10s después para que la app esté lista)
setTimeout(() => {
  automatizacionesService.sweepStockReglas()
    .catch(err => logger.error('[auto.stock-sweep:initial] error', { err }));
}, 10_000);

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
