import {
  CAMPO_ARCHIVO_DOCUMENTO,
  MENSAJE_TAMANIO_DOCUMENTO,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
} from '@realpolitik/shared';
import type { RequestHandler } from 'express';
import multer, { memoryStorage, MulterError } from 'multer';

import { payloadTooLarge, validationError, type AppError } from '../../errors/app-error';

// Recepción del formulario de carga (`multipart/form-data`, `POST /documentos`). multer lo lee
// en memoria: con el tope de 10 MB, un archivo entra entero y se puede validar su contenido y
// calcular su hash antes de guardarlo. Nada se escribe en disco.

const recibir = multer({
  storage: memoryStorage(),
  limits: {
    fileSize: TAMANIO_MAXIMO_DOCUMENTO_BYTES,
    files: 1,
    // tipoDocumentoId, anio y mes, con margen; nada más tiene sentido en este formulario.
    fields: 10,
    fieldSize: 1024,
    fieldNameSize: 100,
    parts: 12,
  },
  // Sin esto, un nombre con acentos o ñ llega mal decodificado (latin1).
  defParamCharset: 'utf8',
}).single(CAMPO_ARCHIVO_DOCUMENTO);

/**
 * Los errores de multer, como errores de la API. Ninguno repite lo que mandó el cliente: el
 * `field` y el nombre del archivo de un `MulterError` no se copian en la respuesta.
 */
function traducirError(error: unknown): AppError {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return payloadTooLarge(MENSAJE_TAMANIO_DOCUMENTO);
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
      return validationError([
        {
          campo: CAMPO_ARCHIVO_DOCUMENTO,
          mensaje: `Enviá un solo archivo, en el campo "${CAMPO_ARCHIVO_DOCUMENTO}".`,
        },
      ]);
    }
  }
  // Otros límites de multer, o un multipart mal formado (busboy: "Unexpected end of form").
  return validationError([{ campo: 'body', mensaje: 'El formulario de carga está mal formado.' }]);
}

/** Deja el archivo en `req.file` (si vino) y los campos de texto en `req.body`. */
export const recibirArchivo: RequestHandler = (req, res, next) => {
  recibir(req, res, (error: unknown) => {
    if (error === undefined || error === null) {
      next();
      return;
    }
    next(traducirError(error));
  });
};
