import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const _secret = process.env.JWT_SECRET;
if (!_secret || _secret.length < 32) {
  throw new Error('JWT_SECRET debe estar definido en .env con minimo 32 caracteres');
}
const JWT_SECRET: string = _secret;

export interface AuthUser {
  id: string;
  rol: 'admin' | 'trabajador';
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
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

export function signToken(user: { id: string; rol: string }): string {
  return jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}
