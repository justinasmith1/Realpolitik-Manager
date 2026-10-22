import {
  ActualizarEstadoTipoDocumentoSchema,
  CreateTipoDocumentoSchema,
  ListarTiposDocumentoQuerySchema,
  UpdateTipoDocumentoSchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';

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
export const tiposDocumentoRouter = Router();

tiposDocumentoRouter.get(
  '/',
  validate({ query: ListarTiposDocumentoQuerySchema }),
  listarTiposDocumentoController,
);
tiposDocumentoRouter.post(
  '/',
  validate({ body: CreateTipoDocumentoSchema }),
  crearTipoDocumentoController,
);

tiposDocumentoRouter.patch(
  '/:id',
  validate({ params: TipoDocumentoIdParamsSchema, body: UpdateTipoDocumentoSchema }),
  actualizarTipoDocumentoController,
);

tiposDocumentoRouter.patch(
  '/:id/estado',
  validate({ params: TipoDocumentoIdParamsSchema, body: ActualizarEstadoTipoDocumentoSchema }),
  cambiarEstadoTipoDocumentoController,
);
