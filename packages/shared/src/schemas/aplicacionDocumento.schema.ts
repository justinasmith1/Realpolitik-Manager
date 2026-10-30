import { z } from 'zod';

import { ClienteEstado } from './cliente.schema.js';
import { DocumentoSchema } from './documento.schema.js';
import { RendicionEstado } from './rendicion.schema.js';

// Aplicaciones de un documento a ítems del checklist (HU2.8, ADR-0004). Una aplicación es
// historial: no se borra. Un ítem tiene a lo sumo una VIGENTE; las anteriores quedan
// REEMPLAZADAS. Un mismo documento puede estar vigente en muchos ítems, de distintas rendiciones
// y también de la misma.

// ─── Lectura ──────────────────────────────────────────────────────────────────

/** Estado derivado de `reemplazadaEn`: vigente si no tiene fecha de reemplazo. */
export const EstadoAplicacion = z.enum(['VIGENTE', 'REEMPLAZADA']);

export type EstadoAplicacion = z.infer<typeof EstadoAplicacion>;

const CamposDeAplicacion = z.object({
  id: z.string().uuid(),
  documentoId: z.string().uuid(),
  itemChecklistId: z.string().uuid(),
  estado: EstadoAplicacion,
  aplicadaEn: z.coerce.date(),
  /** `null` mientras está vigente. */
  reemplazadaEn: z.coerce.date().nullable(),
  /** La aplicación anterior del mismo ítem, si esta la reemplazó. */
  reemplazaAId: z.string().uuid().nullable(),
});

/**
 * El estado se deriva de `reemplazadaEn`: si no coinciden, el backend armó mal la respuesta y el
 * error tiene que aparecer (un 500), no llegar al front. Es una regla de forma, no de escritura.
 */
function estadoCoherente(
  aplicacion: { estado: EstadoAplicacion; reemplazadaEn: Date | null },
  ctx: z.RefinementCtx,
): void {
  if ((aplicacion.estado === 'VIGENTE') !== (aplicacion.reemplazadaEn === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['estado'],
      message: 'Una aplicación es VIGENTE si y solo si no tiene fecha de reemplazo.',
    });
  }
}

/** Una aplicación, sin datos del documento ni del ítem. */
export const AplicacionDocumentoSchema = CamposDeAplicacion.superRefine(estadoCoherente);

export type AplicacionDocumento = z.infer<typeof AplicacionDocumentoSchema>;

// Las piezas de "dónde": el cliente, la rendición y el ítem. Las comparten la ubicación de una
// aplicación y los candidatos.

const ClienteDeUbicacion = z.object({
  id: z.string().uuid(),
  denominacion: z.string(),
  /** Para avisar si el cliente no está activo; qué se permite en ese caso lo decide el backend. */
  estado: ClienteEstado,
});

const RendicionDeUbicacion = z.object({
  id: z.string().uuid(),
  anio: z.number().int(),
  mes: z.number().int(),
  numeroFactura: z.string(),
});

/** El ítem con su snapshot: el nombre del tipo es el de la foto, no el del catálogo. */
const ItemDeUbicacion = z.object({
  id: z.string().uuid(),
  tipoDocumentoId: z.string().uuid(),
  nombreTipoDocumento: z.string(),
  ordinal: z.number().int().min(1),
  totalOrdinal: z.number().int().min(1),
  diaAproximado: z.number().int().nullable(),
});

/**
 * Dónde está una aplicación. La rendición lleva su estado: una aplicación en una rendición
 * anulada se conserva como historial y se sigue mostrando, marcada.
 */
export const UbicacionDeAplicacionSchema = z.object({
  cliente: ClienteDeUbicacion,
  rendicion: RendicionDeUbicacion.extend({ estado: RendicionEstado }),
  item: ItemDeUbicacion,
});

export type UbicacionDeAplicacion = z.infer<typeof UbicacionDeAplicacionSchema>;

/** Una aplicación con el lugar donde está. */
export const AplicacionUbicadaSchema = CamposDeAplicacion.extend({
  ubicacion: UbicacionDeAplicacionSchema,
}).superRefine(estadoCoherente);

export type AplicacionUbicada = z.infer<typeof AplicacionUbicadaSchema>;

/**
 * Un documento con todas sus aplicaciones, vigentes y reemplazadas: "dónde se usó". Es la forma
 * del repositorio por período, del detalle de un documento y de la respuesta al aplicarlo.
 */
export const DocumentoConAplicacionesSchema = DocumentoSchema.extend({
  aplicaciones: z.array(AplicacionUbicadaSchema),
});

export type DocumentoConAplicaciones = z.infer<typeof DocumentoConAplicacionesSchema>;

/** Una aplicación con su documento: un paso del historial de un ítem. */
export const AplicacionConDocumentoSchema = CamposDeAplicacion.extend({
  documento: DocumentoSchema,
}).superRefine(estadoCoherente);

export type AplicacionConDocumento = z.infer<typeof AplicacionConDocumentoSchema>;

/**
 * Historial de documentos de un ítem: todas sus aplicaciones, de la más reciente a la más vieja.
 * A lo sumo una es VIGENTE (la primera). Una lista vacía es un ítem al que nunca se le aplicó un
 * documento.
 */
export const HistorialDeItemSchema = z.object({
  itemChecklistId: z.string().uuid(),
  aplicaciones: z.array(AplicacionConDocumentoSchema),
});

export type HistorialDeItem = z.infer<typeof HistorialDeItemSchema>;

// ─── Candidatos ───────────────────────────────────────────────────────────────

/**
 * Qué se puede hacer con un ítem candidato para un documento:
 * - `ELEGIBLE`: no tiene documento vigente; se le puede aplicar.
 * - `YA_TIENE_ESTE_DOCUMENTO`: el documento ya está vigente en el ítem; no hay nada que hacer.
 * - `TIENE_OTRO_DOCUMENTO`: tiene otro documento vigente; solo se cambia reemplazándolo.
 */
export const ElegibilidadCandidato = z.enum([
  'ELEGIBLE',
  'YA_TIENE_ESTE_DOCUMENTO',
  'TIENE_OTRO_DOCUMENTO',
]);

export type ElegibilidadCandidato = z.infer<typeof ElegibilidadCandidato>;

/**
 * Un ítem al que se podría aplicar un documento: del mismo tipo de documento (el del snapshot del
 * ítem, no el de la matriz actual) y de una rendición ACTIVA del mismo período. Las anuladas no
 * son candidatas. El sistema solo sugiere: la operadora elige cada ítem (Print 1/5, 2/5…) y nada
 * se aplica solo.
 */
export const CandidatoAplicacionSchema = z.object({
  cliente: ClienteDeUbicacion,
  rendicion: RendicionDeUbicacion,
  item: ItemDeUbicacion,
  elegibilidad: ElegibilidadCandidato,
});

export type CandidatoAplicacion = z.infer<typeof CandidatoAplicacionSchema>;

// ─── Operaciones ──────────────────────────────────────────────────────────────

/** Tope técnico de ítems por pedido. No es una regla de negocio: se ajusta si hace falta. */
export const MAX_ITEMS_A_APLICAR = 500;

export const MENSAJE_ITEM_IDS = 'Elegí al menos un ítem, sin repetir, con IDs UUID válidos.';

/**
 * Cuerpo para aplicar un documento (el de la ruta) a los ítems elegidos: al menos uno, sin
 * repetir. Todo o nada: si un ítem no cumple (rendición anulada, otro tipo u otro período, ya tiene
 * un documento vigente), no se aplica a ninguno. Responde con `DocumentoConAplicacionesSchema`.
 */
export const AplicarDocumentoSchema = z.object({
  itemIds: z
    .array(z.string().uuid({ message: MENSAJE_ITEM_IDS }), {
      errorMap: () => ({ message: MENSAJE_ITEM_IDS }),
    })
    .min(1, { message: MENSAJE_ITEM_IDS })
    .max(MAX_ITEMS_A_APLICAR, {
      message: `Se puede aplicar a hasta ${MAX_ITEMS_A_APLICAR} ítems por vez.`,
    })
    .refine((ids) => new Set(ids).size === ids.length, { message: MENSAJE_ITEM_IDS }),
});

export type AplicarDocumentoDto = z.infer<typeof AplicarDocumentoSchema>;

/**
 * Cuerpo para reemplazar el documento vigente de un ítem (rendición e ítem van en la ruta).
 * `aplicacionVigenteId` es la aplicación que la operadora vio como vigente: si cambió en el medio,
 * el backend rechaza el reemplazo en vez de pisar otro (concurrencia optimista). Solo cambia ese
 * ítem: las aplicaciones del documento anterior en otros ítems no se tocan.
 */
export const ReemplazarDocumentoDeItemSchema = z.object({
  documentoId: z
    .string({ required_error: 'Elegí el documento nuevo.' })
    .uuid({ message: 'El ID del documento debe ser un UUID válido.' }),
  aplicacionVigenteId: z
    .string({ required_error: 'Falta la aplicación vigente que se reemplaza.' })
    .uuid({ message: 'El ID de la aplicación vigente debe ser un UUID válido.' }),
});

export type ReemplazarDocumentoDeItemDto = z.infer<typeof ReemplazarDocumentoDeItemSchema>;
