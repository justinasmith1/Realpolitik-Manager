import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DIRECTORIO_ALMACENAMIENTO_POR_DEFECTO, EnvError, loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://usuario:clave-secreta@localhost:5432/base',
  CORS_ORIGINS: 'http://localhost:5173',
  // Sin NODE_ENV, el almacenamiento tiene que ser explícito (ver "almacenamiento" abajo).
  ALMACENAMIENTO: 'memoria',
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

describe('loadEnv: almacenamiento de documentos', () => {
  const base = { DATABASE_URL: valid.DATABASE_URL, CORS_ORIGINS: valid.CORS_ORIGINS };
  const BASE_DIR = path.resolve('/srv/backend');
  const s3 = {
    ALMACENAMIENTO: 's3',
    S3_ENDPOINT: 'https://proyecto.supabase.co/storage/v1/s3',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'documentos',
    S3_ACCESS_KEY_ID: 'id-de-acceso',
    S3_SECRET_ACCESS_KEY: 'clave-s3-secreta',
  };

  it('en tests usa memoria por defecto', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).almacenamiento).toEqual({ tipo: 'memoria' });
  });

  it('en desarrollo (NODE_ENV definido) usa disco, en la carpeta por defecto', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development' }, BASE_DIR).almacenamiento).toEqual({
      tipo: 'disco',
      directorio: path.join(BASE_DIR, DIRECTORIO_ALMACENAMIENTO_POR_DEFECTO),
    });
  });

  it('la carpeta del disco se puede elegir, relativa a donde corre el backend', () => {
    const env = loadEnv(
      { ...base, NODE_ENV: 'development', ALMACENAMIENTO_DIRECTORIO: 'datos/archivos' },
      BASE_DIR,
    );
    expect(env.almacenamiento).toEqual({
      tipo: 'disco',
      directorio: path.join(BASE_DIR, 'datos', 'archivos'),
    });
  });

  it('sin NODE_ENV no elige disco por defecto: un deploy que lo olvidó no guarda en el contenedor', () => {
    expect(() => loadEnv(base)).toThrow('ALMACENAMIENTO');
  });

  it.each(['memoria', 'disco'])('en producción rechaza %s', (tipo) => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', ALMACENAMIENTO: tipo })).toThrow(
      'ALMACENAMIENTO',
    );
  });

  it('en producción exige elegir el almacenamiento', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow('ALMACENAMIENTO');
  });

  it('en producción acepta S3 completo, con el bucket en la ruta por defecto', () => {
    const env = loadEnv({ ...base, ...s3, NODE_ENV: 'production' });
    expect(env.almacenamiento).toEqual({
      tipo: 's3',
      s3: {
        endpoint: s3.S3_ENDPOINT,
        region: 'us-east-1',
        bucket: 'documentos',
        accessKeyId: 'id-de-acceso',
        secretAccessKey: 'clave-s3-secreta',
        forcePathStyle: true,
      },
    });
  });

  it('las variables del almacenamiento no quedan sueltas en el resultado', () => {
    const env = loadEnv({ ...base, ...s3, NODE_ENV: 'production' });
    expect(env).not.toHaveProperty('S3_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('ALMACENAMIENTO');
  });

  it('S3_FORCE_PATH_STYLE=false pone el bucket en el subdominio', () => {
    const env = loadEnv({ ...base, ...s3, NODE_ENV: 'test', S3_FORCE_PATH_STYLE: 'false' });
    expect(env.almacenamiento).toMatchObject({ s3: { forcePathStyle: false } });
  });

  it('S3 nombra todas las variables que faltan, sin mostrar valores', () => {
    const { S3_BUCKET: _b, S3_SECRET_ACCESS_KEY: _s, ...incompleto } = s3;
    const cargar = () => loadEnv({ ...base, ...incompleto, NODE_ENV: 'production' });
    expect(cargar).toThrow('S3_BUCKET');
    expect(cargar).toThrow('S3_SECRET_ACCESS_KEY');
    expect(cargar).not.toThrow('id-de-acceso');
  });

  it('en producción exige un endpoint HTTPS; en desarrollo admite HTTP (p. ej. MinIO local)', () => {
    const http = { ...s3, S3_ENDPOINT: 'http://localhost:9000' };
    expect(() => loadEnv({ ...base, ...http, NODE_ENV: 'production' })).toThrow('S3_ENDPOINT');
    expect(loadEnv({ ...base, ...http, NODE_ENV: 'development' }).almacenamiento.tipo).toBe('s3');
  });

  it.each([
    ['un tipo desconocido', { ALMACENAMIENTO: 'ftp' }, 'ALMACENAMIENTO'],
    ['un bucket vacío', { ...s3, S3_BUCKET: '  ' }, 'S3_BUCKET'],
    ['un endpoint que no es URL', { ...s3, S3_ENDPOINT: 'supabase' }, 'S3_ENDPOINT'],
    [
      'un S3_FORCE_PATH_STYLE que no es booleano',
      { ...s3, S3_FORCE_PATH_STYLE: 'si' },
      'S3_FORCE_PATH_STYLE',
    ],
  ])('rechaza %s', (_caso, variables, nombre) => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'test', ...variables })).toThrow(nombre);
  });

  it('el mensaje de un S3 inválido no incluye la clave secreta', () => {
    const cargar = () =>
      loadEnv({ ...base, ...s3, NODE_ENV: 'production', S3_ENDPOINT: 'http://inseguro.example' });
    expect(cargar).toThrow(EnvError);
    expect(cargar).not.toThrow('clave-s3-secreta');
  });
});
