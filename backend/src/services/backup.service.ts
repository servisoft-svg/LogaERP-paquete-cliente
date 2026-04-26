/**
 * Backup Service — cifrado AES-256 + subida a Google Drive via rclone
 * Retención: 2 locales (hoy + ayer), 10 en Drive
 * Nombre: backup-DD-MM-YYYY.sql.gz.enc
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

export async function ejecutarBackup(): Promise<BackupResult> {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const filename = `backup-${dd}-${mm}-${yyyy}.sql.gz.enc`;
  const filepath = path.join(BACKUP_DIR, filename);
  const password = process.env.BACKUP_PASSWORD || 'Loga2026';

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Si ya existe el de hoy, sobreescribir
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  // 1. Dump DB completa + uploads en un tar → compress → encrypt
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const hasUploads = fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0;

  if (hasUploads) {
    // Backup completo: DB dump + uploads en un tar
    execSync(
      `(pg_dump loga_erp && echo "---UPLOADS_SEPARATOR---" && tar cf - -C "${process.cwd()}" uploads 2>/dev/null | base64) | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${password}" -out "${filepath}"`,
      { timeout: 120000, shell: '/bin/bash' }
    );
  } else {
    // Solo DB
    execSync(
      `pg_dump loga_erp | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${password}" -out "${filepath}"`,
      { timeout: 60000, shell: '/bin/bash' }
    );
  }

  const stats = fs.statSync(filepath);
  const sizeKB = Math.round(stats.size / 1024);

  // 2. Upload to Google Drive via rclone
  let drive = false;
  let driveError: string | undefined;

  try {
    const remotes = execSync('rclone listremotes 2>/dev/null', { shell: '/bin/bash', timeout: 5000 }).toString();
    if (remotes.includes('y:')) {
      execSync(`rclone copy "${filepath}" y:Loga-Backups --quiet`, { timeout: 120000, shell: '/bin/bash' });
      drive = true;

      try {
        const files = execSync('rclone ls y:Loga-Backups 2>/dev/null', { shell: '/bin/bash', timeout: 30000 })
          .toString().trim().split('\n').filter(Boolean)
          .map(line => line.trim().split(/\s+/).slice(1).join(' '))
          .sort().reverse();
        for (const f of files.slice(10)) {
          execSync(`rclone deletefile "y:Loga-Backups/${f}" --quiet 2>/dev/null`, { shell: '/bin/bash', timeout: 10000 });
        }
      } catch { /* cleanup optional */ }
    } else {
      driveError = 'rclone configurado pero falta remote "y:". Ejecuta: rclone config';
    }
  } catch {
    driveError = 'rclone no instalado o no configurado. Ejecuta: rclone config';
  }

  // 3. Cleanup local — keep only last 2
  const localFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.enc'))
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
      // Extraer fecha del nombre: backup-DD-MM-YYYY
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
  const password = process.env.BACKUP_PASSWORD || 'Loga2026';

  if (!fs.existsSync(filepath)) {
    return { ok: false, message: 'Archivo de backup no encontrado.' };
  }

  try {
    // Borrar TODA la DB actual antes de restaurar
    execSync(
      `psql loga_erp -c "DO \\$\\$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END \\$\\$; DROP TYPE IF EXISTS tipo_producto CASCADE; DROP TYPE IF EXISTS tipo_movimiento CASCADE; DROP TYPE IF EXISTS estado_lote CASCADE; DROP TYPE IF EXISTS estado_orden CASCADE; DROP TYPE IF EXISTS estado_pedido CASCADE;"`,
      { timeout: 30000, shell: '/bin/bash', stdio: 'pipe' }
    );

    // Descifrar + descomprimir
    const tmpDir = path.join(BACKUP_DIR, 'tmp_restore');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const tmpFile = path.join(tmpDir, 'dump.sql');
    execSync(
      `openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass "pass:${password}" -in "${filepath}" | gunzip > "${tmpFile}"`,
      { timeout: 120000, shell: '/bin/bash', stdio: 'pipe' }
    );

    // Verificar si tiene uploads (separador)
    const content = fs.readFileSync(tmpFile, 'utf-8');
    const sepIdx = content.indexOf('---UPLOADS_SEPARATOR---');

    if (sepIdx > 0) {
      // Separar SQL y uploads
      const sqlPart = content.substring(0, sepIdx);
      const uploadsPart = content.substring(sepIdx + '---UPLOADS_SEPARATOR---'.length + 1);

      // Restaurar SQL
      const sqlFile = path.join(tmpDir, 'db.sql');
      fs.writeFileSync(sqlFile, sqlPart);
      execSync(`psql loga_erp < "${sqlFile}"`, { timeout: 120000, shell: '/bin/bash', stdio: 'pipe' });

      // Restaurar uploads (borrar actuales primero)
      const uploadsDir2 = path.join(process.cwd(), 'uploads');
      if (fs.existsSync(uploadsDir2)) fs.rmSync(uploadsDir2, { recursive: true, force: true });
      if (uploadsPart.trim()) {
        const tarFile = path.join(tmpDir, 'uploads.tar');
        fs.writeFileSync(tarFile, Buffer.from(uploadsPart.trim(), 'base64'));
        execSync(`tar xf "${tarFile}" -C "${process.cwd()}"`, { timeout: 30000, shell: '/bin/bash', stdio: 'pipe' });
      }
    } else {
      // Solo SQL
      execSync(`psql loga_erp < "${tmpFile}"`, { timeout: 120000, shell: '/bin/bash', stdio: 'pipe' });
    }

    // Limpiar
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: true, message: 'Backup restaurado correctamente. Todos los datos y archivos han sido recuperados.' };
  } catch (err) {
    return { ok: false, message: `Error al restaurar: ${err instanceof Error ? err.message : 'Error desconocido'}` };
  }
}
