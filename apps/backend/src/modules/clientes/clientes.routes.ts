import {
  CreateClienteSchema,
  ListarClientesQuerySchema,
  CreateContactoSchema,
  UpdateContactoSchema,
} from '@realpolitik/shared';
import { Router } from 'express';

import { validate } from '../../middleware/validate';

import { crearClienteController, listarClientesController } from './clientes.controller';
import {
  actualizarContactoController,
  crearContactoController,
  eliminarContactoController,
  listarContactosController,
} from './contactos.controller';

export const clientesRouter = Router();

clientesRouter.get('/', validate({ query: ListarClientesQuerySchema }), listarClientesController);
clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);

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
