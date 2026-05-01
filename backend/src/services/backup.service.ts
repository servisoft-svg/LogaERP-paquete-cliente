/**
 * Backup Service — cifrado AES-256 + subida a Google Drive via rclone
 * Retención: 2 locales (hoy + ayer), 10 en Drive
 * Nombre: backup-DD-MM-YYYY.sql.gz.enc
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
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const filename = `backup-${dd}-${mm}-${yyyy}.sql.gz.enc`;
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
          .filter(name => /^backup-\d{2}-\d{2}-\d{4}\.sql\.gz\.enc$/.test(name)) // sólo nombres válidos
          .sort().reverse();
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

  // 3. Cleanup local — keep only last 2
  const localFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^backup-\d{2}-\d{2}-\d{4}\.sql\.gz\.enc$/.test(f))
    .sort()
    .reverse();
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
    .filter(f => f.endsWith('.enc'))
    .sort().reverse()
    .map(f => {
      const stats = fs.statSync(path.join(BACKUP_DIR, f));
      const match = f.match(/backup-(\d{2})-(\d{2})-(\d{4})/);
      const date = match ? `${match[1]}/${match[2]}/${match[3]}` : stats.mtime.toLocaleDateString('es-ES');
      return {
        filename: f,
        size: `${Math.round(stats.size / 1024)} KB`,
        date,
        path: path.join(BACKUP_DIR, f),
      };
    });
}

export async function restaurarBackup(filepath: string): Promise<{ ok: boolean; message: string }> {
  // Whitelist: filepath debe estar dentro de BACKUP_DIR y matchear patrón conocido
  const resolved = path.resolve(filepath);
  const expectedDir = path.resolve(BACKUP_DIR);
  if (!resolved.startsWith(expectedDir + path.sep)) {
    return { ok: false, message: 'Ruta de backup inválida (fuera del directorio de backups).' };
  }
  if (!/^backup-\d{2}-\d{2}-\d{4}\.sql\.gz\.enc$/.test(path.basename(resolved))) {
    return { ok: false, message: 'Nombre de archivo de backup no válido.' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: 'Archivo de backup no encontrado.' };
  }

  let password: string;
  try { password = getBackupPassword(); }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'Error de configuración' }; }

  const env = { ...process.env, BK_PASS: password };

  try {
    // Drop tablas + tipos via psql con script directo (sin interpolación de user input)
    const dropScript = `
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
      DROP TYPE IF EXISTS tipo_producto CASCADE;
      DROP TYPE IF EXISTS tipo_movimiento CASCADE;
      DROP TYPE IF EXISTS estado_lote CASCADE;
      DROP TYPE IF EXISTS estado_orden CASCADE;
      DROP TYPE IF EXISTS estado_pedido CASCADE;
    `;
    spawnSync('psql', ['loga_erp'], { input: dropScript, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });

    const tmpDir = path.join(BACKUP_DIR, 'tmp_restore');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const tmpFile = path.join(tmpDir, 'dump.sql');
    const tmpFileQuoted = JSON.stringify(tmpFile);
    const resolvedQuoted = JSON.stringify(resolved);
    execSync(
      `openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass env:BK_PASS -in ${resolvedQuoted} | gunzip > ${tmpFileQuoted}`,
      { timeout: 120000, shell: '/bin/bash', env, stdio: 'pipe' }
    );

    const content = fs.readFileSync(tmpFile, 'utf-8');
    const sepIdx = content.indexOf('---UPLOADS_SEPARATOR---');

    if (sepIdx > 0) {
      const sqlPart = content.substring(0, sepIdx);
      const uploadsPart = content.substring(sepIdx + '---UPLOADS_SEPARATOR---'.length + 1);

      const sqlFile = path.join(tmpDir, 'db.sql');
      fs.writeFileSync(sqlFile, sqlPart);
      const sqlContent = fs.readFileSync(sqlFile, 'utf-8');
      spawnSync('psql', ['loga_erp'], { input: sqlContent, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });

      const uploadsDir2 = path.join(process.cwd(), 'uploads');
      if (fs.existsSync(uploadsDir2)) fs.rmSync(uploadsDir2, { recursive: true, force: true });
      if (uploadsPart.trim()) {
        const tarFile = path.join(tmpDir, 'uploads.tar');
        fs.writeFileSync(tarFile, Buffer.from(uploadsPart.trim(), 'base64'));
        execFileSync('tar', ['xf', tarFile, '-C', process.cwd()], { timeout: 30000, stdio: 'pipe' });
      }
    } else {
      const sqlContent = fs.readFileSync(tmpFile, 'utf-8');
      spawnSync('psql', ['loga_erp'], { input: sqlContent, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: true, message: 'Backup restaurado correctamente. Todos los datos y archivos han sido recuperados.' };
  } catch (err) {
    logger.error('[restaurarBackup]', { err });
    return { ok: false, message: `Error al restaurar: ${err instanceof Error ? err.message : 'Error desconocido'}` };
  }
}
