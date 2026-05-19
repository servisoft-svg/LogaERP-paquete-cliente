/**
 * Cifrado backups — AES-256-GCM + Argon2id.
 *
 * Formato archivo "LOGA1":
 *   [magic "LOGA1" 5B] [version 1B] [salt 16B] [iv 12B] [ciphertext...] [authTag 16B]
 *
 * - AEAD GCM: cualquier modificación de 1 bit del archivo cifrado → falla descifrado
 * - Argon2id memory-hard (64 MiB × 4 iter): inviable crack masivo por GPU
 * - Salt + IV random por backup: nunca reuse
 * - Stream-based: BD de varios GB sin cargar en RAM
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createGzip, createGunzip } from 'zlib';
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync } from 'fs';
import { Readable, Writable, pipeline } from 'stream';
import { promisify } from 'util';
import { hashRaw, Algorithm } from '@node-rs/argon2';

const pipelineP = promisify(pipeline);

const MAGIC = Buffer.from('LOGA1', 'ascii');
const VERSION: number = 0x01;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN; // 34

const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 4,
  parallelism: 2,
  outputLen: 32,
} as const;

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return await hashRaw(password, { ...ARGON2_OPTS, salt });
}

/** True si el archivo empieza con magic "LOGA1". Para diferenciar de formato legacy openssl. */
export function isLogaV1(filepath: string): boolean {
  try {
    const fd = openSync(filepath, 'r');
    try {
      const buf = Buffer.alloc(MAGIC.length);
      readSync(fd, buf, 0, MAGIC.length, 0);
      return buf.equals(MAGIC);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Cifra `source` → escribe archivo cifrado en `outputPath`.
 * Pipeline interno: source → gzip → AES-256-GCM → outputPath
 * El archivo resultante incluye header + ciphertext + authTag.
 */
export async function encryptStream(
  source: Readable,
  outputPath: string,
  password: string,
): Promise<void> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(outputPath);
  const gzip = createGzip();

  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => { if (!settled) { settled = true; reject(err); } };

    source.on('error', fail);
    gzip.on('error', fail);
    cipher.on('error', fail);
    out.on('error', fail);

    out.write(header, (err) => {
      if (err) return fail(err);

      // source → gzip → cipher: cifrado emite chunks que escribimos manualmente
      // (necesitamos escribir el authTag DESPUÉS del último chunk).
      source.pipe(gzip).pipe(cipher);

      cipher.on('data', (chunk: Buffer) => {
        if (!out.write(chunk)) cipher.pause();
      });
      out.on('drain', () => cipher.resume());

      cipher.on('end', () => {
        const tag = cipher.getAuthTag();
        out.write(tag, (err2) => {
          if (err2) return fail(err2);
          out.end(() => { if (!settled) { settled = true; resolve(); } });
        });
      });
    });
  });
}

/**
 * Descifra archivo LOGA1 → escribe contenido descomprimido en `output` (Writable).
 * Lanza error si:
 *  - Magic no coincide
 *  - Versión no soportada
 *  - authTag no valida (tampering detectado)
 *  - Password incorrecto (descifrado falla en final())
 */
export async function decryptStream(
  inputPath: string,
  output: Writable,
  password: string,
): Promise<void> {
  const stats = statSync(inputPath);
  if (stats.size < HEADER_LEN + TAG_LEN) {
    throw new Error('Archivo demasiado pequeño para ser un backup LOGA1 válido');
  }

  // Leer header (primeros 34 bytes) y authTag (últimos 16)
  const fd = openSync(inputPath, 'r');
  let header: Buffer;
  let tag: Buffer;
  try {
    header = Buffer.alloc(HEADER_LEN);
    readSync(fd, header, 0, HEADER_LEN, 0);
    tag = Buffer.alloc(TAG_LEN);
    readSync(fd, tag, 0, TAG_LEN, stats.size - TAG_LEN);
  } finally {
    closeSync(fd);
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Magic header inválido — no es un backup LOGA1');
  }
  const ver = header[MAGIC.length];
  if (ver !== VERSION) {
    throw new Error(`Versión backup ${ver} no soportada (esperado ${VERSION})`);
  }
  const salt = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN);
  const iv = header.subarray(MAGIC.length + 1 + SALT_LEN, HEADER_LEN);

  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const cipherStream = createReadStream(inputPath, {
    start: HEADER_LEN,
    end: stats.size - TAG_LEN - 1,
  });

  const gunzip = createGunzip();
  await pipelineP(cipherStream, decipher, gunzip, output);
}
