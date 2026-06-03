// Catálogo central de errores ERP Loga.
//
// Convenciones:
// - `codigo` (string ALL_CAPS) identifica TIPO de fallo → frontend ramifica aquí.
// - `http` es el status HTTP estándar (401, 403, 404, 409, 422, 500, 503, ...).
// - `mensajeDefault` es el texto en español si el throw no provee uno.
//
// Añadir un código nuevo:
// 1) Añadir entrada al objeto ERROR_CATALOG.
// 2) `throw new AppError('MI_CODIGO', 'mensaje opcional', { detalles })`.
// 3) Frontend importa el tipo y maneja por code.

export type ErrorEntry = {
  http: number;
  mensajeDefault: string;
  // Descripción para devs (no se serializa al cliente).
  descripcion?: string;
};

export const ERROR_CATALOG = {
  // ─── 4xx genéricos ──────────────────────────────────────────────────────
  VALIDATION_ERROR: {
    http: 400,
    mensajeDefault: 'Datos inválidos',
    descripcion: 'Payload no pasó validación (campos faltantes, tipo erróneo, rango fuera).',
  },
  PAYLOAD_TOO_LARGE: {
    http: 413,
    mensajeDefault: 'Archivo demasiado grande',
  },
  RATE_LIMIT: {
    http: 429,
    mensajeDefault: 'Demasiadas solicitudes',
  },
  NOT_FOUND: {
    http: 404,
    mensajeDefault: 'Recurso no encontrado',
  },

  // ─── Autenticación / Autorización ───────────────────────────────────────
  UNAUTHORIZED: {
    http: 401,
    mensajeDefault: 'No autorizado',
    descripcion: 'No hay token o el token no es válido.',
  },
  TOKEN_EXPIRADO: {
    http: 401,
    mensajeDefault: 'Sesión expirada',
  },
  TOKEN_REVOCADO: {
    http: 401,
    mensajeDefault: 'Sesión revocada',
  },
  CREDENCIALES_INVALIDAS: {
    http: 401,
    mensajeDefault: 'Usuario o contraseña incorrectos',
  },
  BLOQUEO_PROGRESIVO: {
    http: 429,
    mensajeDefault: 'Demasiados intentos fallidos. Espera antes de reintentar.',
  },
  FORBIDDEN: {
    http: 403,
    mensajeDefault: 'Permiso denegado',
  },
  ADMIN_REQUERIDO: {
    http: 403,
    mensajeDefault: 'Solo administradores',
  },
  REACH: {
    http: 403,
    mensajeDefault: 'Aprobación REACH requiere administrador con motivo ≥ 10 caracteres',
    descripcion: 'Trabajador intentó aprobar lote en cuarentena (solo admin).',
  },

  // ─── Stock / lotes ──────────────────────────────────────────────────────
  STOCK_INSUFICIENTE: {
    http: 422,
    mensajeDefault: 'Stock insuficiente para completar la operación',
  },
  STOCK_NEGATIVO: {
    http: 422,
    mensajeDefault: 'El ajuste dejaría stock en negativo',
  },
  STOCK_BLOQUEADO_RESERVA: {
    http: 422,
    mensajeDefault: 'Stock reservado por otro pedido',
  },
  LOTE_NO_DISPONIBLE: {
    http: 422,
    mensajeDefault: 'Lote no disponible (caducado, rechazado o en cuarentena)',
  },
  LOTE_CADUCADO: {
    http: 422,
    mensajeDefault: 'Lote caducado',
  },
  ESTADO_LOTE_INVALIDO: {
    http: 409,
    mensajeDefault: 'Transición de estado de lote no permitida',
  },

  // ─── Producción / calidad ───────────────────────────────────────────────
  QC_OBLIGATORIO: {
    http: 422,
    mensajeDefault: 'Faltan controles de calidad (pH, sólidos, viscosidad)',
  },
  QC_FUERA_DE_RANGO: {
    http: 422,
    mensajeDefault: 'Valores de QC fuera de rango aprobado',
  },
  LIMPIEZA_OBLIGATORIA: {
    http: 422,
    mensajeDefault: 'Falta registro de limpieza entre lotes',
  },
  RECETA_INVALIDA: {
    http: 422,
    mensajeDefault: 'Receta inválida (ciclo o ingredientes inconsistentes)',
  },
  RECETA_CICLO: {
    http: 422,
    mensajeDefault: 'La receta crea un ciclo (un producto se contiene a sí mismo)',
  },
  ORDEN_NO_REVERTIBLE: {
    http: 422,
    mensajeDefault: 'No se puede revertir esta orden (faltaría stock)',
  },
  ORDEN_NO_ENCONTRADA: {
    http: 404,
    mensajeDefault: 'Orden de producción no encontrada',
  },
  RECETA_NO_ENCONTRADA: {
    http: 404,
    mensajeDefault: 'Receta no encontrada',
  },
  RECETA_SIN_INGREDIENTES: {
    http: 422,
    mensajeDefault: 'La receta no tiene ingredientes',
  },

  // ─── Pedidos / albaranes ────────────────────────────────────────────────
  ESTADO_INVALIDO: {
    http: 409,
    mensajeDefault: 'Transición de estado no permitida',
  },
  PEDIDO_YA_COMPLETADO: {
    http: 409,
    mensajeDefault: 'El pedido ya fue completado',
  },
  PEDIDO_YA_CANCELADO: {
    http: 409,
    mensajeDefault: 'El pedido ya está cancelado',
  },
  ALBARAN_YA_ENVIADO: {
    http: 409,
    mensajeDefault: 'Albarán ya enviado',
  },
  CLIENTE_SIN_EMAIL: {
    http: 422,
    mensajeDefault: 'Cliente no tiene email configurado',
  },

  // ─── Conflictos genéricos ───────────────────────────────────────────────
  CONFLICTO_CONCURRENCIA: {
    http: 409,
    mensajeDefault: 'Otro usuario modificó el registro. Recarga e inténtalo de nuevo.',
    descripcion: 'PostgreSQL serialization failure (40001) reintentar en cliente.',
  },
  DUPLICADO: {
    http: 409,
    mensajeDefault: 'Recurso duplicado',
  },
  EN_USO: {
    http: 409,
    mensajeDefault: 'Recurso en uso por otra entidad',
  },

  // ─── Email / SMTP ───────────────────────────────────────────────────────
  EMAIL_FALLO_SMTP: {
    http: 502,
    mensajeDefault: 'Falló envío de email',
  },
  EMAIL_DESTINATARIO_INVALIDO: {
    http: 422,
    mensajeDefault: 'Email destinatario inválido',
  },

  // ─── Archivos ───────────────────────────────────────────────────────────
  ARCHIVO_INVALIDO: {
    http: 400,
    mensajeDefault: 'Tipo de archivo no permitido',
  },
  ARCHIVO_NO_ENCONTRADO: {
    http: 404,
    mensajeDefault: 'Archivo no encontrado',
  },

  // ─── Configuración / backups ────────────────────────────────────────────
  BACKUP_CORRUPTO: {
    http: 422,
    mensajeDefault: 'Archivo de backup corrupto o incompleto',
  },
  BACKUP_PASSWORD_INVALIDO: {
    http: 422,
    mensajeDefault: 'BACKUP_PASSWORD no configurado o insuficiente',
  },
  RESTORE_FALLIDO: {
    http: 500,
    mensajeDefault: 'Restore falló — base de datos restaurada al estado previo',
  },

  // ─── Sistema / infraestructura ──────────────────────────────────────────
  DB_INDISPONIBLE: {
    http: 503,
    mensajeDefault: 'Base de datos no disponible',
  },
  CRON_CAIDO: {
    http: 503,
    mensajeDefault: 'Un proceso programado dejó de responder',
  },
  DB_INVARIANTE: {
    http: 503,
    mensajeDefault: 'Inconsistencia detectada en base de datos',
  },
  SERVICIO_EXTERNO: {
    http: 502,
    mensajeDefault: 'Servicio externo no respondió',
    descripcion: 'Open-Meteo, Drive, SMTP, etc.',
  },
  INTERNAL_ERROR: {
    http: 500,
    mensajeDefault: 'Error interno del servidor',
    descripcion: 'Catch-all para errores no tipados — el handler los convierte aquí.',
  },
} as const satisfies Record<string, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

// Útil para tests / introspección admin
export function listarCodigos(): { codigo: ErrorCode; http: number; mensajeDefault: string }[] {
  return (Object.keys(ERROR_CATALOG) as ErrorCode[]).map((codigo) => ({
    codigo,
    http: ERROR_CATALOG[codigo].http,
    mensajeDefault: ERROR_CATALOG[codigo].mensajeDefault,
  }));
}
