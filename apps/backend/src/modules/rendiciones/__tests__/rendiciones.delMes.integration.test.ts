// Pantalla Rendiciones (HU3.2) contra PostgreSQL REAL: `GET /rendiciones?anio=&mes=`.
// - filtra por período y deja afuera las anuladas
// - un cliente con dos rendiciones en el mes tiene dos filas
// - orden: primero las atrasadas (HU3.4), después las Rechazadas, después por avance y por cliente
// - la fecha del último paso solo en Enviada, Aprobada y Rechazada
// - un período sin rendiciones da una lista vacía
//
// La base de tests es compartida: cada aserción mira solo las rendiciones de los clientes de esta
// suite, en períodos de 2021 que no usa ninguna otra. El estado se cambia con el punto único del
// service (`registrarCambioDeEstado`): todavía no hay endpoint (HU3.6 a HU3.9).
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
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

const MARCA = `TESTRM${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);
const MARZO = { anio: 2021, mes: 3 };
const ABRIL = { anio: 2021, mes: 4 };

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

const cuitDePrueba = () => `34-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

// La factura es única por emisor entre las activas: un punto de venta propio y una base al azar.
const BASE_FACTURA = randomInt(1e7);
let secuencia = 0;
const facturaUnica = () =>
  `C 00032-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

/** Cliente activo con un requisito de 2 ítems: cada rendición tiene 2 ítems. */
async function cliente(denominacion: string) {
  const creado = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} ${denominacion}`,
      denominacion: `${MARCA} ${denominacion}`,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'mes@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    },
  });
  clientesCreados.push(creado.id);
  const nombre = `${MARCA} Print`;
  const tipo = await prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
  await prisma.requisitoCliente.create({
    data: { clienteId: creado.id, tipoDocumentoId: tipo.id, cantidad: 2, diasAproximados: [] },
  });
  return creado;
}

async function abrir(clienteId: string, periodo: { anio: number; mes: number }) {
  const res = await sesiones
    .cliente(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura: facturaUnica() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** Marca como reunidos los primeros `cantidad` ítems de la rendición. */
async function reunir(rendicionId: string, cantidad: number) {
  const items = await prisma.itemChecklist.findMany({
    where: { rendicionId },
    orderBy: { ordinal: 'asc' },
    take: cantidad,
  });
  await prisma.itemChecklist.updateMany({
    where: { id: { in: items.map((item) => item.id) } },
    data: { completado: true, completadoAt: new Date() },
  });
}

interface FilaJson {
  id: string;
  clienteId: string;
  estado: string;
  avance: { reunidos: number; total: number; faltantes: number };
  ultimoPaso: { estado: string; fecha: string } | null;
  atrasada: boolean;
}

/** Las filas del período, solo de los clientes de esta suite. */
async function filasDe(periodo: { anio: number; mes: number }) {
  const res = await sesiones
    .cliente(app)
    .get(`/rendiciones?anio=${periodo.anio}&mes=${periodo.mes}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as FilaJson[]).filter((fila) => clientesCreados.includes(fila.clienteId));
}

describe.skipIf(url === undefined)('Pantalla Rendiciones (HU3.2) contra PostgreSQL real', () => {
  it('filtra por período, deja afuera las anuladas y da una fila por rendición', async () => {
    const muni = await cliente('Muni');
    const primera = await abrir(muni.id, MARZO);
    const segunda = await abrir(muni.id, MARZO);
    const anulada = await abrir(muni.id, MARZO);
    const deAbril = await abrir(muni.id, ABRIL);
    const anulacion = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${anulada}/vigencia`)
      .send({ vigencia: 'ANULADA' });
    expect(anulacion.status).toBe(200);

    const marzo = await filasDe(MARZO);

    expect(marzo.map((fila) => fila.id).sort()).toEqual([primera, segunda].sort());
    expect(marzo.every((fila) => fila.clienteId === muni.id)).toBe(true);
    expect((await filasDe(ABRIL)).map((fila) => fila.id)).toEqual([deAbril]);
  });

  // HU3.4: mayo de 2021 es de dos meses atrás o más, así que las En curso son atrasadas y van antes
  // que la Rechazada; entre ellas, por avance y, a igual avance, por cliente.
  it('ordena: primero las atrasadas (por avance y por cliente), después las Rechazadas', async () => {
    const alfa = await cliente('Alfa');
    const beta = await cliente('Beta');
    const rechazada = await abrir(beta.id, { anio: 2021, mes: 5 });
    const completa = await abrir(alfa.id, { anio: 2021, mes: 5 });
    const mitadBeta = await abrir(beta.id, { anio: 2021, mes: 5 });
    const mitadAlfa = await abrir(alfa.id, { anio: 2021, mes: 5 });
    const nada = await abrir(beta.id, { anio: 2021, mes: 5 });
    await reunir(rechazada, 2);
    await reunir(completa, 2);
    await reunir(mitadBeta, 1);
    await reunir(mitadAlfa, 1);
    await registrarCambioDeEstado(rechazada, 'RECHAZADA');

    const filas = await filasDe({ anio: 2021, mes: 5 });

    expect(filas.map((fila) => fila.id)).toEqual([nada, mitadAlfa, mitadBeta, completa, rechazada]);
    expect(filas.map((fila) => fila.atrasada)).toEqual([true, true, true, true, false]);
    expect(filas.find((fila) => fila.id === mitadAlfa)?.avance).toEqual({
      reunidos: 1,
      total: 2,
      faltantes: 1,
    });
  });

  it('la fecha del último paso es la de la entrada que la llevó a Enviada; En curso y Completa no tienen', async () => {
    const gamma = await cliente('Gamma');
    const enviada = await abrir(gamma.id, { anio: 2021, mes: 6 });
    const enCurso = await abrir(gamma.id, { anio: 2021, mes: 6 });
    const completa = await abrir(gamma.id, { anio: 2021, mes: 6 });
    await registrarCambioDeEstado(completa, 'COMPLETA');
    await registrarCambioDeEstado(enviada, 'COMPLETA');
    const detalle = await registrarCambioDeEstado(enviada, 'ENVIADA');
    const entradaDeEnvio = detalle.historial.at(-1);

    const filas = await filasDe({ anio: 2021, mes: 6 });
    const de = (rendicionId: string) => filas.find((fila) => fila.id === rendicionId);

    expect(de(enviada)?.ultimoPaso).toEqual({
      estado: 'ENVIADA',
      fecha: entradaDeEnvio?.fecha.toISOString(),
    });
    expect(de(enCurso)?.ultimoPaso).toBeNull();
    expect(de(completa)?.ultimoPaso).toBeNull();
  });

  it('un período sin rendiciones da una lista vacía', async () => {
    await cliente('Delta');

    expect(await filasDe({ anio: 2021, mes: 7 })).toEqual([]);
  });

  it('sin el período, o con uno inválido, es 400', async () => {
    expect((await sesiones.cliente(app).get('/rendiciones')).status).toBe(400);
    expect((await sesiones.cliente(app).get('/rendiciones?anio=2021&mes=13')).status).toBe(400);
  });
});
