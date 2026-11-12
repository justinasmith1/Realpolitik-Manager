// Con PostgreSQL caído, el servicio de sesiones falla CERRADO. Sin mocks: el cliente de Prisma
// apunta de verdad a un puerto cerrado, y Prisma lanza el error real de conexión
// (`PrismaClientInitializationError`, comprobado), que el servicio traduce.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BaseDeDatosNoDisponibleError as ErrorDeBaseDeDatos } from '../../../lib/baseDeDatosNoDisponible';
import type * as ServicioDeSesiones from '../sesiones.service';
import { generarTokenDeSesion } from '../tokenDeSesion';

type Servicio = typeof ServicioDeSesiones;
type ErrorDeBase = typeof ErrorDeBaseDeDatos;

const URL_ORIGINAL = process.env.DATABASE_URL;
const UUID = '00000000-0000-4000-8000-000000000001';
/** Con la base caída nunca se llega a compararlo. */
const HASH_CUALQUIERA = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
let servicio: Servicio;
// Se toma después de `vi.resetModules()`: es la misma clase que usa el servicio recién importado.
let BaseDeDatosNoDisponibleError: ErrorDeBase;

beforeAll(async () => {
  // Un cliente nuevo, apuntado a un puerto donde no escucha nadie.
  process.env.DATABASE_URL =
    'postgresql://nadie:nada@127.0.0.1:1/inexistente?schema=public&connect_timeout=2';
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  servicio = await import('../sesiones.service');
  ({ BaseDeDatosNoDisponibleError } = await import('../../../lib/baseDeDatosNoDisponible'));
});

afterAll(async () => {
  const { prisma } = await import('../../../lib/prisma');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (URL_ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = URL_ORIGINAL;
});

describe('servicio de sesiones con la base caída', () => {
  it('validar un token bien formado no concede acceso: lanza BaseDeDatosNoDisponibleError', async () => {
    const { token } = generarTokenDeSesion();

    const error = await servicio.validarSesion(token).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
    // Ni el token, ni el host, ni la causa de Prisma.
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).not.toMatch(/127\.0\.0\.1|inexistente/);
    expect((error as Error).cause).toBeUndefined();
  });

  it.each([
    ['crear una sesión', () => servicio.crearSesion(UUID, HASH_CUALQUIERA)],
    ['registrar actividad', () => servicio.registrarActividad(UUID)],
    ['revocar por token', () => servicio.revocarSesionPorToken(generarTokenDeSesion().token)],
    ['revocar una sesión de un usuario', () => servicio.revocarSesionDeUsuario(UUID, UUID)],
    ['revocar todas las sesiones de un usuario', () => servicio.revocarSesionesDeUsuario(UUID)],
  ])('%s lanza BaseDeDatosNoDisponibleError', async (_caso, operacion) => {
    await expect(operacion()).rejects.toBeInstanceOf(BaseDeDatosNoDisponibleError);
  });

  it('un token mal formado se rechaza sin consultar la base (no hace falta que responda)', async () => {
    await expect(servicio.validarSesion('no-es-un-token')).resolves.toEqual({
      valida: false,
      motivo: 'TOKEN_MAL_FORMADO',
    });
    await expect(servicio.validarSesion(undefined)).resolves.toEqual({
      valida: false,
      motivo: 'TOKEN_MAL_FORMADO',
    });
    await expect(servicio.revocarSesionPorToken('x')).resolves.toBe(false);
  });

  it('identificadores mal formados se descartan sin consultar la base', async () => {
    await expect(servicio.crearSesion('no-uuid', HASH_CUALQUIERA)).rejects.toBeInstanceOf(
      servicio.UsuarioNoHabilitadoError,
    );
    await expect(servicio.registrarActividad('no-uuid')).resolves.toBe(false);
    await expect(servicio.revocarSesionDeUsuario('no-uuid', UUID)).resolves.toBe(false);
    await expect(servicio.revocarSesionesDeUsuario('no-uuid')).resolves.toBe(0);
  });
});
