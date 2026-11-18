// Preflight de la conexión REAL de las suites de integración de requisitos (`requisitos` y
// `requisitos.masivo`). Va en el `beforeAll`, después de importar `lib/prisma` y ANTES de cualquier
// escritura, también de las cuentas y sesiones de `sesionesDePrueba().preparar()`.
//
// Suma las guardas existentes, sin aflojar ninguna:
// 1. `exigirBaseDeEstaSuite`: la base de `TEST_DATABASE_URL` se llama exactamente `realpolitik_test`.
// 2. `exigirBaseDePrueba` (la de las suites de Usuarios): una conexión de referencia abierta con
//    esa URL está en esa base, y la conexión de la suite (`lib/prisma`, la que usan las cuentas,
//    los servicios y la app) está en la MISMA base y el MISMO servidor. Atrapa un `lib/prisma`
//    creado antes de fijar `DATABASE_URL` (por ejemplo, el singleton de `globalThis`), que tomaría
//    la base del `.env`.
// 3. Sobre esa misma conexión: `current_database()` es `realpolitik_test` y, si la suite lo pide,
//    la versión mayor de PostgreSQL.
// Si algo falla, desconecta `lib/prisma` y relanza: la suite no escribe nada, y su `afterAll`
// tampoco (no llega a marcarse como verificada).
//
// Está en un archivo propio y no en `requisitosIntegrationEntorno.ts` porque ese también lo usa
// `leerRequisitoDeTest.ts`, un script que corre fuera de Vitest, y `entornoDeUsuarios` importa
// `vitest`.

import type { PrismaClient } from '@prisma/client';

import { type Consultable, exigirBaseDePrueba } from '../../usuarios/__tests__/entornoDeUsuarios';

import { exigirBaseDeEstaSuite } from './requisitosIntegrationEntorno';

type ConexionDeLaSuite = Consultable & Pick<PrismaClient, '$disconnect'>;

export async function verificarConexionDeRequisitos(
  url: string,
  prisma: ConexionDeLaSuite,
  {
    versionMayor,
    abrir,
  }: {
    /** Versión mayor de PostgreSQL que exige la suite (`requisitos.integration`: 16). */
    versionMayor?: number;
    /** Solo para los tests del preflight: cómo se abre la conexión de referencia. */
    abrir?: (url: string) => ConexionDeLaSuite;
  } = {},
): Promise<void> {
  try {
    exigirBaseDeEstaSuite(url);
    await exigirBaseDePrueba(url, [prisma], abrir === undefined ? {} : { abrir });
    const [info] = await prisma.$queryRaw<{ db: string; version: string }[]>`
      SELECT current_database() AS db, version() AS version`;
    if (info?.db !== 'realpolitik_test') {
      throw new Error(
        `La conexión no es realpolitik_test (base=${info?.db ?? 'sin fila'}): no se ejecuta nada.`,
      );
    }
    if (
      versionMayor !== undefined &&
      !new RegExp(`^PostgreSQL ${versionMayor}(?:\\D|$)`).test(info.version)
    ) {
      throw new Error(
        `La conexión no es PostgreSQL ${versionMayor} sobre realpolitik_test (${info.version.split(' on ')[0]}): no se ejecuta nada.`,
      );
    }
  } catch (error) {
    // Lo que se abrió se libera; el motivo del rechazo es el error original.
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}
