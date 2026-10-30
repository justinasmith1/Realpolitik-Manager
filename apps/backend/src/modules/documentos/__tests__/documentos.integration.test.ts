// Tests de integración de documentos (HU2.8) contra PostgreSQL REAL, con el almacenamiento en
// memoria.
//
// Prueban lo que un mock no puede: que los candidatos salen del snapshot de los ítems (y no de la
// matriz actual), que se excluyen las rendiciones anuladas, otros períodos, otros tipos y los ítems
// ya completados, que un cliente inactivo con rendiciones activas aparece marcado, y que si
// PostgreSQL rechaza el registro el objeto guardado se borra.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run documentos.integration
//
// No usa el seed. Cada dato lleva una marca única y la limpieza final borra solo eso.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  CandidatoAplicacionSchema,
  DocumentoConAplicacionesSchema,
  DocumentoResumenSchema,
  mesActual,
  normalizarNombreTipoDocumento as normalizar,
  ResultadoCargaDocumentoSchema,
  type CandidatoAplicacion,
} from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ModuloAlmacenamiento from '../../../lib/almacenamiento/almacenamiento';
import type { AlmacenamientoEnMemoria as Memoria } from '../../../lib/almacenamiento/memoria';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

import { PDF } from './archivosDePrueba';

/** Una clave a forzar en la próxima carga (para provocar un rechazo real de PostgreSQL). */
const forzar = vi.hoisted(() => ({ clave: undefined as string | undefined }));

vi.mock('../../../lib/almacenamiento/almacenamiento', async (importOriginal) => {
  const original = await importOriginal<typeof ModuloAlmacenamiento>();
  return {
    ...original,
    generarClaveDocumento: () => {
      const clave = forzar.clave;
      forzar.clave = undefined;
      return clave === undefined
        ? original.generarClaveDocumento()
        : (clave as ReturnType<typeof original.generarClaveDocumento>);
    },
  };
});

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
let almacenamiento: Memoria;
let crearApp: (almacenamiento: Memoria) => Express;
const clientesCreados: string[] = [];

const MARCA = `TESTDOC${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** El período de los documentos y de las rendiciones "del mes" (el máximo admitido es el siguiente). */
const PERIODO = mesActual();
const MES_ANTERIOR =
  PERIODO.mes === 1 ? { anio: PERIODO.anio - 1, mes: 12 } : { ...PERIODO, mes: PERIODO.mes - 1 };

/** CUIT único. La base no valida el dígito verificador. El prefijo 36 no lo usa otra suite. */
const cuitDePrueba = () => `36-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
const facturaDePrueba = () => `B 00036-${String(randomInt(1e8)).padStart(8, '0')}`;

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes, y pisa la de desarrollo.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  const { AlmacenamientoEnMemoria } = await import('../../../lib/almacenamiento/memoria');
  crearApp = (conAlmacenamiento) =>
    createApp({
      corsOrigins: ['http://localhost:5173'],
      documentos: { almacenamiento: conAlmacenamiento },
    });
  almacenamiento = new AlmacenamientoEnMemoria();
  app = crearApp(almacenamiento);
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    const deLaMarca = { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } };
    // Primero el historial (las FK son RESTRICT), después las rendiciones (sus ítems caen en
    // cascada), requisitos, clientes y tipos.
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

async function crearCliente(denominacion: string) {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} ${denominacion}`,
      denominacion: `${MARCA} ${denominacion}`,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
    },
  });
  clientesCreados.push(cliente.id);
  return cliente;
}

/** Abre una rendición por la API: el checklist lo genera el backend (el snapshot real). */
async function abrir(clienteId: string, periodo = PERIODO) {
  const res = await request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura: facturaDePrueba() });
  expect(res.status).toBe(201);
  return res.body as {
    id: string;
    numeroFactura: string;
    items: { id: string; tipoDocumentoId: string; ordinal: number }[];
  };
}

function cargar(tipoDocumentoId: string, nombre = 'constancia.pdf', contenido: Buffer = PDF) {
  return request(app)
    .post('/documentos')
    .field({ tipoDocumentoId, anio: String(PERIODO.anio), mes: String(PERIODO.mes) })
    .attach('archivo', contenido, { filename: nombre, contentType: 'application/pdf' });
}

async function cargarOk(tipoDocumentoId: string, nombre?: string, contenido?: Buffer) {
  const res = await cargar(tipoDocumentoId, nombre, contenido);
  expect(res.status).toBe(201);
  return ResultadoCargaDocumentoSchema.parse(res.body).documento;
}

async function candidatos(documentoId: string): Promise<CandidatoAplicacion[]> {
  const res = await request(app).get(`/documentos/${documentoId}/candidatos`);
  expect(res.status).toBe(200);
  return CandidatoAplicacionSchema.array().parse(res.body);
}

/** Aplica un documento a un ítem directo en la base (aplicar por la API es del bloque siguiente). */
async function aplicar(
  documentoId: string,
  itemChecklistId: string,
  tipoDocumentoId: string,
  datos: { aplicadaEn: Date; reemplazadaEn?: Date; reemplazaAId?: string },
) {
  const aplicacion = await prisma.aplicacionDocumento.create({
    data: { documentoId, itemChecklistId, tipoDocumentoId, ...datos },
  });
  await prisma.itemChecklist.update({
    where: { id: itemChecklistId },
    data: { completado: true, completadoAt: datos.aplicadaEn },
  });
  return aplicacion;
}

// ─── Escenario ────────────────────────────────────────────────────────────────
//
// Cliente A (activo): Print x2 y Factura x1. Rendiciones del período: rA1, rA2 y rA3 (anulada);
// rA4 es del mes anterior. Cliente B: Print x1, con rB1 del período, y después pasa a INACTIVO. Después de abrirlas, a A se le da de baja el requisito Print, el tipo Print se
// desactiva y se suma a la matriz un requisito "Extra": nada de eso cambia los ítems ya abiertos.

const escenario = {} as {
  print: { id: string };
  factura: { id: string };
  extra: { id: string };
  viejo: { id: string };
  clienteA: { id: string };
  clienteB: { id: string };
  rA1: Awaited<ReturnType<typeof abrir>>;
  rA2: Awaited<ReturnType<typeof abrir>>;
  rA3: Awaited<ReturnType<typeof abrir>>;
  rA4: Awaited<ReturnType<typeof abrir>>;
  rB1: Awaited<ReturnType<typeof abrir>>;
};

const itemsDe = (
  rendicion: { items: { id: string; tipoDocumentoId: string; ordinal: number }[] },
  tipoId: string,
) =>
  rendicion.items
    .filter((item) => item.tipoDocumentoId === tipoId)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item) => item.id);

describe.skipIf(url === undefined)('documentos contra PostgreSQL', () => {
  beforeAll(async () => {
    const print = await crearTipo('Print');
    const factura = await crearTipo('Factura');
    const extra = await crearTipo('Extra');
    const viejo = await crearTipo('Viejo');
    await prisma.tipoDocumento.update({ where: { id: viejo.id }, data: { activo: false } });

    const clienteA = await crearCliente('A');
    const clienteB = await crearCliente('B');
    const requisitoPrintA = await prisma.requisitoCliente.create({
      data: { clienteId: clienteA.id, tipoDocumentoId: print.id, cantidad: 2 },
    });
    await prisma.requisitoCliente.create({
      data: { clienteId: clienteA.id, tipoDocumentoId: factura.id, cantidad: 1 },
    });
    await prisma.requisitoCliente.create({
      data: { clienteId: clienteB.id, tipoDocumentoId: print.id, cantidad: 1 },
    });

    const rA1 = await abrir(clienteA.id);
    const rA2 = await abrir(clienteA.id);
    const rA3 = await abrir(clienteA.id);
    const rA4 = await abrir(clienteA.id, MES_ANTERIOR);
    const rB1 = await abrir(clienteB.id);
    expect(
      (await request(app).patch(`/rendiciones/${rA3.id}/estado`).send({ estado: 'ANULADA' }))
        .status,
    ).toBe(200);

    // Cambios DESPUÉS de abrir: no tocan el snapshot.
    await prisma.requisitoCliente.update({
      where: { id: requisitoPrintA.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    await prisma.tipoDocumento.update({ where: { id: print.id }, data: { activo: false } });
    await prisma.requisitoCliente.create({
      data: { clienteId: clienteA.id, tipoDocumentoId: extra.id, cantidad: 1 },
    });
    await prisma.cliente.update({ where: { id: clienteB.id }, data: { estado: 'INACTIVO' } });

    Object.assign(escenario, {
      print,
      factura,
      extra,
      viejo,
      clienteA,
      clienteB,
      rA1,
      rA2,
      rA3,
      rA4,
      rB1,
    });
  });

  describe('carga', () => {
    it('registra el documento y guarda el objeto con su hash', async () => {
      const documento = await cargarOk(escenario.factura.id);

      const fila = await prisma.documento.findUniqueOrThrow({ where: { id: documento.id } });
      expect(fila).toMatchObject({
        anio: PERIODO.anio,
        mes: PERIODO.mes,
        tamanioBytes: PDF.length,
      });
      expect(fila.sha256).toMatch(/^[0-9a-f]{64}$/);
      const res = await request(app)
        .get(`/documentos/${documento.id}/archivo`)
        .buffer(true)
        .parse((respuesta, callback) => {
          const partes: Buffer[] = [];
          respuesta.on('data', (parte: Buffer) => partes.push(parte));
          respuesta.on('end', () => callback(null, Buffer.concat(partes)));
        });
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    });

    it('acepta un tipo desactivado mientras tenga ítems pendientes en el período', async () => {
      expect((await cargar(escenario.print.id)).status).toBe(201);
    });

    it('rechaza un tipo desactivado sin ítems pendientes (409) y uno inexistente (404)', async () => {
      const inactivo = await cargar(escenario.viejo.id);
      expect(inactivo.status).toBe(409);
      expect((inactivo.body as { error: { details: unknown } }).error.details).toEqual({
        motivo: 'TIPO_DOCUMENTO_INACTIVO',
      });
      expect((await cargar('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });

    it('si PostgreSQL rechaza el registro, borra el objeto ya guardado', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const existente = await prisma.documento.findFirstOrThrow({
        where: { tipoDocumentoId: escenario.factura.id },
      });
      // Otra app con su propio almacenamiento (vacío): guardar funciona, y la base rechaza la clave
      // repetida (UNIQUE de claveAlmacenamiento). Es un error real de PostgreSQL.
      const { AlmacenamientoEnMemoria } = await import('../../../lib/almacenamiento/memoria');
      const otro = new AlmacenamientoEnMemoria();
      forzar.clave = existente.claveAlmacenamiento;

      const res = await request(crearApp(otro))
        .post('/documentos')
        .field({
          tipoDocumentoId: escenario.factura.id,
          anio: String(PERIODO.anio),
          mes: String(PERIODO.mes),
        })
        .attach('archivo', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(500);
      expect(otro.cantidad).toBe(0);
      vi.restoreAllMocks();
    });
  });

  describe('candidatos', () => {
    let documentoPrint: { id: string };

    beforeAll(async () => {
      documentoPrint = await cargarOk(
        escenario.print.id,
        'print.pdf',
        Buffer.concat([PDF, randomBytes(8)]),
      );
    });

    it('trae los ítems pendientes del mismo tipo y período, de varias rendiciones y clientes', async () => {
      const lista = await candidatos(documentoPrint.id);

      expect(lista.map((c) => c.item.id)).toEqual([
        // Agrupados por cliente (A antes que B) y rendición; dentro, Print 1/2 y 2/2.
        ...[escenario.rA1, escenario.rA2]
          .sort((a, b) => a.numeroFactura.localeCompare(b.numeroFactura, 'es'))
          .flatMap((rendicion) => itemsDe(rendicion, escenario.print.id)),
        ...itemsDe(escenario.rB1, escenario.print.id),
      ]);
      expect(lista.every((c) => c.elegibilidad === 'ELEGIBLE')).toBe(true);
      expect(lista.every((c) => c.item.tipoDocumentoId === escenario.print.id)).toBe(true);
    });

    it('respeta el snapshot: el requisito dado de baja y el tipo desactivado no los sacan', async () => {
      const deA = (await candidatos(documentoPrint.id)).filter(
        (c) => c.cliente.id === escenario.clienteA.id,
      );
      expect(deA).toHaveLength(4);
      expect(deA[0]?.item).toMatchObject({ ordinal: 1, totalOrdinal: 2 });
    });

    it('excluye la rendición anulada y la de otro período', async () => {
      const rendiciones = new Set((await candidatos(documentoPrint.id)).map((c) => c.rendicion.id));
      expect(rendiciones.has(escenario.rA3.id)).toBe(false);
      expect(rendiciones.has(escenario.rA4.id)).toBe(false);
    });

    it('incluye al cliente inactivo con rendición activa, con su estado', async () => {
      const deB = (await candidatos(documentoPrint.id)).filter(
        (c) => c.cliente.id === escenario.clienteB.id,
      );
      expect(deB).toHaveLength(1);
      expect(deB[0]?.cliente.estado).toBe('INACTIVO');
    });

    it('excluye los ítems de otro tipo', async () => {
      const deFactura = await candidatos(
        (await cargarOk(escenario.factura.id, 'f.pdf', Buffer.concat([PDF, randomBytes(8)]))).id,
      );
      expect(deFactura.map((c) => c.item.id).sort()).toEqual(
        [
          ...itemsDe(escenario.rA1, escenario.factura.id),
          ...itemsDe(escenario.rA2, escenario.factura.id),
        ].sort(),
      );
    });

    it('un requisito sumado a la matriz después de abrir no genera candidatos', async () => {
      const extra = await cargarOk(escenario.extra.id, 'extra.pdf');
      expect(await candidatos(extra.id)).toEqual([]);
    });

    it('excluye un ítem que ya tiene un documento vigente', async () => {
      const [printDeA2] = itemsDe(escenario.rA2, escenario.print.id);
      await aplicar(documentoPrint.id, printDeA2 ?? '', escenario.print.id, {
        aplicadaEn: new Date('2026-10-01T10:00:00.000Z'),
      });
      const ids = (await candidatos(documentoPrint.id)).map((c) => c.item.id);
      expect(ids).toHaveLength(4);
      expect(ids).not.toContain(printDeA2);
    });
  });

  describe('repositorio: dónde está aplicado', () => {
    it('distingue vigentes, reemplazadas y rendiciones anuladas; el listado cuenta solo vigentes en activas', async () => {
      const original = await cargarOk(
        escenario.print.id,
        'original.pdf',
        Buffer.concat([PDF, randomBytes(8)]),
      );
      const reemplazo = await cargarOk(
        escenario.print.id,
        'reemplazo.pdf',
        Buffer.concat([PDF, randomBytes(8)]),
      );
      const [, printDosDeA1] = itemsDe(escenario.rA1, escenario.print.id);
      const [printUnoDeA1] = itemsDe(escenario.rA1, escenario.print.id);
      const [printDeA3] = itemsDe(escenario.rA3, escenario.print.id);

      // rA1 Print 2/2: vigente. rA3 (anulada): vigente. rA1 Print 1/2: reemplazada por `reemplazo`.
      await aplicar(original.id, printDosDeA1 ?? '', escenario.print.id, {
        aplicadaEn: new Date('2026-10-02T10:00:00.000Z'),
      });
      await aplicar(original.id, printDeA3 ?? '', escenario.print.id, {
        aplicadaEn: new Date('2026-10-03T10:00:00.000Z'),
      });
      const anterior = await aplicar(original.id, printUnoDeA1 ?? '', escenario.print.id, {
        aplicadaEn: new Date('2026-10-01T10:00:00.000Z'),
        reemplazadaEn: new Date('2026-10-04T10:00:00.000Z'),
      });
      await aplicar(reemplazo.id, printUnoDeA1 ?? '', escenario.print.id, {
        aplicadaEn: new Date('2026-10-04T10:00:00.000Z'),
        reemplazaAId: anterior.id,
      });

      const detalle = DocumentoConAplicacionesSchema.parse(
        (await request(app).get(`/documentos/${original.id}`)).body,
      );
      expect(
        detalle.aplicaciones.map((a) => [
          a.estado,
          a.ubicacion.rendicion.estado,
          a.itemChecklistId,
        ]),
      ).toEqual([
        ['VIGENTE', 'ANULADA', printDeA3],
        ['VIGENTE', 'ACTIVA', printDosDeA1],
        ['REEMPLAZADA', 'ACTIVA', printUnoDeA1],
      ]);
      expect(detalle.aplicaciones[0]?.ubicacion.cliente.id).toBe(escenario.clienteA.id);

      const res = await request(app).get(
        `/documentos?anio=${PERIODO.anio}&mes=${PERIODO.mes}&tipoDocumentoId=${escenario.print.id}`,
      );
      expect(res.status).toBe(200);
      const porId = new Map(
        DocumentoResumenSchema.array()
          .parse(res.body)
          .map((d) => [d.id, d]),
      );
      expect(porId.get(original.id)?.aplicacionesVigentes).toBe(1);
      expect(porId.get(reemplazo.id)?.aplicacionesVigentes).toBe(1);
      expect([...porId.values()].every((d) => d.tipoDocumento.id === escenario.print.id)).toBe(
        true,
      );
    });
  });
});
