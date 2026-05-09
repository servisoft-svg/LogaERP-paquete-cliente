import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/pool';

const _secret = process.env.JWT_SECRET;
if (!_secret || _secret.length < 32) {
  throw new Error('JWT_SECRET debe estar definido en .env con minimo 32 caracteres');
}
const JWT_SECRET: string = _secret;

export interface AuthUser {
  id: string;
  rol: 'admin' | 'trabajador';
  jti?: string;
  exp?: number;
  sistema?: boolean;
}

// Algoritmo de firma fijado a HS256 explícitamente. Sin pin, jsonwebtoken
// acepta cualquier algoritmo presente en el header del token al verificar,
// abriendo la puerta a ataques de downgrade (alg=none) o key-confusion
// (cambio HS↔RS si hubiese clave pública expuesta).
const JWT_ALG = 'HS256' as const;

// Cache en memoria de jtis revocados (TTL 30s) — evita una query SQL
// por cada request autenticada. Se invalida cuando un usuario hace logout.
const revocadosCache = new Map<string, number>(); // jti → epoch ms expiración
let cacheRefreshAt = 0;
const CACHE_TTL_MS = 30_000;

async function refreshRevocadosCache(): Promise<void> {
  const now = Date.now();
  if (now - cacheRefreshAt < CACHE_TTL_MS) return;
  try {
    const { rows } = await pool.query<{ jti: string; expira_at: Date }>(
      `SELECT jti, expira_at FROM sesiones_revocadas WHERE expira_at > NOW()`
    );
    revocadosCache.clear();
    for (const r of rows) {
      revocadosCache.set(r.jti, new Date(r.expira_at).getTime());
    }
    cacheRefreshAt = now;
  } catch (e) {
    // Si BD no responde, fail-open: dejamos pasar tokens válidos por firma
    // para no bloquear el ERP entero. El log queda para diagnóstico.
    console.error('[authMiddleware.refreshRevocadosCache]', e);
  }
}

export function invalidateRevocadosCache(): void {
  cacheRefreshAt = 0;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALG] }) as AuthUser;
    // Tokens 'sistema' (PDF interno) no llevan jti — saltamos chequeo revocación.
    if (!decoded.sistema && decoded.jti) {
      await refreshRevocadosCache();
      if (revocadosCache.has(decoded.jti)) {
        return res.status(401).json({ error: 'Sesión cerrada. Vuelve a iniciar sesión.' });
      }
    }
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

export function adminOnly(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: AuthUser }).user;
  if (!user || typeof user.rol !== 'string' || user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

// Token usuario: TTL 8h + jti único para permitir revocación efectiva
// vía tabla sesiones_revocadas. Antes era 7d sin revocación → token robado
// vivía una semana aunque admin cambiase contraseña.
export function signToken(user: { id: string; rol: string }): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    { id: user.id, rol: user.rol, jti },
    JWT_SECRET,
    { expiresIn: '8h', algorithm: JWT_ALG }
  );
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALG] }) as AuthUser;
}
