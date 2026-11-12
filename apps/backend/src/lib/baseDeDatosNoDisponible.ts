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

/** La base no está disponible. Sin causa ni detalles: ni host, ni puerto, ni consulta. */
export class BaseDeDatosNoDisponibleError extends Error {
  constructor() {
    super('La base de datos no está disponible.');
    this.name = 'BaseDeDatosNoDisponibleError';
  }
}

export function esBaseDeDatosNoDisponible(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (CODIGOS_DE_BASE_NO_DISPONIBLE.has(error.code)) return true;
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
