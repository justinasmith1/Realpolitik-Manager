import type { Contacto as ContactoRow } from '@prisma/client';
import { ContactoSchema, type Contacto } from '@realpolitik/shared';

/**
 * Convierte una fila de Prisma en el Contacto del contrato de la API. Las fechas se exponen
 * como en el cliente (`creadoEn`, `actualizadoEn`); la base las llama `createdAt` y `updatedAt`.
 */
export function toContactoDto(row: ContactoRow): Contacto {
  return ContactoSchema.parse({
    id: row.id,
    nombre: row.nombre,
    area: row.area,
    email: row.email,
    recibeRendiciones: row.recibeRendiciones,
    clienteId: row.clienteId,
    creadoEn: row.createdAt,
    actualizadoEn: row.updatedAt,
  });
}
