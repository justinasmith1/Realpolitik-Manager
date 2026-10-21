import { z } from 'zod';

import { AnioSchema, MENSAJE_ANIO, MENSAJE_MES, MesSchema } from './rendicion.schema.js';

/**
 * Un número entero de un query string. Llega como texto y se acepta solo si son dígitos puros:
 * `z.coerce.number()` también acepta `" 5 "`, `"1e1"` o `"0x10"`, y `''` pasaría a ser `0`.
 * Un texto que no cumple se informa con el mismo mensaje que un valor fuera de rango.
 */
function enteroDeQuery(rango: z.ZodType<number>, mensaje: string) {
  return z
    .string({ invalid_type_error: mensaje })
    .regex(/^\d+$/, { message: mensaje })
    .transform(Number)
    .pipe(rango);
}

/**
 * Parámetros de `GET /clientes/:id/rendiciones` (query string).
 *
 * - `anio`: entero de 2020 a 2100. Opcional.
 * - `mes`: entero de 1 a 12. Opcional; se puede combinar con `anio` o usar solo.
 *
 * Sin los parámetros, no se filtra. Se entregan ya como números.
 */
export const ListarRendicionesQuerySchema = z.object({
  anio: enteroDeQuery(AnioSchema, MENSAJE_ANIO).optional(),
  mes: enteroDeQuery(MesSchema, MENSAJE_MES).optional(),
});

export type ListarRendicionesQuery = z.infer<typeof ListarRendicionesQuerySchema>;
