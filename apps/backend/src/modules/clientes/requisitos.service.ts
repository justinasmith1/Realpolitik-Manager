import { Prisma } from '@prisma/client';
import {
  problemaDeDias,
  type CargaMasivaRequisitoDto,
  type CreateRequisitoClienteDto,
  type RequisitoCliente,
  type ResultadoCargaMasiva,
  type UpdateRequisitoClienteDto,
} from '@realpolitik/shared';

import { conflict, notFound, validationError, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

import { toRequisitoClienteDto, type RequisitoClienteConTipo } from './requisito.mapper';

/**
 * Matriz de requisitos de un cliente (HU2.2, contrato sección 4.2).
 *
 * La factura no se agrega sola: es un requisito más, si la operadora lo carga. `matrizConfigurada`
 * significa "hay al menos un requisito activo", no "hay una factura".
 *
 * Canal propio: se guarda tal cual (`null` = el del cliente). No se cruza con `portalUrl` ni con
 * `whatsappNumero`. El contrato lo deja pendiente (sección 4.8) y esta historia no inventa esa regla.
 *
 * Ninguna operación lee ni escribe `Rendicion` ni `ItemChecklist`.
 */

const CON_TIPO = { tipoDocumento: true } satisfies Prisma.RequisitoClienteInclude;

const ORDEN_POR_TIPO = {
  tipoDocumento: { nombreNormalizado: 'asc' },
} satisfies Prisma.RequisitoClienteOrderByWithRelationInput;

/** Índice único parcial: un solo requisito activo por cliente y tipo. */
const INDICE_REQUISITO_ACTIVO = 'uq_requisito_cliente_tipo_activo';

/**
 * Tope de reintentos ante una carrera (P2034, o un duplicado cuya fila desapareció antes de
 * poder informar cuál es). El mismo número que en tipos de documento y en el cambio de estado.
 */
const INTENTOS = 3;

/**
 * CHECK de `RequisitoCliente` que corresponden a datos del pedido. Se traducen a 400 solo si el
 * mensaje nombra ESE constraint. `ck_requisito_baja_logica` no está: fallar ahí es un error
 * nuestro y sigue siendo un 500. Cualquier otro constraint también.
 */
const CHECKS_DE_ENTRADA: Readonly<Record<string, { campo: string; mensaje: string }>> = {
  ck_requisito_cantidad_positiva: {
    campo: 'cantidad',
    mensaje: 'La cantidad debe ser al menos 1.',
  },
  ck_requisito_dias_coherentes: {
    campo: 'diasAproximados',
    mensaje: 'Cargá tantos días aproximados como indique la cantidad, o dejá la lista vacía.',
  },
  ck_requisito_dias_rango: {
    campo: 'diasAproximados',
    mensaje: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
  },
};

interface ClienteDeMatriz {
  id: string;
  estado: 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO';
  matrizConfigurada: boolean;
}

const esErrorConocido = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

/** P2025: el `update` no encontró una fila que cumpla el `where`. */
const esRegistroInexistente = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2025';

/** P2034: la transacción serializable chocó con otra escritura (o un deadlock). */
const esConflictoDeEscritura = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2034';

/**
 * Un cliente con baja lógica no existe. El estado no importa: un INACTIVO o SUSPENDIDO se consulta.
 */
async function exigirClienteVigente(
  db: Prisma.TransactionClient | typeof prisma,
  clienteId: string,
): Promise<void> {
  const cliente = await db.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { id: true },
  });
  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }
}

/**
 * Para escribir la matriz el cliente tiene que existir y estar ACTIVO. INACTIVO y SUSPENDIDO
 * se tratan igual (409 `CLIENTE_NO_ACTIVO`). La lectura va dentro de la transacción de la escritura.
 */
async function exigirClienteActivo(
  tx: Prisma.TransactionClient,
  clienteId: string,
): Promise<ClienteDeMatriz> {
  const cliente = await tx.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { id: true, estado: true, matrizConfigurada: true },
  });
  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }
  if (cliente.estado !== 'ACTIVO') {
    throw conflict('CLIENTE_NO_ACTIVO', { estado: cliente.estado }, 'El cliente no está activo');
  }
  return cliente;
}

/** Un tipo que no existe es 404. Uno inactivo no se asigna a un requisito nuevo (400). */
async function exigirTipoActivo(
  tx: Prisma.TransactionClient,
  tipoDocumentoId: string,
): Promise<void> {
  const tipo = await tx.tipoDocumento.findUnique({
    where: { id: tipoDocumentoId },
    select: { activo: true },
  });
  if (tipo === null) {
    throw notFound('Tipo de documento no encontrado');
  }
  if (!tipo.activo) {
    throw validationError([
      { campo: 'tipoDocumentoId', mensaje: 'El tipo de documento está inactivo.' },
    ]);
  }
}

async function exigirRequisitoActivo(
  tx: Prisma.TransactionClient,
  clienteId: string,
  requisitoId: string,
): Promise<RequisitoClienteConTipo> {
  const requisito = await tx.requisitoCliente.findFirst({
    where: { id: requisitoId, clienteId, isDeleted: false },
    include: CON_TIPO,
  });
  if (requisito === null) {
    throw notFound('Requisito no encontrado');
  }
  return requisito;
}

/**
 * Deja `matrizConfigurada` igual a "hay al menos un requisito activo".
 *
 * El `COUNT` corre en la misma transacción que el alta o la baja, así que ve esa escritura y
 * se confirma con ella o no se confirma nada. Solo se escribe el cliente cuando el booleano
 * cambia: un `update` de Prisma mueve `updatedAt` aunque el valor sea el mismo.
 *
 * La transacción es `Serializable`. Dos altas o bajas del mismo cliente que leen este conjunto
 * y escriben una fila forman un ciclo de lectura-escritura: PostgreSQL aborta una (P2034) en
 * vez de dejar que las dos confirmen un conteo viejo. El reintento vuelve a contar sobre lo ya
 * confirmado. Por eso el flag no se deduce en memoria ("esta operación suma uno") sino con el
 * conteo, y la unicidad del activo no se decide con un `findFirst` previo: la garantiza el
 * índice parcial `uq_requisito_cliente_tipo_activo`.
 */
async function reflejarMatrizConfigurada(
  tx: Prisma.TransactionClient,
  cliente: ClienteDeMatriz,
): Promise<void> {
  const activos = await tx.requisitoCliente.count({
    where: { clienteId: cliente.id, isDeleted: false },
  });
  const configurada = activos > 0;
  if (cliente.matrizConfigurada === configurada) return;

  try {
    await tx.cliente.update({
      where: { id: cliente.id, isDeleted: false },
      data: { matrizConfigurada: configurada },
    });
  } catch (error) {
    if (esRegistroInexistente(error)) {
      throw notFound('Cliente no encontrado');
    }
    throw error;
  }
}

/**
 * Corre `trabajo` en una transacción serializable. Un P2034 se reintenta hasta `INTENTOS`.
 * Un error de negocio (404, 409, 400) no se reintenta: se propaga y la transacción se revierte.
 * Agotados los intentos, el P2034 sigue su curso y el manejador de errores responde 500.
 * El contrato de la matriz no define un 409 para esta carrera.
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

export async function listarRequisitos(clienteId: string): Promise<RequisitoCliente[]> {
  await exigirClienteVigente(prisma, clienteId);

  const filas = await prisma.requisitoCliente.findMany({
    where: { clienteId, isDeleted: false },
    orderBy: ORDEN_POR_TIPO,
    include: CON_TIPO,
  });
  return filas.map(toRequisitoClienteDto);
}

async function insertarRequisito(
  tx: Prisma.TransactionClient,
  clienteId: string,
  input: CreateRequisitoClienteDto,
): Promise<RequisitoCliente> {
  const cliente = await exigirClienteActivo(tx, clienteId);
  await exigirTipoActivo(tx, input.tipoDocumentoId);

  // Fila nueva. Una dada de baja del mismo tipo no se reactiva: sus ítems históricos apuntan a ese id.
  const creado = await tx.requisitoCliente.create({
    data: {
      clienteId,
      tipoDocumentoId: input.tipoDocumentoId,
      cantidad: input.cantidad,
      diasAproximados: input.diasAproximados,
      canalEntrega: input.canalEntrega,
      nota: input.nota,
    },
    include: CON_TIPO,
  });
  await reflejarMatrizConfigurada(tx, cliente);
  return toRequisitoClienteDto(creado);
}

/**
 * Crea un requisito. No consulta antes si ya hay uno activo del mismo tipo: dos altas simultáneas
 * pasarían esa consulta. Se inserta y, si el índice parcial rechaza la fila, se responde 409
 * con el requisito que quedó. Si la carrera se ve como P2034 y, al agotar los reintentos, la fila
 * ya está confirmada, también es ese 409: el duplicado existe. Si esa fila ya no está (la dieron
 * de baja en el medio), se reintenta el alta. Otro P2002, o un P2034 sin fila, no es este conflicto.
 */
export async function crearRequisito(
  clienteId: string,
  input: CreateRequisitoClienteDto,
): Promise<RequisitoCliente> {
  for (let intento = 1; ; intento += 1) {
    try {
      return await enTransaccionSerializable((tx) => insertarRequisito(tx, clienteId, input));
    } catch (error) {
      const check = violacionDeCheckDeEntrada(error);
      if (check !== null) {
        throw validationError([check]);
      }
      const ajeno = requisitoAjeno(error);
      if (ajeno !== null) {
        throw notFound(ajeno);
      }
      if (!esRequisitoDuplicado(error) && !esConflictoDeEscritura(error)) {
        throw error;
      }
      const existente = await prisma.requisitoCliente.findFirst({
        where: { clienteId, tipoDocumentoId: input.tipoDocumentoId, isDeleted: false },
        select: { id: true, tipoDocumentoId: true, cantidad: true },
      });
      if (existente !== null) {
        throw requisitoDuplicado(existente);
      }
      // Un P2034 ya se reintentó dentro de la transacción. Sin fila confirmada no es un duplicado.
      if (esConflictoDeEscritura(error) || intento >= INTENTOS) {
        throw error;
      }
    }
  }
}

async function modificarRequisito(
  tx: Prisma.TransactionClient,
  clienteId: string,
  requisitoId: string,
  input: UpdateRequisitoClienteDto,
): Promise<RequisitoCliente> {
  await exigirClienteActivo(tx, clienteId);
  await validarDiasResultantes(tx, clienteId, requisitoId, input);

  try {
    const actualizado = await tx.requisitoCliente.update({
      where: { id: requisitoId, clienteId, isDeleted: false },
      data: {
        ...(input.cantidad !== undefined && { cantidad: input.cantidad }),
        ...(input.diasAproximados !== undefined && { diasAproximados: input.diasAproximados }),
        ...(input.canalEntrega !== undefined && { canalEntrega: input.canalEntrega }),
        ...(input.nota !== undefined && { nota: input.nota }),
      },
      include: CON_TIPO,
    });
    return toRequisitoClienteDto(actualizado);
  } catch (error) {
    if (esRegistroInexistente(error)) {
      throw notFound('Requisito no encontrado');
    }
    throw error;
  }
}

/**
 * El schema valida los días contra la cantidad solo cuando el pedido trae las dos. Acá se arma
 * el estado que quedaría guardado (lo enviado más lo que ya está) y se usa `problemaDeDias`.
 * Si no cierra, no se escribe. Un tipo desactivado después de crear el requisito no bloquea
 * la edición: no se vuelve a mirar `activo`.
 */
async function validarDiasResultantes(
  tx: Prisma.TransactionClient,
  clienteId: string,
  requisitoId: string,
  input: UpdateRequisitoClienteDto,
): Promise<void> {
  if (input.cantidad === undefined && input.diasAproximados === undefined) return;

  let cantidad: number;
  let dias: number[];
  if (input.cantidad !== undefined && input.diasAproximados !== undefined) {
    cantidad = input.cantidad;
    dias = input.diasAproximados;
  } else {
    const guardado = await exigirRequisitoActivo(tx, clienteId, requisitoId);
    cantidad = input.cantidad ?? guardado.cantidad;
    dias = input.diasAproximados ?? guardado.diasAproximados;
  }

  const problema = problemaDeDias(cantidad, dias);
  if (problema !== null) {
    throw validationError([{ campo: 'diasAproximados', mensaje: problema }]);
  }
}

/** No cambia el tipo ni `matrizConfigurada`. No toca rendiciones ni ítems. */
export async function actualizarRequisito(
  clienteId: string,
  requisitoId: string,
  input: UpdateRequisitoClienteDto,
): Promise<RequisitoCliente> {
  try {
    return await enTransaccionSerializable((tx) =>
      modificarRequisito(tx, clienteId, requisitoId, input),
    );
  } catch (error) {
    const check = violacionDeCheckDeEntrada(error);
    if (check !== null) {
      throw validationError([check]);
    }
    const ajeno = requisitoAjeno(error);
    if (ajeno !== null) {
      throw notFound(ajeno);
    }
    throw error;
  }
}

async function darDeBajaRequisito(
  tx: Prisma.TransactionClient,
  clienteId: string,
  requisitoId: string,
): Promise<void> {
  const cliente = await exigirClienteActivo(tx, clienteId);

  try {
    await tx.requisitoCliente.update({
      where: { id: requisitoId, clienteId, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  } catch (error) {
    if (esRegistroInexistente(error)) {
      throw notFound('Requisito no encontrado');
    }
    throw error;
  }

  await reflejarMatrizConfigurada(tx, cliente);
}

/** Baja lógica. Una fila ya dada de baja no cumple el `where` y es 404. */
export async function eliminarRequisito(clienteId: string, requisitoId: string): Promise<void> {
  try {
    await enTransaccionSerializable((tx) => darDeBajaRequisito(tx, clienteId, requisitoId));
  } catch (error) {
    const check = violacionDeCheckDeEntrada(error);
    if (check !== null) {
      throw validationError([check]);
    }
    const ajeno = requisitoAjeno(error);
    if (ajeno !== null) {
      throw notFound(ajeno);
    }
    throw error;
  }
}

/**
 * Carga masiva: un mismo tipo de documento para varios clientes, todo en
 * una transacción. Un cliente omitido no hace fallar el pedido.
 *
 * - Un cliente inexistente o borrado es 404 y no se crea nada.
 * - Un cliente que no está ACTIVO se omite con `CLIENTE_NO_ACTIVO`.
 * - Uno que ya tiene un requisito activo de ese tipo se omite con `REQUISITO_DUPLICADO`.
 * - A los demás se les inserta el requisito y, en la misma transacción, `matrizConfigurada`
 *   pasa a `true`. Solo se actualizan los que lo tenían en `false`: un `updateMany` mueve
 *   `updatedAt` aunque el valor no cambie.
 *
 * Ante una carrera con el índice parcial (P2002) se reintenta: el duplicado pasa a verse en la
 * lectura previa y ese cliente se omite.
 */
export async function cargarRequisitosMasivo(
  input: CargaMasivaRequisitoDto,
): Promise<ResultadoCargaMasiva> {
  for (let intento = 1; ; intento += 1) {
    try {
      return await enTransaccionSerializable((tx) => insertarMasivo(tx, input));
    } catch (error) {
      const check = violacionDeCheckDeEntrada(error);
      if (check !== null) {
        throw validationError([check]);
      }
      const ajeno = requisitoAjeno(error);
      if (ajeno !== null) {
        throw notFound(ajeno);
      }
      if (!esRequisitoDuplicado(error) || intento >= INTENTOS) {
        throw error;
      }
    }
  }
}

async function insertarMasivo(
  tx: Prisma.TransactionClient,
  input: CargaMasivaRequisitoDto,
): Promise<ResultadoCargaMasiva> {
  await exigirTipoActivo(tx, input.tipoDocumentoId);

  const ids = input.clientes.map((c) => c.clienteId);
  const clientes = await tx.cliente.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: { id: true, estado: true, matrizConfigurada: true },
  });
  const porId = new Map(clientes.map((c) => [c.id.toLowerCase(), c]));
  if (ids.some((id) => !porId.has(id.toLowerCase()))) {
    throw notFound('Cliente no encontrado');
  }

  const activos = clientes.filter((c) => c.estado === 'ACTIVO');
  const conRequisito = await tx.requisitoCliente.findMany({
    where: {
      tipoDocumentoId: input.tipoDocumentoId,
      clienteId: { in: activos.map((c) => c.id) },
      isDeleted: false,
    },
    select: { clienteId: true },
  });
  const duplicados = new Set(conRequisito.map((r) => r.clienteId));

  const omitidos: ResultadoCargaMasiva['omitidos'] = [];
  const aCrear: { clienteId: string; cantidad: number; diasAproximados: number[] }[] = [];
  for (const pedido of input.clientes) {
    const cliente = porId.get(pedido.clienteId.toLowerCase());
    if (cliente === undefined) continue;
    if (cliente.estado !== 'ACTIVO') {
      omitidos.push({ clienteId: cliente.id, motivo: 'CLIENTE_NO_ACTIVO' });
    } else if (duplicados.has(cliente.id)) {
      omitidos.push({ clienteId: cliente.id, motivo: 'REQUISITO_DUPLICADO' });
    } else {
      aCrear.push({
        clienteId: cliente.id,
        cantidad: pedido.cantidad,
        diasAproximados: pedido.diasAproximados,
      });
    }
  }

  if (aCrear.length > 0) {
    await tx.requisitoCliente.createMany({
      data: aCrear.map((fila) => ({
        ...fila,
        tipoDocumentoId: input.tipoDocumentoId,
        canalEntrega: input.canalEntrega,
        nota: input.nota,
      })),
    });
    await tx.cliente.updateMany({
      where: {
        id: { in: aCrear.map((fila) => fila.clienteId) },
        isDeleted: false,
        matrizConfigurada: false,
      },
      data: { matrizConfigurada: true },
    });
  }

  return { creados: aCrear.map((fila) => fila.clienteId), omitidos };
}

/**
 * P2002 de ESTE índice, venga como columnas (`clienteId` + `tipoDocumentoId`) o como el nombre
 * del índice parcial. Un P2002 de otro índice (el CUIT, el email de un contacto) no entra.
 */
function esRequisitoDuplicado(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!esErrorConocido(error) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (typeof target === 'string') return target.includes(INDICE_REQUISITO_ACTIVO);
  if (!Array.isArray(target)) return false;
  const campos = target.filter((campo): campo is string => typeof campo === 'string');
  return (
    campos.includes(INDICE_REQUISITO_ACTIVO) ||
    (campos.includes('clienteId') && campos.includes('tipoDocumentoId'))
  );
}

/** P2003 solo si la FK es la del tipo o la del cliente. Otra FK sigue siendo un 500. */
function requisitoAjeno(
  error: unknown,
): 'Tipo de documento no encontrado' | 'Cliente no encontrado' | null {
  if (!esErrorConocido(error) || error.code !== 'P2003') return null;
  const campo = error.meta?.field_name;
  if (typeof campo !== 'string') return null;
  if (campo.includes('tipoDocumentoId')) return 'Tipo de documento no encontrado';
  if (campo.includes('clienteId')) return 'Cliente no encontrado';
  return null;
}

function violacionDeCheckDeEntrada(error: unknown): { campo: string; mensaje: string } | null {
  const texto = textoDeCheck(error);
  if (texto === null) return null;
  for (const [constraint, traduccion] of Object.entries(CHECKS_DE_ENTRADA)) {
    if (texto.includes(constraint)) return traduccion;
  }
  return null;
}

/**
 * Prisma 5 informa un CHECK como P2004 (`meta.database_error`) o, según el motor, como un error
 * desconocido cuyo mensaje nombra el constraint (`23514` / `ck_requisito_*`). Si no se puede
 * leer el nombre, no se traduce.
 */
function textoDeCheck(error: unknown): string | null {
  if (esErrorConocido(error) && error.code === 'P2004') {
    const detalle = error.meta?.database_error;
    return typeof detalle === 'string' ? detalle : error.message;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message;
  }
  return null;
}

function requisitoDuplicado(existente: {
  id: string;
  tipoDocumentoId: string;
  cantidad: number;
}): AppError {
  return conflict(
    'REQUISITO_DUPLICADO',
    {
      requisitoExistente: {
        id: existente.id,
        tipoDocumentoId: existente.tipoDocumentoId,
        cantidad: existente.cantidad,
      },
    },
    'El cliente ya tiene un requisito para ese tipo de documento',
  );
}
