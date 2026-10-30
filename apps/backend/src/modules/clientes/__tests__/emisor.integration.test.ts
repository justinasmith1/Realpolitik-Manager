// Tests de integración del emisor habitual del cliente (HU2.9) contra PostgreSQL REAL.
// Prueban lo que un mock no puede: que el emisor se persiste y se vuelve a leer, que se puede
// cambiar y quitar, que un cliente sin emisor se guarda igual y que la base rechaza un valor
// fuera del enum.
//
// Igual que `observaciones.integration.test.ts`: opcionales (sin `TEST_DATABASE_URL` se saltan),
// solo contra una base DESCARTABLE (`*_audit` o `*_test`) con las migraciones aplicadas:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run emisor.integration
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

const MARCA = `TESTE${Date.now().toString(36).toUpperCase()}`;

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
      const candidato = `30${cuerpo}${verificador}`;
      if (validateCuit(candidato)) {
        return `30-${cuerpo}-${verificador}`;
      }
    }
  }
}

async function crearCliente(extra: Record<string, unknown> = {}) {
  const respuesta = await request(app)
    .post('/clientes')
    .send({
      razonSocial: `${MARCA} Cliente de prueba`,
      denominacion: `${MARCA} prueba`,
      cuit: cuitUnico(),
      sector: 'PRIVADO',
      ivaCondicion: 'EXENTO',
      emailContacto: 'original@ejemplo.example',
      ...extra,
    });
  // Un alta que falla se registra para que `crearCliente` no devuelva un cliente inexistente.
  if (respuesta.status === 201) clientesCreados.push((respuesta.body as { id: string }).id);
  return respuesta;
}

/** Crea un cliente que tiene que salir bien: si la base no responde, el test falla acá. */
async function crearClienteOk(extra: Record<string, unknown> = {}): Promise<string> {
  const respuesta = await crearCliente(extra);
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return idDe(respuesta);
}

const idDe = (res: request.Response) => (res.body as { id: string }).id;
const editar = (id: string, body: object) => request(app).patch(`/clientes/${id}`).send(body);
const leer = (id: string) => request(app).get(`/clientes/${id}`);

describe.skipIf(url === undefined)('Emisor del cliente contra PostgreSQL real', () => {
  it('un cliente sin emisor se guarda igual: no lo trae y la columna queda en NULL', async () => {
    const alta = await crearCliente();

    expect(alta.status).toBe(201);
    expect(alta.body).not.toHaveProperty('emisor');
    const fila = await prisma.cliente.findUniqueOrThrow({ where: { id: idDe(alta) } });
    expect(fila.emisor).toBeNull();
  });

  it.each(['PERSONA_FISICA', 'SOCIEDAD'] as const)(
    'el alta con emisor %s lo persiste y se vuelve a leer',
    async (emisor) => {
      const alta = await crearCliente({ emisor });

      expect(alta.status).toBe(201);
      const leido = await leer(idDe(alta));
      expect(leido.status).toBe(200);
      expect(leido.body).toMatchObject({ emisor });
      const fila = await prisma.cliente.findUniqueOrThrow({ where: { id: idDe(alta) } });
      expect(fila.emisor).toBe(emisor);
    },
  );

  it('asigna, cambia y quita el emisor de un cliente existente', async () => {
    const id = await crearClienteOk();

    const asignado = await editar(id, { emisor: 'SOCIEDAD' });
    expect(asignado.status).toBe(200);
    expect(asignado.body).toMatchObject({ emisor: 'SOCIEDAD' });

    const cambiado = await editar(id, { emisor: 'PERSONA_FISICA' });
    expect(cambiado.body).toMatchObject({ emisor: 'PERSONA_FISICA' });

    const quitado = await editar(id, { emisor: null });
    expect(quitado.status).toBe(200);
    expect(quitado.body).not.toHaveProperty('emisor');
    const fila = await prisma.cliente.findUniqueOrThrow({ where: { id } });
    expect(fila.emisor).toBeNull();
  });

  it('editar otro campo conserva el emisor', async () => {
    const id = await crearClienteOk({ emisor: 'SOCIEDAD' });

    const res = await editar(id, { razonSocial: `${MARCA} Renombrado` });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ emisor: 'SOCIEDAD' });
  });

  it('el listado trae el emisor de cada cliente', async () => {
    const id = await crearClienteOk({ emisor: 'PERSONA_FISICA' });

    const res = await request(app).get('/clientes');

    expect(res.status).toBe(200);
    const propio = (res.body as { id: string; emisor?: string }[]).find((c) => c.id === id);
    expect(propio?.emisor).toBe('PERSONA_FISICA');
  });

  it('un emisor desconocido es 400 y no modifica al cliente', async () => {
    const id = await crearClienteOk({ emisor: 'SOCIEDAD' });

    const res = await editar(id, { emisor: 'OTRO' });

    expect(res.status).toBe(400);
    const fila = await prisma.cliente.findUniqueOrThrow({ where: { id } });
    expect(fila.emisor).toBe('SOCIEDAD');
  });

  it('la base rechaza un valor fuera del enum aunque no pase por la API', async () => {
    const id = await crearClienteOk();

    const error: unknown = await prisma
      .$executeRawUnsafe(`UPDATE "Cliente" SET "emisor" = 'OTRO' WHERE "id" = '${id}'::uuid`)
      .then(
        () => undefined,
        (fallo: unknown) => fallo,
      );

    // La causa tiene que ser el valor inválido para el enum (SQLSTATE 22P02), no cualquier
    // fallo: una conexión rota también haría fallar la consulta.
    expect(error).toBeDefined();
    const sqlstate = (error as { meta?: { code?: unknown } }).meta?.code;
    const mensaje = error instanceof Error ? error.message : String(error);
    expect(
      sqlstate === '22P02' || mensaje.includes('invalid input value for enum'),
      `Se esperaba "invalid input value for enum" (22P02) y fue: ${mensaje}`,
    ).toBe(true);
  });
});
