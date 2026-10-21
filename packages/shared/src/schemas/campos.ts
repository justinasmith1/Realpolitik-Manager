import { z } from 'zod';

// Piezas de validación que comparten Cliente y Contacto. Los largos máximos son los de las
// columnas de la base (`apps/backend/prisma/schema.prisma`): un dato que shared acepta y la
// base no, termina en un 500 en vez de un 400.

/** Largo máximo de un email: es el `VarChar(254)` de las columnas. */
export const EMAIL_MAX = 254;

// C0 (incluye NUL, que PostgreSQL no puede guardar en un texto), DEL y C1.
// eslint-disable-next-line no-control-regex
const CARACTERES_DE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * `true` si el texto no tiene caracteres de control. Un NUL (`\u0000`) hace fallar a
 * PostgreSQL con un error de codificación; el resto (saltos de línea, tabulaciones) no tiene
 * sentido en un nombre, una URL o una búsqueda. Los bordes ya los recortó `.trim()`.
 */
export const sinCaracteresDeControl = (valor: string): boolean =>
  !CARACTERES_DE_CONTROL.test(valor);

interface MensajesDeEmail {
  /** El texto no tiene forma de email. */
  formato: string;
  /** El texto supera `EMAIL_MAX`. */
  largo: string;
}

/**
 * Email normalizado: sin espacios en los bordes, de hasta `EMAIL_MAX` caracteres y en
 * minúsculas. El orden importa: `.trim()` antes de `.max()`, para medir el largo del valor ya
 * normalizado, y `.toLowerCase()` al final. El formato exige ASCII, así que pasar a minúsculas
 * nunca agranda el texto.
 */
export function emailNormalizado({ formato, largo }: MensajesDeEmail) {
  return z
    .string()
    .trim()
    .max(EMAIL_MAX, { message: largo })
    .email({ message: formato })
    .toLowerCase();
}

/** Posiciones de cada valor que aparece más de una vez (los `undefined` no cuentan). */
export function repetidos(valores: (string | undefined)[]): number[][] {
  const posiciones = new Map<string, number[]>();
  valores.forEach((valor, indice) => {
    if (valor === undefined) return;
    posiciones.set(valor, [...(posiciones.get(valor) ?? []), indice]);
  });
  return [...posiciones.values()].filter((indices) => indices.length > 1);
}

// C0 sin salto de línea (\n) ni retorno de carro (\r), DEL y C1.
// eslint-disable-next-line no-control-regex
const CONTROL_SALVO_SALTOS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

interface OpcionesTextoOpcional {
  /** Cómo se nombra el campo en los mensajes, con su artículo: "La nota". */
  nombre: string;
  /** `nombre` está en plural ("Las indicaciones"): "no pueden" en vez de "no puede". */
  plural?: boolean;
  /** Largo máximo, el de la columna de la base. */
  max: number;
  /** Admite `\n` y `\r` (un texto de varias líneas). El resto de los caracteres de control no. */
  permitirSaltosDeLinea?: boolean;
  /** Mensaje si el campo falta. Sin esto, se usa el de Zod. */
  requerido?: string;
}

/**
 * Texto libre opcional: sin espacios en los bordes, de hasta `max` caracteres y sin caracteres de
 * control. Un texto vacío o de solo espacios queda como `null`, así la base nunca guarda `''`.
 * Devuelve `string | null`: quien lo use como opcional le suma `.nullable()` y, según el caso,
 * `.default(null)` o `.optional()`.
 *
 * El orden importa: `.trim()` antes de `.max()`, para medir el largo del valor ya recortado.
 */
export function textoOpcional({
  nombre,
  max,
  plural = false,
  permitirSaltosDeLinea = false,
  requerido,
}: OpcionesTextoOpcional) {
  const noPuede = plural ? 'no pueden' : 'no puede';
  return z
    .string({
      ...(requerido === undefined ? {} : { required_error: requerido }),
      invalid_type_error: `${nombre} debe ser un texto.`,
    })
    .trim()
    .max(max, { message: `${nombre} ${noPuede} superar los ${max} caracteres.` })
    .refine(
      permitirSaltosDeLinea
        ? (valor: string) => !CONTROL_SALVO_SALTOS.test(valor)
        : sinCaracteresDeControl,
      {
        message: permitirSaltosDeLinea
          ? `${nombre} ${noPuede} contener caracteres de control, salvo saltos de línea.`
          : `${nombre} ${noPuede} contener caracteres de control.`,
      },
    )
    .transform((valor) => (valor === '' ? null : valor));
}

/** Para los `superRefine` de un PATCH: exige que el pedido modifique algo. */
export function exigirAlgunCampo(datos: object, ctx: z.RefinementCtx): void {
  if (Object.values(datos).every((valor) => valor === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enviá al menos un campo para modificar.',
    });
  }
}

/**
 * Booleano de un query string, que llega como el texto `'true'` o `'false'`. Cualquier otro valor
 * (incluido `'1'` o `'TRUE'`) es un error: no se adivina qué quiso decir quien llamó.
 */
export function booleanoDeQuery(campo: string) {
  return z
    .enum(['true', 'false'], {
      errorMap: () => ({ message: `${campo} debe ser true o false.` }),
    })
    .transform((valor) => valor === 'true');
}
