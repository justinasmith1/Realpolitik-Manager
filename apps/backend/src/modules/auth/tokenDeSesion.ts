// Token de sesión opaco (ADR-0006 §1).
//
// El token son 32 bytes (256 bits) de un generador criptográfico, en base64url: va solo en la
// cookie. En la base se guarda su SHA-256 en hexadecimal (`Sesion.tokenHash`), que identifica la
// sesión sin permitir reconstruir el token. Alcanza un hash rápido, sin sal: el token tiene 256
// bits de entropía y no es una contraseña. La búsqueda es por igualdad del hash, sin comparar
// secretos en la aplicación.
//
// El token nunca se registra en logs, ni se devuelve en un cuerpo JSON, ni va en una URL.

import { createHash, randomBytes } from 'node:crypto';

const BYTES_DEL_TOKEN = 32;

/** 32 bytes en base64url sin relleno: 43 caracteres de [A-Za-z0-9_-]. */
const FORMATO_DEL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 en hexadecimal del token: el valor que se guarda y se busca en `Sesion.tokenHash`. */
export function hashDeTokenDeSesion(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Genera un token nuevo y su hash. El token se entrega una sola vez (para la cookie); lo que se
 * persiste es solo `tokenHash`.
 */
export function generarTokenDeSesion(): { token: string; tokenHash: string } {
  const token = randomBytes(BYTES_DEL_TOKEN).toString('base64url');
  return { token, tokenHash: hashDeTokenDeSesion(token) };
}

/**
 * Si un valor recibido (por ejemplo, de una cookie) tiene la forma de un token. Permite descartar
 * basura sin consultar la base; no dice nada sobre si la sesión existe o vale.
 */
export function tieneFormatoDeTokenDeSesion(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO_DEL_TOKEN.test(valor);
}
