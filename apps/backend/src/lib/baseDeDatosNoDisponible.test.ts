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

  /** El mensaje que deja Prisma 5.22 cuando PostgreSQL termina la conexión en un `deleteMany`. */
  const desconocido = (sqlstate: string) =>
    new Prisma.PrismaClientUnknownRequestError(
      `\nInvalid \`tx.sesion.deleteMany()\` invocation:\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sqlstate}", message: "terminating connection due to administrator command", severity: "FATAL", detail: None, column: None, hint: None }), transient: false })`,
      { clientVersion: '5.22.0' },
    );

  it.each(['57P01', '08006'])(
    'error desconocido con SQLSTATE %s en el mensaje: conexión perdida en una consulta del cliente dentro de una transacción',
    (sqlstate) => {
      expect(esBaseDeDatosNoDisponible(desconocido(sqlstate))).toBe(true);
    },
  );

  /** `meta.error` tal como lo dejó Prisma 5.22 en la reproducción del B2A (login con la fila bloqueada). */
  const VENCIDA =
    'Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6951 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.';
  const NO_INICIADA = 'Unable to start a transaction in the given time.';
  /** Un P2028 como lo arma el cliente: el mensaje trae el lugar de la llamada; el motivo, `meta.error`. */
  const p2028 = (meta?: Record<string, unknown>, mensaje = 'Invalid `tx.$queryRaw()` invocation') =>
    new Prisma.PrismaClientKnownRequestError(`${mensaje}: Transaction API error`, {
      code: 'P2028',
      clientVersion: '5.22.0',
      ...(meta === undefined ? {} : { meta }),
    });

  it.each([
    ['no pudo empezar: pool ocupado más allá de maxWait', NO_INICIADA],
    ['vencida al ejecutar una consulta (esperando un bloqueo)', VENCIDA],
    [
      'vencida al confirmar',
      'Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5104 ms passed since the start of the transaction.',
    ],
  ])('P2028 transitorio (%s): no está disponible', (_caso, motivo) => {
    expect(esBaseDeDatosNoDisponible(p2028({ error: motivo }))).toBe(true);
  });

  it.each([
    [
      'P2028 sobre una transacción ya confirmada (error de programación)',
      p2028({
        error: 'Transaction already closed: A query cannot be executed on a committed transaction.',
      }),
    ],
    [
      'P2028 sobre una transacción revertida (error de programación)',
      p2028({
        error:
          'Transaction already closed: A query cannot be executed on a transaction that was rolled back.',
      }),
    ],
    [
      'P2028 con una transacción inexistente',
      p2028({
        error:
          "Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.",
      }),
    ],
    ['P2028 con un nivel de aislamiento inválido', p2028({ error: 'Invalid isolation level' })],
    ['P2028 sin meta', p2028()],
    ['P2028 con meta sin error', p2028({ otro: NO_INICIADA })],
    ['P2028 con meta.error que no es texto', p2028({ error: { mensaje: NO_INICIADA } })],
    ['P2028 con meta.error numérico', p2028({ error: 2028 })],
    [
      'P2028 con el texto en otro lugar de meta.error',
      p2028({ error: `Otro motivo: ${NO_INICIADA}` }),
    ],
    [
      'P2028 con el texto solo en el mensaje (no en meta.error)',
      p2028({ error: 'Invalid isolation level' }, NO_INICIADA),
    ],
    [
      'otro código con el mismo meta.error',
      new Prisma.PrismaClientKnownRequestError('falla', {
        code: 'P2034',
        clientVersion: '5.22.0',
        meta: { error: NO_INICIADA },
      }),
    ],
    ['un Error cualquiera con el texto', new Error(NO_INICIADA)],
  ])('%s: NO es base caída (sigue como 500)', (_caso, error) => {
    expect(esBaseDeDatosNoDisponible(error)).toBe(false);
  });

  it.each([
    ['desconocido con otro SQLSTATE (23514)', desconocido('23514')],
    [
      'desconocido sin SQLSTATE',
      new Prisma.PrismaClientUnknownRequestError('falla', { clientVersion: '5.22.0' }),
    ],
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

  it('traduce un P2028 transitorio sin exponer el texto del motor ni la consulta', async () => {
    const error = await conLaBaseDeDatos(() =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError(
          'Invalid `prisma.$queryRaw()` invocation: Transaction API error: Transaction already closed',
          {
            code: 'P2028',
            clientVersion: '5.22.0',
            meta: {
              error:
                'Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6951 ms passed since the start of the transaction.',
            },
          },
        ),
      ),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
    expect((error as Error).message).toBe('La base de datos no está disponible.');
    expect((error as Error).cause).toBeUndefined();
  });

  it('deja pasar un P2028 de programación tal cual (sigue como 500)', async () => {
    const original = new Prisma.PrismaClientKnownRequestError('falla', {
      code: 'P2028',
      clientVersion: '5.22.0',
      meta: {
        error: 'Transaction already closed: A query cannot be executed on a committed transaction.',
      },
    });
    await expect(conLaBaseDeDatos(() => Promise.reject(original))).rejects.toBe(original);
  });

  it('deja pasar cualquier otro error tal cual', async () => {
    const original = conocido('P2010', { code: '23514' });
    await expect(conLaBaseDeDatos(() => Promise.reject(original))).rejects.toBe(original);
  });
});
