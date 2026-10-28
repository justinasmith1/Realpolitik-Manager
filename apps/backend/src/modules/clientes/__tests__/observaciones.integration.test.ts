// Tests de integración de las observaciones internas del cliente (HU2.10) contra PostgreSQL REAL.
// Prueban lo que un mock no puede: que la nota se persiste y se vuelve a leer, que guardar otra
// la reemplaza, que se puede guardar con el cliente inactivo y que un cliente inexistente o con
// baja lógica es un 404.
//
// Igual que `clientes.estado-edicion.integration.test.ts`: opcionales (sin `TEST_DATABASE_URL` se
// saltan), solo contra una base DESCARTABLE (`*_audit` o `*_test`) con las migraciones aplicadas:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run observaciones.integration
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

const MARCA = `TESTO${Date.now().toString(36).toUpperCase()}`;
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

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

async function crearCliente(): Promise<string> {
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
  const { id } = respuesta.body as { id: string };
  clientesCreados.push(id);
  return id;
}

const leer = (id: string) => request(app).get(`/clientes/${id}/observaciones`);
const guardar = (id: string, observaciones: string | null) =>
  request(app).put(`/clientes/${id}/observaciones`).send({ observaciones });

describe.skipIf(url === undefined)('Observaciones del cliente contra PostgreSQL real', () => {
  it('un cliente nuevo no tiene observaciones', async () => {
    const id = await crearCliente();

    const res = await leer(id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ observaciones: null });
  });

  it('guardar y volver a leer devuelve la nota, recortada y con sus saltos de línea', async () => {
    const id = await crearCliente();

    const guardada = await guardar(id, '  Cambió el mail.\r\nPausó la pauta hasta marzo.  ');
    const leida = await leer(id);

    expect(guardada.status).toBe(200);
    expect(guardada.body).toEqual({
      observaciones: 'Cambió el mail.\r\nPausó la pauta hasta marzo.',
    });
    expect(leida.status).toBe(200);
    expect(leida.body).toEqual(guardada.body);
  });

  it('guardar otra nota reemplaza la anterior', async () => {
    const id = await crearCliente();
    await guardar(id, 'Primera nota.');

    const segunda = await guardar(id, 'Segunda nota.');
    const leida = await leer(id);

    expect(segunda.status).toBe(200);
    expect(leida.body).toEqual({ observaciones: 'Segunda nota.' });
  });

  it('un texto vacío borra la nota: se guarda NULL, no una cadena vacía', async () => {
    const id = await crearCliente();
    await guardar(id, 'Para borrar.');

    const res = await guardar(id, '   ');
    const [fila] = await prisma.$queryRaw<{ observaciones: string | null }[]>`
      SELECT "observaciones" FROM "Cliente" WHERE id = ${id}::uuid`;

    expect(res.body).toEqual({ observaciones: null });
    expect(fila?.observaciones).toBeNull();
  });

  it('se puede guardar con el cliente inactivo', async () => {
    const id = await crearCliente();
    const baja = await request(app).patch(`/clientes/${id}/estado`).send({ estado: 'INACTIVO' });
    expect(baja.status).toBe(200);

    const res = await guardar(id, 'Pausó la pauta.');
    const leida = await leer(id);

    expect(res.status).toBe(200);
    expect(leida.body).toEqual({ observaciones: 'Pausó la pauta.' });
  });

  it('la nota no sale en los datos del cliente', async () => {
    const id = await crearCliente();
    await guardar(id, 'Nota interna.');

    const res = await request(app).get(`/clientes/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('observaciones');
  });

  it('un cliente inexistente es 404 al leer y al guardar', async () => {
    const lectura = await leer(ID_INEXISTENTE);
    const escritura = await guardar(ID_INEXISTENTE, 'Texto.');

    expect(lectura.status).toBe(404);
    expect(escritura.status).toBe(404);
  });

  it('un cliente con baja lógica es 404 al leer y al guardar, y su nota no cambia', async () => {
    const id = await crearCliente();
    await guardar(id, 'Antes de la baja.');
    await prisma.cliente.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    const lectura = await leer(id);
    const escritura = await guardar(id, 'Después de la baja.');
    const [fila] = await prisma.$queryRaw<{ observaciones: string | null }[]>`
      SELECT "observaciones" FROM "Cliente" WHERE id = ${id}::uuid`;

    expect(lectura.status).toBe(404);
    expect(escritura.status).toBe(404);
    expect(fila?.observaciones).toBe('Antes de la baja.');
  });
});
