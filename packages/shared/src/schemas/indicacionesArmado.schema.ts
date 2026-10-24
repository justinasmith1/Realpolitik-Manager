import { z } from 'zod';

import { textoOpcional } from './campos.js';

/** Largo de `Cliente.indicacionesArmado` (`apps/backend/prisma/schema.prisma`). */
export const INDICACIONES_ARMADO_MAX = 1000;

/**
 * Cuerpo de `PUT /clientes/:id/indicaciones-armado` (HU2.4) y respuesta de su `GET`.
 *
 * La clave es obligatoria: un texto, o `null` para borrar las indicaciones. El texto se recorta,
 * llega hasta 1000 caracteres y, vacío o de solo espacios, se guarda como `null`.
 *
 * Es el único texto del sistema que **admite saltos de línea** (`\n` y `\r`, sin normalizar
 * `\r\n`): es una excepción explícita a la regla de caracteres de control. El resto de los
 * caracteres de control (tabulaciones incluidas) sigue rechazado.
 */
export const IndicacionesArmadoSchema = z.object({
  indicacionesArmado: textoOpcional({
    nombre: 'Las indicaciones de armado',
    plural: true,
    max: INDICACIONES_ARMADO_MAX,
    permitirSaltosDeLinea: true,
    requerido: 'Enviá "indicacionesArmado": un texto, o null para borrarlas.',
  }).nullable(),
});

export type IndicacionesArmadoDto = z.infer<typeof IndicacionesArmadoSchema>;

/**
 * Respuesta de `GET /clientes/:id/indicaciones-armado`. A diferencia del de escritura, **no
 * rechaza caracteres de control**: lo que ya está en la base se devuelve tal cual, así un
 * tabulador guardado antes no hace fallar la lectura.
 */
export const IndicacionesArmadoLecturaSchema = z.object({
  indicacionesArmado: z.string().max(INDICACIONES_ARMADO_MAX).nullable(),
});

export type IndicacionesArmadoLecturaDto = z.infer<typeof IndicacionesArmadoLecturaSchema>;
