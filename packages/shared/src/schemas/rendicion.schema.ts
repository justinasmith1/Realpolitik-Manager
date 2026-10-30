import { z } from 'zod';

import { ANIO_MAX, ANIO_MIN, periodoMuyFuturo } from '../utils/periodo.js';

import { CanalEntrega, Emisor } from './cliente.schema.js';
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
 * antes de validar: la unicidad de la base (emisor + número, entre las rendiciones activas)
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

// ─── Orden de compra (HU2.11) ─────────────────────────────────────────────────
// Los tres datos son opcionales y pertenecen a la rendición, no al cliente. El período no se pide:
// se hereda de la rendición.

export const NUMERO_OC_MAX = 100;
/** Tope de `DECIMAL(14,2)`: 12 dígitos enteros y 2 decimales. */
export const MONTO_OC_MAX = 999_999_999_999.99;

export const MENSAJE_NUMERO_OC = `El número de OC debe tener entre 1 y ${NUMERO_OC_MAX} caracteres.`;
export const MENSAJE_MONTO_OC =
  'El monto debe ser un número mayor o igual a 0, con hasta 2 decimales.';

/** Número de OC: texto recortado y no vacío. No tiene formato propio. */
export const NumeroOcSchema = z
  .string({ invalid_type_error: MENSAJE_NUMERO_OC })
  .trim()
  .min(1, { message: MENSAJE_NUMERO_OC })
  .max(NUMERO_OC_MAX, { message: MENSAJE_NUMERO_OC });

/** Monto de la OC: no negativo, hasta 2 decimales y dentro del rango de la columna. */
export const MontoOcSchema = z
  .number({ invalid_type_error: MENSAJE_MONTO_OC })
  .finite({ message: MENSAJE_MONTO_OC })
  .min(0, { message: MENSAJE_MONTO_OC })
  .max(MONTO_OC_MAX, { message: MENSAJE_MONTO_OC })
  .refine((monto) => Math.abs(Math.round(monto * 100) - monto * 100) < 1e-6, {
    message: MENSAJE_MONTO_OC,
  });

/** Los tres datos de la OC, todos opcionales. */
const DatosOcCreacionShape = {
  numeroOc: NumeroOcSchema.optional(),
  montoMensual: MontoOcSchema.optional(),
  montoTotal: MontoOcSchema.optional(),
};

/**
 * Cuerpo de `POST /clientes/:id/rendiciones`: `anio`, `mes`, `numeroFactura` y, opcional, el
 * `emisor` (HU2.9) y los datos de la OC (HU2.11). Ningún otro dato: no hay decisiones de
 * condicionales, todos los requisitos activos entran en el checklist.
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
    /**
     * Emisor de la factura (HU2.9). Opcional: sin él, el servidor usa el emisor habitual del
     * cliente, y si el cliente tampoco tiene, responde 400 en `emisor`. `null` no se acepta.
     */
    emisor: Emisor.optional(),
    ...DatosOcCreacionShape,
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

export const MENSAJE_ACTUALIZAR_OC_VACIO = 'Indicá al menos un dato de la OC para actualizar.';

/**
 * Cuerpo de `PATCH /rendiciones/:id` (HU2.11): edita los datos de la OC. Cada campo es opcional:
 * ausente no se toca, `null` lo borra. Tiene que venir al menos uno.
 */
export const ActualizarRendicionSchema = z
  .object({
    numeroOc: NumeroOcSchema.nullable().optional(),
    montoMensual: MontoOcSchema.nullable().optional(),
    montoTotal: MontoOcSchema.nullable().optional(),
  })
  .refine(
    (datos) =>
      datos.numeroOc !== undefined ||
      datos.montoMensual !== undefined ||
      datos.montoTotal !== undefined,
    { message: MENSAJE_ACTUALIZAR_OC_VACIO },
  );

export type ActualizarRendicionDto = z.infer<typeof ActualizarRendicionSchema>;

/**
 * Respuesta de `GET /clientes/:id/ultima-oc`: los datos de la OC de la rendición más reciente del
 * cliente que tenga número de OC, o `null` si ninguna lo tiene.
 */
export const UltimaOcSchema = z
  .object({
    numeroOc: z.string(),
    montoMensual: z.number().nullable(),
    montoTotal: z.number().nullable(),
  })
  .nullable();

export type UltimaOc = z.infer<typeof UltimaOcSchema>;

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
 * `documento` es el documento vigente del ítem (HU2.8, ADR-0004): `null` si no tiene. El backend
 * ya lo manda siempre en el detalle; sigue opcional en el contrato hasta que el frontend lo use,
 * y ahí pasa a obligatorio (y sigue admitiendo `null`).
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
  /**
   * Emisor de la factura (HU2.9): una foto tomada al abrir la rendición. `null` en las
   * rendiciones anteriores a HU2.9, que no tienen emisor. Al leer, una clave ausente es `null`
   * (como `estado` en el cliente): un registro anterior no rompe el listado.
   */
  emisor: Emisor.nullable().default(null),
  /** Orden de compra (HU2.11). `null` si no se cargó; una clave ausente también es `null`. */
  numeroOc: z.string().nullable().default(null),
  montoMensual: z.number().nullable().default(null),
  montoTotal: z.number().nullable().default(null),
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
