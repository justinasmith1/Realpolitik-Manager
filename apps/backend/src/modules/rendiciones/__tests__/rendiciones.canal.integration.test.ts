// Integración de `PATCH /rendiciones/:id/items/:itemId/canal` (contrato 4.5) contra PostgreSQL
// REAL: que corrija solo el canal de ese ítem, sin tocar el requisito ni otras rendiciones.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run rendiciones.canal.integration
//
// En Windows, usá `127.0.0.1` y no `localhost` (ver rendiciones.requisitos.integration).

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { mesActual, normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTRC${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
    await prisma.tipoDocumento.deleteMany({
      where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
    });
  } finally {
    await prisma.$disconnect();
  }
});

/** CUIT único. El prefijo 31 no lo usa otra suite. */
const cuitDePrueba = () => `31-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

/** Cliente por correo con un requisito Factura x2 (canal heredado). */
async function clienteConFactura() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    },
  });
  clientesCreados.push(cliente.id);
  const nombre = `${MARCA} Factura`;
  const tipo = await prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
  const requisito = await prisma.requisitoCliente.create({
    data: {
      clienteId: cliente.id,
      tipoDocumentoId: tipo.id,
      cantidad: 2,
      diasAproximados: [5, 20],
    },
  });
  return { cliente, requisito };
}

interface ItemJson {
  id: string;
  ordinal: number;
  diaAproximado: number | null;
  canalEntrega: string;
  actualizadoEn: string;
}

async function abrir(clienteId: string, numeroFactura: string, periodo = mesActual()) {
  const res = await request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; items: ItemJson[] };
}

const corregir = (rendicionId: string, itemId: string, canalEntrega: string) =>
  request(app).patch(`/rendiciones/${rendicionId}/items/${itemId}/canal`).send({ canalEntrega });

const motivo = (res: request.Response) =>
  (res.body as { error?: { details?: { motivo?: string } } }).error?.details?.motivo;

describe.skipIf(url === undefined)('corregir el canal de un ítem, contra PostgreSQL real', () => {
  it('cambia solo ese ítem: no toca los otros, el requisito ni otra rendición', async () => {
    const { cliente, requisito } = await clienteConFactura();
    const rendicion = await abrir(cliente.id, 'A 00001-00000101');
    const anterior =
      mesActual().mes === 1
        ? { anio: mesActual().anio - 1, mes: 12 }
        : { anio: mesActual().anio, mes: mesActual().mes - 1 };
    const otra = await abrir(cliente.id, 'A 00001-00000102', anterior);
    const [primero, segundo] = rendicion.items;
    if (primero === undefined || segundo === undefined) throw new Error('faltan ítems');

    const res = await corregir(rendicion.id, primero.id, 'PORTAL_WEB');

    expect(res.status).toBe(200);
    const items = (res.body as { items: ItemJson[] }).items;
    expect(items.map(({ id, canalEntrega }) => ({ id, canalEntrega }))).toEqual([
      { id: primero.id, canalEntrega: 'PORTAL_WEB' },
      { id: segundo.id, canalEntrega: 'CORREO' },
    ]);
    // El resto del snapshot sigue igual.
    expect(items[0]).toMatchObject({ ordinal: 1, diaAproximado: 5 });
    const enBase = await prisma.requisitoCliente.findUniqueOrThrow({ where: { id: requisito.id } });
    expect(enBase.canalEntrega).toBeNull();
    const deLaOtra = await prisma.itemChecklist.findMany({ where: { rendicionId: otra.id } });
    expect(deLaOtra.every((item) => item.canalEntrega === 'CORREO')).toBe(true);
  });

  it('con el mismo canal es idempotente: responde 200 y no escribe', async () => {
    const { cliente } = await clienteConFactura();
    const rendicion = await abrir(cliente.id, 'A 00001-00000103');
    const item = rendicion.items[0];
    if (item === undefined) throw new Error('falta el ítem');
    const antes = await prisma.itemChecklist.findUniqueOrThrow({ where: { id: item.id } });

    const res = await corregir(rendicion.id, item.id, 'CORREO');

    expect(res.status).toBe(200);
    const despues = await prisma.itemChecklist.findUniqueOrThrow({ where: { id: item.id } });
    expect(despues.updatedAt).toEqual(antes.updatedAt);
  });

  it('en una rendición anulada es 409 RENDICION_ANULADA y no cambia nada', async () => {
    const { cliente } = await clienteConFactura();
    const rendicion = await abrir(cliente.id, 'A 00001-00000104');
    const item = rendicion.items[0];
    if (item === undefined) throw new Error('falta el ítem');
    await request(app).patch(`/rendiciones/${rendicion.id}/estado`).send({ estado: 'ANULADA' });

    const res = await corregir(rendicion.id, item.id, 'WHATSAPP');

    expect(res.status).toBe(409);
    expect(motivo(res)).toBe('RENDICION_ANULADA');
    const enBase = await prisma.itemChecklist.findUniqueOrThrow({ where: { id: item.id } });
    expect(enBase.canalEntrega).toBe('CORREO');
  });

  it('un ítem de otra rendición es 404 y no cambia', async () => {
    const { cliente } = await clienteConFactura();
    const una = await abrir(cliente.id, 'A 00001-00000105');
    const { cliente: otroCliente } = await clienteConFactura();
    const otra = await abrir(otroCliente.id, 'A 00001-00000106');
    const ajeno = otra.items[0];
    if (ajeno === undefined) throw new Error('falta el ítem');

    const res = await corregir(una.id, ajeno.id, 'WHATSAPP');

    expect(res.status).toBe(404);
    const enBase = await prisma.itemChecklist.findUniqueOrThrow({ where: { id: ajeno.id } });
    expect(enBase.canalEntrega).toBe('CORREO');
  });

  it('una rendición o un ítem inexistentes son 404', async () => {
    const { cliente } = await clienteConFactura();
    const rendicion = await abrir(cliente.id, 'A 00001-00000107');
    const inexistente = 'f0f0f0f0-0000-4000-8000-000000000000';
    const item = rendicion.items[0];
    if (item === undefined) throw new Error('falta el ítem');

    expect((await corregir(inexistente, item.id, 'CORREO')).status).toBe(404);
    expect((await corregir(rendicion.id, inexistente, 'CORREO')).status).toBe(404);
  });
});
