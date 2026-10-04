import express, { json, type Express, type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { conflict } from '../errors/app-error';

import { errorHandler } from './error-handler';
import { notFoundHandler } from './not-found';
import { validate, type ValidatedLocals } from './validate';

const schemas = {
  body: z.object({
    cuit: z.string().min(11, 'El CUIT ingresado no es válido'),
    periodicidad: z.object({ diaLimite: z.number().int() }),
  }),
  params: z.object({ id: z.string().uuid() }),
};

/** App mínima con rutas de prueba, para ejercitar los middlewares de forma aislada. */
function buildApp(): Express {
  const app = express();
  app.use(json());

  // Así lee un handler futuro los datos validados, con tipos y sin casts.
  app.post(
    '/probar/:id',
    validate(schemas),
    (_req, res: Response<unknown, ValidatedLocals<typeof schemas>>) => {
      const { body, params } = res.locals.validated;
      res.json({ id: params.id, cuit: body.cuit, dia: body.periodicidad.diaLimite });
    },
  );
  app.get('/conflicto', () => {
    throw conflict('CUIT_DUPLICADO', { clienteExistente: { id: 'abc' } });
  });
  app.get('/conflicto-email', () => {
    throw conflict('EMAIL_DUPLICADO', { contactoExistente: { id: 'def' } });
  });
  app.get('/roto', async () => {
    await Promise.resolve();
    throw new Error('SELECT * FROM clientes WHERE cuit = 20123456786 falló en C:/secreto/db.ts');
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const id = '3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a2b';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validate', () => {
  it('deja los datos parseados a disposición del handler', async () => {
    const res = await request(buildApp())
      .post(`/probar/${id}`)
      .send({ cuit: '20123456786', periodicidad: { diaLimite: 10 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, cuit: '20123456786', dia: 10 });
  });

  it('devuelve 400 con el formato exacto y campos en notación de puntos', async () => {
    const res = await request(buildApp())
      .post('/probar/no-es-uuid')
      .send({ cuit: '123', periodicidad: { diaLimite: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos',
        details: [
          { campo: 'cuit', mensaje: 'El CUIT ingresado no es válido' },
          { campo: 'periodicidad.diaLimite', mensaje: 'Expected number, received string' },
          { campo: 'id', mensaje: 'Invalid uuid' },
        ],
      },
    });
  });

  it('usa el nombre del origen cuando falla el objeto completo', async () => {
    const res = await request(buildApp()).post(`/probar/${id}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { details: [{ campo: 'body', mensaje: 'Required' }] },
    });
  });
});

describe('manejo de errores', () => {
  it('traduce CONFLICT a 409 con la clave que elige el endpoint', async () => {
    const cuit = await request(buildApp()).get('/conflicto');
    expect(cuit.status).toBe(409);
    expect(cuit.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Conflicto con datos existentes',
        details: { motivo: 'CUIT_DUPLICADO', clienteExistente: { id: 'abc' } },
      },
    });

    const email = await request(buildApp()).get('/conflicto-email');
    expect(email.status).toBe(409);
    expect(email.body).toMatchObject({
      error: { details: { motivo: 'EMAIL_DUPLICADO', contactoExistente: { id: 'def' } } },
    });
  });

  it('devuelve 500 genérico sin filtrar detalles ni registrarlos', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(buildApp()).get('/roto');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|secreto|20123456786/);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SELECT|secreto|20123456786/);
  });
});
