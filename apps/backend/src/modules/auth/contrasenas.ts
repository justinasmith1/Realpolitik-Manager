// Hash y verificación de contraseñas con argon2id (ADR-0006 §2), con la biblioteca `argon2`.
//
// No hay criptografía propia: la biblioteca genera la sal y produce y verifica el formato PHC
// (`$argon2id$v=19$m=…,t=…,p=…$sal$hash`). Cada hash guarda sus propios parámetros, así cambiar
// PARAMETROS_ARGON2 no invalida los hashes existentes: `necesitaRehash` avisa cuáles conviene
// recalcular en el siguiente inicio de sesión correcto.
//
// Ningún error ni mensaje de este módulo incluye la contraseña ni el hash.
//
// Este módulo no valida la política de una contraseña nueva (largo mínimo, lista de bloqueo): eso
// es `politicaDeContrasenas.ts`, que se aplica antes de calcular el hash. Tampoco limita cuántos
// cálculos corren a la vez: quien llama (el servicio de autenticación) los envuelve con
// `limiteDeHash.ejecutar(...)`. Pendiente para el inicio de sesión: el hash ficticio para igualar
// tiempos.

import {
  CONTRASENA_LARGO_MAXIMO,
  contarCaracteresDeContrasena,
  esUnicodeBienFormado,
} from '@realpolitik/shared';
import { argon2id, hash, needsRehash, verify } from 'argon2';

/**
 * Parámetros explícitos: los de la biblioteca por defecto (64 MiB, paralelismo 4) son demasiado
 * para un servicio de 512 MB. 19 MiB y 2 pasadas es una de las configuraciones mínimas de OWASP
 * para argon2id; hash de 32 bytes.
 */
export const PARAMETROS_ARGON2 = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

const PREFIJO_ARGON2ID = '$argon2id$';

/** El hash guardado no es un PHC de argon2id que la biblioteca pueda usar. Es un error de datos. */
export class HashDeContrasenaInvalidoError extends Error {
  constructor() {
    super('El hash de contraseña guardado no es un PHC de argon2id válido.');
    this.name = 'HashDeContrasenaInvalidoError';
  }
}

/**
 * Contraseña vacía, más larga que el máximo o con texto Unicode mal formado: no se calcula ningún
 * hash. Es un error de programación (la política se valida antes), no una respuesta para la persona.
 */
export class ContrasenaFueraDeRangoError extends Error {
  constructor() {
    super(
      `La contraseña tiene que tener entre 1 y ${CONTRASENA_LARGO_MAXIMO} caracteres de texto Unicode válido.`,
    );
    this.name = 'ContrasenaFueraDeRangoError';
  }
}

/**
 * NFC antes de calcular o verificar: una misma contraseña escrita con caracteres compuestos o
 * descompuestos (por ejemplo, "é" como un carácter o como "e" + tilde) produce el mismo hash.
 * Devuelve null si queda vacía, supera el máximo (contado como en shared: puntos de código después
 * de NFC) o tiene sustitutos UTF-16 sueltos, que al pasar a bytes se volverían U+FFFD y harían que
 * dos contraseñas distintas dieran el mismo hash.
 */
function normalizar(contrasena: string): string | null {
  if (!esUnicodeBienFormado(contrasena)) return null;
  const largo = contarCaracteresDeContrasena(contrasena);
  return largo === 0 || largo > CONTRASENA_LARGO_MAXIMO ? null : contrasena.normalize('NFC');
}

function exigirArgon2id(hashGuardado: string): void {
  if (!hashGuardado.startsWith(PREFIJO_ARGON2ID)) throw new HashDeContrasenaInvalidoError();
}

/**
 * Calcula el hash PHC de argon2id de una contraseña, con una sal aleatoria nueva.
 * @throws {ContrasenaFueraDeRangoError} si está vacía o supera el máximo.
 */
export async function hashearContrasena(contrasena: string): Promise<string> {
  const normalizada = normalizar(contrasena);
  if (normalizada === null) throw new ContrasenaFueraDeRangoError();
  return hash(normalizada, PARAMETROS_ARGON2);
}

/**
 * Verifica una contraseña contra su hash guardado. Devuelve `false` si no coincide, y también si
 * está vacía o supera el máximo (sin calcular nada: no se gasta CPU en una entrada imposible).
 * @throws {HashDeContrasenaInvalidoError} si el hash guardado no es un PHC de argon2id válido. No
 *   es una credencial incorrecta sino un dato corrupto: quien llama lo registra y lo trata como un
 *   fallo, sin revelar el motivo a quien intenta entrar.
 */
export async function verificarContrasena(
  hashGuardado: string,
  contrasena: string,
): Promise<boolean> {
  exigirArgon2id(hashGuardado);
  const normalizada = normalizar(contrasena);
  if (normalizada === null) return false;
  try {
    return await verify(hashGuardado, normalizada);
  } catch {
    // Sin la causa: no hace falta para diagnosticar y así nada del hash viaja en el error.
    throw new HashDeContrasenaInvalidoError();
  }
}

/**
 * Indica si un hash válido se calculó con parámetros distintos de los actuales.
 * @throws {HashDeContrasenaInvalidoError} si el hash no es un PHC de argon2id válido.
 */
export function necesitaRehash(hashGuardado: string): boolean {
  exigirArgon2id(hashGuardado);
  try {
    return needsRehash(hashGuardado, PARAMETROS_ARGON2);
  } catch {
    throw new HashDeContrasenaInvalidoError();
  }
}
