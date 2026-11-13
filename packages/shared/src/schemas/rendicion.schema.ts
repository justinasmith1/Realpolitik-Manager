import { z } from 'zod';

import {
  COBRO_NOTA_MAX,
  MENSAJE_FECHA_COBRO_FUTURA,
  MENSAJE_FECHA_COBRO_INVALIDA,
  MENSAJE_NOTA_COBRO,
} from '../utils/cobro.js';
import { esDiaValido, hoyEnBuenosAires } from '../utils/dia.js';
import {
  MENSAJE_FECHA_ENVIO_FUTURA,
  MENSAJE_FECHA_ENVIO_INVALIDA,
  MENSAJE_FECHA_ENVIO_SIN_ENVIADA,
} from '../utils/envioDeRendicion.js';
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

/**
 * Monto de la OC: no negativo, hasta 2 decimales y dentro del rango de la columna. Los decimales
 * se comparan con `toFixed(2)` y no multiplicando por 100: `268438263.29 * 100` da
 * `26843826329.000004` y rechazaría un monto válido.
 */
export const MontoOcSchema = z
  .number({ invalid_type_error: MENSAJE_MONTO_OC })
  .finite({ message: MENSAJE_MONTO_OC })
  .min(0, { message: MENSAJE_MONTO_OC })
  .max(MONTO_OC_MAX, { message: MENSAJE_MONTO_OC })
  .refine((monto) => Number(monto.toFixed(2)) === monto, { message: MENSAJE_MONTO_OC });

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
const CamposCreateRendicion = z.object({
  anio: AnioSchema,
  mes: MesSchema,
  numeroFactura: NumeroFacturaSchema,
  /**
   * Emisor de la factura (HU2.9). Opcional: sin él, el servidor usa el emisor habitual del
   * cliente, y si el cliente tampoco tiene, responde 400 en `emisor`. `null` no se acepta.
   */
  emisor: Emisor.optional(),
  ...DatosOcCreacionShape,
});

/** El período, como máximo, el mes siguiente al actual. La comparten el pedido y el formulario. */
function periodoHastaElMesSiguiente(datos: { anio: number; mes: number }, ctx: z.RefinementCtx) {
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
}

export const CreateRendicionSchema = CamposCreateRendicion.superRefine(periodoHastaElMesSiguiente);

export type CreateRendicionDto = z.infer<typeof CreateRendicionSchema>;

export const MENSAJE_EMISOR_OBLIGATORIO = 'Elegí el emisor de la factura.';

/**
 * El formulario "Abrir rendición" del frontend: el mismo pedido que `CreateRendicionSchema`, pero
 * con el `emisor` obligatorio. En el pedido es opcional porque el servidor completa el habitual
 * del cliente; el formulario lo precarga con ese y siempre lo manda, así que no lo deja vacío. Es
 * obligatorio en el campo (no en un refine aparte): el error sale junto con los de los otros
 * campos, aunque alguno no sea válido.
 */
export const AbrirRendicionFormSchema = CamposCreateRendicion.extend({
  emisor: z.enum(Emisor.options, {
    errorMap: () => ({ message: MENSAJE_EMISOR_OBLIGATORIO }),
  }),
}).superRefine(periodoHastaElMesSiguiente);

export type AbrirRendicionFormDto = z.infer<typeof AbrirRendicionFormSchema>;

/**
 * Cuerpo de `PATCH /rendiciones/:id/vigencia` (HU2.5): solo `'ANULADA'`. La anulación no es
 * reversible, así que `'ACTIVA'` es un error, igual que cualquier otro valor. Es la vigencia (la
 * baja lógica), no el estado del proceso (HU3.1).
 */
export const ActualizarVigenciaRendicionSchema = z.object({
  vigencia: z.literal('ANULADA', {
    errorMap: () => ({
      message: 'La vigencia solo puede ser ANULADA: una rendición anulada no se reactiva.',
    }),
  }),
});

export type ActualizarVigenciaRendicionDto = z.infer<typeof ActualizarVigenciaRendicionSchema>;

export const MENSAJE_ESTADO_ACTUALIZABLE =
  'El estado debe ser EN_CURSO, COMPLETA, ENVIADA, APROBADA o RECHAZADA.';
export const MENSAJE_MOTIVO_OBLIGATORIO = 'Indicá qué pidió corregir el cliente.';
export const MENSAJE_MOTIVO_SIN_RECHAZO = 'El motivo solo se indica al rechazar la rendición.';
/** Largo máximo del motivo del rechazo. */
export const MOTIVO_RECHAZO_MAX = 500;

/**
 * Cuerpo de `PATCH /rendiciones/:id/estado`: marca la rendición como completa o la vuelve a en
 * curso (HU3.6), registra que se envió (HU3.7) o registra la respuesta del cliente, aprobada o
 * rechazada (HU3.8).
 *
 * `fechaEnvio` (`AAAA-MM-DD`) solo con `ENVIADA`: el día en que se mandó, que puede ser anterior al
 * registro. Opcional: sin ella, hoy en Buenos Aires. No puede ser futura. Que no sea anterior al
 * período lo comprueba el servidor, que conoce la rendición (`problemaDeFechaEnvio`).
 *
 * `motivo` (HU3.8): qué pidió corregir el cliente. Obligatorio con `RECHAZADA` y solo con ella;
 * se recorta y tiene hasta `MOTIVO_RECHAZO_MAX` caracteres.
 */
export const ActualizarEstadoRendicionSchema = z
  .object({
    estado: z.enum(['EN_CURSO', 'COMPLETA', 'ENVIADA', 'APROBADA', 'RECHAZADA'], {
      errorMap: () => ({ message: MENSAJE_ESTADO_ACTUALIZABLE }),
    }),
    fechaEnvio: z
      .string({ invalid_type_error: MENSAJE_FECHA_ENVIO_INVALIDA })
      .refine(esDiaValido, MENSAJE_FECHA_ENVIO_INVALIDA)
      .optional(),
    motivo: z
      .string({ invalid_type_error: MENSAJE_MOTIVO_OBLIGATORIO })
      .trim()
      .min(1, { message: MENSAJE_MOTIVO_OBLIGATORIO })
      .max(MOTIVO_RECHAZO_MAX, {
        message: `El motivo no puede superar los ${MOTIVO_RECHAZO_MAX} caracteres.`,
      })
      .optional(),
  })
  .superRefine(({ estado, fechaEnvio, motivo }, ctx) => {
    if (fechaEnvio !== undefined) {
      if (estado !== 'ENVIADA') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fechaEnvio'],
          message: MENSAJE_FECHA_ENVIO_SIN_ENVIADA,
        });
      } else if (esDiaValido(fechaEnvio) && fechaEnvio > hoyEnBuenosAires()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fechaEnvio'],
          message: MENSAJE_FECHA_ENVIO_FUTURA,
        });
      }
    }
    if (estado === 'RECHAZADA' && motivo === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivo'],
        message: MENSAJE_MOTIVO_OBLIGATORIO,
      });
    } else if (estado !== 'RECHAZADA' && motivo !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivo'],
        message: MENSAJE_MOTIVO_SIN_RECHAZO,
      });
    }
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
 * Cuerpo de `PUT /rendiciones/:id/cobro` (HU3.10): el cobro que el cliente informó. Reemplaza el
 * cobro entero: sin `nota` (o con `null`) la nota queda vacía.
 *
 * `fecha` (`AAAA-MM-DD`): el día en que el cliente avisó el pago. No puede ser posterior a hoy
 * (Buenos Aires); no hay fecha mínima. `nota`: opcional, se recorta y tiene de 1 a
 * `COBRO_NOTA_MAX` caracteres (vacía se rechaza: para no tener nota se omite o se manda `null`).
 * Que la rendición sea cobrable lo comprueba el servidor.
 */
export const RegistrarCobroSchema = z
  .object({
    fecha: z.string({
      required_error: MENSAJE_FECHA_COBRO_INVALIDA,
      invalid_type_error: MENSAJE_FECHA_COBRO_INVALIDA,
    }),
    nota: z
      .string({ invalid_type_error: MENSAJE_NOTA_COBRO })
      .trim()
      .min(1, { message: MENSAJE_NOTA_COBRO })
      .max(COBRO_NOTA_MAX, { message: MENSAJE_NOTA_COBRO })
      .nullable()
      .optional(),
  })
  .superRefine(({ fecha }, ctx) => {
    if (!esDiaValido(fecha)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fecha'],
        message: MENSAJE_FECHA_COBRO_INVALIDA,
      });
    } else if (fecha > hoyEnBuenosAires()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fecha'],
        message: MENSAJE_FECHA_COBRO_FUTURA,
      });
    }
  });

export type RegistrarCobroDto = z.infer<typeof RegistrarCobroSchema>;

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

/** Vigencia derivada de la baja lógica: `ANULADA` si la rendición tiene `anuladaEn`. */
export const VigenciaRendicion = z.enum(['ACTIVA', 'ANULADA']);

export type VigenciaRendicion = z.infer<typeof VigenciaRendicion>;

// ─── Estado de la rendición (HU3.1, ADR-0005) ─────────────────────────────────
// En qué paso está: nace EN_CURSO y cada cambio queda en su historial. "Atrasada" no es un estado:
// la calcula el sistema (HU3.4). La anulación es aparte (`vigencia`): una anulada conserva el
// último estado que tenía.

export const MENSAJE_ESTADO_RENDICION =
  'El estado debe ser EN_CURSO, COMPLETA, ENVIADA, APROBADA o RECHAZADA.';

export const EstadoRendicion = z.enum(
  ['EN_CURSO', 'COMPLETA', 'ENVIADA', 'APROBADA', 'RECHAZADA'],
  {
    errorMap: () => ({ message: MENSAJE_ESTADO_RENDICION }),
  },
);

export type EstadoRendicion = z.infer<typeof EstadoRendicion>;

/** Cómo se lee cada estado en pantalla. */
export const ETIQUETAS_ESTADO_RENDICION: Record<EstadoRendicion, string> = {
  EN_CURSO: 'En curso',
  COMPLETA: 'Completa',
  ENVIADA: 'Enviada',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
};

/**
 * Un cambio de estado. `estadoAnterior` es `null` solo en la primera entrada, la del alta.
 * `fecha` es cuándo se registró el cambio (y ordena el historial). `fechaEfectiva` (HU3.7) es el
 * día en que ocurrió, si la operadora lo indicó y puede ser anterior al registro: hoy, solo la
 * fecha de envío de la entrada `ENVIADA` (`AAAA-MM-DD`); `null` en las demás. El backend
 * siempre la manda; es opcional en el contrato para no exigirla a quien no la usa. Para mostrar la fecha
 * de un paso, `fechaDelPaso`.
 */
export const HistorialEstadoRendicionSchema = z.object({
  estadoAnterior: EstadoRendicion.nullable(),
  estadoNuevo: EstadoRendicion,
  fecha: z.coerce.date(),
  fechaEfectiva: z.string().refine(esDiaValido).nullable().optional(),
  /** Texto que acompaña el cambio (HU3.8): qué pidió corregir el cliente en `RECHAZADA`. */
  motivo: z.string().nullable().optional(),
});

export type HistorialEstadoRendicion = z.infer<typeof HistorialEstadoRendicionSchema>;

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

/** El cobro de una rendición, como se lee (HU3.10): sin las reglas de escritura. */
export const CobroSchema = z.object({
  fecha: z.string().refine(esDiaValido),
  nota: z.string().nullable(),
});

export type Cobro = z.infer<typeof CobroSchema>;

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
  /**
   * Cobro informado por el cliente (HU3.10): `null` si no se marcó; una clave ausente también es
   * `null`. `fecha` es un día (`AAAA-MM-DD`); `nota`, el texto opcional. Es una marca de la
   * rendición, no un estado.
   */
  cobro: CobroSchema.nullable().default(null),
  /** En qué paso está (HU3.1). Independiente de la vigencia. */
  estado: EstadoRendicion,
  vigencia: VigenciaRendicion,
  anuladaEn: z.coerce.date().nullable(),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type Rendicion = z.infer<typeof RendicionSchema>;

/**
 * Rendición con su checklist: el detalle y la respuesta de alta. Lleva el historial de estados,
 * del cambio más viejo al más nuevo (HU3.1).
 */
export const RendicionDetalleSchema = RendicionSchema.extend({
  items: z.array(ItemChecklistSchema),
  historial: z.array(HistorialEstadoRendicionSchema),
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
