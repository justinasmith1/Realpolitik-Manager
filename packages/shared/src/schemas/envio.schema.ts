import { z } from 'zod';

import { CanalEntrega } from './cliente.schema.js';
import { DocumentoDeItemSchema } from './documentoDeItem.schema.js';
import { ItemChecklistSchema } from './rendicion.schema.js';

// Preparación del envío de una rendición (HU2.5 con HU2.8). El sistema no envía nada: comprueba
// que los ítems elegidos se pueden enviar y devuelve sus datos para que la operadora lo haga por
// el canal. No guarda nada ni cambia el estado de la rendición.

/** Tope técnico de ítems por pedido, como al aplicar un documento. No es una regla de negocio. */
export const MAX_ITEMS_A_ENVIAR = 500;

export const MENSAJE_ITEMS_A_ENVIAR =
  'Elegí al menos un ítem para enviar, sin repetir, con IDs UUID válidos.';

/** Cuerpo de `POST /rendiciones/:id/preparar-envio`: los ítems elegidos, sin repetir. */
export const PrepararEnvioSchema = z.object({
  itemIds: z
    .array(z.string().uuid({ message: MENSAJE_ITEMS_A_ENVIAR }), {
      errorMap: () => ({ message: MENSAJE_ITEMS_A_ENVIAR }),
    })
    .min(1, { message: MENSAJE_ITEMS_A_ENVIAR })
    .max(MAX_ITEMS_A_ENVIAR, {
      message: `Se pueden enviar hasta ${MAX_ITEMS_A_ENVIAR} ítems por vez.`,
    })
    .refine((ids) => new Set(ids).size === ids.length, { message: MENSAJE_ITEMS_A_ENVIAR }),
});

export type PrepararEnvioDto = z.infer<typeof PrepararEnvioSchema>;

/**
 * Por qué un ítem no se puede enviar (es también el `motivo` del 409 de la preparación):
 * - `ITEM_PENDIENTE`: no está completado.
 * - `ITEM_SIN_DOCUMENTO_VIGENTE`: figura completado pero no tiene una aplicación documental
 *   vigente (por ejemplo, un dato anterior a HU2.8). No alcanza con `completado`: se envía un
 *   documento, y tiene que existir.
 */
export const MotivoNoEnviable = z.enum(['ITEM_PENDIENTE', 'ITEM_SIN_DOCUMENTO_VIGENTE']);

export type MotivoNoEnviable = z.infer<typeof MotivoNoEnviable>;

/**
 * Un ítem que se puede enviar: completado y con su documento vigente. Es una especialización de
 * `ItemChecklistSchema` solo para esta respuesta: en el checklist `documento` sigue opcional.
 */
export const ItemEnviableSchema = ItemChecklistSchema.extend({
  completado: z.literal(true),
  documento: DocumentoDeItemSchema,
});

export type ItemEnviable = z.infer<typeof ItemEnviableSchema>;

/** Respuesta de la preparación: el canal único de la selección y sus ítems, en orden. */
export const PreparacionEnvioSchema = z.object({
  rendicionId: z.string().uuid(),
  canal: CanalEntrega,
  items: z.array(ItemEnviableSchema).min(1),
});

export type PreparacionEnvio = z.infer<typeof PreparacionEnvioSchema>;
