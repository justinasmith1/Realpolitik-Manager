import type { Cliente, CreateClienteSchema, ListarClientesQuerySchema } from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import { crearCliente, listarClientes } from './clientes.service';

type CrearClienteLocals = ValidatedLocals<{ body: typeof CreateClienteSchema }>;
type ListarClientesLocals = ValidatedLocals<{ query: typeof ListarClientesQuerySchema }>;

export async function crearClienteController(
  _req: Request,
  res: Response<Cliente, CrearClienteLocals>,
): Promise<void> {
  const cliente = await crearCliente(res.locals.validated.body);
  res.status(201).json(cliente);
}

export async function listarClientesController(
  _req: Request,
  res: Response<Cliente[], ListarClientesLocals>,
): Promise<void> {
  const clientes = await listarClientes(res.locals.validated.query);
  res.status(200).json(clientes);
}
