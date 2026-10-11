import { Prisma, type Contacto as ContactoRow } from '@prisma/client';
import type {
  Contacto,
  ContactoGuardadoDto,
  CreateContactoDto,
  ReemplazarContactosDto,
  UpdateContactoDto,
} from '@realpolitik/shared';

import { conflict, notFound, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

import { toContactoDto } from './contacto.mapper';

/** Primero los que reciben rendiciones, luego por nombre. */
const ORDEN_CONTACTOS = [
  { recibeRendiciones: 'desc' },
  { nombre: 'asc' },
] satisfies Prisma.ContactoOrderByWithRelationInput[];

/**
 * Un cliente dado de baja lógica (`isDeleted`) no existe para los contactos, igual que para
 * el resto de los endpoints del cliente. Un cliente INACTIVO sí existe: no es lo mismo.
 */
async function exigirClienteVigente(
  db: Prisma.TransactionClient,
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

export async function listarContactos(clienteId: string): Promise<Contacto[]> {
  await exigirClienteVigente(prisma, clienteId);

  const filas = await prisma.contacto.findMany({
    where: { clienteId, isDeleted: false },
    orderBy: ORDEN_CONTACTOS,
  });
  return filas.map(toContactoDto);
}

export async function crearContacto(
  clienteId: string,
  input: CreateContactoDto,
): Promise<Contacto> {
  await exigirClienteVigente(prisma, clienteId);

  try {
    const creado = await prisma.contacto.create({
      data: {
        clienteId,
        nombre: input.nombre,
        area: input.area,
        email: input.email,
        recibeRendiciones: input.recibeRendiciones,
      },
    });
    return toContactoDto(creado);
  } catch (error) {
    if (esEmailDuplicado(error)) {
      throw await conflictoPorEmail(clienteId, input.email, error);
    }
    throw error;
  }
}

/**
 * El contacto se busca por id, cliente y baja lógica en el mismo `update`: uno ajeno, ya
 * eliminado o eliminado entre medio es un 404 (P2025), sin una consulta previa.
 */
export async function actualizarContacto(
  clienteId: string,
  contactoId: string,
  input: UpdateContactoDto,
): Promise<Contacto> {
  await exigirClienteVigente(prisma, clienteId);

  try {
    const actualizado = await prisma.contacto.update({
      where: { id: contactoId, clienteId, isDeleted: false },
      data: {
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.area !== undefined && { area: input.area }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.recibeRendiciones !== undefined && {
          recibeRendiciones: input.recibeRendiciones,
        }),
      },
    });
    return toContactoDto(actualizado);
  } catch (error) {
    if (esContactoInexistente(error)) {
      throw notFound('Contacto no encontrado');
    }
    if (esEmailDuplicado(error) && input.email) {
      throw await conflictoPorEmail(clienteId, input.email, error);
    }
    throw error;
  }
}

export async function eliminarContacto(clienteId: string, contactoId: string): Promise<void> {
  await exigirClienteVigente(prisma, clienteId);

  try {
    await prisma.contacto.update({
      where: { id: contactoId, clienteId, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  } catch (error) {
    if (esContactoInexistente(error)) {
      throw notFound('Contacto no encontrado');
    }
    throw error;
  }
}

// ─── Guardado completo de la colección ────────────────────────────────────────

/** Lo que hay que hacer para que los contactos del cliente queden como pide el guardado. */
interface PlanDeReemplazo {
  /** Contactos activos que el guardado ya no trae: se dan de baja. */
  eliminados: ContactoRow[];
  /** Existentes con algún dato distinto. Los demás no se tocan (ni su `updatedAt`). */
  modificados: { actual: ContactoRow; nuevo: ContactoGuardadoDto }[];
  /** Contactos sin `id`. */
  nuevos: ContactoGuardadoDto[];
}

/**
 * Compara el guardado con los contactos activos de la base. Los datos del guardado ya vienen
 * normalizados por shared (sin espacios y con el email en minúsculas), así que se comparan
 * tal cual. Un `id` que no es de un contacto activo de este cliente es un 404.
 */
function planificarReemplazo(
  actuales: ContactoRow[],
  recibidos: ContactoGuardadoDto[],
): PlanDeReemplazo {
  const porId = new Map(actuales.map((fila) => [fila.id, fila]));
  const modificados: PlanDeReemplazo['modificados'] = [];
  const nuevos: ContactoGuardadoDto[] = [];
  const conservados = new Set<string>();

  for (const contacto of recibidos) {
    if (contacto.id === undefined) {
      nuevos.push(contacto);
      continue;
    }
    const actual = porId.get(contacto.id);
    if (actual === undefined) {
      throw notFound('Contacto no encontrado');
    }
    conservados.add(actual.id);
    const cambio =
      actual.nombre !== contacto.nombre ||
      actual.area !== contacto.area ||
      actual.email !== contacto.email ||
      actual.recibeRendiciones !== contacto.recibeRendiciones;
    if (cambio) {
      modificados.push({ actual, nuevo: contacto });
    }
  }

  return { eliminados: actuales.filter((fila) => !conservados.has(fila.id)), modificados, nuevos };
}

/**
 * Guarda la colección completa de contactos de un cliente (`PUT /clientes/:id/contactos`):
 * todos los cambios se aplican o ninguno. Lo que no viene en la lista se da de baja; una lista
 * vacía elimina todos.
 *
 * Todo ocurre en UNA transacción `Serializable`. Así, si alguien más modifica los contactos
 * del mismo cliente mientras se guarda, la base aborta una de las dos y se informa un 409 en
 * lugar de mezclar ambos guardados. Cualquier error revierte todo.
 *
 * El índice único parcial (`clienteId` + `email` mientras `isDeleted = false`) se controla en
 * cada sentencia, no al final, así que un intercambio de emails (A: a→b y B: b→a) chocaría a
 * mitad de camino. Para evitarlo, sin SQL crudo, el orden es:
 *  1. se dan de baja los contactos que ya no están (liberan sus emails);
 *  2. los existentes cuyo email cambia se "estacionan" (`isDeleted = true`), liberando el suyo;
 *  3. se actualizan con sus datos nuevos y se reactivan (`isDeleted = false`);
 *  4. se crean los nuevos.
 * El estacionamiento ocurre solo dentro de la transacción: nadie lo ve, y si algo falla se
 * revierte con el resto. Los que no cambian de email no se estacionan, y los que no cambian
 * en absoluto no se tocan.
 */
export async function reemplazarContactos(
  clienteId: string,
  input: ReemplazarContactosDto,
): Promise<Contacto[]> {
  try {
    const filas = await prisma.$transaction(
      async (tx) => {
        await exigirClienteVigente(tx, clienteId);

        const actuales = await tx.contacto.findMany({ where: { clienteId, isDeleted: false } });
        const plan = planificarReemplazo(actuales, input.contactos);

        if (plan.eliminados.length > 0) {
          await tx.contacto.updateMany({
            where: { id: { in: plan.eliminados.map((fila) => fila.id) }, clienteId },
            data: { isDeleted: true, deletedAt: new Date() },
          });
        }

        const cambianDeEmail = plan.modificados.filter(
          ({ actual, nuevo }) => actual.email !== nuevo.email,
        );
        if (cambianDeEmail.length > 0) {
          await tx.contacto.updateMany({
            where: { id: { in: cambianDeEmail.map(({ actual }) => actual.id) }, clienteId },
            // Con fecha, como cualquier baja: `ck_contacto_baja_logica` exige que vayan juntas y
            // PostgreSQL controla los CHECK en cada sentencia (no al final de la transacción).
            // El paso 3 los reactiva y vuelve a poner `deletedAt` en null.
            data: { isDeleted: true, deletedAt: new Date() },
          });
        }

        for (const { actual, nuevo } of plan.modificados) {
          await tx.contacto.update({
            where: { id: actual.id },
            data: {
              nombre: nuevo.nombre,
              area: nuevo.area,
              email: nuevo.email,
              recibeRendiciones: nuevo.recibeRendiciones,
              isDeleted: false,
              deletedAt: null,
            },
          });
        }

        if (plan.nuevos.length > 0) {
          await tx.contacto.createMany({
            data: plan.nuevos.map((contacto) => ({
              clienteId,
              nombre: contacto.nombre,
              area: contacto.area,
              email: contacto.email,
              recibeRendiciones: contacto.recibeRendiciones,
            })),
          });
        }

        return tx.contacto.findMany({
          where: { clienteId, isDeleted: false },
          orderBy: ORDEN_CONTACTOS,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return filas.map(toContactoDto);
  } catch (error) {
    if (esEmailDuplicado(error)) {
      throw await conflictoPorEmailEnReemplazo(clienteId, input.contactos, error);
    }
    if (esConflictoDeEscritura(error)) {
      throw conflict(
        'CONTACTOS_MODIFICADOS',
        {},
        'Los contactos del cliente cambiaron mientras se guardaban. Probá de nuevo.',
      );
    }
    throw error;
  }
}

// ─── Errores de Prisma ─────────────────────────────────────────────────────────

const esErrorConocido = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

/** P2025: el registro que se quería modificar ya no cumple el `where`. */
const esContactoInexistente = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2025';

/** P2034: la transacción abortó por una escritura concurrente (o un deadlock). */
const esConflictoDeEscritura = (error: unknown): boolean =>
  esErrorConocido(error) && error.code === 'P2034';

function esEmailDuplicado(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!esErrorConocido(error) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  // En PostgreSQL el nombre del indice puede venir en el mensaje o en target.
  // Como lo creamos a mano con nombre "Contacto_clienteId_email_key", Prisma lo devuelve ahí.
  return (
    (Array.isArray(target) && target.includes('clienteId') && target.includes('email')) ||
    (typeof target === 'string' && target.includes('Contacto_clienteId_email_key')) ||
    (Array.isArray(target) && target.includes('Contacto_clienteId_email_key'))
  );
}

async function conflictoPorEmail(
  clienteId: string,
  email: string,
  original: Prisma.PrismaClientKnownRequestError,
): Promise<AppError> {
  const existente = await prisma.contacto.findFirst({
    where: { clienteId, email, isDeleted: false },
    select: { id: true, nombre: true },
  });
  if (existente === null) {
    throw original;
  }
  return emailDuplicado(existente);
}

/**
 * Tras revertir el guardado, busca qué contacto activo (ajeno al guardado: alguien lo creó
 * mientras tanto) tiene uno de los emails. Si ya no se encuentra, igual es un 409 por email.
 */
async function conflictoPorEmailEnReemplazo(
  clienteId: string,
  recibidos: ContactoGuardadoDto[],
  _original: Prisma.PrismaClientKnownRequestError,
): Promise<AppError> {
  const existente = await prisma.contacto.findFirst({
    where: {
      clienteId,
      isDeleted: false,
      email: { in: recibidos.map((contacto) => contacto.email) },
      id: {
        notIn: recibidos.flatMap((contacto) => (contacto.id === undefined ? [] : [contacto.id])),
      },
    },
    select: { id: true, nombre: true },
  });
  return emailDuplicado(existente);
}

const emailDuplicado = (existente: { id: string; nombre: string } | null): AppError =>
  conflict(
    'EMAIL_DUPLICADO',
    existente === null ? {} : { contactoExistente: { id: existente.id, nombre: existente.nombre } },
    'El cliente ya tiene un contacto con ese email',
  );
