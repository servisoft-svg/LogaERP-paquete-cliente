// Cifrado simétrico de secretos almacenados en BD (smtp_pass, backup_password).
// AES-256-GCM con clave maestra derivada de JWT_SECRET (HKDF-SHA256, info distinta).
// Formato del ciphertext en BD: "enc:v1:<base64(iv|tag|ct)>"
//
// Compatibilidad: si el valor no empieza por "enc:v1:" se trata como texto plano
// (legacy). El re-cifrado ocurre transparentemente al siguiente guardado.

import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const jwt = process.env.JWT_SECRET ?? '';
  if (jwt.length < 32) {
    throw new Error('JWT_SECRET requerido (>=32 chars) para cifrar secretos en BD');
  }
  // HKDF-Extract sin salt + Expand con info de dominio → clave 32 bytes
  const ikm = Buffer.from(jwt, 'utf8');
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from('loga-config-secret-v1'), KEY_LEN));
  return cachedKey;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain;            // ya cifrado, no doblar
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (!isEncrypted(value)) return value;           // legacy plaintext: devolver tal cual
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    throw new Error('No se pudo descifrar el secreto. ¿Cambió JWT_SECRET tras guardarlo?');
  }
}
