import type { TipoDocumento as TipoDocumentoRow } from '@prisma/client';
import { TipoDocumentoSchema, type TipoDocumento } from '@realpolitik/shared';

/**
 * Convierte una fila de Prisma en el TipoDocumento del contrato de la API (HU2.1).
 *
 * Los campos se copian uno por uno: `nombreNormalizado` es la clave técnica de unicidad
 * (ADR-0003, punto 8) y no sale por la API, ni sale ningún campo que se agregue a la tabla sin
 * una decisión explícita. `createdAt`/`updatedAt` pasan a `creadoEn`/`actualizadoEn`, como en
 * clientes. `TipoDocumentoSchema.parse` comprueba que la respuesta cumple el contrato: un dato
 * que no lo cumpla termina en un 500, no en una respuesta inválida.
 */
export function toTipoDocumentoDto(row: TipoDocumentoRow): TipoDocumento {
  return TipoDocumentoSchema.parse({
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    activo: row.activo,
    creadoEn: row.createdAt,
    actualizadoEn: row.updatedAt,
  });
}
