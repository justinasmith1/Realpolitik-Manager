import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';

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
