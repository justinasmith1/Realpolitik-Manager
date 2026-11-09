import type { EstadoRendicion } from '../schemas/rendicion.schema.js';

import { mesActual, type Periodo } from './periodo.js';

// "Atrasada" (HU3.4, ADR-0005 punto 8). Se calcula, no se guarda. La regla vive solo acá: la usan
// el backend (para marcar las filas y para listar las atrasadas) y el frontend.

/** Los estados en los que una rendición todavía no salió hacia el organismo. */
export const ESTADOS_SIN_ENVIAR = [
  'EN_CURSO',
  'COMPLETA',
] as const satisfies readonly EstadoRendicion[];

const sinEnviar = (estado: EstadoRendicion): boolean =>
  (ESTADOS_SIN_ENVIAR as readonly EstadoRendicion[]).includes(estado);

/** Meses transcurridos desde el año 0: permite comparar y restar períodos con un solo número. */
const enMeses = ({ anio, mes }: Periodo): number => anio * 12 + (mes - 1);

/**
 * El período más nuevo que ya cuenta como atrasado: dos meses antes del mes actual, en horario de
 * Buenos Aires. La rendición de un mes se trabaja durante el mes siguiente, así que la del mes
 * anterior todavía no está atrasada. En noviembre de 2026, septiembre de 2026; en enero de 2027,
 * noviembre de 2026.
 */
export function ultimoPeriodoAtrasado(hoy: Date = new Date()): Periodo {
  const indice = enMeses(mesActual(hoy)) - 2;
  return { anio: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

/**
 * Una rendición activa está atrasada si todavía no se envió (En curso o Completa) y su período es
 * de dos meses atrás o más respecto del mes de `hoy`, en horario de Buenos Aires. Los clientes no
 * fijan una fecha límite: no se usa la periodicidad ni su día límite. Las anuladas nunca están
 * atrasadas: eso lo resuelve quien llama, que solo la aplica a rendiciones activas.
 */
export function esAtrasada(
  periodo: Periodo,
  estado: EstadoRendicion,
  hoy: Date = new Date(),
): boolean {
  return sinEnviar(estado) && enMeses(periodo) <= enMeses(ultimoPeriodoAtrasado(hoy));
}
