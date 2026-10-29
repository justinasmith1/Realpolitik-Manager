import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  ErrorAlmacenamiento,
  exigirClaveValida,
  noDisponible,
  noEncontrado,
  yaExiste,
  type AlmacenamientoDocumentos,
  type ClaveAlmacenamiento,
  type ObjetoAGuardar,
  type ObjetoObtenido,
} from './almacenamiento';

/**
 * Conexión a un almacenamiento S3-compatible (Supabase Storage, Cloudflare R2, MinIO, AWS S3).
 * Sale de las variables de entorno del backend: nunca llega al frontend.
 */
export interface ConfigS3 {
  /** URL del endpoint S3 del proveedor (en Supabase: `https://<proyecto>.supabase.co/storage/v1/s3`). */
  endpoint: string;
  region: string;
  /** Bucket PRIVADO: este adaptador no publica nada ni genera URLs. */
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `bucket` en la ruta (`<endpoint>/<bucket>/<clave>`) y no en el subdominio. Supabase lo exige. */
  forcePathStyle: boolean;
}

/**
 * El cliente del SDK de AWS, usado como cliente S3 genérico. Solo las operaciones básicas de
 * ADR-0004 (Put, Get, Head, Delete): sin versionado, escrituras condicionales, tags ni cifrado
 * del lado del servidor, que Supabase no soporta.
 *
 * Checksums en `WHEN_REQUIRED`: desde 2025 el SDK manda por defecto checksums CRC en cada subida
 * (`WHEN_SUPPORTED`), y varios proveedores S3-compatibles rechazan esas cabeceras. Con
 * `WHEN_REQUIRED` solo se mandan cuando la operación los exige (ninguna de las cuatro).
 */
export function crearClienteS3(config: ConfigS3): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Lo único que el adaptador usa del cliente: permite probarlo sin red. */
export type ClienteS3 = Pick<S3Client, 'send'>;

/**
 * `true` si el proveedor dijo que el objeto no existe. El SDK lo informa como `NotFound` (HEAD,
 * que no tiene cuerpo) o `NoSuchKey` (GET); se mira también el status por si otro proveedor usa
 * otro nombre. Un 403 NO es "no existe": son credenciales o permisos mal configurados.
 */
function esNoEncontrado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, $metadata } = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

/** Almacenamiento en un bucket S3-compatible privado (producción). */
export class AlmacenamientoS3 implements AlmacenamientoDocumentos {
  constructor(
    private readonly cliente: ClienteS3,
    private readonly bucket: string,
  ) {}

  /**
   * No sobrescribe: consulta antes con HEAD. Entre el HEAD y el PUT hay una ventana en la que otro
   * pedido podría escribir la misma clave; con claves UUID v4 generadas por el backend eso no pasa
   * en la práctica. La escritura condicional (`If-None-Match: *`), que cerraría esa ventana, no
   * está documentada en Supabase Storage: no se usa.
   */
  async guardar({ clave, contenido, tipoContenido }: ObjetoAGuardar): Promise<void> {
    const valida = exigirClaveValida(clave);
    if (await this.existe(valida)) {
      throw yaExiste();
    }
    try {
      await this.cliente.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: valida,
          Body: contenido,
          ContentType: tipoContenido,
          ContentLength: contenido.byteLength,
        }),
      );
    } catch (error) {
      throw noDisponible('guardar el objeto', error);
    }
  }

  async obtener(clave: ClaveAlmacenamiento): Promise<ObjetoObtenido> {
    const valida = exigirClaveValida(clave);
    let cuerpo: unknown;
    try {
      ({ Body: cuerpo } = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: valida }),
      ));
    } catch (error) {
      if (esNoEncontrado(error)) throw noEncontrado();
      throw noDisponible('leer el objeto', error);
    }
    // En Node, el SDK devuelve el cuerpo como un stream (`IncomingMessage`).
    if (!(cuerpo instanceof Readable)) {
      throw new ErrorAlmacenamiento(
        'NO_DISPONIBLE',
        'El almacenamiento devolvió el objeto sin un contenido legible.',
      );
    }
    return { contenido: cuerpo };
  }

  async existe(clave: ClaveAlmacenamiento): Promise<boolean> {
    const valida = exigirClaveValida(clave);
    try {
      await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: valida }));
      return true;
    } catch (error) {
      if (esNoEncontrado(error)) return false;
      throw noDisponible('consultar el objeto', error);
    }
  }

  /** S3 responde 204 aunque el objeto no exista; un 404 de otro proveedor también es éxito. */
  async eliminar(clave: ClaveAlmacenamiento): Promise<void> {
    const valida = exigirClaveValida(clave);
    try {
      await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: valida }));
    } catch (error) {
      if (esNoEncontrado(error)) return;
      throw noDisponible('eliminar el objeto', error);
    }
  }
}
