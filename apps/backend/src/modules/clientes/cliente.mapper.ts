import type { Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema, type Cliente } from '@realpolitik/shared';

/**
 * Convierte una fila de Prisma en el Cliente del contrato de la API.
 *
 * Los campos se copian uno por uno para que nada interno (`isDeleted`, `deletedAt`) salga
 * por accidente. Los `null` de la base se omiten porque el contrato los modela como campos
 * opcionales. Eso incluye `subtipo`: si la base tiene una combinación imposible (un privado
 * con subtipo o un público sin él) no se corrige acá, la detecta `ClienteSchema.parse` y
 * termina en un 500 en lugar de devolver un dato que contradice el contrato.
 */
export function toClienteDto(row: ClienteRow): Cliente {
  return ClienteSchema.parse({
    id: row.id,
    razonSocial: row.razonSocial,
    denominacion: row.denominacion,
    cuit: row.cuit,
    ivaCondicion: row.ivaCondicion,
    emailContacto: row.emailContacto,
    emailsAdicionales: row.emailsAdicionales,
    ...(row.telefono === null ? {} : { telefono: row.telefono }),
    ...(row.portalUrl === null ? {} : { portalUrl: row.portalUrl }),
    sector: row.sector,
    ...(row.subtipo === null ? {} : { subtipo: row.subtipo }),
    estado: row.estado,
    creadoEn: row.createdAt,
    actualizadoEn: row.updatedAt,
  });
}
