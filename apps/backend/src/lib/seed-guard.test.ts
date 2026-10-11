import { describe, expect, it } from 'vitest';

import { verificarSeedPermitido } from './seed-guard';

const local = 'postgresql://usuario:clave@localhost:5432/base?schema=public';

describe('verificarSeedPermitido', () => {
  it.each([
    ['localhost', 'postgresql://u:p@localhost:5432/base?schema=public'],
    ['127.0.0.1', 'postgresql://u:p@127.0.0.1:5433/base'],
    ['::1', 'postgresql://u:p@[::1]:5432/base'],
    ['LOCALHOST en mayúsculas', 'postgres://u:p@LOCALHOST/base'],
  ])('permite una base local (%s) en desarrollo', (_caso, DATABASE_URL) => {
    expect(() => verificarSeedPermitido({ NODE_ENV: 'development', DATABASE_URL })).not.toThrow();
  });

  it('permite NODE_ENV=test y NODE_ENV sin definir (el valor por defecto en local)', () => {
    expect(() => verificarSeedPermitido({ NODE_ENV: 'test', DATABASE_URL: local })).not.toThrow();
    expect(() => verificarSeedPermitido({ DATABASE_URL: local })).not.toThrow();
  });

  it('se niega con NODE_ENV=production aunque la base sea local', () => {
    expect(() => verificarSeedPermitido({ NODE_ENV: 'production', DATABASE_URL: local })).toThrow(
      'NODE_ENV=production',
    );
  });

  it.each([
    ['un host remoto', 'postgresql://u:p@db.ejemplo.example:5432/base'],
    ['una IP remota', 'postgresql://u:p@10.0.0.5:5432/base'],
    ['un host interno de Railway', 'postgresql://u:p@postgres.railway.internal:5432/railway'],
    ['un host que empieza con localhost', 'postgresql://u:p@localhost.ejemplo.example/base'],
    ['un socket sin host', 'postgresql:///base?host=/var/run/postgresql'],
    ['una URL ilegible', 'esto no es una url'],
    ['una URL vacía', ''],
  ])('se niega con %s, aunque NODE_ENV no sea production', (_caso, DATABASE_URL) => {
    expect(() => verificarSeedPermitido({ NODE_ENV: 'development', DATABASE_URL })).toThrow(
      'solo puede ejecutarse contra una base local',
    );
  });

  it('se niega si NODE_ENV no está definido y la base es remota (el proveedor lo olvidó)', () => {
    expect(() =>
      verificarSeedPermitido({ DATABASE_URL: 'postgresql://u:p@db.ejemplo.example/base' }),
    ).toThrow('solo puede ejecutarse contra una base local');
  });

  it('se niega si falta DATABASE_URL', () => {
    expect(() => verificarSeedPermitido({ NODE_ENV: 'development' })).toThrow(
      'solo puede ejecutarse contra una base local',
    );
  });

  it('los mensajes no revelan la contraseña ni el host de la base', () => {
    const secreta = 'postgresql://usuario:clave-secreta@db.interno.example:5432/base';
    let mensaje = '';
    try {
      verificarSeedPermitido({ NODE_ENV: 'production', DATABASE_URL: secreta });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    try {
      verificarSeedPermitido({ NODE_ENV: 'development', DATABASE_URL: secreta });
    } catch (error) {
      mensaje += (error as Error).message;
    }
    expect(mensaje).not.toBe('');
    expect(mensaje).not.toContain('clave-secreta');
    expect(mensaje).not.toContain('db.interno.example');
  });
});
