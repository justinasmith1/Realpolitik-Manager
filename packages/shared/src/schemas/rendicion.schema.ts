import { z } from 'zod';

import { ANIO_MAX, ANIO_MIN, periodoMuyFuturo } from '../utils/periodo.js';

import { CanalEntrega } from './cliente.schema.js';
import { DocumentoDeItemSchema } from './documentoDeItem.schema.js';

/** Ejemplo del formato canónico del número de factura, para la ayuda y los errores. */
export const NUMERO_FACTURA_EJEMPLO = 'B 00002-00001482';

export const MENSAJE_NUMERO_FACTURA_OBLIGATORIO = 'El número de factura es obligatorio.';
export const MENSAJE_NUMERO_FACTURA_FORMATO = `El número de factura debe tener el formato letra (A, B o C), punto de venta de 5 dígitos y número de 8 dígitos, por ejemplo ${NUMERO_FACTURA_EJEMPLO}.`;

/**
 * Lo que se acepta al escribir: letra A, B o C (en mayúscula o minúscula), con o sin espacio,
 * punto de venta de 1 a 5 dígitos, un guion (con o sin espacios alrededor) y número de 1 a 8
 * dígitos. Entre las partes solo se aceptan espacios (no tabulaciones ni saltos de línea), y
 * `\d` en JavaScript son solo los dígitos ASCII.
 */
const NUMERO_FACTURA_ESCRITO = /^([abc]) *(\d{1,5}) *- *(\d{1,8})$/i;

/**
 * Número de factura en su formato canónico (`B 00002-00001482`), o `null` si no es un número de
 * factura argentina: letra en mayúscula, un espacio, punto de venta de 5 dígitos y número de 8,
 * completados con ceros a la izquierda. `b 2-1482` y `B 00002-00001482` dan lo mismo.
 */
export function normalizarNumeroFactura(valor: string): string | null {
  const partes = NUMERO_FACTURA_ESCRITO.exec(valor.trim());
  if (partes === null) return null;
  const [, letra = '', puntoDeVenta = '', numero = ''] = partes;
  return `${letra.toUpperCase()} ${puntoDeVenta.padStart(5, '0')}-${numero.padStart(8, '0')}`;
}

/**
 * Número de factura al escribir (alta de una rendición), ya en su formato canónico. Se normaliza
 * antes de validar: la unicidad de la base (cliente + número, entre las rendiciones activas)
 * compara el texto exacto, así que dos escrituras del mismo comprobante tienen que dar el mismo
 * valor. La lectura (`RendicionSchema`) no valida el formato: las rendiciones cargadas antes con
 * otro formato se siguen viendo.
 */
export const NumeroFacturaSchema = z
  .string({
    required_error: MENSAJE_NUMERO_FACTURA_OBLIGATORIO,
    invalid_type_error: 'El número de factura debe ser un texto.',
  })
  .transform((valor, ctx) => {
    if (valor.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_NUMERO_FACTURA_OBLIGATORIO });
      return z.NEVER;
    }
    const canonico = normalizarNumeroFactura(valor);
    if (canonico === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_NUMERO_FACTURA_FORMATO });
      return z.NEVER;
    }
    return canonico;
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
 *
 * `documento` es el documento vigente del ítem (HU2.8, ADR-0004): `null` si no tiene. Por ahora
 * es opcional porque el backend todavía no lo devuelve; cuando lo haga, pasa a obligatorio (y
 * sigue admitiendo `null`).
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
  documento: DocumentoDeItemSchema.nullable().optional(),
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
