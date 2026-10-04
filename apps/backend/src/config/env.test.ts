import { describe, expect, it } from 'vitest';

import { EnvError, loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://usuario:clave-secreta@localhost:5432/base',
  CORS_ORIGINS: 'http://localhost:5173',
};

describe('loadEnv', () => {
  it('aplica los valores por defecto', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('convierte PORT a número y separa CORS_ORIGINS por comas', () => {
    const env = loadEnv({
      ...valid,
      PORT: '4000',
      CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => loadEnv({ CORS_ORIGINS: valid.CORS_ORIGINS })).toThrow('DATABASE_URL');
  });

  it('falla si falta CORS_ORIGINS', () => {
    expect(() => loadEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow('CORS_ORIGINS');
  });

  it.each([['0'], ['65536'], ['abc'], ['3000.5']])('rechaza PORT inválido (%s)', (port) => {
    expect(() => loadEnv({ ...valid, PORT: port })).toThrow('PORT');
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
  });

  it('rechaza orígenes con barra final', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: 'http://localhost:5173/' })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('nunca incluye el valor de las variables en el mensaje', () => {
    const invalid = { ...valid, DATABASE_URL: 'mysql://usuario:clave-secreta@host/db' };
    expect(() => loadEnv(invalid)).toThrow(EnvError);
    expect(() => loadEnv(invalid)).toThrow('DATABASE_URL');
    expect(() => loadEnv(invalid)).not.toThrow('clave-secreta');
  });
});
