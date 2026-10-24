import type { Prisma } from '@prisma/client';
import { RequisitoClienteSchema, type RequisitoCliente } from '@realpolitik/shared';

/** Fila de requisito con el tipo, que es lo que arma el DTO. */
export type RequisitoClienteConTipo = Prisma.RequisitoClienteGetPayload<{
  include: { tipoDocumento: true };
}>;

/**
 * Convierte una fila de Prisma en el requisito del contrato (sección 4.2).
 *
 * Los campos se copian uno por uno: `isDeleted`, `deletedAt` y `nombreNormalizado` no salen.
 * `createdAt`/`updatedAt` pasan a `creadoEn`/`actualizadoEn`. `canalEntrega` es el valor
 * guardado (`null` = usa el del cliente), no el canal resuelto. `RequisitoClienteSchema.parse`
 * rechaza una respuesta que no cumple el contrato: termina en un 500, no en un JSON inválido.
 */
export function toRequisitoClienteDto(row: RequisitoClienteConTipo): RequisitoCliente {
  return RequisitoClienteSchema.parse({
    id: row.id,
    clienteId: row.clienteId,
    tipoDocumento: {
      id: row.tipoDocumento.id,
      nombre: row.tipoDocumento.nombre,
      activo: row.tipoDocumento.activo,
    },
    cantidad: row.cantidad,
    diasAproximados: row.diasAproximados,
    canalEntrega: row.canalEntrega,
    nota: row.nota,
    creadoEn: row.createdAt,
    actualizadoEn: row.updatedAt,
  });
}
