/**
 * Migration runner con tracking + auto-baseline.
 *
 * Filosofía: NUNCA toca datos del cliente. Aplica solo migraciones nuevas.
 *
 * - Tabla `schema_migrations` registra archivos aplicados (filename PK).
 * - Al arrancar el backend, comprueba archivos en `database/migrations/*.sql`,
 *   aplica los pendientes en transacción + INSERT en schema_migrations.
 *
 * AUTO-BASELINE (crítico para clientes existentes):
 *   Si schema_migrations está vacía PERO la BD tiene datos (ej: cliente que
 *   se actualiza por primera vez con este sistema), marca TODAS las migraciones
 *   como ya aplicadas SIN ejecutarlas. Esto previene que migraciones antiguas
 *   con INSERT/UPDATE/DELETE corrompan datos existentes.
 *
 *   Después de baseline, solo migraciones NUEVAS (035+) se aplicarán.
 *
 * Fail-fast: si una migración falla → rollback de esa migración + throw.
 * Migraciones posteriores NO se aplican (evita dejar BD en estado mixto).
 */

import fs from 'fs';
import path from 'path';
import { pool } from './pool';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = path.join(process.cwd(), 'database', 'migrations');

const RX_MIGRATION = /^\d+_.*\.sql$/;

export async function runMigrations(): Promise<void> {
  // 1. Crear tabla de tracking (idempotente)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('[migrations] directorio no existe — skip');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => RX_MIGRATION.test(f))
    .sort();

  if (files.length === 0) {
    logger.info('[migrations] no hay archivos de migración');
    return;
  }

  // 2. AUTO-BASELINE: si tracking vacío + BD con datos → marcar todas aplicadas
  //    sin ejecutar. Protege a clientes existentes que actualizan por 1ª vez.
  const { rows: [{ count: trackingCount }] } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM schema_migrations`
  );

  if (trackingCount === 0) {
    // ¿Hay tabla `usuarios` con datos? Si sí, BD pre-existente (002_seed.sql
    // inserta admin+operario tras install.ps1, así que esto cubre instalación
    // fresh CON seed aplicado, además del caso de cliente actualizando).
    const { rows: [{ exists: hasTable }] } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'usuarios'
      ) AS exists
    `);

    let hasData = false;
    if (hasTable) {
      const { rows: [{ n }] } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM usuarios`
      );
      hasData = n > 0;
    }

    if (hasData) {
      // BD existente — baseline silencioso de TODAS las migraciones presentes.
      // Solo migraciones NUEVAS (añadidas después) se aplicarán.
      const values = files.map((_, i) => `($${i + 1})`).join(',');
      await pool.query(
        `INSERT INTO schema_migrations (filename) VALUES ${values} ON CONFLICT DO NOTHING`,
        files
      );
      logger.info(`[migrations] auto-baseline: ${files.length} migraciones marcadas como aplicadas (BD pre-existente con datos detectada). Datos del cliente intactos.`);
      return;
    }
    // BD vacía: continuar al flujo normal (aplicará todas como primera instalación).
  }

  // 3. Aplicar pendientes
  const { rows: appliedRows } = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`
  );
  const applied = new Set(appliedRows.map(r => r.filename));
  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    logger.info(`[migrations] al día (${files.length} aplicadas, 0 pendientes)`);
    return;
  }

  logger.info(`[migrations] aplicando ${pending.length} pendientes: ${pending.join(', ')}`);

  for (const filename of pending) {
    const sqlPath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [filename]
      );
      await client.query('COMMIT');
      logger.info(`[migrations] ✓ ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* ignore */ });
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[migrations] ✗ ${filename} — ${msg}`);
      throw new Error(
        `Migración "${filename}" falló: ${msg}. ROLLBACK aplicado. ` +
        `Las migraciones posteriores NO se aplican. Backend NO arrancará hasta resolver. ` +
        `Datos del cliente intactos.`
      );
    } finally {
      client.release();
    }
  }

  logger.info(`[migrations] OK — ${pending.length} migraciones aplicadas`);
}
