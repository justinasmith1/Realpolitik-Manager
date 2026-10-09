import { z } from 'zod';

import { ClienteEstado, ClienteSector, ClienteSubtipoPublico } from './cliente.schema.js';

/**
 * Parámetros de `GET /clientes` (query string).
 *
 * - `q`: texto libre; sin espacios en los bordes. Un `q` vacío equivale a no enviarlo.
 * - `estado`: `ACTIVO` si no se envía.
 * - `subtipo`: solo existe para el sector público. Con `sector=PRIVADO`, o con un subtipo que
 *   no pertenece al sector, el pedido es inválido y el error apunta al campo `subtipo`.
 */
export const ListarClientesQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .optional()
      .transform((valor) => (valor === '' ? undefined : valor)),
    estado: ClienteEstado.default('ACTIVO'),
    sector: ClienteSector.optional(),
    subtipo: ClienteSubtipoPublico.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.subtipo !== undefined && query.sector === 'PRIVADO') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subtipo'],
        message: 'Los clientes privados no tienen subtipo.',
      });
    }
  });

export type ListarClientesQuery = z.infer<typeof ListarClientesQuerySchema>;
