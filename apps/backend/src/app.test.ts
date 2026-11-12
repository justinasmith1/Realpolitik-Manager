import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp, LIMITE_CUERPO_JSON } from './app';

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

describe('GET /health', () => {
  it('responde OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('rutas inexistentes', () => {
  it('devuelven 404 con el formato de error', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
  });
});

describe('JSON mal formado', () => {
  it('devuelve 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"cuit": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos',
        details: [{ campo: 'body', mensaje: 'El JSON enviado está mal formado' }],
      },
    });
  });
});

describe('cuerpo demasiado grande', () => {
  // `100kb` de body-parser son 100 * 1024 bytes.
  const LIMITE = 100 * 1024;
  const cuerpoDe = (bytes: number) => {
    const envoltura = '{"razonSocial":""}';
    return `{"razonSocial":"${'x'.repeat(bytes - envoltura.length)}"}`;
  };

  it('declara el límite de 100kb', () => {
    expect(LIMITE_CUERPO_JSON).toBe('100kb');
  });

  it('pasado el límite responde 413 PAYLOAD_TOO_LARGE, sin detalles internos', async () => {
    const res = await request(app)
      .post('/clientes')
      .set('Content-Type', 'application/json')
      .send(cuerpoDe(LIMITE + 1));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'El cuerpo de la solicitud es demasiado grande',
      },
    });
  });

  it('justo en el límite el cuerpo se lee y sigue a la validación normal (400, no 413)', async () => {
    const res = await request(app)
      .post('/clientes')
      .set('Content-Type', 'application/json')
      .send(cuerpoDe(LIMITE));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('el JSON mal formado sigue siendo 400, no 413', async () => {
    const res = await request(app)
      .patch('/clientes/c3d4e5f6-a7b8-4901-8def-012345678901')
      .set('Content-Type', 'application/json')
      .send('{"razonSocial": ');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('CORS', () => {
  it('permite los orígenes configurados', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('no habilita otros orígenes', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://sitio-ajeno.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
