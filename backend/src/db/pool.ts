import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/loga_erp',
  max: 80,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Use console.error here since logger may not be initialized yet at module load time
  console.error('[DB] Unexpected pool error:', err.message);
});

/** Ejecuta fn dentro de una transacción SERIALIZABLE. Hace ROLLBACK si lanza. */
export async function withSerializableTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lock cooperativo a nivel transacción por id de producto.
 * Serializa cualquier mutación de stock (consumir pedidos, producción, ajustes,
 * automatizaciones) sobre los mismos productos sin bloquear lecturas.
 * Se libera automáticamente al COMMIT/ROLLBACK.
 *
 * Por qué: SERIALIZABLE + FOR UPDATE protegen entre filas concurrentes pero
 * dependen del orden exacto de los SELECT. Este advisory lock añade una
 * barrera determinista por producto que evita serialization_failure (40001)
 * en escenarios de alta concurrencia entre rutas distintas.
 */
export async function acquireProductLocks(client: PoolClient, productoIds: string[]): Promise<void> {
  if (productoIds.length === 0) return;
  // Ordenar para evitar deadlocks por orden inverso entre transacciones.
  const sorted = [...new Set(productoIds)].sort();
  for (const id of sorted) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`producto_stock:${id}`]);
  }
}

/**
 * Wrapper que reintenta una transacción SERIALIZABLE ante serialization_failure (40001)
 * o deadlock_detected (40P01). Hasta `maxRetries` con backoff exponencial.
 */
export async function withSerializableRetry<T>(
  fn: (client: PoolClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withSerializableTransaction(fn);
    } catch (err: any) {
      lastErr = err;
      const code = err?.code;
      if (code !== '40001' && code !== '40P01') throw err;
      if (attempt === maxRetries) break;
      await new Promise(r => setTimeout(r, 25 * Math.pow(2, attempt) + Math.random() * 25));
    }
  }
  throw lastErr;
}
