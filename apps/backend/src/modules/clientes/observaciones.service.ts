import { Prisma } from '@prisma/client';
import {
  ObservacionesClienteLecturaSchema,
  ObservacionesClienteSchema,
  type ObservacionesClienteDto,
  type ObservacionesClienteLecturaDto,
} from '@realpolitik/shared';

import { notFound } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

/**
 * Obtiene las observaciones internas de un cliente (HU2.10).
 *
 * El cliente debe existir y no estar dado de baja lógica (`isDeleted: false`). Se pueden leer
 * con el cliente en cualquier estado. Sin observaciones, devuelve `{ observaciones: null }`.
 */
export async function obtenerObservaciones(
  clienteId: string,
): Promise<ObservacionesClienteLecturaDto> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, isDeleted: false },
    select: { observaciones: true },
  });

  if (cliente === null) {
    throw notFound('Cliente no encontrado');
  }

  return ObservacionesClienteLecturaSchema.parse({
    observaciones: cliente.observaciones ?? null,
  });
}

/**
 * Guarda o borra las observaciones internas de un cliente (HU2.10). Es una sola nota: lo que se
 * guarda reemplaza a lo anterior.
 *
 * Reglas de negocio:
 * 1. El cliente debe existir y no estar dado de baja lógica (si no, 404 NOT_FOUND).
 * 2. A diferencia de las indicaciones de armado (HU2.4), **se puede guardar con el cliente en
 *    cualquier estado**: `ACTIVO`, `INACTIVO` o `SUSPENDIDO`. Es una nota interna, no genera
 *    operaciones, y es justo lo que se anota cuando el cliente se pausa.
 * 3. Texto vacío, de solo espacios o `null` se guarda como `null` (borra la nota). Si tiene texto,
 *    se guarda recortado en sus extremos, con sus saltos de línea y hasta 1000 caracteres.
 * 4. Es un `update` directo, sin comparar con lo guardado ni consulta previa: igual que HU2.4,
 *    guardar el mismo texto también escribe la fila (y actualiza `updatedAt`).
 */
export async function guardarObservaciones(
  clienteId: string,
  input: ObservacionesClienteDto,
): Promise<ObservacionesClienteLecturaDto> {
  // Asegura la normalización del DTO según las reglas de ObservacionesClienteSchema
  const datos = ObservacionesClienteSchema.parse(input);

  try {
    const actualizado = await prisma.cliente.update({
      where: { id: clienteId, isDeleted: false },
      data: { observaciones: datos.observaciones },
      select: { observaciones: true },
    });

    return ObservacionesClienteLecturaSchema.parse({
      observaciones: actualizado.observaciones ?? null,
    });
  } catch (error) {
    // P2025: el cliente no existe o tiene baja lógica (no cumple el `where`).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw notFound('Cliente no encontrado');
    }
    throw error;
  }
}
