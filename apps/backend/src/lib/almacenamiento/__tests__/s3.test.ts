import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  esErrorAlmacenamiento,
  generarClaveDocumento,
  type ClaveAlmacenamiento,
} from '../almacenamiento';
import { AlmacenamientoS3, crearClienteS3, type ClienteS3 } from '../s3';

import { codigoDeError, probarContratoDeAlmacenamiento } from './contratoAlmacenamiento';

const BUCKET = 'documentos-privados';

/** Un error con la forma de los del SDK: `name` y el status HTTP en `$metadata`. */
const errorS3 = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

/**
 * Un bucket S3 simulado en memoria, que responde como el SDK: HEAD de un objeto inexistente es
 * `NotFound` (404), GET es `NoSuchKey` (404) y DELETE responde bien exista o no. Registra los
 * comandos recibidos. `fallas` hace fallar el próximo comando de ese tipo con el error dado.
 */
class BucketSimulado {
  readonly objetos = new Map<string, Buffer>();
  readonly comandos: unknown[] = [];
  readonly fallas = new Map<string, Error>();

  /** Como el SDK: todo resultado o error llega como promesa. */
  send(comando: unknown): Promise<unknown> {
    return new Promise((resolve) => resolve(this.#responder(comando)));
  }

  #responder(comando: unknown): unknown {
    this.comandos.push(comando);
    const nombre = (comando as object).constructor.name;
    const falla = this.fallas.get(nombre);
    if (falla !== undefined) {
      this.fallas.delete(nombre);
      throw falla;
    }
    if (comando instanceof HeadObjectCommand) {
      if (!this.objetos.has(comando.input.Key ?? '')) throw errorS3('NotFound', 404);
      return {};
    }
    if (comando instanceof PutObjectCommand) {
      this.objetos.set(comando.input.Key ?? '', Buffer.from(comando.input.Body as Uint8Array));
      return {};
    }
    if (comando instanceof GetObjectCommand) {
      const guardado = this.objetos.get(comando.input.Key ?? '');
      if (guardado === undefined) throw errorS3('NoSuchKey', 404);
      return { Body: Readable.from(Buffer.from(guardado)) };
    }
    if (comando instanceof DeleteObjectCommand) {
      this.objetos.delete(comando.input.Key ?? '');
      return {};
    }
    throw new Error(`Comando inesperado: ${nombre}`);
  }
}

const conBucket = (bucket: BucketSimulado) => new AlmacenamientoS3(bucket, BUCKET);

const objeto = () => ({
  clave: generarClaveDocumento(),
  contenido: Buffer.from('%PDF-1.7'),
  tipoContenido: 'application/pdf',
});

describe('AlmacenamientoS3', () => {
  probarContratoDeAlmacenamiento(() => conBucket(new BucketSimulado()));

  it('guardar consulta antes con HEAD y sube con PUT al bucket, con tipo y largo', async () => {
    const bucket = new BucketSimulado();
    const guardado = objeto();

    await conBucket(bucket).guardar(guardado);

    expect(bucket.comandos.map((c) => (c as object).constructor.name)).toEqual([
      'HeadObjectCommand',
      'PutObjectCommand',
    ]);
    expect((bucket.comandos[1] as PutObjectCommand).input).toMatchObject({
      Bucket: BUCKET,
      Key: guardado.clave,
      ContentType: 'application/pdf',
      ContentLength: guardado.contenido.byteLength,
    });
  });

  it('una clave inválida no llega al proveedor', async () => {
    const bucket = new BucketSimulado();
    expect(await codigoDeError(conBucket(bucket).existe('../x' as ClaveAlmacenamiento))).toBe(
      'CLAVE_INVALIDA',
    );
    expect(bucket.comandos).toEqual([]);
  });

  it('si el objeto ya existe, no sube nada (YA_EXISTE)', async () => {
    const bucket = new BucketSimulado();
    const guardado = objeto();
    await conBucket(bucket).guardar(guardado);
    bucket.comandos.length = 0;

    expect(await codigoDeError(conBucket(bucket).guardar(guardado))).toBe('YA_EXISTE');
    expect(bucket.comandos.map((c) => (c as object).constructor.name)).toEqual([
      'HeadObjectCommand',
    ]);
  });

  it('un error del proveedor al subir es NO_DISPONIBLE, con la causa y sin detalles en el mensaje', async () => {
    const bucket = new BucketSimulado();
    const causa = errorS3('InternalError', 500);
    bucket.fallas.set('PutObjectCommand', causa);

    await expect(conBucket(bucket).guardar(objeto())).rejects.toSatisfy(
      (error: unknown) =>
        esErrorAlmacenamiento(error, 'NO_DISPONIBLE') &&
        error.cause === causa &&
        !error.message.includes('InternalError'),
    );
  });

  it('un 403 (credenciales o permisos) no se confunde con "no existe"', async () => {
    const bucket = new BucketSimulado();
    bucket.fallas.set('HeadObjectCommand', errorS3('Forbidden', 403));
    expect(await codigoDeError(conBucket(bucket).existe(generarClaveDocumento()))).toBe(
      'NO_DISPONIBLE',
    );

    bucket.fallas.set('HeadObjectCommand', errorS3('Forbidden', 403));
    expect(await codigoDeError(conBucket(bucket).guardar(objeto()))).toBe('NO_DISPONIBLE');
    expect(bucket.comandos.some((c) => c instanceof PutObjectCommand)).toBe(false);
  });

  it('un error de red al leer es NO_DISPONIBLE', async () => {
    const bucket = new BucketSimulado();
    bucket.fallas.set('GetObjectCommand', new Error('socket hang up'));
    expect(await codigoDeError(conBucket(bucket).obtener(generarClaveDocumento()))).toBe(
      'NO_DISPONIBLE',
    );
  });

  it('un 404 al eliminar (proveedores que lo devuelven) no es un error', async () => {
    const bucket = new BucketSimulado();
    bucket.fallas.set('DeleteObjectCommand', errorS3('NoSuchKey', 404));
    await expect(conBucket(bucket).eliminar(generarClaveDocumento())).resolves.toBeUndefined();
  });

  it('una falla de permisos al eliminar es NO_DISPONIBLE (la compensación puede reintentar)', async () => {
    const bucket = new BucketSimulado();
    bucket.fallas.set('DeleteObjectCommand', errorS3('AccessDenied', 403));
    expect(await codigoDeError(conBucket(bucket).eliminar(generarClaveDocumento()))).toBe(
      'NO_DISPONIBLE',
    );
  });

  it('una respuesta sin contenido legible es NO_DISPONIBLE', async () => {
    const cliente = {
      send: () => Promise.resolve({ Body: 'no es un stream' }),
    } as unknown as ClienteS3;
    expect(
      await codigoDeError(new AlmacenamientoS3(cliente, BUCKET).obtener(generarClaveDocumento())),
    ).toBe('NO_DISPONIBLE');
  });
});

describe('crearClienteS3', () => {
  it('usa el bucket en la ruta y checksums solo cuando la operación los exige', async () => {
    const cliente = crearClienteS3({
      endpoint: 'https://proyecto.supabase.co/storage/v1/s3',
      region: 'us-east-1',
      bucket: BUCKET,
      accessKeyId: 'id-de-prueba',
      secretAccessKey: 'clave-de-prueba',
      forcePathStyle: true,
    });

    expect(cliente.config.forcePathStyle).toBe(true);
    expect(await cliente.config.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
    expect(await cliente.config.responseChecksumValidation()).toBe('WHEN_REQUIRED');
    cliente.destroy();
  });
});
