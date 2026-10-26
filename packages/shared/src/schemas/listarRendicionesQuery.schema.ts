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
 * Qué rendiciones lista `GET /clientes/:id/rendiciones` según su estado: las activas, las
 * anuladas o todas. Una anulada es la baja lógica de la rendición: no hay otro estado oculto.
 */
export const FiltroEstadoRendiciones = z.enum(['ACTIVA', 'ANULADA', 'TODAS'], {
  errorMap: () => ({ message: 'El estado debe ser ACTIVA, ANULADA o TODAS.' }),
});

export type FiltroEstadoRendiciones = z.infer<typeof FiltroEstadoRendiciones>;

/**
 * Sin `estado`, se listan las activas. El valor no se completa en el schema: así un pedido sin el
 * parámetro sigue siendo `{}` (el frontend no lo escribe en la URL) y lo aplica el backend.
 */
export const FILTRO_ESTADO_POR_DEFECTO: FiltroEstadoRendiciones = 'ACTIVA';

/**
 * Parámetros de `GET /clientes/:id/rendiciones` (query string).
 *
 * - `anio`: entero de 2020 a 2100. Opcional.
 * - `mes`: entero de 1 a 12. Opcional; se puede combinar con `anio` o usar solo.
 * - `estado`: `ACTIVA`, `ANULADA` o `TODAS`. Opcional; sin él, `ACTIVA`
 *   (`FILTRO_ESTADO_POR_DEFECTO`).
 *
 * Sin `anio` ni `mes`, no se filtra por período. Se entregan ya como números.
 */
export const ListarRendicionesQuerySchema = z.object({
  anio: enteroDeQuery(AnioSchema, MENSAJE_ANIO).optional(),
  mes: enteroDeQuery(MesSchema, MENSAJE_MES).optional(),
  estado: FiltroEstadoRendiciones.optional(),
});

export type ListarRendicionesQuery = z.infer<typeof ListarRendicionesQuerySchema>;
