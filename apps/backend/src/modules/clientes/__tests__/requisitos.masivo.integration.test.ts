// Tests de integración de la carga masiva (HU2.3) contra PostgreSQL REAL.
//
// Prueban lo que un mock no puede: que el requisito y `matrizConfigurada` se confirmen juntos,
// el índice parcial ante una carrera y que un pedido con un cliente inexistente no deje nada.
//
// Sin `TEST_DATABASE_URL` se saltan. Misma política de entorno que requisitos.integration.test.ts.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run requisitos.masivo.integration

import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from './baseDescartable';
import { exigirBaseDeEstaSuite } from './requisitosIntegrationEntorno';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTMAS${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

const suite = url === undefined ? describe.skip : describe;

beforeAll(async () => {
  if (url === undefined) return;
  exigirBaseDeEstaSuite(url);
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const [info] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (info?.db !== 'realpolitik_test') {
    throw new Error(`La conexión no es realpolitik_test (base=${info?.db ?? 'sin fila'}).`);
  }
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
    await prisma.tipoDocumento.deleteMany({
      where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
    });
    expect(
      await prisma.requisitoCliente.count({ where: { clienteId: { in: clientesCreados } } }),
    ).toBe(0);
    expect(await prisma.cliente.count({ where: { id: { in: clientesCreados } } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

interface ResultadoJson {
  creados: string[];
  omitidos: { clienteId: string; motivo: string }[];
}

const masivo = (body: object) => request(app).post('/requisitos/masivo').send(body);

/** CUIT único; la base no valida el dígito verificador. */
const cuitDePrueba = () => `37-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

async function crearCliente(estado: 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO' = 'ACTIVO') {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'masivo@ejemplo.example',
      sector: 'PRIVADO',
      estado,
    },
  });
  clientesCreados.push(cliente.id);
  return cliente;
}

async function crearTipo(nombre: string): Promise<string> {
  const res = await request(app).post('/tipos-documento').send({ nombre: `${MARCA} ${nombre}` });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

const activosDe = (clienteId: string) =>
  prisma.requisitoCliente.count({ where: { clienteId, isDeleted: false } });

const flagDe = async (clienteId: string) =>
  (
    await prisma.cliente.findUniqueOrThrow({
      where: { id: clienteId },
      select: { matrizConfigurada: true },
    })
  ).matrizConfigurada;

suite('POST /requisitos/masivo (PostgreSQL real)', () => {
  it('crea los requisitos, respeta cantidad y días por cliente y deja matrizConfigurada en true', async () => {
    const tipo = await crearTipo('Print');
    const a = await crearCliente();
    const b = await crearCliente();

    const res = await masivo({
      tipoDocumentoId: tipo,
      canalEntrega: 'CORREO',
      nota: 'Masivo',
      clientes: [{ clienteId: a.id }, { clienteId: b.id, cantidad: 2, diasAproximados: [5, 20] }],
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as ResultadoJson).creados).toEqual([a.id, b.id]);
    expect((res.body as ResultadoJson).omitidos).toEqual([]);

    const filaB = await prisma.requisitoCliente.findFirstOrThrow({
      where: { clienteId: b.id, tipoDocumentoId: tipo },
    });
    expect(filaB).toMatchObject({
      cantidad: 2,
      diasAproximados: [5, 20],
      canalEntrega: 'CORREO',
      nota: 'Masivo',
      isDeleted: false,
    });
    expect(await flagDe(a.id)).toBe(true);
    expect(await flagDe(b.id)).toBe(true);
  });

  it('omite inactivos y duplicados sin tocarlos', async () => {
    const tipo = await crearTipo('OC');
    const nuevo = await crearCliente();
    const suspendido = await crearCliente('SUSPENDIDO');
    const conRequisito = await crearCliente();
    const previo = await prisma.requisitoCliente.create({
      data: { clienteId: conRequisito.id, tipoDocumentoId: tipo, cantidad: 4, diasAproximados: [] },
    });
    await prisma.cliente.update({ where: { id: conRequisito.id }, data: { matrizConfigurada: true } });

    const res = await masivo({
      tipoDocumentoId: tipo,
      clientes: [
        { clienteId: nuevo.id },
        { clienteId: suspendido.id },
        { clienteId: conRequisito.id },
      ],
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      creados: [nuevo.id],
      omitidos: [
        { clienteId: suspendido.id, motivo: 'CLIENTE_NO_ACTIVO' },
        { clienteId: conRequisito.id, motivo: 'REQUISITO_DUPLICADO' },
      ],
    });
    expect(await activosDe(suspendido.id)).toBe(0);
    expect(await flagDe(suspendido.id)).toBe(false);
    expect(await flagDe(nuevo.id)).toBe(true);
    const intacto = await prisma.requisitoCliente.findUniqueOrThrow({ where: { id: previo.id } });
    expect(intacto.cantidad).toBe(4);
    expect(await activosDe(conRequisito.id)).toBe(1);
  });

  it('un requisito dado de baja no cuenta como duplicado', async () => {
    const tipo = await crearTipo('Factura');
    const cliente = await crearCliente();
    await prisma.requisitoCliente.create({
      data: {
        clienteId: cliente.id,
        tipoDocumentoId: tipo,
        cantidad: 1,
        diasAproximados: [],
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    const res = await masivo({ tipoDocumentoId: tipo, clientes: [{ clienteId: cliente.id }] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as ResultadoJson).creados).toEqual([cliente.id]);
    expect(await activosDe(cliente.id)).toBe(1);
    expect(await flagDe(cliente.id)).toBe(true);
  });

  it('un cliente inexistente es 404 y no se crea nada para los demás', async () => {
    const tipo = await crearTipo('Constancia');
    const cliente = await crearCliente();

    const res = await masivo({
      tipoDocumentoId: tipo,
      clientes: [{ clienteId: cliente.id }, { clienteId: randomUUID() }],
    });

    expect(res.status).toBe(404);
    expect(await activosDe(cliente.id)).toBe(0);
    expect(await flagDe(cliente.id)).toBe(false);
  });

  it('un tipo inactivo es 400 y no se crea nada', async () => {
    const tipo = await crearTipo('Inactivo');
    const cliente = await crearCliente();
    await prisma.tipoDocumento.update({ where: { id: tipo }, data: { activo: false } });

    const res = await masivo({ tipoDocumentoId: tipo, clientes: [{ clienteId: cliente.id }] });

    expect(res.status).toBe(400);
    expect(await activosDe(cliente.id)).toBe(0);
  });

  it('dos cargas simultáneas del mismo tipo crean un solo requisito por cliente', async () => {
    const tipo = await crearTipo('Carrera');
    const cliente = await crearCliente();
    const pedido = { tipoDocumentoId: tipo, clientes: [{ clienteId: cliente.id }] };

    const [r1, r2] = await Promise.all([masivo(pedido), masivo(pedido)]);

    expect([r1.status, r2.status]).toEqual([200, 200]);
    const creados = [r1, r2].flatMap((r) => (r.body as ResultadoJson).creados);
    expect(creados).toEqual([cliente.id]);
    expect(await activosDe(cliente.id)).toBe(1);
    expect(await flagDe(cliente.id)).toBe(true);
  });
});
