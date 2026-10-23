import type { Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Solo la base es simulada. Se recorre la cadena real
// route → validate → controller → service → mapper → errorHandler.
const prismaMock = vi.hoisted(() => ({
  cliente: {
    findFirst:
      vi.fn<(args: { where: { id: string; isDeleted: boolean } }) => Promise<ClienteRow | null>>(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const ID = 'c3d4e5f6-a7b8-4901-8def-012345678901';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

const fila: ClienteRow = {
  id: ID,
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: ['otro@municipio.example'],
  telefono: '+54 11 4000-1234',
  portalUrl: null,
  canalEntrega: 'CORREO',
  whatsappNumero: null,
  periodicidadTipo: null,
  periodicidadDiaLimite: null,
  periodicidadMesInicioCiclo: null,
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  estado: 'ACTIVO',
  matrizConfigurada: false,
  indicacionesArmado: 'No sale en el DTO',
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
};

const whereEnviado = () => prismaMock.cliente.findFirst.mock.calls[0]?.[0].where;

beforeEach(() => {
  prismaMock.cliente.findFirst.mockResolvedValue(fila);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('GET /clientes/:id', () => {
  it('responde 200 con el mismo DTO del listado, incluida matrizConfigurada', async () => {
    const res = await request(app).get(`/clientes/${ID}`);

    expect(res.status).toBe(200);
    expect(ClienteSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toEqual({
      id: ID,
      razonSocial: 'Municipio de Ejemplo',
      denominacion: 'Muni Ejemplo',
      cuit: '30-50001274-5',
      ivaCondicion: 'EXENTO',
      emailContacto: 'compras@municipio.example',
      emailsAdicionales: ['otro@municipio.example'],
      telefono: '+54 11 4000-1234',
      canalEntrega: 'CORREO',
      periodicidad: null,
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      estado: 'ACTIVO',
      matrizConfigurada: false,
      creadoEn: AHORA.toISOString(),
      actualizadoEn: AHORA.toISOString(),
    });
    expect(whereEnviado()).toEqual({ id: ID, isDeleted: false });
  });

  it('copia matrizConfigurada true sin volver a calcularla', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue({ ...fila, matrizConfigurada: true });

    const res = await request(app).get(`/clientes/${ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID, matrizConfigurada: true });
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const)(
    'permite leer un cliente %s',
    async (estado) => {
      prismaMock.cliente.findFirst.mockResolvedValue({ ...fila, estado });

      const res = await request(app).get(`/clientes/${ID}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ID, estado, matrizConfigurada: false });
    },
  );

  it('no expone campos internos', async () => {
    const res = await request(app).get(`/clientes/${ID}`);

    for (const campo of [
      'isDeleted',
      'deletedAt',
      'createdAt',
      'updatedAt',
      'indicacionesArmado',
    ]) {
      expect(res.body).not.toHaveProperty(campo);
    }
  });

  it('responde 404 si el cliente no existe', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`/clientes/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' },
    });
  });

  it('responde 404 si el cliente tiene baja lógica y no lo pide a la base', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`/clientes/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(whereEnviado()).toEqual({ id: ID, isDeleted: false });
  });

  it('responde 400 VALIDATION_ERROR si el id no es un UUID y no llega a la base', async () => {
    const res = await request(app).get('/clientes/no-es-uuid');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'id' }] },
    });
    expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
  });
});
