import { z } from 'zod';

import { booleanoDeQuery } from './campos.js';

/**
 * Parámetros de `GET /tipos-documento` (query string).
 *
 * - `incluirInactivos`: `'true'` o `'false'`; sin el parámetro, `false` (solo activos). Se
 *   entrega ya como booleano.
 */
export const ListarTiposDocumentoQuerySchema = z.object({
  incluirInactivos: booleanoDeQuery('incluirInactivos')
    .optional()
    .transform((valor) => valor ?? false),
});

export type ListarTiposDocumentoQuery = z.infer<typeof ListarTiposDocumentoQuerySchema>;
