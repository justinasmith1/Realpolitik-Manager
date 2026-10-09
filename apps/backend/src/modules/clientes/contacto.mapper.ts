import type { Contacto as ContactoRow } from '@prisma/client';
import { ContactoSchema, type Contacto } from '@realpolitik/shared';

export function toContactoDto(row: ContactoRow): Contacto {
  return ContactoSchema.parse({
    id: row.id,
    nombre: row.nombre,
    area: row.area,
    email: row.email,
    recibeRendiciones: row.recibeRendiciones,
    clienteId: row.clienteId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
