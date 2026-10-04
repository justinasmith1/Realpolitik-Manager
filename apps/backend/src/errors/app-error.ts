export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';

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
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (details: ValidationDetail[]): AppError =>
  new AppError('VALIDATION_ERROR', 400, 'Los datos enviados no son válidos', details);

export const notFound = (message = 'Recurso no encontrado'): AppError =>
  new AppError('NOT_FOUND', 404, message);

export const conflict = (
  motivo: string,
  datos: Record<string, unknown> = {},
  message = 'Conflicto con datos existentes',
): AppError => new AppError('CONFLICT', 409, message, { ...datos, motivo });
