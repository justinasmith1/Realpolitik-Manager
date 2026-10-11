import type {
  Contacto,
  CreateContactoSchema,
  ReemplazarContactosSchema,
  UpdateContactoSchema,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { ClienteIdParamsSchema, ContactoParamsSchema } from './clientes.routes';
import {
  actualizarContacto,
  crearContacto,
  eliminarContacto,
  listarContactos,
  reemplazarContactos,
} from './contactos.service';

type ListarContactosLocals = ValidatedLocals<{ params: typeof ClienteIdParamsSchema }>;
type CrearContactoLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof CreateContactoSchema;
}>;
type ReemplazarContactosLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof ReemplazarContactosSchema;
}>;
type ActualizarContactoLocals = ValidatedLocals<{
  params: typeof ContactoParamsSchema;
  body: typeof UpdateContactoSchema;
}>;
type EliminarContactoLocals = ValidatedLocals<{ params: typeof ContactoParamsSchema }>;

export async function listarContactosController(
  _req: Request,
  res: Response<Contacto[], ListarContactosLocals>,
): Promise<void> {
  const contactos = await listarContactos(res.locals.validated.params.id);
  res.status(200).json(contactos);
}

export async function crearContactoController(
  _req: Request,
  res: Response<Contacto, CrearContactoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const contacto = await crearContacto(params.id, body);
  res.status(201).json(contacto);
}

export async function reemplazarContactosController(
  _req: Request,
  res: Response<Contacto[], ReemplazarContactosLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const contactos = await reemplazarContactos(params.id, body);
  res.status(200).json(contactos);
}

export async function actualizarContactoController(
  _req: Request,
  res: Response<Contacto, ActualizarContactoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const contacto = await actualizarContacto(params.id, params.contactoId, body);
  res.status(200).json(contacto);
}

export async function eliminarContactoController(
  _req: Request,
  res: Response<void, EliminarContactoLocals>,
): Promise<void> {
  const { params } = res.locals.validated;
  await eliminarContacto(params.id, params.contactoId);
  res.status(204).end();
}
