import type {
  CreateRequisitoClienteSchema,
  RequisitoCliente,
  UpdateRequisitoClienteSchema,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { ClienteIdParamsSchema, RequisitoParamsSchema } from './clientes.routes';
import {
  actualizarRequisito,
  crearRequisito,
  eliminarRequisito,
  listarRequisitos,
} from './requisitos.service';

type ListarRequisitosLocals = ValidatedLocals<{ params: typeof ClienteIdParamsSchema }>;
type CrearRequisitoLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof CreateRequisitoClienteSchema;
}>;
type ActualizarRequisitoLocals = ValidatedLocals<{
  params: typeof RequisitoParamsSchema;
  body: typeof UpdateRequisitoClienteSchema;
}>;
type EliminarRequisitoLocals = ValidatedLocals<{ params: typeof RequisitoParamsSchema }>;

export async function listarRequisitosController(
  _req: Request,
  res: Response<RequisitoCliente[], ListarRequisitosLocals>,
): Promise<void> {
  const requisitos = await listarRequisitos(res.locals.validated.params.id);
  res.status(200).json(requisitos);
}

export async function crearRequisitoController(
  _req: Request,
  res: Response<RequisitoCliente, CrearRequisitoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const requisito = await crearRequisito(params.id, body);
  res.status(201).json(requisito);
}

export async function actualizarRequisitoController(
  _req: Request,
  res: Response<RequisitoCliente, ActualizarRequisitoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const requisito = await actualizarRequisito(params.id, params.requisitoId, body);
  res.status(200).json(requisito);
}

export async function eliminarRequisitoController(
  _req: Request,
  res: Response<void, EliminarRequisitoLocals>,
): Promise<void> {
  const { params } = res.locals.validated;
  await eliminarRequisito(params.id, params.requisitoId);
  res.status(204).end();
}
