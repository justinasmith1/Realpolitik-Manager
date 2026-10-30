import type {
  ActualizarCanalDeItemSchema,
  ActualizarEstadoRendicionSchema,
  ActualizarRendicionSchema,
  CreateRendicionSchema,
  ListarRendicionesQuerySchema,
  PreparacionEnvio,
  PrepararEnvioSchema,
  PropagarCanalDeRequisitoSchema,
  Rendicion,
  RendicionDetalle,
  RendicionResumen,
  ResultadoPropagarCanal,
  UltimaOc,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import type { ValidatedLocals } from '../../middleware/validate';
import type { RequisitoParamsSchema } from '../clientes/clientes.routes';

import type {
  IdParamsSchema,
  ItemDeRendicionParamsSchema,
  RequisitoDeRendicionParamsSchema,
} from './rendiciones.routes';
import {
  abrirRendicion,
  actualizarRendicion,
  agregarRequisitoARendicion,
  anularRendicion,
  corregirCanalDeItem,
  listarRendiciones,
  obtenerRendicion,
  obtenerUltimaOc,
  prepararEnvio,
  propagarCanalDeRequisito,
} from './rendiciones.service';

type AbrirRendicionLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  body: typeof CreateRendicionSchema;
}>;
type ListarRendicionesLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  query: typeof ListarRendicionesQuerySchema;
}>;
type ObtenerRendicionLocals = ValidatedLocals<{ params: typeof IdParamsSchema }>;
type AnularRendicionLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  body: typeof ActualizarEstadoRendicionSchema;
}>;

export async function abrirRendicionController(
  _req: Request,
  res: Response<RendicionDetalle, AbrirRendicionLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const rendicion = await abrirRendicion(params.id, body);
  res.status(201).json(rendicion);
}

export async function listarRendicionesController(
  _req: Request,
  res: Response<RendicionResumen[], ListarRendicionesLocals>,
): Promise<void> {
  const { params, query } = res.locals.validated;
  const rendiciones = await listarRendiciones(params.id, query);
  res.status(200).json(rendiciones);
}

export async function obtenerRendicionController(
  _req: Request,
  res: Response<RendicionDetalle, ObtenerRendicionLocals>,
): Promise<void> {
  const rendicion = await obtenerRendicion(res.locals.validated.params.id);
  res.status(200).json(rendicion);
}

export async function anularRendicionController(
  _req: Request,
  res: Response<Rendicion, AnularRendicionLocals>,
): Promise<void> {
  const rendicion = await anularRendicion(res.locals.validated.params.id);
  res.status(200).json(rendicion);
}

type ActualizarRendicionLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  body: typeof ActualizarRendicionSchema;
}>;

export async function actualizarRendicionController(
  _req: Request,
  res: Response<RendicionDetalle, ActualizarRendicionLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const rendicion = await actualizarRendicion(params.id, body);
  res.status(200).json(rendicion);
}

export async function obtenerUltimaOcController(
  _req: Request,
  res: Response<UltimaOc, ObtenerRendicionLocals>,
): Promise<void> {
  const ultimaOc = await obtenerUltimaOc(res.locals.validated.params.id);
  res.status(200).json(ultimaOc);
}

type AgregarRequisitoLocals = ValidatedLocals<{ params: typeof RequisitoDeRendicionParamsSchema }>;

export async function agregarRequisitoARendicionController(
  _req: Request,
  res: Response<RendicionDetalle, AgregarRequisitoLocals>,
): Promise<void> {
  const { id, requisitoId } = res.locals.validated.params;
  const rendicion = await agregarRequisitoARendicion(id, requisitoId);
  res.status(200).json(rendicion);
}

type CorregirCanalDeItemLocals = ValidatedLocals<{
  params: typeof ItemDeRendicionParamsSchema;
  body: typeof ActualizarCanalDeItemSchema;
}>;

export async function corregirCanalDeItemController(
  _req: Request,
  res: Response<RendicionDetalle, CorregirCanalDeItemLocals>,
): Promise<void> {
  const { id, itemId } = res.locals.validated.params;
  const rendicion = await corregirCanalDeItem(id, itemId, res.locals.validated.body.canalEntrega);
  res.status(200).json(rendicion);
}

type PropagarCanalLocals = ValidatedLocals<{
  params: typeof RequisitoParamsSchema;
  body: typeof PropagarCanalDeRequisitoSchema;
}>;

export async function propagarCanalDeRequisitoController(
  _req: Request,
  res: Response<ResultadoPropagarCanal, PropagarCanalLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  const resultado = await propagarCanalDeRequisito(
    params.id,
    params.requisitoId,
    body.rendicionIds,
  );
  res.status(200).json(resultado);
}

type PrepararEnvioLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  body: typeof PrepararEnvioSchema;
}>;

export async function prepararEnvioController(
  _req: Request,
  res: Response<PreparacionEnvio, PrepararEnvioLocals>,
): Promise<void> {
  const preparacion = await prepararEnvio(
    res.locals.validated.params.id,
    res.locals.validated.body.itemIds,
  );
  res.status(200).json(preparacion);
}
