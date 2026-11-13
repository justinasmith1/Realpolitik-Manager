// Estado de la rendición (HU3.1, ADR-0005) contra PostgreSQL REAL:
// - una rendición nueva nace EN_CURSO, con su entrada inicial de historial (null → EN_CURSO)
// - el listado filtra por estado (y rechaza uno inválido)
// - el detalle trae el historial, del cambio más viejo al más nuevo
// - una rendición anulada conserva el último estado que tenía
//
// El estado todavía no se cambia por la API (HU3.6 a HU3.9): los tests usan el punto único del
// service, `registrarCambioDeEstado`.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { mesActual, normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sesionesDePrueba } from '../../auth/__tests__/sesionReal';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import type * as Servicio from '../rendiciones.service';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
let registrarCambioDeEstado: typeof Servicio.registrarCambioDeEstado;
const clientesCreados: string[] = [];

const MARCA = `TESTER${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);
const PERIODO = mesActual();

/** Cuentas y sesiones reales de este archivo (ADMINISTRATIVO por defecto). */
const sesiones = sesionesDePrueba();

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  await sesiones.preparar();
  ({ prisma } = await import('../../../lib/prisma'));
  ({ registrarCambioDeEstado } = await import('../rendiciones.service'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    // El historial cae en cascada con la rendición.
    await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
    await prisma.tipoDocumento.deleteMany({
      where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
    });
  } finally {
    await sesiones.limpiar();
    await prisma.$disconnect();
  }
});

const cuitDePrueba = () => `33-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

// El número de factura es único por emisor entre todas las rendiciones activas: un punto de venta
// propio y una base al azar evitan chocar con otros datos de prueba.
const BASE_FACTURA = randomInt(1e7);
let secuencia = 0;
const facturaUnica = () =>
  `C 00031-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

async function clienteConMatriz() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'estado@ejemplo.example',
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
    data: { clienteId: cliente.id, tipoDocumentoId: tipo.id, cantidad: 1, diasAproximados: [] },
  });
  return cliente;
}

interface HistorialJson {
  estadoAnterior: string | null;
  estadoNuevo: string;
  fecha: string;
  fechaEfectiva?: string | null;
  motivo?: string | null;
}
interface RendicionJson {
  id: string;
  estado: string;
  vigencia: string;
  creadoEn: string;
  historial?: HistorialJson[];
}

async function abrir(clienteId: string): Promise<RendicionJson> {
  const res = await sesiones
    .cliente(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...PERIODO, numeroFactura: facturaUnica() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as RendicionJson;
}

const listar = async (clienteId: string, query: string) =>
  (await sesiones.cliente(app).get(`/clientes/${clienteId}/rendiciones${query}`))
    .body as RendicionJson[];

const detalle = async (id: string) =>
  (await sesiones.cliente(app).get(`/rendiciones/${id}`)).body as RendicionJson;

describe.skipIf(url === undefined)('Estado de la rendición (HU3.1) contra PostgreSQL real', () => {
  it('una rendición nueva nace EN_CURSO, con su entrada inicial de historial', async () => {
    const cliente = await clienteConMatriz();

    const abierta = await abrir(cliente.id);

    expect(abierta.estado).toBe('EN_CURSO');
    expect(abierta.historial).toEqual([
      {
        estadoAnterior: null,
        estadoNuevo: 'EN_CURSO',
        fecha: expect.any(String) as unknown,
        fechaEfectiva: null,
        motivo: null,
      },
    ]);
    // La entrada se escribió en la misma alta: es del momento en que se creó la rendición.
    const [entrada] = abierta.historial ?? [];
    const diferencia = Math.abs(
      new Date(entrada?.fecha ?? 0).getTime() - new Date(abierta.creadoEn).getTime(),
    );
    expect(diferencia).toBeLessThan(5000);
    const filas = await prisma.historialEstadoRendicion.findMany({
      where: { rendicionId: abierta.id },
    });
    expect(filas).toEqual([
      expect.objectContaining({ estadoAnterior: null, estadoNuevo: 'EN_CURSO', motivo: null }),
    ]);
  });

  it('el listado filtra por estado y rechaza uno inválido', async () => {
    const cliente = await clienteConMatriz();
    const enCurso = await abrir(cliente.id);
    const completa = await abrir(cliente.id);
    await registrarCambioDeEstado(completa.id, 'COMPLETA');

    const ids = (lista: RendicionJson[]) => lista.map((r) => [r.id, r.estado]);
    expect(ids(await listar(cliente.id, '?estado=COMPLETA'))).toEqual([[completa.id, 'COMPLETA']]);
    expect(ids(await listar(cliente.id, '?estado=EN_CURSO'))).toEqual([[enCurso.id, 'EN_CURSO']]);
    expect(await listar(cliente.id, '?estado=ENVIADA')).toEqual([]);
    expect((await listar(cliente.id, '')).map((r) => r.estado).sort()).toEqual([
      'COMPLETA',
      'EN_CURSO',
    ]);

    const invalido = await sesiones
      .cliente(app)
      .get(`/clientes/${cliente.id}/rendiciones?estado=ATRASADA`);
    expect(invalido.status).toBe(400);
    expect(invalido.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'estado' }] },
    });
  });

  it('el detalle trae el historial, del cambio más viejo al más nuevo', async () => {
    const cliente = await clienteConMatriz();
    const abierta = await abrir(cliente.id);
    await registrarCambioDeEstado(abierta.id, 'COMPLETA');
    await registrarCambioDeEstado(abierta.id, 'ENVIADA');

    const visto = await detalle(abierta.id);

    expect(visto.estado).toBe('ENVIADA');
    expect(visto.historial?.map((h) => [h.estadoAnterior, h.estadoNuevo])).toEqual([
      [null, 'EN_CURSO'],
      ['EN_CURSO', 'COMPLETA'],
      ['COMPLETA', 'ENVIADA'],
    ]);
    const fechas = (visto.historial ?? []).map((h) => new Date(h.fecha).getTime());
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it('una rendición anulada conserva el último estado que tenía', async () => {
    const cliente = await clienteConMatriz();
    const abierta = await abrir(cliente.id);
    await registrarCambioDeEstado(abierta.id, 'COMPLETA');

    const anulacion = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${abierta.id}/vigencia`)
      .send({ vigencia: 'ANULADA' });

    expect(anulacion.status).toBe(200);
    expect(anulacion.body).toMatchObject({ vigencia: 'ANULADA', estado: 'COMPLETA' });
    expect(await detalle(abierta.id)).toMatchObject({ vigencia: 'ANULADA', estado: 'COMPLETA' });
    // La anulación no es un cambio de estado: el historial no suma una entrada.
    expect((await detalle(abierta.id)).historial).toHaveLength(2);
    expect(
      (await listar(cliente.id, '?vigencia=ANULADA&estado=COMPLETA')).map((r) => r.id),
    ).toEqual([abierta.id]);
  });

  // integración: corre Agus
  it('aprobar una ENVIADA (HU3.8): historial con APROBADA, motivo null y fechaEfectiva null', async () => {
    const cliente = await clienteConMatriz();
    const abierta = await abrir(cliente.id);
    await registrarCambioDeEstado(abierta.id, 'COMPLETA');
    await registrarCambioDeEstado(abierta.id, 'ENVIADA');

    const res = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${abierta.id}/estado`)
      .send({ estado: 'APROBADA' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ estado: 'APROBADA' });
    const filas = await prisma.historialEstadoRendicion.findMany({
      where: { rendicionId: abierta.id, estadoNuevo: 'APROBADA' },
    });
    expect(filas).toEqual([
      expect.objectContaining({
        estadoAnterior: 'ENVIADA',
        estadoNuevo: 'APROBADA',
        motivo: null,
        fechaEfectiva: null,
      }),
    ]);
  });

  // integración: corre Agus
  it('rechazar una ENVIADA con motivo (HU3.8): historial con RECHAZADA y ese motivo', async () => {
    const cliente = await clienteConMatriz();
    const abierta = await abrir(cliente.id);
    await registrarCambioDeEstado(abierta.id, 'COMPLETA');
    await registrarCambioDeEstado(abierta.id, 'ENVIADA');
    const motivo = 'Faltó el CUIT 20-12345678-4';

    const res = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${abierta.id}/estado`)
      .send({ estado: 'RECHAZADA', motivo });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ estado: 'RECHAZADA' });
    const filas = await prisma.historialEstadoRendicion.findMany({
      where: { rendicionId: abierta.id, estadoNuevo: 'RECHAZADA' },
    });
    expect(filas).toEqual([
      expect.objectContaining({ estadoAnterior: 'ENVIADA', motivo, fechaEfectiva: null }),
    ]);
    const visto = await detalle(abierta.id);
    expect(visto.historial?.at(-1)).toMatchObject({ estadoNuevo: 'RECHAZADA', motivo });
  });

  // integración: corre Agus
  it('rechazar sin motivo (HU3.8): 400 en motivo y la rendición sigue ENVIADA', async () => {
    const cliente = await clienteConMatriz();
    const abierta = await abrir(cliente.id);
    await registrarCambioDeEstado(abierta.id, 'COMPLETA');
    await registrarCambioDeEstado(abierta.id, 'ENVIADA');

    const res = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${abierta.id}/estado`)
      .send({ estado: 'RECHAZADA' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'motivo' }] },
    });
    expect((await detalle(abierta.id)).estado).toBe('ENVIADA');
  });
});
