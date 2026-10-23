// Endpoints de la matriz de requisitos de un cliente (HU2.2, contrato sección 4.2).
// Conoce rutas, cuerpos y el formato de error. No produce texto de interfaz: eso lo deciden
// los formularios. No aplica los defaults del alta (`cantidad`, días, canal, nota): si el
// front no los manda, los pone el backend.

import {
  ClienteEstado,
  RequisitoClienteSchema,
  type ClienteEstadoType,
  type CreateRequisitoClienteSchema,
  type RequisitoCliente,
  type UpdateRequisitoClienteSchema,
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
 * Datos del alta: el tipo de ENTRADA del schema compartido. Solo `tipoDocumentoId` es
 * obligatorio. Un campo ausente no se rellena acá (el schema de salida ya trae los defaults).
 */
export type NuevoRequisito = (typeof CreateRequisitoClienteSchema)['_input'];

/**
 * Datos de la edición: cualquier subconjunto de `cantidad`, `diasAproximados`, `canalEntrega`
 * y `nota`. Ausente = no modificar. `null` en canal o nota sí se envía.
 */
export type CambiosRequisito = (typeof UpdateRequisitoClienteSchema)['_input'];

/**
 * Matriz de un cliente: `['clientes', clienteId, 'requisitos']`.
 *
 * Cuelga de `clientesQueryKey` para que un alta o una edición de cliente la refresque, pero no
 * de `['clientes', 'lista']` ni de `['clientes', 'detalle']`: invalidar el listado o un detalle
 * no pide todas las matrices, y invalidar esta key no toca la matriz de otro cliente.
 */
export const requisitosQueryKey = (clienteId: string) =>
  [...clientesQueryKey, clienteId, 'requisitos'] as const;

function rutaDeRequisitos(clienteId: string): string {
  return `/clientes/${encodeURIComponent(clienteId)}/requisitos`;
}

function rutaDeRequisito(clienteId: string, requisitoId: string): string {
  return `${rutaDeRequisitos(clienteId)}/${encodeURIComponent(requisitoId)}`;
}

/**
 * Solo los campos del alta. `clienteId` vive en la ruta: aunque llegue en el objeto, no se manda
 * en el cuerpo. Un `undefined` se omite (no se convierte en `null` ni en el default del schema).
 */
function cuerpoDeAlta(datos: NuevoRequisito): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = { tipoDocumentoId: datos.tipoDocumentoId };
  if (datos.cantidad !== undefined) cuerpo.cantidad = datos.cantidad;
  if (datos.diasAproximados !== undefined) cuerpo.diasAproximados = datos.diasAproximados;
  if (datos.canalEntrega !== undefined) cuerpo.canalEntrega = datos.canalEntrega;
  if (datos.nota !== undefined) cuerpo.nota = datos.nota;
  return cuerpo;
}

/**
 * Solo los campos editables. `tipoDocumentoId` no se manda: el tipo no se cambia por este PATCH.
 * Un campo ausente no viaja; `null` sí, porque borra la nota o quita el canal propio.
 */
function cuerpoDeEdicion(datos: CambiosRequisito): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {};
  if (datos.cantidad !== undefined) cuerpo.cantidad = datos.cantidad;
  if (datos.diasAproximados !== undefined) cuerpo.diasAproximados = datos.diasAproximados;
  if (datos.canalEntrega !== undefined) cuerpo.canalEntrega = datos.canalEntrega;
  if (datos.nota !== undefined) cuerpo.nota = datos.nota;
  return cuerpo;
}

function pedidoJson(method: 'POST' | 'PATCH', cuerpo: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

/**
 * `GET /clientes/:id/requisitos`. Devuelve los requisitos activos en el orden de la API
 * (por el nombre del tipo). No se filtran ni se reordenan: un tipo inactivo que ya está en la
 * matriz sigue apareciendo.
 */
export async function listarRequisitos(
  clienteId: string,
  signal?: AbortSignal,
): Promise<RequisitoCliente[]> {
  const response = await http(rutaDeRequisitos(clienteId), signal ? { signal } : {});
  return RequisitoClienteSchema.array().parse(await response.json());
}

/** `POST /clientes/:id/requisitos`. Devuelve el requisito creado, validado con el schema compartido. */
export async function crearRequisito(
  clienteId: string,
  datos: NuevoRequisito,
): Promise<RequisitoCliente> {
  const response = await http(rutaDeRequisitos(clienteId), pedidoJson('POST', cuerpoDeAlta(datos)));
  return RequisitoClienteSchema.parse(await response.json());
}

/** `PATCH /clientes/:id/requisitos/:requisitoId`. Manda solo lo presente en `datos`. */
export async function actualizarRequisito(
  clienteId: string,
  requisitoId: string,
  datos: CambiosRequisito,
): Promise<RequisitoCliente> {
  const response = await http(
    rutaDeRequisito(clienteId, requisitoId),
    pedidoJson('PATCH', cuerpoDeEdicion(datos)),
  );
  return RequisitoClienteSchema.parse(await response.json());
}

/**
 * `DELETE /clientes/:id/requisitos/:requisitoId`. Baja lógica: la API responde 204 sin cuerpo.
 * No es un borrado físico. Un 2xx distinto de 204 no se interpreta como éxito ni se parsea.
 */
export async function eliminarRequisito(clienteId: string, requisitoId: string): Promise<void> {
  const response = await http(rutaDeRequisito(clienteId, requisitoId), { method: 'DELETE' });
  if (response.status !== 204) {
    throw new ApiClientError({
      kind: 'http',
      message: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

/** El requisito activo que ya tiene ese tipo, tal como lo informa el `409`. */
export interface RequisitoExistente {
  id: string;
  tipoDocumentoId: string;
  cantidad: number;
}

type FalloDatosInvalidos = { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] };
type FalloNoExiste = { tipo: 'no-existe' };
type FalloDuplicado = {
  tipo: 'requisito-duplicado';
  requisitoExistente: RequisitoExistente | null;
};
type FalloClienteNoActivo = { tipo: 'cliente-no-activo'; estado: ClienteEstadoType | null };
type FalloInesperado = { tipo: 'inesperado' };

/**
 * Por qué no se pudo crear, editar o dar de baja un requisito, en términos del dominio.
 * El alta puede duplicar; la edición y la baja, no. Un mismo intérprete cubre los tres:
 * un motivo que no corresponde a esa operación queda como `inesperado` si el contrato no lo usa,
 * y si el backend igual lo manda se reconoce igual.
 */
export type FalloRequisito =
  FalloDatosInvalidos | FalloNoExiste | FalloDuplicado | FalloClienteNoActivo | FalloInesperado;

function respuestaDeError(error: unknown) {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return null;
  }
  return { status: error.status, cuerpo: leerCuerpoDeError(error.payload) };
}

function leerRequisitoExistente(valor: unknown): RequisitoExistente | null {
  if (
    !esObjeto(valor) ||
    typeof valor.id !== 'string' ||
    valor.id === '' ||
    typeof valor.tipoDocumentoId !== 'string' ||
    valor.tipoDocumentoId === '' ||
    typeof valor.cantidad !== 'number' ||
    !Number.isInteger(valor.cantidad)
  ) {
    return null;
  }
  return { id: valor.id, tipoDocumentoId: valor.tipoDocumentoId, cantidad: valor.cantidad };
}

function leerEstadoCliente(valor: unknown): ClienteEstadoType | null {
  const estado = ClienteEstado.safeParse(valor);
  return estado.success ? estado.data : null;
}

/**
 * Traduce el error de crear, editar o dar de baja un requisito.
 *
 * Exige status, `code` y, en un 409, el `motivo`: otro conflicto (un motivo nuevo, un proxy)
 * no es un duplicado ni un cliente inactivo. El 404 no dice qué recurso falta (cliente, tipo
 * o requisito) y este intérprete tampoco lo inventa.
 *
 * Red caída, configuración, 500, cuerpo inesperado o una respuesta que no cumple el schema
 * (un `Error` que no es `ApiClientError`) son `inesperado`.
 */
export function interpretarFalloRequisito(error: unknown): FalloRequisito {
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
    if (details.motivo === 'REQUISITO_DUPLICADO') {
      return {
        tipo: 'requisito-duplicado',
        requisitoExistente: leerRequisitoExistente(details.requisitoExistente),
      };
    }
    if (details.motivo === 'CLIENTE_NO_ACTIVO') {
      return { tipo: 'cliente-no-activo', estado: leerEstadoCliente(details.estado) };
    }
  }

  return { tipo: 'inesperado' };
}
