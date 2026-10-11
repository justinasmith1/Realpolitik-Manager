// Tests de integración del cambio de estado (HU1.8) y de la edición parcial (HU1.7) contra
// PostgreSQL REAL. Prueban lo que un mock no puede: que repetir el estado no escribe la fila
// (ni `updatedAt` ni `xmin` cambian), cómo se comportan dos pedidos simultáneos y que un PATCH
// parcial no pisa los campos que no trae.
//
// Igual que `clientes.integration.test.ts`: opcionales (sin `TEST_DATABASE_URL` se saltan),
// solo contra una base DESCARTABLE (`*_audit` o `*_test`) con las migraciones aplicadas:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run estado-edicion
//
// Cada test crea sus propios clientes y los borra al final.

import type { PrismaClient } from '@prisma/client';
import { validateCuit } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from './baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let app: Express;
const clientesCreados: string[] = [];

const MARCA = `TESTD${Date.now().toString(36).toUpperCase()}`;

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
});

afterAll(async () => {
  if (url === undefined) return;
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.$disconnect();
});

/** CUIT válido (Módulo 11) y no usado por los demás tests de esta corrida. */
function cuitUnico(): string {
  for (;;) {
    const cuerpo = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador++) {
      const candidato = `34${cuerpo}${verificador}`;
      if (validateCuit(candidato)) {
        return `34-${cuerpo}-${verificador}`;
      }
    }
  }
}

interface ClienteJson {
  id: string;
  razonSocial: string;
  emailContacto: string;
  estado: string;
  actualizadoEn: string;
}

async function crearCliente(): Promise<ClienteJson> {
  const respuesta = await request(app)
    .post('/clientes')
    .send({
      razonSocial: `${MARCA} Cliente de prueba`,
      denominacion: `${MARCA} prueba`,
      cuit: cuitUnico(),
      sector: 'PRIVADO',
      ivaCondicion: 'EXENTO',
      emailContacto: 'original@ejemplo.example',
    });
  expect(respuesta.status).toBe(201);
  const cliente = respuesta.body as ClienteJson;
  clientesCreados.push(cliente.id);
  return cliente;
}

/**
 * `xmin` es el id de la transacción que escribió la versión actual de la fila: cambia con
 * cualquier UPDATE, aunque deje los mismos valores. Si no cambia, la fila no se escribió.
 */
async function versionDeLaFila(id: string): Promise<{ xmin: string; updatedAt: Date }> {
  const [fila] = await prisma.$queryRaw<{ xmin: string; updatedAt: Date }[]>`
    SELECT xmin::text AS xmin, "updatedAt" FROM "Cliente" WHERE id = ${id}::uuid`;
  if (fila === undefined) throw new Error(`No existe la fila ${id}`);
  return fila;
}

const cambiarEstado = (id: string, estado: string) =>
  request(app).patch(`/clientes/${id}/estado`).send({ estado });

describe.skipIf(url === undefined)('Clientes contra PostgreSQL real: estado y edición', () => {
  describe('PATCH /clientes/:id/estado', () => {
    it('ACTIVO → ACTIVO responde 200 con el cliente y no escribe la fila (updatedAt y xmin iguales)', async () => {
      const cliente = await crearCliente();
      const antes = await versionDeLaFila(cliente.id);

      const respuesta = await cambiarEstado(cliente.id, 'ACTIVO');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual(cliente);
      const despues = await versionDeLaFila(cliente.id);
      expect(despues.xmin).toBe(antes.xmin);
      expect(despues.updatedAt).toEqual(antes.updatedAt);
    });

    it('ACTIVO → INACTIVO cambia el estado y actualiza updatedAt', async () => {
      const cliente = await crearCliente();
      const antes = await versionDeLaFila(cliente.id);

      const respuesta = await cambiarEstado(cliente.id, 'INACTIVO');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ id: cliente.id, estado: 'INACTIVO' });
      const despues = await versionDeLaFila(cliente.id);
      expect(despues.xmin).not.toBe(antes.xmin);
      expect(despues.updatedAt.getTime()).toBeGreaterThan(antes.updatedAt.getTime());
      expect((respuesta.body as ClienteJson).actualizadoEn).toBe(despues.updatedAt.toISOString());
    });

    it('INACTIVO → INACTIVO tampoco escribe la fila', async () => {
      const cliente = await crearCliente();
      const inactivo = (await cambiarEstado(cliente.id, 'INACTIVO')).body as ClienteJson;
      const antes = await versionDeLaFila(cliente.id);

      const respuesta = await cambiarEstado(cliente.id, 'INACTIVO');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual(inactivo);
      expect(await versionDeLaFila(cliente.id)).toEqual(antes);
    });

    it('un cliente inexistente es 404', async () => {
      const respuesta = await cambiarEstado('00000000-0000-4000-8000-000000000000', 'INACTIVO');
      expect(respuesta.status).toBe(404);
    });

    it('un cliente dado de baja lógica es 404 (pida el estado que pida) y no se escribe', async () => {
      const cliente = await crearCliente();
      await prisma.cliente.update({
        where: { id: cliente.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      const antes = await versionDeLaFila(cliente.id);

      expect((await cambiarEstado(cliente.id, 'ACTIVO')).status).toBe(404);
      expect((await cambiarEstado(cliente.id, 'INACTIVO')).status).toBe(404);
      expect(await versionDeLaFila(cliente.id)).toEqual(antes);
    });

    it('dos desactivaciones simultáneas: las dos responden INACTIVO y la fila se escribe una sola vez', async () => {
      const cliente = await crearCliente();

      const [a, b] = await Promise.all([
        cambiarEstado(cliente.id, 'INACTIVO'),
        cambiarEstado(cliente.id, 'INACTIVO'),
      ]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const [cuerpoA, cuerpoB] = [a.body as ClienteJson, b.body as ClienteJson];
      expect(cuerpoA.estado).toBe('INACTIVO');
      expect(cuerpoB.estado).toBe('INACTIVO');
      // Una sola escritura: las dos respuestas muestran la misma versión, y es la guardada.
      expect(cuerpoA.actualizadoEn).toBe(cuerpoB.actualizadoEn);
      const guardada = await versionDeLaFila(cliente.id);
      expect(guardada.updatedAt.toISOString()).toBe(cuerpoA.actualizadoEn);
    });

    it('pedidos opuestos simultáneos: cada respuesta muestra el estado que pidió', async () => {
      const cliente = await crearCliente();

      const respuestas = await Promise.all(
        ['INACTIVO', 'ACTIVO', 'INACTIVO', 'ACTIVO'].map((estado) =>
          cambiarEstado(cliente.id, estado).then((r) => ({ estado, r })),
        ),
      );

      for (const { estado, r } of respuestas) {
        expect(r.status).toBe(200);
        expect((r.body as ClienteJson).estado).toBe(estado);
      }
    });
  });

  describe('PATCH /clientes/:id parcial', () => {
    it('enviar solo el email modifica solo el email: la razón social y el resto se conservan', async () => {
      const cliente = await crearCliente();

      const respuesta = await request(app)
        .patch(`/clientes/${cliente.id}`)
        .send({ emailContacto: 'nuevo@ejemplo.example' });

      expect(respuesta.status).toBe(200);
      const guardado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(guardado.emailContacto).toBe('nuevo@ejemplo.example');
      expect(guardado.razonSocial).toBe(cliente.razonSocial);
    });

    it('dos editores: A guarda solo el email sobre un dato viejo y no pisa la razón social que cambió B', async () => {
      const cliente = await crearCliente();
      // A abrió el cliente (su copia es `cliente`). B cambia la razón social y guarda.
      const deB = await request(app)
        .patch(`/clientes/${cliente.id}`)
        .send({ razonSocial: `${MARCA} Razón social de B` });
      expect(deB.status).toBe(200);

      // A cambió solo el email: su PATCH lleva únicamente ese campo.
      const deA = await request(app)
        .patch(`/clientes/${cliente.id}`)
        .send({ emailContacto: 'de.a@ejemplo.example' });

      expect(deA.status).toBe(200);
      const guardado = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(guardado.razonSocial).toBe(`${MARCA} Razón social de B`);
      expect(guardado.emailContacto).toBe('de.a@ejemplo.example');
    });
  });
});
