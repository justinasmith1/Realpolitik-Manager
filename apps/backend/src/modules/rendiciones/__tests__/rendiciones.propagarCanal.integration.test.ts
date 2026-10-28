// Integración de `POST /clientes/:id/requisitos/:requisitoId/propagar-canal` (contrato 4.5)
// contra PostgreSQL REAL: que pase al canal nuevo todos los ítems de ese requisito en las
// rendiciones elegidas, sin tocar nada más, y que sea todo o nada.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run rendiciones.propagarCanal.integration
//
// En Windows, usá `127.0.0.1` y no `localhost` (ver rendiciones.requisitos.integration).

import { randomBytes, randomInt } from 'node:crypto';

import type { CanalEntrega, PrismaClient } from '@prisma/client';
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

const MARCA = `TESTRP${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
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

/** CUIT único. El prefijo 32 no lo usa otra suite. */
const cuitDePrueba = () => `32-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

async function tipo(nombre: string) {
  const completo = `${MARCA} ${nombre}`;
  return prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(completo) },
    update: {},
    create: { nombre: completo, nombreNormalizado: normalizar(completo) },
  });
}

/** Cliente por correo con Print x3 por WhatsApp (el canal que se va a corregir) y Factura x1. */
async function clienteConPrint() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'rendiciones@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
    },
  });
  clientesCreados.push(cliente.id);
  const print = await prisma.requisitoCliente.create({
    data: {
      clienteId: cliente.id,
      tipoDocumentoId: (await tipo('Print')).id,
      cantidad: 3,
      diasAproximados: [1, 10, 20],
      canalEntrega: 'WHATSAPP',
    },
  });
  await prisma.requisitoCliente.create({
    data: { clienteId: cliente.id, tipoDocumentoId: (await tipo('Factura')).id },
  });
  return { cliente, print };
}

let siguienteFactura = 300;

async function abrir(clienteId: string) {
  siguienteFactura += 1;
  const res = await request(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({
      anio: 2026,
      mes: 1,
      numeroFactura: `A 00001-${String(siguienteFactura).padStart(8, '0')}`,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

const cambiarCanalDelRequisito = (requisitoId: string, canalEntrega: CanalEntrega | null) =>
  prisma.requisitoCliente.update({ where: { id: requisitoId }, data: { canalEntrega } });

const propagar = (clienteId: string, requisitoId: string, rendicionIds: string[]) =>
  request(app)
    .post(`/clientes/${clienteId}/requisitos/${requisitoId}/propagar-canal`)
    .send({ rendicionIds });

/** Los ítems de una rendición tal como están en la base, en un orden estable. */
const itemsEnBase = (rendicionId: string) =>
  prisma.itemChecklist.findMany({
    where: { rendicionId },
    orderBy: [{ nombreTipoDocumento: 'asc' }, { ordinal: 'asc' }],
  });

const canales = async (rendicionId: string) =>
  (await itemsEnBase(rendicionId)).map((item) => item.canalEntrega);

const motivo = (res: request.Response) =>
  (res.body as { error?: { details?: { motivo?: string; rendicionId?: string } } }).error?.details;

describe.skipIf(url === undefined)(
  'propagar el canal de un requisito, contra PostgreSQL real',
  () => {
    it('pasa todos los ítems del requisito al canal nuevo solo en las elegidas', async () => {
      const { cliente, print } = await clienteConPrint();
      const una = await abrir(cliente.id);
      const otra = await abrir(cliente.id);
      const noElegida = await abrir(cliente.id);
      const antes = await itemsEnBase(una.id);
      await cambiarCanalDelRequisito(print.id, 'PORTAL_WEB');

      const res = await propagar(cliente.id, print.id, [una.id, otra.id]);

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        canalEntrega: 'PORTAL_WEB',
        rendiciones: [
          { rendicionId: una.id, itemsActualizados: 3 },
          { rendicionId: otra.id, itemsActualizados: 3 },
        ],
      });
      // Orden: Factura y después Print 1..3. La Factura (otro requisito) sigue por correo.
      for (const rendicion of [una, otra]) {
        expect(await canales(rendicion.id)).toEqual([
          'CORREO',
          'PORTAL_WEB',
          'PORTAL_WEB',
          'PORTAL_WEB',
        ]);
      }
      expect(await canales(noElegida.id)).toEqual(['CORREO', 'WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
      // El resto del snapshot no cambia.
      const despues = await itemsEnBase(una.id);
      const sinCanal = (items: typeof antes) =>
        items.map(
          ({ id, nombreTipoDocumento, ordinal, totalOrdinal, diaAproximado, completado }) => ({
            id,
            nombreTipoDocumento,
            ordinal,
            totalOrdinal,
            diaAproximado,
            completado,
          }),
        );
      expect(sinCanal(despues)).toEqual(sinCanal(antes));
      const factura = despues.find((item) => item.requisitoClienteId !== print.id);
      expect(factura?.updatedAt).toEqual(antes.find((item) => item.id === factura?.id)?.updatedAt);
    });

    it('si el requisito vuelve a heredar, usa el canal del cliente', async () => {
      const { cliente, print } = await clienteConPrint();
      const rendicion = await abrir(cliente.id);
      await cambiarCanalDelRequisito(print.id, null);

      const res = await propagar(cliente.id, print.id, [rendicion.id]);

      expect(res.status).toBe(200);
      expect((res.body as { canalEntrega: string }).canalEntrega).toBe('CORREO');
      expect(await canales(rendicion.id)).toEqual(['CORREO', 'CORREO', 'CORREO', 'CORREO']);
    });

    it('cuenta solo los ítems que cambiaron: uno corregido a mano no se reescribe', async () => {
      const { cliente, print } = await clienteConPrint();
      const rendicion = await abrir(cliente.id);
      const [, primerPrint] = await itemsEnBase(rendicion.id);
      if (primerPrint === undefined) throw new Error('falta el ítem');
      const corregido = await prisma.itemChecklist.update({
        where: { id: primerPrint.id },
        data: { canalEntrega: 'PORTAL_WEB' },
      });
      await cambiarCanalDelRequisito(print.id, 'PORTAL_WEB');

      const res = await propagar(cliente.id, print.id, [rendicion.id]);

      expect(res.body).toMatchObject({ rendiciones: [{ itemsActualizados: 2 }] });
      const enBase = await prisma.itemChecklist.findUniqueOrThrow({
        where: { id: primerPrint.id },
      });
      expect(enBase.updatedAt).toEqual(corregido.updatedAt);
    });

    it('una anulada es 409 RENDICION_ANULADA y no cambia ninguna (todo o nada)', async () => {
      const { cliente, print } = await clienteConPrint();
      const activa = await abrir(cliente.id);
      const anulada = await abrir(cliente.id);
      await request(app).patch(`/rendiciones/${anulada.id}/estado`).send({ estado: 'ANULADA' });
      await cambiarCanalDelRequisito(print.id, 'PORTAL_WEB');

      const res = await propagar(cliente.id, print.id, [activa.id, anulada.id]);

      expect(res.status).toBe(409);
      expect(motivo(res)).toEqual({ motivo: 'RENDICION_ANULADA', rendicionId: anulada.id });
      expect(await canales(activa.id)).toEqual(['CORREO', 'WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
      expect(await canales(anulada.id)).toEqual(['CORREO', 'WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
    });

    it('una rendición de otro cliente es 404 y no cambia ninguna', async () => {
      const { cliente, print } = await clienteConPrint();
      const propia = await abrir(cliente.id);
      const { cliente: otroCliente } = await clienteConPrint();
      const ajena = await abrir(otroCliente.id);
      await cambiarCanalDelRequisito(print.id, 'PORTAL_WEB');

      const res = await propagar(cliente.id, print.id, [propia.id, ajena.id]);

      expect(res.status).toBe(404);
      expect(await canales(propia.id)).toEqual(['CORREO', 'WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
      expect(await canales(ajena.id)).toEqual(['CORREO', 'WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
    });

    it('una rendición sin ítems de ese requisito es 409 REQUISITO_NO_EN_RENDICION y no cambia ninguna', async () => {
      const { cliente } = await clienteConPrint();
      const conNota = await abrir(cliente.id);
      // Un requisito nuevo: la rendición `sinNota` se abrió antes y no lo tiene.
      const sinNota = await abrir(cliente.id);
      const nota = await prisma.requisitoCliente.create({
        data: { clienteId: cliente.id, tipoDocumentoId: (await tipo('Nota')).id },
      });
      const agregado = await request(app).post(`/rendiciones/${conNota.id}/requisitos/${nota.id}`);
      expect(agregado.status).toBe(200);
      await cambiarCanalDelRequisito(nota.id, 'WHATSAPP');

      const res = await propagar(cliente.id, nota.id, [conNota.id, sinNota.id]);

      expect(res.status).toBe(409);
      expect(motivo(res)).toEqual({ motivo: 'REQUISITO_NO_EN_RENDICION', rendicionId: sinNota.id });
      const deNota = await prisma.itemChecklist.findMany({
        where: { rendicionId: conNota.id, requisitoClienteId: nota.id },
      });
      expect(deNota.map((item) => item.canalEntrega)).toEqual(['CORREO']);
    });

    it('el listado con requisitoId muestra solo las activas que tienen ítems de ese requisito', async () => {
      const { cliente } = await clienteConPrint();
      const conNota = await abrir(cliente.id);
      await abrir(cliente.id); // Activa, pero sin la Nota.
      const anulada = await abrir(cliente.id);
      const nota = await prisma.requisitoCliente.create({
        data: { clienteId: cliente.id, tipoDocumentoId: (await tipo('Nota')).id },
      });
      for (const rendicion of [conNota, anulada]) {
        await request(app).post(`/rendiciones/${rendicion.id}/requisitos/${nota.id}`);
      }
      await request(app).patch(`/rendiciones/${anulada.id}/estado`).send({ estado: 'ANULADA' });

      const res = await request(app).get(
        `/clientes/${cliente.id}/rendiciones?estado=ACTIVA&requisitoId=${nota.id}`,
      );

      expect(res.status).toBe(200);
      expect((res.body as { id: string }[]).map((r) => r.id)).toEqual([conNota.id]);
    });
  },
);
