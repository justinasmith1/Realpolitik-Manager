import type {
  ObservacionesClienteLecturaDto,
  ObservacionesClienteSchema,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { ClienteIdParamsSchema } from './clientes.routes';
import { guardarObservaciones, obtenerObservaciones } from './observaciones.service';

type ObtenerObservacionesLocals = ValidatedLocals<{ params: typeof ClienteIdParamsSchema }>;
type GuardarObservacionesLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof ObservacionesClienteSchema;
}>;

export async function obtenerObservacionesController(
  _req: Request,
  res: Response<ObservacionesClienteLecturaDto, ObtenerObservacionesLocals>,
): Promise<void> {
  const { params } = res.locals.validated;
  const resultado = await obtenerObservaciones(params.id);
  res.status(200).json(resultado);
}

export async function guardarObservacionesController(
  _req: Request,
  res: Response<ObservacionesClienteLecturaDto, GuardarObservacionesLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const resultado = await guardarObservaciones(params.id, body);
  res.status(200).json(resultado);
}
