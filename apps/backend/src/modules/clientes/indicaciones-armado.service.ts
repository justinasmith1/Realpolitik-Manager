import {
  IndicacionesArmadoLecturaSchema,
  IndicacionesArmadoSchema,
  type IndicacionesArmadoDto,
  type IndicacionesArmadoLecturaDto,
} from '@realpolitik/shared';

import { conflict, notFound } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

/**
 * Obtiene las indicaciones de armado del legajo de un cliente (HU2.4).
 *
 * El cliente debe existir y no estar dado de baja lógica (`isDeleted: false`).
 * A diferencia de la edición, las indicaciones de un cliente `INACTIVO` o `SUSPENDIDO`
 * se pueden consultar normalmente.
 *
 * Si el cliente no tiene indicaciones registradas, devuelve `{ indicacionesArmado: null }`.
 */
export async function obtenerIndicacionesArmado(
  clienteId: string,
): Promise<IndicacionesArmadoLecturaDto> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { indicacionesArmado: true },
  });

  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }

  return IndicacionesArmadoLecturaSchema.parse({
    indicacionesArmado: cliente.indicacionesArmado ?? null,
  });
}

/**
 * Guarda o borra las indicaciones de armado del legajo de un cliente (HU2.4).
 *
 * Reglas de negocio:
 * 1. El cliente debe existir y no estar dado de baja lógica (si no, 404 NOT_FOUND).
 * 2. Solo clientes en estado `ACTIVO` pueden ser editados. Un cliente `INACTIVO` o
 *    `SUSPENDIDO` responde 409 CONFLICT con `motivo: "CLIENTE_NO_ACTIVO"`.
 * 3. Si el texto viene vacío, con solo espacios, o explícitamente `null`, se normaliza
 *    a `null` (lo cual equivale a borrar las indicaciones existentes). Si contiene
 *    texto, se guarda recortado en sus extremos respetando saltos de línea y hasta 1000 caracteres.
 */
export async function guardarIndicacionesArmado(
  clienteId: string,
  input: IndicacionesArmadoDto,
): Promise<IndicacionesArmadoLecturaDto> {
  // Asegura la normalización del DTO según las reglas de IndicacionesArmadoSchema
  const datos = IndicacionesArmadoSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.findFirst({
      where: { id: clienteId, isDeleted: false },
      select: { id: true, estado: true },
    });

    if (cliente === null) {
      throw notFound('Cliente no encontrado');
    }

    if (cliente.estado !== 'ACTIVO') {
      throw conflict('CLIENTE_NO_ACTIVO', { estado: cliente.estado }, 'El cliente no está activo');
    }

    const actualizado = await tx.cliente.update({
      where: { id: clienteId },
      data: { indicacionesArmado: datos.indicacionesArmado },
      select: { indicacionesArmado: true },
    });

    return IndicacionesArmadoLecturaSchema.parse({
      indicacionesArmado: actualizado.indicacionesArmado ?? null,
    });
  });
}
