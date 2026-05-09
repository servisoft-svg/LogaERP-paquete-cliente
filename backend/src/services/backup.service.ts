/**
 * Backup Service — cifrado AES-256 + subida a Google Drive via rclone
 * Retención: 2 locales (más recientes), 10 en Drive
 * Nombre: backup-YYYY-MM-DD_HH-mm-ss.sql.gz.enc  (lex == cronológico, con hora)
 * Formatos legacy aceptados (lectura/cleanup): backup-DD-MM-YYYY.* y loga_YYYYMMDD_HHMMSS.*
 *
 * Seguridad:
 *  - BACKUP_PASSWORD obligatorio (sin fallback hardcodeado)
 *  - Password pasada vía env var al openssl (-pass env:VAR), nunca en cmdline
 *  - rclone copy con execFileSync + array de args (sin shell interpolation)
 *  - Filenames generados por servidor (no input usuario)
 */

import { execSync, execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';

const BACKUP_DIR = path.join(process.cwd(), '..', 'backups');

// Regex aceptados (un único punto de verdad)
const RX_NEW    = /^backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.sql\.gz\.enc$/;
const RX_OLD    = /^backup-(\d{2})-(\d{2})-(\d{4})\.sql\.gz\.enc$/;
const RX_LEGACY = /^loga_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.sql\.gz\.enc$/;

function isBackupFilename(f: string): boolean {
  return RX_NEW.test(f) || RX_OLD.test(f) || RX_LEGACY.test(f);
}

/** Parsea timestamp del nombre. Devuelve epoch ms. Fallback a 0 si no matchea. */
function backupTimestamp(filename: string, fallbackMtimeMs?: number): number {
  let m = filename.match(RX_NEW);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = filename.match(RX_LEGACY);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = filename.match(RX_OLD);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return fallbackMtimeMs ?? 0;
}

/** Etiqueta legible "DD/MM/YYYY HH:MM" o "DD/MM/YYYY" si no hay hora. */
function backupDateLabel(filename: string, fallbackMtime: Date): string {
  let m = filename.match(RX_NEW);
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

function getBackupPassword(): string {
  const pw = process.env.BACKUP_PASSWORD;
  if (!pw || pw.length < 12) {
    throw new Error('BACKUP_PASSWORD no configurada o demasiado corta (mínimo 12 caracteres). Define la variable de entorno antes de hacer backup.');
  }
  return pw;
}

export async function ejecutarBackup(): Promise<BackupResult> {
  const password = getBackupPassword();
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

  // Pipeline pg_dump | gzip | openssl. Password vía env var, no en cmdline.
  // Uso shell para el pipe pero el password NO se interpola.
  const env = { ...process.env, BK_PASS: password };
  const opensslPass = '-pass env:BK_PASS';
  const cwdQuoted = JSON.stringify(process.cwd());
  const filepathQuoted = JSON.stringify(filepath);

  // Timeout configurable: default 10 min para BD grandes con muchos uploads.
  // Antes hardcoded 120s/60s — backup de BD >2GB se cortaba a la mitad
  // dejando .enc corrupto. Override con BACKUP_TIMEOUT_MS env si necesario.
  const backupTimeout = Math.max(60_000, Number(process.env.BACKUP_TIMEOUT_MS) || 600_000);

  if (hasUploads) {
    execSync(
      `(pg_dump loga_erp && echo "---UPLOADS_SEPARATOR---" && tar cf - -C ${cwdQuoted} uploads 2>/dev/null | base64) | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 ${opensslPass} -out ${filepathQuoted}`,
      { timeout: backupTimeout, shell: '/bin/bash', env }
    );
  } else {
    execSync(
      `pg_dump loga_erp | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 ${opensslPass} -out ${filepathQuoted}`,
      { timeout: backupTimeout, shell: '/bin/bash', env }
    );
  }

  const stats = fs.statSync(filepath);
  const sizeKB = Math.round(stats.size / 1024);

  // ── Validación post-backup: descifrar y verificar magic header pg_dump.
  // Bloqueante: si falla, NO se borran antiguos ni se sube a Drive.
  // Anti-pérdida-de-datos: backup corrupto + cleanup local = pérdida total.
  try {
    const probeBytes = execSync(
      `openssl enc -aes-256-cbc -d -salt -pbkdf2 ${opensslPass} -in ${filepathQuoted} | gunzip 2>/dev/null | head -c 4096`,
      { timeout: 60_000, shell: '/bin/bash', env, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString('utf-8');
    // pg_dump comienza con "--" comentario o "SET " o "--\n-- PostgreSQL".
    // Si el descifrado falla, salida vacía o basura binaria → no matchea.
    const looksValid = /PostgreSQL database dump|^--\s|^SET\s|^CREATE\s/m.test(probeBytes);
    if (!looksValid) {
      throw new Error('contenido no parece pg_dump válido tras descifrar');
    }
  } catch (e) {
    // Borrar el archivo corrupto y abortar — NO tocar backups antiguos.
    try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Backup creado pero validación falló: ${msg}. Backups antiguos preservados.`);
  }

  // 2. rclone con execFileSync — args separados, sin shell interpolation
  let drive = false;
  let driveError: string | undefined;

  try {
    const remotes = execFileSync('rclone', ['listremotes'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    if (remotes.includes('y:')) {
      execFileSync('rclone', ['copy', filepath, 'y:Loga-Backups', '--quiet'], { timeout: 120000 });
      drive = true;

      try {
        const lsOut = execFileSync('rclone', ['ls', 'y:Loga-Backups'], { timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const files = lsOut.trim().split('\n').filter(Boolean)
          .map(line => line.trim().split(/\s+/).slice(1).join(' '))
          .filter(isBackupFilename)
          .sort((a, b) => backupTimestamp(b) - backupTimestamp(a)); // más reciente primero
        for (const f of files.slice(10)) {
          execFileSync('rclone', ['deletefile', `y:Loga-Backups/${f}`, '--quiet'], { timeout: 10000, stdio: 'ignore' });
        }
      } catch (e) {
        logger.warn('[backup] cleanup remoto falló', { err: e instanceof Error ? e.message : String(e) });
      }
    } else {
      driveError = 'rclone configurado pero falta remote "y:". Ejecuta: rclone config';
    }
  } catch (e) {
    driveError = `rclone no disponible: ${e instanceof Error ? e.message : 'desconocido'}`;
  }

  // 3. Cleanup local — keep only last 2 (orden cronológico real, no lex)
  const localFiles = fs.readdirSync(BACKUP_DIR)
    .filter(isBackupFilename)
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
    // Últimos 2KB para buscar marker final
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

export async function restaurarBackup(filepath: string): Promise<{ ok: boolean; message: string; pre_restore_backup?: string }> {
  // Whitelist: filepath debe estar dentro de BACKUP_DIR y matchear patrón conocido
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
  try { password = getBackupPassword(); }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'Error de configuración' }; }

  const env = { ...process.env, BK_PASS: password };
  const tmpDir = path.join(BACKUP_DIR, 'tmp_restore');
  let preRestoreFilename: string | undefined;

  try {
    // ── PASO 1: descifrar el backup objetivo a tmp y VALIDARLO ANTES de tocar la BD.
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'dump.sql');
    const tmpFileQuoted = JSON.stringify(tmpFile);
    const resolvedQuoted = JSON.stringify(resolved);
    try {
      execSync(
        `openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass env:BK_PASS -in ${resolvedQuoted} | gunzip > ${tmpFileQuoted}`,
        { timeout: 180000, shell: '/bin/bash', env, stdio: 'pipe' }
      );
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
    // pg_dump 16+ inserta meta-comandos psql `\restrict <token>` / `\unrestrict <token>`
    // al inicio y final del dump. Cuando ejecutamos el dump dentro de una
    // transacción explícita (BEGIN; ... COMMIT;) con ON_ERROR_STOP=1, esos
    // meta-comandos abortan la transacción. Filtrarlos:
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

    // ── PASO 2: PRE-BACKUP automático del estado actual (red de seguridad).
    // Si el restore falla a mitad, restauramos este pre-backup automáticamente.
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    preRestoreFilename = `pre-restore-${ts}.sql.gz.enc`;
    const preRestorePath = path.join(BACKUP_DIR, preRestoreFilename);
    const preRestoreQuoted = JSON.stringify(preRestorePath);
    const cwdQuoted = JSON.stringify(process.cwd());
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const hasUploads = fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0;
    try {
      if (hasUploads) {
        execSync(
          `(pg_dump loga_erp && echo "---UPLOADS_SEPARATOR---" && tar cf - -C ${cwdQuoted} uploads 2>/dev/null | base64) | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BK_PASS -out ${preRestoreQuoted}`,
          { timeout: 600000, shell: '/bin/bash', env }
        );
      } else {
        execSync(
          `pg_dump loga_erp | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BK_PASS -out ${preRestoreQuoted}`,
          { timeout: 600000, shell: '/bin/bash', env }
        );
      }
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: false, message: `No se pudo crear el pre-backup de seguridad: ${e instanceof Error ? e.message : 'error'}. La base de datos NO ha sido tocada.` };
    }
    logger.info('[restaurarBackup] pre-backup creado', { archivo: preRestoreFilename });

    // ── PASO 3: restore en transacción atómica (psql --single-transaction).
    // El dump de pg_dump no incluye BEGIN/COMMIT por sí mismo. --single-transaction
    // envuelve TODO en una transacción: si una sentencia falla → ROLLBACK total
    // → BD queda como estaba. NO necesitamos DROP previo: el dump incluye los
    // CREATE TABLE y, dentro de la transacción, los DROP necesarios.
    //
    // PERO: pg_dump por defecto NO genera DROP statements. Necesitamos preceder
    // el dump con un DROP TABLE de todo, también dentro de la misma transacción.
    // CRÍTICO: el dump contiene `COPY ... FROM stdin; <data> \.` que solo funciona
    // si psql lee desde un archivo (-f). Pasarlo por stdin con BEGIN/COMMIT
    // envolventes rompe la lectura del COPY (psql confunde wrapper SQL con datos
    // COPY). Escribir todo a un .sql temporal y usar -f.
    const dropScript = `
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
-- DROP dinámico de FUNCTIONS del schema public. Las funciones persisten tras
-- DROP TABLE CASCADE; sin esto, al recrear con CREATE FUNCTION del dump da
-- "already exists with same argument types". Incluimos también las views.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
  END LOOP;
  -- DROP SEQUENCES (no se borran con DROP TABLE CASCADE si son standalone).
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
      -- Excluir funciones que pertenecen a extensiones (ej: pgcrypto.digest).
      -- pg_depend.deptype='e' = "depends on extension" → no se pueden borrar
      -- directamente, son dependencias de la extensión.
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
    const scriptFile = path.join(tmpDir, 'restore_script.sql');
    fs.writeFileSync(scriptFile, dropScript);

    const restoreResult = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', scriptFile, 'loga_erp'], {
      timeout: 600000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (restoreResult.status !== 0) {
      // Restore falló. Intentar rollback automático restaurando el pre-backup.
      const stderr = restoreResult.stderr?.toString() ?? '';
      logger.error('[restaurarBackup] restore principal falló — iniciando rollback al pre-backup', { stderr });

      try {
        // Descifrar pre-backup
        const rollbackTmp = path.join(tmpDir, 'rollback.sql');
        const rollbackQuoted = JSON.stringify(rollbackTmp);
        execSync(
          `openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass env:BK_PASS -in ${preRestoreQuoted} | gunzip > ${rollbackQuoted}`,
          { timeout: 180000, shell: '/bin/bash', env, stdio: 'pipe' }
        );
        // Separar SQL del pre-backup (puede tener uploads)
        const rbContent = fs.readFileSync(rollbackTmp, 'utf-8');
        const rbSep = rbContent.indexOf('---UPLOADS_SEPARATOR---');
        const rbSqlRaw = rbSep > 0 ? rbContent.substring(0, rbSep) : rbContent;
        // Mismo filtro de \restrict/\unrestrict para el rollback (el pre-backup
        // se generó con pg_dump 16+ y lleva los mismos meta-comandos).
        const rbSql = rbSqlRaw
          .split('\n')
          .filter(line => !/^\s*\\(restrict|unrestrict)\b/.test(line))
          .join('\n');

        const rbScript = `
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
-- DROP dinámico de FUNCTIONS del schema public. Las funciones persisten tras
-- DROP TABLE CASCADE; sin esto, al recrear con CREATE FUNCTION del dump da
-- "already exists with same argument types". Incluimos también las views.
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN (
    SELECT viewname FROM pg_views WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
  END LOOP;
  -- DROP SEQUENCES (no se borran con DROP TABLE CASCADE si son standalone).
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
      -- Excluir funciones que pertenecen a extensiones (ej: pgcrypto.digest).
      -- pg_depend.deptype='e' = "depends on extension" → no se pueden borrar
      -- directamente, son dependencias de la extensión.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;
${rbSql}
COMMIT;
`;
        const rbScriptFile = path.join(tmpDir, 'rollback_script.sql');
        fs.writeFileSync(rbScriptFile, rbScript);
        // Mismo motivo: escribir a archivo y usar -f para que COPY FROM stdin funcione.
        const rbResult = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', rbScriptFile, 'loga_erp'], {
          timeout: 600000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (rbResult.status !== 0) {
          // Catastrófico: ni siquiera el pre-backup restaura.
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

    // ── PASO 4: Restore de uploads (post-commit DB, no atómico con DB pero
    // recuperable via pre-backup que también incluye uploads).
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
