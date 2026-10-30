// Integración de Orden de Compra (HU2.11) contra PostgreSQL REAL:
// - Persistencia de `numeroOc`, `montoMensual` y `montoTotal` (Decimal) al abrir y al editar (`PATCH /rendiciones/:id`)
// - Repetición permitida del mismo `numeroOc` en el mismo cliente (distintos meses o distintas facturas)
// - Rechazo 409 `OC_DE_OTRO_CLIENTE` si se intenta usar el `numeroOc` de una rendición activa de otro cliente
// - Una rendición anulada libera su `numeroOc` para otro cliente
// - `GET /clientes/:id/ultima-oc` devuelve la OC de la rendición activa más reciente con `numeroOc` no nulo (o `null`)
// - CHECK constraints en SQL (`ck_rendicion_numero_oc_no_vacio` y `ck_rendicion_montos_oc_no_negativos`)

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTOC${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
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

const cuitDePrueba = () => `32-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

let secuenciaFactura = 0;
const facturaUnica = () => `B 00077-${String(++secuenciaFactura).padStart(8, '0')}`;

async function crearClienteConRequisito() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'oc@ejemplo.example',
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
  await prisma.requisitoCliente.create({
    data: {
      clienteId: cliente.id,
      tipoDocumentoId: tipo.id,
      cantidad: 1,
      diasAproximados: [],
    },
  });
  return cliente;
}

describe.skipIf(url === undefined)('Orden de Compra (HU2.11) contra PostgreSQL real', () => {
  it('abre sin OC (null por defecto), edita con PATCH /rendiciones/:id y permite borrar con null', async () => {
    const cliente = await crearClienteConRequisito();

    const alta = await request(app)
      .post(`/clientes/${cliente.id}/rendiciones`)
      .send({ anio: 2026, mes: 9, numeroFactura: facturaUnica() });

    expect(alta.status).toBe(201);
    expect(alta.body).toMatchObject({
      numeroOc: null,
      montoMensual: null,
      montoTotal: null,
    });
    const rendicionId = (alta.body as { id: string }).id;

    const edicion = await request(app)
      .patch(`/rendiciones/${rendicionId}`)
      .send({ numeroOc: `OC-${MARCA}-1`, montoMensual: 1250000.5, montoTotal: 15000000 });

    expect(edicion.status).toBe(200);
    expect(edicion.body).toMatchObject({
      id: rendicionId,
      numeroOc: `OC-${MARCA}-1`,
      montoMensual: 1250000.5,
      montoTotal: 15000000,
    });

    const borrado = await request(app)
      .patch(`/rendiciones/${rendicionId}`)
      .send({ numeroOc: null, montoMensual: null, montoTotal: null });

    expect(borrado.status).toBe(200);
    expect(borrado.body).toMatchObject({
      numeroOc: null,
      montoMensual: null,
      montoTotal: null,
    });
  });

  it('permite repetir el mismo numeroOc en el mismo cliente, pero lo rechaza entre clientes distintos', async () => {
    const clienteA = await crearClienteConRequisito();
    const clienteB = await crearClienteConRequisito();
    const numeroOc = `OC-${MARCA}-COMPARTIDA`;

    const r1 = await request(app).post(`/clientes/${clienteA.id}/rendiciones`).send({
      anio: 2026,
      mes: 8,
      numeroFactura: facturaUnica(),
      numeroOc,
      montoMensual: 500000,
      montoTotal: 6000000,
    });
    expect(r1.status).toBe(201);

    // Mismo cliente, otra factura / otro mes: permitido.
    const r2 = await request(app).post(`/clientes/${clienteA.id}/rendiciones`).send({
      anio: 2026,
      mes: 9,
      numeroFactura: facturaUnica(),
      numeroOc,
      montoMensual: 500000,
      montoTotal: 6000000,
    });
    expect(r2.status).toBe(201);

    // Otro cliente al abrir: 409 OC_DE_OTRO_CLIENTE.
    const rechazoAlta = await request(app).post(`/clientes/${clienteB.id}/rendiciones`).send({
      anio: 2026,
      mes: 9,
      numeroFactura: facturaUnica(),
      numeroOc,
    });
    expect(rechazoAlta.status).toBe(409);
    expect(rechazoAlta.body).toMatchObject({
      error: { code: 'CONFLICT', details: { motivo: 'OC_DE_OTRO_CLIENTE', numeroOc } },
    });

    // Otro cliente al editar con PATCH: también 409 OC_DE_OTRO_CLIENTE.
    const rB = await request(app)
      .post(`/clientes/${clienteB.id}/rendiciones`)
      .send({ anio: 2026, mes: 9, numeroFactura: facturaUnica() });
    expect(rB.status).toBe(201);

    const rechazoPatch = await request(app)
      .patch(`/rendiciones/${(rB.body as { id: string }).id}`)
      .send({ numeroOc });
    expect(rechazoPatch.status).toBe(409);
    expect(rechazoPatch.body).toMatchObject({
      error: { code: 'CONFLICT', details: { motivo: 'OC_DE_OTRO_CLIENTE', numeroOc } },
    });
  });

  it('GET /clientes/:id/ultima-oc devuelve la OC de la rendición activa más reciente con numeroOc no nulo, o null si no hay', async () => {
    const cliente = await crearClienteConRequisito();

    const sinOc = await request(app).get(`/clientes/${cliente.id}/ultima-oc`);
    expect(sinOc.status).toBe(200);
    expect(sinOc.body).toBeNull();

    // Rendición de agosto con OC vieja
    await request(app)
      .post(`/clientes/${cliente.id}/rendiciones`)
      .send({
        anio: 2026,
        mes: 8,
        numeroFactura: facturaUnica(),
        numeroOc: `OC-${MARCA}-AGO`,
        montoMensual: 100000,
        montoTotal: 1200000,
      });

    // Rendición de septiembre con OC más nueva
    await request(app)
      .post(`/clientes/${cliente.id}/rendiciones`)
      .send({
        anio: 2026,
        mes: 9,
        numeroFactura: facturaUnica(),
        numeroOc: `OC-${MARCA}-SEP`,
        montoMensual: 200000,
        montoTotal: 2400000,
      });

    // Rendición de octubre sin OC (se ignora porque numeroOc es null)
    await request(app)
      .post(`/clientes/${cliente.id}/rendiciones`)
      .send({ anio: 2026, mes: 10, numeroFactura: facturaUnica() });

    const sugerencia = await request(app).get(`/clientes/${cliente.id}/ultima-oc`);
    expect(sugerencia.status).toBe(200);
    expect(sugerencia.body).toEqual({
      numeroOc: `OC-${MARCA}-SEP`,
      montoMensual: 200000,
      montoTotal: 2400000,
    });
  });

  it('la base rechaza con CHECK un numeroOc en blanco o montos negativos escritos por fuera de la app', async () => {
    const cliente = await crearClienteConRequisito();

    await expect(
      prisma.rendicion.create({
        data: {
          clienteId: cliente.id,
          anio: 2026,
          mes: 10,
          numeroFactura: facturaUnica(),
          emisor: 'SOCIEDAD',
          numeroOc: '   ',
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.rendicion.create({
        data: {
          clienteId: cliente.id,
          anio: 2026,
          mes: 10,
          numeroFactura: facturaUnica(),
          emisor: 'SOCIEDAD',
          montoMensual: -1,
        },
      }),
    ).rejects.toThrow();
  });
});
