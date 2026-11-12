import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  BaseDeDatosNoDisponibleError,
  conLaBaseDeDatos,
  esBaseDeDatosNoDisponible,
} from './baseDeDatosNoDisponible';

const conocido = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('falla', {
    code,
    clientVersion: '5.22.0',
    ...(meta === undefined ? {} : { meta }),
  });

describe('esBaseDeDatosNoDisponible', () => {
  it.each(['P1001', 'P1002', 'P1017', 'P2024'])('%s: no responde', (code) => {
    expect(esBaseDeDatosNoDisponible(conocido(code))).toBe(true);
  });

  it('el cliente no pudo inicializarse', () => {
    expect(
      esBaseDeDatosNoDisponible(new Prisma.PrismaClientInitializationError('falla', '5.22.0')),
    ).toBe(true);
  });

  it.each([
    ['57P01', 'conexión terminada por el administrador o un reinicio'],
    ['57P02', 'el servidor se cayó'],
    ['57P03', 'todavía no acepta conexiones'],
    ['08006', 'falla de la conexión'],
    ['08003', 'la conexión no existe'],
  ])('P2010 con SQLSTATE %s (%s): conexión perdida en una consulta raw', (sqlstate) => {
    expect(esBaseDeDatosNoDisponible(conocido('P2010', { code: sqlstate }))).toBe(true);
  });

  it.each([
    ['P2010 con una violación de CHECK (23514)', conocido('P2010', { code: '23514' })],
    ['P2010 con una consulta cancelada (57014)', conocido('P2010', { code: '57014' })],
    ['P2010 sin SQLSTATE', conocido('P2010', { code: 'N/A' })],
    ['P2010 sin meta', conocido('P2010')],
    ['P2002 (único repetido)', conocido('P2002')],
    ['un error cualquiera', new Error('falla')],
  ])('%s: NO es base caída (sigue como 500)', (_caso, error) => {
    expect(esBaseDeDatosNoDisponible(error)).toBe(false);
  });
});

describe('conLaBaseDeDatos', () => {
  it('traduce la conexión perdida a BaseDeDatosNoDisponibleError, sin causa ni detalles', async () => {
    const error = await conLaBaseDeDatos(() =>
      Promise.reject(
        conocido('P2010', { code: '57P01', message: 'FATAL: terminating connection' }),
      ),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
    expect((error as Error).message).not.toMatch(/FATAL|terminating|57P01/);
    expect((error as Error).cause).toBeUndefined();
  });

  it('deja pasar cualquier otro error tal cual', async () => {
    const original = conocido('P2010', { code: '23514' });
    await expect(conLaBaseDeDatos(() => Promise.reject(original))).rejects.toBe(original);
  });
});
