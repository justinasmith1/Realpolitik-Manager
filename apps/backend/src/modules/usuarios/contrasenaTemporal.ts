// Contraseña temporal de una cuenta nueva o restablecida (HU4.5, ADR-0006 §1). La genera el
// servidor: el administrador nunca la elige.
//
// - 24 bytes del generador criptográfico de Node (`crypto.randomBytes`, el mismo CSPRNG que el
//   token de sesión), en base64url: 32 caracteres de [A-Za-z0-9_-], 192 bits de entropía. 24 bytes
//   son exactamente 32 caracteres sin relleno, y cada carácter representa 6 bits: no hay sesgo.
// - No se deriva del nombre, del email ni de la hora; no hay contraseñas predeterminadas.
// - 32 caracteres está dentro del máximo del sistema (`CONTRASENA_LARGO_MAXIMO`, 128) y por encima
//   del mínimo (8). Igual se evalúa con la política de contraseñas nuevas, con el email y el nombre
//   de la cuenta como contexto: una cadena aleatoria no debería caer nunca en la lista de bloqueo,
//   el contexto o una repetición trivial, pero si cayera se descarta y se genera otra.
//
// La contraseña solo existe en memoria: este módulo no la registra, no la guarda y ningún error la
// incluye. Quien la recibe la hashea y la devuelve una sola vez al llamador autorizado.

import { randomBytes } from 'node:crypto';

import { type ContextoDeContrasena, evaluarContrasenaNueva } from '../auth/politicaDeContrasenas';

/** Bytes aleatorios de cada contraseña temporal. */
export const BYTES_DE_CONTRASENA_TEMPORAL = 24;

/** Intentos antes de rendirse si la política rechazara las generadas (no debería pasar nunca). */
const INTENTOS_DE_GENERACION = 5;

export type FuenteDeBytes = (cantidad: number) => Buffer;

/** No se pudo generar una contraseña que cumpla la política. Sin la contraseña en el mensaje. */
export class ContrasenaTemporalNoGeneradaError extends Error {
  constructor() {
    super('No se pudo generar una contraseña temporal que cumpla la política.');
    this.name = 'ContrasenaTemporalNoGeneradaError';
  }
}

/**
 * Genera una contraseña temporal aceptada por la política de contraseñas nuevas para la cuenta de
 * `contexto`. `fuente` existe solo para los tests; en producción es `crypto.randomBytes`.
 * @throws {ContrasenaTemporalNoGeneradaError} si la política rechaza todas las generadas.
 */
export function generarContrasenaTemporal(
  contexto: ContextoDeContrasena,
  fuente: FuenteDeBytes = randomBytes,
): string {
  for (let intento = 0; intento < INTENTOS_DE_GENERACION; intento += 1) {
    const contrasena = fuente(BYTES_DE_CONTRASENA_TEMPORAL).toString('base64url');
    if (evaluarContrasenaNueva(contrasena, contexto).aceptada) return contrasena;
  }
  throw new ContrasenaTemporalNoGeneradaError();
}
