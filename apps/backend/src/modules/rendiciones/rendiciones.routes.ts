import {
  ActualizarEstadoRendicionSchema,
  CreateRendicionSchema,
  ListarRendicionesQuerySchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';

import {
  abrirRendicionController,
  agregarRequisitoARendicionController,
  anularRendicionController,
  listarRendicionesController,
  obtenerRendicionController,
} from './rendiciones.controller';

export const IdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

/**
 * Rendiciones de un cliente (contrato 4.5). Se monta en `/clientes`, junto al router de clientes:
 * las rutas cuelgan de `/:id/rendiciones`, donde `:id` es el cliente.
 */
export const rendicionesDeClienteRouter = Router();

rendicionesDeClienteRouter.post(
  '/:id/rendiciones',
  validate({ params: IdParamsSchema, body: CreateRendicionSchema }),
  abrirRendicionController,
);
rendicionesDeClienteRouter.get(
  '/:id/rendiciones',
  validate({ params: IdParamsSchema, query: ListarRendicionesQuerySchema }),
  listarRendicionesController,
);

/** Una rendición por su id (contrato 4.5 y 4.6). Se monta en `/rendiciones`. */
export const rendicionesRouter = Router();

rendicionesRouter.get('/:id', validate({ params: IdParamsSchema }), obtenerRendicionController);
rendicionesRouter.patch(
  '/:id/estado',
  validate({ params: IdParamsSchema, body: ActualizarEstadoRendicionSchema }),
  anularRendicionController,
);

export const RequisitoDeRendicionParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
  requisitoId: z.string().uuid({ message: 'El ID del requisito debe ser un UUID válido.' }),
});

// Sumar un requisito nuevo de la matriz a una rendición abierta (contrato 4.5).
rendicionesRouter.post(
  '/:id/requisitos/:requisitoId',
  validate({ params: RequisitoDeRendicionParamsSchema }),
  agregarRequisitoARendicionController,
);
