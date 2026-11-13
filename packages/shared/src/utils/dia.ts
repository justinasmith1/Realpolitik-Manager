import type { Periodo } from './periodo.js';

// Días de calendario (`AAAA-MM-DD`), sin hora: la fecha de envío de una rendición (HU3.7). "Hoy" se
// toma en horario de Buenos Aires, como el período (`mesActual`): a las 22 h del 31 en Argentina
// ya es el día siguiente en UTC, y la operadora todavía está en el 31.

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

/**
 * Desfasaje de Buenos Aires respecto de UTC. Argentina no cambia la hora desde 2009: es fijo.
 * Si algún día volviera el horario de verano, hay que calcularlo con la zona horaria.
 */
const DESFASAJE_BUENOS_AIRES = '-03:00';

const FORMATO_DE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Se crea la primera vez que se usa, como en `mesActual`.
let formato: Intl.DateTimeFormat | undefined;

/** `true` si el texto es un día de calendario que existe, con el formato `AAAA-MM-DD`. */
export function esDiaValido(texto: string): boolean {
  const partes = FORMATO_DE_DIA.exec(texto);
  if (partes === null) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  );
}

/** El día de `ahora` en horario de Buenos Aires, como `AAAA-MM-DD`. Se lee al llamar. */
export function hoyEnBuenosAires(ahora: Date = new Date()): string {
  formato ??= new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const partes = formato.formatToParts(ahora);
  const valor = (tipo: 'year' | 'month' | 'day') =>
    partes.find((parte) => parte.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** El primer día del período: el 1 de su mes. */
export const primerDiaDelPeriodo = ({ anio, mes }: Periodo): string =>
  `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`;

/**
 * El instante en que empieza el día en Buenos Aires. Sirve para mostrar un día con los formatos de
 * fecha de la interfaz, que usan el horario de Buenos Aires: así "08/11" no se corre al 07/11.
 */
export const inicioDelDiaEnBuenosAires = (dia: string): Date =>
  new Date(`${dia}T00:00:00${DESFASAJE_BUENOS_AIRES}`);

/** "08/11/2026": un día de calendario como lo lee la operadora. */
export function diaLegible(dia: string): string {
  const [anio, mes, numero] = dia.split('-');
  return `${numero}/${mes}/${anio}`;
}
