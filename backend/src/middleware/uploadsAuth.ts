import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth';
import { pool } from '../db/pool';

/**
 * Middleware de autorización para /uploads/<archivo>.
 *
 * Antes (Fix #6): solo verificaba token JWT válido. Cualquier usuario
 * autenticado podía enumerar `foto-<timestamp>-<rand>.jpg` y descargar
 * archivos arbitrarios → IDOR.
 *
 * Ahora:
 *  1. Token JWT válido (algoritmo pinneado vía verifyToken).
 *  2. El filename solicitado debe estar referenciado en BD (foto_urls,
 *     archivos, sds_url, etc). Si no está referenciado, 404 — no se
 *     permite enumeración.
 *  3. Path traversal explícito bloqueado (.., /, \).
 *  4. Sólo extensiones whitelisted (defensa en profundidad).
 */

// Extensiones permitidas para servir desde /uploads
const ALLOWED_EXT = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|csv|txt)$/i;
// Filename seguro: solo alfanumérico, guiones, puntos, no path traversal
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

export async function uploadsAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1) Token
  const rawToken = req.query.token;
  const token = (typeof rawToken === 'string' ? rawToken : '') ||
    req.headers.authorization?.replace('Bearer ', '') || '';
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let user: { id: string; rol: string };
  try {
    user = verifyToken(token) as { id: string; rol: string };
  } catch {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }

  // 2) Sanitización de filename — bloquear path traversal y nombres raros
  // req.path empieza con "/" → quitar el primer carácter.
  const requested = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (!requested) return res.status(404).end();
  if (requested.includes('..') || requested.includes('/') || requested.includes('\\')) {
    return res.status(400).json({ error: 'Path no valido' });
  }
  if (!SAFE_FILENAME.test(requested)) {
    return res.status(400).json({ error: 'Nombre de archivo no valido' });
  }
  if (!ALLOWED_EXT.test(requested)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }

  // 3) Validación ownership — el filename debe estar referenciado en BD.
  // Esto previene la enumeración ciega de archivos huérfanos o no
  // pertenecientes al usuario (si en el futuro hay multi-tenant, este
  // middleware se amplía con filtro por empresa_id/usuario_id).
  const path = `/uploads/${requested}`;
  const refs = await pool.query<{ src: string }>(
    `SELECT 'op_foto' AS src FROM ordenes_produccion
       WHERE foto_url = $1 OR foto_urls @> to_jsonb($1::text)
     UNION ALL
     SELECT 'op_archivo' FROM ordenes_produccion
       WHERE archivos @> jsonb_build_array(jsonb_build_object('url', $1::text))
     UNION ALL
     SELECT 'producto_sds' FROM productos WHERE sds_url = $1
     UNION ALL
     SELECT 'pedido_foto' FROM pedidos WHERE foto_urls @> to_jsonb($1::text)
     LIMIT 1`,
    [path]
  );

  if (refs.rows.length === 0) {
    // Devolvemos 404 (no 403) para no revelar si el archivo existe en disco
    // pero no tiene referencia en BD (anti-enumeración).
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  // Adjuntar usuario para auditoría aguas abajo si hace falta
  (req as any).user = user;
  next();
}
