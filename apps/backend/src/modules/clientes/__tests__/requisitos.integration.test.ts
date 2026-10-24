// Tests de integración de la matriz de requisitos (HU2.2) contra PostgreSQL REAL.
//
// Prueban lo que un mock no puede: el índice único parcial, los CHECK, la baja lógica con
// referencias históricas y que `matrizConfigurada` quede igual al conteo de requisitos activos
// cuando dos escrituras del mismo cliente se confirman a la vez.
//
// Sin `TEST_DATABASE_URL` se saltan. Esta suite, además, se niega a escribir si esa URL no es
// `127.0.0.1:5433/realpolitik_test` en local o `localhost:5432/realpolitik_test` en GitHub Actions.
// No alcanza con que el nombre termine en `_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run requisitos.integration
//
// No usa el seed. Cada test crea sus datos con una marca única y la limpieza final borra solo eso.

import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar, validateCuit } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from './baseDescartable';
import { exigirBaseDeEstaSuite } from './requisitosIntegrationEntorno';

const url = urlDeBaseDescartable();

/** Índice único parcial de un requisito activo por cliente y tipo. */
const INDICE_REQUISITO_ACTIVO = 'uq_requisito_cliente_tipo_activo';

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

/** Marca única de esta corrida. Todos los tipos de prueba empiezan con ella. */
const MARCA = `TESTRQ${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

const n = (texto: string) => `${MARCA} ${texto}`;

beforeAll(async () => {
  if (url === undefined) return;
  exigirBaseDeEstaSuite(url);
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes, y pisa la de desarrollo.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const [info] = await prisma.$queryRaw<{ db: string; version: string }[]>`
    SELECT current_database() AS db, version() AS version`;
  if (
    info === undefined ||
    info.db !== 'realpolitik_test' ||
    !info.version.startsWith('PostgreSQL 16')
  ) {
    throw new Error(
      `La conexión no es PostgreSQL 16 sobre realpolitik_test (base=${info?.db ?? 'sin fila'}).`,
    );
  }
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    // El ítem referencia al requisito y la rendición referencia al cliente: primero la rendición
    // (sus ítems caen en cascada), después el requisito, el cliente y al final el tipo.
    await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
    await prisma.tipoDocumento.deleteMany({
      where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
    });

    const [requisitos, rendiciones, clientes, tipos] = await Promise.all([
      prisma.requisitoCliente.count({ where: { clienteId: { in: clientesCreados } } }),
      prisma.rendicion.count({ where: { clienteId: { in: clientesCreados } } }),
      prisma.cliente.count({ where: { id: { in: clientesCreados } } }),
      prisma.tipoDocumento.count({
        where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
      }),
    ]);
    expect(requisitos).toBe(0);
    expect(rendiciones).toBe(0);
    expect(clientes).toBe(0);
    expect(tipos).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

interface TipoJson {
  id: string;
  nombre: string;
  activo: boolean;
}

interface RequisitoJson {
  id: string;
  clienteId: string;
  tipoDocumento: { id: string; nombre: string; activo: boolean };
  cantidad: number;
  diasAproximados: number[];
  canalEntrega: 'CORREO' | 'PORTAL_WEB' | 'WHATSAPP' | null;
  nota: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

const CAMPOS_DEL_CONTRATO = [
  'actualizadoEn',
  'canalEntrega',
  'cantidad',
  'clienteId',
  'creadoEn',
  'diasAproximados',
  'id',
  'nota',
  'tipoDocumento',
];

const ruta = (clienteId: string) => `/clientes/${clienteId}/requisitos`;
const listar = (clienteId: string) => request(app).get(ruta(clienteId));
const alta = (clienteId: string, body: object) => request(app).post(ruta(clienteId)).send(body);
const editar = (clienteId: string, requisitoId: string, body: object) =>
  request(app)
    .patch(`${ruta(clienteId)}/${requisitoId}`)
    .send(body);
const baja = (clienteId: string, requisitoId: string) =>
  request(app).delete(`${ruta(clienteId)}/${requisitoId}`);

/**
 * CUIT único. La base no valida el dígito verificador. El prefijo 37 no lo usa otra suite
 * (27, 33, 34, 35, 36, 9X y 99 ya están tomados).
 */
function cuitDePrueba(): string {
  return `37-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
}

/** CUIT que también pasa `ClienteSchema`. El prefijo 23 no lo usa otra suite. */
function cuitValido(): string {
  for (;;) {
    const cuerpo = String(randomInt(1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador += 1) {
      if (validateCuit(`23${cuerpo}${verificador}`)) return `23-${cuerpo}-${verificador}`;
    }
  }
}

async function crearCliente(
  estado: 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO' = 'ACTIVO',
  cuit: string = cuitDePrueba(),
) {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit,
      ivaCondicion: 'EXENTO',
      emailContacto: 'requisitos@ejemplo.example',
      sector: 'PRIVADO',
      estado,
    },
  });
  clientesCreados.push(cliente.id);
  return cliente;
}

async function crearTipo(nombre: string): Promise<TipoJson> {
  const respuesta = await request(app).post('/tipos-documento').send({ nombre });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return respuesta.body as TipoJson;
}

async function desactivarTipo(id: string): Promise<void> {
  const respuesta = await request(app)
    .patch(`/tipos-documento/${id}/estado`)
    .send({ activo: false });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
}

async function crearRequisito(clienteId: string, tipoDocumentoId: string, body: object = {}) {
  const respuesta = await alta(clienteId, { tipoDocumentoId, ...body });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return respuesta.body as RequisitoJson;
}

async function flagDe(clienteId: string): Promise<boolean> {
  const cliente = await prisma.cliente.findUniqueOrThrow({
    where: { id: clienteId },
    select: { matrizConfigurada: true },
  });
  return cliente.matrizConfigurada;
}

async function activosDe(clienteId: string): Promise<number> {
  return prisma.requisitoCliente.count({ where: { clienteId, isDeleted: false } });
}

/** `xmin` cambia con cualquier UPDATE. Si no cambia, la fila no se escribió. */
async function versionDeRequisito(id: string): Promise<{
  xmin: string;
  updatedAt: Date;
  cantidad: number;
  dias: number[];
  isDeleted: boolean;
}> {
  const filas = await prisma.$queryRaw<
    { xmin: string; updatedAt: Date; cantidad: number; dias: number[]; isDeleted: boolean }[]
  >`
    SELECT xmin::text AS xmin, "updatedAt", cantidad, "diasAproximados" AS dias, "isDeleted"
    FROM "RequisitoCliente" WHERE id = ${id}::uuid`;
  const fila = filas[0];
  if (fila === undefined) throw new Error(`No existe el requisito ${id}`);
  return fila;
}

/** La misma lectura del P2002 que hace `esRequisitoDuplicado`. */
function reconoceIndiceParcial(target: unknown): boolean {
  if (typeof target === 'string') return target.includes(INDICE_REQUISITO_ACTIVO);
  if (!Array.isArray(target)) return false;
  const campos = target.filter((campo): campo is string => typeof campo === 'string');
  return (
    campos.includes(INDICE_REQUISITO_ACTIVO) ||
    (campos.includes('clienteId') && campos.includes('tipoDocumentoId'))
  );
}

/**
 * Texto en el que `textoDeCheck` busca el nombre del constraint. Si Prisma cambia el envoltorio,
 * este helper deja de ver el nombre y el test falla con el error crudo.
 */
function textoDeCheckObservable(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    const detalle = error.meta?.database_error;
    return typeof detalle === 'string' ? detalle : error.message;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return error.message;
  return null;
}

interface VarianteInvalida {
  cantidad?: number;
  diasAproximados?: number[];
  isDeleted?: boolean;
  deletedAt?: Date | null;
}

async function esperarCheck(
  clienteId: string,
  data: Prisma.RequisitoClienteUncheckedCreateInput,
  constraint: string,
) {
  let error: unknown;
  try {
    await prisma.requisitoCliente.create({ data });
    throw new Error(`PostgreSQL aceptó una fila que viola ${constraint}`);
  } catch (capturado) {
    if (capturado instanceof Error && capturado.message.startsWith('PostgreSQL aceptó')) {
      throw capturado;
    }
    error = capturado;
  }
  const texto = textoDeCheckObservable(error);
  const detalle = error instanceof Error ? error.message : String(error);
  expect(texto, detalle).toContain(constraint);
  expect(await prisma.requisitoCliente.count({ where: { clienteId } })).toBe(0);
}

describe.skipIf(url === undefined)('Requisitos de cliente contra PostgreSQL real', () => {
  describe('alta y lectura', () => {
    it('guarda la fila, devuelve el DTO y marca la matriz como configurada', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Factura A'));
      expect(await flagDe(cliente.id)).toBe(false);

      const respuesta = await alta(cliente.id, {
        tipoDocumentoId: tipo.id,
        cantidad: 2,
        diasAproximados: [1, 15],
        canalEntrega: 'CORREO',
        nota: 'Legajo',
      });

      expect(respuesta.status).toBe(201);
      const cuerpo = respuesta.body as RequisitoJson;
      expect(Object.keys(cuerpo).sort()).toEqual(CAMPOS_DEL_CONTRATO);
      expect(Object.keys(cuerpo.tipoDocumento).sort()).toEqual(['activo', 'id', 'nombre']);

      const fila = await prisma.requisitoCliente.findUniqueOrThrow({
        where: { id: cuerpo.id },
        include: { tipoDocumento: true },
      });
      expect(fila).toMatchObject({
        clienteId: cliente.id,
        tipoDocumentoId: tipo.id,
        cantidad: 2,
        diasAproximados: [1, 15],
        canalEntrega: 'CORREO',
        nota: 'Legajo',
        isDeleted: false,
        deletedAt: null,
      });
      expect(cuerpo).toMatchObject({
        id: fila.id,
        clienteId: cliente.id,
        tipoDocumento: { id: tipo.id, nombre: tipo.nombre, activo: true },
        cantidad: 2,
        diasAproximados: [1, 15],
        canalEntrega: 'CORREO',
        nota: 'Legajo',
      });
      expect(cuerpo.creadoEn).toBe(fila.createdAt.toISOString());
      expect(cuerpo.actualizadoEn).toBe(fila.updatedAt.toISOString());
      expect(await flagDe(cliente.id)).toBe(true);

      const listado = await listar(cliente.id);
      expect(listado.status).toBe(200);
      const requisitos = listado.body as RequisitoJson[];
      expect(requisitos.map((requisito) => requisito.id)).toEqual([fila.id]);
    });
  });

  describe('duplicados concurrentes', () => {
    it('dos altas simultáneas del mismo tipo dejan una sola fila y un 409', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Duplicado'));

      const respuestas = await Promise.all([
        alta(cliente.id, { tipoDocumentoId: tipo.id, cantidad: 1, nota: 'primera' }),
        alta(cliente.id, { tipoDocumentoId: tipo.id, cantidad: 2, nota: 'segunda' }),
      ]);
      const resumen = respuestas.map((r) => ({ status: r.status, body: r.body as unknown }));
      const creadas = respuestas.filter((r) => r.status === 201);
      const rechazadas = respuestas.filter((r) => r.status !== 201);

      expect(creadas, JSON.stringify(resumen)).toHaveLength(1);
      expect(rechazadas, JSON.stringify(resumen)).toHaveLength(1);
      const creada = creadas[0]?.body as RequisitoJson;
      const rechazada = rechazadas[0];
      expect(rechazada?.status, JSON.stringify(resumen)).toBe(409);
      expect(rechazada?.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'El cliente ya tiene un requisito para ese tipo de documento',
          details: {
            requisitoExistente: {
              id: creada.id,
              tipoDocumentoId: tipo.id,
              cantidad: creada.cantidad,
            },
            motivo: 'REQUISITO_DUPLICADO',
          },
        },
      });
      expect(await activosDe(cliente.id)).toBe(1);
      expect(
        await prisma.requisitoCliente.count({
          where: { clienteId: cliente.id, tipoDocumentoId: tipo.id },
        }),
      ).toBe(1);
    });
  });

  describe('días aproximados', () => {
    it('ordena los días y rechaza una cantidad incompatible sin escribir', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Dias'));
      const creado = await crearRequisito(cliente.id, tipo.id, {
        cantidad: 3,
        diasAproximados: [20, 1, 15],
      });
      expect(creado.diasAproximados).toEqual([1, 15, 20]);

      const fila = await prisma.requisitoCliente.findUniqueOrThrow({ where: { id: creado.id } });
      expect(fila.diasAproximados).toEqual([1, 15, 20]);
      const antes = await versionDeRequisito(creado.id);

      const respuesta = await editar(cliente.id, creado.id, { cantidad: 2 });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [
            {
              campo: 'diasAproximados',
              mensaje: 'Cargá 2 días aproximados (uno por documento) o dejá la lista vacía.',
            },
          ],
        },
      });
      expect(await versionDeRequisito(creado.id)).toEqual(antes);
    });
  });

  describe('baja lógica', () => {
    it('conserva la fila, la oculta y permite crear otra del mismo tipo', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Baja'));
      const creado = await crearRequisito(cliente.id, tipo.id, { nota: 'original' });

      const primera = await baja(cliente.id, creado.id);
      expect(primera.status).toBe(204);
      expect(primera.text).toBe('');

      const fila = await prisma.requisitoCliente.findUniqueOrThrow({ where: { id: creado.id } });
      expect(fila.isDeleted).toBe(true);
      expect(fila.deletedAt).toBeInstanceOf(Date);
      expect(await listar(cliente.id)).toMatchObject({ status: 200, body: [] });

      const repetida = await baja(cliente.id, creado.id);
      expect(repetida.status).toBe(404);
      expect(repetida.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Requisito no encontrado' },
      });

      const recreado = await crearRequisito(cliente.id, tipo.id, { nota: 'nuevo' });
      expect(recreado.id).not.toBe(creado.id);
      const filas = await prisma.requisitoCliente.findMany({
        where: { clienteId: cliente.id, tipoDocumentoId: tipo.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(filas.map((item) => [item.id, item.isDeleted])).toEqual([
        [creado.id, true],
        [recreado.id, false],
      ]);
      const visibles = (await listar(cliente.id)).body as RequisitoJson[];
      expect(visibles.map((item) => item.id)).toEqual([recreado.id]);
    });
  });

  describe('matrizConfigurada', () => {
    it('sigue el número de requisitos activos', async () => {
      const cliente = await crearCliente();
      const primero = await crearTipo(n('Matriz uno'));
      const segundo = await crearTipo(n('Matriz dos'));
      expect(await flagDe(cliente.id)).toBe(false);
      expect(await activosDe(cliente.id)).toBe(0);

      const altaUno = await crearRequisito(cliente.id, primero.id);
      expect(await flagDe(cliente.id)).toBe(true);

      const altaDos = await crearRequisito(cliente.id, segundo.id);
      expect(await flagDe(cliente.id)).toBe(true);

      expect((await baja(cliente.id, altaUno.id)).status).toBe(204);
      expect(await activosDe(cliente.id)).toBe(1);
      expect(await flagDe(cliente.id)).toBe(true);

      expect((await baja(cliente.id, altaDos.id)).status).toBe(204);
      expect(await activosDe(cliente.id)).toBe(0);
      expect(await flagDe(cliente.id)).toBe(false);
    });

    it('GET del cliente y el filtro del listado reflejan el flag', async () => {
      const cliente = await crearCliente('ACTIVO', cuitValido());
      const tipo = await crearTipo(n('Flag HTTP'));
      const marcaLista = `${MARCA} HTTP`;
      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { razonSocial: marcaLista },
      });
      const ids = (body: unknown) =>
        (body as { id: string; matrizConfigurada: boolean }[]).map((item) => item.id);
      const todos = (body: unknown, valor: boolean) =>
        (body as { matrizConfigurada: boolean }[]).every(
          (item) => item.matrizConfigurada === valor,
        );
      const listarFlag = (valor: 'true' | 'false') =>
        request(app).get(
          `/clientes?q=${encodeURIComponent(marcaLista)}&matrizConfigurada=${valor}`,
        );

      const antes = await request(app).get(`/clientes/${cliente.id}`);
      expect(antes.status, JSON.stringify(antes.body)).toBe(200);
      expect(antes.body).toMatchObject({ id: cliente.id, matrizConfigurada: false });
      expect(antes.body).not.toHaveProperty('isDeleted');
      expect(antes.body).not.toHaveProperty('indicacionesArmado');

      const sinMatriz = await listarFlag('false');
      const conMatriz = await listarFlag('true');
      expect(sinMatriz.status, JSON.stringify(sinMatriz.body)).toBe(200);
      expect(conMatriz.status, JSON.stringify(conMatriz.body)).toBe(200);
      expect(todos(sinMatriz.body, false)).toBe(true);
      expect(todos(conMatriz.body, true)).toBe(true);
      expect(ids(sinMatriz.body)).toContain(cliente.id);
      expect(ids(conMatriz.body)).not.toContain(cliente.id);

      const creado = await crearRequisito(cliente.id, tipo.id);
      const configurado = await request(app).get(`/clientes/${cliente.id}`);
      expect(configurado.status).toBe(200);
      expect(configurado.body).toMatchObject({ id: cliente.id, matrizConfigurada: true });
      expect(ids((await listarFlag('true')).body)).toContain(cliente.id);
      expect(ids((await listarFlag('false')).body)).not.toContain(cliente.id);

      expect((await baja(cliente.id, creado.id)).status).toBe(204);
      const vacio = await request(app).get(`/clientes/${cliente.id}`);
      expect(vacio.status).toBe(200);
      expect(vacio.body).toMatchObject({ id: cliente.id, matrizConfigurada: false });
      expect(ids((await listarFlag('false')).body)).toContain(cliente.id);
      expect(ids((await listarFlag('true')).body)).not.toContain(cliente.id);
    });
  });

  describe('bajas simultáneas', () => {
    it('deja el flag igual a los requisitos que realmente siguen activos', async () => {
      const cliente = await crearCliente();
      const tipoA = await crearTipo(n('Baja simultanea A'));
      const tipoB = await crearTipo(n('Baja simultanea B'));
      const requisitoA = await crearRequisito(cliente.id, tipoA.id);
      const requisitoB = await crearRequisito(cliente.id, tipoB.id);

      const [respuestaA, respuestaB] = await Promise.all([
        baja(cliente.id, requisitoA.id),
        baja(cliente.id, requisitoB.id),
      ]);

      const filaA = await prisma.requisitoCliente.findUniqueOrThrow({
        where: { id: requisitoA.id },
      });
      const filaB = await prisma.requisitoCliente.findUniqueOrThrow({
        where: { id: requisitoB.id },
      });
      expect([204, 500]).toContain(respuestaA.status);
      expect([204, 500]).toContain(respuestaB.status);
      for (const [respuesta, fila] of [
        [respuestaA, filaA],
        [respuestaB, filaB],
      ] as const) {
        if (respuesta.status === 204) {
          expect(fila.isDeleted).toBe(true);
          expect(fila.deletedAt).not.toBeNull();
        } else {
          expect(respuesta.body).toEqual({
            error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
          });
          expect(fila.isDeleted).toBe(false);
          expect(fila.deletedAt).toBeNull();
        }
      }
      const activos = await activosDe(cliente.id);
      expect(await flagDe(cliente.id)).toBe(activos > 0);
      expect(activos).toBe([filaA, filaB].filter((fila) => !fila.isDeleted).length);
    });
  });

  describe('alta y baja simultáneas', () => {
    it('confirma un resultado serializable y un flag coherente con el conteo', async () => {
      const cliente = await crearCliente();
      const tipoA = await crearTipo(n('Carrera A'));
      const tipoB = await crearTipo(n('Carrera B'));
      const requisitoA = await crearRequisito(cliente.id, tipoA.id);

      const [bajaRes, altaRes] = await Promise.all([
        baja(cliente.id, requisitoA.id),
        alta(cliente.id, { tipoDocumentoId: tipoB.id }),
      ]);

      const filaA = await prisma.requisitoCliente.findUniqueOrThrow({
        where: { id: requisitoA.id },
      });
      const activos = await prisma.requisitoCliente.findMany({
        where: { clienteId: cliente.id, isDeleted: false },
        select: { id: true, tipoDocumentoId: true },
      });
      const creadoB = activos.find((fila) => fila.tipoDocumentoId === tipoB.id);

      expect([204, 500]).toContain(bajaRes.status);
      expect([201, 500]).toContain(altaRes.status);
      if (bajaRes.status === 204) {
        expect(filaA.isDeleted).toBe(true);
      } else {
        expect(bajaRes.body).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
        });
        expect(filaA.isDeleted).toBe(false);
      }
      if (altaRes.status === 201) {
        expect(creadoB).toBeDefined();
      } else {
        expect(altaRes.body).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
        });
        expect(creadoB).toBeUndefined();
      }
      expect(new Set(activos.map((fila) => fila.tipoDocumentoId)).size).toBe(activos.length);
      expect(await flagDe(cliente.id)).toBe(activos.length > 0);
      expect(await prisma.requisitoCliente.count({ where: { id: requisitoA.id } })).toBe(1);
    });
  });

  describe('cliente inactivo', () => {
    it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
      'un cliente %s se consulta y rechaza las escrituras sin tocar la fila',
      async (estado) => {
        const cliente = await crearCliente();
        const tipo = await crearTipo(n(`Inactivo ${estado}`));
        const otro = await crearTipo(n(`Inactivo extra ${estado}`));
        const creado = await crearRequisito(cliente.id, tipo.id, { nota: 'intacto' });
        await prisma.cliente.update({ where: { id: cliente.id }, data: { estado } });
        const antes = await versionDeRequisito(creado.id);

        const consulta = await listar(cliente.id);
        expect(consulta.status).toBe(200);
        expect((consulta.body as RequisitoJson[]).map((item) => item.id)).toEqual([creado.id]);

        const altaRechazada = await alta(cliente.id, { tipoDocumentoId: otro.id });
        const edicionRechazada = await editar(cliente.id, creado.id, { nota: 'cambio' });
        const bajaRechazada = await baja(cliente.id, creado.id);

        for (const respuesta of [altaRechazada, edicionRechazada, bajaRechazada]) {
          expect(respuesta.status).toBe(409);
          expect(respuesta.body).toEqual({
            error: {
              code: 'CONFLICT',
              message: 'El cliente no está activo',
              details: { estado, motivo: 'CLIENTE_NO_ACTIVO' },
            },
          });
        }
        expect(await versionDeRequisito(creado.id)).toEqual(antes);
        expect(await activosDe(cliente.id)).toBe(1);
        expect(await flagDe(cliente.id)).toBe(true);
      },
    );
  });

  describe('tipo desactivado', () => {
    it('no se asigna, y un requisito ya creado se sigue editando', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Tipo apagado'));
      const creado = await crearRequisito(cliente.id, tipo.id, { nota: 'previa' });
      await desactivarTipo(tipo.id);
      const antes = await versionDeRequisito(creado.id);

      const rechazado = await alta(cliente.id, { tipoDocumentoId: tipo.id, nota: 'nuevo' });
      expect(rechazado.status).toBe(400);
      expect(rechazado.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [{ campo: 'tipoDocumentoId', mensaje: 'El tipo de documento está inactivo.' }],
        },
      });
      expect(await versionDeRequisito(creado.id)).toEqual(antes);
      expect(await prisma.requisitoCliente.count({ where: { clienteId: cliente.id } })).toBe(1);

      const editado = await editar(cliente.id, creado.id, { nota: 'despues' });
      expect(editado.status).toBe(200);
      const cuerpo = editado.body as RequisitoJson;
      expect(cuerpo).toMatchObject({
        id: creado.id,
        nota: 'despues',
        tipoDocumento: { id: tipo.id, activo: false },
      });
      const fila = await prisma.requisitoCliente.findUniqueOrThrow({ where: { id: creado.id } });
      expect(fila.nota).toBe('despues');
      expect(fila.tipoDocumentoId).toBe(tipo.id);
    });
  });

  describe('referencias históricas', () => {
    it('editar y dar de baja el requisito no cambia el ítem ni lo borra', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Snapshot'));
      const creado = await crearRequisito(cliente.id, tipo.id, {
        cantidad: 1,
        diasAproximados: [5],
        nota: 'matriz',
      });
      const rendicion = await prisma.rendicion.create({
        data: {
          clienteId: cliente.id,
          anio: 2026,
          mes: 10,
          numeroFactura: `${MARCA}-${randomBytes(2).toString('hex')}`,
        },
      });
      const item = await prisma.itemChecklist.create({
        data: {
          rendicionId: rendicion.id,
          requisitoClienteId: creado.id,
          tipoDocumentoId: tipo.id,
          nombreTipoDocumento: tipo.nombre,
          ordinal: 1,
          totalOrdinal: 1,
          diaAproximado: 5,
          canalEntrega: 'CORREO',
        },
      });

      const editado = await editar(cliente.id, creado.id, {
        diasAproximados: [],
        nota: 'matriz nueva',
        canalEntrega: 'PORTAL_WEB',
      });
      expect(editado.status).toBe(200);
      expect(await prisma.itemChecklist.findUnique({ where: { id: item.id } })).toEqual(item);

      const primeraBaja = await baja(cliente.id, creado.id);
      expect(primeraBaja.status).toBe(204);
      expect(await prisma.itemChecklist.findUnique({ where: { id: item.id } })).toEqual(item);
      const requisito = await prisma.requisitoCliente.findUniqueOrThrow({
        where: { id: creado.id },
      });
      expect(requisito.isDeleted).toBe(true);
      expect(requisito.deletedAt).not.toBeNull();
      expect(await prisma.itemChecklist.count({ where: { requisitoClienteId: creado.id } })).toBe(
        1,
      );
    });
  });

  describe('errores de Prisma sobre la base real', () => {
    it('informa P2002 del índice parcial con un target reconocible', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Indice'));
      await crearRequisito(cliente.id, tipo.id);

      let error: unknown;
      try {
        await prisma.requisitoCliente.create({
          data: { clienteId: cliente.id, tipoDocumentoId: tipo.id, cantidad: 4 },
        });
      } catch (capturado) {
        error = capturado;
      }

      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const conocido = error as Prisma.PrismaClientKnownRequestError;
      expect(conocido.code).toBe('P2002');
      expect(reconoceIndiceParcial(conocido.meta?.target), JSON.stringify(conocido.meta)).toBe(
        true,
      );
      expect(await activosDe(cliente.id)).toBe(1);
    });

    it('informa P2025 al actualizar un requisito que no existe', async () => {
      let error: unknown;
      try {
        await prisma.requisitoCliente.update({
          where: { id: randomUUID() },
          data: { nota: 'ausente' },
        });
      } catch (capturado) {
        error = capturado;
      }

      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
    });

    it('informa P2003 con el nombre de la FK del tipo y de la del cliente', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('FK'));

      let errorTipo: unknown;
      try {
        await prisma.requisitoCliente.create({
          data: {
            clienteId: cliente.id,
            tipoDocumentoId: '00000000-0000-4000-8000-000000000099',
          },
        });
      } catch (capturado) {
        errorTipo = capturado;
      }
      expect(errorTipo).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const tipoConocido = errorTipo as Prisma.PrismaClientKnownRequestError;
      expect(tipoConocido.code).toBe('P2003');
      expect(tipoConocido.meta?.field_name, JSON.stringify(tipoConocido.meta)).toEqual(
        expect.stringContaining('tipoDocumentoId'),
      );

      let errorCliente: unknown;
      try {
        await prisma.requisitoCliente.create({
          data: { clienteId: randomUUID(), tipoDocumentoId: tipo.id },
        });
      } catch (capturado) {
        errorCliente = capturado;
      }
      expect(errorCliente).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const clienteConocido = errorCliente as Prisma.PrismaClientKnownRequestError;
      expect(clienteConocido.code).toBe('P2003');
      const campo = clienteConocido.meta?.field_name;
      expect(campo, JSON.stringify(clienteConocido.meta)).toEqual(
        expect.stringContaining('clienteId'),
      );
      expect(typeof campo === 'string' && campo.includes('tipoDocumentoId')).toBe(false);
      expect(await prisma.requisitoCliente.count({ where: { clienteId: cliente.id } })).toBe(0);
    });

    it('un choque serializable sobre la misma fila es P2034', async () => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n('Serializable'));
      const creado = await crearRequisito(cliente.id, tipo.id);

      let avisarLectura1: () => void = () => undefined;
      let avisarLectura2: () => void = () => undefined;
      const lectura1 = new Promise<void>((resolver) => {
        avisarLectura1 = resolver;
      });
      const lectura2 = new Promise<void>((resolver) => {
        avisarLectura2 = resolver;
      });
      const opciones = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

      const resultados = await Promise.allSettled([
        prisma.$transaction(async (tx) => {
          await tx.requisitoCliente.findUnique({ where: { id: creado.id } });
          avisarLectura1();
          await lectura2;
          await tx.requisitoCliente.update({
            where: { id: creado.id },
            data: { nota: 'escritura 1' },
          });
        }, opciones),
        prisma.$transaction(async (tx) => {
          await lectura1;
          await tx.requisitoCliente.findUnique({ where: { id: creado.id } });
          avisarLectura2();
          await tx.requisitoCliente.update({
            where: { id: creado.id },
            data: { nota: 'escritura 2' },
          });
        }, opciones),
      ]);

      const rechazos = resultados.filter((resultado) => resultado.status === 'rejected');
      expect(resultados.some((resultado) => resultado.status === 'fulfilled')).toBe(true);
      expect(rechazos, JSON.stringify(resultados.map((r) => r.status))).toHaveLength(1);
      const rechazo = rechazos[0];
      if (rechazo === undefined) throw new Error('Faltó el rechazo serializable');
      expect(rechazo.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      if (!(rechazo.reason instanceof Prisma.PrismaClientKnownRequestError)) {
        throw new Error('El rechazo no es un error conocido de Prisma');
      }
      expect(rechazo.reason.code).toBe('P2034');
      expect(
        await prisma.requisitoCliente.count({ where: { id: creado.id, isDeleted: false } }),
      ).toBe(1);
    });

    it.each<[string, VarianteInvalida]>([
      ['ck_requisito_dias_coherentes', { cantidad: 2, diasAproximados: [1] }],
      ['ck_requisito_dias_rango', { cantidad: 1, diasAproximados: [0] }],
      ['ck_requisito_cantidad_positiva', { cantidad: 0, diasAproximados: [] }],
      ['ck_requisito_baja_logica', { isDeleted: true, deletedAt: null }],
    ])('el CHECK %s llega con su nombre en el error de Prisma', async (constraint, extra) => {
      const cliente = await crearCliente();
      const tipo = await crearTipo(n(constraint));
      await esperarCheck(
        cliente.id,
        { clienteId: cliente.id, tipoDocumentoId: tipo.id, ...extra },
        constraint,
      );
    });
  });
});
