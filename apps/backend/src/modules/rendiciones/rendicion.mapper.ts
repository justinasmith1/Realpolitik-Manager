import type { ItemChecklist as ItemChecklistRow, Rendicion as RendicionRow } from '@prisma/client';
import {
  ItemChecklistSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
  type ItemChecklist,
  type Rendicion,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';

// Filas de Prisma → rendición del contrato (sección 4.5). Los campos se copian uno por uno:
// `isDeleted` y `deletedAt` no salen; el estado se deriva de la baja lógica (`ANULADA` y su
// fecha en `anuladaEn`). `createdAt`/`updatedAt`/`completadoAt` pasan a `creadoEn`/
// `actualizadoEn`/`completadoEn`. Cada salida se valida con el schema de shared: un dato que no
// cumple el contrato termina en un 500, no en un JSON inválido.

export type RendicionConItems = RendicionRow & { items: ItemChecklistRow[] };

export interface ResumenDeAvance {
  totalItems: number;
  completados: number;
}

const camposDeRendicion = (row: RendicionRow) => ({
  id: row.id,
  clienteId: row.clienteId,
  anio: row.anio,
  mes: row.mes,
  numeroFactura: row.numeroFactura,
  estado: row.isDeleted ? 'ANULADA' : 'ACTIVA',
  anuladaEn: row.isDeleted ? row.deletedAt : null,
  creadoEn: row.createdAt,
  actualizadoEn: row.updatedAt,
});

const camposDeItem = (row: ItemChecklistRow) => ({
  id: row.id,
  requisitoClienteId: row.requisitoClienteId,
  tipoDocumentoId: row.tipoDocumentoId,
  nombreTipoDocumento: row.nombreTipoDocumento,
  ordinal: row.ordinal,
  totalOrdinal: row.totalOrdinal,
  diaAproximado: row.diaAproximado,
  canalEntrega: row.canalEntrega,
  completado: row.completado,
  completadoEn: row.completadoAt,
  creadoEn: row.createdAt,
  actualizadoEn: row.updatedAt,
});

/** Rendición sin ítems: la respuesta de la anulación. */
export function toRendicionDto(row: RendicionRow): Rendicion {
  return RendicionSchema.parse(camposDeRendicion(row));
}

/** Ítem del checklist. */
export function toItemChecklistDto(row: ItemChecklistRow): ItemChecklist {
  return ItemChecklistSchema.parse(camposDeItem(row));
}

/** Rendición con su checklist: el detalle y la respuesta del alta. */
export function toRendicionDetalleDto(row: RendicionConItems): RendicionDetalle {
  return RendicionDetalleSchema.parse({
    ...camposDeRendicion(row),
    items: row.items.map(camposDeItem),
  });
}

/** Rendición con el avance de su checklist, sin ítems: el listado de un cliente. */
export function toRendicionResumenDto(
  row: RendicionRow,
  resumen: ResumenDeAvance,
): RendicionResumen {
  return RendicionResumenSchema.parse({ ...camposDeRendicion(row), resumen });
}
