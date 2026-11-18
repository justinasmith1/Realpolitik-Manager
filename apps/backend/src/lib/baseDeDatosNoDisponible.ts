// Reconoce los errores de Prisma que significan "PostgreSQL no responde" (ADR-0006 §1): la falla
// es de la infraestructura, no del pedido ni de sus datos. Quien verifica una sesión con la base
// caída falla CERRADO: no concede acceso y la capa HTTP responde 503, no 401.

import { Prisma } from '@prisma/client';

/**
 * Códigos de Prisma de conexión y de pool:
 * - P1001: no se puede alcanzar el servidor.
 * - P1002: se alcanzó, pero no respondió a tiempo.
 * - P1017: el servidor cerró la conexión.
 * - P2024: se agotó la espera por una conexión del pool.
 */
const CODIGOS_DE_BASE_NO_DISPONIBLE: ReadonlySet<string> = new Set([
  'P1001',
  'P1002',
  'P1017',
  'P2024',
]);

/**
 * SQLSTATE de PostgreSQL que indican que se perdió la conexión. En las consultas raw (`$queryRaw`,
 * `$executeRaw`) Prisma no los informa como P1017 sino como P2010 con el SQLSTATE en `meta.code`:
 * - clase 08: excepciones de conexión;
 * - 57P01 a 57P03: el servidor se está apagando, se cayó o todavía no acepta conexiones (lo que ve
 *   una transacción en curso cuando PostgreSQL se reinicia o termina su conexión). Comprobado con
 *   `pg_terminate_backend` contra PostgreSQL 16: llega `P2010` con `57P01`.
 */
const SQLSTATE_DE_CONEXION_PERDIDA = /^(?:08[0-9A-Z]{3}|57P0[123])$/;

/**
 * En una consulta del cliente de Prisma (`deleteMany`, `create`…) DENTRO de una transacción
 * interactiva, la misma conexión perdida llega como `PrismaClientUnknownRequestError`, sin código:
 * el SQLSTATE solo aparece en el mensaje del conector (`PostgresError { code: "57P01", … }`).
 * Comprobado con `pg_terminate_backend` contra PostgreSQL 16 y Prisma 5.22 (HU4.2). Se extrae solo
 * ese campo y se le aplica la misma lista: cualquier otro error desconocido sigue siendo un 500.
 */
const SQLSTATE_EN_EL_MENSAJE = /PostgresError \{ code: "([0-9A-Z]{5})"/;

/**
 * `P2028` ("Transaction API error") agrupa causas distintas de una transacción interactiva. Solo dos
 * son transitorias y no dejan nada confirmado; se reconocen por `meta.error`, el texto del motor
 * (sin el lugar de la llamada que trae `message`):
 * - "Unable to start a transaction in the given time.": en `maxWait` (2 s por defecto) no hubo una
 *   conexión libre para empezarla; no se ejecutó nada. Es el equivalente transaccional de P2024.
 * - "Transaction already closed: A <operación> cannot be executed on an expired transaction. …": la
 *   transacción superó su `timeout` (5 s por defecto), por ejemplo esperando un bloqueo de fila, y
 *   el motor la revirtió. El texto nombra la operación que lo encontró (`query`, `commit`…); en
 *   todos los casos la transacción ya no se confirma.
 * Las demás variantes (usar una transacción ya confirmada o revertida, "Transaction not found", un
 * nivel de aislamiento inválido) son errores de programación y siguen siendo un 500, como un P2028
 * sin `meta.error` o con cualquier otro texto. Reproducido con Prisma 5.22 y PostgreSQL 16 (B2A del
 * cierre de la épica 4): login y cambio de rol con la fila del usuario bloqueada más de 5 s, y una
 * transacción con el pool ocupado.
 */
const P2028_TRANSITORIOS: readonly RegExp[] = [
  /^Unable to start a transaction in the given time\.?$/,
  /^Transaction already closed: A [a-z]+(?: [a-z]+)? cannot be executed on an expired transaction\./,
];

function esTransaccionNoIniciadaOVencida(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.code !== 'P2028') return false;
  const motivo = (error.meta as { error?: unknown } | undefined)?.error;
  return typeof motivo === 'string' && P2028_TRANSITORIOS.some((patron) => patron.test(motivo));
}

/** La base no está disponible. Sin causa ni detalles: ni host, ni puerto, ni consulta. */
export class BaseDeDatosNoDisponibleError extends Error {
  constructor() {
    super('La base de datos no está disponible.');
    this.name = 'BaseDeDatosNoDisponibleError';
  }
}

export function esBaseDeDatosNoDisponible(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const sqlstate = SQLSTATE_EN_EL_MENSAJE.exec(error.message)?.[1];
    return sqlstate !== undefined && SQLSTATE_DE_CONEXION_PERDIDA.test(sqlstate);
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (CODIGOS_DE_BASE_NO_DISPONIBLE.has(error.code)) return true;
  if (esTransaccionNoIniciadaOVencida(error)) return true;
  const sqlstate = (error.meta as { code?: unknown } | undefined)?.code;
  return (
    error.code === 'P2010' &&
    typeof sqlstate === 'string' &&
    SQLSTATE_DE_CONEXION_PERDIDA.test(sqlstate)
  );
}

/**
 * Ejecuta `operacion` y traduce una falla de disponibilidad a `BaseDeDatosNoDisponibleError`.
 * Cualquier otro error sigue su curso tal cual (un 500 para la capa HTTP).
 */
export async function conLaBaseDeDatos<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (esBaseDeDatosNoDisponible(error)) throw new BaseDeDatosNoDisponibleError();
    throw error;
  }
}
