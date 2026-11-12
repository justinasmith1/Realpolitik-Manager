// Rendiciones atrasadas (HU3.4) contra PostgreSQL REAL: `GET /rendiciones/atrasadas` y la marca
// `atrasada` del listado del mes.
// - dos meses atrás, En curso o Completa: atrasada
// - dos meses atrás, Enviada: no
// - anulada: no
// - del mes anterior o del actual, sin enviar: no
// - de varios meses: de la más vieja a la más nueva
// - en el listado del mes: el campo `atrasada` y las atrasadas primero
//
// Los períodos se calculan respecto del mes actual en Buenos Aires (el servidor usa la fecha real).
// La base de tests es compartida: cada aserción mira solo las rendiciones de los clientes de esta
// suite. El estado se cambia con el punto único del service (`registrarCambioDeEstado`).
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  mesActual,
  mesesAPeriodo,
  normalizarNombreTipoDocumento as normalizar,
  periodoAMeses,
  type Periodo,
} from '@realpolitik/shared';
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

const MARCA = `TESTRA${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** El período `meses` meses antes del actual (en Buenos Aires). */
const mesesAtras = (meses: number): Periodo => mesesAPeriodo(periodoAMeses(mesActual()) - meses);
const ACTUAL = mesesAtras(0);
const ANTERIOR = mesesAtras(1);
const DOS_ATRAS = mesesAtras(2);
const TRES_ATRAS = mesesAtras(3);
const MUY_VIEJO = { anio: 2021, mes: 6 };

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
  `C 00033-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

/** Cliente activo con un requisito de 2 ítems. */
async function cliente(denominacion: string) {
  const creado = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} ${denominacion}`,
      denominacion: `${MARCA} ${denominacion}`,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'atrasadas@ejemplo.example',
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

async function abrir(clienteId: string, periodo: Periodo) {
  const res = await sesiones
    .cliente(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura: facturaUnica() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

interface FilaJson {
  id: string;
  clienteId: string;
  estado: string;
  atrasada: boolean;
  anio?: number;
  mes?: number;
}

const deEstaSuite = (filas: FilaJson[]) =>
  filas.filter((fila) => clientesCreados.includes(fila.clienteId));

async function atrasadas(): Promise<FilaJson[]> {
  const res = await sesiones.cliente(app).get('/rendiciones/atrasadas');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return deEstaSuite(res.body as FilaJson[]);
}

async function delMes({ anio, mes }: Periodo): Promise<FilaJson[]> {
  const res = await sesiones.cliente(app).get(`/rendiciones?anio=${anio}&mes=${mes}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return deEstaSuite(res.body as FilaJson[]);
}

describe.skipIf(url === undefined)('Rendiciones atrasadas (HU3.4, integración)', () => {
  // Se completan en el beforeAll, con el id de cada rendición creada.
  const ids = {
    dosAtrasEnCurso: '',
    dosAtrasCompleta: '',
    dosAtrasEnviada: '',
    dosAtrasAnulada: '',
    anterior: '',
    actual: '',
    tresAtras: '',
    muyVieja: '',
  };

  beforeAll(async () => {
    if (url === undefined) return;
    const a = await cliente('Andina');
    const b = await cliente('Zeta');

    ids.dosAtrasEnCurso = await abrir(a.id, DOS_ATRAS);
    ids.dosAtrasCompleta = await abrir(b.id, DOS_ATRAS);
    await registrarCambioDeEstado(ids.dosAtrasCompleta, 'COMPLETA');
    ids.dosAtrasEnviada = await abrir(a.id, DOS_ATRAS);
    await registrarCambioDeEstado(ids.dosAtrasEnviada, 'ENVIADA');
    ids.dosAtrasAnulada = await abrir(b.id, DOS_ATRAS);
    const anulada = await sesiones
      .cliente(app)
      .patch(`/rendiciones/${ids.dosAtrasAnulada}/vigencia`)
      .send({ vigencia: 'ANULADA' });
    expect(anulada.status).toBe(200);
    ids.anterior = await abrir(a.id, ANTERIOR);
    ids.actual = await abrir(b.id, ACTUAL);
    ids.tresAtras = await abrir(a.id, TRES_ATRAS);
    ids.muyVieja = await abrir(b.id, MUY_VIEJO);
  });

  it('dos meses atrás, En curso y Completa: aparecen', async () => {
    const lista = (await atrasadas()).map((fila) => fila.id);

    expect(lista).toContain(ids.dosAtrasEnCurso);
    expect(lista).toContain(ids.dosAtrasCompleta);
  });

  it('dos meses atrás Enviada, anulada, del mes anterior o del actual: no aparecen', async () => {
    const lista = (await atrasadas()).map((fila) => fila.id);

    const noAtrasadas = ['dosAtrasEnviada', 'dosAtrasAnulada', 'anterior', 'actual'] as const;
    for (const clave of noAtrasadas) {
      expect(lista, clave).not.toContain(ids[clave]);
    }
  });

  it('de varios meses: de la más vieja a la más nueva, con su período y atrasada: true', async () => {
    const lista = await atrasadas();

    expect(lista.map((fila) => fila.id)).toEqual([
      ids.muyVieja,
      ids.tresAtras,
      // A igual período, por cliente: Andina antes que Zeta.
      ids.dosAtrasEnCurso,
      ids.dosAtrasCompleta,
    ]);
    expect(lista[0]).toMatchObject({ anio: 2021, mes: 6, atrasada: true });
    expect(lista.every((fila) => fila.atrasada)).toBe(true);
  });

  it('listado del mes de dos meses atrás: las sin enviar, marcadas y primero', async () => {
    const lista = await delMes(DOS_ATRAS);

    expect(lista.map((fila) => [fila.id, fila.atrasada])).toEqual([
      [ids.dosAtrasEnCurso, true],
      [ids.dosAtrasCompleta, true],
      [ids.dosAtrasEnviada, false],
    ]);
  });

  it('listado del mes anterior y del actual: ninguna marcada', async () => {
    expect((await delMes(ANTERIOR)).map((fila) => fila.atrasada)).toEqual([false]);
    expect((await delMes(ACTUAL)).map((fila) => fila.atrasada)).toEqual([false]);
  });

  it('cuando una atrasada se marca como Enviada, deja de figurar', async () => {
    await registrarCambioDeEstado(ids.tresAtras, 'ENVIADA');

    const lista = (await atrasadas()).map((fila) => fila.id);

    expect(lista).not.toContain(ids.tresAtras);
    expect((await delMes(TRES_ATRAS)).map((fila) => fila.atrasada)).toEqual([false]);
  });
});
