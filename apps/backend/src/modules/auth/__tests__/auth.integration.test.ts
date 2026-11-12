// `/auth` de punta a punta contra PostgreSQL REAL, con argon2 real: login, sesión, cierre, cookies,
// enumeración, fuerza bruta, concurrencia, saturación y CSRF.
//
// Determinismo sin esperas reales:
// - la protección del login recibe un reloj controlado;
// - la concurrencia y la saturación se fuerzan ocupando el `limiteDeHash` real con operaciones que
//   el test libera cuando quiere.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { SesionActual } from '@realpolitik/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { createApp as CrearApp } from '../../../app';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';
import type { limiteDeHash as LimiteDeHash } from '../limiteDeHash';
import { ProteccionDeLogin } from '../proteccionDeLogin';
import { generarTokenDeSesion } from '../tokenDeSesion';

const url = urlDeBaseDescartable();

const ORIGEN = 'http://localhost:5173';
const COOKIE = '__Host-rp_sesion';
const CONTRASENA = 'una frase de prueba para integración';
const MARCA = `testa${Date.now().toString(36)}`;

let prisma: PrismaClient;
let createApp: typeof CrearApp;
let limiteDeHash: typeof LimiteDeHash;
let hashDeContrasena: string;
let secuencia = 0;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  ({ createApp } = await import('../../../app'));
  ({ limiteDeHash } = await import('../limiteDeHash'));
  hashDeContrasena = await hashearContrasena(CONTRASENA);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (url === undefined) return;
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await prisma.$disconnect();
});

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Una app con su propia protección (y su reloj), para que los tests no compartan contadores. */
function nuevaApp() {
  const reloj = { ahora: Date.now() };
  const app = createApp({
    corsOrigins: [ORIGEN],
    proteccionDeLogin: new ProteccionDeLogin({ ahora: () => reloj.ahora }),
  });
  return { app, reloj };
}

async function crearUsuario(extra: { activo?: boolean; debeCambiarPassword?: boolean } = {}) {
  secuencia += 1;
  return prisma.usuario.create({
    data: {
      email: `${MARCA}-${secuencia}@ejemplo.example`,
      nombre: `Persona de prueba ${secuencia}`,
      rol: 'ADMINISTRATIVO',
      passwordHash: hashDeContrasena,
      passwordActualizadaEn: new Date(),
      activo: extra.activo ?? true,
      debeCambiarPassword: extra.debeCambiarPassword ?? false,
    },
  });
}

const login = (app: ReturnType<typeof CrearApp>, email: string, password = CONTRASENA) =>
  request(app).post('/auth/login').set('Origin', ORIGEN).send({ email, password });

type CuerpoDeError = { error: { code: string; message: string; details?: unknown } };
const errorDe = (res: request.Response) => (res.body as CuerpoDeError).error;
const usuarioDe = (res: request.Response) => (res.body as SesionActual).usuario;

const setCookie = (res: request.Response): string[] => {
  const valor = res.headers['set-cookie'] as string[] | string | undefined;
  return valor === undefined ? [] : ([] as string[]).concat(valor);
};

/** El token de la cookie de sesión emitida. */
function tokenDe(res: request.Response): string {
  const cookie = setCookie(res).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error('no se emitió la cookie de sesión');
  return cookie.slice(COOKIE.length + 1).split(';')[0] ?? '';
}

/** Ocupa `cantidad` lugares del límite de argon2 hasta que el test llame a `liberar`. */
function ocuparLimite(cantidad: number) {
  const pendientes: (() => void)[] = [];
  const operaciones = Array.from({ length: cantidad }, () =>
    limiteDeHash.ejecutar(() => new Promise<void>((resolve) => pendientes.push(resolve))),
  );
  return {
    async liberar() {
      let terminado = false;
      const fin = Promise.allSettled(operaciones).then(() => {
        terminado = true;
      });
      while (!terminado) {
        pendientes.splice(0).forEach((resolve) => resolve());
        await new Promise((resolve) => setImmediate(resolve));
      }
      await fin;
    },
  };
}

async function esperarHasta(condicion: () => boolean) {
  for (let i = 0; i < 300 && !condicion(); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(condicion()).toBe(true);
}

const CREDENCIALES_INVALIDAS = {
  error: {
    code: 'UNAUTHENTICATED',
    message: 'Email o contraseña incorrectos.',
    details: { motivo: 'CREDENCIALES_INVALIDAS' },
  },
};

describe.skipIf(url === undefined)('POST /auth/login', () => {
  it('con credenciales correctas: 200, cookie segura y solo datos públicos', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();

    const res = await login(app, `  ${usuario.email.toUpperCase()}  `);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: 'ADMINISTRATIVO',
        debeCambiarPassword: false,
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    const [cookie] = setCookie(res);
    expect(cookie).toMatch(
      new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict$`),
    );

    const token = tokenDe(res);
    const sesion = await prisma.sesion.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(sesion.usuarioId).toBe(usuario.id);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(sesion.tokenHash);
    expect(JSON.stringify(res.body)).not.toContain(usuario.passwordHash);
  });

  it('con contraseña temporal: entra, y la respuesta lo indica (debeCambiarPassword)', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: true });

    const res = await login(app, usuario.email);
    expect(res.status).toBe(200);
    expect(usuarioDe(res).debeCambiarPassword).toBe(true);

    const sesion = await request(app)
      .get('/auth/sesion')
      .set('Cookie', `${COOKIE}=${tokenDe(res)}`);
    expect(usuarioDe(sesion).debeCambiarPassword).toBe(true);
  });

  it('el cliente no puede imponer rol ni datos internos en el pedido', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();

    const res = await request(app).post('/auth/login').set('Origin', ORIGEN).send({
      email: usuario.email,
      password: CONTRASENA,
      rol: 'ADMINISTRADOR',
      debeCambiarPassword: false,
      usuarioId: 'x',
    });

    expect(res.status).toBe(200);
    expect(usuarioDe(res).rol).toBe('ADMINISTRATIVO');
  });

  describe('sin enumeración: la misma respuesta para los tres casos', () => {
    it.each([
      [
        'email inexistente',
        () => Promise.resolve({ email: `${MARCA}-nadie@ejemplo.example`, password: CONTRASENA }),
      ],
      [
        'contraseña incorrecta',
        async () => ({ email: (await crearUsuario()).email, password: 'otra frase incorrecta' }),
      ],
      [
        'cuenta desactivada (con la contraseña correcta)',
        async () => ({
          email: (await crearUsuario({ activo: false })).email,
          password: CONTRASENA,
        }),
      ],
    ])('%s → 401 CREDENCIALES_INVALIDAS, sin cookie ni sesión', async (_caso, datos) => {
      const { app } = nuevaApp();
      const { email, password } = await datos();
      const sesionesAntes = await prisma.sesion.count();

      const res = await login(app, email, password);

      expect(res.status).toBe(401);
      expect(res.body).toEqual(CREDENCIALES_INVALIDAS);
      expect(setCookie(res)).toEqual([]);
      expect(await prisma.sesion.count()).toBe(sesionesAntes);
    });

    it('un email inexistente también pasa por argon2 (espera su turno en el límite de hashes)', async () => {
      const { app } = nuevaApp();
      const ocupado = ocuparLimite(2);
      let resuelto = false;
      const pendiente = login(app, `${MARCA}-nadie2@ejemplo.example`).then((res) => {
        resuelto = true;
        return res;
      });

      await esperarHasta(() => limiteDeHash.enEspera === 1);
      expect(resuelto).toBe(false);
      await ocupado.liberar();

      expect((await pendiente).status).toBe(401);
    });
  });

  it('un login nuevo revoca la sesión que el navegador traía', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const primera = tokenDe(await login(app, usuario.email));

    const segunda = await login(app, usuario.email).set('Cookie', `${COOKIE}=${primera}`);

    expect(segunda.status).toBe(200);
    const vieja = await prisma.sesion.findUniqueOrThrow({ where: { tokenHash: sha256(primera) } });
    expect(vieja.revocadaEn).not.toBeNull();
    expect(
      (
        await request(app)
          .get('/auth/sesion')
          .set('Cookie', `${COOKIE}=${tokenDe(segunda)}`)
      ).status,
    ).toBe(200);
  });

  it('el registro de eventos no contiene contraseña, token, hash ni el email de un fallo', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const escritura = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await login(app, `${MARCA}-escrito@ejemplo.example`, 'contraseña escrita mal');
    const ok = await login(app, usuario.email);

    const registro = escritura.mock.calls.map(([texto]) => String(texto)).join('\n');
    expect(registro).toContain('"evento":"auth.login.fallo"');
    expect(registro).toContain('"evento":"auth.login.ok"');
    for (const secreto of [
      'contraseña escrita mal',
      CONTRASENA,
      `${MARCA}-escrito`,
      tokenDe(ok),
      usuario.passwordHash,
    ]) {
      expect(registro).not.toContain(secreto);
    }
  });

  it('desde un origen ajeno: 403 y no crea ninguna sesión (login CSRF)', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();

    const res = await request(app)
      .post('/auth/login')
      .set('Origin', 'https://sitio-ajeno.example')
      .send({ email: usuario.email, password: CONTRASENA });

    expect(res.status).toBe(403);
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(0);
  });
});

describe.skipIf(url === undefined)('GET /auth/sesion', () => {
  it('con la cookie devuelve el usuario vigente; un cambio de rol se ve enseguida', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const token = tokenDe(await login(app, usuario.email));

    const antes = await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { rol: 'CONSULTA' } });
    const despues = await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`);

    expect(antes.status).toBe(200);
    expect(usuarioDe(antes).rol).toBe('ADMINISTRATIVO');
    expect(usuarioDe(despues).rol).toBe('CONSULTA');
    expect(despues.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['vencida por duración', { expiraEn: new Date(Date.now() - 1000) }, 'SESION_VENCIDA'],
    [
      'vencida por inactividad',
      { ultimaActividadEn: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      'SESION_VENCIDA',
    ],
    ['revocada', { revocadaEn: new Date() }, 'SESION_REQUERIDA'],
  ])('%s → 401 %s y borra la cookie', async (_caso, cambio, motivo) => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const token = tokenDe(await login(app, usuario.email));
    // Fechas coherentes con el CHECK: el inicio se corre hacia atrás junto con lo que vence.
    await prisma.sesion.update({
      where: { tokenHash: sha256(token) },
      data: { createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000), ...cambio },
    });

    const res = await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo });
    expect(setCookie(res)[0]).toMatch(new RegExp(`^${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));
  });

  it('con la cuenta desactivada → 401 SESION_REQUERIDA', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const token = tokenDe(await login(app, usuario.email));
    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

    const res = await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
  });

  it('con un token inventado → 401 SESION_REQUERIDA', async () => {
    const { app } = nuevaApp();

    const res = await request(app)
      .get('/auth/sesion')
      .set('Cookie', `${COOKIE}=${generarTokenDeSesion().token}`);

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
  });
});

describe.skipIf(url === undefined)('POST /auth/logout', () => {
  it('revoca la sesión en la base, borra la cookie y la cookie vieja deja de servir', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const token = tokenDe(await login(app, usuario.email));

    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(204);
    expect(setCookie(res)[0]).toMatch(new RegExp(`^${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));
    expect(
      (await prisma.sesion.findUniqueOrThrow({ where: { tokenHash: sha256(token) } })).revocadaEn,
    ).not.toBeNull();
    expect(
      (await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`)).status,
    ).toBe(401);

    const repetido = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${COOKIE}=${token}`);
    expect(repetido.status).toBe(204);
  });

  it('no afecta las sesiones del mismo usuario en otros dispositivos', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const uno = tokenDe(await login(app, usuario.email));
    const otro = tokenDe(await login(app, usuario.email));

    await request(app).post('/auth/logout').set('Origin', ORIGEN).set('Cookie', `${COOKIE}=${uno}`);

    expect((await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${otro}`)).status).toBe(
      200,
    );
  });

  it('desde un origen ajeno: 403 y la sesión sigue vigente', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const token = tokenDe(await login(app, usuario.email));

    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', 'https://sitio-ajeno.example')
      .set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(403);
    expect(
      (await request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`)).status,
    ).toBe(200);
  });
});

describe.skipIf(url === undefined)('protección contra fuerza bruta', () => {
  it('desde el 5.º fallo, la cuenta espera 30 s: ni la contraseña correcta se verifica durante la espera', async () => {
    const { app, reloj } = nuevaApp();
    const usuario = await crearUsuario();
    for (let i = 0; i < 5; i += 1)
      expect((await login(app, usuario.email, 'incorrecta')).status).toBe(401);

    const bloqueado = await login(app, usuario.email);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers['retry-after']).toBe('30');
    expect(bloqueado.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Demasiados intentos. Probá de nuevo en 30 segundos.',
        details: { motivo: 'DEMASIADOS_INTENTOS' },
      },
    });
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(0);

    reloj.ahora += 30_000;
    expect((await login(app, usuario.email)).status).toBe(200);
  });

  it('20 fallos desde la misma IP la frenan para cualquier cuenta', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    for (let i = 0; i < 20; i += 1) {
      expect((await login(app, `${MARCA}-ip${i}@ejemplo.example`, 'incorrecta')).status).toBe(401);
    }

    const res = await login(app, usuario.email);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('900');
    expect(errorDe(res)).toMatchObject({
      message: 'Demasiados intentos. Probá de nuevo en 15 minutos.',
      details: { motivo: 'DEMASIADOS_INTENTOS' },
    });
  });

  it('un segundo intento simultáneo de la misma cuenta → 429 sin calcular', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const ocupado = ocuparLimite(2);
    const primero = login(app, usuario.email).then((res) => res);
    await esperarHasta(() => limiteDeHash.enEspera === 1);

    const segundo = await login(app, usuario.email);

    expect(segundo.status).toBe(429);
    expect(segundo.headers['retry-after']).toBe('1');
    // Código, mensaje, Retry-After y regla dicen lo mismo: hay otro intento en curso, no una sanción.
    expect(segundo.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message:
          'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.',
        details: { motivo: 'INTENTO_EN_CURSO' },
      },
    });
    await ocupado.liberar();
    expect((await primero).status).toBe(200);
  });

  it('con argon2 saturado → 503 con Retry-After, y no cuenta como fallo', async () => {
    const { app } = nuevaApp();
    const usuario = await crearUsuario();
    const ocupado = ocuparLimite(10);

    const intentos = [];
    for (let i = 0; i < 6; i += 1) intentos.push(await login(app, usuario.email));
    await ocupado.liberar();

    for (const res of intentos) {
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(errorDe(res).code).toBe('SERVICE_UNAVAILABLE');
    }
    expect((await login(app, usuario.email)).status).toBe(200);
  });
});
