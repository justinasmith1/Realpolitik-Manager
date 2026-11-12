import {
  AplicarDocumentoSchema,
  CargarDocumentoSchema,
  ListarDocumentosQuerySchema,
  ReemplazarDocumentoDeItemSchema,
} from '@realpolitik/shared';

import type { AlmacenamientoDocumentos } from '../../lib/almacenamiento/almacenamiento';
import { validate } from '../../middleware/validate';
import { autorizar, crearRouter, type RouterProtegido } from '../auth/autorizacion';
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
export function crearDocumentosRouter(almacenamiento: AlmacenamientoDocumentos): RouterProtegido {
  const router = crearRouter();

  // Primero el permiso (ya pasaron Origin, sesión y contraseña definitiva en `createApp`): un
  // pedido sin permiso no llega a multer, que lee hasta 10 MB en memoria. Después multer, antes de
  // validar: los campos del formulario llegan a `req.body` recién después de leerlo.
  router.post(
    '/',
    autorizar('documentos:operar'),
    recibirArchivo,
    validate({ body: CargarDocumentoSchema }),
    cargarDocumentoController(almacenamiento),
  );
  router.get(
    '/',
    autorizar('documentos:ver'),
    validate({ query: ListarDocumentosQuerySchema }),
    listarDocumentosController,
  );
  router.get(
    '/:id',
    autorizar('documentos:ver'),
    validate({ params: IdParamsSchema }),
    obtenerDocumentoController,
  );
  router.get(
    '/:id/archivo',
    autorizar('documentos:ver'),
    validate({ params: IdParamsSchema }),
    descargarArchivoController(almacenamiento),
  );
  router.get(
    '/:id/candidatos',
    autorizar('documentos:operar'),
    validate({ params: IdParamsSchema }),
    listarCandidatosController,
  );
  router.post(
    '/:id/aplicaciones',
    autorizar('documentos:operar'),
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
export const documentosDeItemsRouter = crearRouter();

documentosDeItemsRouter.post(
  '/:id/items/:itemId/reemplazo',
  autorizar('documentos:operar'),
  validate({ params: ItemDeRendicionParamsSchema, body: ReemplazarDocumentoDeItemSchema }),
  reemplazarDocumentoDeItemController,
);
documentosDeItemsRouter.get(
  '/:id/items/:itemId/aplicaciones',
  autorizar('documentos:ver'),
  validate({ params: ItemDeRendicionParamsSchema }),
  historialDeItemController,
);
