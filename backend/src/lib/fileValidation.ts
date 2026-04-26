import { readFile } from 'fs/promises';

// Magic bytes for common file types
const MAGIC_BYTES: Record<string, Buffer[]> = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/gif':  [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  'image/webp': [Buffer.from('RIFF')],  // + WEBP at offset 8
  'application/pdf': [Buffer.from('%PDF')],
};

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
]);

export function isAllowedExtension(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

export async function validateFileContent(filepath: string, declaredMime: string): Promise<boolean> {
  const expectedMagics = MAGIC_BYTES[declaredMime];
  if (!expectedMagics) return true; // No magic bytes to check for this type

  try {
    const buf = Buffer.alloc(8);
    const fd = await readFile(filepath);
    fd.copy(buf, 0, 0, 8);

    return expectedMagics.some(magic => buf.subarray(0, magic.length).equals(magic));
  } catch {
    return false;
  }
}
