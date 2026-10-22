// Endpoints del catálogo de tipos de documento (HU2.1). Conoce el contrato de la API (rutas,
// cuerpos y formato de error), pero no produce texto de interfaz: eso lo deciden los componentes.

import {
  TipoDocumentoSchema,
  type ActualizarEstadoTipoDocumentoDto,
  type CreateTipoDocumentoSchema,
  type TipoDocumento,
  type UpdateTipoDocumentoSchema,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';

/**
 * Datos que el front envía para crear un tipo: el tipo de ENTRADA del schema compartido
 * (`nombre` y, opcional, `descripcion`). `id`, `activo`, las fechas y la clave normalizada del
 * nombre los fija el servidor.
 */
export type NuevoTipoDocumento = (typeof CreateTipoDocumentoSchema)['_input'];

/**
 * Datos que el front envía para modificar un tipo: `nombre` y/o `descripcion`. Un campo ausente
 * no se modifica; `descripcion: null` la borra.
 */
export type CambiosTipoDocumento = (typeof UpdateTipoDocumentoSchema)['_input'];

/**
 * Prefijo de todas las queries del catálogo. Independiente de `['clientes']`: un cambio en el
 * catálogo no vuelve a pedir clientes, ni al revés.
 */
export const tiposDocumentoQueryKey = ['tipos-documento'] as const;

/** Filtro del listado. Sin `incluirInactivos` (o con `false`), la API devuelve solo los activos. */
export interface FiltrosTiposDocumento {
  incluirInactivos?: boolean | undefined;
}

/**
 * Key del listado. Normaliza el filtro: sin `incluirInactivos` y con `false` es la misma
 * consulta, así que comparten la misma entrada de caché (y un solo pedido).
 */
export const listaTiposDocumentoQueryKey = ({ incluirInactivos }: FiltrosTiposDocumento = {}) =>
  [...tiposDocumentoQueryKey, 'lista', { incluirInactivos: incluirInactivos === true }] as const;

/**
 * `GET /tipos-documento`. Devuelve los tipos activos o, con `incluirInactivos`, todos, validados
 * con el schema compartido. El orden lo resuelve el backend (por el nombre sin mayúsculas ni
 * acentos): no se reordena acá.
 */
export async function listarTiposDocumento(
  { incluirInactivos }: FiltrosTiposDocumento = {},
  signal?: AbortSignal,
): Promise<TipoDocumento[]> {
  const params = new URLSearchParams();
  if (incluirInactivos === true) {
    params.set('incluirInactivos', 'true');
  }
  const query = params.toString();
  const ruta = query === '' ? '/tipos-documento' : `/tipos-documento?${query}`;
  const response = await http(ruta, signal ? { signal } : {});
  return TipoDocumentoSchema.array().parse(await response.json());
}

/**
 * `POST /tipos-documento`. Devuelve el tipo creado, validado con el schema compartido. Si la API
 * responde un error, rechaza con el `ApiClientError` de `http()` sin modificarlo:
 * `interpretarFalloAltaTipoDocumento` lo traduce.
 */
export async function crearTipoDocumento(datos: NuevoTipoDocumento): Promise<TipoDocumento> {
  const response = await http('/tipos-documento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return TipoDocumentoSchema.parse(await response.json());
}

/**
 * `PATCH /tipos-documento/:id`. Envía solo los campos presentes en `datos` (`JSON.stringify`
 * omite los `undefined` y conserva los `null`). Los errores llegan sin modificar:
 * `interpretarFalloEdicionTipoDocumento` los traduce.
 */
export async function actualizarTipoDocumento(
  id: string,
  datos: CambiosTipoDocumento,
): Promise<TipoDocumento> {
  const response = await http(`/tipos-documento/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return TipoDocumentoSchema.parse(await response.json());
}

/**
 * `PATCH /tipos-documento/:id/estado`. Activa o desactiva un tipo: no borra nada ni cambia otros
 * campos. Pedir el estado que ya tiene no es un error. Los errores llegan sin modificar;
 * `interpretarFalloCambioEstadoTipoDocumento` los traduce.
 */
export async function cambiarEstadoTipoDocumento(
  id: string,
  activo: ActualizarEstadoTipoDocumentoDto['activo'],
): Promise<TipoDocumento> {
  const response = await http(`/tipos-documento/${encodeURIComponent(id)}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo }),
  });
  return TipoDocumentoSchema.parse(await response.json());
}

/** El tipo que ya tiene el nombre, tal como lo informa el `409`. */
export interface TipoDocumentoExistente {
  id: string;
  nombre: string;
  activo: boolean;
}

/**
 * Nombre duplicado. `tipoDocumentoExistente` es `null` si el servidor no lo informó con la forma
 * del contrato: el conflicto se puede mostrar igual, sin el detalle.
 */
type FalloNombreDuplicado = {
  tipo: 'nombre-duplicado';
  tipoDocumentoExistente: TipoDocumentoExistente | null;
};
type FalloDatosInvalidos = { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] };
type FalloNoExiste = { tipo: 'no-existe' };
type FalloInesperado = { tipo: 'inesperado' };

/** Por qué no se pudo crear el tipo, en términos del dominio. */
export type FalloAltaTipoDocumento = FalloNombreDuplicado | FalloDatosInvalidos | FalloInesperado;

/** Por qué no se pudo modificar el tipo. Además de lo del alta, el tipo puede ya no existir. */
export type FalloEdicionTipoDocumento =
  FalloNombreDuplicado | FalloDatosInvalidos | FalloNoExiste | FalloInesperado;

/** Por qué no se pudo cambiar el estado del tipo. */
export type FalloCambioEstadoTipoDocumento = FalloNoExiste | FalloInesperado;

/** Status y cuerpo de un error HTTP de la API; `null` si no es una respuesta del servidor. */
function respuestaDeError(error: unknown) {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return null;
  }
  return { status: error.status, cuerpo: leerCuerpoDeError(error.payload) };
}

function leerTipoDocumentoExistente(valor: unknown): TipoDocumentoExistente | null {
  if (
    !esObjeto(valor) ||
    typeof valor.id !== 'string' ||
    valor.id === '' ||
    typeof valor.nombre !== 'string' ||
    typeof valor.activo !== 'boolean'
  ) {
    return null;
  }
  return { id: valor.id, nombre: valor.nombre, activo: valor.activo };
}

// Se exige el status, el `code` Y el `motivo`: otro `409` (un motivo nuevo, un proxy) no es un
// nombre duplicado.
function leerNombreDuplicado(error: unknown): FalloNombreDuplicado | null {
  const respuesta = respuestaDeError(error);
  const details = respuesta?.cuerpo?.details;
  if (
    respuesta?.status !== 409 ||
    respuesta.cuerpo?.code !== 'CONFLICT' ||
    !esObjeto(details) ||
    details.motivo !== 'TIPO_DOCUMENTO_DUPLICADO'
  ) {
    return null;
  }
  return {
    tipo: 'nombre-duplicado',
    tipoDocumentoExistente: leerTipoDocumentoExistente(details.tipoDocumentoExistente),
  };
}

function leerDatosInvalidos(error: unknown): FalloDatosInvalidos | null {
  const respuesta = respuestaDeError(error);
  if (respuesta?.status !== 400 || respuesta.cuerpo?.code !== 'VALIDATION_ERROR') {
    return null;
  }
  return { tipo: 'datos-invalidos', detalles: leerDetallesInvalidos(respuesta.cuerpo.details) };
}

function esNoExiste(error: unknown): boolean {
  const respuesta = respuestaDeError(error);
  return respuesta?.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND';
}

/**
 * Traduce el error de `crearTipoDocumento`. Cualquier cosa que no sea una respuesta reconocible
 * del contrato (red caída, 500, cuerpo inesperado, respuesta que no valida) es `inesperado`.
 */
export function interpretarFalloAltaTipoDocumento(error: unknown): FalloAltaTipoDocumento {
  return leerNombreDuplicado(error) ?? leerDatosInvalidos(error) ?? { tipo: 'inesperado' };
}

/**
 * Traduce el error de `actualizarTipoDocumento`. Un `404` con el formato del contrato es que el
 * tipo ya no existe; lo demás, como en el alta.
 */
export function interpretarFalloEdicionTipoDocumento(error: unknown): FalloEdicionTipoDocumento {
  if (esNoExiste(error)) {
    return { tipo: 'no-existe' };
  }
  return leerNombreDuplicado(error) ?? leerDatosInvalidos(error) ?? { tipo: 'inesperado' };
}

/**
 * Traduce el error de `cambiarEstadoTipoDocumento`. Un `404` con el formato del contrato es que
 * el tipo ya no existe; cualquier otra cosa es `inesperado`.
 */
export function interpretarFalloCambioEstadoTipoDocumento(
  error: unknown,
): FalloCambioEstadoTipoDocumento {
  return esNoExiste(error) ? { tipo: 'no-existe' } : { tipo: 'inesperado' };
}
