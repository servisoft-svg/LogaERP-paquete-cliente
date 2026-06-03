// Error tipado de aplicación. Cada throw lleva HTTP status + código simbólico
// + detalles opcionales. El middleware global serializa a JSON uniforme:
//
//   { error: { codigo, http, mensaje, detalles }, traceId }
//
// Frontend distingue tipo de fallo por `codigo` (string), no por mensaje libre.

import { ErrorCode, ERROR_CATALOG } from '../errors/catalog';

export type ErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  public readonly http: number;
  public readonly codigo: ErrorCode;
  public readonly detalles?: ErrorDetails;

  constructor(codigo: ErrorCode, mensaje?: string, detalles?: ErrorDetails) {
    const entry = ERROR_CATALOG[codigo];
    super(mensaje ?? entry.mensajeDefault);
    this.name = 'AppError';
    this.codigo = codigo;
    this.http = entry.http;
    this.detalles = detalles;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      codigo: this.codigo,
      http: this.http,
      mensaje: this.message,
      detalles: this.detalles,
    };
  }

  // Helpers de uso frecuente — azúcar sintáctico
  static notFound(recurso: string, id?: string | number) {
    return new AppError('NOT_FOUND', `${recurso} no encontrado`, id !== undefined ? { recurso, id } : { recurso });
  }
  static unauthorized(mensaje = 'No autorizado') {
    return new AppError('UNAUTHORIZED', mensaje);
  }
  static forbidden(mensaje = 'Permiso denegado') {
    return new AppError('FORBIDDEN', mensaje);
  }
  static validacion(mensaje: string, detalles?: ErrorDetails) {
    return new AppError('VALIDATION_ERROR', mensaje, detalles);
  }
  static conflicto(codigo: ErrorCode, mensaje?: string, detalles?: ErrorDetails) {
    return new AppError(codigo, mensaje, detalles);
  }
}

// Type guard útil en el middleware y en tests
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
