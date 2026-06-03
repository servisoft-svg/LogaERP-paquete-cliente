import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '../lib/AppError';
import { ERROR_CATALOG, type ErrorCode } from '../errors/catalog';
import { logger } from '../lib/logger';

// Detecta serialization failure de PostgreSQL → mapear a CONFLICTO_CONCURRENCIA.
// Cliente debería reintentar la mutación.
function esSerializationFailure(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    return c === '40001' || c === '40P01';
  }
  return false;
}

// Body uniforme. `error` se mantiene como STRING para no romper código existente
// que hace `error.response.data.error` esperando texto. Los datos estructurados
// (codigo, http, detalles) van en `error_info` para frontends nuevos.
function serializar(err: AppError, traceId?: string) {
  return {
    error: err.message,
    error_info: {
      codigo: err.codigo,
      http: err.http,
      mensaje: err.message,
      detalles: err.detalles,
    },
    mensaje: err.message,
    traceId,
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  // Si la respuesta ya empezó a enviarse, delega al handler por defecto.
  if (res.headersSent) {
    logger.error('[errorHandler] headers ya enviados', { traceId: req.traceId });
    return;
  }

  let appErr: AppError;

  if (isAppError(err)) {
    appErr = err;
  } else if (esSerializationFailure(err)) {
    appErr = new AppError('CONFLICTO_CONCURRENCIA');
  } else if (err instanceof Error) {
    // Compat con código viejo que tiraba `Error('CODIGO:detalle')`.
    // Si el prefijo coincide con un código del catálogo, lo reinterpretamos.
    const match = /^([A-Z][A-Z0-9_]+)(?::(.*))?$/.exec(err.message);
    if (match && match[1] in ERROR_CATALOG) {
      const codigo = match[1] as ErrorCode;
      appErr = new AppError(codigo, match[2]?.trim() || undefined);
    } else {
      appErr = new AppError('INTERNAL_ERROR', err.message);
    }
  } else {
    appErr = new AppError('INTERNAL_ERROR');
  }

  // Log: 5xx = error, 4xx = warn. No spammear stack para 4xx esperados.
  const meta = {
    traceId: req.traceId,
    codigo: appErr.codigo,
    path: req.path,
    method: req.method,
    detalles: appErr.detalles,
  };
  if (appErr.http >= 500) {
    logger.error(`[err ${appErr.codigo}] ${appErr.message}`, {
      ...meta,
      stack: appErr.stack,
      causaCruda: err instanceof Error ? err.message : err,
    });
  } else {
    logger.warn(`[err ${appErr.codigo}] ${appErr.message}`, meta);
  }

  res.status(appErr.http).json(serializar(appErr, req.traceId));
}

// 404 catch-all para rutas /api/* desconocidas (montar ANTES del errorHandler).
export function notFoundApi(req: Request, _res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/')) {
    return next(new AppError('NOT_FOUND', `Endpoint ${req.method} ${req.path} no existe`));
  }
  return next();
}
