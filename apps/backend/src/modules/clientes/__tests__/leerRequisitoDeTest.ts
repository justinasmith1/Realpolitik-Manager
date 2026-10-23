// Lee un requisito de prueba (baja lógica y matrizConfigurada del cliente) en la base
// descartable. Lo usa el test de punta a punta del frontend, que no puede ver `isDeleted`
// por la API.
//
//   TEST_DATABASE_URL=… node --import tsx leerRequisitoDeTest.ts --comprobar
//   TEST_DATABASE_URL=… node --import tsx leerRequisitoDeTest.ts <requisitoId>
//
// `--comprobar` imprime la base y la versión y verifica que las columnas de esta HU existan.
// Se niega a operar fuera de 127.0.0.1:5433/realpolitik_test.

import { PrismaClient } from '@prisma/client';

import { urlDeBaseDescartable } from './baseDescartable';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirBaseDeRequisitos(conexion: string): void {
  const destino = new URL(conexion);
  const base = decodeURIComponent(destino.pathname.replace(/^\//, ''));
  if (destino.hostname !== '127.0.0.1' || destino.port !== '5433' || base !== 'realpolitik_test') {
    throw new Error(
      `Solo se lee 127.0.0.1:5433/realpolitik_test (recibió ${destino.hostname}:${destino.port || 'sin puerto'}/${base}).`,
    );
  }
}

async function main(): Promise<void> {
  const url = urlDeBaseDescartable();
  if (url === undefined) {
    throw new Error('Falta TEST_DATABASE_URL: no se lee nada.');
  }
  exigirBaseDeRequisitos(url);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const argumento = process.argv[2];
    if (argumento === '--comprobar') {
      const [info] = await prisma.$queryRaw<{ db: string; version: string }[]>`
        SELECT current_database() AS db, version() AS version`;
      await prisma.$queryRaw`SELECT "isDeleted", "deletedAt" FROM "RequisitoCliente" LIMIT 0`;
      await prisma.$queryRaw`SELECT "matrizConfigurada" FROM "Cliente" LIMIT 0`;
      process.stdout.write(
        JSON.stringify({ db: info?.db ?? null, version: info?.version ?? null }),
      );
      return;
    }
    if (argumento === undefined || !ID.test(argumento)) {
      throw new Error('Pasá --comprobar o el id de un requisito.');
    }
    const fila = await prisma.requisitoCliente.findUnique({
      where: { id: argumento },
      select: {
        isDeleted: true,
        deletedAt: true,
        cliente: { select: { matrizConfigurada: true } },
      },
    });
    if (fila === null) {
      throw new Error(`No está el requisito ${argumento}.`);
    }
    process.stdout.write(
      JSON.stringify({
        isDeleted: fila.isDeleted,
        deletedAt: fila.deletedAt?.toISOString() ?? null,
        matrizConfigurada: fila.cliente.matrizConfigurada,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
