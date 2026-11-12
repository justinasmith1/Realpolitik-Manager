// `PUT /auth/password` (cambio obligatorio del primer acceso) y el reemplazo de sesión del login,
// de punta a punta contra PostgreSQL REAL y argon2 real. Sin mocks de la base.
//
// Las fallas y las carreras se fuerzan con bloqueos de fila reales: otra conexión retiene una fila
// que la transacción bajo prueba necesita, el test espera a verla bloqueada en `pg_stat_activity` y
// entonces la libera o termina esa conexión (`pg_terminate_backend`, la misma falla que un reinicio
// de PostgreSQL a mitad de la transacción).
//
// Solo corre contra una base descartable (`*_test` o `*_audit`) y, además, LOCAL.

import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import {
  MENSAJE_CONTRASENA_PREVISIBLE,
  MENSAJE_CONTRASENA_REPETIDA,
  type SesionActual,
} from '@realpolitik/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { createApp as CrearApp } from '../../../app';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena, verificarContrasena } from '../contrasenas';
import { ProteccionDeLogin } from '../proteccionDeLogin';

const url = urlDeBaseDescartable();
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', 'db']);
if (url !== undefined && !HOSTS_LOCALES.has(new URL(url).hostname)) {
  throw new Error('Estas pruebas terminan conexiones de PostgreSQL: solo contra una base local.');
}

const ORIGEN = 'http://localhost:5173';
const COOKIE = '__Host-rp_sesion';
const COOKIE_BORRADA = `${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
/** Contraseña temporal de las cuentas de prueba (larga, para probar también su reutilización). */
const TEMPORAL = 'temporal-0042-provisoria';
const NUEVA = 'una frase nueva para el primer acceso';
const MARCA = `testc${Date.now().toString(36)}`;

let prisma: PrismaClient;
/** Segunda conexión, para retener bloqueos y terminar conexiones como lo haría otro proceso. */
let otraConexion: PrismaClient;
let createApp: typeof CrearApp;
let hashTemporal: string;
let secuencia = 0;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  ({ createApp } = await import('../../../app'));
  otraConexion = new PrismaClient({ datasources: { db: { url } } });
  hashTemporal = await hashearContrasena(TEMPORAL);
});

afterAll(async () => {
  if (url === undefined) return;
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await prisma.$disconnect();
  await otraConexion.$disconnect();
});

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Cada app tiene su propia protección: como dos instancias del backend. */
const nuevaApp = () =>
  createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: new ProteccionDeLogin() });

async function crearUsuario(extra: { debeCambiarPassword?: boolean } = {}) {
  secuencia += 1;
  return prisma.usuario.create({
    data: {
      email: `${MARCA}-${secuencia}@ejemplo.example`,
      nombre: `Persona de prueba ${secuencia}`,
      rol: 'ADMINISTRATIVO',
      passwordHash: hashTemporal,
      passwordActualizadaEn: new Date('2026-01-01T00:00:00Z'),
      debeCambiarPassword: extra.debeCambiarPassword ?? true,
    },
  });
}

const setCookie = (res: request.Response): string[] => {
  const valor = res.headers['set-cookie'] as string[] | string | undefined;
  return valor === undefined ? [] : ([] as string[]).concat(valor);
};

function tokenDe(res: request.Response): string {
  const cookie = setCookie(res).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error('no se emitió la cookie de sesión');
  return cookie.slice(COOKIE.length + 1).split(';')[0] ?? '';
}

type CuerpoDeError = { error: { code: string; message: string; details?: unknown } };
const errorDe = (res: request.Response) => (res.body as CuerpoDeError).error;

const login = (app: ReturnType<typeof CrearApp>, email: string, password = TEMPORAL) =>
  request(app).post('/auth/login').set('Origin', ORIGEN).send({ email, password });

async function iniciarSesion(app: ReturnType<typeof CrearApp>, email: string) {
  const res = await login(app, email);
  expect(res.status).toBe(200);
  return tokenDe(res);
}

const cambiar = (app: ReturnType<typeof CrearApp>, token: string | undefined, cuerpo: object) => {
  const pedido = request(app).put('/auth/password').set('Origin', ORIGEN);
  if (token !== undefined) pedido.set('Cookie', `${COOKIE}=${token}`);
  return pedido.send(cuerpo);
};

const consultarSesion = (app: ReturnType<typeof CrearApp>, token: string) =>
  request(app).get('/auth/sesion').set('Cookie', `${COOKIE}=${token}`);

const sesionDe = (token: string) =>
  prisma.sesion.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });

const vigentes = (usuarioId: string) =>
  prisma.sesion.count({
    where: { usuarioId, revocadaEn: null, expiraEn: { gt: new Date() } },
  });

/** Estado persistente de la contraseña, para comprobar que un fallo no cambió nada. */
const credencialDe = (id: string) =>
  prisma.usuario.findUniqueOrThrow({
    where: { id },
    select: { passwordHash: true, debeCambiarPassword: true, passwordActualizadaEn: true },
  });

/** Retiene `FOR UPDATE` sobre una sesión desde la otra conexión hasta que el test la suelte. */
async function retenerSesion(sesionId: string) {
  let soltar!: () => void;
  const suelta = new Promise<void>((resolve) => (soltar = resolve));
  let tomada!: () => void;
  const lista = new Promise<void>((resolve) => (tomada = resolve));
  const transaccion = otraConexion.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Sesion" WHERE "id" = ${sesionId}::uuid FOR UPDATE`;
      tomada();
      await suelta;
    },
    { timeout: 60_000 },
  );
  await lista;
  return {
    async soltar() {
      soltar();
      await transaccion;
    },
  };
}

/** PIDs de conexiones que esperan un bloqueo con una consulta que contiene `fragmento`. */
async function bloqueadas(fragmento: string): Promise<number[]> {
  const filas = await otraConexion.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND query LIKE ${`%${fragmento}%`}`;
  return filas.map((fila) => fila.pid);
}

async function esperarBloqueada(fragmento: string): Promise<number> {
  for (let i = 0; i < 500; i += 1) {
    const [pid] = await bloqueadas(fragmento);
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`ninguna conexión quedó esperando en: ${fragmento}`);
}

const REVOCACION = 'UPDATE "Sesion"';
const BLOQUEO_DE_USUARIO = 'FROM "Usuario" WHERE "id" =';

describe.skipIf(url === undefined)('PUT /auth/password: primer acceso', () => {
  it('login y sesión informan debeCambiarPassword; el cambio la apaga, revoca todo y exige volver a entrar', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: true });

    const entrada = await login(app, usuario.email);
    expect(entrada.status).toBe(200);
    expect((entrada.body as SesionActual).usuario.debeCambiarPassword).toBe(true);
    const token = tokenDe(entrada);
    const consulta = await consultarSesion(app, token);
    expect((consulta.body as SesionActual).usuario.debeCambiarPassword).toBe(true);
    // Otras sesiones del mismo usuario (otro navegador, otra pestaña).
    const otras = [
      await iniciarSesion(app, usuario.email),
      await iniciarSesion(app, usuario.email),
    ];

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);

    const guardado = await credencialDe(usuario.id);
    expect(guardado.debeCambiarPassword).toBe(false);
    expect(guardado.passwordActualizadaEn.getTime()).toBeGreaterThan(
      usuario.passwordActualizadaEn.getTime(),
    );
    expect(guardado.passwordHash).not.toBe(hashTemporal);
    expect(await verificarContrasena(guardado.passwordHash, NUEVA)).toBe(true);

    expect(await vigentes(usuario.id)).toBe(0);
    for (const t of [token, ...otras]) {
      expect((await sesionDe(t)).revocadaEn).not.toBeNull();
      expect((await consultarSesion(app, t)).status).toBe(401);
    }

    expect((await login(app, usuario.email)).status).toBe(401);
    const conLaNueva = await login(app, usuario.email, NUEVA);
    expect(conLaNueva.status).toBe(200);
    expect((conLaNueva.body as SesionActual).usuario.debeCambiarPassword).toBe(false);
  });

  it('una cuenta con cambio obligatorio puede cerrar sesión', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: true });
    const token = await iniciarSesion(app, usuario.email);

    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(204);
    expect((await sesionDe(token)).revocadaEn).not.toBeNull();
  });

  it('también sirve sin cambio obligatorio (diseñado para reutilizarse en HU4.2)', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);

    expect((await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA })).status).toBe(204);
    expect((await credencialDe(usuario.id)).debeCambiarPassword).toBe(false);
  });
});

describe.skipIf(url === undefined)('PUT /auth/password: rechazos sin efectos', () => {
  async function preparar() {
    const app = nuevaApp();
    const usuario = await crearUsuario();
    const token = await iniciarSesion(app, usuario.email);
    return { app, usuario, token, antes: await credencialDe(usuario.id) };
  }

  async function nadaCambio(usuarioId: string, antes: object, token: string) {
    expect(await credencialDe(usuarioId)).toEqual(antes);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
  }

  it('contraseña actual incorrecta → 400 en `actual` (nunca 401), la cookie y la sesión siguen', async () => {
    const { app, usuario, token, antes } = await preparar();

    const res = await cambiar(app, token, { actual: 'no-es-la-temporal', nueva: NUEVA });

    expect(res.status).toBe(400);
    expect(errorDe(res)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos',
      details: [{ campo: 'actual', mensaje: 'La contraseña actual no es correcta.' }],
    });
    expect(setCookie(res)).toEqual([]);
    await nadaCambio(usuario.id, antes, token);
    expect((await consultarSesion(app, token)).status).toBe(200);
  });

  it('la contraseña actual incorrecta cuenta para la demora por cuenta (la misma del login)', async () => {
    const { app, usuario, token, antes } = await preparar();
    for (let i = 0; i < 5; i += 1) {
      expect((await cambiar(app, token, { actual: `incorrecta-${i}`, nueva: NUEVA })).status).toBe(
        400,
      );
    }

    const conLaCorrecta = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(conLaCorrecta.status).toBe(429);
    expect(conLaCorrecta.headers['retry-after']).toBe('30');
    expect(errorDe(conLaCorrecta)).toMatchObject({
      message: 'Demasiados intentos. Probá de nuevo en 30 segundos.',
      details: { motivo: 'DEMASIADOS_INTENTOS' },
    });
    expect((await login(app, usuario.email)).status).toBe(429);
    await nadaCambio(usuario.id, antes, token);
  });

  it.each([
    ['corta', 'corta', 'La contraseña tiene que tener al menos 8 caracteres.'],
    ['común (lista de bloqueo)', '0011223344556677', MENSAJE_CONTRASENA_PREVISIBLE],
    ['derivada del nombre de la persona', 'Persona 2026 !!!!!', MENSAJE_CONTRASENA_PREVISIBLE],
    ['igual a la actual', TEMPORAL, MENSAJE_CONTRASENA_REPETIDA],
  ])('nueva %s → 400 en `nueva`', async (_caso, nueva, mensaje) => {
    const { app, usuario, token, antes } = await preparar();

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva });

    expect(res.status).toBe(400);
    expect(errorDe(res).details).toEqual([{ campo: 'nueva', mensaje }]);
    await nadaCambio(usuario.id, antes, token);
  });

  it('el cuerpo no puede apagar el indicador de primer acceso', async () => {
    const { app, usuario, token, antes } = await preparar();

    const res = await cambiar(app, token, {
      actual: 'incorrecta',
      nueva: NUEVA,
      debeCambiarPassword: false,
    });

    expect(res.status).toBe(400);
    await nadaCambio(usuario.id, antes, token);
  });

  it('sin sesión → 401, antes de mirar el cuerpo', async () => {
    const app = nuevaApp();

    const res = await cambiar(app, undefined, { nueva: 'x' });

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
  });

  it('sesión inexistente (token con forma válida pero desconocido) → 401 y borra la cookie', async () => {
    const app = nuevaApp();

    const res = await cambiar(app, 'A'.repeat(43), { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(401);
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
  });

  it.each([
    ['revocada', () => ({ revocadaEn: new Date() }), 'SESION_REQUERIDA'],
    [
      'vencida por duración',
      // Movida entera al pasado: ck_sesion_fechas_coherentes exige expiraEn > createdAt.
      () => {
        const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
        return { createdAt: hace(8), ultimaActividadEn: hace(8), expiraEn: hace(1) };
      },
      'SESION_VENCIDA',
    ],
  ])('sesión %s → 401 %s, borra la cookie y no cambia nada', async (_caso, fechas, motivo) => {
    const { app, usuario, token, antes } = await preparar();
    await prisma.sesion.update({ where: { tokenHash: sha256(token) }, data: fechas() });

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo });
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
  });

  it('cuenta desactivada → 401, borra la cookie y no cambia nada', async () => {
    const { app, usuario, token, antes } = await preparar();
    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(despues.passwordHash).toBe(antes.passwordHash);
    expect(despues.debeCambiarPassword).toBe(true);
  });

  it('desde un origen ajeno → 403 y no cambia nada', async () => {
    const { app, usuario, token, antes } = await preparar();

    const res = await request(app)
      .put('/auth/password')
      .set('Origin', 'https://sitio-ajeno.example')
      .set('Cookie', `${COOKIE}=${token}`)
      .send({ actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(403);
    await nadaCambio(usuario.id, antes, token);
  });
});

describe.skipIf(url === undefined)('PUT /auth/password: atomicidad y concurrencia', () => {
  it('si PostgreSQL corta la transacción después de guardar el hash: 503, nada persiste y la cookie sigue', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario();
    const token = await iniciarSesion(app, usuario.email);
    const otra = await iniciarSesion(app, usuario.email);
    const antes = await credencialDe(usuario.id);
    // La revocación (último paso, después de actualizar el usuario) queda esperando esta fila.
    const retenida = await retenerSesion((await sesionDe(otra)).id);

    const pendiente = cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA }).then((res) => res);
    const pid = await esperarBloqueada(REVOCACION);
    await otraConexion.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
    const res = await pendiente;
    await retenida.soltar();

    expect(res.status).toBe(503);
    expect(errorDe(res).code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|Sesion|Usuario|terminat|prisma/i);
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
    expect((await sesionDe(otra)).revocadaEn).toBeNull();
    expect((await consultarSesion(app, token)).status).toBe(200);
    // Se puede reintentar.
    expect((await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA })).status).toBe(204);
  });

  it('un login con la contraseña vieja que espera el bloqueo del usuario no crea una sesión', async () => {
    const appDelCambio = nuevaApp();
    const appDelLogin = nuevaApp(); // otra instancia: no comparte la protección en memoria
    const usuario = await crearUsuario();
    const token = await iniciarSesion(appDelCambio, usuario.email);
    const otra = await iniciarSesion(appDelCambio, usuario.email);
    const retenida = await retenerSesion((await sesionDe(otra)).id);

    // 1. El cambio toma el bloqueo del usuario y espera en la revocación.
    const cambio = cambiar(appDelCambio, token, { actual: TEMPORAL, nueva: NUEVA }).then((r) => r);
    await esperarBloqueada(REVOCACION);
    // 2. El login lee el hash viejo, lo verifica y espera el bloqueo del usuario en `crearSesion`.
    const entrada = login(appDelLogin, usuario.email, TEMPORAL).then((r) => r);
    await esperarBloqueada(BLOQUEO_DE_USUARIO);
    // 3. El cambio confirma; el login encuentra otro hash.
    await retenida.soltar();

    expect((await cambio).status).toBe(204);
    const resLogin = await entrada;
    expect(resLogin.status).toBe(401);
    expect(errorDe(resLogin).details).toEqual({ motivo: 'CREDENCIALES_INVALIDAS' });
    expect(setCookie(resLogin)).toEqual([]);
    expect(await vigentes(usuario.id)).toBe(0);
    expect((await login(appDelLogin, usuario.email, NUEVA)).status).toBe(200);
  });

  it('dos cambios simultáneos desde dos sesiones: uno gana, el otro no deja nada a medias', async () => {
    const usuario = await crearUsuario();
    const a = nuevaApp();
    const b = nuevaApp();
    const tokenA = await iniciarSesion(a, usuario.email);
    const tokenB = await iniciarSesion(b, usuario.email);

    const respuestas = await Promise.all([
      cambiar(a, tokenA, { actual: TEMPORAL, nueva: `${NUEVA} A` }),
      cambiar(b, tokenB, { actual: TEMPORAL, nueva: `${NUEVA} B` }),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([204, 401]);
    const { passwordHash } = await credencialDe(usuario.id);
    const ganadora = respuestas[0]?.status === 204 ? `${NUEVA} A` : `${NUEVA} B`;
    const perdedora = ganadora === `${NUEVA} A` ? `${NUEVA} B` : `${NUEVA} A`;
    expect(await verificarContrasena(passwordHash, ganadora)).toBe(true);
    expect(await verificarContrasena(passwordHash, perdedora)).toBe(false);
    expect(await vigentes(usuario.id)).toBe(0);
  });

  it('dos cambios simultáneos en la misma instancia: el segundo espera su turno (429 INTENTO_EN_CURSO)', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario();
    const tokenA = await iniciarSesion(app, usuario.email);
    const tokenB = await iniciarSesion(app, usuario.email);

    const [primero, segundo] = await Promise.all([
      cambiar(app, tokenA, { actual: TEMPORAL, nueva: `${NUEVA} A` }),
      cambiar(app, tokenB, { actual: TEMPORAL, nueva: `${NUEVA} B` }),
    ]);

    const estados = [primero.status, segundo.status].sort();
    // El segundo llega mientras el primero calcula (429) o después de que revocó todo (401).
    expect(estados[0]).toBe(204);
    expect([401, 429]).toContain(estados[1]);
    const limitado = [primero, segundo].find((r) => r.status === 429);
    if (limitado) {
      expect(limitado.headers['retry-after']).toBe('1');
      expect(errorDe(limitado).details).toEqual({ motivo: 'INTENTO_EN_CURSO' });
    }
    expect(await vigentes(usuario.id)).toBe(0);
  });
});

describe.skipIf(url === undefined)('POST /auth/login: reemplazo de la sesión anterior', () => {
  it('con credenciales incorrectas, la sesión anterior sigue vigente y la cookie no se toca', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);

    const res = await login(app, usuario.email, 'incorrecta').set('Cookie', `${COOKIE}=${token}`);

    expect(res.status).toBe(401);
    expect(setCookie(res)).toEqual([]);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
    expect((await consultarSesion(app, token)).status).toBe(200);
  });

  it('con un email inexistente, tampoco', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);

    const res = await login(app, `${MARCA}-nadie@ejemplo.example`).set(
      'Cookie',
      `${COOKIE}=${token}`,
    );

    expect(res.status).toBe(401);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
  });

  it('si la base falla durante el reemplazo: 503, ni sesión nueva ni vieja revocada', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);
    const retenida = await retenerSesion((await sesionDe(token)).id);

    const pendiente = login(app, usuario.email)
      .set('Cookie', `${COOKIE}=${token}`)
      .then((r) => r);
    const pid = await esperarBloqueada(REVOCACION);
    await otraConexion.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
    const res = await pendiente;
    await retenida.soltar();

    expect(res.status).toBe(503);
    expect(setCookie(res)).toEqual([]);
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(1);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
    expect((await consultarSesion(app, token)).status).toBe(200);
  });

  it('dos logins simultáneos que reemplazan la misma cookie: ambos entran y la vieja se revoca una vez', async () => {
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const a = nuevaApp();
    const b = nuevaApp();
    const token = await iniciarSesion(a, usuario.email);
    const revocadaEn = async () => (await sesionDe(token)).revocadaEn;

    const respuestas = await Promise.all([
      login(a, usuario.email).set('Cookie', `${COOKIE}=${token}`),
      login(b, usuario.email).set('Cookie', `${COOKIE}=${token}`),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
    expect(await revocadaEn()).not.toBeNull();
    for (const r of respuestas) expect((await consultarSesion(a, tokenDe(r))).status).toBe(200);
    expect(await vigentes(usuario.id)).toBe(2);
  });
});
