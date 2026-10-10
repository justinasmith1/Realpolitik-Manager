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
