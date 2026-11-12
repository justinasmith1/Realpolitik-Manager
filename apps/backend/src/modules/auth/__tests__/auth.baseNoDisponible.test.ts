// `/auth` con PostgreSQL caído. Sin mocks: el cliente de Prisma apunta a un puerto cerrado y Prisma
// lanza su error real de conexión. Nada concede acceso, nada se informa como credencial incorrecta
// y ninguna cookie válida se borra por una falla que no es de la sesión.

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { createApp as CrearApp } from '../../../app';
import type { NOMBRE_COOKIE_DE_SESION as NombreDeCookie } from '../cookieDeSesion';
import { generarTokenDeSesion } from '../tokenDeSesion';

const ORIGEN = 'http://localhost:5173';
const UUID_CUALQUIERA = '0b0b0b0b-0000-4000-8000-000000000001';
const URL_ORIGINAL = process.env.DATABASE_URL;
let app: ReturnType<typeof CrearApp>;
let cookie: typeof NombreDeCookie;

beforeAll(async () => {
  process.env.DATABASE_URL =
    'postgresql://nadie:nada@127.0.0.1:1/inexistente?schema=public&connect_timeout=2';
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  const { createApp } = await import('../../../app');
  ({ NOMBRE_COOKIE_DE_SESION: cookie } = await import('../cookieDeSesion'));
  app = createApp({ corsOrigins: [ORIGEN] });
});

afterAll(async () => {
  const { prisma } = await import('../../../lib/prisma');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (URL_ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = URL_ORIGINAL;
});

const setCookie = (res: request.Response) => res.headers['set-cookie'] as string[] | undefined;
type CuerpoDeError = { error: { code: string; message: string; details?: unknown } };
const errorDe = (res: request.Response) => (res.body as CuerpoDeError).error;
const SERVICIO_NO_DISPONIBLE = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
};

describe('/auth con la base caída', () => {
  it('login → 503 con Retry-After, sin cookie, y no cuenta como fallo (nunca llega al 429)', async () => {
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGEN)
        .send({ email: 'persona@ejemplo.example', password: 'contraseña del intento' });

      expect(res.status).toBe(503);
      expect(errorDe(res)).toMatchObject(SERVICIO_NO_DISPONIBLE);
      expect(res.headers['retry-after']).toBe('5');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(setCookie(res)).toBeUndefined();
    }
    // Cada intento espera el fallo real de conexión de Prisma: más que los 5 s por defecto.
  }, 30_000);

  it('consultar la sesión → 503 y NO borra la cookie', async () => {
    const res = await request(app)
      .get('/auth/sesion')
      .set('Cookie', `${cookie}=${generarTokenDeSesion().token}`);

    expect(res.status).toBe(503);
    expect(errorDe(res)).toMatchObject(SERVICIO_NO_DISPONIBLE);
    expect(setCookie(res)).toBeUndefined();
  });

  it('cerrar la sesión → 503 y NO borra la cookie (no se pudo confirmar la revocación)', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${cookie}=${generarTokenDeSesion().token}`);

    expect(res.status).toBe(503);
    expect(setCookie(res)).toBeUndefined();
  });

  it('cambiar la contraseña → 503 y NO borra la cookie (no se confirma ningún cambio)', async () => {
    const res = await request(app)
      .put('/auth/password')
      .set('Origin', ORIGEN)
      .set('Cookie', `${cookie}=${generarTokenDeSesion().token}`)
      .send({ actual: 'contraseña actual', nueva: 'una frase nueva y larga' });

    expect(res.status).toBe(503);
    expect(errorDe(res)).toMatchObject(SERVICIO_NO_DISPONIBLE);
    expect(setCookie(res)).toBeUndefined();
  });

  it.each([
    ['leer clientes', 'get', '/clientes'],
    ['crear un cliente', 'post', '/clientes'],
    ['ver una rendición', 'get', `/rendiciones/${UUID_CUALQUIERA}`],
  ] as const)(
    'API de negocio, %s → 503: no concede acceso ni borra la cookie',
    async (_caso, metodo, ruta) => {
      const res = await request(app)
        [metodo](ruta)
        .set('Origin', ORIGEN)
        .set('Cookie', `${cookie}=${generarTokenDeSesion().token}`)
        .send({});

      expect(res.status).toBe(503);
      expect(errorDe(res)).toMatchObject(SERVICIO_NO_DISPONIBLE);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(setCookie(res)).toBeUndefined();
    },
  );

  it('API de negocio sin cookie → 401 (no hace falta la base para negarlo)', async () => {
    expect((await request(app).get('/clientes')).status).toBe(401);
  });

  it('el error no expone el host ni detalles de Prisma', async () => {
    const res = await request(app)
      .get('/auth/sesion')
      .set('Cookie', `${cookie}=${generarTokenDeSesion().token}`);

    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|inexistente|prisma/i);
  });
});
