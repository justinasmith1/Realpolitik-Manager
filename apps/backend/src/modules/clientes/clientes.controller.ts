import type {
  ActualizarEstadoClienteSchema,
  Cliente,
  CreateClienteSchema,
  ListarClientesQuerySchema,
  UpdateClienteSchema,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { ClienteIdParamsSchema } from './clientes.routes';
import {
  actualizarCliente,
  cambiarEstadoCliente,
  crearCliente,
  listarClientes,
} from './clientes.service';

type CrearClienteLocals = ValidatedLocals<{ body: typeof CreateClienteSchema }>;
type ActualizarClienteLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof UpdateClienteSchema;
}>;
type CambiarEstadoClienteLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof ActualizarEstadoClienteSchema;
}>;
type ListarClientesLocals = ValidatedLocals<{ query: typeof ListarClientesQuerySchema }>;

export async function crearClienteController(
  _req: Request,
  res: Response<Cliente, CrearClienteLocals>,
): Promise<void> {
  const cliente = await crearCliente(res.locals.validated.body);
  res.status(201).json(cliente);
}

export async function actualizarClienteController(
  _req: Request,
  res: Response<Cliente, ActualizarClienteLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const cliente = await actualizarCliente(params.id, body);
  res.status(200).json(cliente);
}

export async function cambiarEstadoClienteController(
  _req: Request,
  res: Response<Cliente, CambiarEstadoClienteLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const cliente = await cambiarEstadoCliente(params.id, body.estado);
  res.status(200).json(cliente);
}

export async function listarClientesController(
  _req: Request,
  res: Response<Cliente[], ListarClientesLocals>,
): Promise<void> {
  const clientes = await listarClientes(res.locals.validated.query);
  res.status(200).json(clientes);
}
