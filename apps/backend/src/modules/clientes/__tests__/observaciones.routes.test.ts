import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cliente: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RUTA = `/clientes/${CLIENTE_ID}/observaciones`;

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { campo: string; mensaje: string }[];
  };
}

const error = (res: request.Response) => (res.body as ErrorResponse).error;
const campos = (res: request.Response) => (error(res).details ?? []).map((d) => d.campo);

/** El `update` no encontró una fila que cumpla el `where`: el cliente no existe o tiene baja lógica. */
const sinFila = () =>
  new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
    code: 'P2025',
    clientVersion: 'test',
  });

describe('Rutas de observaciones del cliente (HU2.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /clientes/:id/observaciones', () => {
    it('responde 400 VALIDATION_ERROR si el id no es un UUID', async () => {
      const res = await request(app).get('/clientes/invalido/observaciones');

      expect(res.status).toBe(400);
      expect(error(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('id');
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
    });

    it('responde 404 NOT_FOUND si el cliente no existe o tiene baja lógica', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(null);

      const res = await request(app).get(RUTA);

      expect(res.status).toBe(404);
      expect(error(res).code).toBe('NOT_FOUND');
      expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID, isDeleted: false },
        select: { observaciones: true },
      });
    });

    it('responde 200 con null si el cliente no tiene observaciones', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue({ observaciones: null });

      const res = await request(app).get(RUTA);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ observaciones: null });
    });

    it('responde 200 con el texto, con sus saltos de línea', async () => {
      const texto = 'Cambió el mail.\nPausó la pauta hasta marzo.';
      prismaMock.cliente.findFirst.mockResolvedValue({ observaciones: texto });

      const res = await request(app).get(RUTA);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ observaciones: texto });
    });

    it('lee un registro viejo con una tabulación sin romper el GET', async () => {
      const texto = 'Cambió\tel mail.\nAvisar a Compras.';
      prismaMock.cliente.findFirst.mockResolvedValue({ observaciones: texto });

      const res = await request(app).get(RUTA);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ observaciones: texto });
    });

    it('lee solo el texto: el pedido no incluye otros campos del cliente', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue({ observaciones: null });

      await request(app).get(RUTA);

      expect(prismaMock.cliente.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('PUT /clientes/:id/observaciones', () => {
    it('responde 400 VALIDATION_ERROR si el id no es un UUID', async () => {
      const res = await request(app).put('/clientes/invalido/observaciones').send({
        observaciones: 'Texto',
      });

      expect(res.status).toBe(400);
      expect(error(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('id');
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si falta la clave observaciones', async () => {
      const res = await request(app).put(RUTA).send({});

      expect(res.status).toBe(400);
      expect(error(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('observaciones');
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it.each([5, true, ['a']])('responde 400 si no es texto ni null (%j)', async (valor) => {
      const res = await request(app).put(RUTA).send({ observaciones: valor });

      expect(res.status).toBe(400);
      expect(campos(res)).toContain('observaciones');
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si supera los 1000 caracteres', async () => {
      const res = await request(app)
        .put(RUTA)
        .send({ observaciones: 'a'.repeat(1001) });

      expect(res.status).toBe(400);
      expect(campos(res)).toContain('observaciones');
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si tiene caracteres de control que no son saltos de línea', async () => {
      const res = await request(app).put(RUTA).send({ observaciones: 'Cambió\tel mail' });

      expect(res.status).toBe(400);
      expect(campos(res)).toContain('observaciones');
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 404 NOT_FOUND si el cliente no existe o tiene baja lógica', async () => {
      prismaMock.cliente.update.mockRejectedValue(sinFila());

      const res = await request(app).put(RUTA).send({ observaciones: 'Texto de prueba' });

      expect(res.status).toBe(404);
      expect(error(res).code).toBe('NOT_FOUND');
    });

    it('un error inesperado de la base no se confunde con un 404', async () => {
      prismaMock.cliente.update.mockRejectedValue(new Error('conexión caída'));

      const res = await request(app).put(RUTA).send({ observaciones: 'Texto de prueba' });

      expect(res.status).toBe(500);
    });

    it('guarda el texto recortado y con saltos de línea, con un update directo que excluye las bajas lógicas', async () => {
      const textoEsperado = 'Cambió el mail.\nPausó la pauta.';
      prismaMock.cliente.update.mockResolvedValue({ observaciones: textoEsperado });

      const res = await request(app)
        .put(RUTA)
        .send({ observaciones: `  ${textoEsperado}  ` });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ observaciones: textoEsperado });
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID, isDeleted: false },
        data: { observaciones: textoEsperado },
        select: { observaciones: true },
      });
      // No hay consulta previa ni transacción: no depende del estado del cliente.
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const)(
      'guarda con el cliente %s: el estado no condiciona la edición',
      async (estado) => {
        // El servicio no lee el estado; la fila devuelta lo trae solo para dejar claro el caso.
        prismaMock.cliente.update.mockResolvedValue({ estado, observaciones: 'Pausó la pauta.' });

        const res = await request(app).put(RUTA).send({ observaciones: 'Pausó la pauta.' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ observaciones: 'Pausó la pauta.' });
        expect(prismaMock.cliente.update).toHaveBeenCalledTimes(1);
      },
    );

    it('reemplaza una nota por otra: lo que se guarda es el texto nuevo, sin combinarlo con el anterior', async () => {
      prismaMock.cliente.update
        .mockResolvedValueOnce({ observaciones: 'Primera nota.' })
        .mockResolvedValueOnce({ observaciones: 'Segunda nota.' });

      const primera = await request(app).put(RUTA).send({ observaciones: 'Primera nota.' });
      const segunda = await request(app).put(RUTA).send({ observaciones: 'Segunda nota.' });

      expect(primera.body).toEqual({ observaciones: 'Primera nota.' });
      expect(segunda.body).toEqual({ observaciones: 'Segunda nota.' });
      expect(prismaMock.cliente.update).toHaveBeenNthCalledWith(2, {
        where: { id: CLIENTE_ID, isDeleted: false },
        data: { observaciones: 'Segunda nota.' },
        select: { observaciones: true },
      });
    });

    it('guardar el mismo texto otra vez también escribe: no se compara con lo guardado', async () => {
      prismaMock.cliente.update.mockResolvedValue({ observaciones: 'Igual.' });

      await request(app).put(RUTA).send({ observaciones: 'Igual.' });
      await request(app).put(RUTA).send({ observaciones: 'Igual.' });

      expect(prismaMock.cliente.update).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['null explícito', null],
      ['string vacío', ''],
      ['solo espacios', '   \n  '],
    ])('guarda null al enviar %s', async (_descripcion, valor) => {
      prismaMock.cliente.update.mockResolvedValue({ observaciones: null });

      const res = await request(app).put(RUTA).send({ observaciones: valor });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ observaciones: null });
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID, isDeleted: false },
        data: { observaciones: null },
        select: { observaciones: true },
      });
    });
  });
});
