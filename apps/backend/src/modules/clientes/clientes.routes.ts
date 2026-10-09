import { CreateClienteSchema, ListarClientesQuerySchema } from '@realpolitik/shared';
import { Router } from 'express';

import { validate } from '../../middleware/validate';

import { crearClienteController, listarClientesController } from './clientes.controller';

export const clientesRouter = Router();

clientesRouter.get('/', validate({ query: ListarClientesQuerySchema }), listarClientesController);
clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);
