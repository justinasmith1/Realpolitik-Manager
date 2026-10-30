import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

// Almacenamiento de los archivos de documentos (HU2.8, ADR-0004). Es un puerto propio: la lógica
// de negocio depende de esta interfaz y nunca de un proveedor. Las implementaciones (memoria,
// disco, S3-compatible) viven al lado y se eligen por configuración (`crearAlmacenamiento`).
//
// Lo que este puerto NO hace, a propósito:
// - No autoriza: quien llama (el servicio de documentos) decide si el pedido puede ver o escribir
//   un documento antes de llegar acá. Por eso no hay un método que entregue el objeto "a cualquiera".
// - No genera URLs (ni públicas ni firmadas): el contenido sale siempre por el backend.
// - No guarda metadatos de negocio: el tipo, el período, el nombre y el hash están en PostgreSQL
//   (`Documento`). Acá solo hay bytes bajo una clave.

/** Prefijo de todas las claves de documentos. */
const PREFIJO = 'documentos/';

/**
 * Forma exacta de una clave: `documentos/` + un UUID v4 en minúscula. Es una lista blanca: no
 * admite `..`, barras de más, `\`, mayúsculas, espacios ni codificaciones, así que una clave
 * nunca puede salir de su carpeta (path traversal) ni pisar otra cosa del bucket.
 */
const CLAVE_VALIDA =
  /^documentos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Clave opaca de un objeto: no lleva el nombre del archivo, datos del cliente, bucket ni
 * proveedor. Es la que se guarda en `Documento.claveAlmacenamiento`; cambiar de proveedor no la
 * cambia. El tipo "marcado" obliga a pasar por `generarClaveDocumento` o `exigirClaveValida`.
 */
export type ClaveAlmacenamiento = string & { readonly __clave: 'ClaveAlmacenamiento' };

/** Una clave nueva, aleatoria (UUID v4). Dos cargas nunca comparten clave. */
export function generarClaveDocumento(): ClaveAlmacenamiento {
  return `${PREFIJO}${randomUUID()}` as ClaveAlmacenamiento;
}

export function esClaveValida(valor: unknown): valor is ClaveAlmacenamiento {
  return typeof valor === 'string' && CLAVE_VALIDA.test(valor);
}

/**
 * La clave, si tiene la forma exacta; si no, `CLAVE_INVALIDA`. Sirve para convertir el texto
 * guardado en la base en una clave, y la usan todos los adaptadores antes de tocar nada (aunque
 * el tipo ya la marque como válida: un `as` no la valida).
 */
export function exigirClaveValida(valor: unknown): ClaveAlmacenamiento {
  if (!esClaveValida(valor)) {
    throw new ErrorAlmacenamiento('CLAVE_INVALIDA', 'La clave de almacenamiento no es válida.');
  }
  return valor;
}

// ─── Errores ──────────────────────────────────────────────────────────────────

/**
 * Por qué falló una operación. Pensado para las compensaciones (ADR-0004, punto 9):
 * - `CLAVE_INVALIDA`: error de programación; no se reintenta.
 * - `YA_EXISTE`: `guardar` no sobrescribe. Con claves aleatorias es un bug o un reintento.
 * - `NO_ENCONTRADO`: el objeto no está (`obtener`).
 * - `NO_DISPONIBLE`: el almacenamiento falló (red, permisos, disco, proveedor). Puede ser
 *   transitorio: se puede reintentar. El error original queda en `cause`.
 */
export type CodigoErrorAlmacenamiento =
  'CLAVE_INVALIDA' | 'YA_EXISTE' | 'NO_ENCONTRADO' | 'NO_DISPONIBLE';

/**
 * Error controlado de un adaptador. El mensaje es genérico: nunca lleva credenciales, endpoints
 * ni contenido. El detalle técnico va en `cause` y no debe llegar a una respuesta HTTP.
 */
export class ErrorAlmacenamiento extends Error {
  constructor(
    readonly codigo: CodigoErrorAlmacenamiento,
    mensaje: string,
    opciones?: { cause?: unknown },
  ) {
    super(mensaje, opciones);
    this.name = 'ErrorAlmacenamiento';
  }
}

export function esErrorAlmacenamiento(
  error: unknown,
  codigo?: CodigoErrorAlmacenamiento,
): error is ErrorAlmacenamiento {
  return error instanceof ErrorAlmacenamiento && (codigo === undefined || error.codigo === codigo);
}

/** El almacenamiento falló al `accion` (por ejemplo, "guardar el objeto"). */
export const noDisponible = (accion: string, cause: unknown): ErrorAlmacenamiento =>
  new ErrorAlmacenamiento('NO_DISPONIBLE', `No se pudo ${accion} en el almacenamiento.`, { cause });

export const yaExiste = (): ErrorAlmacenamiento =>
  new ErrorAlmacenamiento('YA_EXISTE', 'Ya hay un objeto con esa clave: no se sobrescribe.');

export const noEncontrado = (): ErrorAlmacenamiento =>
  new ErrorAlmacenamiento('NO_ENCONTRADO', 'El objeto no existe en el almacenamiento.');

// ─── Contrato ─────────────────────────────────────────────────────────────────

export interface ObjetoAGuardar {
  clave: ClaveAlmacenamiento;
  contenido: Uint8Array;
  /** MIME ya validado por el backend. El adaptador lo informa al proveedor; no lo valida. */
  tipoContenido: string;
}

export interface ObjetoObtenido {
  /** El contenido, para enviarlo sin cargarlo entero en memoria. Se lee una sola vez. */
  contenido: Readable;
}

export type OperacionAlmacenamiento = 'guardar' | 'obtener' | 'existe' | 'eliminar';

/**
 * Las cuatro operaciones que soportan todos los proveedores S3-compatibles evaluados. Todas
 * validan la clave antes de hacer nada (`CLAVE_INVALIDA`) y traducen cualquier otra falla a un
 * `ErrorAlmacenamiento`: quien llama nunca ve un error propio de un proveedor.
 */
export interface AlmacenamientoDocumentos {
  /**
   * Guarda el objeto. **No sobrescribe**: si la clave ya existe, `YA_EXISTE` y lo guardado no
   * cambia. Si falla (`NO_DISPONIBLE`), no queda nada a medio escribir bajo esa clave.
   */
  guardar(objeto: ObjetoAGuardar): Promise<void>;
  /** El contenido del objeto, o `NO_ENCONTRADO`. */
  obtener(clave: ClaveAlmacenamiento): Promise<ObjetoObtenido>;
  /** Si el objeto existe. Una falla del almacenamiento es `NO_DISPONIBLE`, nunca `false`. */
  existe(clave: ClaveAlmacenamiento): Promise<boolean>;
  /**
   * Borra el objeto. **Idempotente**: si no existe, no es un error. Así una compensación se
   * puede reintentar sin saber si el intento anterior llegó a borrar.
   */
  eliminar(clave: ClaveAlmacenamiento): Promise<void>;
}
