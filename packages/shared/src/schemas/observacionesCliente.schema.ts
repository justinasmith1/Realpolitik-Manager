import { z } from 'zod';

import { textoOpcional } from './campos.js';

/** Largo de `Cliente.observaciones` (`apps/backend/prisma/schema.prisma`). */
export const OBSERVACIONES_CLIENTE_MAX = 1000;

/**
 * Cuerpo de `PUT /clientes/:id/observaciones` (HU2.10) y respuesta de su `GET`.
 *
 * Una sola nota interna por cliente, que se reemplaza al guardar. La clave es obligatoria: un
 * texto, o `null` para borrarla. El texto se recorta, llega hasta 1000 caracteres y, vacío o de
 * solo espacios, se guarda como `null`.
 *
 * Igual que las indicaciones de armado, **admite saltos de línea** (`\n` y `\r`, sin normalizar
 * `\r\n`): es una excepción explícita a la regla de caracteres de control. El resto de los
 * caracteres de control (tabulaciones incluidas) sigue rechazado.
 */
export const ObservacionesClienteSchema = z.object({
  observaciones: textoOpcional({
    nombre: 'Las observaciones',
    plural: true,
    max: OBSERVACIONES_CLIENTE_MAX,
    permitirSaltosDeLinea: true,
    requerido: 'Enviá "observaciones": un texto, o null para borrarlas.',
  }).nullable(),
});

export type ObservacionesClienteDto = z.infer<typeof ObservacionesClienteSchema>;

/**
 * Respuesta de `GET /clientes/:id/observaciones`. A diferencia del de escritura, **no rechaza
 * caracteres de control**: lo que ya está en la base se devuelve tal cual, así un tabulador
 * guardado antes no hace fallar la lectura.
 */
export const ObservacionesClienteLecturaSchema = z.object({
  observaciones: z.string().max(OBSERVACIONES_CLIENTE_MAX).nullable(),
});

export type ObservacionesClienteLecturaDto = z.infer<typeof ObservacionesClienteLecturaSchema>;
