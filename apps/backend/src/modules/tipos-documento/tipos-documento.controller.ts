import type {
  ActualizarEstadoTipoDocumentoSchema,
  CreateTipoDocumentoSchema,
  ListarTiposDocumentoQuerySchema,
  TipoDocumento,
  UpdateTipoDocumentoSchema,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { TipoDocumentoIdParamsSchema } from './tipos-documento.routes';
import {
  actualizarTipoDocumento,
  cambiarEstadoTipoDocumento,
  crearTipoDocumento,
  listarTiposDocumento,
} from './tipos-documento.service';

type ListarTiposDocumentoLocals = ValidatedLocals<{
  query: typeof ListarTiposDocumentoQuerySchema;
}>;
type CrearTipoDocumentoLocals = ValidatedLocals<{ body: typeof CreateTipoDocumentoSchema }>;
type ActualizarTipoDocumentoLocals = ValidatedLocals<{
  params: typeof TipoDocumentoIdParamsSchema;
  body: typeof UpdateTipoDocumentoSchema;
}>;
type CambiarEstadoTipoDocumentoLocals = ValidatedLocals<{
  params: typeof TipoDocumentoIdParamsSchema;
  body: typeof ActualizarEstadoTipoDocumentoSchema;
}>;

export async function listarTiposDocumentoController(
  _req: Request,
  res: Response<TipoDocumento[], ListarTiposDocumentoLocals>,
): Promise<void> {
  const tipos = await listarTiposDocumento(res.locals.validated.query);
  res.status(200).json(tipos);
}

export async function crearTipoDocumentoController(
  _req: Request,
  res: Response<TipoDocumento, CrearTipoDocumentoLocals>,
): Promise<void> {
  const tipo = await crearTipoDocumento(res.locals.validated.body);
  res.status(201).json(tipo);
}

export async function actualizarTipoDocumentoController(
  _req: Request,
  res: Response<TipoDocumento, ActualizarTipoDocumentoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const tipo = await actualizarTipoDocumento(params.id, body);
  res.status(200).json(tipo);
}

export async function cambiarEstadoTipoDocumentoController(
  _req: Request,
  res: Response<TipoDocumento, CambiarEstadoTipoDocumentoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const tipo = await cambiarEstadoTipoDocumento(params.id, body.activo);
  res.status(200).json(tipo);
}
