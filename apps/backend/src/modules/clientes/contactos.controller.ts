import type { Contacto, CreateContactoSchema, UpdateContactoSchema } from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';
import {
  actualizarContacto,
  crearContacto,
  eliminarContacto,
  listarContactos,
} from './contactos.service';

type CrearContactoLocals = ValidatedLocals<{ body: typeof CreateContactoSchema }>;
type ActualizarContactoLocals = ValidatedLocals<{ body: typeof UpdateContactoSchema }>;

export async function listarContactosController(
  req: Request<{ id: string }>,
  res: Response<Contacto[]>,
): Promise<void> {
  const contactos = await listarContactos(req.params.id);
  res.status(200).json(contactos);
}

export async function crearContactoController(
  req: Request<{ id: string }>,
  res: Response<Contacto, CrearContactoLocals>,
): Promise<void> {
  const contacto = await crearContacto(req.params.id, res.locals.validated.body);
  res.status(201).json(contacto);
}

export async function actualizarContactoController(
  req: Request<{ id: string; contactoId: string }>,
  res: Response<Contacto, ActualizarContactoLocals>,
): Promise<void> {
  const contacto = await actualizarContacto(
    req.params.id,
    req.params.contactoId,
    res.locals.validated.body,
  );
  res.status(200).json(contacto);
}

export async function eliminarContactoController(
  req: Request<{ id: string; contactoId: string }>,
  res: Response<void>,
): Promise<void> {
  await eliminarContacto(req.params.id, req.params.contactoId);
  res.status(204).end();
}
