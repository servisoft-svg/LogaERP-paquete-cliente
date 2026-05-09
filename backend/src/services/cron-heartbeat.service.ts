/**
 * Heartbeat de crons internos. Cada cron registra su última ejecución
 * exitosa en la tabla cron_heartbeat. El endpoint /api/health/cron lee
 * la tabla y calcula si alguno lleva caído más de su umbral.
 *
 * Uso:
 *   await cronHeartbeat.tick('sweep_pedidos');           // tras éxito
 *   await cronHeartbeat.tick('sweep_pedidos', 'error', e); // tras fallo
 *   const estado = await cronHeartbeat.getEstado();      // para /api/health/cron
 */

import { pool } from '../db/pool';

export interface HeartbeatRow {
  nombre: string;
  ultimo_run: Date;
  ultimo_status: 'ok' | 'error';
  ultimo_error: string | null;
  intervalo_ms: number;
  umbral_ms: number;
  edad_ms: number;
  caido: boolean;
}

class CronHeartbeatService {
  /**
   * Registra una ejecución del cron. Llamar AL FINAL del callback,
   * idealmente con status 'ok' tras éxito o 'error' con detalle si fallo.
   * Fail-soft: si la BD no responde, NO lanza para no romper el cron.
   */
  async tick(nombre: string, status: 'ok' | 'error' = 'ok', error?: unknown): Promise<void> {
    try {
      const errMsg = error instanceof Error ? error.message : (error ? String(error) : null);
      await pool.query(
        `UPDATE cron_heartbeat
         SET ultimo_run = NOW(),
             ultimo_status = $2,
             ultimo_error = $3
         WHERE nombre = $1`,
        [nombre, status, errMsg]
      );
    } catch (e) {
      // No relanzar — el cron debe seguir aunque BD esté indisponible.
      console.error('[cronHeartbeat.tick]', nombre, e);
    }
  }

  /**
   * Estado actual de todos los crons. Calcula edad y flag 'caido'
   * server-side (NOW() - ultimo_run > umbral_ms).
   */
  async getEstado(): Promise<HeartbeatRow[]> {
    const { rows } = await pool.query<{
      nombre: string;
      ultimo_run: Date;
      ultimo_status: 'ok' | 'error';
      ultimo_error: string | null;
      intervalo_ms: number;
      umbral_ms: number;
      edad_ms: string;
    }>(
      `SELECT nombre, ultimo_run, ultimo_status, ultimo_error,
              intervalo_ms, umbral_ms,
              EXTRACT(EPOCH FROM (NOW() - ultimo_run)) * 1000 AS edad_ms
       FROM cron_heartbeat
       ORDER BY nombre ASC`
    );
    return rows.map(r => ({
      ...r,
      edad_ms: Number(r.edad_ms),
      caido: Number(r.edad_ms) > r.umbral_ms || r.ultimo_status === 'error',
    }));
  }
}

export const cronHeartbeat = new CronHeartbeatService();
