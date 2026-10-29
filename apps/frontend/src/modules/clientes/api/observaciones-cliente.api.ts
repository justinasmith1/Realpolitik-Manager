// Endpoints de las observaciones internas de un cliente (HU2.10, contrato sección 4.4).
// Conoce rutas, cuerpos y el formato de error. No produce texto de interfaz: eso lo deciden
// los componentes.

import {
  ObservacionesClienteLecturaSchema,
  type ObservacionesClienteDto,
  type ObservacionesClienteLecturaDto,
} from '@realpolitik/shared';

import { leerCuerpoDeError, leerDetallesInvalidos, type DetalleInvalido } from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';
import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';

export const observacionesClienteQueryKey = (clienteId: string) =>
  [...clientesQueryKey, clienteId, 'observaciones'] as const;

function rutaObservaciones(clienteId: string): string {
  return `/clientes/${encodeURIComponent(clienteId)}/observaciones`;
}

/** Consulta las observaciones internas del cliente: `null` si no tiene. */
export async function obtenerObservacionesCliente(
  clienteId: string,
  signal?: AbortSignal,
): Promise<ObservacionesClienteLecturaDto> {
  const response = await http(rutaObservaciones(clienteId), signal ? { signal } : {});
  const json: unknown = await response.json();
  return ObservacionesClienteLecturaSchema.parse(json);
}

/** Guarda la nota del cliente, que reemplaza a la anterior, o la borra con `null`. */
export async function guardarObservacionesCliente(
  clienteId: string,
  datos: ObservacionesClienteDto,
): Promise<ObservacionesClienteLecturaDto> {
  const response = await http(rutaObservaciones(clienteId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const json: unknown = await response.json();
  return ObservacionesClienteLecturaSchema.parse(json);
}

/**
 * Por qué no se guardaron las observaciones. No hay un fallo por estado del cliente: se pueden
 * guardar con el cliente activo, inactivo o suspendido.
 */
export type FalloObservaciones =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce un error al guardar las observaciones a una causa comprensible para los componentes. */
export function interpretarFalloObservaciones(error: unknown): FalloObservaciones {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return { tipo: 'inesperado' };
  }
  const cuerpo = leerCuerpoDeError(error.payload);

  if (error.status === 400 && cuerpo?.code === 'VALIDATION_ERROR') {
    return { tipo: 'datos-invalidos', detalles: leerDetallesInvalidos(cuerpo.details) };
  }
  if (error.status === 404 && cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  return { tipo: 'inesperado' };
}
