// `/usuarios` por HTTP contra PostgreSQL REAL, con sesiones reales (`POST /auth/login` y su cookie)
// y el servicio real: comprueba que la capa HTTP usa bien el dominio ya probado en
// `usuarios.integration.test.ts` y `usuarios.concurrencia.integration.test.ts`. No repite las
// carreras de esas suites.
//
// Aislamiento (el de `entornoDeUsuarios`): sin `TEST_DATABASE_URL` se salta; `lib/prisma` y la app
// se cargan DESPUÉS de fijar `DATABASE_URL`, y `cuentasDePrueba` verifica la base y el servidor
// reales de cada conexión antes de escribir. Solo se crean y borran cuentas con la marca de la corrida, y al
// terminar se comprueba que las cuentas ajenas no cambiaron.

import type { PrismaClient } from '@prisma/client';
import {
  ContrasenaRestablecidaSchema,
  EstadoDeUsuarioCambiadoSchema,
  UsuarioAdministradoSchema,
  UsuarioCreadoSchema,
  UsuarioModificadoSchema,
} from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashearContrasena } from '../../auth/contrasenas';
import { ProteccionDeLogin } from '../../auth/proteccionDeLogin';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

import {
  capturarEventos,
  conexion,
  type Cuentas,
  cuentasDePrueba,
  nuevaMarca,
  PASSWORD,
} from './entornoDeUsuarios';

vi.setConfig({ testTimeout: 30_000 });

const url = urlDeBaseDescartable();
const MARCA = nuevaMarca('usuarios-http');
const ORIGEN = 'http://localhost:5173';
const COOKIE = '__Host-rp_sesion';
const NUEVA = 'una frase propia para el primer acceso';

type CuerpoDeError = { error: { code: string; details?: unknown } };

let prisma: PrismaClient;
let verificacion: PrismaClient;
let cuentas: Cuentas;
let app: Express;
/** La guarda pasó: solo entonces se limpia. */
let verificada = false;
/** Huella de las cuentas ajenas a esta corrida, para comprobar al final que no cambiaron. */
let ajenasAntes: unknown;
let eventos: ReturnType<typeof capturarEventos>;
let admin: { id: string; email: string };
let tokenAdmin: string;

const ajenas = () =>
  prisma.usuario.findMany({
    where: { NOT: cuentas.propias },
    select: { id: true, updatedAt: true, activo: true, rol: true, passwordHash: true },
    orderBy: { id: 'asc' },
  });

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  verificacion = conexion(url);
  // La guarda corre antes de cualquier escritura; si falla, la suite no arranca.
  cuentas = await cuentasDePrueba({
    url,
    prisma,
    otras: [verificacion],
    marca: MARCA,
    hash: await hashearContrasena(PASSWORD),
  });
  verificada = true;
  ajenasAntes = await ajenas();
  app = createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: new ProteccionDeLogin() });
  eventos = capturarEventos();
  admin = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'admin' });
  tokenAdmin = await entrar(admin.email);
});

afterAll(async () => {
  eventos?.soltar();
  if (url === undefined) return;
  if (verificada) {
    await cuentas.limpiar();
    expect(await ajenas()).toEqual(ajenasAntes);
  }
  await prisma?.$disconnect();
  await verificacion?.$disconnect();
});

function tokenDe(res: request.Response): string {
  const valor = res.headers['set-cookie'] as string[] | string | undefined;
  const cookie = ([] as string[]).concat(valor ?? []).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error('no se emitió la cookie de sesión');
  return cookie.slice(COOKIE.length + 1).split(';')[0] ?? '';
}

const login = (email: string, password = PASSWORD) =>
  request(app).post('/auth/login').set('Origin', ORIGEN).send({ email, password });

async function entrar(email: string, password = PASSWORD): Promise<string> {
  const res = await login(email, password);
  expect(res.status).toBe(200);
  return tokenDe(res);
}

/** Pedidos con la cookie de `token` y un `Origin` permitido. */
const con = (token: string) => ({
  get: (ruta: string) => request(app).get(ruta).set('Cookie', `${COOKIE}=${token}`),
  post: (ruta: string) =>
    request(app).post(ruta).set('Cookie', `${COOKIE}=${token}`).set('Origin', ORIGEN),
  patch: (ruta: string) =>
    request(app).patch(ruta).set('Cookie', `${COOKIE}=${token}`).set('Origin', ORIGEN),
  put: (ruta: string) =>
    request(app).put(ruta).set('Cookie', `${COOKIE}=${token}`).set('Origin', ORIGEN),
});

describe.skipIf(url === undefined)('recorrido administrativo por HTTP (PostgreSQL real)', () => {
  it('alta → primer acceso → rol → baja → reactivación → restablecimiento', async () => {
    const yo = con(tokenAdmin);

    // Alta: 201 con la contraseña temporal; la cuenta nace activa y con cambio obligatorio.
    const alta = await yo.post('/usuarios').send({
      nombre: ' Ana Recorrido ',
      email: ` ${cuentas.email('ana').toUpperCase()}`,
      rol: 'ADMINISTRATIVO',
    });
    expect(alta.status).toBe(201);
    expect(alta.headers['cache-control']).toBe('no-store');
    // Cada respuesta cumple el schema con el que la valida el frontend (`usuarios.api.ts`).
    expect(UsuarioCreadoSchema.safeParse(alta.body).success).toBe(true);
    const { usuario, contrasenaTemporal } = alta.body as {
      usuario: { id: string; email: string; [clave: string]: unknown };
      contrasenaTemporal: string;
    };
    expect(usuario).toMatchObject({
      nombre: 'Ana Recorrido',
      email: cuentas.email('ana'),
      rol: 'ADMINISTRATIVO',
      activo: true,
      debeCambiarPassword: true,
      ultimoAccesoEn: null,
    });
    expect(JSON.stringify(alta.body)).not.toMatch(/passwordHash|argon2/);

    // La contraseña temporal no vuelve a aparecer: ni en el listado ni en otra respuesta.
    const listado = await yo.get(`/usuarios?q=${encodeURIComponent(cuentas.email('ana'))}`);
    expect(listado.status).toBe(200);
    expect(UsuarioAdministradoSchema.array().safeParse(listado.body).success).toBe(true);
    expect(listado.body).toEqual([usuario]);
    expect(JSON.stringify(listado.body)).not.toContain(contrasenaTemporal);

    // Con la temporal entra, pero no usa la API de negocio hasta cambiarla.
    const temporal = await entrar(usuario.email, contrasenaTemporal);
    const negocio = await con(temporal).get('/clientes');
    expect(negocio.status).toBe(403);
    expect(negocio.body).toMatchObject({
      error: { details: { motivo: 'CAMBIO_DE_PASSWORD_REQUERIDO' } },
    });
    expect((await con(temporal).get('/usuarios')).status).toBe(403);
    expect(
      (await con(temporal).put('/auth/password').send({ actual: contrasenaTemporal, nueva: NUEVA }))
        .status,
    ).toBe(204);
    const propia = await entrar(usuario.email, NUEVA);
    expect((await con(propia).get('/clientes')).status).toBe(200);
    // ADMINISTRATIVO no administra usuarios.
    expect((await con(propia).get('/usuarios')).status).toBe(403);

    // Cambio de rol: la sesión anterior deja de valer; la nueva tiene el rol nuevo.
    const cambio = await yo.patch(`/usuarios/${usuario.id}`).send({ rol: 'CONSULTA' });
    expect(cambio.status).toBe(200);
    expect(UsuarioModificadoSchema.safeParse(cambio.body).success).toBe(true);
    expect(cambio.body).toMatchObject({ modificados: ['rol'], sesionesRevocadas: 1 });
    expect((await con(propia).get('/auth/sesion')).status).toBe(401);
    const comoConsulta = await entrar(usuario.email, NUEVA);
    expect((await con(comoConsulta).get('/auth/sesion')).body).toMatchObject({
      usuario: { rol: 'CONSULTA' },
    });
    // CONSULTA conserva la lectura (HU4.3), pero ni escribe ni administra usuarios.
    expect((await con(comoConsulta).get('/clientes')).status).toBe(200);
    expect((await con(comoConsulta).post('/clientes').send({})).status).toBe(403);
    expect((await con(comoConsulta).get('/usuarios')).status).toBe(403);
    expect((await con(comoConsulta).post('/usuarios').send({})).status).toBe(403);

    // Baja: revoca la sesión y no puede volver a entrar.
    const baja = await yo.patch(`/usuarios/${usuario.id}/estado`).send({ activo: false });
    expect(baja.status).toBe(200);
    expect(EstadoDeUsuarioCambiadoSchema.safeParse(baja.body).success).toBe(true);
    expect(baja.body).toMatchObject({
      cambio: true,
      sesionesRevocadas: 1,
      usuario: { activo: false },
    });
    expect((await con(comoConsulta).get('/auth/sesion')).status).toBe(401);
    expect((await login(usuario.email, NUEVA)).status).toBe(401);
    // Desactivada, la cuenta sigue en la base.
    expect(await prisma.usuario.findUnique({ where: { id: usuario.id } })).toMatchObject({
      activo: false,
      rol: 'CONSULTA',
    });
    // Repetirla no cambia nada.
    expect(
      (await yo.patch(`/usuarios/${usuario.id}/estado`).send({ activo: false })).body,
    ).toMatchObject({ cambio: false, sesionesRevocadas: 0 });

    // Reactivación: vuelve a entrar con su contraseña.
    const alta2 = await yo.patch(`/usuarios/${usuario.id}/estado`).send({ activo: true });
    expect(alta2.body).toMatchObject({
      cambio: true,
      usuario: { activo: true, rol: 'CONSULTA', debeCambiarPassword: false },
    });
    // Las sesiones revocadas no reviven; entra con su contraseña vigente y el mismo rol.
    expect((await con(comoConsulta).get('/auth/sesion')).status).toBe(401);
    const reactivada = await entrar(usuario.email, NUEVA);
    expect((await con(reactivada).get('/auth/sesion')).body).toMatchObject({
      usuario: { rol: 'CONSULTA', debeCambiarPassword: false },
    });

    // Restablecimiento: revoca las sesiones; la anterior ya no sirve y la temporal nueva sí.
    const restablecida = await yo.post(`/usuarios/${usuario.id}/restablecer-password`);
    expect(restablecida.status).toBe(200);
    expect(ContrasenaRestablecidaSchema.safeParse(restablecida.body).success).toBe(true);
    expect(restablecida.headers['cache-control']).toBe('no-store');
    expect(restablecida.body).toMatchObject({
      sesionesRevocadas: 1,
      usuario: { id: usuario.id, debeCambiarPassword: true, activo: true, rol: 'CONSULTA' },
    });
    const nuevaTemporal = (restablecida.body as { contrasenaTemporal: string }).contrasenaTemporal;
    expect(nuevaTemporal).not.toBe(contrasenaTemporal);
    expect((await con(reactivada).get('/auth/sesion')).status).toBe(401);
    expect((await login(usuario.email, NUEVA)).status).toBe(401);
    // Con la temporal nueva, otra vez el cambio obligatorio antes de la API de negocio.
    const otraVezTemporal = await login(usuario.email, nuevaTemporal);
    expect(otraVezTemporal.status).toBe(200);
    expect(otraVezTemporal.body).toMatchObject({ usuario: { debeCambiarPassword: true } });
    expect((await con(tokenDe(otraVezTemporal)).get('/clientes')).status).toBe(403);

    // Las contraseñas temporales no aparecen en ningún registro.
    const registro = eventos.lineas().join('\n');
    expect(registro).not.toContain(contrasenaTemporal);
    expect(registro).not.toContain(nuevaTemporal);
    expect(eventos.administrativos().map((e) => [e.evento, e.actorId, e.usuarioId])).toEqual([
      ['usuarios.creado', admin.id, usuario.id],
      ['usuarios.rol_cambiado', admin.id, usuario.id],
      ['usuarios.desactivado', admin.id, usuario.id],
      ['usuarios.reactivado', admin.id, usuario.id],
      ['auth.password.restablecida', admin.id, usuario.id],
    ]);
  });

  it('con la cookie de un administrador pero sin un Origin permitido: 403 y nada se escribe', async () => {
    const email = cuentas.email('csrf');
    const cuerpo = { nombre: 'Sin origen', email, rol: 'CONSULTA' };
    const cookie = `${COOKIE}=${tokenAdmin}`;
    for (const pedido of [
      request(app).post('/usuarios').set('Cookie', cookie),
      request(app).post('/usuarios').set('Cookie', cookie).set('Origin', 'https://otro.example'),
    ]) {
      const res = await pedido.send(cuerpo);
      expect(res.status).toBe(403);
      expect((res.body as CuerpoDeError).error.details).toMatchObject({
        motivo: 'ORIGEN_NO_PERMITIDO',
      });
    }
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
  });

  it('email ya usado (sin distinguir mayúsculas): 409 EMAIL_EN_USO, sin crear otra cuenta', async () => {
    const existente = await cuentas.crear({ alias: 'repetida', activo: false });
    const res = await con(tokenAdmin)
      .post('/usuarios')
      .send({ nombre: 'Otra', email: existente.email.toUpperCase(), rol: 'CONSULTA' });
    expect(res.status).toBe(409);
    expect((res.body as CuerpoDeError).error.details).toEqual({
      motivo: 'EMAIL_EN_USO',
      campo: 'email',
    });
    expect(res.body).not.toHaveProperty('contrasenaTemporal');
    expect(await prisma.usuario.count({ where: { email: existente.email } })).toBe(1);
  });

  it('usuario inexistente: 404 en las tres operaciones sobre una cuenta', async () => {
    const yo = con(tokenAdmin);
    const id = '00000000-0000-4000-8000-0000000000ff';
    for (const res of [
      await yo.patch(`/usuarios/${id}`).send({ nombre: 'X' }),
      await yo.patch(`/usuarios/${id}/estado`).send({ activo: false }),
      await yo.post(`/usuarios/${id}/restablecer-password`),
    ]) {
      expect(res.status).toBe(404);
      expect((res.body as CuerpoDeError).error.code).toBe('NOT_FOUND');
    }
  });

  it('la propia cuenta: cambia su nombre, pero no su rol, ni se desactiva, ni se restablece la contraseña', async () => {
    const yo = con(tokenAdmin);
    // Otro administrador activo: la regla de la propia cuenta vale aunque no sea el último.
    await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'otro-admin' });

    const nombre = await yo.patch(`/usuarios/${admin.id}`).send({ nombre: 'Admin Renombrado' });
    expect(nombre.status).toBe(200);
    expect(nombre.body).toMatchObject({ modificados: ['nombre'], sesionesRevocadas: 0 });

    const rechazos = [
      [await yo.patch(`/usuarios/${admin.id}`).send({ rol: 'CONSULTA' }), 'cambiar-rol'],
      [await yo.patch(`/usuarios/${admin.id}/estado`).send({ activo: false }), 'desactivar'],
      [await yo.post(`/usuarios/${admin.id}/restablecer-password`), 'restablecer-password'],
    ] as const;
    for (const [res, operacion] of rechazos) {
      expect(res.status).toBe(409);
      expect((res.body as CuerpoDeError).error.details).toEqual({
        motivo: 'OPERACION_SOBRE_CUENTA_PROPIA',
        operacion,
      });
      expect(res.body).not.toHaveProperty('contrasenaTemporal');
    }
    // La sesión del administrador sigue valiendo y nada más cambió.
    expect((await yo.get('/auth/sesion')).status).toBe(200);
    expect(
      await prisma.usuario.findUniqueOrThrow({
        where: { id: admin.id },
        select: { rol: true, activo: true, debeCambiarPassword: true },
      }),
    ).toEqual({ rol: 'ADMINISTRADOR', activo: true, debeCambiarPassword: false });
  });

  it('una sesión revocada o de una cuenta desactivada no administra nada', async () => {
    const otro = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'admin-revocado' });
    const token = await entrar(otro.email);
    // Lo desactiva el administrador de la suite: su sesión deja de valer al instante.
    await con(tokenAdmin).patch(`/usuarios/${otro.id}/estado`).send({ activo: false });
    const res = await con(token).get('/usuarios');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(MARCA);
  });
});
