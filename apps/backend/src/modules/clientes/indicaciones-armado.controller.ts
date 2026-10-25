import type { IndicacionesArmadoLecturaDto, IndicacionesArmadoSchema } from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';

import type { ClienteIdParamsSchema } from './clientes.routes';
import {
  guardarIndicacionesArmado,
  obtenerIndicacionesArmado,
} from './indicaciones-armado.service';

type ObtenerIndicacionesArmadoLocals = ValidatedLocals<{ params: typeof ClienteIdParamsSchema }>;
type GuardarIndicacionesArmadoLocals = ValidatedLocals<{
  params: typeof ClienteIdParamsSchema;
  body: typeof IndicacionesArmadoSchema;
}>;

export async function obtenerIndicacionesArmadoController(
  _req: Request,
  res: Response<IndicacionesArmadoLecturaDto, ObtenerIndicacionesArmadoLocals>,
): Promise<void> {
  const { params } = res.locals.validated;
  const resultado = await obtenerIndicacionesArmado(params.id);
  res.status(200).json(resultado);
}

export async function guardarIndicacionesArmadoController(
  _req: Request,
  res: Response<IndicacionesArmadoLecturaDto, GuardarIndicacionesArmadoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const resultado = await guardarIndicacionesArmado(params.id, body);
  res.status(200).json(resultado);
}
