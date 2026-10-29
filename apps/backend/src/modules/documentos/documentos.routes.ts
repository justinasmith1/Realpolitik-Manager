import {
  AplicarDocumentoSchema,
  CargarDocumentoSchema,
  ListarDocumentosQuerySchema,
  ReemplazarDocumentoDeItemSchema,
} from '@realpolitik/shared';
import { Router } from 'express';

import type { AlmacenamientoDocumentos } from '../../lib/almacenamiento/almacenamiento';
import { validate } from '../../middleware/validate';
import { IdParamsSchema, ItemDeRendicionParamsSchema } from '../rendiciones/rendiciones.routes';

import {
  aplicarDocumentoController,
  cargarDocumentoController,
  descargarArchivoController,
  historialDeItemController,
  listarCandidatosController,
  listarDocumentosController,
  obtenerDocumentoController,
  reemplazarDocumentoDeItemController,
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
  router.post(
    '/:id/aplicaciones',
    validate({ params: IdParamsSchema, body: AplicarDocumentoSchema }),
    aplicarDocumentoController,
  );

  return router;
}

/**
 * Reemplazo e historial del documento de un ítem (HU2.8, contrato 4.10). Cuelgan de la rendición,
 * como la corrección del canal, pero se montan en `/rendiciones` SOLO con los documentos
 * habilitados: en producción quedan deshabilitados igual que `/documentos`.
 */
export const documentosDeItemsRouter = Router();

documentosDeItemsRouter.post(
  '/:id/items/:itemId/reemplazo',
  validate({ params: ItemDeRendicionParamsSchema, body: ReemplazarDocumentoDeItemSchema }),
  reemplazarDocumentoDeItemController,
);
documentosDeItemsRouter.get(
  '/:id/items/:itemId/aplicaciones',
  validate({ params: ItemDeRendicionParamsSchema }),
  historialDeItemController,
);
