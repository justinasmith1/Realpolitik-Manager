// Tests de integración de aplicar y reemplazar documentos (HU2.8, bloque 3B) contra PostgreSQL
// REAL, con el almacenamiento en memoria.
//
// Prueban lo que un mock no puede: todo o nada en la base, la carrera entre dos aplicaciones o
// dos reemplazos del mismo ítem (índice único parcial + transacción serializable), la carrera con
// la anulación de la rendición (FOR SHARE) y que, al final, `completado` coincide con tener una
// aplicación vigente en cada ítem.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run aplicaciones.integration
//
// No usa el seed. Cada dato lleva una marca única y la limpieza final borra solo eso.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  DocumentoConAplicacionesSchema,
  HistorialDeItemSchema,
  mesActual,
  normalizarNombreTipoDocumento as normalizar,
  RendicionDetalleSchema,
  ResultadoCargaDocumentoSchema,
} from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

import { PDF } from './archivosDePrueba';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTAPL${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

const PERIODO = mesActual();
const MES_ANTERIOR =
  PERIODO.mes === 1 ? { anio: PERIODO.anio - 1, mes: 12 } : { ...PERIODO, mes: PERIODO.mes - 1 };

/** CUIT único. La base no valida el dígito verificador. El prefijo 29 no lo usa otra suite. */
const cuitDePrueba = () => `29-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
const facturaDePrueba = () => `B 00029-${String(randomInt(1e8)).padStart(8, '0')}`;

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
    // El historial primero (FK RESTRICT; la cadena de reemplazos también es RESTRICT, pero un
    // solo DELETE borra todas las filas juntas), después documentos, rendiciones (sus ítems caen
    // en cascada), requisitos, clientes y tipos.
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

interface RendicionAbierta {
  id: string;
  items: { id: string; tipoDocumentoId: string; ordinal: number }[];
}

async function abrir(clienteId: string, periodo = PERIODO): Promise<RendicionAbierta> {
  const res = await request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura: facturaDePrueba() });
  expect(res.status).toBe(201);
  return res.body as RendicionAbierta;
}

/** El ítem `ordinal` del tipo dado en la rendición. */
function item(rendicion: RendicionAbierta, tipoId: string, ordinal = 1): string {
  const encontrado = rendicion.items.find(
    (i) => i.tipoDocumentoId === tipoId && i.ordinal === ordinal,
  );
  if (encontrado === undefined) throw new Error('El escenario no tiene ese ítem.');
  return encontrado.id;
}

/** Carga un documento por la API. Contenido distinto cada vez, para que no sea un duplicado. */
async function cargar(tipoDocumentoId: string, periodo = PERIODO): Promise<string> {
  const res = await request(app)
    .post('/documentos')
    .field({ tipoDocumentoId, anio: String(periodo.anio), mes: String(periodo.mes) })
    .attach('archivo', Buffer.concat([PDF, randomBytes(16)]), {
      filename: 'documento.pdf',
      contentType: 'application/pdf',
    });
  expect(res.status).toBe(201);
  return ResultadoCargaDocumentoSchema.parse(res.body).documento.id;
}

const aplicar = (documentoId: string, itemIds: string[]) =>
  request(app).post(`/documentos/${documentoId}/aplicaciones`).send({ itemIds });

const reemplazar = (
  rendicionId: string,
  itemId: string,
  documentoId: string,
  aplicacionVigenteId: string,
) =>
  request(app)
    .post(`/rendiciones/${rendicionId}/items/${itemId}/reemplazo`)
    .send({ documentoId, aplicacionVigenteId });

const conflicto = (res: request.Response) =>
  (res.body as { error: { details: { motivo: string } & Record<string, unknown> } }).error.details;

/** Las aplicaciones de un ítem, de la base. */
const aplicacionesDe = (itemChecklistId: string) =>
  prisma.aplicacionDocumento.findMany({
    where: { itemChecklistId },
    orderBy: [{ aplicadaEn: 'asc' }, { createdAt: 'asc' }],
  });

async function vigenteDe(itemChecklistId: string): Promise<string> {
  const vigentes = (await aplicacionesDe(itemChecklistId)).filter((a) => a.reemplazadaEn === null);
  expect(vigentes).toHaveLength(1);
  return vigentes[0]?.id ?? '';
}

// ─── Escenario ────────────────────────────────────────────────────────────────
//
// Cliente A: Print x2 y Factura x1, con rA1 y rA2 del período, rA3 (anulada) y rA4 del mes
// anterior. Cliente B: Print x1, con rB1 del período, y después pasa a INACTIVO. rA5 queda para la
// carrera con la anulación.

const e = {} as {
  print: string;
  factura: string;
  clienteA: string;
  clienteB: string;
  rA1: RendicionAbierta;
  rA2: RendicionAbierta;
  rA3: RendicionAbierta;
  rA4: RendicionAbierta;
  rA5: RendicionAbierta;
  rB1: RendicionAbierta;
  dPrint: string;
  dPrint2: string;
  dPrint3: string;
  dFactura: string;
  dPrintAnterior: string;
};

describe.skipIf(url === undefined)('aplicar y reemplazar documentos contra PostgreSQL', () => {
  beforeAll(async () => {
    const print = await crearTipo('Print');
    const factura = await crearTipo('Factura');
    const clienteA = await crearCliente('A');
    const clienteB = await crearCliente('B');
    await prisma.requisitoCliente.createMany({
      data: [
        { clienteId: clienteA.id, tipoDocumentoId: print.id, cantidad: 2 },
        { clienteId: clienteA.id, tipoDocumentoId: factura.id, cantidad: 1 },
        { clienteId: clienteB.id, tipoDocumentoId: print.id, cantidad: 1 },
      ],
    });
    await prisma.cliente.updateMany({
      where: { id: { in: [clienteA.id, clienteB.id] } },
      data: { matrizConfigurada: true },
    });

    const rA1 = await abrir(clienteA.id);
    const rA2 = await abrir(clienteA.id);
    const rA3 = await abrir(clienteA.id);
    const rA4 = await abrir(clienteA.id, MES_ANTERIOR);
    const rA5 = await abrir(clienteA.id);
    const rB1 = await abrir(clienteB.id);
    expect(
      (await request(app).patch(`/rendiciones/${rA3.id}/estado`).send({ estado: 'ANULADA' }))
        .status,
    ).toBe(200);
    await prisma.cliente.update({ where: { id: clienteB.id }, data: { estado: 'INACTIVO' } });

    Object.assign(e, {
      print: print.id,
      factura: factura.id,
      clienteA: clienteA.id,
      clienteB: clienteB.id,
      rA1,
      rA2,
      rA3,
      rA4,
      rA5,
      rB1,
      dPrint: await cargar(print.id),
      dPrint2: await cargar(print.id),
      dPrint3: await cargar(print.id),
      dFactura: await cargar(factura.id),
      dPrintAnterior: await cargar(print.id, MES_ANTERIOR),
    });
  });

  describe('aplicar a varios ítems', () => {
    it('aplica a varios clientes y rendiciones, y a dos ítems de la misma rendición', async () => {
      const itemIds = [
        item(e.rA1, e.print, 1),
        item(e.rA1, e.print, 2),
        item(e.rA2, e.print, 1),
        item(e.rB1, e.print, 1), // cliente inactivo, rendición activa
      ];

      const res = await aplicar(e.dPrint, itemIds);

      expect(res.status).toBe(200);
      const documento = DocumentoConAplicacionesSchema.parse(res.body);
      expect(documento.aplicaciones.map((a) => a.itemChecklistId).sort()).toEqual(
        [...itemIds].sort(),
      );
      expect(documento.aplicaciones.every((a) => a.estado === 'VIGENTE')).toBe(true);
      expect(
        documento.aplicaciones.find((a) => a.itemChecklistId === item(e.rB1, e.print))?.ubicacion
          .cliente.estado,
      ).toBe('INACTIVO');

      const items = await prisma.itemChecklist.findMany({ where: { id: { in: itemIds } } });
      expect(items.every((i) => i.completado && i.completadoAt !== null)).toBe(true);
    });

    it('el checklist muestra el documento vigente de cada ítem (y null en los pendientes)', async () => {
      const res = await request(app).get(`/rendiciones/${e.rA1.id}`);
      const detalle = RendicionDetalleSchema.parse(res.body);
      const print1 = detalle.items.find((i) => i.id === item(e.rA1, e.print, 1));
      const factura = detalle.items.find((i) => i.id === item(e.rA1, e.factura));

      expect(print1?.completado).toBe(true);
      expect(print1?.documento).toMatchObject({
        documentoId: e.dPrint,
        aplicacionId: await vigenteDe(print1?.id ?? ''),
        nombreOriginal: 'documento.pdf',
        tipoContenido: 'application/pdf',
      });
      expect(factura?.documento).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/sha256|claveAlmacenamiento|documentos\//);
    });

    it('todo o nada: si un ítem no cumple, no se aplica a ninguno', async () => {
      const pendiente = item(e.rA2, e.print, 2);
      const deFactura = item(e.rA1, e.factura);

      const res = await aplicar(e.dPrint2, [pendiente, deFactura]);

      expect(res.status).toBe(409);
      expect(conflicto(res)).toEqual({ motivo: 'TIPO_DOCUMENTO_DISTINTO', itemId: deFactura });
      expect(await aplicacionesDe(pendiente)).toEqual([]);
      expect(
        (await prisma.itemChecklist.findUniqueOrThrow({ where: { id: pendiente } })).completado,
      ).toBe(false);
    });

    it.each([
      [
        'de otro período',
        (): [string, string] => [e.dPrintAnterior, item(e.rA2, e.print, 2)],
        'PERIODO_DISTINTO',
      ],
      [
        'de una rendición anulada',
        (): [string, string] => [e.dPrint2, item(e.rA3, e.print, 1)],
        'RENDICION_ANULADA',
      ],
      [
        'que ya tiene un documento',
        (): [string, string] => [e.dPrint2, item(e.rA1, e.print, 1)],
        'ITEM_NO_PENDIENTE',
      ],
    ] as const)('rechaza un ítem %s con 409', async (_caso, datos, motivo) => {
      const [documentoId, itemId] = datos();
      const res = await aplicar(documentoId, [itemId]);
      expect(res.status).toBe(409);
      expect(conflicto(res)).toEqual({ motivo, itemId });
    });

    it('un ítem o un documento inexistentes son 404', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      expect((await aplicar(e.dPrint2, [item(e.rA2, e.print, 2), inexistente])).status).toBe(404);
      expect((await aplicar(inexistente, [item(e.rA2, e.print, 2)])).status).toBe(404);
      expect(await aplicacionesDe(item(e.rA2, e.print, 2))).toEqual([]);
    });

    it('dos aplicaciones simultáneas al mismo ítem: una gana y la otra es 409', async () => {
      const disputado = item(e.rA2, e.print, 2);

      const respuestas = await Promise.all([
        aplicar(e.dPrint2, [disputado]),
        aplicar(e.dPrint3, [disputado]),
      ]);

      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(respuestas.filter((r) => r.status === 409).map(conflicto)).toEqual([
        expect.objectContaining({ motivo: 'ITEM_NO_PENDIENTE' }),
      ]);
      expect(await aplicacionesDe(disputado)).toHaveLength(1);
    });

    it('aplicar mientras se anula la rendición: nunca queda a medias', async () => {
      const itemIds = [item(e.rA5, e.print, 1), item(e.rA5, e.print, 2)];

      const [aplicacion, anulacion] = await Promise.all([
        aplicar(e.dPrint, itemIds),
        request(app).patch(`/rendiciones/${e.rA5.id}/estado`).send({ estado: 'ANULADA' }),
      ]);

      expect(anulacion.status).toBe(200);
      expect([200, 409]).toContain(aplicacion.status);
      const creadas = await prisma.aplicacionDocumento.count({
        where: { itemChecklistId: { in: itemIds } },
      });
      // O se aplicó a los dos (antes de la anulación) o a ninguno (409 RENDICION_ANULADA).
      expect(creadas).toBe(aplicacion.status === 200 ? 2 : 0);
      if (aplicacion.status === 409) {
        expect(conflicto(aplicacion).motivo).toBe('RENDICION_ANULADA');
      }
    });
  });

  describe('reemplazar', () => {
    it('reemplaza el documento de UN ítem y conserva el historial', async () => {
      const itemId = item(e.rA1, e.print, 1);
      const anterior = await vigenteDe(itemId);
      const { completadoAt } = await prisma.itemChecklist.findUniqueOrThrow({
        where: { id: itemId },
      });

      const res = await reemplazar(e.rA1.id, itemId, e.dPrint2, anterior);

      expect(res.status).toBe(200);
      const detalle = RendicionDetalleSchema.parse(res.body);
      const actualizado = detalle.items.find((i) => i.id === itemId);
      expect(actualizado?.documento?.documentoId).toBe(e.dPrint2);
      expect(actualizado?.completado).toBe(true);
      // El ítem sigue completado desde la primera vez.
      expect(actualizado?.completadoEn?.getTime()).toBe(completadoAt?.getTime());

      const [vieja, nueva] = await aplicacionesDe(itemId);
      expect(vieja).toMatchObject({ id: anterior, documentoId: e.dPrint });
      expect(vieja?.reemplazadaEn).not.toBeNull();
      expect(nueva).toMatchObject({
        documentoId: e.dPrint2,
        reemplazaAId: anterior,
        reemplazadaEn: null,
      });
    });

    it('las aplicaciones del documento anterior en otros ítems no cambian', async () => {
      const documento = DocumentoConAplicacionesSchema.parse(
        (await request(app).get(`/documentos/${e.dPrint}`)).body,
      );
      const vigentes = documento.aplicaciones.filter((a) => a.estado === 'VIGENTE');
      expect(vigentes.map((a) => a.itemChecklistId)).toEqual(
        expect.arrayContaining([
          item(e.rA1, e.print, 2),
          item(e.rA2, e.print, 1),
          item(e.rB1, e.print),
        ]),
      );
      expect(
        documento.aplicaciones.find((a) => a.itemChecklistId === item(e.rA1, e.print, 1))?.estado,
      ).toBe('REEMPLAZADA');
    });

    it('con información desactualizada es 409 y no escribe nada', async () => {
      const itemId = item(e.rA1, e.print, 1);
      const [vieja] = await aplicacionesDe(itemId);
      const vigente = await vigenteDe(itemId);

      const res = await reemplazar(e.rA1.id, itemId, e.dPrint3, vieja?.id ?? '');

      expect(res.status).toBe(409);
      expect(conflicto(res)).toEqual({
        motivo: 'APLICACION_DESACTUALIZADA',
        aplicacionVigenteId: vigente,
      });
      expect(await aplicacionesDe(itemId)).toHaveLength(2);
    });

    it.each([
      ['el mismo documento vigente', () => e.dPrint2, 'DOCUMENTO_YA_VIGENTE'],
      ['un documento de otro tipo', () => e.dFactura, 'TIPO_DOCUMENTO_DISTINTO'],
      ['un documento de otro período', () => e.dPrintAnterior, 'PERIODO_DISTINTO'],
    ] as const)('rechaza reemplazar con %s (409)', async (_caso, documento, motivo) => {
      const itemId = item(e.rA1, e.print, 1);
      const res = await reemplazar(e.rA1.id, itemId, documento(), await vigenteDe(itemId));
      expect(res.status).toBe(409);
      expect(conflicto(res).motivo).toBe(motivo);
    });

    it('en una rendición anulada es 409 y el historial se conserva', async () => {
      const itemId = item(e.rA3, e.print, 1);
      const enAnulada = await prisma.aplicacionDocumento.create({
        data: { documentoId: e.dPrint, itemChecklistId: itemId, tipoDocumentoId: e.print },
      });
      await prisma.itemChecklist.update({
        where: { id: itemId },
        data: { completado: true, completadoAt: enAnulada.aplicadaEn },
      });

      const res = await reemplazar(e.rA3.id, itemId, e.dPrint2, enAnulada.id);

      expect(res.status).toBe(409);
      expect(conflicto(res).motivo).toBe('RENDICION_ANULADA');
      const historial = HistorialDeItemSchema.parse(
        (await request(app).get(`/rendiciones/${e.rA3.id}/items/${itemId}/aplicaciones`)).body,
      );
      expect(historial.aplicaciones.map((a) => a.id)).toEqual([enAnulada.id]);
    });

    it('un ítem de otra rendición es 404', async () => {
      const itemId = item(e.rA1, e.print, 2);
      const res = await reemplazar(e.rA2.id, itemId, e.dPrint2, await vigenteDe(itemId));
      expect(res.status).toBe(404);
    });

    it('dos reemplazos simultáneos de la misma aplicación: uno gana, el otro es 409', async () => {
      const itemId = item(e.rA1, e.print, 2);
      const vigente = await vigenteDe(itemId);

      const respuestas = await Promise.all([
        reemplazar(e.rA1.id, itemId, e.dPrint2, vigente),
        reemplazar(e.rA1.id, itemId, e.dPrint3, vigente),
      ]);

      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
      const aplicaciones = await aplicacionesDe(itemId);
      expect(aplicaciones).toHaveLength(2);
      expect(aplicaciones.filter((a) => a.reemplazadaEn === null)).toHaveLength(1);
      expect(aplicaciones[1]?.reemplazaAId).toBe(vigente);
    });
  });

  describe('historial', () => {
    it('devuelve todas las aplicaciones del ítem, la vigente primero, con su documento', async () => {
      const itemId = item(e.rA1, e.print, 1);

      const res = await request(app).get(`/rendiciones/${e.rA1.id}/items/${itemId}/aplicaciones`);

      expect(res.status).toBe(200);
      const historial = HistorialDeItemSchema.parse(res.body);
      expect(historial.aplicaciones.map((a) => [a.estado, a.documento.id])).toEqual([
        ['VIGENTE', e.dPrint2],
        ['REEMPLAZADA', e.dPrint],
      ]);
      expect(historial.aplicaciones[0]?.reemplazaAId).toBe(historial.aplicaciones[1]?.id);
      expect(JSON.stringify(res.body)).not.toMatch(/sha256|claveAlmacenamiento|documentos\//);
    });

    it('un ítem sin documentos tiene el historial vacío', async () => {
      const itemId = item(e.rA1, e.factura);
      const res = await request(app).get(`/rendiciones/${e.rA1.id}/items/${itemId}/aplicaciones`);
      expect(HistorialDeItemSchema.parse(res.body).aplicaciones).toEqual([]);
    });
  });

  it('integridad: en cada ítem de la prueba, completado ⇔ tiene una aplicación vigente', async () => {
    const items = await prisma.itemChecklist.findMany({
      where: { rendicion: { clienteId: { in: clientesCreados } } },
      include: { aplicaciones: { where: { reemplazadaEn: null } } },
    });
    expect(items.length).toBeGreaterThan(0);
    const incoherentes = items.filter(
      (i) => i.completado !== i.aplicaciones.length > 0 || i.aplicaciones.length > 1,
    );
    expect(incoherentes).toEqual([]);
  });
});
