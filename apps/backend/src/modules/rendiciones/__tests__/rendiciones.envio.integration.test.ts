// Tests de integración de la preparación del envío (HU2.5 con HU2.8) contra PostgreSQL REAL, con
// el almacenamiento de documentos en memoria.
//
// Prueban que el servidor decide con los datos de la base y no con lo que manda el cliente: un
// ítem pendiente, o completado sin una aplicación documental vigente, no se puede enviar aunque el
// pedido lo incluya. Y que preparar el envío no escribe nada.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run rendiciones.envio.integration
//
// No usa el seed. Cada dato lleva una marca única y la limpieza final borra solo eso.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  mesActual,
  normalizarNombreTipoDocumento as normalizar,
  PreparacionEnvioSchema,
  ResultadoCargaDocumentoSchema,
} from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { PDF } from '../../documentos/__tests__/archivosDePrueba';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTENV${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);
const PERIODO = mesActual();

/** CUIT único. La base no valida el dígito verificador. El prefijo 28 no lo usa otra suite. */
const cuitDePrueba = () => `28-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
const facturaDePrueba = () => `B 00028-${String(randomInt(1e8)).padStart(8, '0')}`;

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes, y pisa la de desarrollo.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  const { AlmacenamientoEnMemoria } = await import('../../../lib/almacenamiento/memoria');
  app = createApp({
    corsOrigins: ['http://localhost:5173'],
    documentos: { almacenamiento: new AlmacenamientoEnMemoria() },
  });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    const deLaMarca = { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } };
    await prisma.aplicacionDocumento.deleteMany({ where: { documento: deLaMarca } });
    await prisma.documento.deleteMany({ where: deLaMarca });
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

// ─── Datos ────────────────────────────────────────────────────────────────────

async function crearTipo(nombre: string) {
  const completo = `${MARCA} ${nombre}`;
  return prisma.tipoDocumento.create({
    data: { nombre: completo, nombreNormalizado: normalizar(completo) },
  });
}

interface RendicionAbierta {
  id: string;
  items: { id: string; tipoDocumentoId: string; ordinal: number }[];
}

async function abrir(clienteId: string): Promise<RendicionAbierta> {
  const res = await request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...PERIODO, numeroFactura: facturaDePrueba() });
  expect(res.status).toBe(201);
  return res.body as RendicionAbierta;
}

function item(rendicion: RendicionAbierta, tipoId: string, ordinal = 1): string {
  const encontrado = rendicion.items.find(
    (i) => i.tipoDocumentoId === tipoId && i.ordinal === ordinal,
  );
  if (encontrado === undefined) throw new Error('El escenario no tiene ese ítem.');
  return encontrado.id;
}

/** Carga un documento por la API y lo aplica a los ítems. Contenido distinto cada vez. */
async function cargarYAplicar(tipoDocumentoId: string, itemIds: string[]): Promise<string> {
  const carga = await request(app)
    .post('/documentos')
    .field({ tipoDocumentoId, anio: String(PERIODO.anio), mes: String(PERIODO.mes) })
    .attach('archivo', Buffer.concat([PDF, randomBytes(16)]), {
      filename: 'documento.pdf',
      contentType: 'application/pdf',
    });
  expect(carga.status).toBe(201);
  const documentoId = ResultadoCargaDocumentoSchema.parse(carga.body).documento.id;
  const aplicacion = await request(app)
    .post(`/documentos/${documentoId}/aplicaciones`)
    .send({ itemIds });
  expect(aplicacion.status).toBe(200);
  return documentoId;
}

const preparar = (rendicionId: string, itemIds: unknown) =>
  request(app).post(`/rendiciones/${rendicionId}/preparar-envio`).send({ itemIds });

const conflicto = (res: request.Response) =>
  (res.body as { error: { details: { motivo: string } & Record<string, unknown> } }).error.details;

/** Lo que preparar el envío no puede cambiar: los ítems y las aplicaciones del escenario. */
const fotoDeLaBase = async () => ({
  items: await prisma.itemChecklist.findMany({
    where: { rendicion: { clienteId: { in: clientesCreados } } },
    orderBy: { id: 'asc' },
  }),
  aplicaciones: await prisma.aplicacionDocumento.findMany({
    where: { itemChecklist: { rendicion: { clienteId: { in: clientesCreados } } } },
    orderBy: { id: 'asc' },
  }),
});

// ─── Escenario ────────────────────────────────────────────────────────────────
//
// Un cliente por correo con Print x2 y Factura x1 (la Factura, por portal). En r1: Print 1 de 2 y
// la Factura tienen documento; Print 2 de 2 está pendiente. En r2: Print 1 de 2 figura completado
// pero sin aplicación (un dato anterior a HU2.8, armado acá a mano). r3 se anula con Print 1 de 2
// completo.

const e = {} as {
  print: string;
  factura: string;
  r1: RendicionAbierta;
  r2: RendicionAbierta;
  r3: RendicionAbierta;
  dPrint: string;
};

describe.skipIf(url === undefined)('preparar el envío contra PostgreSQL', () => {
  beforeAll(async () => {
    const print = await crearTipo('Print');
    const factura = await crearTipo('Factura');
    const cliente = await prisma.cliente.create({
      data: {
        razonSocial: `${MARCA} Cliente`,
        denominacion: `${MARCA} Cliente`,
        cuit: cuitDePrueba(),
        ivaCondicion: 'EXENTO',
        emailContacto: 'rendiciones@ejemplo.example',
        sector: 'PRIVADO',
        canalEntrega: 'CORREO',
        emisor: 'SOCIEDAD',
        matrizConfigurada: true,
      },
    });
    clientesCreados.push(cliente.id);
    await prisma.requisitoCliente.createMany({
      data: [
        { clienteId: cliente.id, tipoDocumentoId: print.id, cantidad: 2 },
        {
          clienteId: cliente.id,
          tipoDocumentoId: factura.id,
          cantidad: 1,
          canalEntrega: 'PORTAL_WEB',
        },
      ],
    });

    const r1 = await abrir(cliente.id);
    const r2 = await abrir(cliente.id);
    const r3 = await abrir(cliente.id);
    const dPrint = await cargarYAplicar(print.id, [item(r1, print.id), item(r3, print.id)]);
    await cargarYAplicar(factura.id, [item(r1, factura.id)]);
    await prisma.itemChecklist.update({
      where: { id: item(r2, print.id) },
      data: { completado: true, completadoAt: new Date() },
    });
    expect(
      (await request(app).patch(`/rendiciones/${r3.id}/estado`).send({ estado: 'ANULADA' })).status,
    ).toBe(200);

    Object.assign(e, { print: print.id, factura: factura.id, r1, r2, r3, dPrint });
  });

  it('un ítem con documento vigente se prepara, con su canal y su documento', async () => {
    const res = await preparar(e.r1.id, [item(e.r1, e.print)]);

    expect(res.status).toBe(200);
    const preparacion = PreparacionEnvioSchema.parse(res.body);
    expect(preparacion.rendicionId).toBe(e.r1.id);
    expect(preparacion.canal).toBe('CORREO');
    expect(preparacion.items.map((i) => [i.id, i.documento.documentoId])).toEqual([
      [item(e.r1, e.print), e.dPrint],
    ]);
  });

  it('un pedido armado a mano con un ítem pendiente es 409 ITEM_PENDIENTE', async () => {
    const res = await preparar(e.r1.id, [item(e.r1, e.print, 2)]);

    expect(res.status).toBe(409);
    expect(conflicto(res)).toEqual({ motivo: 'ITEM_PENDIENTE', itemId: item(e.r1, e.print, 2) });
  });

  it('no alcanza con completado: sin aplicación vigente es 409 ITEM_SIN_DOCUMENTO_VIGENTE', async () => {
    const res = await preparar(e.r2.id, [item(e.r2, e.print)]);

    expect(res.status).toBe(409);
    expect(conflicto(res)).toEqual({
      motivo: 'ITEM_SIN_DOCUMENTO_VIGENTE',
      itemId: item(e.r2, e.print),
    });
  });

  it('con ítems en distintas condiciones informa el primero que no cumple, en el orden pedido', async () => {
    const res = await preparar(e.r1.id, [item(e.r1, e.print), item(e.r1, e.print, 2)]);

    expect(res.status).toBe(409);
    expect(conflicto(res)).toMatchObject({
      motivo: 'ITEM_PENDIENTE',
      itemId: item(e.r1, e.print, 2),
    });
  });

  it('como en HU2.5, los ítems de canales distintos no van en el mismo envío', async () => {
    const res = await preparar(e.r1.id, [item(e.r1, e.print), item(e.r1, e.factura)]);

    expect(res.status).toBe(409);
    expect(conflicto(res)).toEqual({
      motivo: 'CANALES_DISTINTOS',
      canales: ['CORREO', 'PORTAL_WEB'],
    });
  });

  it('una rendición anulada no se envía, aunque el ítem tenga documento', async () => {
    const res = await preparar(e.r3.id, [item(e.r3, e.print)]);

    expect(res.status).toBe(409);
    expect(conflicto(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
  });

  it('un ítem de otra rendición o una rendición inexistente son 404', async () => {
    expect((await preparar(e.r1.id, [item(e.r2, e.print)])).status).toBe(404);
    expect(
      (await preparar('00000000-0000-4000-8000-000000000000', [item(e.r1, e.print)])).status,
    ).toBe(404);
  });

  it('valida el cuerpo: vacío, repetido o con IDs inválidos es 400', async () => {
    const id = item(e.r1, e.print);
    for (const itemIds of [[], [id, id], ['x'], undefined]) {
      expect((await preparar(e.r1.id, itemIds)).status).toBe(400);
    }
  });

  it('la elegibilidad es la de ahora: al aplicarle un documento, el pendiente ya se prepara', async () => {
    const pendiente = item(e.r1, e.print, 2);
    expect((await preparar(e.r1.id, [pendiente])).status).toBe(409);

    await request(app)
      .post(`/documentos/${e.dPrint}/aplicaciones`)
      .send({ itemIds: [pendiente] })
      .expect(200);

    const res = await preparar(e.r1.id, [item(e.r1, e.print), pendiente]);
    expect(res.status).toBe(200);
    expect(PreparacionEnvioSchema.parse(res.body).items.map((i) => i.id)).toEqual([
      item(e.r1, e.print),
      pendiente,
    ]);
  });

  it('preparar el envío no escribe nada, salga bien o mal', async () => {
    const antes = await fotoDeLaBase();

    await preparar(e.r1.id, [item(e.r1, e.print)]);
    await preparar(e.r2.id, [item(e.r2, e.print)]);
    await preparar(e.r3.id, [item(e.r3, e.print)]);

    expect(await fotoDeLaBase()).toEqual(antes);
  });
});
