import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    update: vi.fn(),
  });
  const transaccion = {
    cliente: delegado(),
  };
  const prismaMock = {
    cliente: delegado(),
    $transaction: vi.fn(),
  };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

interface ValidationErrorResponse {
  error: {
    code: string;
    message: string;
    details: { campo: string; mensaje: string }[];
  };
}

interface ConflictErrorResponse {
  error: {
    code: string;
    message: string;
    details: { motivo: string; estado: string };
  };
}

interface GenericErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

const errorGenerico = (res: request.Response) => (res.body as GenericErrorResponse).error;
const detalles = (res: request.Response) => (res.body as ValidationErrorResponse).error.details;
const campos = (res: request.Response) => detalles(res).map((detalle) => detalle.campo);
const conflicto = (res: request.Response) => (res.body as ConflictErrorResponse).error;

describe('Rutas de indicaciones de armado (HU2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) =>
      callback(transaccion),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /clientes/:id/indicaciones-armado', () => {
    it('responde 400 VALIDATION_ERROR si el id no es un UUID', async () => {
      const res = await request(app).get('/clientes/invalido/indicaciones-armado');

      expect(res.status).toBe(400);
      expect(errorGenerico(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('id');
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
    });

    it('responde 404 NOT_FOUND si el cliente no existe o tiene baja lógica', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(null);

      const res = await request(app).get(`/clientes/${CLIENTE_ID}/indicaciones-armado`);

      expect(res.status).toBe(404);
      expect(errorGenerico(res).code).toBe('NOT_FOUND');
      expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID, isDeleted: false },
        select: { indicacionesArmado: true },
      });
    });

    it('responde 200 con null si el cliente no tiene indicaciones cargadas', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue({
        indicacionesArmado: null,
      });

      const res = await request(app).get(`/clientes/${CLIENTE_ID}/indicaciones-armado`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ indicacionesArmado: null });
    });

    it('responde 200 con el texto si el cliente tiene indicaciones', async () => {
      const texto = 'Factura primero.\nTodo en un solo PDF duplicado.';
      prismaMock.cliente.findFirst.mockResolvedValue({
        indicacionesArmado: texto,
      });

      const res = await request(app).get(`/clientes/${CLIENTE_ID}/indicaciones-armado`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ indicacionesArmado: texto });
    });

    it('lee un registro viejo con una tabulación sin romper el GET', async () => {
      const texto = 'Factura\tprimero.\nTodo en un solo PDF.';
      prismaMock.cliente.findFirst.mockResolvedValue({ indicacionesArmado: texto });

      const res = await request(app).get(`/clientes/${CLIENTE_ID}/indicaciones-armado`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ indicacionesArmado: texto });
    });

    it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
      'permite leer las indicaciones de un cliente %s (cualquier estado)',
      async () => {
        prismaMock.cliente.findFirst.mockResolvedValue({
          indicacionesArmado: 'Indicaciones históricas de cliente inactivo',
        });

        const res = await request(app).get(`/clientes/${CLIENTE_ID}/indicaciones-armado`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          indicacionesArmado: 'Indicaciones históricas de cliente inactivo',
        });
      },
    );
  });

  describe('PUT /clientes/:id/indicaciones-armado', () => {
    it('responde 400 VALIDATION_ERROR si el id no es un UUID', async () => {
      const res = await request(app)
        .put('/clientes/no-uuid/indicaciones-armado')
        .send({ indicacionesArmado: 'Texto de prueba' });

      expect(res.status).toBe(400);
      expect(errorGenerico(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('id');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si falta la clave indicacionesArmado', async () => {
      const res = await request(app).put(`/clientes/${CLIENTE_ID}/indicaciones-armado`).send({});

      expect(res.status).toBe(400);
      expect(errorGenerico(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('indicacionesArmado');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si supera los 1000 caracteres', async () => {
      const textoLargo = 'a'.repeat(1001);
      const res = await request(app)
        .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
        .send({ indicacionesArmado: textoLargo });

      expect(res.status).toBe(400);
      expect(errorGenerico(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('indicacionesArmado');
      expect(detalles(res)[0]?.mensaje).toContain('1000 caracteres');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('responde 400 VALIDATION_ERROR si contiene caracteres de control prohibidos (ej. tabulación)', async () => {
      const res = await request(app)
        .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
        .send({ indicacionesArmado: 'Texto con\ttabulación' });

      expect(res.status).toBe(400);
      expect(errorGenerico(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toContain('indicacionesArmado');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('responde 404 NOT_FOUND si el cliente no existe o tiene baja lógica', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
        .send({ indicacionesArmado: 'Texto de prueba' });

      expect(res.status).toBe(404);
      expect(errorGenerico(res).code).toBe('NOT_FOUND');
      expect(transaccion.cliente.update).not.toHaveBeenCalled();
    });

    it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
      'responde 409 CONFLICT (CLIENTE_NO_ACTIVO) si el cliente está %s',
      async (estado) => {
        transaccion.cliente.findFirst.mockResolvedValue({
          id: CLIENTE_ID,
          estado,
        });

        const res = await request(app)
          .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
          .send({ indicacionesArmado: 'Nuevo texto' });

        expect(res.status).toBe(409);
        expect(conflicto(res).code).toBe('CONFLICT');
        expect(conflicto(res).details).toEqual({
          motivo: 'CLIENTE_NO_ACTIVO',
          estado,
        });
        expect(transaccion.cliente.update).not.toHaveBeenCalled();
      },
    );

    it('guarda las indicaciones recortadas y admite saltos de línea cuando el cliente está ACTIVO', async () => {
      transaccion.cliente.findFirst.mockResolvedValue({
        id: CLIENTE_ID,
        estado: 'ACTIVO',
      });
      const texto = '  Factura primero.\nTodo en duplicado.  ';
      const textoEsperado = 'Factura primero.\nTodo en duplicado.';
      transaccion.cliente.update.mockResolvedValue({
        indicacionesArmado: textoEsperado,
      });

      const res = await request(app)
        .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
        .send({ indicacionesArmado: texto });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ indicacionesArmado: textoEsperado });
      expect(transaccion.cliente.update).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID },
        data: { indicacionesArmado: textoEsperado },
        select: { indicacionesArmado: true },
      });
    });

    it.each([
      ['null explícito', null],
      ['string vacío', ''],
      ['solo espacios', '   \n  '],
    ])('guarda null al enviar %s', async (_desc, valor) => {
      transaccion.cliente.findFirst.mockResolvedValue({
        id: CLIENTE_ID,
        estado: 'ACTIVO',
      });
      transaccion.cliente.update.mockResolvedValue({
        indicacionesArmado: null,
      });

      const res = await request(app)
        .put(`/clientes/${CLIENTE_ID}/indicaciones-armado`)
        .send({ indicacionesArmado: valor });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ indicacionesArmado: null });
      expect(transaccion.cliente.update).toHaveBeenCalledWith({
        where: { id: CLIENTE_ID },
        data: { indicacionesArmado: null },
        select: { indicacionesArmado: true },
      });
    });
  });
});
