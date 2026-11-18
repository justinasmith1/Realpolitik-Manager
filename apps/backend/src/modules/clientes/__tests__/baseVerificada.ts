// Verificación de la conexión EFECTIVA de las suites de integración contra PostgreSQL, antes de
// cualquier escritura (también de las cuentas y sesiones de prueba).
//
// Tres protecciones distintas, que se suman:
// - Nombre: `urlDeBaseDescartable` (al cargar el archivo) solo admite `*_audit` o `*_test`, y cada
//   suite puede exigir algo más (`exigir`: un nombre exacto, un sufijo, un host local).
// - Conexión efectiva (este módulo): una conexión de referencia abierta con la URL tiene que estar
//   en la base de su nombre, y cada conexión que usa la suite (`lib/prisma` y las que abra aparte)
//   en esa MISMA base del MISMO servidor. Atrapa un `lib/prisma` creado antes con otra URL (el
//   singleton de `globalThis`, o un import estático que tomó el `.env`).
// - Instancia descartable: ninguna de las dos anteriores distingue la instancia de QA manual de una
//   descartable si la base se llama igual. Eso depende de con qué URL se corre.
//
// Si algo no coincide, lanza y desconecta lo que se abrió, sin escribir, limpiar ni migrar nada.
//
// No importa `vitest`: lo pueden usar módulos que corren fuera de Vitest.

import { PrismaClient } from '@prisma/client';

/** Lo único que la verificación usa de una conexión: consultas de lectura. */
export type Consultable = Pick<PrismaClient, '$queryRaw'>;
/** Una conexión que la verificación puede cerrar si rechaza. */
export type Desconectable = Consultable & Pick<PrismaClient, '$disconnect'>;
type Abrir = (url: string) => Desconectable;

export const conexion = (url: string) => new PrismaClient({ datasourceUrl: url, log: [] });

const BASE_DESCARTABLE = /_(audit|test)$/;

const nombreDeLaBase = (url: string) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

/**
 * A qué base está conectada de verdad una conexión: el nombre (`current_database()`) y una huella
 * del servidor (inicio del postmaster y puerto), para distinguir dos servidores con una base del
 * mismo nombre. Solo lee.
 */
async function identidad(db: Consultable): Promise<{ base: string; servidor: string }> {
  const [fila] = await db.$queryRaw<{ base: string; servidor: string }[]>`
    SELECT current_database() AS "base",
      pg_postmaster_start_time()::text || '@' || coalesce(inet_server_port()::text, 'socket') AS "servidor"`;
  if (fila === undefined) throw new Error('La base no informó su identidad: no se ejecuta nada.');
  return fila;
}

/**
 * Guarda de aislamiento, ANTES de cualquier escritura (también de los datos de prueba):
 * 1. el nombre de `url` (la de `TEST_DATABASE_URL`) tiene que ser `*_audit` o `*_test`;
 * 2. una conexión de referencia abierta con esa misma `url` tiene que estar en esa base;
 * 3. cada conexión de la suite tiene que estar en la MISMA base y el mismo servidor que la
 *    referencia. Un `TEST_DATABASE_URL` válido no alcanza: atrapa, por ejemplo, un `lib/prisma`
 *    cargado antes de fijar `DATABASE_URL`, que tomaría la base del `.env`.
 * Si algo no coincide, lanza y no escribe nada. `abrir` existe para los tests de la guarda.
 */
export async function exigirBaseDePrueba(
  url: string,
  conexiones: Consultable[],
  { abrir = conexion }: { abrir?: Abrir } = {},
): Promise<void> {
  const esperada = nombreDeLaBase(url);
  if (!BASE_DESCARTABLE.test(esperada)) {
    throw new Error(
      `"${esperada}" no es una base descartable (*_audit o *_test): no se ejecuta nada.`,
    );
  }
  const referencia = abrir(url);
  let deLaUrl: { base: string; servidor: string };
  try {
    deLaUrl = await identidad(referencia);
  } finally {
    await referencia.$disconnect();
  }
  if (deLaUrl.base !== esperada) {
    throw new Error(
      `La URL de prueba lleva a "${deLaUrl.base}", no a "${esperada}": no se ejecuta nada.`,
    );
  }
  for (const db of conexiones) {
    const efectiva = await identidad(db);
    if (efectiva.base !== deLaUrl.base || efectiva.servidor !== deLaUrl.servidor) {
      throw new Error(
        `Una conexión de la suite apunta a "${efectiva.base}" y no a "${esperada}" de ese servidor: no se ejecuta nada.`,
      );
    }
  }
}

/** Restricciones propias de una suite, además de la guarda común. */
export interface RestriccionesDeLaSuite {
  /**
   * Guarda de nombre o de host de la suite (por ejemplo, `exigirBaseDeEstaSuite`). Lanza si no se
   * cumple. Corre antes de fijar `DATABASE_URL`, de importar `lib/prisma` y de abrir nada.
   */
  exigir?: (url: string) => void;
  /** Nombre exacto que tiene que informar `current_database()` en la conexión de la suite. */
  baseExacta?: string;
  /** Versión mayor de PostgreSQL que exige la suite. */
  versionMayor?: number;
  /** Solo para los tests: cómo se abre la conexión de referencia. */
  abrir?: Abrir;
}

const desconectarTodas = (conexiones: Desconectable[]) =>
  Promise.all(conexiones.map((db) => db.$disconnect().catch(() => undefined)));

/**
 * Verifica conexiones ya abiertas: las restricciones de la suite y `exigirBaseDePrueba` sobre
 * todas. La primera es la de la suite (`lib/prisma`): sobre ella se comprueban `baseExacta` y
 * `versionMayor`. Si algo falla, desconecta todas y relanza el error original.
 */
export async function verificarConexiones(
  url: string,
  conexiones: [Desconectable, ...Desconectable[]],
  { exigir, baseExacta, versionMayor, abrir }: RestriccionesDeLaSuite = {},
): Promise<void> {
  try {
    exigir?.(url);
    await exigirBaseDePrueba(url, conexiones, abrir === undefined ? {} : { abrir });
    if (baseExacta !== undefined || versionMayor !== undefined) {
      const [info] = await conexiones[0].$queryRaw<{ db: string; version: string }[]>`
        SELECT current_database() AS db, version() AS version`;
      if (info === undefined || (baseExacta !== undefined && info.db !== baseExacta)) {
        throw new Error(
          `La conexión no es ${baseExacta ?? 'la esperada'} (base=${info?.db ?? 'sin fila'}): no se ejecuta nada.`,
        );
      }
      if (
        versionMayor !== undefined &&
        !new RegExp(`^PostgreSQL ${versionMayor}(?:\\D|$)`).test(info.version)
      ) {
        throw new Error(
          `La conexión no es PostgreSQL ${versionMayor} sobre ${info.db} (${info.version.split(' on ')[0]}): no se ejecuta nada.`,
        );
      }
    }
  } catch (error) {
    // Lo que se abrió se libera; el motivo del rechazo es el error original.
    await desconectarTodas(conexiones);
    throw error;
  }
}

/**
 * La preparación de una suite que usa `lib/prisma`, en este orden y antes de cualquier escritura:
 * 1. `exigir` (la guarda de nombre o de host de la suite);
 * 2. fija `DATABASE_URL` e importa `lib/prisma` dinámicamente;
 * 3. verifica `lib/prisma` y `otras` (las conexiones que la suite abrió aparte) con
 *    `verificarConexiones`.
 * Devuelve `lib/prisma`. Si algo falla, desconecta `lib/prisma` y `otras`, y relanza: la suite no
 * debe marcarse como verificada, y su `afterAll` no tiene que tocar la base.
 */
export async function conectarBaseDePrueba(
  url: string,
  {
    otras = [],
    exigir,
    ...restricciones
  }: RestriccionesDeLaSuite & { otras?: Desconectable[] } = {},
): Promise<PrismaClient> {
  try {
    exigir?.(url);
  } catch (error) {
    await desconectarTodas(otras);
    throw error;
  }
  // El cliente de Prisma lee DATABASE_URL al crearse: se fija antes de importarlo.
  process.env.DATABASE_URL = url;
  const { prisma } = await import('../../../lib/prisma');
  await verificarConexiones(url, [prisma, ...otras], restricciones);
  return prisma;
}

/** Una conexión nueva, ya verificada con `exigirBaseDePrueba`. */
export async function conexionVerificada(url: string): Promise<PrismaClient> {
  const db = conexion(url);
  await verificarConexiones(url, [db]);
  return db;
}
