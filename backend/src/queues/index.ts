/**
 * Cola de tareas BullMQ — Producer/Consumer con reintentos + DLQ
 *
 * GRACEFUL DEGRADATION: Si Redis no está disponible, las colas no se crean
 * y el sistema sigue funcionando en modo inline (sin background jobs).
 * Cuando se instale Redis en el servidor de producción, todo arranca solo.
 */
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let connection: IORedis | null = null;
let redisAvailable = false;

// Opciones de reintento: backoff exponencial (5s → 10s → 20s → 40s → 80s)
const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 500 },
  removeOnFail: false,
};

function getConnection(): IORedis | null {
  if (!redisAvailable) return null;
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: () => null, // no auto-retry
    });
    connection.on('error', () => {}); // silenciar
  }
  return connection;
}

export function createQueue(name: string): Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  return new Queue(name, { connection: conn, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

export function createWorker(
  name: string,
  handler: (job: { id?: string; name: string; data: Record<string, unknown> }) => Promise<void>,
  concurrency = 2,
): Worker | null {
  const conn = getConnection();
  if (!conn) return null;

  const worker = new Worker(name, handler, { connection: conn, concurrency });

  worker.on('completed', (job) => {
    console.log(`[Queue:${name}] Job ${job.id} OK`);
  });

  worker.on('failed', (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 5;
    if (attempts >= maxAttempts) {
      console.error(`[Queue:${name}] Job ${job?.id} DEAD (${attempts} intentos): ${err.message}`);
      // DLQ
      const dlq = createQueue(`${name}:dlq`);
      dlq?.add('dead-letter', {
        originalJob: job?.name, data: job?.data,
        error: err.message, failedAt: new Date().toISOString(), attempts,
      }).catch(() => {});
    }
  });

  return worker;
}

export function createQueueEvents(name: string): QueueEvents | null {
  const conn = getConnection();
  if (!conn) return null;
  return new QueueEvents(name, { connection: conn });
}

// Instancias (null si Redis no disponible)
export let pdfQueue: Queue | null = null;
export let emailQueue: Queue | null = null;
export let heavyQueue: Queue | null = null;

export async function queuesHealthy(): Promise<boolean> {
  try {
    const conn = new IORedis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    conn.on('error', () => {});
    await conn.connect();
    await conn.ping();
    await conn.quit();
    redisAvailable = true;
    // Crear colas ahora que sabemos que Redis funciona
    pdfQueue = createQueue('pdf');
    emailQueue = createQueue('email');
    heavyQueue = createQueue('heavy');
    return true;
  } catch {
    redisAvailable = false;
    return false;
  }
}
