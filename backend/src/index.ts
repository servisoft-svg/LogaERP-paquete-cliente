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
import { authMiddleware, adminOnly } from './middleware/auth';
import { traceIdMiddleware } from './middleware/traceId';
import { auditoriaMiddleware } from './middleware/auditoria';
import { pool }          from './db/pool';
import { queuesHealthy } from './queues/index';
import { logger }        from './lib/logger';

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
// Uploads protected: require auth token in query or header
app.use('/uploads', (req, res, next) => {
  const token = req.query.token as string || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Token invalido' }); }
}, express.static(path.join(process.cwd(), 'uploads')));

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

// Public webhook (before auth middleware) — with dedicated rate limit
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many webhook requests' } });
app.post('/api/pedidos/webhook', webhookLimiter, webhookHandler);

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
