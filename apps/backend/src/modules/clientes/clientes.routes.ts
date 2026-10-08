import { CreateClienteSchema } from '@realpolitik/shared';
import { Router } from 'express';

import { validate } from '../../middleware/validate';

import { crearClienteController } from './clientes.controller';

export const clientesRouter = Router();

clientesRouter.post('/', validate({ body: CreateClienteSchema }), crearClienteController);
