/**
 * Bootstrap de BD al arrancar el backend.
 * ========================================
 *
 * Garantiza que el estado runtime mínimo es correcto SIN depender de que
 * un operario humano haya ejecutado las migraciones en el orden correcto.
 *
 * Arquitectura de defensa en 3 capas:
 *
 *   1. Migración 022 (una vez, ejecutada por OWNER):
 *      - Funciones fn_numero_pedido / fn_numero_oc con SECURITY DEFINER
 *      - GRANTs a PUBLIC (cualquier rol consumidor puede usarlas)
 *      - Sincronización inicial de secuencias
 *
 *   2. Bootstrap en cada arranque (ESTE módulo, rol app):
 *      - Inspecciona estado actual de secuencias
 *      - Si seqValue < maxReal, intenta setval (puede fallar por
 *        permisos en plataformas restrictivas → log warn y sigue)
 *      - Logea estado claro para ops/debugging
 *
 *   3. Trigger SECURITY DEFINER en cada INSERT (runtime):
 *      - Loop anti-colisión: si nextval choca, re-sync automático
 *      - Hasta 5 reintentos por INSERT
 *      - Garantiza que un INSERT NUNCA falla por desfase de contador
 *
 * Si la capa 2 falla, la capa 3 sigue protegiendo. Si la 3 también falla
 * (porque la 1 nunca se aplicó), el INSERT fallará explícitamente y
 * será visible inmediatamente — no silencioso.
 */

import { pool } from './pool';
import { logger } from '../lib/logger';

export interface SequenceState {
  name: string;
  table: string;
  column: string;
  prefix: string;
  /** last_value de la secuencia (o null si no se pudo leer) */
  seqValue: number | null;
  /** MAX real extraído del sufijo numérico de la columna */
  maxReal: number | null;
  /** TRUE si seqValue >= maxReal (próximo nextval no colisionará) */
  healthy: boolean;
  /** Acción tomada en este bootstrap */
  action?: 'no-op' | 'resynced' | 'inspect-only-no-perms';
  error?: string;
}

export interface BootstrapResult {
  ok: boolean;
  durationMs: number;
  sequences: SequenceState[];
  errors: string[];
}

const SECUENCIAS_GESTIONADAS = [
  { name: 'seq_numero_pedido', table: 'pedidos',        column: 'numero_pedido', prefix: 'PED' },
  { name: 'seq_numero_oc',     table: 'ordenes_compra', column: 'numero_oc',     prefix: 'OC'  },
] as const;

/**
 * Lee el estado actual de una secuencia + MAX real de la tabla.
 * Solo requiere SELECT — funciona con cualquier rol consumidor.
 */
async function inspectSequence(
  seqName: string, table: string, column: string
): Promise<{ seqValue: number | null; maxReal: number | null; error?: string }> {
  try {
    const { rows: [seqRow] } = await pool.query<{ last_value: string }>(
      `SELECT last_value::TEXT FROM public.${seqName}`
    );
    const { rows: [maxRow] } = await pool.query<{ max_real: string }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(${column} FROM '[0-9]+$') AS INT)), 0)::TEXT AS max_real FROM public.${table}`
    );
    return {
      seqValue: Number(seqRow.last_value),
      maxReal: Number(maxRow.max_real),
    };
  } catch (err) {
    return {
      seqValue: null,
      maxReal: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Intenta setval para sincronizar. Requiere UPDATE sobre la secuencia.
 * Si falla por permisos, devuelve false sin lanzar (la capa 3 trigger
 * SECURITY DEFINER hará la sincronización en el siguiente INSERT).
 */
async function trySetval(seqName: string, maxReal: number): Promise<{ done: boolean; error?: string }> {
  try {
    if (maxReal > 0) {
      await pool.query(`SELECT setval('public.${seqName}', $1, TRUE)`, [maxReal]);
    } else {
      await pool.query(`SELECT setval('public.${seqName}', 1, FALSE)`);
    }
    return { done: true };
  } catch (err) {
    return { done: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Punto de entrada — llamar antes de server.listen.
 * Nunca lanza: fail-soft, deja que el caller decida.
 */
export async function bootstrapDatabase(): Promise<BootstrapResult> {
  const start = Date.now();
  const sequences: SequenceState[] = [];
  const errors: string[] = [];

  for (const cfg of SECUENCIAS_GESTIONADAS) {
    const state: SequenceState = {
      name: cfg.name,
      table: cfg.table,
      column: cfg.column,
      prefix: cfg.prefix,
      seqValue: null,
      maxReal: null,
      healthy: false,
    };

    // Paso 1: inspección (solo SELECT — siempre funciona si la
    // secuencia/tabla existen y el rol tiene SELECT).
    const before = await inspectSequence(cfg.name, cfg.table, cfg.column);
    if (before.error) {
      state.error = before.error;
      state.action = 'inspect-only-no-perms';
      errors.push(`${cfg.name}: ${before.error}`);
      logger.warn(
        `[db.bootstrap] ${cfg.name} no inspeccionable: ${before.error}. ` +
        `¿Migración 022 aplicada? El trigger SECURITY DEFINER seguirá funcionando si lo está.`
      );
      sequences.push(state);
      continue;
    }

    state.seqValue = before.seqValue;
    state.maxReal  = before.maxReal;

    const seqVal = before.seqValue ?? 0;
    const maxVal = before.maxReal  ?? 0;

    // Paso 2: si está sincronizada, no hacer nada
    if (seqVal >= maxVal) {
      state.healthy = true;
      state.action = 'no-op';
      logger.info(
        `[db.bootstrap] ${cfg.name} OK: seq=${seqVal}, max=${maxVal}, próximo=${seqVal + 1}`
      );
      sequences.push(state);
      continue;
    }

    // Paso 3: desincronizada — intentar arreglar con setval
    logger.warn(
      `[db.bootstrap] ${cfg.name} DESINCRONIZADA: seq=${seqVal} < max=${maxVal}. Intentando re-sync...`
    );
    const fix = await trySetval(cfg.name, maxVal);
    if (fix.done) {
      const after = await inspectSequence(cfg.name, cfg.table, cfg.column);
      state.seqValue = after.seqValue;
      state.maxReal  = after.maxReal;
      state.healthy  = (after.seqValue ?? 0) >= (after.maxReal ?? 0);
      state.action   = 'resynced';
      logger.info(
        `[db.bootstrap] ${cfg.name} re-sincronizada: seq=${after.seqValue}, próximo=${(after.seqValue ?? 0) + 1}`
      );
    } else {
      state.error = fix.error;
      state.action = 'inspect-only-no-perms';
      errors.push(`${cfg.name}: setval falló — ${fix.error}`);
      // Esto es OK: el trigger SECURITY DEFINER de la migración 022
      // hará el setval automáticamente en el próximo INSERT.
      logger.warn(
        `[db.bootstrap] ${cfg.name} setval sin permisos: ${fix.error}. ` +
        `El trigger SECURITY DEFINER hará re-sync en el próximo INSERT (capa 3).`
      );
    }

    sequences.push(state);
  }

  const durationMs = Date.now() - start;
  const ok = sequences.every(s => s.healthy);

  if (ok) {
    logger.info(
      `[db.bootstrap] OK en ${durationMs}ms — ${sequences.length} secuencias verificadas`
    );
  } else {
    logger.warn(
      `[db.bootstrap] completado con avisos en ${durationMs}ms. ` +
      `Trigger defensivo runtime (migración 022 SECURITY DEFINER) sigue siendo red de seguridad.`
    );
  }

  return { ok, durationMs, sequences, errors };
}

/**
 * Estado actual (read-only) para /api/health. No modifica nada.
 */
export async function inspectAllSequences(): Promise<SequenceState[]> {
  const result: SequenceState[] = [];
  for (const cfg of SECUENCIAS_GESTIONADAS) {
    const inspection = await inspectSequence(cfg.name, cfg.table, cfg.column);
    result.push({
      name: cfg.name,
      table: cfg.table,
      column: cfg.column,
      prefix: cfg.prefix,
      seqValue: inspection.seqValue,
      maxReal: inspection.maxReal,
      healthy: inspection.seqValue !== null && inspection.maxReal !== null
        && inspection.seqValue >= inspection.maxReal,
      error: inspection.error,
    });
  }
  return result;
}
