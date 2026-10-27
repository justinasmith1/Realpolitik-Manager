// Endpoints de rendiciones (HU2.5, contrato secciones 4.5 y 4.6). Conoce rutas, cuerpos y el
// formato de error. No produce texto de interfaz: eso lo deciden los componentes.

import {
  ClienteEstado,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
  type CanalEntregaType,
  type ClienteEstadoType,
  type CreateRendicionDto,
  type ListarRendicionesQuery,
  type Rendicion,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';
import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';

/**
 * Rendiciones de un cliente: `['clientes', clienteId, 'rendiciones']`. Cuelga de la key de
 * clientes, como la matriz: invalidar esta key no toca las de otro cliente.
 */
export const rendicionesQueryKey = (clienteId: string) =>
  [...clientesQueryKey, clienteId, 'rendiciones'] as const;

const rutaDeRendicionesDe = (clienteId: string) =>
  `/clientes/${encodeURIComponent(clienteId)}/rendiciones`;

function pedidoJson(method: 'POST' | 'PATCH', cuerpo: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

/**
 * `GET /clientes/:id/rendiciones`, con el avance de cada una. Los filtros `anio` y `mes` son
 * opcionales; sin ellos, todos los períodos. Sin `estado`, el backend lista solo las activas.
 */
export async function listarRendiciones(
  clienteId: string,
  filtros: ListarRendicionesQuery = {},
  signal?: AbortSignal,
): Promise<RendicionResumen[]> {
  const params = new URLSearchParams();
  if (filtros.anio !== undefined) params.set('anio', String(filtros.anio));
  if (filtros.mes !== undefined) params.set('mes', String(filtros.mes));
  if (filtros.estado !== undefined) params.set('estado', filtros.estado);
  const query = params.toString() === '' ? '' : `?${params.toString()}`;
  const response = await http(
    `${rutaDeRendicionesDe(clienteId)}${query}`,
    signal ? { signal } : {},
  );
  return RendicionResumenSchema.array().parse(await response.json());
}

/**
 * `POST /clientes/:id/rendiciones`. Recibe los datos ya validados con `CreateRendicionSchema`
 * (número de factura normalizado). Responde la rendición con su checklist.
 */
export async function abrirRendicion(
  clienteId: string,
  datos: CreateRendicionDto,
): Promise<RendicionDetalle> {
  const response = await http(
    rutaDeRendicionesDe(clienteId),
    pedidoJson('POST', { anio: datos.anio, mes: datos.mes, numeroFactura: datos.numeroFactura }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** `PATCH /rendiciones/:id/estado`: la anula. No es reversible. */
export async function anularRendicion(rendicionId: string): Promise<Rendicion> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/estado`,
    pedidoJson('PATCH', { estado: 'ANULADA' }),
  );
  return RendicionSchema.parse(await response.json());
}

/** La rendición activa que ya tiene esa factura, tal como la informa el `409`. */
export interface RendicionExistente {
  id: string;
  anio: number;
  mes: number;
  numeroFactura: string;
}

/** Por qué no se pudo abrir una rendición, en términos del dominio. */
export type FalloApertura =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'no-existe' }
  | { tipo: 'cliente-no-activo'; estado: ClienteEstadoType | null }
  | { tipo: 'matriz-vacia' }
  | { tipo: 'rendicion-duplicada'; rendicionExistente: RendicionExistente | null }
  | { tipo: 'inesperado' };

/** Por qué no se pudo anular. Una ya anulada no es un error (responde 200). */
export type FalloAnulacion = { tipo: 'no-existe' } | { tipo: 'inesperado' };

function respuestaDeError(error: unknown) {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return null;
  }
  return { status: error.status, cuerpo: leerCuerpoDeError(error.payload) };
}

const esEntero = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor);

function leerRendicionExistente(valor: unknown): RendicionExistente | null {
  if (
    !esObjeto(valor) ||
    typeof valor.id !== 'string' ||
    valor.id === '' ||
    !esEntero(valor.anio) ||
    !esEntero(valor.mes) ||
    typeof valor.numeroFactura !== 'string'
  ) {
    return null;
  }
  return { id: valor.id, anio: valor.anio, mes: valor.mes, numeroFactura: valor.numeroFactura };
}

function leerEstadoCliente(valor: unknown): ClienteEstadoType | null {
  const estado = ClienteEstado.safeParse(valor);
  return estado.success ? estado.data : null;
}

/**
 * Traduce el error de abrir una rendición. Exige status, `code` y, en un 409, el `motivo`: otro
 * conflicto no se confunde con uno conocido. Red caída, 500 o una respuesta que no cumple el
 * schema son `inesperado`.
 */
export function interpretarFalloApertura(error: unknown): FalloApertura {
  const respuesta = respuestaDeError(error);
  if (respuesta === null) {
    return { tipo: 'inesperado' };
  }
  if (respuesta.status === 400 && respuesta.cuerpo?.code === 'VALIDATION_ERROR') {
    return { tipo: 'datos-invalidos', detalles: leerDetallesInvalidos(respuesta.cuerpo.details) };
  }
  if (respuesta.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta.cuerpo?.details;
  if (respuesta.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    switch (details.motivo) {
      case 'CLIENTE_NO_ACTIVO':
        return { tipo: 'cliente-no-activo', estado: leerEstadoCliente(details.estado) };
      case 'MATRIZ_VACIA':
        return { tipo: 'matriz-vacia' };
      case 'RENDICION_DUPLICADA':
        return {
          tipo: 'rendicion-duplicada',
          rendicionExistente: leerRendicionExistente(details.rendicionExistente),
        };
    }
  }
  return { tipo: 'inesperado' };
}

/** Traduce el error de anular una rendición. */
export function interpretarFalloAnulacion(error: unknown): FalloAnulacion {
  const respuesta = respuestaDeError(error);
  return respuesta?.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND'
    ? { tipo: 'no-existe' }
    : { tipo: 'inesperado' };
}

// ─── Detalle de una rendición ─────────────────────────────────────────────────────────────

/** `GET /rendiciones/:id`: la rendición con su checklist, también si está anulada. */
export async function obtenerRendicion(
  rendicionId: string,
  signal?: AbortSignal,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}`,
    signal ? { signal } : {},
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** Un 404 del detalle: la rendición no existe o su cliente fue borrado. */
export function esRendicionInexistente(error: unknown): boolean {
  return respuestaDeError(error)?.status === 404;
}

// ─── Sumar un requisito nuevo a una rendición abierta ─────────────────────────────────────

/** `POST /rendiciones/:id/requisitos/:requisitoId`: responde la rendición con su checklist. */
export async function agregarRequisitoARendicion(
  rendicionId: string,
  requisitoId: string,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/requisitos/${encodeURIComponent(requisitoId)}`,
    { method: 'POST' },
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** Por qué no se pudo sumar un requisito a una rendición, en términos del dominio. */
export type FalloAgregado =
  | { tipo: 'ya-esta' }
  | { tipo: 'rendicion-anulada' }
  | { tipo: 'cliente-no-activo'; estado: ClienteEstadoType | null }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de sumar un requisito. Mismo criterio que `interpretarFalloApertura`. */
export function interpretarFalloAgregado(error: unknown): FalloAgregado {
  const respuesta = respuestaDeError(error);
  if (respuesta === null) {
    return { tipo: 'inesperado' };
  }
  if (respuesta.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta.cuerpo?.details;
  if (respuesta.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    switch (details.motivo) {
      case 'REQUISITO_YA_EN_RENDICION':
        return { tipo: 'ya-esta' };
      case 'RENDICION_ANULADA':
        return { tipo: 'rendicion-anulada' };
      case 'CLIENTE_NO_ACTIVO':
        return { tipo: 'cliente-no-activo', estado: leerEstadoCliente(details.estado) };
    }
  }
  return { tipo: 'inesperado' };
}

// ─── Corregir el canal de un ítem ─────────────────────────────────────────────────────────

/** `PATCH /rendiciones/:id/items/:itemId/canal`: responde la rendición con su checklist. */
export async function corregirCanalDeItem(
  rendicionId: string,
  itemId: string,
  canalEntrega: CanalEntregaType,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/items/${encodeURIComponent(itemId)}/canal`,
    pedidoJson('PATCH', { canalEntrega }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** Por qué no se pudo corregir el canal de un ítem, en términos del dominio. */
export type FalloCorreccionDeCanal =
  { tipo: 'rendicion-anulada' } | { tipo: 'no-existe' } | { tipo: 'inesperado' };

/** Traduce el error de corregir el canal. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloCorreccionDeCanal(error: unknown): FalloCorreccionDeCanal {
  const respuesta = respuestaDeError(error);
  if (respuesta?.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta?.cuerpo?.details;
  if (
    respuesta?.status === 409 &&
    respuesta.cuerpo?.code === 'CONFLICT' &&
    esObjeto(details) &&
    details.motivo === 'RENDICION_ANULADA'
  ) {
    return { tipo: 'rendicion-anulada' };
  }
  return { tipo: 'inesperado' };
}
