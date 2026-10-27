// Integración de `POST /rendiciones/:id/requisitos/:requisitoId` (contrato 4.5) contra
// PostgreSQL REAL: que los ítems se sumen sin tocar los existentes y que dos pedidos
// simultáneos del mismo requisito sumen una sola vez.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run rendiciones.requisitos.integration
//
// En Windows, usá `127.0.0.1` y no `localhost`: el intento por IPv6 demora la segunda conexión y
// las transacciones simultáneas superan el tiempo de espera de Prisma (P2028).

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

const MARCA = `TESTRR${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
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

/** CUIT único. El prefijo 39 no lo usa otra suite. */
const cuitDePrueba = () => `39-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

async function crearRequisito(clienteId: string, nombreTipo: string, cantidad: number) {
  const nombre = `${MARCA} ${nombreTipo}`;
  const tipo = await prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
  return prisma.requisitoCliente.create({
    data: {
      clienteId,
      tipoDocumentoId: tipo.id,
      cantidad,
      diasAproximados: cantidad === 2 ? [5, 20] : [],
    },
  });
}

/** Cliente con Factura x1 y una rendición abierta. */
async function rendicionAbierta(factura: string) {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
    },
  });
  clientesCreados.push(cliente.id);
  await crearRequisito(cliente.id, 'Factura', 1);
  const res = await request(app)
    .post(`/clientes/${cliente.id}/rendiciones`)
    .send({ ...mesActual(), numeroFactura: factura });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { cliente, rendicionId: (res.body as { id: string }).id };
}

const sumar = (rendicionId: string, requisitoId: string) =>
  request(app).post(`/rendiciones/${rendicionId}/requisitos/${requisitoId}`);

describe.skipIf(url === undefined)(
  'sumar un requisito a una rendición, contra PostgreSQL real',
  () => {
    it('suma los ítems del requisito nuevo y deja igual los que ya estaban', async () => {
      const { cliente, rendicionId } = await rendicionAbierta('A 00001-00000201');
      const antes = await prisma.itemChecklist.findMany({ where: { rendicionId } });
      const nuevo = await crearRequisito(cliente.id, 'Print', 2);

      const res = await sumar(rendicionId, nuevo.id);

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const despues = await prisma.itemChecklist.findMany({ where: { rendicionId } });
      expect(despues).toHaveLength(3);
      for (const item of antes) {
        expect(despues.find((fila) => fila.id === item.id)).toEqual(item);
      }
      expect(
        despues
          .filter((fila) => fila.requisitoClienteId === nuevo.id)
          .map(({ ordinal, totalOrdinal, diaAproximado }) => ({
            ordinal,
            totalOrdinal,
            diaAproximado,
          }))
          .sort((a, b) => a.ordinal - b.ordinal),
      ).toEqual([
        { ordinal: 1, totalOrdinal: 2, diaAproximado: 5 },
        { ordinal: 2, totalOrdinal: 2, diaAproximado: 20 },
      ]);
    });

    it('con dos pedidos simultáneos del mismo requisito, suma una sola vez', async () => {
      const { cliente, rendicionId } = await rendicionAbierta('A 00001-00000202');
      const nuevo = await crearRequisito(cliente.id, 'Print', 2);

      const respuestas = await Promise.all([
        sumar(rendicionId, nuevo.id),
        sumar(rendicionId, nuevo.id),
      ]);

      expect(respuestas.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.itemChecklist.count({ where: { rendicionId, requisitoClienteId: nuevo.id } }),
      ).toBe(2);
    });

    it('un requisito que ya está en la rendición es 409 REQUISITO_YA_EN_RENDICION', async () => {
      const { cliente, rendicionId } = await rendicionAbierta('A 00001-00000203');
      const factura = await prisma.requisitoCliente.findFirstOrThrow({
        where: { clienteId: cliente.id },
      });

      const res = await sumar(rendicionId, factura.id);

      expect(res.status).toBe(409);
      expect((res.body as { error: { details: unknown } }).error.details).toEqual({
        motivo: 'REQUISITO_YA_EN_RENDICION',
      });
    });

    it('con la rendición anulada es 409 RENDICION_ANULADA', async () => {
      const { cliente, rendicionId } = await rendicionAbierta('A 00001-00000204');
      const nuevo = await crearRequisito(cliente.id, 'Print', 1);
      await request(app).patch(`/rendiciones/${rendicionId}/estado`).send({ estado: 'ANULADA' });

      const res = await sumar(rendicionId, nuevo.id);

      expect(res.status).toBe(409);
      expect((res.body as { error: { details: unknown } }).error.details).toEqual({
        motivo: 'RENDICION_ANULADA',
      });
    });
  },
);
