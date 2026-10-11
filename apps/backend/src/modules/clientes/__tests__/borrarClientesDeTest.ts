// Borra clientes de prueba POR ID (y sus contactos) directamente en la base descartable. Lo usan
// los tests de otros paquetes (p. ej. el del frontend contra la API real) que crean clientes
// por la API —que no tiene un DELETE público— y tienen que dejar la base como la encontraron.
//
//   TEST_DATABASE_URL=… node --import tsx borrarClientesDeTest.ts <id> [<id>…]
//
// Imprime en stdout cuántos clientes borró. Se niega a operar si `TEST_DATABASE_URL` falta o la
// base no termina en `_audit` o `_test` (la misma guarda que los tests de integración del backend).

import { PrismaClient } from '@prisma/client';

import { urlDeBaseDescartable } from './baseDescartable';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const url = urlDeBaseDescartable(); // lanza si la base no es descartable
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
    // Los contactos caen en cascada con el cliente; se borran antes de forma explícita para no
    // depender de la configuración de la relación.
    await prisma.contacto.deleteMany({ where: { clienteId: { in: ids } } });
    const { count } = await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
    process.stdout.write(String(count));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
