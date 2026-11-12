// Autenticación obligatoria y autorización de la API contra PostgreSQL REAL, con sesiones reales y
// pedidos directos a Express (sin proxy de por medio). Complementa `matrizDePermisos.test.ts`,
// que recorre las 44 rutas con la base simulada.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { validateCuit } from '@realpolitik/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { createApp as CrearApp } from '../../../app';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';
import { NOMBRE_COOKIE_DE_SESION } from '../cookieDeSesion';

import { sesionesDePrueba } from './sesionReal';
import { ORIGEN_DE_PRUEBA } from './sesionSimulada';

const url = urlDeBaseDescartable();
const sesiones = sesionesDePrueba();
const MARCA = `testz${Date.now().toString(36)}`;
const TEMPORAL = 'temporal-de-integracion-0042';
const NUEVA = 'una frase nueva para entrar al negocio';

let prisma: PrismaClient;
let app: ReturnType<typeof CrearApp>;
const clientesCreados: string[] = [];

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  await sesiones.preparar();
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA] });
});

afterAll(async () => {
  if (url === undefined) return;
  // Primero las cuentas: si un alta falló, su id no existe y no debe impedir esta limpieza.
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await sesiones.limpiar();
  const ids = clientesCreados.filter((id): id is string => typeof id === 'string');
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const tokenDe = (res: request.Response) =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
    .find((c) => c.startsWith(`${NOMBRE_COOKIE_DE_SESION}=`))
    ?.slice(NOMBRE_COOKIE_DE_SESION.length + 1)
    .split(';')[0] ?? '';
const conCookie = (token: string) => ({
  Cookie: `${NOMBRE_COOKIE_DE_SESION}=${token}`,
  Origin: ORIGEN_DE_PRUEBA,
});
const motivoDe = (res: request.Response) =>
  (res.body as { error?: { details?: { motivo?: string } } }).error?.details?.motivo;

let secuencia = 0;
/** Alta válida, como la de `clientes.integration.test.ts` (CUIT con verificador y único). */
function clienteNuevo() {
  secuencia += 1;
  for (;;) {
    const cuerpo = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador++) {
      const candidato = `33${cuerpo}${verificador}`;
      if (validateCuit(candidato)) {
        return {
          razonSocial: `${MARCA} Cliente ${secuencia}`,
          denominacion: `${MARCA} ${secuencia}`,
          cuit: `33-${cuerpo}-${verificador}`,
          sector: 'PRIVADO',
          ivaCondicion: 'EXENTO',
          emailContacto: 'test@ejemplo.example',
        };
      }
    }
  }
}

async function crearUsuarioConContrasena(debeCambiarPassword: boolean) {
  return prisma.usuario.create({
    data: {
      email: `${MARCA}-${Math.random().toString(36).slice(2, 8)}@ejemplo.example`,
      nombre: 'Persona del primer acceso',
      rol: 'ADMINISTRATIVO',
      passwordHash: await hashearContrasena(TEMPORAL),
      passwordActualizadaEn: new Date(),
      debeCambiarPassword,
    },
  });
}

const login = (email: string, password: string) =>
  request(app).post('/auth/login').set('Origin', ORIGEN_DE_PRUEBA).send({ email, password });

describe.skipIf(url === undefined)('sesión obligatoria en la API de negocio', () => {
  it('sin cookie: 401 SESION_REQUERIDA, con no-store', async () => {
    const res = await request(app).get('/clientes');

    expect(res.status).toBe(401);
    expect(motivoDe(res)).toBe('SESION_REQUERIDA');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('token inválido o desconocido: 401 y borra la cookie', async () => {
    for (const token of ['basura', 'A'.repeat(43)]) {
      const res = await request(app).get('/clientes').set(conCookie(token));
      expect(res.status).toBe(401);
      expect(String(res.headers['set-cookie'])).toContain(`${NOMBRE_COOKIE_DE_SESION}=;`);
    }
  });

  it('sesión vencida: 401 SESION_VENCIDA; revocada: 401 SESION_REQUERIDA', async () => {
    const usuario = await crearUsuarioConContrasena(false);
    const vencida = tokenDe(await login(usuario.email, TEMPORAL));
    const revocada = tokenDe(await login(usuario.email, TEMPORAL));
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
    await prisma.sesion.update({
      where: { tokenHash: sha256(vencida) },
      data: { createdAt: hace(8), ultimaActividadEn: hace(8), expiraEn: hace(1) },
    });
    await prisma.sesion.update({
      where: { tokenHash: sha256(revocada) },
      data: { revocadaEn: new Date() },
    });

    const resVencida = await request(app).get('/clientes').set(conCookie(vencida));
    const resRevocada = await request(app).get('/clientes').set(conCookie(revocada));

    expect(resVencida.status).toBe(401);
    expect(motivoDe(resVencida)).toBe('SESION_VENCIDA');
    expect(resRevocada.status).toBe(401);
    expect(motivoDe(resRevocada)).toBe('SESION_REQUERIDA');
  });

  it('usuario desactivado: su sesión deja de servir (401)', async () => {
    const usuario = await crearUsuarioConContrasena(false);
    const token = tokenDe(await login(usuario.email, TEMPORAL));
    expect((await request(app).get('/clientes').set(conCookie(token))).status).toBe(200);

    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

    const res = await request(app).get('/clientes').set(conCookie(token));
    expect(res.status).toBe(401);
    expect(motivoDe(res)).toBe('SESION_REQUERIDA');
  });

  it('Origin ajeno en una escritura: 403, sin crear nada', async () => {
    const cuerpo = clienteNuevo();
    const res = await sesiones
      .cliente(app, 'ADMINISTRADOR')
      .post('/clientes')
      .set('Origin', 'https://sitio-ajeno.example')
      .send(cuerpo);

    expect(res.status).toBe(403);
    expect(motivoDe(res)).toBe('ORIGEN_NO_PERMITIDO');
    expect(await prisma.cliente.count({ where: { cuit: cuerpo.cuit } })).toBe(0);
  });
});

describe.skipIf(url === undefined)('permisos por rol', () => {
  it.each(['ADMINISTRADOR', 'ADMINISTRATIVO'] as const)(
    '%s: alta, edición y lectura de un cliente',
    async (rol) => {
      const api = sesiones.cliente(app, rol);
      const alta = await api.post('/clientes').send(clienteNuevo());
      expect(alta.status).toBe(201);
      const id = (alta.body as { id: string }).id;
      clientesCreados.push(id);

      expect(
        (await api.patch(`/clientes/${id}`).send({ telefono: '+54 11 4000-0000' })).status,
      ).toBe(200);
      expect((await api.get(`/clientes/${id}`)).status).toBe(200);
    },
  );

  it('CONSULTA (regla temporal de HU4.1): 403 ROL_NO_HABILITADO en lecturas y escrituras, nada cambia', async () => {
    const alta = await sesiones
      .cliente(app, 'ADMINISTRATIVO')
      .post('/clientes')
      .send(clienteNuevo());
    expect(alta.status).toBe(201);
    const id = (alta.body as { id: string }).id;
    clientesCreados.push(id);
    const antes = await prisma.cliente.findUniqueOrThrow({ where: { id } });
    const consulta = sesiones.cliente(app, 'CONSULTA');
    const cuerpoNuevo = clienteNuevo();

    const pedidos = [
      // Lecturas que la matriz le concederá en HU4.3.
      await consulta.get('/clientes'),
      await consulta.get(`/clientes/${id}`),
      await consulta.get(`/clientes/${id}/rendiciones`),
      await consulta.get('/tipos-documento'),
      await consulta.get('/rendiciones/atrasadas'),
      // Escrituras, que nunca tendrá.
      await consulta.post('/clientes').send(cuerpoNuevo),
      await consulta.patch(`/clientes/${id}`).send({ telefono: '+54 11 0000-0000' }),
      await consulta.patch(`/clientes/${id}/estado`).send({ estado: 'INACTIVO' }),
      await consulta.put(`/clientes/${id}/observaciones`).send({ observaciones: 'no' }),
      await consulta.post(`/clientes/${id}/rendiciones`).send({ anio: 2026, mes: 1 }),
    ];
    for (const res of pedidos) {
      expect(res.status).toBe(403);
      expect(motivoDe(res)).toBe('ROL_NO_HABILITADO');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(await prisma.cliente.findUniqueOrThrow({ where: { id } })).toEqual(antes);
    expect(await prisma.cliente.count({ where: { cuit: cuerpoNuevo.cuit } })).toBe(0);
    expect(await prisma.rendicion.count({ where: { clienteId: id } })).toBe(0);
  });

  it('CONSULTA conserva /auth/*: consulta su sesión y cierra sesión', async () => {
    const consulta = sesiones.cliente(app, 'CONSULTA');

    const sesion = await consulta.get('/auth/sesion');
    expect(sesion.status).toBe(200);
    expect((sesion.body as { usuario: { rol: string } }).usuario.rol).toBe('CONSULTA');
    expect((await consulta.post('/auth/logout')).status).toBe(204);
    expect((await consulta.get('/auth/sesion')).status).toBe(401);
  });
});

describe.skipIf(url === undefined)('primer acceso: contraseña temporal pendiente', () => {
  it('login → 403 en el negocio → cambio → nuevo login → permisos normales', async () => {
    const usuario = await crearUsuarioConContrasena(true);
    const temporal = tokenDe(await login(usuario.email, TEMPORAL));

    const bloqueado = await request(app).get('/clientes').set(conCookie(temporal));
    expect(bloqueado.status).toBe(403);
    expect(motivoDe(bloqueado)).toBe('CAMBIO_DE_PASSWORD_REQUERIDO');
    expect(
      (await request(app).post('/clientes').set(conCookie(temporal)).send(clienteNuevo())).status,
    ).toBe(403);
    // /auth/* sigue respondiendo.
    expect((await request(app).get('/auth/sesion').set(conCookie(temporal))).status).toBe(200);

    const cambio = await request(app)
      .put('/auth/password')
      .set(conCookie(temporal))
      .send({ actual: TEMPORAL, nueva: NUEVA });
    expect(cambio.status).toBe(204);
    // La sesión temporal quedó revocada.
    expect((await request(app).get('/clientes').set(conCookie(temporal))).status).toBe(401);

    const definitiva = tokenDe(await login(usuario.email, NUEVA));
    expect((await request(app).get('/clientes').set(conCookie(definitiva))).status).toBe(200);
  });

  it('con la cuenta de prueba en ese estado, tampoco descarga ni lista rendiciones', async () => {
    const api = sesiones.cliente(app, 'CAMBIO_PENDIENTE');
    for (const ruta of ['/rendiciones/atrasadas', '/tipos-documento', '/no-existe']) {
      const res = await api.get(ruta);
      expect(res.status).toBe(403);
      expect(motivoDe(res)).toBe('CAMBIO_DE_PASSWORD_REQUERIDO');
    }
  });
});
