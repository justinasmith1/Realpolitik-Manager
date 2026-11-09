// Período (año y mes) de una rendición. El rango de años es el de la base (ck_rendicion_mes).

/** Primer año admitido en una rendición. */
export const ANIO_MIN = 2020;

/** Último año admitido en una rendición. */
export const ANIO_MAX = 2100;

export interface Periodo {
  anio: number;
  mes: number;
}

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

// Se crea la primera vez que se usa y se reutiliza después: importar el paquete no depende de
// este constructor (crearlo es lo más caro de la función).
let formato: Intl.DateTimeFormat | undefined;

/**
 * Año y mes de `ahora` en horario de Buenos Aires. No en UTC: a las 23:30 del último día del mes
 * en Argentina ya es el mes siguiente en UTC, y la operadora todavía está en el mes anterior.
 * La fecha se lee al llamar, nunca al importar el módulo, para que el valor no quede congelado.
 *
 * El horario de Buenos Aires es intencional también en el front: la regla del período la aplica
 * el backend con este mismo cálculo, y el formulario tiene que coincidir con él aunque el
 * navegador esté en otro huso.
 */
export function mesActual(ahora: Date = new Date()): Periodo {
  formato ??= new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: 'numeric',
  });
  const partes = formato.formatToParts(ahora);
  const valor = (tipo: 'year' | 'month') =>
    Number(partes.find((parte) => parte.type === tipo)?.value);
  return { anio: valor('year'), mes: valor('month') };
}

/**
 * El período como un número absoluto de meses, para comparar, restar o correr períodos con un solo
 * número. Base 0: enero del año 0 es el mes 0, así la inversa (`mesesAPeriodo`) sale directa con
 * división y resto. Diciembre de 2026 es 24323 y enero de 2027, 24324.
 */
export const periodoAMeses = ({ anio, mes }: Periodo): number => anio * 12 + (mes - 1);

/** La inversa de `periodoAMeses`: el período de un número absoluto de meses (base 0). */
export function mesesAPeriodo(meses: number): Periodo {
  return { anio: Math.floor(meses / 12), mes: (meses % 12) + 1 };
}

/**
 * `true` si el período es posterior al mes siguiente al actual. Cualquier mes pasado vale: se
 * rinde con retraso. El máximo es el mes siguiente porque se puede abrir la rendición por
 * adelantado, pero no más.
 */
export function periodoMuyFuturo(periodo: Periodo, ahora: Date = new Date()): boolean {
  return periodoAMeses(periodo) > periodoAMeses(mesActual(ahora)) + 1;
}
