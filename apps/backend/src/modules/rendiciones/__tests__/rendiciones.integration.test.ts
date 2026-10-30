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
import {
  mesActual,
  normalizarNombreTipoDocumento as normalizar,
  validateCuit,
} from '@realpolitik/shared';
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

/**
 * CUIT único y VÁLIDO (prefijo y dígito verificador): los tests de HU2.9 editan al cliente por la
 * API (`PATCH /clientes/:id`), y esa respuesta pasa por `ClienteSchema`, que rechaza un CUIT
 * inválido con un 500. La base no lo exige, pero el mapper sí. El prefijo 24 no lo usa otra suite.
 */
function cuitDePrueba(): string {
  for (;;) {
    const cuerpo = String(randomInt(1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador += 1) {
      if (validateCuit(`24${cuerpo}${verificador}`)) return `24-${cuerpo}-${verificador}`;
    }
  }
}

type EmisorDePrueba = 'PERSONA_FISICA' | 'SOCIEDAD';

async function crearCliente(
  estado: 'ACTIVO' | 'INACTIVO' = 'ACTIVO',
  emisor: EmisorDePrueba | null = 'SOCIEDAD',
) {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor,
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
async function clienteConMatriz(emisor: EmisorDePrueba | null = 'SOCIEDAD') {
  const cliente = await crearCliente('ACTIVO', emisor);
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

const abrir = (
  clienteId: string,
  numeroFactura: string,
  periodo = PERIODO,
  emisor?: EmisorDePrueba,
) =>
  request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura, ...(emisor === undefined ? {} : { emisor }) });
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
  clienteId: string;
  emisor: EmisorDePrueba | null;
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
        clienteId: cliente.id,
        ...PERIODO,
        numeroFactura: 'B 00002-00000002',
      },
    });
  });

  describe('emisor y unicidad por emisor (HU2.9)', () => {
    it('la misma factura con el mismo emisor en OTRO cliente es 409, con la existente y su clienteId', async () => {
      const uno = await clienteConMatriz();
      const otro = await clienteConMatriz();
      const primera = await abrir(uno.id, 'B 00007-00000001');

      const res = await abrir(otro.id, 'b 7-1');

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(detalles(res)).toEqual({
        motivo: 'RENDICION_DUPLICADA',
        rendicionExistente: {
          id: cuerpo(primera).id,
          clienteId: uno.id,
          ...PERIODO,
          numeroFactura: 'B 00007-00000001',
        },
      });
      expect(await prisma.rendicion.count({ where: { clienteId: otro.id } })).toBe(0);
    });

    it('el enlace "Ver rendición" del 409 funciona: la existente, de otro cliente, se puede leer por su id', async () => {
      const uno = await clienteConMatriz();
      const otro = await clienteConMatriz();
      await abrir(uno.id, 'B 00007-00000002');
      const conflicto = await abrir(otro.id, 'B 00007-00000002');
      const existente = (
        detalles(conflicto) as { rendicionExistente: { id: string; clienteId: string } }
      ).rendicionExistente;

      const detalle = await request(app).get(`/rendiciones/${existente.id}`);

      expect(detalle.status).toBe(200);
      expect(cuerpo(detalle)).toMatchObject({
        id: existente.id,
        clienteId: existente.clienteId,
        numeroFactura: 'B 00007-00000002',
      });
      expect(existente.clienteId).toBe(uno.id);
    });

    it('el mismo número con distinto emisor se acepta en el mismo cliente', async () => {
      const cliente = await clienteConMatriz('SOCIEDAD');
      await abrir(cliente.id, 'B 00007-00000003');

      const otroEmisor = await abrir(cliente.id, 'B 00007-00000003', PERIODO, 'PERSONA_FISICA');

      expect(otroEmisor.status, JSON.stringify(otroEmisor.body)).toBe(201);
      expect(cuerpo(otroEmisor).emisor).toBe('PERSONA_FISICA');
    });

    it('el mismo número con distinto emisor se acepta en otro cliente', async () => {
      const uno = await clienteConMatriz('SOCIEDAD');
      const otro = await clienteConMatriz('SOCIEDAD');
      await abrir(uno.id, 'B 00007-00000004');

      const otroEmisor = await abrir(otro.id, 'B 00007-00000004', PERIODO, 'PERSONA_FISICA');

      expect(otroEmisor.status, JSON.stringify(otroEmisor.body)).toBe(201);
    });

    it('un número igual al de una rendición heredada SIN emisor del mismo cliente se acepta: no hay choque', async () => {
      const cliente = await clienteConMatriz('SOCIEDAD');
      await prisma.rendicion.create({
        data: {
          clienteId: cliente.id,
          ...PERIODO,
          numeroFactura: 'B 00007-00000011',
          emisor: null,
        },
      });

      const res = await abrir(cliente.id, 'B 00007-00000011');

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(cuerpo(res).emisor).toBe('SOCIEDAD');
    });

    it('el 409 lleva a la rendición que chocó por emisor, no a una heredada del mismo cliente', async () => {
      const a = await clienteConMatriz('SOCIEDAD');
      const b = await clienteConMatriz('SOCIEDAD');
      // A tiene una heredada con el número N; B ya tiene (SOCIEDAD, N).
      await prisma.rendicion.create({
        data: { clienteId: a.id, ...PERIODO, numeroFactura: 'B 00007-00000012', emisor: null },
      });
      const deB = await abrir(b.id, 'B 00007-00000012');

      const res = await abrir(a.id, 'B 00007-00000012');

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(detalles(res)).toMatchObject({
        rendicionExistente: { id: cuerpo(deB).id, clienteId: b.id },
      });
    });

    it('una rendición anulada libera el número, también para otro cliente', async () => {
      const uno = await clienteConMatriz();
      const otro = await clienteConMatriz();
      const primera = cuerpo(await abrir(uno.id, 'B 00007-00000005'));
      expect((await abrir(otro.id, 'B 00007-00000005')).status).toBe(409);

      await anular(primera.id);

      expect((await abrir(otro.id, 'B 00007-00000005')).status).toBe(201);
    });

    it('con dos altas simultáneas de la misma factura y emisor en clientes distintos se crea una sola', async () => {
      const uno = await clienteConMatriz();
      const otro = await clienteConMatriz();

      const respuestas = await Promise.all([
        abrir(uno.id, 'B 00007-00000006'),
        abrir(otro.id, 'b 7-6'),
      ]);

      expect(respuestas.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.rendicion.count({
          where: { numeroFactura: 'B 00007-00000006', emisor: 'SOCIEDAD', isDeleted: false },
        }),
      ).toBe(1);
      const rechazada = respuestas.find((res) => res.status === 409);
      expect(detalles(rechazada as request.Response)).toMatchObject({
        motivo: 'RENDICION_DUPLICADA',
        rendicionExistente: { numeroFactura: 'B 00007-00000006' },
      });
    });

    it('copia el emisor del cliente al abrir y lo devuelve en el alta, el detalle y el listado', async () => {
      const cliente = await clienteConMatriz('PERSONA_FISICA');

      const alta = await abrir(cliente.id, 'B 00007-00000007');
      const detalle = await request(app).get(`/rendiciones/${cuerpo(alta).id}`);
      const lista = await request(app).get(`/clientes/${cliente.id}/rendiciones`);

      expect(alta.status, JSON.stringify(alta.body)).toBe(201);
      expect(cuerpo(alta).emisor).toBe('PERSONA_FISICA');
      expect(cuerpo(detalle).emisor).toBe('PERSONA_FISICA');
      expect((lista.body as RendicionJson[]).map((r) => r.emisor)).toEqual(['PERSONA_FISICA']);
      const fila = await prisma.rendicion.findUniqueOrThrow({ where: { id: cuerpo(alta).id } });
      expect(fila.emisor).toBe('PERSONA_FISICA');
    });

    it('el emisor del pedido prevalece sobre el del cliente, que no cambia', async () => {
      const cliente = await clienteConMatriz('SOCIEDAD');

      const alta = await abrir(cliente.id, 'B 00007-00000008', PERIODO, 'PERSONA_FISICA');

      expect(cuerpo(alta).emisor).toBe('PERSONA_FISICA');
      const fila = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(fila.emisor).toBe('SOCIEDAD');
    });

    it('un cliente sin emisor: sin emisor en el pedido es 400 en `emisor` y no crea nada; eligiéndolo se abre', async () => {
      const cliente = await clienteConMatriz(null);

      const sin = await abrir(cliente.id, 'B 00007-00000009');
      const con = await abrir(cliente.id, 'B 00007-00000009', PERIODO, 'SOCIEDAD');

      expect(sin.status).toBe(400);
      expect((sin.body as { error: { details: { campo: string }[] } }).error.details).toEqual([
        expect.objectContaining({ campo: 'emisor' }),
      ]);
      expect(con.status, JSON.stringify(con.body)).toBe(201);
      expect(cuerpo(con).emisor).toBe('SOCIEDAD');
      expect(await prisma.rendicion.count({ where: { clienteId: cliente.id } })).toBe(1);
    });

    it('cambiar el emisor del cliente no modifica una rendición ya abierta, ni su detalle ni su listado', async () => {
      const cliente = await clienteConMatriz('SOCIEDAD');
      const abierta = cuerpo(await abrir(cliente.id, 'B 00007-00000010'));

      const cambio = await request(app)
        .patch(`/clientes/${cliente.id}`)
        .send({ emisor: 'PERSONA_FISICA' });
      const quitado = await request(app).patch(`/clientes/${cliente.id}`).send({ emisor: null });

      expect(cambio.status).toBe(200);
      expect(quitado.status).toBe(200);
      const detalle = await request(app).get(`/rendiciones/${abierta.id}`);
      const lista = await request(app).get(`/clientes/${cliente.id}/rendiciones`);
      expect(cuerpo(detalle).emisor).toBe('SOCIEDAD');
      expect((lista.body as RendicionJson[]).map((r) => r.emisor)).toEqual(['SOCIEDAD']);
      const fila = await prisma.rendicion.findUniqueOrThrow({ where: { id: abierta.id } });
      expect(fila.emisor).toBe('SOCIEDAD');
    });
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
