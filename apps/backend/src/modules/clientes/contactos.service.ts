import { Prisma } from '@prisma/client';
import type { Contacto, CreateContactoDto, UpdateContactoDto } from '@realpolitik/shared';

import { conflict, notFound, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';
import { toContactoDto } from './contacto.mapper';

export async function listarContactos(clienteId: string): Promise<Contacto[]> {
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) {
    throw notFound('Cliente no encontrado');
  }

  const filas = await prisma.contacto.findMany({
    where: { clienteId, isDeleted: false },
    orderBy: [{ recibeRendiciones: 'desc' }, { nombre: 'asc' }],
  });
  return filas.map(toContactoDto);
}

export async function crearContacto(
  clienteId: string,
  input: CreateContactoDto,
): Promise<Contacto> {
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) {
    throw notFound('Cliente no encontrado');
  }

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

export async function actualizarContacto(
  clienteId: string,
  contactoId: string,
  input: UpdateContactoDto,
): Promise<Contacto> {
  const existente = await prisma.contacto.findUnique({ where: { id: contactoId } });
  if (!existente || existente.clienteId !== clienteId || existente.isDeleted) {
    throw notFound('Contacto no encontrado');
  }

  try {
    const actualizado = await prisma.contacto.update({
      where: { id: contactoId },
      data: {
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.area !== undefined && { area: input.area }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.recibeRendiciones !== undefined && { recibeRendiciones: input.recibeRendiciones }),
      },
    });
    return toContactoDto(actualizado);
  } catch (error) {
    if (esEmailDuplicado(error) && input.email) {
      throw await conflictoPorEmail(clienteId, input.email, error);
    }
    throw error;
  }
}

export async function eliminarContacto(clienteId: string, contactoId: string): Promise<void> {
  const existente = await prisma.contacto.findUnique({ where: { id: contactoId } });
  if (!existente || existente.clienteId !== clienteId || existente.isDeleted) {
    throw notFound('Contacto no encontrado');
  }

  await prisma.contacto.update({
    where: { id: contactoId },
    data: { isDeleted: true, deletedAt: new Date() },
  });
}

function esEmailDuplicado(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
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
  return conflict(
    'EMAIL_DUPLICADO',
    {
      contactoExistente: {
        id: existente.id,
        nombre: existente.nombre,
      },
    },
    'El cliente ya tiene un contacto con ese email',
  );
}
