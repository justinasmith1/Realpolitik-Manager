import { z } from 'zod';

import { sinCaracteresDeControl } from './campos.js';
import { ClienteEstado, ClienteSector, ClienteSubtipoPublico } from './cliente.schema.js';

/**
 * Largo máximo de `q`: el de la columna más larga donde se busca (`razonSocial`, 150). Un texto
 * más largo no puede coincidir con nada y solo cargaría a la base con un patrón enorme.
 * Se exporta para que el buscador del front limite lo que se puede escribir con el mismo valor.
 */
export const MAX_BUSQUEDA_CLIENTES = 150;

/**
 * Parámetros de `GET /clientes` (query string).
 *
 * - `q`: texto libre de hasta `MAX_BUSQUEDA_CLIENTES` (150) caracteres y sin caracteres de control; sin espacios en los
 *   bordes. Un `q` vacío equivale a no enviarlo. Se busca tal cual: `%`, `_` y `\` no son comodines.
 * - `estado`: `ACTIVO` si no se envía.
 * - `subtipo`: solo existe para el sector público. Con `sector=PRIVADO`, o con un subtipo que
 *   no pertenece al sector, el pedido es inválido y el error apunta al campo `subtipo`.
 */
export const ListarClientesQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(MAX_BUSQUEDA_CLIENTES, {
        message: `La búsqueda no puede superar los ${MAX_BUSQUEDA_CLIENTES} caracteres.`,
      })
      .refine(sinCaracteresDeControl, {
        message: 'La búsqueda no puede contener caracteres de control.',
      })
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
