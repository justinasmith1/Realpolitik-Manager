// Endpoints de rendiciones (HU2.5, contrato secciones 4.5 y 4.6). Conoce rutas, cuerpos y el
// formato de error. No produce texto de interfaz: eso lo deciden los componentes.

import {
  ClienteEstado,
  MotivoNoEnviable,
  PreparacionEnvioSchema,
  RendicionAtrasadaSchema,
  RendicionDelMesSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
  ResultadoPropagarCanalSchema,
  UltimaOcSchema,
  type CanalEntregaType,
  type ActualizarEstadoRendicionDto,
  type ActualizarRendicionDto,
  type ClienteEstadoType,
  type CreateRendicionDto,
  type ListarRendicionesQuery,
  type MotivoNoEnviableType,
  type PreparacionEnvio,
  type RegistrarCobroDto,
  type Rendicion,
  type RendicionAtrasada,
  type RendicionDelMes,
  type RendicionDetalle,
  type RendicionResumen,
  type ResultadoPropagarCanal,
  type UltimaOc,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';

const rutaDeRendicionesDe = (clienteId: string) =>
  `/clientes/${encodeURIComponent(clienteId)}/rendiciones`;

function pedidoJson(
  method: 'POST' | 'PATCH' | 'PUT',
  cuerpo: Record<string, unknown>,
): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}

/**
 * `GET /clientes/:id/rendiciones`, con el avance de cada una. Los filtros `anio` y `mes` son
 * opcionales; sin ellos, todos los períodos. Sin `vigencia`, el backend lista solo las activas. Con
 * `estado` (HU3.1), solo las que están en ese paso. Con `requisitoId`, solo las que tienen ítems de
 * ese requisito.
 */
export async function listarRendiciones(
  clienteId: string,
  filtros: ListarRendicionesQuery = {},
  signal?: AbortSignal,
): Promise<RendicionResumen[]> {
  const params = new URLSearchParams();
  if (filtros.anio !== undefined) params.set('anio', String(filtros.anio));
  if (filtros.mes !== undefined) params.set('mes', String(filtros.mes));
  if (filtros.vigencia !== undefined) params.set('vigencia', filtros.vigencia);
  if (filtros.estado !== undefined) params.set('estado', filtros.estado);
  if (filtros.requisitoId !== undefined) params.set('requisitoId', filtros.requisitoId);
  const query = params.toString() === '' ? '' : `?${params.toString()}`;
  const response = await http(
    `${rutaDeRendicionesDe(clienteId)}${query}`,
    signal ? { signal } : {},
  );
  return RendicionResumenSchema.array().parse(await response.json());
}

/**
 * Las rendiciones activas de todos los clientes en un mes (pantalla Rendiciones, HU3.2), ya en el
 * orden de la pantalla (su key: `rendicionesKeys.delMes`). `GET /rendiciones?anio=&mes=`.
 */
export async function listarRendicionesDelMes(
  periodo: { anio: number; mes: number },
  signal?: AbortSignal,
): Promise<RendicionDelMes[]> {
  const query = new URLSearchParams({ anio: String(periodo.anio), mes: String(periodo.mes) });
  const response = await http(`/rendiciones?${query.toString()}`, signal ? { signal } : {});
  return RendicionDelMesSchema.array().parse(await response.json());
}

/** `GET /rendiciones/atrasadas`: de la más vieja a la más nueva, con su período. */
export async function listarRendicionesAtrasadas(
  signal?: AbortSignal,
): Promise<RendicionAtrasada[]> {
  const response = await http('/rendiciones/atrasadas', signal ? { signal } : {});
  return RendicionAtrasadaSchema.array().parse(await response.json());
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
    pedidoJson('POST', {
      anio: datos.anio,
      mes: datos.mes,
      numeroFactura: datos.numeroFactura,
      ...(datos.emisor === undefined ? {} : { emisor: datos.emisor }),
    }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** `PATCH /rendiciones/:id/vigencia`: la anula. No es reversible. */
export async function anularRendicion(rendicionId: string): Promise<Rendicion> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/vigencia`,
    pedidoJson('PATCH', { vigencia: 'ANULADA' }),
  );
  return RendicionSchema.parse(await response.json());
}

/**
 * La rendición activa que ya tiene esa factura para ese emisor, tal como la informa el `409`. Puede
 * ser de OTRO cliente: `clienteId` es el de la existente y arma el enlace a su detalle.
 */
export interface RendicionExistente {
  id: string;
  clienteId: string;
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
    typeof valor.clienteId !== 'string' ||
    valor.clienteId === '' ||
    !esEntero(valor.anio) ||
    !esEntero(valor.mes) ||
    typeof valor.numeroFactura !== 'string'
  ) {
    return null;
  }
  return {
    id: valor.id,
    clienteId: valor.clienteId,
    anio: valor.anio,
    mes: valor.mes,
    numeroFactura: valor.numeroFactura,
  };
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
  | { tipo: 'rendicion-enviada' }
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
      case 'RENDICION_ENVIADA':
        return { tipo: 'rendicion-enviada' };
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
  | { tipo: 'rendicion-anulada' }
  | { tipo: 'rendicion-enviada' }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de corregir el canal. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloCorreccionDeCanal(error: unknown): FalloCorreccionDeCanal {
  const respuesta = respuestaDeError(error);
  if (respuesta?.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta?.cuerpo?.details;
  if (respuesta?.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    if (details.motivo === 'RENDICION_ANULADA') return { tipo: 'rendicion-anulada' };
    if (details.motivo === 'RENDICION_ENVIADA') return { tipo: 'rendicion-enviada' };
  }
  return { tipo: 'inesperado' };
}

// ─── Propagar el canal de un requisito a rendiciones abiertas ─────────────────────────────

/**
 * `POST /clientes/:id/requisitos/:requisitoId/propagar-canal`: todo o nada. Responde el canal
 * aplicado y cuántos ítems cambiaron en cada rendición.
 */
export async function propagarCanalDeRequisito(
  clienteId: string,
  requisitoId: string,
  rendicionIds: readonly string[],
): Promise<ResultadoPropagarCanal> {
  const response = await http(
    `/clientes/${encodeURIComponent(clienteId)}/requisitos/${encodeURIComponent(requisitoId)}/propagar-canal`,
    pedidoJson('POST', { rendicionIds }),
  );
  return ResultadoPropagarCanalSchema.parse(await response.json());
}

/**
 * Por qué no se propagó el canal. Los conflictos nombran la rendición que no cumple (o `null` si
 * el servidor no la informó). Como es todo o nada, ninguna rendición cambió.
 */
export type FalloPropagacion =
  | { tipo: 'rendicion-anulada'; rendicionId: string | null }
  | { tipo: 'rendicion-enviada'; rendicionId: string | null }
  | { tipo: 'requisito-no-en-rendicion'; rendicionId: string | null }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de propagar el canal. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloPropagacion(error: unknown): FalloPropagacion {
  const respuesta = respuestaDeError(error);
  if (respuesta === null) {
    return { tipo: 'inesperado' };
  }
  if (respuesta.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta.cuerpo?.details;
  if (respuesta.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    const rendicionId =
      typeof details.rendicionId === 'string' && details.rendicionId !== ''
        ? details.rendicionId
        : null;
    switch (details.motivo) {
      case 'RENDICION_ANULADA':
        return { tipo: 'rendicion-anulada', rendicionId };
      case 'RENDICION_ENVIADA':
        return { tipo: 'rendicion-enviada', rendicionId };
      case 'REQUISITO_NO_EN_RENDICION':
        return { tipo: 'requisito-no-en-rendicion', rendicionId };
    }
  }
  return { tipo: 'inesperado' };
}

// ─── Preparar el envío (HU2.5 con HU2.8) ──────────────────────────────────────────────────

/**
 * `POST /rendiciones/:id/preparar-envio`: el servidor comprueba, con los datos de ahora, que los
 * ítems se pueden enviar (completados y con documento vigente, por un solo canal) y devuelve sus
 * datos. No envía ni guarda nada.
 */
export async function prepararEnvio(
  rendicionId: string,
  itemIds: readonly string[],
): Promise<PreparacionEnvio> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/preparar-envio`,
    pedidoJson('POST', { itemIds }),
  );
  return PreparacionEnvioSchema.parse(await response.json());
}

/**
 * Por qué no se pudo preparar el envío. Los conflictos significan que algo cambió entre la
 * selección y el envío: hay que volver a mirar la rendición.
 */
export type FalloPreparacionEnvio =
  | { tipo: 'rendicion-anulada' }
  | { tipo: 'item-no-enviable'; motivo: MotivoNoEnviableType; itemId: string | null }
  | { tipo: 'canales-distintos' }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de preparar el envío. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloPreparacionEnvio(error: unknown): FalloPreparacionEnvio {
  const respuesta = respuestaDeError(error);
  if (respuesta === null) {
    return { tipo: 'inesperado' };
  }
  if (respuesta.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta.cuerpo?.details;
  if (respuesta.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    if (details.motivo === 'RENDICION_ANULADA') return { tipo: 'rendicion-anulada' };
    if (details.motivo === 'CANALES_DISTINTOS') return { tipo: 'canales-distintos' };
    const motivo = MotivoNoEnviable.safeParse(details.motivo);
    if (motivo.success) {
      const itemId =
        typeof details.itemId === 'string' && details.itemId !== '' ? details.itemId : null;
      return { tipo: 'item-no-enviable', motivo: motivo.data, itemId };
    }
  }
  return { tipo: 'inesperado' };
}

// ─── Estado de la rendición (HU3.6) ───────────────────────────────────────────────────────

/** `PATCH /rendiciones/:id/estado`: marca la rendición como completa o la vuelve a en curso. */
export async function cambiarEstadoDeRendicion(
  rendicionId: string,
  datos: ActualizarEstadoRendicionDto,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/estado`,
    pedidoJson('PATCH', { ...datos }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/**
 * Por qué no se pudo cambiar el estado. `faltantes` es la cantidad que informa el servidor en un
 * `ITEMS_PENDIENTES` (`null` si no vino o no es un entero válido).
 */
export type FalloCambioDeEstado =
  | { tipo: 'items-pendientes'; faltantes: number | null }
  /** La fecha de envío no vale (HU3.7): el mensaje del servidor, si vino. */
  | { tipo: 'fecha-invalida'; mensaje: string | null }
  /** El motivo del rechazo no vale (HU3.8): el mensaje del servidor, si vino. */
  | { tipo: 'motivo-invalido'; mensaje: string | null }
  | { tipo: 'rendicion-anulada' }
  | { tipo: 'transicion-invalida' }
  /** Rechazar una rendición con un cobro registrado (HU3.10): hay que quitar antes la marca. */
  | { tipo: 'cobro-registrado' }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de cambiar el estado. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloCambioDeEstado(error: unknown): FalloCambioDeEstado {
  const respuesta = respuestaDeError(error);
  if (respuesta === null) {
    return { tipo: 'inesperado' };
  }
  if (respuesta.status === 400 && respuesta.cuerpo?.code === 'VALIDATION_ERROR') {
    const fecha = leerDetallesInvalidos(respuesta.cuerpo.details).find(
      (detalle) => detalle.campo === 'fechaEnvio',
    );
    if (fecha !== undefined) return { tipo: 'fecha-invalida', mensaje: fecha.mensaje };
    const motivo = leerDetallesInvalidos(respuesta.cuerpo.details).find(
      (detalle) => detalle.campo === 'motivo',
    );
    if (motivo !== undefined) return { tipo: 'motivo-invalido', mensaje: motivo.mensaje };
  }
  if (respuesta.status === 404 && respuesta.cuerpo?.code === 'NOT_FOUND') {
    return { tipo: 'no-existe' };
  }
  const details = respuesta.cuerpo?.details;
  if (respuesta.status === 409 && respuesta.cuerpo?.code === 'CONFLICT' && esObjeto(details)) {
    switch (details.motivo) {
      case 'ITEMS_PENDIENTES':
        return {
          tipo: 'items-pendientes',
          faltantes:
            esEntero(details.faltantes) && details.faltantes >= 0 ? details.faltantes : null,
        };
      case 'RENDICION_ANULADA':
        return { tipo: 'rendicion-anulada' };
      case 'TRANSICION_INVALIDA':
        return { tipo: 'transicion-invalida' };
      case 'COBRO_REGISTRADO':
        return { tipo: 'cobro-registrado' };
    }
  }
  return { tipo: 'inesperado' };
}

// ─── Orden de compra (HU2.11) ─────────────────────────────────────────────────────────────

/** `PATCH /rendiciones/:id`: edita los datos de la OC (`null` borra un dato). */
export async function actualizarOcDeRendicion(
  rendicionId: string,
  datos: ActualizarRendicionDto,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}`,
    pedidoJson('PATCH', { ...datos }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/**
 * `GET /clientes/:id/ultima-oc`: la OC de la última rendición del cliente que tenga una, o `null`
 * si ninguna la tiene.
 */
export async function obtenerUltimaOc(clienteId: string, signal?: AbortSignal): Promise<UltimaOc> {
  const response = await http(
    `/clientes/${encodeURIComponent(clienteId)}/ultima-oc`,
    signal ? { signal } : {},
  );
  return UltimaOcSchema.parse(await response.json());
}

/** Por qué no se pudo guardar la OC, en términos del dominio. */
export type FalloActualizacionOc =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'rendicion-anulada' }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de guardar la OC. Mismo criterio que `interpretarFalloAgregado`. */
export function interpretarFalloActualizacionOc(error: unknown): FalloActualizacionOc {
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
  if (
    respuesta.status === 409 &&
    respuesta.cuerpo?.code === 'CONFLICT' &&
    esObjeto(details) &&
    details.motivo === 'RENDICION_ANULADA'
  ) {
    return { tipo: 'rendicion-anulada' };
  }
  return { tipo: 'inesperado' };
}

// ─── Cobro informado por el cliente (HU3.10) ──────────────────────────────────────────────

/** `PUT /rendiciones/:id/cobro`: registra o corrige el cobro (reemplaza el cobro entero). */
export async function registrarCobro(
  rendicionId: string,
  datos: RegistrarCobroDto,
): Promise<RendicionDetalle> {
  const response = await http(
    `/rendiciones/${encodeURIComponent(rendicionId)}/cobro`,
    pedidoJson('PUT', { ...datos }),
  );
  return RendicionDetalleSchema.parse(await response.json());
}

/** `DELETE /rendiciones/:id/cobro`: quita la marca de cobrada. */
export async function quitarCobro(rendicionId: string): Promise<RendicionDetalle> {
  const response = await http(`/rendiciones/${encodeURIComponent(rendicionId)}/cobro`, {
    method: 'DELETE',
  });
  return RendicionDetalleSchema.parse(await response.json());
}

/** Por qué no se pudo registrar o quitar el cobro, en términos del dominio. */
export type FalloCobro =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'rendicion-anulada' }
  /** La rendición ya no está Enviada ni Aprobada (otra persona la cambió). */
  | { tipo: 'estado-invalido' }
  | { tipo: 'no-existe' }
  | { tipo: 'inesperado' };

/** Traduce el error de registrar o quitar el cobro. Mismo criterio que `interpretarFalloActualizacionOc`. */
export function interpretarFalloCobro(error: unknown): FalloCobro {
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
    if (details.motivo === 'RENDICION_ANULADA') return { tipo: 'rendicion-anulada' };
    if (details.motivo === 'COBRO_ESTADO_INVALIDO') return { tipo: 'estado-invalido' };
  }
  return { tipo: 'inesperado' };
}
