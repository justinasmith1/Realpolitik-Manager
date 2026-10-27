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
