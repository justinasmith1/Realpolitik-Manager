// Endpoints de clientes. Conoce el contrato de la API (rutas, cuerpos y formato de error),
// pero no produce texto de interfaz: eso lo deciden los componentes.

import {
  ClienteEstado,
  ClienteSchema,
  type Cliente,
  type ClienteEstadoType,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
  type CreateClienteSchema,
} from '@realpolitik/shared';

import { ApiClientError, http } from '@/lib/http';

/**
 * Datos que el front envía para registrar un cliente: el tipo de ENTRADA del schema
 * compartido (el de salida tiene el CUIT ya normalizado y defaults aplicados).
 */
export type NuevoCliente = (typeof CreateClienteSchema)['_input'];

/** Prefijo de todas las queries de clientes. Un alta lo invalida: el listado se vuelve a pedir. */
export const clientesQueryKey = ['clientes'] as const;

/** Filtros del listado. Lo que está ausente no filtra. */
export interface FiltrosClientes {
  q?: string | undefined;
  sector?: ClienteSectorType | undefined;
  subtipo?: ClienteSubtipoPublicoType | undefined;
}

/**
 * `GET /clientes`. Devuelve los clientes activos que cumplen los filtros, ordenados por
 * razón social (lo resuelve el backend), validados con el schema compartido.
 */
export async function listarClientes(
  filtros: FiltrosClientes = {},
  signal?: AbortSignal,
): Promise<Cliente[]> {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (typeof valor === 'string' && valor !== '') {
      params.set(clave, valor);
    }
  }
  const query = params.toString();
  const ruta = query === '' ? '/clientes' : `/clientes?${query}`;
  const response = await http(ruta, signal ? { signal } : {});
  return ClienteSchema.array().parse(await response.json());
}

/**
 * Código técnico, sin datos personales, para mostrar a soporte cuando falla la carga.
 */
export function diagnosticoDeError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return 'ERROR_INESPERADO';
  }
  switch (error.kind) {
    case 'network':
      return 'NETWORK_ERROR';
    case 'configuration':
      return 'CONFIG_ERROR';
    case 'http':
      return `HTTP_${error.status ?? 'ERROR'}`;
  }
}

/**
 * `POST /clientes`. Devuelve el cliente creado, validado con el schema compartido.
 * Si la API responde un error, rechaza con el `ApiClientError` de `http()` sin modificarlo:
 * `interpretarFalloAlta` lo traduce a algo que la interfaz pueda mostrar.
 */
export async function crearCliente(datos: NuevoCliente): Promise<Cliente> {
  const response = await http('/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return ClienteSchema.parse(await response.json());
}

export interface ClienteExistente {
  id: string;
  razonSocial: string;
  estado: ClienteEstadoType;
}

/** Por qué no se pudo registrar el cliente, en términos del dominio. */
export type FalloAltaCliente =
  | { tipo: 'cuit-duplicado'; clienteExistente: ClienteExistente | null }
  | { tipo: 'datos-invalidos'; campos: string[] }
  | { tipo: 'inesperado' };

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** `{ error: { code, details } }` del contrato, o `null` si el cuerpo no tiene esa forma. */
function leerCuerpoDeError(payload: unknown): { code: unknown; details: unknown } | null {
  if (!esObjeto(payload) || !esObjeto(payload.error)) {
    return null;
  }
  return { code: payload.error.code, details: payload.error.details };
}

function leerClienteExistente(valor: unknown): ClienteExistente | null {
  if (!esObjeto(valor) || typeof valor.id !== 'string' || typeof valor.razonSocial !== 'string') {
    return null;
  }
  const estado = ClienteEstado.safeParse(valor.estado);
  return estado.success
    ? { id: valor.id, razonSocial: valor.razonSocial, estado: estado.data }
    : null;
}

function leerCamposInvalidos(details: unknown): string[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((detalle) =>
    esObjeto(detalle) && typeof detalle.campo === 'string' ? [detalle.campo] : [],
  );
}

/**
 * Traduce el error de `crearCliente`. Cualquier cosa que no sea una respuesta reconocible
 * del contrato (red caída, 500, cuerpo inesperado, respuesta inválida) es `inesperado`.
 */
export function interpretarFalloAlta(error: unknown): FalloAltaCliente {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return { tipo: 'inesperado' };
  }
  const cuerpo = leerCuerpoDeError(error.payload);

  if (
    error.status === 409 &&
    cuerpo?.code === 'CONFLICT' &&
    esObjeto(cuerpo.details) &&
    cuerpo.details.motivo === 'CUIT_DUPLICADO'
  ) {
    return {
      tipo: 'cuit-duplicado',
      clienteExistente: leerClienteExistente(cuerpo.details.clienteExistente),
    };
  }

  if (error.status === 400 && cuerpo?.code === 'VALIDATION_ERROR') {
    return { tipo: 'datos-invalidos', campos: leerCamposInvalidos(cuerpo.details) };
  }

  return { tipo: 'inesperado' };
}
