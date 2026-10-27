// Tests de integración de rendiciones (HU2.5) contra PostgreSQL REAL.
//
// Prueban lo que un mock no puede: que el índice único parcial de la factura se traduce en
// `409 RENDICION_DUPLICADA` (también con dos altas simultáneas), que la rendición y sus ítems se
// crean juntos, y que una rendición anulada libera su número de factura.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run rendiciones.integration
//
// No usa el seed. Cada test crea sus datos con una marca única y la limpieza final borra solo eso.

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

/** Marca única de esta corrida. Todos los tipos de prueba empiezan con ella. */
const MARCA = `TESTRN${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** Un período siempre válido: el mes actual (el máximo admitido es el siguiente). */
const PERIODO = mesActual();

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes, y pisa la de desarrollo.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    // Primero las rendiciones (sus ítems caen en cascada), después requisitos, clientes y tipos.
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

/** CUIT único. La base no valida el dígito verificador. El prefijo 38 no lo usa otra suite. */
const cuitDePrueba = () => `38-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

async function crearCliente(estado: 'ACTIVO' | 'INACTIVO' = 'ACTIVO') {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      estado,
    },
  });
  clientesCreados.push(cliente.id);
  return cliente;
}

async function crearRequisito(
  clienteId: string,
  nombreTipo: string,
  datos: { cantidad: number; diasAproximados: number[]; canalEntrega: 'PORTAL_WEB' | null },
) {
  const nombre = `${MARCA} ${nombreTipo}`;
  const tipo = await prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
  return prisma.requisitoCliente.create({
    data: { clienteId, tipoDocumentoId: tipo.id, ...datos },
  });
}

/** Cliente activo con Factura x1 (canal propio) y Print x2 (con días, sin canal propio). */
async function clienteConMatriz() {
  const cliente = await crearCliente();
  await crearRequisito(cliente.id, 'Factura', {
    cantidad: 1,
    diasAproximados: [],
    canalEntrega: 'PORTAL_WEB',
  });
  await crearRequisito(cliente.id, 'Print', {
    cantidad: 2,
    diasAproximados: [5, 20],
    canalEntrega: null,
  });
  return cliente;
}

const abrir = (clienteId: string, numeroFactura: string, periodo = PERIODO) =>
  request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura });
const anular = (id: string) =>
  request(app).patch(`/rendiciones/${id}/estado`).send({ estado: 'ANULADA' });

interface ItemJson {
  nombreTipoDocumento: string;
  ordinal: number;
  totalOrdinal: number;
  diaAproximado: number | null;
  canalEntrega: string;
  completado: boolean;
}
interface RendicionJson {
  id: string;
  numeroFactura: string;
  estado: string;
  anuladaEn: string | null;
  items?: ItemJson[];
  resumen?: { totalItems: number; completados: number };
}
const cuerpo = (res: request.Response) => res.body as RendicionJson;
const detalles = (res: request.Response) =>
  (res.body as { error: { details: Record<string, unknown> } }).error.details;

describe.skipIf(url === undefined)('rendiciones contra PostgreSQL real', () => {
  it('abre la rendición y su checklist en la base, con el snapshot de la matriz', async () => {
    const cliente = await clienteConMatriz();

    const res = await abrir(cliente.id, 'a 1-1');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(cuerpo(res).numeroFactura).toBe('A 00001-00000001');
    expect(
      cuerpo(res).items?.map(({ nombreTipoDocumento, ordinal, diaAproximado, canalEntrega }) => ({
        nombre: nombreTipoDocumento.replace(`${MARCA} `, ''),
        ordinal,
        diaAproximado,
        canalEntrega,
      })),
    ).toEqual([
      { nombre: 'Factura', ordinal: 1, diaAproximado: null, canalEntrega: 'PORTAL_WEB' },
      { nombre: 'Print', ordinal: 1, diaAproximado: 5, canalEntrega: 'CORREO' },
      { nombre: 'Print', ordinal: 2, diaAproximado: 20, canalEntrega: 'CORREO' },
    ]);
    expect(await prisma.itemChecklist.count({ where: { rendicionId: cuerpo(res).id } })).toBe(3);

    const lista = await request(app).get(`/clientes/${cliente.id}/rendiciones`);
    expect(lista.status).toBe(200);
    expect((lista.body as RendicionJson[]).map((r) => r.resumen)).toEqual([
      { totalItems: 3, completados: 0 },
    ]);
  });

  it('el detalle muestra los ítems en el mismo orden que la apertura (acentos y mayúsculas)', async () => {
    const cliente = await crearCliente();
    for (const nombre of ['Zeta', 'arco', 'Árbol', 'alfa']) {
      await crearRequisito(cliente.id, nombre, {
        cantidad: 1,
        diasAproximados: [],
        canalEntrega: null,
      });
    }

    const apertura = await abrir(cliente.id, 'A 00001-00000010');
    const detalle = await request(app).get(`/rendiciones/${cuerpo(apertura).id}`);

    const nombres = (res: request.Response) =>
      (cuerpo(res).items ?? []).map((item) => item.nombreTipoDocumento.replace(`${MARCA} `, ''));
    expect(nombres(apertura)).toEqual(['alfa', 'Árbol', 'arco', 'Zeta']);
    expect(nombres(detalle)).toEqual(nombres(apertura));
  });

  it('la misma factura en el mismo cliente, aun en otro período, es 409 RENDICION_DUPLICADA', async () => {
    const cliente = await clienteConMatriz();
    const primera = await abrir(cliente.id, 'B 00002-00000002');
    const anterior =
      PERIODO.mes === 1
        ? { anio: PERIODO.anio - 1, mes: 12 }
        : { anio: PERIODO.anio, mes: PERIODO.mes - 1 };

    // Otra escritura del mismo comprobante: la unicidad compara el valor canónico.
    const res = await abrir(cliente.id, ' b 2-2 ', anterior);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(detalles(res)).toEqual({
      motivo: 'RENDICION_DUPLICADA',
      rendicionExistente: {
        id: cuerpo(primera).id,
        ...PERIODO,
        numeroFactura: 'B 00002-00000002',
      },
    });
  });

  it('la misma factura en otro cliente se acepta', async () => {
    const uno = await clienteConMatriz();
    const otro = await clienteConMatriz();

    expect((await abrir(uno.id, 'A 00001-00000003')).status).toBe(201);
    expect((await abrir(otro.id, 'A 00001-00000003')).status).toBe(201);
  });

  it('con dos altas simultáneas de la misma factura se crea una sola', async () => {
    const cliente = await clienteConMatriz();

    const respuestas = await Promise.all([
      abrir(cliente.id, 'A 00001-00000004'),
      abrir(cliente.id, 'a 1-4'),
    ]);

    expect(respuestas.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.rendicion.count({ where: { clienteId: cliente.id, isDeleted: false } }),
    ).toBe(1);
  });

  it('anular conserva la rendición y sus ítems, es idempotente y libera la factura', async () => {
    const cliente = await clienteConMatriz();
    const abierta = cuerpo(await abrir(cliente.id, 'A 00001-00000005'));

    const primera = await anular(abierta.id);
    const segunda = await anular(abierta.id);

    expect(primera.status).toBe(200);
    expect(cuerpo(primera)).toMatchObject({ estado: 'ANULADA' });
    expect(cuerpo(segunda).anuladaEn).toBe(cuerpo(primera).anuladaEn);
    expect(await prisma.itemChecklist.count({ where: { rendicionId: abierta.id } })).toBe(3);
    const detalle = await request(app).get(`/rendiciones/${abierta.id}`);
    expect(detalle.status).toBe(200);
    expect(cuerpo(detalle)).toMatchObject({ estado: 'ANULADA' });
    expect(
      ((await request(app).get(`/clientes/${cliente.id}/rendiciones`)).body as unknown[]).length,
    ).toBe(0);
    expect((await abrir(cliente.id, 'a 1-5')).status).toBe(201);
  });

  it('el filtro de estado separa activas y anuladas; con TODAS, las activas van primero', async () => {
    const cliente = await clienteConMatriz();
    const anterior =
      PERIODO.mes === 1
        ? { anio: PERIODO.anio - 1, mes: 12 }
        : { anio: PERIODO.anio, mes: PERIODO.mes - 1 };
    // La anulada es la del período más reciente: sin el orden por estado iría primera.
    const anulada = cuerpo(await abrir(cliente.id, 'A 00001-00000011'));
    const activa = cuerpo(await abrir(cliente.id, 'A 00001-00000012', anterior));
    await anular(anulada.id);
    const listar = async (query: string) =>
      (
        (await request(app).get(`/clientes/${cliente.id}/rendiciones${query}`))
          .body as RendicionJson[]
      ).map(({ id, estado }) => ({ id, estado }));

    expect(await listar('')).toEqual([{ id: activa.id, estado: 'ACTIVA' }]);
    expect(await listar('?estado=ANULADA')).toEqual([{ id: anulada.id, estado: 'ANULADA' }]);
    expect(await listar('?estado=TODAS')).toEqual([
      { id: activa.id, estado: 'ACTIVA' },
      { id: anulada.id, estado: 'ANULADA' },
    ]);
  });

  it('sin requisitos activos es 409 MATRIZ_VACIA y no crea nada', async () => {
    const cliente = await crearCliente();

    const res = await abrir(cliente.id, 'A 00001-00000006');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'MATRIZ_VACIA' });
    expect(await prisma.rendicion.count({ where: { clienteId: cliente.id } })).toBe(0);
  });

  it('con el cliente inactivo es 409 CLIENTE_NO_ACTIVO', async () => {
    const cliente = await crearCliente('INACTIVO');

    const res = await abrir(cliente.id, 'A 00001-00000007');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' });
  });
});
