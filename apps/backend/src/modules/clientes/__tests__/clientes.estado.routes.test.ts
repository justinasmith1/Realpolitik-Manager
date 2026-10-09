import { Prisma, type Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en el alta y la edición: solo la base es simulada y se recorre la cadena real
// route → validate → controller → service → mapper → errorHandler.
const prismaMock = vi.hoisted(() => ({
  cliente: {
    update:
      vi.fn<
        (args: {
          where: { id: string; isDeleted: boolean };
          data: Prisma.ClienteUpdateInput;
        }) => Promise<ClienteRow>
      >(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const ID = 'c3d4e5f6-a7b8-4901-8def-012345678901';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

// Datos ficticios. Cliente con teléfono y emails adicionales para comprobar que el cambio de
// estado no toca nada más.
const filaActiva: ClienteRow = {
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
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
};

const patchEstado = (id: string, body: object) =>
  request(app).patch(`/clientes/${id}/estado`).send(body);

const errorDePrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });

const camposConError = (res: request.Response) =>
  (res.body as { error: { details: { campo: string }[] } }).error.details.map((d) => d.campo);

beforeEach(() => {
  // La base devuelve la fila con el estado que se le pidió.
  prismaMock.cliente.update.mockImplementation(({ data }) =>
    Promise.resolve({ ...filaActiva, estado: data.estado as ClienteRow['estado'] }),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('PATCH /clientes/:id/estado', () => {
  describe('cambio de estado', () => {
    it('desactiva un cliente: responde 200 con estado INACTIVO y los datos intactos', async () => {
      const res = await patchEstado(ID, { estado: 'INACTIVO' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: ID,
        razonSocial: 'Municipio de Ejemplo',
        cuit: '30-50001274-5',
        telefono: '+54 11 4000-1234',
        emailsAdicionales: ['otro@municipio.example'],
        estado: 'INACTIVO',
      });
      expect(ClienteSchema.safeParse(res.body).success).toBe(true);
    });

    it('en la base solo cambia el estado y filtra las bajas lógicas en el where', async () => {
      await patchEstado(ID, { estado: 'INACTIVO' });

      expect(prismaMock.cliente.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: ID, isDeleted: false },
        data: { estado: 'INACTIVO' },
      });
    });

    it('no usa la baja lógica: no envía isDeleted ni deletedAt en los datos', async () => {
      await patchEstado(ID, { estado: 'INACTIVO' });

      const data = prismaMock.cliente.update.mock.calls[0]?.[0].data ?? {};
      expect(data).not.toHaveProperty('isDeleted');
      expect(data).not.toHaveProperty('deletedAt');
    });

    it('reactiva un cliente inactivo: responde 200 con estado ACTIVO', async () => {
      const res = await patchEstado(ID, { estado: 'ACTIVO' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ID, estado: 'ACTIVO' });
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: ID, isDeleted: false },
        data: { estado: 'ACTIVO' },
      });
    });

    it('pedir el estado que ya tiene responde 200 sin error (idempotente)', async () => {
      const primera = await patchEstado(ID, { estado: 'ACTIVO' });
      const segunda = await patchEstado(ID, { estado: 'ACTIVO' });

      expect(primera.status).toBe(200);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual(primera.body);
    });

    it('ignora cualquier otro campo del cuerpo', async () => {
      const res = await patchEstado(ID, { estado: 'INACTIVO', razonSocial: 'Otra S.A.' });

      expect(res.status).toBe(200);
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: ID, isDeleted: false },
        data: { estado: 'INACTIVO' },
      });
    });
  });

  describe('cliente inexistente', () => {
    it('responde 404 si no existe o está dado de baja (P2025)', async () => {
      prismaMock.cliente.update.mockRejectedValue(errorDePrisma('P2025'));

      const res = await patchEstado(ID, { estado: 'INACTIVO' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });

  describe('datos inválidos', () => {
    it('responde 400 por SUSPENDIDO, que es un estado reservado, sin tocar la base', async () => {
      const res = await patchEstado(ID, { estado: 'SUSPENDIDO' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(camposConError(res)).toEqual(['estado']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it.each([
      ['un valor desconocido', { estado: 'BORRADO' }],
      ['un estado en minúscula', { estado: 'activo' }],
      ['un cuerpo sin estado', {}],
      ['un estado nulo', { estado: null }],
    ])('responde 400 por %s, sin tocar la base', async (_caso, body) => {
      const res = await patchEstado(ID, body);

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual(['estado']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid, sin tocar la base', async () => {
      const res = await patchEstado('no-es-un-uuid', { estado: 'INACTIVO' });

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual(['id']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });
  });

  describe('errores inesperados', () => {
    it('responde 500 genérico ante un fallo de Prisma que no es un 404', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      prismaMock.cliente.update.mockRejectedValue(errorDePrisma('P1001'));

      const res = await patchEstado(ID, { estado: 'INACTIVO' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
      });
    });
  });
});
