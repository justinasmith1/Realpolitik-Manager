import { z } from 'zod';

import { CanalEntrega } from './cliente.schema.js';

export const MENSAJE_CANAL_DE_ITEM = 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.';

/**
 * Cuerpo de `PATCH /rendiciones/:id/items/:itemId/canal`: el canal correcto de un ítem del
 * checklist. Es la única parte del snapshot que se puede corregir (ADR-0003): el resto del ítem
 * (tipo, ordinal, día aproximado) no cambia. Usa el enum de canal del cliente, sin duplicarlo.
 */
export const ActualizarCanalDeItemSchema = z.object({
  canalEntrega: z.enum(CanalEntrega.options, {
    errorMap: () => ({ message: MENSAJE_CANAL_DE_ITEM }),
  }),
});

export type ActualizarCanalDeItemDto = z.infer<typeof ActualizarCanalDeItemSchema>;

// ─── Propagar el canal de un requisito a rendiciones abiertas ─────────────────────────────

/** Tope de rendiciones por pedido: alcanza para años de rendiciones mensuales. */
export const MAX_RENDICIONES_A_PROPAGAR = 200;

export const MENSAJE_RENDICION_IDS =
  'Elegí al menos una rendición, sin repetir, con IDs UUID válidos.';

/**
 * Cuerpo de `POST /clientes/:id/requisitos/:requisitoId/propagar-canal`: las rendiciones
 * activas del cliente en las que los ítems de ese requisito pasan al canal efectivo actual del
 * requisito (ADR-0003). El canal no viaja en el cuerpo: lo resuelve el backend con el requisito y
 * el cliente, igual que al abrir una rendición. Al menos una, sin repetir.
 */
export const PropagarCanalDeRequisitoSchema = z.object({
  rendicionIds: z
    .array(z.string().uuid({ message: MENSAJE_RENDICION_IDS }), {
      errorMap: () => ({ message: MENSAJE_RENDICION_IDS }),
    })
    .min(1, { message: MENSAJE_RENDICION_IDS })
    .max(MAX_RENDICIONES_A_PROPAGAR, {
      message: `Se pueden actualizar hasta ${MAX_RENDICIONES_A_PROPAGAR} rendiciones por vez.`,
    })
    .refine((ids) => new Set(ids).size === ids.length, { message: MENSAJE_RENDICION_IDS }),
});

export type PropagarCanalDeRequisitoDto = z.infer<typeof PropagarCanalDeRequisitoSchema>;

/**
 * Respuesta de la propagación: el canal aplicado y, por cada rendición pedida (en el mismo
 * orden), cuántos de sus ítems cambiaron. Un ítem que ya tenía ese canal no se cuenta.
 */
export const ResultadoPropagarCanalSchema = z.object({
  canalEntrega: CanalEntrega,
  rendiciones: z.array(
    z.object({
      rendicionId: z.string().uuid(),
      itemsActualizados: z.number().int().min(0),
    }),
  ),
});

export type ResultadoPropagarCanal = z.infer<typeof ResultadoPropagarCanalSchema>;
