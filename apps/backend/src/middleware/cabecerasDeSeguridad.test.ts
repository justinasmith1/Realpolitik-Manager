// Las cabeceras de seguridad están en TODAS las respuestas de la API, también en los errores y los
// preflight, sin cambiar el estado, el cuerpo ni `Cache-Control` de cada respuesta.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app';
import { clienteDePrueba, ORIGEN_DE_PRUEBA } from '../modules/auth/__tests__/sesionSimulada';

// Solo la tabla de sesiones, simulada: estos tests no llegan a ninguna otra.
vi.mock('../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('../modules/auth/__tests__/sesionSimulada');
  return { prisma: conSesionesSimuladas({}) };
});

const app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA] });

const ESPERADAS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
};

describe('cabeceras de seguridad de la API', () => {
  it.each([
    ['GET /health (pública)', () => request(app).get('/health'), 200, { status: 'ok' }],
    [
      'una ruta protegida sin sesión (401)',
      () => request(app).get('/clientes'),
      401,
      { error: { details: { motivo: 'SESION_REQUERIDA' } } },
    ],
    [
      'una ruta inexistente con sesión (404)',
      () => clienteDePrueba(app).get('/no-existe'),
      404,
      { error: { code: 'NOT_FOUND' } },
    ],
    [
      'una escritura sin Origin (403)',
      () => request(app).post('/auth/logout'),
      403,
      { error: { code: 'FORBIDDEN' } },
    ],
    [
      'un login con datos inválidos (400)',
      () => request(app).post('/auth/login').set('Origin', ORIGEN_DE_PRUEBA).send({}),
      400,
      { error: { code: 'VALIDATION_ERROR' } },
    ],
  ] as const)('%s: las lleva y conserva su contrato', async (_caso, pedir, estado, cuerpo) => {
    const res = await pedir();

    expect(res.status).toBe(estado);
    expect(res.body).toMatchObject(cuerpo);
    expect(res.headers).toMatchObject({ ...ESPERADAS, 'cache-control': 'no-store' });
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('el preflight de CORS las lleva y sigue siendo 204 con el origen permitido', async () => {
    const res = await request(app)
      .options('/clientes')
      .set('Origin', ORIGEN_DE_PRUEBA)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEN_DE_PRUEBA);
    expect(res.headers).toMatchObject(ESPERADAS);
  });

  it('no expone el framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
