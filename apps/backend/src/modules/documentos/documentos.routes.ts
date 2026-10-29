import { CargarDocumentoSchema, ListarDocumentosQuerySchema } from '@realpolitik/shared';
import { Router } from 'express';

import type { AlmacenamientoDocumentos } from '../../lib/almacenamiento/almacenamiento';
import { validate } from '../../middleware/validate';
import { IdParamsSchema } from '../rendiciones/rendiciones.routes';

import {
  cargarDocumentoController,
  descargarArchivoController,
  listarCandidatosController,
  listarDocumentosController,
  obtenerDocumentoController,
} from './documentos.controller';
import { recibirArchivo } from './recibirArchivo';

/**
 * Documentos (HU2.8, contrato 4.10). Se monta en `/documentos` solo si `createApp` recibe un
 * almacenamiento: en producción está deshabilitado mientras no haya una protección efectiva
 * (ver `DOCUMENTOS_HABILITADOS` en src/config/env.ts).
 */
export function crearDocumentosRouter(almacenamiento: AlmacenamientoDocumentos): Router {
  const router = Router();

  // multer primero: los campos del formulario llegan a `req.body` recién después de leerlo.
  router.post(
    '/',
    recibirArchivo,
    validate({ body: CargarDocumentoSchema }),
    cargarDocumentoController(almacenamiento),
  );
  router.get('/', validate({ query: ListarDocumentosQuerySchema }), listarDocumentosController);
  router.get('/:id', validate({ params: IdParamsSchema }), obtenerDocumentoController);
  router.get(
    '/:id/archivo',
    validate({ params: IdParamsSchema }),
    descargarArchivoController(almacenamiento),
  );
  router.get('/:id/candidatos', validate({ params: IdParamsSchema }), listarCandidatosController);

  return router;
}
