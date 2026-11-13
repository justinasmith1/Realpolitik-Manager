import type { EstadoRendicion } from '../schemas/rendicion.schema.js';

import { esDiaValido, hoyEnBuenosAires } from './dia.js';

// Registrar el cobro informado por el cliente (HU3.10). El cobro es una marca de la rendición, no
// un estado: no hay conciliación bancaria, la operadora solo anota lo que el cliente le avisó.

/**
 * Los estados en los que se puede registrar o editar el cobro: una rendición que ya se presentó y
 * no fue rechazada. No tiene relación con `ESTADOS_NO_MODIFICABLES`: una Aprobada no se modifica
 * (documentos, canales), pero su cobro sí se registra.
 */
export const ESTADOS_COBRABLES = [
  'ENVIADA',
  'APROBADA',
] as const satisfies readonly EstadoRendicion[];

/** `true` si a una rendición en este estado se le puede registrar el cobro. */
export const esEstadoCobrable = (estado: EstadoRendicion): boolean =>
  (ESTADOS_COBRABLES as readonly EstadoRendicion[]).includes(estado);

/** Largo máximo de la nota del cobro (la columna es `VARCHAR(300)`). */
export const COBRO_NOTA_MAX = 300;

export const MENSAJE_FECHA_COBRO_INVALIDA = 'Ingresá una fecha válida (AAAA-MM-DD).';
export const MENSAJE_FECHA_COBRO_FUTURA = 'La fecha del cobro no puede ser posterior a hoy.';
export const MENSAJE_NOTA_COBRO = `La nota debe tener entre 1 y ${COBRO_NOTA_MAX} caracteres.`;

/**
 * Por qué la fecha del cobro no vale, o `null` si vale: tiene que ser un día real y no posterior a
 * hoy (en Buenos Aires). No hay fecha mínima. Es la regla que aplican el formulario, el schema y
 * el backend (este último con `ahora` inyectable).
 */
export function problemaDeFechaCobro(dia: string, ahora: Date = new Date()): string | null {
  if (!esDiaValido(dia)) return MENSAJE_FECHA_COBRO_INVALIDA;
  // Con el formato AAAA-MM-DD, comparar los textos es comparar las fechas.
  if (dia > hoyEnBuenosAires(ahora)) return MENSAJE_FECHA_COBRO_FUTURA;
  return null;
}
