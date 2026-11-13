import type { EstadoRendicion } from '../schemas/rendicion.schema.js';

import {
  diaLegible,
  esDiaValido,
  hoyEnBuenosAires,
  inicioDelDiaEnBuenosAires,
  primerDiaDelPeriodo,
} from './dia.js';
import type { Periodo } from './periodo.js';

// Marcar una rendición como Enviada (HU3.7, ADR-0005 punto 10). El sistema no envía nada: la
// operadora la manda por su canal y después registra el envío con su fecha.

/**
 * Los estados en los que una rendición ya no se modifica: no se le aplican ni reemplazan
 * documentos, no se corrige ni propaga el canal y no se le suman requisitos. La OC sí se edita
 * (es un dato administrativo, no parte de lo que se mandó). Una Aprobada está cerrada (HU3.8); una
 * Rechazada sí se modifica: hay que corregirla (HU3.9).
 */
export const ESTADOS_NO_MODIFICABLES = [
  'ENVIADA',
  'APROBADA',
] as const satisfies readonly EstadoRendicion[];

/** `true` si a una rendición en este estado se le pueden cambiar documentos o canales. */
export const esRendicionModificable = (estado: EstadoRendicion): boolean =>
  !(ESTADOS_NO_MODIFICABLES as readonly EstadoRendicion[]).includes(estado);

export const MENSAJE_FECHA_ENVIO_INVALIDA = 'Ingresá una fecha válida (AAAA-MM-DD).';
export const MENSAJE_FECHA_ENVIO_FUTURA = 'La fecha de envío no puede ser posterior a hoy.';
export const MENSAJE_FECHA_ENVIO_SIN_ENVIADA =
  'La fecha de envío solo se indica al marcar la rendición como enviada.';

/** La rendición de octubre no se pudo mandar antes del 1 de octubre. */
export const mensajeFechaEnvioAnteriorAlPeriodo = (periodo: Periodo): string =>
  `La fecha de envío no puede ser anterior al ${diaLegible(primerDiaDelPeriodo(periodo))}, el primer día del período.`;

/**
 * Por qué la fecha de envío no vale, o `null` si vale: tiene que ser un día real, no posterior a
 * hoy (en Buenos Aires) y no anterior al primer día del período de la rendición. Es la regla que
 * aplican el formulario y el backend.
 */
export function problemaDeFechaEnvio(
  dia: string,
  periodo: Periodo,
  ahora: Date = new Date(),
): string | null {
  if (!esDiaValido(dia)) return MENSAJE_FECHA_ENVIO_INVALIDA;
  // Con el formato AAAA-MM-DD, comparar los textos es comparar las fechas.
  if (dia > hoyEnBuenosAires(ahora)) return MENSAJE_FECHA_ENVIO_FUTURA;
  if (dia < primerDiaDelPeriodo(periodo)) return mensajeFechaEnvioAnteriorAlPeriodo(periodo);
  return null;
}

/**
 * La fecha de un paso del historial para mostrarla: la efectiva si la tiene (la fecha de envío
 * elegida, que puede ser anterior al registro), si no la del registro. La efectiva es un día: se
 * devuelve el instante en que empieza en Buenos Aires, así los formatos de la interfaz (que usan
 * ese horario) muestran ese mismo día.
 */
export const fechaDelPaso = ({
  fecha,
  fechaEfectiva,
}: {
  fecha: Date;
  fechaEfectiva?: string | null | undefined;
}): Date =>
  fechaEfectiva === null || fechaEfectiva === undefined
    ? fecha
    : inicioDelDiaEnBuenosAires(fechaEfectiva);
