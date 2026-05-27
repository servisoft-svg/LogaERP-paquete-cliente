/**
 * POST /api/facturas/parse — sube factura (PDF o imagen) y devuelve campos extraídos.
 *
 * Body: multipart/form-data, campo "factura"
 * Respuesta: { datos: FacturaExtraida, archivo_url, proveedor_match }
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { extraerFactura } from '../lib/facturaParser';
import { pool } from '../db/pool';
import { authMiddleware, adminOnly, verifyToken } from '../middleware/auth';

const router = Router();

// Filenames seguros: solo factura-<timestamp>-<rand>.<ext>
const FACTURA_FILENAME = /^factura-\d+-[a-z0-9]+\.(pdf|jpe?g|png|gif|webp)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
      cb(null, `factura-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (ok) cb(null, true);
    else cb(new Error('Solo PDF o imagen.'));
  },
});

router.post('/parse', authMiddleware, adminOnly, upload.single('factura'), async (req, res) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) return res.status(400).json({ error: 'Archivo requerido.' });

  try {
    const datos = await extraerFactura(file.path, file.mimetype);

    // Match proveedor por nombre (fuzzy ILIKE — el schema no tiene CIF)
    let proveedor_match: { id: string; nombre: string } | null = null;
    if (datos.proveedor_nombre.valor) {
      const nombre = datos.proveedor_nombre.valor;
      // Probar coincidencia exacta primero, luego ILIKE con primeras palabras
      const palabras = nombre.split(/\s+/).filter(p => p.length >= 3).slice(0, 2);
      if (palabras.length > 0) {
        const patrones = palabras.map(p => `%${p}%`);
        const r = await pool.query<{ id: string; nombre: string }>(
          `SELECT id, nombre FROM proveedores
           WHERE activo = true AND (${palabras.map((_, i) => `nombre ILIKE $${i + 1}`).join(' OR ')})
           ORDER BY length(nombre) ASC
           LIMIT 1`,
          patrones,
        );
        if (r.rows.length > 0) proveedor_match = r.rows[0];
      }
    }

    return res.json({
      ok: true,
      datos,
      archivo_url: `/api/facturas/file/${file.filename}`,
      proveedor_match,
    });
  } catch (err: unknown) {
    // Limpiar archivo si parseo falla
    try { await fs.unlink(file.path); } catch { /* noop */ }
    const msg = err instanceof Error ? err.message : 'Error procesando factura';
    return res.status(500).json({ error: msg });
  }
});

// GET /api/facturas/file/:filename?token=XXX
// Sirve la factura subida para que el iframe del frontend pueda mostrarla.
// Auth: token via query param (iframe no envía headers Authorization).
// IMPORTANTE: esta ruta se monta SIN authMiddleware en index.ts (público con
// validación interna por token query). Solo facturas con filename validado.
router.get('/file/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!FACTURA_FILENAME.test(filename)) {
    return res.status(400).json({ error: 'Nombre de archivo no válido.' });
  }

  // Token desde query (iframe) o header (fetch normal)
  const rawToken = req.query.token;
  const token = (typeof rawToken === 'string' ? rawToken : '') ||
    req.headers.authorization?.replace('Bearer ', '') || '';
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let user: { rol?: string };
  try {
    user = verifyToken(token) as { rol?: string };
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
  if (user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores.' });
  }

  const fullpath = path.join(process.cwd(), 'uploads', filename);
  try {
    await fs.access(fullpath);
  } catch {
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  }
  return res.sendFile(fullpath);
});

export default router;
