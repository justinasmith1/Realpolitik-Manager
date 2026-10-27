import { Prisma } from '@prisma/client';
import {
  compararItemsDeChecklist,
  esChecklistError,
  FILTRO_ESTADO_POR_DEFECTO,
  generarChecklist,
  type CanalEntregaType,
  type CreateRendicionDto,
  type FiltroEstadoRendiciones,
  type ItemChecklistNuevo,
  type ListarRendicionesQuery,
  type Rendicion,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';

import { conflict, notFound, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

import {
  toRendicionDetalleDto,
  toRendicionDto,
  toRendicionResumenDto,
  type RendicionConItems,
  type ResumenDeAvance,
} from './rendicion.mapper';

/**
 * Rendiciones de un cliente (HU2.5, contrato secciones 4.5 y 4.6).
 *
 * El checklist es una foto de la matriz al abrir la rendición: lo arma `generarChecklist` de
 * `@realpolitik/shared` (la única implementación de esa regla) y después ningún ítem se vuelve
 * a leer de la matriz. El envío por canal no es parte de esta historia.
 */

/** Índice único parcial: un número de factura en una sola rendición activa del cliente. */
const INDICE_FACTURA_ACTIVA = 'uq_rendicion_factura_activa';

/** Tope de reintentos ante una carrera (P2034, o un duplicado cuya fila ya no está). */
const INTENTOS = 3;

const CON_ITEMS = { items: true } satisfies Prisma.RendicionInclude;

/**
 * Los ítems en el orden del checklist (`compararItemsDeChecklist` de shared, el mismo de
 * `generarChecklist`). Se ordena acá y no en la base: la collation de PostgreSQL puede ordenar
 * distinto los acentos y las mayúsculas, y el checklist tiene que verse igual al abrirlo y al
 * consultarlo.
 */
const conItemsEnOrden = (rendicion: RendicionConItems): RendicionConItems => ({
  ...rendicion,
  items: [...rendicion.items].sort(compararItemsDeChecklist),
});

const esErrorConocido = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

/** P2025: el `update` no encontró una fila que cumpla el `where`. */
const esRegistroInexistente = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2025';

/** P2034: la transacción serializable chocó con otra escritura (o un deadlock). */
const esConflictoDeEscritura = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2034';

/**
 * P2002 sobre el índice de la factura. Con un índice creado en SQL, Prisma informa el nombre del
 * índice o sus columnas, según la versión: se aceptan las dos formas. Otro P2002 no es este
 * conflicto y sigue siendo un 500.
 */
function esFacturaDuplicada(error: unknown): boolean {
  if (!esErrorConocido(error) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (typeof target === 'string') return target.includes(INDICE_FACTURA_ACTIVA);
  if (!Array.isArray(target)) return false;
  const campos = target.filter((campo): campo is string => typeof campo === 'string');
  return (
    campos.includes(INDICE_FACTURA_ACTIVA) ||
    (campos.includes('clienteId') && campos.includes('numeroFactura'))
  );
}

function rendicionDuplicada(existente: {
  id: string;
  anio: number;
  mes: number;
  numeroFactura: string;
}): AppError {
  return conflict(
    'RENDICION_DUPLICADA',
    {
      rendicionExistente: {
        id: existente.id,
        anio: existente.anio,
        mes: existente.mes,
        numeroFactura: existente.numeroFactura,
      },
    },
    'Ese número de factura ya está en otra rendición del cliente',
  );
}

/** Un cliente con baja lógica no existe. El estado no importa: un INACTIVO se consulta. */
async function exigirClienteVigente(clienteId: string): Promise<void> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { id: true },
  });
  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }
}

/**
 * Para abrir una rendición el cliente tiene que existir y estar ACTIVO (409 `CLIENTE_NO_ACTIVO`
 * con su estado, como en la matriz). Devuelve el canal por defecto, que completa el de los
 * requisitos sin canal propio. La lectura va dentro de la transacción del alta.
 */
async function exigirClienteActivo(tx: Prisma.TransactionClient, clienteId: string) {
  const cliente = await tx.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { id: true, estado: true, canalEntrega: true },
  });
  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }
  if (cliente.estado !== 'ACTIVO') {
    throw conflict('CLIENTE_NO_ACTIVO', { estado: cliente.estado }, 'El cliente no está activo');
  }
  return cliente;
}

/**
 * Corre `trabajo` en una transacción serializable: así la matriz que se copia es la confirmada
 * cuando la rendición se crea. Un P2034 se reintenta hasta `INTENTOS`. Un error de negocio no se
 * reintenta: se propaga y la transacción se revierte.
 */
async function enTransaccionSerializable<T>(
  trabajo: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let intento = 1; ; intento += 1) {
    try {
      return await prisma.$transaction(trabajo, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!esConflictoDeEscritura(error) || intento >= INTENTOS) {
        throw error;
      }
    }
  }
}

type RequisitoConNombreDeTipo = Prisma.RequisitoClienteGetPayload<{
  include: { tipoDocumento: { select: { nombre: true } } };
}>;

/**
 * Los ítems del checklist, con `generarChecklist`. Una matriz sin requisitos activos es el 409
 * `MATRIZ_VACIA`. Los otros errores (cantidad o días incoherentes) los impiden la base y los
 * schemas: si aparecen, es un error nuestro y siguen siendo un 500.
 */
function itemsDeLaMatriz(
  requisitos: RequisitoConNombreDeTipo[],
  canalDelCliente: CanalEntregaType,
): ItemChecklistNuevo[] {
  try {
    return generarChecklist(
      requisitos.map((requisito) => ({
        id: requisito.id,
        tipoDocumentoId: requisito.tipoDocumentoId,
        nombreTipoDocumento: requisito.tipoDocumento.nombre,
        cantidad: requisito.cantidad,
        diasAproximados: requisito.diasAproximados,
        canalEntrega: requisito.canalEntrega,
        isDeleted: requisito.isDeleted,
      })),
      { canalEntrega: canalDelCliente },
    );
  } catch (error) {
    if (esChecklistError(error) && error.codigo === 'MATRIZ_VACIA') {
      throw conflict('MATRIZ_VACIA', {}, 'El cliente no tiene requisitos activos');
    }
    throw error;
  }
}

async function insertarRendicion(
  tx: Prisma.TransactionClient,
  clienteId: string,
  input: CreateRendicionDto,
): Promise<RendicionDetalle> {
  const cliente = await exigirClienteActivo(tx, clienteId);

  const requisitos = await tx.requisitoCliente.findMany({
    where: { clienteId, isDeleted: false },
    include: { tipoDocumento: { select: { nombre: true } } },
  });
  const items = itemsDeLaMatriz(requisitos, cliente.canalEntrega);

  const creada = await tx.rendicion.create({
    data: {
      clienteId,
      anio: input.anio,
      mes: input.mes,
      numeroFactura: input.numeroFactura,
      items: { createMany: { data: items } },
    },
    include: CON_ITEMS,
  });
  return toRendicionDetalleDto(conItemsEnOrden(creada));
}

/**
 * Abre una rendición y genera su checklist con todos los requisitos activos (contrato 4.5).
 *
 * No consulta antes si la factura ya está en otra rendición activa: dos altas simultáneas
 * pasarían esa consulta. Se inserta y, si el índice parcial rechaza la fila, se responde 409 con
 * la rendición que la tiene. Si esa fila ya no está (la anularon en el medio), se reintenta.
 */
export async function abrirRendicion(
  clienteId: string,
  input: CreateRendicionDto,
): Promise<RendicionDetalle> {
  for (let intento = 1; ; intento += 1) {
    try {
      return await enTransaccionSerializable((tx) => insertarRendicion(tx, clienteId, input));
    } catch (error) {
      if (!esFacturaDuplicada(error) && !esConflictoDeEscritura(error)) {
        throw error;
      }
      const existente = await prisma.rendicion.findFirst({
        where: { clienteId, numeroFactura: input.numeroFactura, isDeleted: false },
        select: { id: true, anio: true, mes: true, numeroFactura: true },
      });
      if (existente !== null) {
        throw rendicionDuplicada(existente);
      }
      // Un P2034 ya se reintentó dentro de la transacción. Sin fila confirmada no es un duplicado.
      if (esConflictoDeEscritura(error) || intento >= INTENTOS) {
        throw error;
      }
    }
  }
}

/** Cada filtro de estado como baja lógica: anulada es `isDeleted`. `TODAS` no filtra. */
const BAJA_SEGUN_ESTADO: Record<FiltroEstadoRendiciones, boolean | undefined> = {
  ACTIVA: false,
  ANULADA: true,
  TODAS: undefined,
};

/**
 * Rendiciones del cliente, con el avance de su checklist (contrato 4.5). Sin `estado`, solo las
 * activas. Orden: año y mes descendentes y, dentro del mismo mes, la más reciente primero; con
 * `TODAS`, primero las activas y después las anuladas, cada grupo con ese orden.
 */
export async function listarRendiciones(
  clienteId: string,
  { anio, mes, estado = FILTRO_ESTADO_POR_DEFECTO }: ListarRendicionesQuery,
): Promise<RendicionResumen[]> {
  await exigirClienteVigente(clienteId);

  const isDeleted = BAJA_SEGUN_ESTADO[estado];
  const filas = await prisma.rendicion.findMany({
    where: {
      clienteId,
      ...(isDeleted !== undefined && { isDeleted }),
      ...(anio !== undefined && { anio }),
      ...(mes !== undefined && { mes }),
    },
    orderBy: [
      // Solo con `TODAS`: `false` antes que `true`, las activas primero.
      ...(isDeleted === undefined ? [{ isDeleted: 'asc' as const }] : []),
      { anio: 'desc' },
      { mes: 'desc' },
      { createdAt: 'desc' },
    ],
  });
  if (filas.length === 0) {
    return [];
  }

  // Un solo conteo para todas: cuántos ítems hay de cada rendición, separados por completado.
  const conteos = await prisma.itemChecklist.groupBy({
    by: ['rendicionId', 'completado'],
    where: { rendicionId: { in: filas.map((fila) => fila.id) } },
    _count: { _all: true },
  });
  const resumenes = new Map<string, ResumenDeAvance>();
  for (const { rendicionId, completado, _count } of conteos) {
    const resumen = resumenes.get(rendicionId) ?? { totalItems: 0, completados: 0 };
    resumen.totalItems += _count._all;
    if (completado) resumen.completados += _count._all;
    resumenes.set(rendicionId, resumen);
  }

  return filas.map((fila) =>
    toRendicionResumenDto(fila, resumenes.get(fila.id) ?? { totalItems: 0, completados: 0 }),
  );
}

/**
 * Una rendición con su checklist. También una anulada (con `estado: ANULADA`): su detalle se
 * conserva como historial. De un cliente borrado, no existe.
 */
export async function obtenerRendicion(id: string): Promise<RendicionDetalle> {
  const rendicion = await prisma.rendicion.findFirst({
    where: { id, cliente: { isDeleted: false } },
    include: CON_ITEMS,
  });
  if (rendicion === null) {
    throw notFound('Rendición no encontrada');
  }
  return toRendicionDetalleDto(conItemsEnOrden(rendicion));
}

/**
 * Anula una rendición (contrato 4.6): baja lógica, no reversible. No borra la rendición ni sus
 * ítems. Se puede anular con el cliente en cualquier estado: es la corrección de un error.
 *
 * Idempotente: una ya anulada se devuelve tal cual, SIN escribir (`anuladaEn` no cambia). El
 * `update` solo toca una fila activa; si no matchea (otro pedido la anuló en el medio), se lee
 * y se devuelve como quedó.
 */
export async function anularRendicion(id: string): Promise<Rendicion> {
  const rendicion = await prisma.rendicion.findFirst({
    where: { id, cliente: { isDeleted: false } },
  });
  if (rendicion === null) {
    throw notFound('Rendición no encontrada');
  }
  if (rendicion.isDeleted) {
    return toRendicionDto(rendicion);
  }

  try {
    const anulada = await prisma.rendicion.update({
      where: { id, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    return toRendicionDto(anulada);
  } catch (error) {
    if (!esRegistroInexistente(error)) {
      throw error;
    }
    const actual = await prisma.rendicion.findFirst({ where: { id } });
    if (actual === null) {
      throw notFound('Rendición no encontrada');
    }
    return toRendicionDto(actual);
  }
}

// ─── Sumar un requisito nuevo a una rendición abierta (contrato 4.5) ─────────────────────

/** Índice único de `ItemChecklist`: un ítem por rendición, requisito y ordinal. */
const esItemDuplicado = (error: unknown): boolean => {
  if (!esErrorConocido(error) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const campos = Array.isArray(target)
    ? target.filter((campo): campo is string => typeof campo === 'string')
    : typeof target === 'string'
      ? [target]
      : [];
  return campos.some((campo) => campo.includes('requisitoClienteId'));
};

const requisitoYaEnRendicion = (): AppError =>
  conflict('REQUISITO_YA_EN_RENDICION', {}, 'La rendición ya tiene ítems de ese tipo de documento');

async function insertarItemsDeRequisito(
  tx: Prisma.TransactionClient,
  rendicionId: string,
  requisitoId: string,
): Promise<RendicionDetalle> {
  const rendicion = await tx.rendicion.findFirst({
    where: { id: rendicionId, cliente: { isDeleted: false } },
    select: {
      id: true,
      clienteId: true,
      isDeleted: true,
      cliente: { select: { estado: true, canalEntrega: true } },
    },
  });
  if (rendicion === null) {
    throw notFound('Rendición no encontrada');
  }
  if (rendicion.isDeleted) {
    throw conflict('RENDICION_ANULADA', {}, 'La rendición está anulada');
  }
  if (rendicion.cliente.estado !== 'ACTIVO') {
    throw conflict(
      'CLIENTE_NO_ACTIVO',
      { estado: rendicion.cliente.estado },
      'El cliente no está activo',
    );
  }

  // Un requisito de otro cliente o dado de baja no existe para esta rendición.
  const requisito = await tx.requisitoCliente.findFirst({
    where: { id: requisitoId, clienteId: rendicion.clienteId, isDeleted: false },
    include: { tipoDocumento: { select: { nombre: true } } },
  });
  if (requisito === null) {
    throw notFound('Requisito no encontrado');
  }

  // Se compara por tipo de documento, no por requisito: uno dado de baja y vuelto a crear tiene
  // otro id, pero es el mismo documento.
  const yaEsta = await tx.itemChecklist.findFirst({
    where: { rendicionId, tipoDocumentoId: requisito.tipoDocumentoId },
    select: { id: true },
  });
  if (yaEsta !== null) {
    throw requisitoYaEnRendicion();
  }

  // Misma regla que al abrir: `generarChecklist` con una matriz de un solo requisito. Los ítems
  // que la rendición ya tenía no se tocan.
  const items = itemsDeLaMatriz([requisito], rendicion.cliente.canalEntrega);
  await tx.itemChecklist.createMany({
    data: items.map((item) => ({ ...item, rendicionId })),
  });

  const actualizada = await tx.rendicion.findUniqueOrThrow({
    where: { id: rendicionId },
    include: CON_ITEMS,
  });
  return toRendicionDetalleDto(conItemsEnOrden(actualizada));
}

/**
 * Suma a una rendición activa los ítems de un requisito nuevo de la matriz del cliente
 * (contrato 4.5). Es una acción explícita de la operadora, nunca automática.
 *
 * En una transacción serializable: dos pedidos simultáneos del mismo requisito no pueden sumar
 * dos veces. Si chocan, el reintento ve los ítems confirmados y responde 409; si la base rechaza
 * el ítem repetido (índice único de rendición, requisito y ordinal), también es ese 409.
 */
export async function agregarRequisitoARendicion(
  rendicionId: string,
  requisitoId: string,
): Promise<RendicionDetalle> {
  try {
    return await enTransaccionSerializable((tx) =>
      insertarItemsDeRequisito(tx, rendicionId, requisitoId),
    );
  } catch (error) {
    if (esItemDuplicado(error)) {
      throw requisitoYaEnRendicion();
    }
    throw error;
  }
}

/**
 * Corrige el canal de un ítem del checklist (contrato 4.5). Es la única parte del snapshot que se
 * puede corregir: si el requisito tenía un canal equivocado al abrir la rendición, el ítem quedó
 * con ese canal. Solo en una rendición activa (anulada: `409 RENDICION_ANULADA`); no toca el
 * requisito del cliente ni otras rendiciones. Con el mismo canal responde sin escribir.
 */
export async function corregirCanalDeItem(
  rendicionId: string,
  itemId: string,
  canalEntrega: CanalEntregaType,
): Promise<RendicionDetalle> {
  return enTransaccionSerializable(async (tx) => {
    const rendicion = await tx.rendicion.findFirst({
      where: { id: rendicionId, cliente: { isDeleted: false } },
      select: { id: true, isDeleted: true },
    });
    if (rendicion === null) {
      throw notFound('Rendición no encontrada');
    }
    if (rendicion.isDeleted) {
      throw conflict('RENDICION_ANULADA', {}, 'La rendición está anulada');
    }

    // Un ítem de otra rendición no existe para esta.
    const item = await tx.itemChecklist.findFirst({
      where: { id: itemId, rendicionId },
      select: { id: true, canalEntrega: true },
    });
    if (item === null) {
      throw notFound('Ítem no encontrado');
    }
    if (item.canalEntrega !== canalEntrega) {
      await tx.itemChecklist.update({ where: { id: item.id }, data: { canalEntrega } });
    }

    const actualizada = await tx.rendicion.findUniqueOrThrow({
      where: { id: rendicionId },
      include: CON_ITEMS,
    });
    return toRendicionDetalleDto(conItemsEnOrden(actualizada));
  });
}
