import {
  ActualizarCanalDeItemSchema,
  ActualizarEstadoRendicionSchema,
  ActualizarRendicionSchema,
  CreateRendicionSchema,
  ListarRendicionesQuerySchema,
  PrepararEnvioSchema,
  PropagarCanalDeRequisitoSchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';
import { RequisitoParamsSchema } from '../clientes/clientes.routes';

import {
  abrirRendicionController,
  actualizarRendicionController,
  agregarRequisitoARendicionController,
  anularRendicionController,
  corregirCanalDeItemController,
  listarRendicionesController,
  obtenerRendicionController,
  obtenerUltimaOcController,
  prepararEnvioController,
  propagarCanalDeRequisitoController,
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
// Sugerencia de OC: la de la última rendición del cliente que tenga una (HU2.11).
rendicionesDeClienteRouter.get(
  '/:id/ultima-oc',
  validate({ params: IdParamsSchema }),
  obtenerUltimaOcController,
);
// Pasar el canal actual de un requisito a sus ítems en rendiciones abiertas (contrato 4.5).
rendicionesDeClienteRouter.post(
  '/:id/requisitos/:requisitoId/propagar-canal',
  validate({ params: RequisitoParamsSchema, body: PropagarCanalDeRequisitoSchema }),
  propagarCanalDeRequisitoController,
);

/** Una rendición por su id (contrato 4.5 y 4.6). Se monta en `/rendiciones`. */
export const rendicionesRouter = Router();

rendicionesRouter.get('/:id', validate({ params: IdParamsSchema }), obtenerRendicionController);
// Editar los datos de la OC (HU2.11).
rendicionesRouter.patch(
  '/:id',
  validate({ params: IdParamsSchema, body: ActualizarRendicionSchema }),
  actualizarRendicionController,
);
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

export const ItemDeRendicionParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
  itemId: z.string().uuid({ message: 'El ID del ítem debe ser un UUID válido.' }),
});

// Preparar el envío de los ítems elegidos: solo valida y devuelve sus datos (contrato 4.5).
rendicionesRouter.post(
  '/:id/preparar-envio',
  validate({ params: IdParamsSchema, body: PrepararEnvioSchema }),
  prepararEnvioController,
);

// Corregir el canal de un ítem de una rendición activa (contrato 4.5).
rendicionesRouter.patch(
  '/:id/items/:itemId/canal',
  validate({ params: ItemDeRendicionParamsSchema, body: ActualizarCanalDeItemSchema }),
  corregirCanalDeItemController,
);
