// Endpoints de indicaciones de armado de un cliente (HU2.4, contrato sección 4.4).
// Conoce rutas, cuerpos y el formato de error. No produce texto de interfaz: eso lo deciden
// los componentes.

import {
  ClienteEstado,
  IndicacionesArmadoLecturaSchema,
  type ClienteEstadoType,
  type IndicacionesArmadoDto,
  type IndicacionesArmadoLecturaDto,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';
import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';

export const indicacionesArmadoQueryKey = (clienteId: string) =>
  [...clientesQueryKey, clienteId, 'indicaciones-armado'] as const;

function rutaIndicaciones(clienteId: string): string {
  return `/clientes/${encodeURIComponent(clienteId)}/indicaciones-armado`;
}

/**
 * Consulta las indicaciones de armado del cliente.
 */
export async function obtenerIndicacionesArmado(
  clienteId: string,
  signal?: AbortSignal,
): Promise<IndicacionesArmadoLecturaDto> {
  const response = await http(rutaIndicaciones(clienteId), signal ? { signal } : {});
  const json: unknown = await response.json();
  return IndicacionesArmadoLecturaSchema.parse(json);
}

/**
 * Guarda o borra las indicaciones de armado del cliente.
 */
export async function guardarIndicacionesArmado(
  clienteId: string,
  datos: IndicacionesArmadoDto,
): Promise<IndicacionesArmadoLecturaDto> {
  const response = await http(rutaIndicaciones(clienteId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const json: unknown = await response.json();
  return IndicacionesArmadoLecturaSchema.parse(json);
}

/** Diagnóstico discriminado de un fallo al guardar las indicaciones de armado. */
export type FalloIndicaciones =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'no-existe' }
  | { tipo: 'cliente-no-activo'; estado: ClienteEstadoType | null }
  | { tipo: 'inesperado' };

function respuestaDeError(error: unknown) {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return null;
  }
  return { status: error.status, cuerpo: leerCuerpoDeError(error.payload) };
}

function leerEstadoCliente(valor: unknown): ClienteEstadoType | null {
  const estado = ClienteEstado.safeParse(valor);
  return estado.success ? estado.data : null;
}

/**
 * Traduce un error al guardar indicaciones a una causa comprensible para los componentes.
 */
export function interpretarFalloIndicaciones(error: unknown): FalloIndicaciones {
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
    if (details.motivo === 'CLIENTE_NO_ACTIVO') {
      return { tipo: 'cliente-no-activo', estado: leerEstadoCliente(details.estado) };
    }
  }

  return { tipo: 'inesperado' };
}
