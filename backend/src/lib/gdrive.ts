// Helpers OAuth Google Drive — guarda credenciales en BD y permite subir archivos
// usando el refresh_token persistido. El flow es estándar Authorization Code.
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { logger } from './logger';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export interface DriveConfig {
  client_id: string;
  client_secret: string;
  refresh_token: string | null;
  folder_id: string | null;
  email: string | null;
}

export async function loadConfig(): Promise<DriveConfig | null> {
  try {
    const { rows: [c] } = await pool.query(
      `SELECT gdrive_client_id AS client_id,
              gdrive_client_secret AS client_secret,
              gdrive_refresh_token AS refresh_token,
              gdrive_folder_id AS folder_id,
              gdrive_email AS email
       FROM configuracion_global WHERE id = 1`
    );
    if (!c?.client_id || !c?.client_secret) return null;
    return c;
  } catch { return null; }
}

export async function saveCredentials(input: Partial<DriveConfig>): Promise<void> {
  await pool.query(
    `UPDATE configuracion_global SET
       gdrive_client_id     = COALESCE($1, gdrive_client_id),
       gdrive_client_secret = COALESCE($2, gdrive_client_secret),
       gdrive_refresh_token = COALESCE($3, gdrive_refresh_token),
       gdrive_folder_id     = COALESCE($4, gdrive_folder_id),
       gdrive_email         = COALESCE($5, gdrive_email)
     WHERE id = 1`,
    [input.client_id ?? null, input.client_secret ?? null,
     input.refresh_token ?? null, input.folder_id ?? null, input.email ?? null]
  );
}

export function buildOAuthClient(cfg: { client_id: string; client_secret: string }, redirectUri: string): OAuth2Client {
  return new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirectUri);
}

export function buildAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: 'offline',     // imprescindible para obtener refresh_token
    prompt: 'consent',          // fuerza re-consent → siempre devuelve refresh_token
    scope: SCOPES,
  });
}

/** Devuelve un drive client listo para usar con el refresh_token guardado. */
export async function buildDrive(): Promise<drive_v3.Drive | null> {
  const cfg = await loadConfig();
  if (!cfg?.refresh_token) return null;
  const oauth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret);
  oauth.setCredentials({ refresh_token: cfg.refresh_token });
  return google.drive({ version: 'v3', auth: oauth });
}

/** Sube un archivo y devuelve el id remoto. Crea/usa folder configurado si existe. */
export async function uploadFile(filepath: string, mimeType = 'application/octet-stream'): Promise<{ id: string; name: string } | null> {
  const drive = await buildDrive();
  if (!drive) return null;
  const cfg = await loadConfig();
  const name = path.basename(filepath);

  const fileMetadata: drive_v3.Schema$File = { name };
  if (cfg?.folder_id) fileMetadata.parents = [cfg.folder_id];

  const media = { mimeType, body: fs.createReadStream(filepath) };
  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name',
  });
  return { id: res.data.id ?? '', name: res.data.name ?? name };
}

/** Lista backups en la carpeta configurada (o root) ordenados por modificación desc. */
export async function listBackups(): Promise<{ id: string; name: string; modifiedTime?: string | null; size?: string | null }[]> {
  const drive = await buildDrive();
  if (!drive) return [];
  const cfg = await loadConfig();
  const q = cfg?.folder_id
    ? `'${cfg.folder_id}' in parents and trashed = false`
    : `trashed = false and name contains 'backup-'`;
  const res = await drive.files.list({
    q,
    fields: 'files(id, name, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });
  return (res.data.files ?? [])
    .filter(f => f.id && f.name)
    .map(f => ({ id: f.id!, name: f.name!, modifiedTime: f.modifiedTime, size: f.size }));
}

/** Borra archivos por id. */
export async function deleteFile(id: string): Promise<void> {
  const drive = await buildDrive();
  if (!drive) return;
  try { await drive.files.delete({ fileId: id }); }
  catch (e) { logger.warn('[gdrive] delete falló', { id, err: (e as Error).message }); }
}
