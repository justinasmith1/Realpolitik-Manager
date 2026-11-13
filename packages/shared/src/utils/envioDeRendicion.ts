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
 * Rechazada tampoco se modifica hasta que la operadora la reabre con "Corregir", que la pasa a En
 * curso (HU3.9).
 */
export const ESTADOS_NO_MODIFICABLES = [
  'ENVIADA',
  'APROBADA',
  'RECHAZADA',
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

/** Un reenvío no pudo salir antes de que el cliente rechazara la rendición (HU3.9). */
export const mensajeFechaEnvioAnteriorAlRechazo = (diaDelRechazo: string): string =>
  `La fecha de envío no puede ser anterior al ${diaLegible(diaDelRechazo)}, el día del último rechazo.`;

/**
 * Por qué la fecha de envío no vale, o `null` si vale: tiene que ser un día real, no posterior a
 * hoy (en Buenos Aires) y no anterior al primer día del período de la rendición. En un reenvío
 * (HU3.9), tampoco anterior al día del último rechazo (`diaDelUltimoRechazo`, de
 * `diaDelUltimoRechazo()`). Es la regla que aplican el formulario y el backend.
 */
export function problemaDeFechaEnvio(
  dia: string,
  periodo: Periodo,
  ahora: Date = new Date(),
  diaDelUltimoRechazo: string | null = null,
): string | null {
  if (!esDiaValido(dia)) return MENSAJE_FECHA_ENVIO_INVALIDA;
  // Con el formato AAAA-MM-DD, comparar los textos es comparar las fechas.
  if (dia > hoyEnBuenosAires(ahora)) return MENSAJE_FECHA_ENVIO_FUTURA;
  if (dia < primerDiaDelPeriodo(periodo)) return mensajeFechaEnvioAnteriorAlPeriodo(periodo);
  if (diaDelUltimoRechazo !== null && dia < diaDelUltimoRechazo) {
    return mensajeFechaEnvioAnteriorAlRechazo(diaDelUltimoRechazo);
  }
  return null;
}

/**
 * El primer día que se puede elegir como fecha de envío: el primero del período o, en un reenvío,
 * el del último rechazo si es posterior (HU3.9). El formulario lo usa como mínimo del selector.
 */
export function primerDiaDeEnvio(periodo: Periodo, diaDelUltimoRechazo: string | null): string {
  const inicio = primerDiaDelPeriodo(periodo);
  return diaDelUltimoRechazo !== null && diaDelUltimoRechazo > inicio
    ? diaDelUltimoRechazo
    : inicio;
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

// ─── Rechazos (HU3.9) ─────────────────────────────────────────────────────────────────────

/** Lo que se necesita de una entrada del historial para leer envíos y rechazos. */
interface PasoDelHistorial {
  estadoNuevo: EstadoRendicion;
  fecha: Date;
  fechaEfectiva?: string | null | undefined;
}

/** El día de un paso del historial (`AAAA-MM-DD`, Buenos Aires): el efectivo o el del registro. */
export const diaDelPaso = (paso: PasoDelHistorial): string =>
  paso.fechaEfectiva ?? hoyEnBuenosAires(paso.fecha);

/** El último paso a `estado`, o `undefined`. El historial va del cambio más viejo al más nuevo. */
function ultimoPasoA<T extends PasoDelHistorial>(
  historial: readonly T[],
  estado: EstadoRendicion,
): { paso: T; indice: number } | undefined {
  for (let indice = historial.length - 1; indice >= 0; indice -= 1) {
    const paso = historial[indice];
    if (paso !== undefined && paso.estadoNuevo === estado) return { paso, indice };
  }
  return undefined;
}

/**
 * El rechazo que la operadora todavía tiene que resolver (HU3.9): el último paso a Rechazada, si
 * no hubo un envío después (el reenvío lo resuelve; el motivo queda en el historial). `null` si
 * nunca se rechazó o si ya se reenvió. Se mira el orden del historial (el del registro), no las
 * fechas efectivas. El historial va del cambio más viejo al más nuevo, como lo devuelve la API.
 */
export function ultimoRechazoPendiente<T extends PasoDelHistorial>(
  historial: readonly T[],
): T | null {
  const rechazo = ultimoPasoA(historial, 'RECHAZADA');
  if (rechazo === undefined) return null;
  const envio = ultimoPasoA(historial, 'ENVIADA');
  return envio !== undefined && envio.indice > rechazo.indice ? null : rechazo.paso;
}

/**
 * El día del último rechazo (`AAAA-MM-DD`, Buenos Aires), o `null` si nunca se rechazó: un
 * reenvío no puede tener una fecha anterior (`problemaDeFechaEnvio`).
 */
export function diaDelUltimoRechazo(historial: readonly PasoDelHistorial[]): string | null {
  const rechazo = ultimoPasoA(historial, 'RECHAZADA');
  return rechazo === undefined ? null : diaDelPaso(rechazo.paso);
}
