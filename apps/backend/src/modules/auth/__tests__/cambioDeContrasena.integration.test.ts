// `PUT /auth/password` (cambio obligatorio del primer acceso, HU4.1, y cambio voluntario con
// rotación de sesión, HU4.2) y el reemplazo de sesión del login, de punta a punta contra PostgreSQL
// REAL y argon2 real. Sin mocks de la base.
//
// Las fallas y las carreras se fuerzan con bloqueos de fila reales: otra conexión retiene una fila
// que la transacción bajo prueba necesita, el test espera a verla bloqueada en `pg_stat_activity` y
// entonces la libera, confirma otra operación primero o termina esa conexión
// (`pg_terminate_backend`, la misma falla que un reinicio de PostgreSQL a mitad de la transacción).
// La falla AL CONFIRMAR se fuerza con un trigger de restricción diferido, temporal y limitado al
// usuario de la prueba, que se borra al terminar.
//
// Solo corre contra una base descartable (`*_test` o `*_audit`) y, además, LOCAL.

import { createHash } from 'node:crypto';

import { type Prisma, PrismaClient } from '@prisma/client';
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
import { generarTokenDeSesion } from '../tokenDeSesion';

const url = urlDeBaseDescartable();
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', 'db']);
if (url !== undefined && !HOSTS_LOCALES.has(new URL(url).hostname)) {
  throw new Error('Estas pruebas terminan conexiones de PostgreSQL: solo contra una base local.');
}

const ORIGEN = 'http://localhost:5173';
const COOKIE = '__Host-rp_sesion';
const COOKIE_BORRADA = `${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
/** La cookie de una sesión rotada: los mismos atributos que la del login, sin Max-Age ni Expires. */
const COOKIE_ROTADA = new RegExp(
  `^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict$`,
);
const DIA_MS = 86_400_000;
/** Contraseña temporal de las cuentas de prueba (larga, para probar también su reutilización). */
const TEMPORAL = 'temporal-0042-provisoria';
const NUEVA = 'una frase nueva para el primer acceso';
const MARCA = `testc${Date.now().toString(36)}`;

let prisma: PrismaClient;
/** Segunda conexión, para retener bloqueos y terminar conexiones como lo haría otro proceso. */
let otraConexion: PrismaClient;
let createApp: typeof CrearApp;
let LIMITE_DE_SESIONES_VIGENTES: number;
let hashTemporal: string;
let secuencia = 0;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  ({ createApp } = await import('../../../app'));
  ({ LIMITE_DE_SESIONES_VIGENTES } = await import('../sesiones.service'));
  otraConexion = new PrismaClient({ datasources: { db: { url } } });
  hashTemporal = await hashearContrasena(TEMPORAL);
});

afterAll(async () => {
  if (url === undefined) return;
  await quitarFallaAlConfirmar(); // por si un test se cortó antes de quitarla
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await prisma.$disconnect();
  await otraConexion.$disconnect();
});

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Cada app tiene su propia protección: como dos instancias del backend. */
const nuevaApp = () =>
  createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: new ProteccionDeLogin() });

/** La app junto con su protección en memoria, para comprobar que una falla no cuenta un intento. */
function nuevaAppConProteccion() {
  const proteccion = new ProteccionDeLogin();
  return { app: createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: proteccion }), proteccion };
}

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

type OperacionConcurrente = (tx: Prisma.TransactionClient) => Promise<unknown>;

/**
 * Retiene `FOR UPDATE` sobre la fila del usuario desde la otra conexión, como lo haría otra
 * operación sobre la cuenta. Al soltarla puede correr `primero` en esa misma transacción (una
 * desactivación, un restablecimiento…), que así se confirma ANTES de que siga quien esperaba.
 */
async function retenerUsuario(usuarioId: string) {
  let soltar!: (primero?: OperacionConcurrente) => void;
  const suelta = new Promise<OperacionConcurrente | undefined>((resolve) => (soltar = resolve));
  let tomada!: () => void;
  const lista = new Promise<void>((resolve) => (tomada = resolve));
  const transaccion = otraConexion.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Usuario" WHERE "id" = ${usuarioId}::uuid FOR UPDATE`;
      tomada();
      const primero = await suelta;
      if (primero) await primero(tx);
    },
    { timeout: 60_000 },
  );
  await lista;
  return {
    async soltar(primero?: OperacionConcurrente) {
      soltar(primero);
      await transaccion;
    },
  };
}

/** Una sesión cerrada hace más de la retención (8 días): la limpieza del alta nueva la borra. */
async function crearSesionCerradaVieja(usuarioId: string) {
  const hace = (dias: number) => new Date(Date.now() - dias * DIA_MS);
  return prisma.sesion.create({
    data: {
      usuarioId,
      tokenHash: generarTokenDeSesion().tokenHash,
      createdAt: hace(9),
      ultimaActividadEn: hace(9),
      expiraEn: hace(2),
      revocadaEn: hace(8),
    },
  });
}

/** Trigger y función temporales de la falla al confirmar; el nombre lleva la marca de esta corrida. */
const FALLA_AL_CONFIRMAR = `rp_prueba_falla_al_confirmar_${MARCA}`;

/**
 * Hace fallar el COMMIT de toda transacción que inserte una sesión de `usuarioId`: un trigger de
 * restricción DIFERIDO corre recién al confirmar y lanza un error, como una falla en el COMMIT. Solo
 * afecta a ese usuario de prueba, y `quitarFallaAlConfirmar` lo borra.
 */
async function crearFallaAlConfirmar(usuarioId: string) {
  if (!/^[0-9a-f-]{36}$/.test(usuarioId)) throw new Error('id de usuario inesperado');
  await otraConexion.$executeRawUnsafe(`
    CREATE FUNCTION "${FALLA_AL_CONFIRMAR}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falla simulada al confirmar'; END $$`);
  await otraConexion.$executeRawUnsafe(`
    CREATE CONSTRAINT TRIGGER "${FALLA_AL_CONFIRMAR}" AFTER INSERT ON "Sesion"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW."usuarioId" = '${usuarioId}'::uuid)
    EXECUTE FUNCTION "${FALLA_AL_CONFIRMAR}"()`);
}

async function quitarFallaAlConfirmar() {
  await otraConexion.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${FALLA_AL_CONFIRMAR}" ON "Sesion"`,
  );
  await otraConexion.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${FALLA_AL_CONFIRMAR}"()`);
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
/** La limpieza de sesiones cerradas, primer paso del alta de la sesión rotada (Prisma `deleteMany`). */
const LIMPIEZA_DE_SESIONES = 'DELETE FROM "public"."Sesion"';

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

  it('sin cambio obligatorio, el mismo endpoint hace el cambio voluntario (HU4.2): rota en vez de cerrar', async () => {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(204);
    expect(setCookie(res)).toHaveLength(1);
    expect(setCookie(res)[0]).toMatch(COOKIE_ROTADA);
    expect((await credencialDe(usuario.id)).debeCambiarPassword).toBe(false);
    expect((await consultarSesion(app, tokenDe(res))).status).toBe(200);
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
    ['común (lista de bloqueo)', 'qwertyuiopasdfgh', MENSAJE_CONTRASENA_PREVISIBLE],
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
    // Revocada: la cookie NO se borra (HU4.2). Puede ser un pedido que salió antes de una rotación,
    // y borrarla haría perder la sesión nueva; el token revocado no da acceso a nada.
    ['revocada', () => ({ revocadaEn: new Date() }), 'SESION_REQUERIDA', []],
    [
      'vencida por duración',
      // Movida entera al pasado: ck_sesion_fechas_coherentes exige expiraEn > createdAt.
      () => {
        const hace = (dias: number) => new Date(Date.now() - dias * DIA_MS);
        return { createdAt: hace(8), ultimaActividadEn: hace(8), expiraEn: hace(1) };
      },
      'SESION_VENCIDA',
      [COOKIE_BORRADA],
    ],
  ])('sesión %s → 401 %s y no cambia nada', async (_caso, fechas, motivo, cookies) => {
    const { app, usuario, token, antes } = await preparar();
    await prisma.sesion.update({ where: { tokenHash: sha256(token) }, data: fechas() });

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo });
    expect(setCookie(res)).toEqual(cookies);
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

describe.skipIf(url === undefined)('PUT /auth/password: cambio voluntario (HU4.2)', () => {
  async function preparar({ otrasSesiones = 2 } = {}) {
    const app = nuevaApp();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);
    const otras: string[] = [];
    for (let i = 0; i < otrasSesiones; i += 1) otras.push(await iniciarSesion(app, usuario.email));
    return { app, usuario, token, otras };
  }

  const sesionesDe = (usuarioId: string) => prisma.sesion.count({ where: { usuarioId } });

  it('rota: revoca todas las anteriores, emite un token nuevo en una cookie nueva y la persona sigue dentro', async () => {
    const { app, usuario, token, otras } = await preparar();
    const antes = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    const cookies = setCookie(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(COOKIE_ROTADA);
    const nuevo = tokenDe(res);
    expect(nuevo).not.toBe(token);

    const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    // La contraseña cambió; la rotación no es un inicio de sesión (no toca el último acceso).
    expect(despues.debeCambiarPassword).toBe(false);
    expect(despues.passwordActualizadaEn.getTime()).toBeGreaterThan(
      antes.passwordActualizadaEn.getTime(),
    );
    expect(await verificarContrasena(despues.passwordHash, NUEVA)).toBe(true);
    expect(despues.ultimoAccesoEn).toEqual(antes.ultimoAccesoEn);

    // La sesión nueva: del mismo usuario, nacida en el mismo instante que el cambio, con plazos
    // nuevos (7 días de duración máxima desde ahí).
    const rotada = await sesionDe(nuevo);
    expect(rotada.usuarioId).toBe(usuario.id);
    expect(rotada.revocadaEn).toBeNull();
    expect(rotada.createdAt).toEqual(despues.passwordActualizadaEn);
    expect(rotada.ultimaActividadEn).toEqual(rotada.createdAt);
    expect(rotada.expiraEn.getTime() - rotada.createdAt.getTime()).toBe(7 * DIA_MS);

    // Todas las anteriores revocadas en ese mismo instante, la de este navegador incluida. Sus
    // tokens dan 401 y su respuesta no toca la cookie (podría pisar la rotada).
    expect(await vigentes(usuario.id)).toBe(1);
    for (const t of [token, ...otras]) {
      expect((await sesionDe(t)).revocadaEn).toEqual(despues.passwordActualizadaEn);
      const viejo = await consultarSesion(app, t);
      expect(viejo.status).toBe(401);
      expect(errorDe(viejo).details).toEqual({ motivo: 'SESION_REQUERIDA' });
      expect(setCookie(viejo)).toEqual([]);
    }

    // Sigue dentro, con la misma identidad.
    const actual = await consultarSesion(app, nuevo);
    expect(actual.status).toBe(200);
    expect((actual.body as SesionActual).usuario).toEqual({
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: 'ADMINISTRATIVO',
      debeCambiarPassword: false,
    });

    // La contraseña vieja ya no sirve; la nueva sí.
    expect((await login(app, usuario.email, TEMPORAL)).status).toBe(401);
    expect((await login(app, usuario.email, NUEVA)).status).toBe(200);
  });

  it('la sesión rotada sirve para la API de negocio; el token viejo ya no', async () => {
    const { app, token } = await preparar({ otrasSesiones: 0 });
    const nuevo = tokenDe(await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA }));

    const conNuevo = await request(app).get('/clientes').set('Cookie', `${COOKIE}=${nuevo}`);
    const conViejo = await request(app).get('/clientes').set('Cookie', `${COOKIE}=${token}`);

    expect(conNuevo.status).toBe(200);
    expect(conViejo.status).toBe(401);
    expect(setCookie(conViejo)).toEqual([]);
  });

  it('se puede volver a cambiar desde la sesión rotada, y rota otra vez', async () => {
    const { app, usuario, token } = await preparar({ otrasSesiones: 0 });
    const segundo = tokenDe(await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA }));

    const res = await cambiar(app, segundo, { actual: NUEVA, nueva: `${NUEVA} otra vez` });

    expect(res.status).toBe(204);
    const tercero = tokenDe(res);
    expect(new Set([token, segundo, tercero]).size).toBe(3);
    expect((await consultarSesion(app, segundo)).status).toBe(401);
    expect((await consultarSesion(app, tercero)).status).toBe(200);
    expect(await vigentes(usuario.id)).toBe(1);
  });

  it('con el máximo de sesiones vigentes abiertas, queda solo la rotada', async () => {
    const { app, usuario, token } = await preparar({
      otrasSesiones: LIMITE_DE_SESIONES_VIGENTES - 1,
    });
    expect(await vigentes(usuario.id)).toBe(LIMITE_DE_SESIONES_VIGENTES);

    const res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(204);
    expect(await vigentes(usuario.id)).toBe(1);
    expect((await sesionDe(tokenDe(res))).revocadaEn).toBeNull();
  });

  it('contraseña actual incorrecta: 400 en `actual`, sin rotar ni revocar nada', async () => {
    const { app, usuario, token, otras } = await preparar({ otrasSesiones: 1 });
    const antes = await credencialDe(usuario.id);

    const res = await cambiar(app, token, { actual: 'no-es-la-temporal', nueva: NUEVA });

    expect(res.status).toBe(400);
    expect(errorDe(res).details).toEqual([
      { campo: 'actual', mensaje: 'La contraseña actual no es correcta.' },
    ]);
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(2);
    for (const t of [token, ...otras]) expect((await consultarSesion(app, t)).status).toBe(200);
  });

  it.each([
    ['de otro sitio', { Origin: 'https://sitio-ajeno.example' }],
    ['sin Origin', {}],
    ['que el navegador marca cross-site', { Origin: ORIGEN, 'Sec-Fetch-Site': 'cross-site' }],
  ])('pedido %s → 403, sin rotar ni revocar nada (CSRF)', async (_caso, cabeceras) => {
    const { app, usuario, token } = await preparar({ otrasSesiones: 0 });
    const antes = await credencialDe(usuario.id);

    const res = await request(app)
      .put('/auth/password')
      .set(cabeceras)
      .set('Cookie', `${COOKIE}=${token}`)
      .send({ actual: TEMPORAL, nueva: NUEVA });

    expect(res.status).toBe(403);
    expect(errorDe(res).details).toEqual({ motivo: 'ORIGEN_NO_PERMITIDO' });
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(1);
    expect((await sesionDe(token)).revocadaEn).toBeNull();
  });
});

describe.skipIf(url === undefined)('PUT /auth/password voluntario: concurrencia y fallos', () => {
  async function preparar() {
    const { app, proteccion } = nuevaAppConProteccion();
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const token = await iniciarSesion(app, usuario.email);
    const otra = await iniciarSesion(app, usuario.email);
    return { app, proteccion, usuario, token, otra, antes: await credencialDe(usuario.id) };
  }

  const sesionesDe = (usuarioId: string) => prisma.sesion.count({ where: { usuarioId } });

  /**
   * Lanza el cambio y espera a que quede bloqueado en la fila del usuario. La respuesta vuelve
   * envuelta: devolver la promesa sola haría que el `await` esperara también la respuesta, que a su
   * vez espera el bloqueo que el test todavía no soltó.
   */
  async function cambiarHastaElBloqueo(app: ReturnType<typeof CrearApp>, token: string) {
    const respuesta = cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA }).then((r) => r);
    await esperarBloqueada(BLOQUEO_DE_USUARIO);
    return { respuesta };
  }

  it('si un restablecimiento prende el cambio obligatorio mientras se calculaba: vale lo que dice la fila bloqueada (obligatorio, sin sesión nueva)', async () => {
    const { app, usuario, token } = await preparar();
    const retenido = await retenerUsuario(usuario.id);

    const { respuesta: pendiente } = await cambiarHastaElBloqueo(app, token);
    await retenido.soltar((tx) =>
      tx.usuario.update({ where: { id: usuario.id }, data: { debeCambiarPassword: true } }),
    );
    const res = await pendiente;

    expect(res.status).toBe(204);
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    expect(await vigentes(usuario.id)).toBe(0);
    expect(await sesionesDe(usuario.id)).toBe(2);
    const despues = await credencialDe(usuario.id);
    expect(despues.debeCambiarPassword).toBe(false);
    expect(await verificarContrasena(despues.passwordHash, NUEVA)).toBe(true);
  });

  it('si la cuenta se desactiva mientras se calculaba: 401, ninguna sesión nueva y la contraseña no cambia', async () => {
    const { app, usuario, token, antes } = await preparar();
    const retenido = await retenerUsuario(usuario.id);

    const { respuesta: pendiente } = await cambiarHastaElBloqueo(app, token);
    // Una desactivación apaga la cuenta y revoca sus sesiones en la misma transacción.
    await retenido.soltar(async (tx) => {
      await tx.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
      await tx.sesion.updateMany({
        where: { usuarioId: usuario.id, revocadaEn: null },
        data: { revocadaEn: new Date() },
      });
    });
    const res = await pendiente;

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(2);
    expect(await vigentes(usuario.id)).toBe(0);
  });

  it('si esta misma sesión cierra sesión mientras se calculaba: 401 sin tocar la cookie; nada cambia y la otra sesión sigue', async () => {
    const { app, usuario, token, otra, antes } = await preparar();
    const retenido = await retenerUsuario(usuario.id);

    const { respuesta: pendiente } = await cambiarHastaElBloqueo(app, token);
    const salida = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${COOKIE}=${token}`);
    expect(salida.status).toBe(204);
    await retenido.soltar();
    const res = await pendiente;

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(2);
    expect((await consultarSesion(app, otra)).status).toBe(200);
  });

  it('si otro proceso revoca todas sus sesiones mientras se calculaba: 401 y no nace ninguna', async () => {
    const { app, usuario, token, antes } = await preparar();
    const retenido = await retenerUsuario(usuario.id);

    const { respuesta: pendiente } = await cambiarHastaElBloqueo(app, token);
    await retenido.soltar((tx) =>
      tx.sesion.updateMany({
        where: { usuarioId: usuario.id, revocadaEn: null },
        data: { revocadaEn: new Date() },
      }),
    );
    const res = await pendiente;

    expect(res.status).toBe(401);
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(2);
    expect(await vigentes(usuario.id)).toBe(0);
  });

  it('dos cambios voluntarios simultáneos desde dos instancias: uno rota, el otro 401 sin cookie; queda una sola sesión, la del ganador', async () => {
    const usuario = await crearUsuario({ debeCambiarPassword: false });
    const a = nuevaApp();
    const b = nuevaApp();
    const tokenA = await iniciarSesion(a, usuario.email);
    const tokenB = await iniciarSesion(b, usuario.email);

    const [resA, resB] = await Promise.all([
      cambiar(a, tokenA, { actual: TEMPORAL, nueva: `${NUEVA} A` }),
      cambiar(b, tokenB, { actual: TEMPORAL, nueva: `${NUEVA} B` }),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([204, 401]);
    const ganaA = resA.status === 204;
    const ganadora = ganaA ? resA : resB;
    const perdedora = ganaA ? resB : resA;
    expect(setCookie(ganadora)[0]).toMatch(COOKIE_ROTADA);
    expect(setCookie(perdedora)).toEqual([]);
    expect(errorDe(perdedora).details).toEqual({ motivo: 'SESION_REQUERIDA' });

    expect(await vigentes(usuario.id)).toBe(1);
    expect((await sesionDe(tokenDe(ganadora))).revocadaEn).toBeNull();
    const { passwordHash } = await credencialDe(usuario.id);
    expect(await verificarContrasena(passwordHash, ganaA ? `${NUEVA} A` : `${NUEVA} B`)).toBe(true);
    expect(await verificarContrasena(passwordHash, ganaA ? `${NUEVA} B` : `${NUEVA} A`)).toBe(
      false,
    );
  });

  it('un login con la contraseña vieja que espera el bloqueo del usuario no crea una sesión', async () => {
    const { app: appDelCambio, usuario, token, otra } = await preparar();
    const appDelLogin = nuevaApp(); // otra instancia: no comparte la protección en memoria
    const retenida = await retenerSesion((await sesionDe(otra)).id);

    // 1. El cambio toma el bloqueo del usuario y espera en la revocación.
    const cambio = cambiar(appDelCambio, token, { actual: TEMPORAL, nueva: NUEVA }).then((r) => r);
    await esperarBloqueada(REVOCACION);
    // 2. El login lee el hash viejo, lo verifica y espera el bloqueo del usuario en `crearSesion`.
    const entrada = login(appDelLogin, usuario.email, TEMPORAL).then((r) => r);
    await esperarBloqueada(BLOQUEO_DE_USUARIO);
    // 3. El cambio confirma (con la sesión rotada); el login encuentra otro hash.
    await retenida.soltar();

    const resCambio = await cambio;
    expect(resCambio.status).toBe(204);
    const resLogin = await entrada;
    expect(resLogin.status).toBe(401);
    expect(errorDe(resLogin).details).toEqual({ motivo: 'CREDENCIALES_INVALIDAS' });
    expect(setCookie(resLogin)).toEqual([]);
    expect(await vigentes(usuario.id)).toBe(1);
    expect((await sesionDe(tokenDe(resCambio))).revocadaEn).toBeNull();
  });

  it('si PostgreSQL corta la transacción al abrir la sesión rotada (después de revocar): 503, nada persiste, la cookie sigue y no cuenta un intento', async () => {
    const { app, proteccion, usuario, token, otra, antes } = await preparar();
    const vieja = await crearSesionCerradaVieja(usuario.id);
    const sesionesAntes = await sesionesDe(usuario.id);
    const intentosAntes = proteccion.tamanio;
    // La limpieza de sesiones cerradas (primer paso del alta de la rotada, después de guardar el
    // hash y de revocar todas) queda esperando esta fila.
    const retenida = await retenerSesion(vieja.id);

    const pendiente = cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA }).then((r) => r);
    const pid = await esperarBloqueada(LIMPIEZA_DE_SESIONES);
    await otraConexion.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
    const res = await pendiente;
    await retenida.soltar();

    expect(res.status).toBe(503);
    expect(errorDe(res).code).toBe('SERVICE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|Sesion|Usuario|terminat|prisma/i);
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(sesionesAntes);
    for (const t of [token, otra]) expect((await sesionDe(t)).revocadaEn).toBeNull();
    expect(proteccion.tamanio).toEqual(intentosAntes);
    expect((await consultarSesion(app, token)).status).toBe(200);

    // Se puede reintentar, y entonces rota.
    const reintento = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });
    expect(reintento.status).toBe(204);
    expect(setCookie(reintento)[0]).toMatch(COOKIE_ROTADA);
    expect(await vigentes(usuario.id)).toBe(1);
  });

  it('si falla el COMMIT: ningún éxito, ninguna cookie, nada persiste y se puede reintentar', async () => {
    const { app, proteccion, usuario, token, otra, antes } = await preparar();
    const sesionesAntes = await sesionesDe(usuario.id);
    const intentosAntes = proteccion.tamanio;

    await crearFallaAlConfirmar(usuario.id);
    let res: request.Response;
    try {
      res = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });
    } finally {
      await quitarFallaAlConfirmar();
    }

    expect(res.status).toBe(500);
    expect(errorDe(res).code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/falla simulada|Sesion|Usuario|prisma/i);
    expect(setCookie(res)).toEqual([]);
    expect(await credencialDe(usuario.id)).toEqual(antes);
    expect(await sesionesDe(usuario.id)).toBe(sesionesAntes);
    for (const t of [token, otra]) expect((await sesionDe(t)).revocadaEn).toBeNull();
    expect(proteccion.tamanio).toEqual(intentosAntes);

    const reintento = await cambiar(app, token, { actual: TEMPORAL, nueva: NUEVA });
    expect(reintento.status).toBe(204);
    expect(await vigentes(usuario.id)).toBe(1);
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
