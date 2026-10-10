import {
  ActualizarEstadoClienteSchema,
  CreateClienteSchema,
  ListarClientesQuerySchema,
  CreateContactoSchema,
  UpdateClienteSchema,
  UpdateContactoSchema,
} from '@realpolitik/shared';
import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate';

import {
  actualizarClienteController,
  cambiarEstadoClienteController,
  crearClienteController,
  listarClientesController,
} from './clientes.controller';
import {
  actualizarContactoController,
  crearContactoController,
  eliminarContactoController,
  listarContactosController,
} from './contactos.controller';

export const ClienteIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

export const clientesRouter = Router();

clientesRouter.get('/', validate({ query: ListarClientesQuerySchema }), listarClientesController);
clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);

clientesRouter.patch(
  '/:id',
  validate({ params: ClienteIdParamsSchema, body: UpdateClienteSchema }),
  actualizarClienteController,
);

clientesRouter.patch(
  '/:id/estado',
  validate({ params: ClienteIdParamsSchema, body: ActualizarEstadoClienteSchema }),
  cambiarEstadoClienteController,
);

clientesRouter.get('/:id/contactos', listarContactosController);
clientesRouter.post(
  '/:id/contactos',
  validate({ body: CreateContactoSchema }),
  crearContactoController,
);
clientesRouter.patch(
  '/:id/contactos/:contactoId',
  validate({ body: UpdateContactoSchema }),
  actualizarContactoController,
);
clientesRouter.delete('/:id/contactos/:contactoId', eliminarContactoController);
