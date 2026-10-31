import { Prisma } from '@prisma/client';
import {
  canalDeSeleccion,
  compararItemsDeChecklist,
  esChecklistError,
  FILTRO_ESTADO_POR_DEFECTO,
  generarChecklist,
  motivoNoEnviable,
  PreparacionEnvioSchema,
  UltimaOcSchema,
  type ActualizarRendicionDto,
  type CanalEntregaType,
  type CreateRendicionDto,
  type EmisorType,
  type FiltroEstadoRendiciones,
  type ItemChecklistNuevo,
  type ListarRendicionesQuery,
  type PreparacionEnvio,
  type Rendicion,
  type RendicionDetalle,
  type RendicionResumen,
  type ResultadoPropagarCanal,
  type UltimaOc,
} from '@realpolitik/shared';

import { conflict, notFound, validationError, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

import {
  APLICACION_VIGENTE,
  toItemChecklistDto,
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

/**
 * Los dos índices únicos parciales de la factura (HU2.9), ambos sobre las rendiciones activas:
 * `(emisor, numeroFactura)` entre las que tienen emisor, de cualquier cliente, y
 * `(clienteId, numeroFactura)` entre las que no (las anteriores a HU2.9).
 */
const INDICE_FACTURA_POR_EMISOR = 'uq_rendicion_emisor_factura_activa';
const INDICE_FACTURA_SIN_EMISOR = 'uq_rendicion_factura_activa_sin_emisor';

/** Tope de reintentos ante una carrera (P2034, o un duplicado cuya fila ya no está). */
const INTENTOS = 3;

/** Los ítems, cada uno con su documento vigente (HU2.8). */
const CON_ITEMS = {
  items: { include: { aplicaciones: APLICACION_VIGENTE } },
} satisfies Prisma.RendicionInclude;

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

/** SQLSTATE de PostgreSQL: falla de serialización y deadlock. */
const CONFLICTOS_DE_POSTGRES: readonly unknown[] = ['40001', '40P01'];

/**
 * La transacción serializable chocó con otra escritura (o un deadlock). Prisma lo informa como
 * P2034, salvo en una consulta en SQL (`$queryRaw`, p. ej. un `FOR SHARE`): ahí es P2010 con el
 * SQLSTATE en `meta.code`. Es el mismo choque y se reintenta igual.
 */
const esConflictoDeEscritura = (error: unknown): boolean =>
  esErrorConocido(error) &&
  (error.code === 'P2034' ||
    (error.code === 'P2010' && CONFLICTOS_DE_POSTGRES.includes(error.meta?.code)));

/**
 * P2002 sobre alguno de los dos índices de la factura. Con índices creados en SQL, Prisma no los
 * declara: verificado contra PostgreSQL, informa en `meta.target` las COLUMNAS del índice
 * (`['emisor', 'numeroFactura']` o `['clienteId', 'numeroFactura']`), también dentro de una
 * transacción serializable. Se aceptan además los nombres de los índices, por si otra versión de
 * Prisma informa el índice en lugar de las columnas. Otro P2002 no es este conflicto y sigue
 * siendo un 500.
 */
export function esFacturaDuplicada(error: unknown): boolean {
  if (!esErrorConocido(error) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const nombres = [INDICE_FACTURA_POR_EMISOR, INDICE_FACTURA_SIN_EMISOR];
  if (typeof target === 'string') return nombres.some((nombre) => target.includes(nombre));
  if (!Array.isArray(target)) return false;
  const campos = target.filter((campo): campo is string => typeof campo === 'string');
  return (
    nombres.some((nombre) => campos.includes(nombre)) ||
    (campos.includes('numeroFactura') &&
      (campos.includes('emisor') || campos.includes('clienteId')))
  );
}

function rendicionDuplicada(existente: {
  id: string;
  clienteId: string;
  anio: number;
  mes: number;
  numeroFactura: string;
}): AppError {
  return conflict(
    'RENDICION_DUPLICADA',
    {
      // El `clienteId` lleva a la existente aunque sea de otro cliente: el número es único por
      // emisor en todo el sistema.
      rendicionExistente: {
        id: existente.id,
        clienteId: existente.clienteId,
        anio: existente.anio,
        mes: existente.mes,
        numeroFactura: existente.numeroFactura,
      },
    },
    'Ese número de factura ya existe para este emisor',
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
 * requisitos sin canal propio, y el emisor habitual. La lectura va dentro de la transacción del
 * alta.
 */
async function exigirClienteActivo(tx: Prisma.TransactionClient, clienteId: string) {
  const cliente = await tx.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { id: true, estado: true, canalEntrega: true, emisor: true },
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
 * El emisor de la factura (HU2.9): el del pedido o, si no vino, el habitual del cliente. Es una
 * foto: se copia a la rendición y después no se vuelve a leer del cliente. Sin ninguno de los dos
 * no se puede abrir: la numeración es por emisor.
 */
function emisorDeLaRendicion(
  pedido: EmisorType | undefined,
  habitualDelCliente: EmisorType | null,
): EmisorType {
  const emisor = pedido ?? habitualDelCliente;
  if (emisor === null) {
    throw validationError([
      {
        campo: 'emisor',
        mensaje: 'Elegí el emisor de la factura: el cliente no tiene uno asignado.',
      },
    ]);
  }
  return emisor;
}

/**
 * Corre `trabajo` en una transacción serializable: así la matriz que se copia es la confirmada
 * cuando la rendición se crea. Un P2034 se reintenta hasta `INTENTOS`. Un error de negocio no se
 * reintenta: se propaga y la transacción se revierte.
 */
export async function enTransaccionSerializable<T>(
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
  alResolverEmisor: (emisor: EmisorType) => void,
): Promise<RendicionDetalle> {
  const cliente = await exigirClienteActivo(tx, clienteId);
  const emisor = emisorDeLaRendicion(input.emisor, cliente.emisor);
  alResolverEmisor(emisor);

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
      emisor,
      ...(input.numeroOc !== undefined && { numeroOc: input.numeroOc }),
      ...(input.montoMensual !== undefined && { montoMensual: input.montoMensual }),
      ...(input.montoTotal !== undefined && { montoTotal: input.montoTotal }),
      items: { createMany: { data: items } },
    },
    include: CON_ITEMS,
  });
  return toRendicionDetalleDto(conItemsEnOrden(creada));
}

/**
 * Abre una rendición y genera su checklist con todos los requisitos activos (contrato 4.5).
 *
 * El emisor es el del pedido o, si no vino, el del cliente (HU2.9). El número de factura no se
 * repite para el mismo emisor entre las rendiciones activas, aunque sean de clientes distintos.
 *
 * No consulta antes si la factura ya está en otra rendición activa: dos altas simultáneas
 * pasarían esa consulta. Se inserta y, si un índice parcial rechaza la fila, se responde 409 con
 * la rendición que la tiene (de este cliente o de otro). Si esa fila ya no está (la anularon en
 * el medio), se reintenta.
 */
export async function abrirRendicion(
  clienteId: string,
  input: CreateRendicionDto,
): Promise<RendicionDetalle> {
  // El emisor se resuelve dentro de la transacción (con el cliente que ve esa lectura); se guarda
  // acá para buscar la rendición que tiene la factura si el alta choca.
  let emisor: EmisorType | undefined;
  for (let intento = 1; ; intento += 1) {
    emisor = undefined;
    try {
      return await enTransaccionSerializable((tx) =>
        insertarRendicion(tx, clienteId, input, (resuelto) => {
          emisor = resuelto;
        }),
      );
    } catch (error) {
      if (!esFacturaDuplicada(error) && !esConflictoDeEscritura(error)) {
        throw error;
      }
      // Sin emisor resuelto el alta ni llegó a insertar: no puede haber un duplicado que buscar.
      if (emisor === undefined) {
        throw error;
      }
      // Una alta siempre lleva emisor, así que solo puede chocar con el índice por emisor:
      // (emisor, número) entre las activas, de cualquier cliente. No se busca entre las heredadas
      // sin emisor (la regla vieja, por cliente): una del mismo cliente llevaría a la rendición
      // equivocada, y con una heredada la alta no choca (no comparten índice).
      const existente = await prisma.rendicion.findFirst({
        where: { isDeleted: false, numeroFactura: input.numeroFactura, emisor },
        select: { id: true, clienteId: true, anio: true, mes: true, numeroFactura: true },
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
 * activas. Con `requisitoId`, solo las que tienen ítems de ese requisito. Orden: año y mes
 * descendentes y, dentro del mismo mes, la más reciente primero; con `TODAS`, primero las activas
 * y después las anuladas, cada grupo con ese orden.
 */
export async function listarRendiciones(
  clienteId: string,
  { anio, mes, estado = FILTRO_ESTADO_POR_DEFECTO, requisitoId }: ListarRendicionesQuery,
): Promise<RendicionResumen[]> {
  await exigirClienteVigente(clienteId);

  const isDeleted = BAJA_SEGUN_ESTADO[estado];
  const filas = await prisma.rendicion.findMany({
    where: {
      clienteId,
      ...(isDeleted !== undefined && { isDeleted }),
      ...(anio !== undefined && { anio }),
      ...(mes !== undefined && { mes }),
      ...(requisitoId !== undefined && {
        items: { some: { requisitoClienteId: requisitoId } },
      }),
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
 * Edita los datos de la OC de una rendición (HU2.11): `PATCH /rendiciones/:id`. Un campo ausente no
 * se toca y `null` lo borra. Solo en una rendición activa (anulada: `409 RENDICION_ANULADA`, es
 * historial). El período no se pide: es el de la rendición. El número de OC no es único: se repite
 * entre meses, entre facturas y entre clientes. Una sola escritura, en transacción serializable
 * junto con el chequeo de anulada.
 */
export async function actualizarRendicion(
  id: string,
  datos: ActualizarRendicionDto,
): Promise<RendicionDetalle> {
  return enTransaccionSerializable(async (tx) => {
    const rendicion = await tx.rendicion.findFirst({
      where: { id, cliente: { isDeleted: false } },
      select: { id: true, isDeleted: true },
    });
    if (rendicion === null) {
      throw notFound('Rendición no encontrada');
    }
    if (rendicion.isDeleted) {
      throw conflict('RENDICION_ANULADA', {}, 'La rendición está anulada');
    }

    const actualizada = await tx.rendicion.update({
      where: { id },
      data: {
        ...(datos.numeroOc !== undefined && { numeroOc: datos.numeroOc }),
        ...(datos.montoMensual !== undefined && { montoMensual: datos.montoMensual }),
        ...(datos.montoTotal !== undefined && { montoTotal: datos.montoTotal }),
      },
      include: CON_ITEMS,
    });
    return toRendicionDetalleDto(conItemsEnOrden(actualizada));
  });
}

/**
 * La OC de la rendición activa más reciente del cliente que tenga número de OC (HU2.11): sirve de
 * sugerencia al cargar la de este mes. Más reciente = período (año y mes) y, dentro del mismo mes,
 * la última creada, como el listado. `null` si ninguna tiene OC.
 */
export async function obtenerUltimaOc(clienteId: string): Promise<UltimaOc> {
  await exigirClienteVigente(clienteId);
  const ultima = await prisma.rendicion.findFirst({
    where: { clienteId, isDeleted: false, numeroOc: { not: null } },
    orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }],
    select: { numeroOc: true, montoMensual: true, montoTotal: true },
  });
  if (ultima === null || ultima.numeroOc === null) {
    return null;
  }
  return UltimaOcSchema.parse({
    numeroOc: ultima.numeroOc,
    montoMensual: ultima.montoMensual?.toNumber() ?? null,
    montoTotal: ultima.montoTotal?.toNumber() ?? null,
  });
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

// ─── Propagar el canal de un requisito a rendiciones abiertas (contrato 4.5) ─────────────

/**
 * Pasa los ítems de un requisito al canal efectivo actual del requisito (el propio o, si hereda,
 * el del cliente) en las rendiciones elegidas (ADR-0003). Es una acción explícita de la operadora
 * después de editar el canal del requisito, nunca automática.
 *
 * Todo o nada, en una transacción serializable: cada rendición tiene que ser del cliente (si no,
 * 404), estar activa (409 `RENDICION_ANULADA`) y tener ítems del requisito (409
 * `REQUISITO_NO_EN_RENDICION`); si una no cumple, no se cambia ninguna. Los conflictos llevan el
 * `rendicionId` de la primera que no cumple, en el orden pedido. Solo cambia el canal de esos
 * ítems: el resto del snapshot y los otros ítems no se tocan. Como la corrección de un ítem, se
 * permite aunque el cliente esté inactivo.
 */
export async function propagarCanalDeRequisito(
  clienteId: string,
  requisitoId: string,
  rendicionIds: readonly string[],
): Promise<ResultadoPropagarCanal> {
  return enTransaccionSerializable(async (tx) => {
    const cliente = await tx.cliente.findFirst({
      where: { id: clienteId, isDeleted: false },
      select: { canalEntrega: true },
    });
    if (cliente === null) {
      throw notFound('Cliente no encontrado');
    }
    const requisito = await tx.requisitoCliente.findFirst({
      where: { id: requisitoId, clienteId, isDeleted: false },
      select: { canalEntrega: true },
    });
    if (requisito === null) {
      throw notFound('Requisito no encontrado');
    }
    // El mismo canal efectivo que copia `generarChecklist` al abrir una rendición.
    const canalEntrega = requisito.canalEntrega ?? cliente.canalEntrega;

    // Una rendición de otro cliente no existe para este.
    const rendiciones = await tx.rendicion.findMany({
      where: { id: { in: [...rendicionIds] }, clienteId },
      select: { id: true, isDeleted: true },
    });
    const porId = new Map(rendiciones.map((rendicion) => [rendicion.id, rendicion]));
    if (rendicionIds.some((id) => !porId.has(id))) {
      throw notFound('Rendición no encontrada');
    }
    const anulada = rendicionIds.find((id) => porId.get(id)?.isDeleted === true);
    if (anulada !== undefined) {
      throw conflict('RENDICION_ANULADA', { rendicionId: anulada }, 'La rendición está anulada');
    }
    const conItems = await tx.itemChecklist.groupBy({
      by: ['rendicionId'],
      where: { rendicionId: { in: [...rendicionIds] }, requisitoClienteId: requisitoId },
    });
    const conElRequisito = new Set(conItems.map((fila) => fila.rendicionId));
    const sinElRequisito = rendicionIds.find((id) => !conElRequisito.has(id));
    if (sinElRequisito !== undefined) {
      throw conflict(
        'REQUISITO_NO_EN_RENDICION',
        { rendicionId: sinElRequisito },
        'La rendición no tiene ítems de ese requisito',
      );
    }

    // Solo los ítems con otro canal: los que ya lo tienen no se reescriben.
    const resultados: ResultadoPropagarCanal['rendiciones'] = [];
    for (const rendicionId of rendicionIds) {
      const { count } = await tx.itemChecklist.updateMany({
        where: {
          rendicionId,
          requisitoClienteId: requisitoId,
          canalEntrega: { not: canalEntrega },
        },
        data: { canalEntrega },
      });
      resultados.push({ rendicionId, itemsActualizados: count });
    }
    return { canalEntrega, rendiciones: resultados };
  });
}

// ─── Preparar el envío (HU2.5 con HU2.8) ──────────────────────────────────────────────────

/**
 * Comprueba que los ítems elegidos se pueden enviar y devuelve sus datos (contrato 4.5). No envía
 * nada ni guarda nada: el envío lo hace la operadora por el canal. Valida con los datos de ahora,
 * no con lo que mostraba la pantalla: un pedido armado a mano no puede incluir un ítem que no se
 * puede enviar.
 *
 * - La rendición tiene que existir (si no, o si su cliente se borró, 404) y estar activa (409
 *   `RENDICION_ANULADA`).
 * - Cada ítem tiene que ser de esta rendición (si no, 404), estar completado (409
 *   `ITEM_PENDIENTE`) y tener una aplicación documental vigente (409
 *   `ITEM_SIN_DOCUMENTO_VIGENTE`): no alcanza con `completado`. El 409 lleva el `itemId` del
 *   primero que no cumple, en el orden pedido. La regla es `motivoNoEnviable` de shared, la misma
 *   que usa el checklist.
 * - Como en HU2.5, un envío va por un solo canal (409 `CANALES_DISTINTOS`, con los canales).
 *
 * Se lee en una transacción de solo lectura con una foto consistente (REPEATABLE READ): la
 * rendición, los ítems y sus aplicaciones vigentes son del mismo momento.
 */
export async function prepararEnvio(
  rendicionId: string,
  itemIds: readonly string[],
): Promise<PreparacionEnvio> {
  return prisma.$transaction(
    async (tx) => {
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
      const filas = await tx.itemChecklist.findMany({
        where: { id: { in: [...itemIds] }, rendicionId },
        include: { aplicaciones: APLICACION_VIGENTE },
      });
      const porId = new Map(filas.map((fila) => [fila.id, toItemChecklistDto(fila)]));
      const items = itemIds.map((id) => porId.get(id));
      if (items.some((item) => item === undefined)) {
        throw notFound('Ítem no encontrado');
      }

      const elegidos = items.filter((item) => item !== undefined);
      for (const item of elegidos) {
        const motivo = motivoNoEnviable(item);
        if (motivo !== null) {
          throw conflict(
            motivo,
            { itemId: item.id },
            motivo === 'ITEM_PENDIENTE'
              ? 'El ítem todavía no tiene un documento'
              : 'El ítem no tiene un documento vigente',
          );
        }
      }
      const canal = canalDeSeleccion(elegidos);
      if (canal.tipo !== 'un-canal') {
        throw conflict(
          'CANALES_DISTINTOS',
          { canales: canal.tipo === 'mezclados' ? canal.canales : [] },
          'Los ítems se envían por canales distintos',
        );
      }

      return PreparacionEnvioSchema.parse({
        rendicionId,
        canal: canal.canal,
        items: [...elegidos].sort(compararItemsDeChecklist),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
