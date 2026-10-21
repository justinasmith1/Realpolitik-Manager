import { z } from 'zod';

import { ANIO_MAX, ANIO_MIN, periodoMuyFuturo } from '../utils/periodo.js';

import { sinCaracteresDeControl } from './campos.js';
import { CanalEntrega } from './cliente.schema.js';

// Largo de `Rendicion.numeroFactura` (`apps/backend/prisma/schema.prisma`).
const NUMERO_FACTURA_MAX = 100;

/**
 * Número de factura normalizado: sin espacios en los bordes, en mayúsculas, de 1 a 100 caracteres
 * y sin caracteres de control. Se normaliza acá porque la unicidad de la base (cliente + número,
 * entre las rendiciones activas) compara el texto exacto: `fc-1` y `FC-1` serían dos facturas.
 *
 * El orden importa: `.trim()` antes de `.min()`/`.max()`, y `.toUpperCase()` también antes del
 * `.max()`, para medir el largo del valor final (`ß` pasa a `SS` y agranda el texto). Los espacios
 * internos se conservan.
 */
export const NumeroFacturaSchema = z
  .string({
    required_error: 'El número de factura es obligatorio.',
    invalid_type_error: 'El número de factura debe ser un texto.',
  })
  .trim()
  .toUpperCase()
  .min(1, { message: 'El número de factura es obligatorio.' })
  .max(NUMERO_FACTURA_MAX, {
    message: `El número de factura no puede superar los ${NUMERO_FACTURA_MAX} caracteres.`,
  })
  .refine(sinCaracteresDeControl, {
    message: 'El número de factura no puede contener caracteres de control.',
  });

export const MENSAJE_ANIO = `El año debe ser un número entero entre ${ANIO_MIN} y ${ANIO_MAX}.`;
export const MENSAJE_MES = 'El mes debe ser un número entero entre 1 y 12.';

/** Año de una rendición: entero de 2020 a 2100, como el CHECK de la base. */
export const AnioSchema = z
  .number({ required_error: MENSAJE_ANIO, invalid_type_error: MENSAJE_ANIO })
  .int({ message: MENSAJE_ANIO })
  .min(ANIO_MIN, { message: MENSAJE_ANIO })
  .max(ANIO_MAX, { message: MENSAJE_ANIO });

/** Mes de una rendición: entero de 1 a 12. */
export const MesSchema = z
  .number({ required_error: MENSAJE_MES, invalid_type_error: MENSAJE_MES })
  .int({ message: MENSAJE_MES })
  .min(1, { message: MENSAJE_MES })
  .max(12, { message: MENSAJE_MES });

/**
 * Cuerpo de `POST /clientes/:id/rendiciones`: `anio`, `mes` y `numeroFactura`. Ningún otro dato:
 * no hay decisiones de condicionales, todos los requisitos activos entran en el checklist.
 *
 * El período puede ser cualquier mes pasado y, como máximo, el mes siguiente al actual (horario de
 * Buenos Aires). Si no, el error cae en `mes`. Es una regla de escritura que depende del reloj:
 * la fecha se lee al validar, no al importar el módulo. Solo se evalúa si `anio` y `mes` ya son
 * válidos, para no sumar un segundo error a un mes fuera de 1 a 12.
 */
export const CreateRendicionSchema = z
  .object({
    anio: AnioSchema,
    mes: MesSchema,
    numeroFactura: NumeroFacturaSchema,
  })
  .superRefine((datos, ctx) => {
    if (!AnioSchema.safeParse(datos.anio).success || !MesSchema.safeParse(datos.mes).success) {
      return;
    }
    if (periodoMuyFuturo({ anio: datos.anio, mes: datos.mes })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mes'],
        message: 'El período no puede ser posterior al mes siguiente al actual.',
      });
    }
  });

export type CreateRendicionDto = z.infer<typeof CreateRendicionSchema>;

/**
 * Cuerpo de `PATCH /rendiciones/:id/estado` (HU2.5): solo `'ANULADA'`. La anulación no es
 * reversible, así que `'ACTIVA'` es un error, igual que cualquier otro valor.
 */
export const ActualizarEstadoRendicionSchema = z.object({
  estado: z.literal('ANULADA', {
    errorMap: () => ({
      message: 'El estado solo puede ser ANULADA: una rendición anulada no se reactiva.',
    }),
  }),
});

export type ActualizarEstadoRendicionDto = z.infer<typeof ActualizarEstadoRendicionSchema>;

// ─── Entidades de lectura ─────────────────────────────────────────────────────
// Son lo que devuelve la API: validan la forma, sin reglas de escritura (el período, las
// mayúsculas), para que un registro anterior a ellas no rompa un listado.

/** Estado derivado de la baja lógica: `ANULADA` si la rendición tiene `anuladaEn`. */
export const RendicionEstado = z.enum(['ACTIVA', 'ANULADA']);

export type RendicionEstado = z.infer<typeof RendicionEstado>;

/**
 * Un documento a presentar en una rendición: una foto del requisito tomada al abrirla
 * (ADR-0003). `canalEntrega` es el canal efectivo ya resuelto, nunca `null`. `completadoEn` es la
 * columna `completadoAt`.
 */
export const ItemChecklistSchema = z.object({
  id: z.string().uuid(),
  requisitoClienteId: z.string().uuid(),
  tipoDocumentoId: z.string().uuid(),
  nombreTipoDocumento: z.string(),
  ordinal: z.number().int().min(1),
  totalOrdinal: z.number().int().min(1),
  diaAproximado: z.number().int().nullable(),
  canalEntrega: CanalEntrega,
  completado: z.boolean(),
  completadoEn: z.coerce.date().nullable(),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type ItemChecklist = z.infer<typeof ItemChecklistSchema>;

/** Rendición sin ítems: lo que devuelve la anulación y base de las demás vistas. */
export const RendicionSchema = z.object({
  id: z.string().uuid(),
  clienteId: z.string().uuid(),
  anio: z.number().int(),
  mes: z.number().int(),
  numeroFactura: z.string(),
  estado: RendicionEstado,
  anuladaEn: z.coerce.date().nullable(),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type Rendicion = z.infer<typeof RendicionSchema>;

/** Rendición con su checklist: el detalle y la respuesta de alta. */
export const RendicionDetalleSchema = RendicionSchema.extend({
  items: z.array(ItemChecklistSchema),
});

export type RendicionDetalle = z.infer<typeof RendicionDetalleSchema>;

/** Rendición con el avance de su checklist, sin ítems: el listado de un cliente. */
export const RendicionResumenSchema = RendicionSchema.extend({
  resumen: z.object({
    totalItems: z.number().int().min(0),
    completados: z.number().int().min(0),
  }),
});

export type RendicionResumen = z.infer<typeof RendicionResumenSchema>;
