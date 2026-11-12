export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REQUESTS'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ValidationDetail {
  campo: string;
  mensaje: string;
}

/** `motivo` más datos libres: cada endpoint elige el nombre de la clave (p. ej. clienteExistente). */
export type ConflictDetails = { motivo: string } & Record<string, unknown>;

export type ErrorDetails = ValidationDetail[] | ConflictDetails;

/**
 * Error "esperado" que un endpoint puede lanzar con `throw`. El middleware de errores
 * lo convierte en `{ error: { code, message, details } }`.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: ErrorDetails | undefined,
    /** Segundos para `Retry-After` (429 y 503 que se pueden reintentar). */
    readonly retryAfterSegundos?: number | undefined,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (details: ValidationDetail[]): AppError =>
  new AppError('VALIDATION_ERROR', 400, 'Los datos enviados no son válidos', details);

export const notFound = (message = 'Recurso no encontrado'): AppError =>
  new AppError('NOT_FOUND', 404, message);

/** El cuerpo (o un archivo) supera el tope. Sin detalles: ni el límite ni el tamaño recibido. */
export const payloadTooLarge = (message: string): AppError =>
  new AppError('PAYLOAD_TOO_LARGE', 413, message);

/**
 * Un servicio del que depende el pedido (el almacenamiento de documentos) no respondió. Se puede
 * reintentar. Nunca lleva detalles: ni endpoints, ni credenciales, ni rutas.
 */
export const serviceUnavailable = (message: string, retryAfterSegundos?: number): AppError =>
  new AppError('SERVICE_UNAVAILABLE', 503, message, undefined, retryAfterSegundos);

/** Sin sesión válida o credenciales incorrectas. `motivo` lo distingue para el frontend. */
export const unauthenticated = (motivo: string, message: string): AppError =>
  new AppError('UNAUTHENTICATED', 401, message, { motivo });

/** Autenticado, pero sin permiso para la operación (o un origen no permitido). */
export const forbidden = (motivo: string, message: string): AppError =>
  new AppError('FORBIDDEN', 403, message, { motivo });

/** Demasiados intentos: se puede reintentar pasados `retryAfterSegundos`. */
export const tooManyRequests = (
  motivo: string,
  message: string,
  retryAfterSegundos: number,
): AppError => new AppError('TOO_MANY_REQUESTS', 429, message, { motivo }, retryAfterSegundos);

export const conflict = (
  motivo: string,
  datos: Record<string, unknown> = {},
  message = 'Conflicto con datos existentes',
): AppError => new AppError('CONFLICT', 409, message, { ...datos, motivo });
