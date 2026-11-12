import type { ErrorRequestHandler } from 'express';

import { AppError, validationError } from '../errors/app-error';

// body-parser (el que lee el JSON) marca sus errores con `type` y `status`.
const readBodyParserError = (err: unknown): { type?: unknown; status: number } | null => {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const { status } = err;
  if (typeof status !== 'number' || status < 400 || status >= 500) return null;
  return { type: 'type' in err ? err.type : undefined, status };
};

const buildBody = (code: string, message: string, details?: unknown) => ({
  error: { code, message, details },
});

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json(buildBody(err.code, err.message, err.details));
    return;
  }

  const bodyError = readBodyParserError(err);
  // Cuerpo más grande que el límite de `json()`: 413, sin detalles (ni el límite ni el tamaño).
  if (bodyError?.type === 'entity.too.large') {
    res
      .status(413)
      .json(buildBody('PAYLOAD_TOO_LARGE', 'El cuerpo de la solicitud es demasiado grande'));
    return;
  }
  if (bodyError) {
    const mensaje =
      bodyError.type === 'entity.parse.failed'
        ? 'El JSON enviado está mal formado'
        : 'No se pudo leer el cuerpo de la solicitud';
    const appError = validationError([{ campo: 'body', mensaje }]);
    res.status(appError.status).json(buildBody(appError.code, appError.message, appError.details));
    return;
  }

  // Solo se registra el tipo de error y el método: el mensaje, el stack o la URL
  // podrían contener SQL, rutas o datos de clientes.
  const name = err instanceof Error ? err.name : 'desconocido';
  console.error(`Error inesperado (${name}) en ${req.method}`);
  res.status(500).json(buildBody('INTERNAL_ERROR', 'Ocurrió un error inesperado'));
};
