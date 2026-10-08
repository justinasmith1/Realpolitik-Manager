import type { Cliente, CreateClienteSchema } from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import { crearCliente } from './clientes.service';

type CrearClienteLocals = ValidatedLocals<{ body: typeof CreateClienteSchema }>;

export async function crearClienteController(
  _req: Request,
  res: Response<Cliente, CrearClienteLocals>,
): Promise<void> {
  const cliente = await crearCliente(res.locals.validated.body);
  res.status(201).json(cliente);
}
