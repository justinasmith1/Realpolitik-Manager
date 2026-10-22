// Borra tipos de documento de prueba POR ID, directo en la base descartable. Lo usa el test del
// frontend contra la API real: la API no tiene DELETE, y el test tiene que dejar la base como
// la encontró.
//
//   TEST_DATABASE_URL=… node --import tsx borrarTiposDocumentoDeTest.ts <id> [<id>…]
//
// Imprime en stdout cuántos tipos borró. Se niega a operar si `TEST_DATABASE_URL` falta o la
// base no termina en `_audit` o `_test`. No borra el catálogo entero: solo los ids recibidos.
// Si alguno está referenciado por un requisito o un ítem, el `deleteMany` falla entero: es una
// sola sentencia, así que no borra una parte y deja otra.

import { PrismaClient } from '@prisma/client';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const url = urlDeBaseDescartable();
  if (url === undefined) {
    throw new Error('Falta TEST_DATABASE_URL: no se borra nada.');
  }
  const ids = process.argv.slice(2);
  const invalido = ids.find((id) => !ID.test(id));
  if (invalido !== undefined) {
    throw new Error(`"${invalido}" no es un id válido: no se borra nada.`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const { count } = await prisma.tipoDocumento.deleteMany({ where: { id: { in: ids } } });
    process.stdout.write(String(count));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
