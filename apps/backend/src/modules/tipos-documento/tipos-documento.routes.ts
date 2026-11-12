import {
  ActualizarEstadoTipoDocumentoSchema,
  CreateTipoDocumentoSchema,
  ListarTiposDocumentoQuerySchema,
  UpdateTipoDocumentoSchema,
} from '@realpolitik/shared';
import { z } from 'zod';

import { validate } from '../../middleware/validate';
import { autorizar, crearRouter } from '../auth/autorizacion';

import {
  actualizarTipoDocumentoController,
  cambiarEstadoTipoDocumentoController,
  crearTipoDocumentoController,
  listarTiposDocumentoController,
} from './tipos-documento.controller';

export const TipoDocumentoIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

// Catálogo de tipos de documento (HU2.1). No hay DELETE: un tipo se desactiva con `/estado`.
export const tiposDocumentoRouter = crearRouter();

tiposDocumentoRouter.get(
  '/',
  autorizar('tipos-documento:ver'),
  validate({ query: ListarTiposDocumentoQuerySchema }),
  listarTiposDocumentoController,
);
tiposDocumentoRouter.post(
  '/',
  autorizar('tipos-documento:editar'),
  validate({ body: CreateTipoDocumentoSchema }),
  crearTipoDocumentoController,
);

tiposDocumentoRouter.patch(
  '/:id',
  autorizar('tipos-documento:editar'),
  validate({ params: TipoDocumentoIdParamsSchema, body: UpdateTipoDocumentoSchema }),
  actualizarTipoDocumentoController,
);

tiposDocumentoRouter.patch(
  '/:id/estado',
  autorizar('tipos-documento:editar'),
  validate({ params: TipoDocumentoIdParamsSchema, body: ActualizarEstadoTipoDocumentoSchema }),
  cambiarEstadoTipoDocumentoController,
);
