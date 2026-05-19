/**
 * Trace ID Middleware - UUID por request
 * Se propaga a: headers, logs, SQL comments
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID().slice(0, 12);
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}

/**
 * Inyecta trace como comentario SQL para slow query log de PostgreSQL
 * Uso: pool.query(traced(req, 'SELECT * FROM productos'))
 */
export function traced(req: Request, sql: string): string {
  const user = (req as any).user?.id?.slice(0, 8) ?? 'anon';
  return `/* t:${req.traceId} u:${user} */ ${sql}`;
}
