import type { Prisma, Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en el alta: solo la base es simulada. Como el doble no filtra, se verifica qué
// `where` y `orderBy` se le piden a Prisma y que la respuesta cumple el contrato.
const prismaMock = vi.hoisted(() => ({
  cliente: {
    findMany:
      vi.fn<
        (args: {
          where: Prisma.ClienteWhereInput;
          orderBy: Prisma.ClienteOrderByWithRelationInput;
        }) => Promise<ClienteRow[]>
      >(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const AHORA = new Date('2026-10-08T12:00:00.000Z');

// Datos ficticios.
const base: ClienteRow = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Zeta S.A.',
  denominacion: 'Zeta',
  cuit: '20-12345678-6',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@zeta.example',
  emailsAdicionales: [],
  telefono: null,
  portalUrl: null,
  sector: 'PRIVADO',
  subtipo: null,
  estado: 'ACTIVO',
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
};

const publica: ClienteRow = {
  ...base,
  id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
};

const whereEnviado = () => prismaMock.cliente.findMany.mock.calls[0]?.[0].where;
const condicionesDeCuit = () =>
  (whereEnviado()?.OR as Prisma.ClienteWhereInput[])
    .filter((condicion) => condicion.cuit !== undefined)
    .map((condicion) => (condicion.cuit as { contains: string }).contains);

beforeEach(() => {
  prismaMock.cliente.findMany.mockResolvedValue([publica, base]);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('GET /clientes', () => {
  it('responde 200 con la lista según el contrato, sin campos internos', async () => {
    const res = await request(app).get('/clientes');

    expect(res.status).toBe(200);
    const clientes = res.body as unknown[];
    expect(clientes).toHaveLength(2);
    expect(clientes.every((c) => ClienteSchema.safeParse(c).success)).toBe(true);
    expect(clientes[0]).not.toHaveProperty('isDeleted');
    expect(clientes[1]).not.toHaveProperty('subtipo');
  });

  it('por defecto pide solo ACTIVOS, excluye las bajas lógicas y ordena por razón social', async () => {
    await request(app).get('/clientes');

    expect(prismaMock.cliente.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false, estado: 'ACTIVO' },
      orderBy: { razonSocial: 'asc' },
    });
  });

  it('responde 200 con una lista vacía si no hay resultados', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([]);

    const res = await request(app).get('/clientes?sector=PRIVADO');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('filtra por estado', async () => {
    await request(app).get('/clientes?estado=INACTIVO');

    expect(whereEnviado()).toEqual({ isDeleted: false, estado: 'INACTIVO' });
  });

  it('filtra por sector', async () => {
    await request(app).get('/clientes?sector=PRIVADO');

    expect(whereEnviado()).toEqual({ isDeleted: false, estado: 'ACTIVO', sector: 'PRIVADO' });
  });

  it('filtra por subtipo', async () => {
    await request(app).get('/clientes?subtipo=MUNICIPAL');

    expect(whereEnviado()).toEqual({ isDeleted: false, estado: 'ACTIVO', subtipo: 'MUNICIPAL' });
  });

  it('combina sector, subtipo y búsqueda', async () => {
    await request(app).get('/clientes?sector=PUBLICO&subtipo=MUNICIPAL&q=muni');

    expect(whereEnviado()).toMatchObject({
      isDeleted: false,
      estado: 'ACTIVO',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      OR: expect.arrayContaining([
        { razonSocial: { contains: 'muni', mode: 'insensitive' } },
        { denominacion: { contains: 'muni', mode: 'insensitive' } },
      ]) as unknown,
    });
  });

  it('q de texto busca solo en razón social y denominación, sin distinguir mayúsculas', async () => {
    await request(app).get('/clientes?q=Muni');

    expect(whereEnviado()?.OR).toEqual([
      { razonSocial: { contains: 'Muni', mode: 'insensitive' } },
      { denominacion: { contains: 'Muni', mode: 'insensitive' } },
    ]);
  });

  it.each([
    ['con guiones', '30-50001274-5'],
    ['sin guiones', '30500012745'],
    ['un fragmento sin guiones', '0001274'],
    ['un fragmento que cruza el primer guion', '05'],
    ['un fragmento que cruza el último guion', '45'],
  ])('q con un CUIT %s coincide con el CUIT guardado con guiones', async (_caso, q) => {
    await request(app).get(`/clientes?q=${q}`);

    expect(condicionesDeCuit().some((fragmento) => publica.cuit.includes(fragmento))).toBe(true);
  });

  it('ignora q en blanco', async () => {
    await request(app).get('/clientes?q=%20%20');

    expect(whereEnviado()).toEqual({ isDeleted: false, estado: 'ACTIVO' });
  });

  it.each([
    ['sector PRIVADO con subtipo', '?sector=PRIVADO&subtipo=MUNICIPAL'],
    ['un subtipo desconocido', '?subtipo=FEDERAL'],
    ['un sector desconocido', '?sector=MIXTO'],
    ['un estado desconocido', '?estado=BORRADO'],
  ])('responde 400 VALIDATION_ERROR con %s', async (_caso, query) => {
    const res = await request(app).get(`/clientes${query}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(prismaMock.cliente.findMany).not.toHaveBeenCalled();
  });

  it('el 400 por subtipo incompatible señala el campo "subtipo"', async () => {
    const res = await request(app).get('/clientes?sector=PRIVADO&subtipo=MUNICIPAL');

    expect(res.body).toMatchObject({ error: { details: [{ campo: 'subtipo' }] } });
  });
});
