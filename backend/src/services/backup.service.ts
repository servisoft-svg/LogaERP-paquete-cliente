/**
 * Backup Service — AES-256-GCM + Argon2id (formato "LOGA1").
 * Retrocompat lectura: backups antiguos AES-256-CBC + PBKDF2 (openssl) siguen restaurables.
 *
 * Retención: 2 locales (más recientes), 10 en Drive.
 * Nombre: backup-YYYY-MM-DD_HH-mm-ss.sql.gz.enc  (lex == cronológico, con hora)
 * Formatos legacy aceptados (lectura/cleanup): backup-DD-MM-YYYY.* y loga_YYYYMMDD_HHMMSS.*
 *
 * Seguridad:
 *  - BACKUP_PASSWORD obligatorio (sin fallback hardcodeado)
 *  - Argon2id memory-hard (64 MiB × 4 iter) → cracking GPU inviable
 *  - GCM AEAD: si alguien modifica 1 bit del .enc → descifrado falla limpiamente
 *  - rclone copy con execFileSync + array de args (sin shell interpolation)
 *  - Filenames generados por servidor (no input usuario)
 */

import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable, Writable } from 'stream';
import { logger } from '../lib/logger';
import { encryptStream, decryptStream, isLogaV1 } from '../lib/cryptoBackup';

const BACKUP_DIR = path.join(process.cwd(), '..', 'backups');

// Regex aceptados (un único punto de verdad)
const RX_NEW    = /^backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.sql\.gz\.enc$/;
const RX_OLD    = /^backup-(\d{2})-(\d{2})-(\d{4})\.sql\.gz\.enc$/;
const RX_LEGACY = /^loga_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.sql\.gz\.enc$/;
const RX_PRE    = /^pre-restore-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.sql\.gz\.enc$/;

function isBackupFilename(f: string): boolean {
  return RX_NEW.test(f) || RX_OLD.test(f) || RX_LEGACY.test(f) || RX_PRE.test(f);
}

function backupTimestamp(filename: string, fallbackMtimeMs?: number): number {
  let m = filename.match(RX_NEW) || filename.match(RX_PRE);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = filename.match(RX_LEGACY);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = filename.match(RX_OLD);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return fallbackMtimeMs ?? 0;
}

function backupDateLabel(filename: string, fallbackMtime: Date): string {
  let m = filename.match(RX_NEW) || filename.match(RX_PRE);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  m = filename.match(RX_LEGACY);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  m = filename.match(RX_OLD);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return fallbackMtime.toLocaleDateString('es-ES');
}

interface BackupResult {
  ok: boolean;
  filename: string;
  size: string;
  local: boolean;
  drive: boolean;
  driveError?: string;
  cleaned: number;
}

interface BackupFile {
  filename: string;
  size: string;
  date: string;
  path: string;
}

async function getBackupPassword(): Promise<string> {
  // 1) Prioridad: contraseña guardada en BD (configurable desde la UI).
  try {
    const { pool } = await import('../db/pool');
    const { decryptSecret } = await import('../lib/secretCrypto');
    const { rows: [c] } = await pool.query(`SELECT backup_password FROM configuracion_global WHERE id = 1`);
    const fromDbRaw = c?.backup_password as string | null;
    const fromDb = fromDbRaw ? decryptSecret(fromDbRaw) : null;
    if (fromDb && fromDb.length >= 12) return fromDb;
  } catch { /* migración 048 puede no estar aplicada */ }
  // 2) Fallback: variable de entorno
  const pw = process.env.BACKUP_PASSWORD;
  if (!pw || pw.length < 12) {
    throw new Error('Contraseña de backup no configurada (mínimo 12 caracteres). Configúrala en Configuración → Backup o define BACKUP_PASSWORD en .env.');
  }
  return pw;
}

/**
 * Stream que emite: pg_dump bytes + (opcional: separator + base64 de tar uploads).
 * Generator async: las piezas se generan secuencialmente, sin cargar todo en RAM
 * (excepto el tar de uploads que se buffer-iza para base64 — uploads suele ser <50MB).
 */
async function* assembleSource(cwd: string, hasUploads: boolean): AsyncGenerator<Buffer> {
  // Usa DATABASE_URL si está definido (más fiable que asumir BD 'loga_erp').
  const dbUrl = process.env.DATABASE_URL;
  const dumpArgs = dbUrl ? ['--dbname', dbUrl] : ['loga_erp'];
  let dump;
  try {
    dump = spawn('pg_dump', dumpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`No se pudo lanzar pg_dump: ${(e as Error).message}. ¿Está instalado y en PATH?`);
  }
  let dumpErr = '';
  let dumpSpawnErr: Error | null = null;
  dump.stderr.on('data', (d: Buffer) => { dumpErr += d.toString(); });
  dump.on('error', (e) => { dumpSpawnErr = e; });

  for await (const chunk of dump.stdout) {
    yield chunk as Buffer;
  }
  const dumpCode: number = await new Promise(r => dump.on('close', (c) => r(c ?? -1)));
  if (dumpSpawnErr) {
    const code = (dumpSpawnErr as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error('pg_dump no encontrado. Instala postgresql-client y asegúrate de que está en PATH (which pg_dump).');
    }
    throw new Error(`pg_dump no se pudo iniciar: ${(dumpSpawnErr as Error).message}`);
  }
  if (dumpCode !== 0) {
    // Mensajes típicos de pg_dump más útiles
    const errClean = dumpErr.trim().slice(0, 500);
    let hint = '';
    if (/role .* does not exist|FATAL.*authentication|peer authentication/i.test(errClean)) {
      hint = ' Configura PGUSER/PGPASSWORD o DATABASE_URL con usuario válido.';
    } else if (/database .* does not exist/i.test(errClean)) {
      hint = ' La BD no existe o el nombre es incorrecto. Define DATABASE_URL.';
    } else if (/server version|version mismatch/i.test(errClean)) {
      hint = ' Versión de pg_dump no coincide con la del servidor. Instala la misma versión.';
    }
    throw new Error(`pg_dump falló (exit ${dumpCode}): ${errClean}.${hint}`);
  }

  if (hasUploads) {
    yield Buffer.from('\n---UPLOADS_SEPARATOR---\n');
    const tar = spawn('tar', ['cf', '-', '-C', cwd, 'uploads'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let tarErr = '';
    tar.stderr.on('data', (d: Buffer) => { tarErr += d.toString(); });
    const chunks: Buffer[] = [];
    for await (const c of tar.stdout) chunks.push(c as Buffer);
    const tarCode: number = await new Promise(r => tar.on('close', (c) => r(c ?? -1)));
    if (tarCode !== 0) {
      throw new Error(`tar falló (exit ${tarCode}): ${tarErr.slice(0, 500)}`);
    }
    yield Buffer.from(Buffer.concat(chunks).toString('base64'));
  }
}

/** Writable que captura solo los primeros `limit` bytes y descarta el resto. Para validación rápida. */
class HeadCapture extends Writable {
  private buf: Buffer[] = [];
  private taken = 0;
  constructor(private limit: number) { super(); }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    if (this.taken < this.limit) {
      const take = Math.min(chunk.length, this.limit - this.taken);
      this.buf.push(chunk.subarray(0, take));
      this.taken += take;
    }
    cb();
  }
  text(): string { return Buffer.concat(this.buf).toString('utf-8'); }
}

/**
 * Descifra `srcEncrypted` → escribe contenido plano (gunzipped) en `dstPlain`.
 * Auto-detecta formato:
 *  - "LOGA1" magic → AES-256-GCM + Argon2id
 *  - Otro → legacy openssl AES-256-CBC + PBKDF2
 */
async function decryptBackupToFile(srcEncrypted: string, dstPlain: string, password: string): Promise<void> {
  if (isLogaV1(srcEncrypted)) {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dstPlain);
      out.on('error', reject);
      out.on('finish', resolve);
      decryptStream(srcEncrypted, out, password).catch(reject);
    });
  } else {
    // Legacy: openssl CLI (formato CBC + PBKDF2 generado por versiones anteriores)
    const srcQ = JSON.stringify(srcEncrypted);
    const dstQ = JSON.stringify(dstPlain);
    const env = { ...process.env, BK_PASS: password };
    const { execSync } = await import('child_process');
    execSync(
      `openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass env:BK_PASS -in ${srcQ} | gunzip > ${dstQ}`,
      { timeout: 180000, shell: '/bin/bash', env, stdio: 'pipe' },
    );
  }
}

/** Cifra (pg_dump [+ uploads]) → outputPath con formato LOGA1. */
async function encryptBackup(outputPath: string, password: string, hasUploads: boolean, cwd: string): Promise<void> {
  const source = Readable.from(assembleSource(cwd, hasUploads));
  await encryptStream(source, outputPath, password);
}

// Lock global: si dos llamadas (p.ej. manual + cron) coinciden, ambas
// devuelven la MISMA promesa. Sin esto, pg_dump/streams concurrentes producían
// .enc truncados con authTag GCM inválido — el bug que mostró "Unsupported state
// or unable to authenticate data" al restaurar.
let backupEnEjecucion: Promise<BackupResult> | null = null;

export function ejecutarBackup(): Promise<BackupResult> {
  if (backupEnEjecucion) return backupEnEjecucion;
  backupEnEjecucion = ejecutarBackupInterno().finally(() => {
    backupEnEjecucion = null;
  });
  return backupEnEjecucion;
}

async function ejecutarBackupInterno(): Promise<BackupResult> {
  const password = await getBackupPassword();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const HH   = String(now.getHours()).padStart(2, '0');
  const MM   = String(now.getMinutes()).padStart(2, '0');
  const SS   = String(now.getSeconds()).padStart(2, '0');
  const filename = `backup-${yyyy}-${mm}-${dd}_${HH}-${MM}-${SS}.sql.gz.enc`;
  const filepath = path.join(BACKUP_DIR, filename);

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  const uploadsDir = path.join(process.cwd(), 'uploads');
  const hasUploads = fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0;

  await encryptBackup(filepath, password, hasUploads, process.cwd());

  const stats = fs.statSync(filepath);
  const sizeKB = Math.round(stats.size / 1024);

  // Validación post-backup: descifrar y verificar magic header pg_dump.
  // GCM authTag se valida implícitamente al consumir todo el stream (decipher.final()).
  // Si falla auth → throw → borramos archivo corrupto.
  try {
    const cap = new HeadCapture(4096);
    await decryptStream(filepath, cap, password);
    const head = cap.text();
    if (!/PostgreSQL database dump|^--\s|^SET\s|^CREATE\s/m.test(head)) {
      throw new Error('contenido no parece pg_dump válido tras descifrar');
    }
  } catch (e) {
    try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Backup creado pero validación falló: ${msg}. Backups antiguos preservados.`);
  }

  // ── A PARTIR DE AQUÍ EL BACKUP LOCAL YA ESTÁ HECHO Y VALIDADO ─────────────
  // Subir a Drive es OPCIONAL. Si tarda demasiado o falla, no rompe la operación.
  let drive = false;
  let driveError: string | undefined;
  const DRIVE_TIMEOUT_MS = 60_000;

  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} >${ms}ms`)), ms)),
    ]);

  // 1) Intentar API de Google Drive (OAuth configurado desde la UI) con timeout
  try {
    const gdrive = await import('../lib/gdrive');
    const cfg = await gdrive.loadConfig();
    if (cfg?.refresh_token) {
      logger.info('[backup] subiendo a Google Drive…');
      const result = await withTimeout(gdrive.uploadFile(filepath), DRIVE_TIMEOUT_MS, 'gdrive.upload');
      if (result?.id) {
        drive = true;
        logger.info('[backup] Drive OK', { id: result.id });
        // Cleanup: mantener solo 10 más recientes (no crítico, con timeout corto)
        try {
          const remotos = await withTimeout(gdrive.listBackups(), 15_000, 'gdrive.list');
          const sorted = remotos
            .filter(r => isBackupFilename(r.name))
            .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
          for (const f of sorted.slice(10)) {
            await withTimeout(gdrive.deleteFile(f.id), 10_000, 'gdrive.delete');
          }
        } catch (e) {
          logger.warn('[backup] cleanup Drive (API) falló', { err: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } catch (e) {
    driveError = `Drive: ${e instanceof Error ? e.message : 'desconocido'}`;
    logger.warn(`[backup] subida a Drive falló (backup local SÍ creado): ${driveError}`);
  }

  // 2) Fallback a rclone si la API no está disponible/configurada
  if (!drive) {
    try {
      const remotes = execFileSync('rclone', ['listremotes'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      if (remotes.includes('y:')) {
        execFileSync('rclone', ['copy', filepath, 'y:Loga-Backups', '--quiet'], { timeout: 30000 });
        drive = true;
        driveError = undefined;

        try {
          const lsOut = execFileSync('rclone', ['ls', 'y:Loga-Backups'], { timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
          const files = lsOut.trim().split('\n').filter(Boolean)
            .map(line => line.trim().split(/\s+/).slice(1).join(' '))
            .filter(isBackupFilename)
            .sort((a, b) => backupTimestamp(b) - backupTimestamp(a));
          for (const f of files.slice(10)) {
            execFileSync('rclone', ['deletefile', `y:Loga-Backups/${f}`, '--quiet'], { timeout: 10000, stdio: 'ignore' });
          }
        } catch (e) {
          logger.warn('[backup] cleanup remoto falló', { err: e instanceof Error ? e.message : String(e) });
        }
      } else if (!driveError) {
        driveError = 'Drive no configurado. Configúralo en Configuración → Backup → Google Drive.';
      }
    } catch (e) {
      if (!driveError) driveError = `rclone no disponible: ${e instanceof Error ? e.message : 'desconocido'}`;
    }
  }

  // Cleanup local — keep only last 2 (orden cronológico real, no lex)
  // Excluir pre-restore-*.sql.gz.enc del cleanup (esos los borra el usuario manualmente).
  const localFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => isBackupFilename(f) && !RX_PRE.test(f))
    .map(f => ({ f, ts: backupTimestamp(f, fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs) }))
    .sort((a, b) => b.ts - a.ts)
    .map(x => x.f);
  let cleaned = 0;
  for (const f of localFiles.slice(2)) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    cleaned++;
  }

  return { ok: true, filename, size: `${sizeKB} KB`, local: true, drive, driveError, cleaned };
}

export function listarBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(isBackupFilename)
    .map(f => {
      const stats = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        filename: f,
        size: `${Math.round(stats.size / 1024)} KB`,
        date: backupDateLabel(f, stats.mtime),
        path: path.join(BACKUP_DIR, f),
        _ts: backupTimestamp(f, stats.mtimeMs),
      };
    })
    .sort((a, b) => b._ts - a._ts)
    .map(({ _ts, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/**
 * Valida que un dump SQL descomprimido empieza Y termina como un pg_dump válido.
 * Lee primeros 4KB y últimos 1KB. Si falta el marker de fin, el dump fue truncado.
 */
function validarDumpSQL(dumpPath: string): { valido: boolean; motivo?: string } {
  if (!fs.existsSync(dumpPath)) return { valido: false, motivo: 'archivo no existe' };
  const stats = fs.statSync(dumpPath);
  if (stats.size < 1000) return { valido: false, motivo: `tamaño sospechosamente bajo (${stats.size} bytes)` };

  const fd = fs.openSync(dumpPath, 'r');
  try {
    const headBuf = Buffer.alloc(4096);
    fs.readSync(fd, headBuf, 0, 4096, 0);
    const head = headBuf.toString('utf-8');
    if (!/PostgreSQL database dump|^--\s|^SET\s|^CREATE\s/m.test(head)) {
      return { valido: false, motivo: 'cabecera no es pg_dump válido' };
    }
    const tailSize = Math.min(2048, stats.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, stats.size - tailSize);
    const tail = tailBuf.toString('utf-8');
    if (!/PostgreSQL database dump complete/i.test(tail)) {
      return { valido: false, motivo: 'falta marker "PostgreSQL database dump complete" — dump truncado' };
    }
    return { valido: true };
  } finally {
    fs.closeSync(fd);
  }
}

/** DDL drop completo del schema public + restore SQL en transacción atómica. */
function buildRestoreScript(sqlContent: string): string {
  return `
BEGIN;
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (
    SELECT typname FROM pg_type
    WHERE typtype = 'e'
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) LOOP
    EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
  END LOOP;
END $$;
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
  END LOOP;
  FOR r IN (
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequencename) || ' CASCADE';
  END LOOP;
  FOR r IN (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;
${sqlContent}
COMMIT;
`;
}

export async function restaurarBackup(filepath: string): Promise<{ ok: boolean; message: string; pre_restore_backup?: string }> {
  const resolved = path.resolve(filepath);
  const expectedDir = path.resolve(BACKUP_DIR);
  if (!resolved.startsWith(expectedDir + path.sep)) {
    return { ok: false, message: 'Ruta de backup inválida (fuera del directorio de backups).' };
  }
  if (!isBackupFilename(path.basename(resolved))) {
    return { ok: false, message: 'Nombre de archivo de backup no válido.' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: 'Archivo de backup no encontrado.' };
  }

  let password: string;
  try { password = await getBackupPassword(); }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'Error de configuración' }; }

  const tmpDir = path.join(BACKUP_DIR, 'tmp_restore');
  let preRestoreFilename: string | undefined;

  try {
    // PASO 1: descifrar a tmp y VALIDAR ANTES de tocar BD.
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'dump.sql');
    try {
      await decryptBackupToFile(resolved, tmpFile, password);
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: false, message: `No se pudo descifrar/descomprimir el backup: ${e instanceof Error ? e.message : 'error'}. La base de datos NO ha sido tocada.` };
    }

    // Separar SQL de uploads (formato con separator)
    const fullContent = fs.readFileSync(tmpFile, 'utf-8');
    const sepIdx = fullContent.indexOf('---UPLOADS_SEPARATOR---');
    let sqlContent: string;
    let uploadsPart = '';
    if (sepIdx > 0) {
      sqlContent = fullContent.substring(0, sepIdx);
      uploadsPart = fullContent.substring(sepIdx + '---UPLOADS_SEPARATOR---'.length + 1);
    } else {
      sqlContent = fullContent;
    }
    // pg_dump 16+ inserta `\restrict`/`\unrestrict` que rompen transacción explícita.
    sqlContent = sqlContent
      .split('\n')
      .filter(line => !/^\s*\\(restrict|unrestrict)\b/.test(line))
      .join('\n');
    fs.writeFileSync(path.join(tmpDir, 'db.sql'), sqlContent);
    const sqlPathToValidate = path.join(tmpDir, 'db.sql');

    const val = validarDumpSQL(sqlPathToValidate);
    if (!val.valido) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: false, message: `Backup inválido: ${val.motivo}. La base de datos NO ha sido tocada.` };
    }

    // PASO 2: PRE-BACKUP automático del estado actual (red de seguridad). Formato LOGA1.
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    preRestoreFilename = `pre-restore-${ts}.sql.gz.enc`;
    const preRestorePath = path.join(BACKUP_DIR, preRestoreFilename);
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const hasUploads = fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0;
    try {
      await encryptBackup(preRestorePath, password, hasUploads, process.cwd());
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: false, message: `No se pudo crear el pre-backup de seguridad: ${e instanceof Error ? e.message : 'error'}. La base de datos NO ha sido tocada.` };
    }
    logger.info('[restaurarBackup] pre-backup creado', { archivo: preRestoreFilename });

    // PASO 3: restore en transacción atómica.
    const dropScript = buildRestoreScript(sqlContent);
    const scriptFile = path.join(tmpDir, 'restore_script.sql');
    fs.writeFileSync(scriptFile, dropScript);

    const restoreResult = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', scriptFile, 'loga_erp'], {
      timeout: 600000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (restoreResult.status !== 0) {
      const stderr = restoreResult.stderr?.toString() ?? '';
      logger.error('[restaurarBackup] restore principal falló — iniciando rollback al pre-backup', { stderr });

      try {
        const rollbackTmp = path.join(tmpDir, 'rollback.sql');
        await decryptBackupToFile(preRestorePath, rollbackTmp, password);
        const rbContent = fs.readFileSync(rollbackTmp, 'utf-8');
        const rbSep = rbContent.indexOf('---UPLOADS_SEPARATOR---');
        const rbSqlRaw = rbSep > 0 ? rbContent.substring(0, rbSep) : rbContent;
        const rbSql = rbSqlRaw
          .split('\n')
          .filter(line => !/^\s*\\(restrict|unrestrict)\b/.test(line))
          .join('\n');

        const rbScript = buildRestoreScript(rbSql);
        const rbScriptFile = path.join(tmpDir, 'rollback_script.sql');
        fs.writeFileSync(rbScriptFile, rbScript);
        const rbResult = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', rbScriptFile, 'loga_erp'], {
          timeout: 600000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (rbResult.status !== 0) {
          logger.error('[restaurarBackup] ROLLBACK TAMBIÉN FALLÓ', { stderr: rbResult.stderr?.toString() });
          return {
            ok: false,
            pre_restore_backup: preRestoreFilename,
            message: `CRÍTICO: el restore falló Y el rollback automático falló. La base de datos puede estar en estado inconsistente. Pre-backup preservado en: ${preRestoreFilename}. Contacta soporte.`,
          };
        }
        return {
          ok: false,
          pre_restore_backup: preRestoreFilename,
          message: `Restore falló (${stderr.split('\n')[0] || 'error desconocido'}). Se restauró automáticamente el estado previo. Pre-backup conservado: ${preRestoreFilename}. Datos intactos.`,
        };
      } catch (rbErr) {
        logger.error('[restaurarBackup] rollback exception', { err: rbErr });
        return {
          ok: false,
          pre_restore_backup: preRestoreFilename,
          message: `CRÍTICO: restore falló y rollback lanzó excepción: ${rbErr instanceof Error ? rbErr.message : 'error'}. Pre-backup conservado: ${preRestoreFilename}.`,
        };
      }
    }

    // PASO 4: Restore de uploads
    if (uploadsPart.trim()) {
      try {
        const uploadsDir2 = path.join(process.cwd(), 'uploads');
        if (fs.existsSync(uploadsDir2)) fs.rmSync(uploadsDir2, { recursive: true, force: true });
        const tarFile = path.join(tmpDir, 'uploads.tar');
        fs.writeFileSync(tarFile, Buffer.from(uploadsPart.trim(), 'base64'));
        execFileSync('tar', ['xf', tarFile, '-C', process.cwd()], { timeout: 60000, stdio: 'pipe' });
      } catch (e) {
        logger.warn('[restaurarBackup] DB restaurada OK pero uploads falló', { err: e });
      }
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    return {
      ok: true,
      pre_restore_backup: preRestoreFilename,
      message: `Backup restaurado correctamente. Pre-backup conservado: ${preRestoreFilename} (puedes borrarlo cuando confirmes que todo funciona).`,
    };
  } catch (err) {
    logger.error('[restaurarBackup]', { err });
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return {
      ok: false,
      pre_restore_backup: preRestoreFilename,
      message: `Error al restaurar: ${err instanceof Error ? err.message : 'error desconocido'}.${preRestoreFilename ? ` Pre-backup conservado: ${preRestoreFilename}.` : ''}`,
    };
  }
}
