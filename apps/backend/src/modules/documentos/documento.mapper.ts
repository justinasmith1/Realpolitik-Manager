import type { Prisma } from '@prisma/client';
import {
  CandidatoAplicacionSchema,
  DocumentoConAplicacionesSchema,
  DocumentoResumenSchema,
  DocumentoSchema,
  type CandidatoAplicacion,
  type Documento,
  type DocumentoConAplicaciones,
  type DocumentoResumen,
} from '@realpolitik/shared';

// Filas de Prisma → documentos del contrato (HU2.8, ADR-0004). Los campos se copian uno por uno:
// `sha256` y `claveAlmacenamiento` NUNCA salen (son detalles internos) y `createdAt`/`updatedAt`
// pasan a `creadoEn`/`actualizadoEn`. Cada salida se valida con el schema de shared: un dato que no
// cumple el contrato termina en un 500, no en un JSON inválido.

/** Lo que se lee del tipo de documento: el nombre actual del catálogo. */
export const CON_TIPO = {
  tipoDocumento: { select: { id: true, nombre: true } },
} satisfies Prisma.DocumentoInclude;

export type DocumentoConTipo = Prisma.DocumentoGetPayload<{ include: typeof CON_TIPO }>;

const camposDeDocumento = (row: DocumentoConTipo) => ({
  id: row.id,
  tipoDocumento: { id: row.tipoDocumento.id, nombre: row.tipoDocumento.nombre },
  anio: row.anio,
  mes: row.mes,
  nombreOriginal: row.nombreOriginal,
  tipoContenido: row.tipoContenido,
  tamanioBytes: row.tamanioBytes,
  creadoEn: row.createdAt,
  actualizadoEn: row.updatedAt,
});

export function toDocumentoDto(row: DocumentoConTipo): Documento {
  return DocumentoSchema.parse(camposDeDocumento(row));
}

export function toDocumentoResumenDto(
  row: DocumentoConTipo,
  aplicacionesVigentes: number,
): DocumentoResumen {
  return DocumentoResumenSchema.parse({ ...camposDeDocumento(row), aplicacionesVigentes });
}

// ─── Dónde está aplicado ──────────────────────────────────────────────────────

const CLIENTE = { select: { id: true, denominacion: true, estado: true } } as const;

/** Lo que se lee de un ítem para ubicarlo: su snapshot, su rendición y el cliente. */
export const ITEM_UBICADO = {
  select: {
    id: true,
    tipoDocumentoId: true,
    nombreTipoDocumento: true,
    ordinal: true,
    totalOrdinal: true,
    diaAproximado: true,
    requisitoClienteId: true,
    rendicion: {
      select: {
        id: true,
        anio: true,
        mes: true,
        numeroFactura: true,
        isDeleted: true,
        cliente: CLIENTE,
      },
    },
  },
} satisfies Prisma.ItemChecklistDefaultArgs;

export type ItemUbicado = Prisma.ItemChecklistGetPayload<typeof ITEM_UBICADO>;

const ubicacionDe = (item: ItemUbicado) => ({
  cliente: item.rendicion.cliente,
  rendicion: {
    id: item.rendicion.id,
    anio: item.rendicion.anio,
    mes: item.rendicion.mes,
    numeroFactura: item.rendicion.numeroFactura,
  },
  item: {
    id: item.id,
    tipoDocumentoId: item.tipoDocumentoId,
    nombreTipoDocumento: item.nombreTipoDocumento,
    ordinal: item.ordinal,
    totalOrdinal: item.totalOrdinal,
    diaAproximado: item.diaAproximado,
  },
});

type AplicacionUbicadaRow = Prisma.AplicacionDocumentoGetPayload<{
  include: { itemChecklist: typeof ITEM_UBICADO };
}>;

export function toDocumentoConAplicacionesDto(
  row: DocumentoConTipo,
  aplicaciones: readonly AplicacionUbicadaRow[],
): DocumentoConAplicaciones {
  return DocumentoConAplicacionesSchema.parse({
    ...camposDeDocumento(row),
    aplicaciones: aplicaciones.map((aplicacion) => {
      const ubicacion = ubicacionDe(aplicacion.itemChecklist);
      return {
        id: aplicacion.id,
        documentoId: aplicacion.documentoId,
        itemChecklistId: aplicacion.itemChecklistId,
        estado: aplicacion.reemplazadaEn === null ? 'VIGENTE' : 'REEMPLAZADA',
        aplicadaEn: aplicacion.aplicadaEn,
        reemplazadaEn: aplicacion.reemplazadaEn,
        reemplazaAId: aplicacion.reemplazaAId,
        ubicacion: {
          ...ubicacion,
          rendicion: {
            ...ubicacion.rendicion,
            estado: aplicacion.itemChecklist.rendicion.isDeleted ? 'ANULADA' : 'ACTIVA',
          },
        },
      };
    }),
  });
}

/**
 * Un ítem pendiente como candidato. La consulta solo trae ítems sin documento vigente, así que
 * todos son `ELEGIBLE`.
 */
export function toCandidatoDto(item: ItemUbicado): CandidatoAplicacion {
  return CandidatoAplicacionSchema.parse({ ...ubicacionDe(item), elegibilidad: 'ELEGIBLE' });
}
