import { inflateRawSync } from 'node:zlib';

import {
  FORMATOS_DE_DOCUMENTO,
  MENSAJE_FORMATO_DOCUMENTO,
  MENSAJE_TAMANIO_DOCUMENTO,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
  type TipoContenidoDocumentoType,
} from '@realpolitik/shared';

import { validationError, type AppError } from '../../errors/app-error';

// Qué es realmente un archivo subido (HU2.8, ADR-0004). El formato se decide por el CONTENIDO
// (la firma de los primeros bytes y, en un DOCX, su estructura interna); la extensión y el MIME
// que declara el navegador solo se comparan contra eso. Funciones puras: no leen la base ni el
// almacenamiento.

const DOCX: TipoContenidoDocumentoType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Lo que declara `[Content_Types].xml` de un documento de Word. Una planilla (`.xlsx`), una
 * presentación o un Word con macros (`.docm`, `…macroEnabled.main+xml`) tienen otro valor.
 */
const CONTENIDO_PRINCIPAL_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** Tope al descomprimir `[Content_Types].xml`: es un XML chico. Corta un "zip bomb". */
const MAXIMO_DESCOMPRIMIDO = 1024 * 1024;

/** Tope de entradas del ZIP que se recorren. Un DOCX real tiene decenas. */
const MAXIMO_ENTRADAS = 5000;

const empiezaCon = (contenido: Buffer, firma: readonly number[]): boolean =>
  contenido.length >= firma.length && firma.every((byte, i) => contenido[i] === byte);

interface EntradaZip {
  metodo: number;
  tamanioComprimido: number;
  inicioCabeceraLocal: number;
}

/**
 * Las entradas de un ZIP, leídas de su directorio central (no de las cabeceras locales, que con
 * "data descriptors" no traen los tamaños). `null` si no es un ZIP legible o es ZIP64 (un DOCX
 * de 10 MB nunca lo necesita).
 */
function entradasDeZip(zip: Buffer): Map<string, EntradaZip> | null {
  // El registro final (EOCD) está en los últimos 22 bytes más un comentario de hasta 64 KB.
  if (zip.length < 22) return null;
  const desde = Math.max(0, zip.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = zip.length - 22; i >= desde; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cantidad = zip.readUInt16LE(eocd + 10);
  const inicio = zip.readUInt32LE(eocd + 16);
  if (cantidad === 0xffff || inicio === 0xffffffff || cantidad > MAXIMO_ENTRADAS) return null;

  const entradas = new Map<string, EntradaZip>();
  let p = inicio;
  for (let n = 0; n < cantidad; n += 1) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) return null;
    const largoNombre = zip.readUInt16LE(p + 28);
    const fin = p + 46 + largoNombre;
    if (fin > zip.length) return null;
    entradas.set(zip.toString('utf8', p + 46, fin), {
      metodo: zip.readUInt16LE(p + 10),
      tamanioComprimido: zip.readUInt32LE(p + 20),
      inicioCabeceraLocal: zip.readUInt32LE(p + 42),
    });
    p = fin + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return entradas;
}

/** El contenido de una entrada (sin comprimir o "deflate"), o `null` si no se puede leer. */
function leerEntrada(zip: Buffer, entrada: EntradaZip): Buffer | null {
  const local = entrada.inicioCabeceraLocal;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
  const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const fin = inicio + entrada.tamanioComprimido;
  if (fin > zip.length) return null;
  const datos = zip.subarray(inicio, fin);
  if (entrada.metodo === 0) return datos.length <= MAXIMO_DESCOMPRIMIDO ? datos : null;
  if (entrada.metodo !== 8) return null;
  try {
    return inflateRawSync(datos, { maxOutputLength: MAXIMO_DESCOMPRIMIDO });
  } catch {
    return null;
  }
}

/**
 * `true` si el ZIP es un documento de Word: tiene `word/document.xml` y su `[Content_Types].xml`
 * declara el contenido principal de Word. Un ZIP cualquiera, un `.xlsx` o un `.docm` no pasan.
 */
function esDocx(zip: Buffer): boolean {
  const entradas = entradasDeZip(zip);
  const tipos = entradas?.get('[Content_Types].xml');
  if (entradas === null || tipos === undefined || !entradas.has('word/document.xml')) {
    return false;
  }
  return leerEntrada(zip, tipos)?.toString('utf8').includes(CONTENIDO_PRINCIPAL_DOCX) ?? false;
}

/** El formato admitido que corresponde al contenido, o `null` si no es ninguno. */
export function detectarTipoContenido(contenido: Buffer): TipoContenidoDocumentoType | null {
  if (empiezaCon(contenido, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (empiezaCon(contenido, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (empiezaCon(contenido, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empiezaCon(contenido, [0x50, 0x4b, 0x03, 0x04]) && esDocx(contenido)) return DOCX;
  return null;
}

/**
 * MIME que el navegador puede declarar para cada formato, además del propio. Un navegador sin
 * Office instalado suele mandar un DOCX como `application/octet-stream`; ese genérico (o nada) se
 * acepta en cualquier formato porque no contradice el contenido.
 */
const MIME_EQUIVALENTES: Partial<Record<TipoContenidoDocumentoType, readonly string[]>> = {
  'image/jpeg': ['image/jpg', 'image/pjpeg'],
};
const MIME_GENERICOS = ['', 'application/octet-stream'];

export interface ArchivoRecibido {
  /** El nombre que mandó el navegador, ya sin carpetas. */
  nombreOriginal: string;
  /** El MIME que declaró el navegador. No se confía en él: solo se compara. */
  tipoMimeDeclarado: string;
  contenido: Buffer;
}

const errorDeArchivo = (mensaje: string): AppError =>
  validationError([{ campo: 'archivo', mensaje }]);

/**
 * El formato del archivo, si es admitido y coherente; si no, `400 VALIDATION_ERROR` en el campo
 * `archivo`. Comprueba, en orden: tamaño, contenido real, extensión y MIME declarado.
 */
export function validarArchivo({
  nombreOriginal,
  tipoMimeDeclarado,
  contenido,
}: ArchivoRecibido): TipoContenidoDocumentoType {
  if (contenido.length === 0 || contenido.length > TAMANIO_MAXIMO_DOCUMENTO_BYTES) {
    throw errorDeArchivo(MENSAJE_TAMANIO_DOCUMENTO);
  }
  const tipoContenido = detectarTipoContenido(contenido);
  if (tipoContenido === null) {
    throw errorDeArchivo(MENSAJE_FORMATO_DOCUMENTO);
  }

  const { etiqueta, extensiones } = FORMATOS_DE_DOCUMENTO[tipoContenido];
  const punto = nombreOriginal.lastIndexOf('.');
  const extension = punto < 0 ? '' : nombreOriginal.slice(punto + 1).toLowerCase();
  if (!extensiones.includes(extension)) {
    throw errorDeArchivo(
      `La extensión del archivo no coincide con su contenido (${etiqueta}): usá ${extensiones
        .map((e) => `.${e}`)
        .join(' o ')}.`,
    );
  }

  const declarado = (tipoMimeDeclarado.split(';')[0] ?? '').trim().toLowerCase();
  const aceptados = [tipoContenido, ...(MIME_EQUIVALENTES[tipoContenido] ?? []), ...MIME_GENERICOS];
  if (!aceptados.includes(declarado)) {
    throw errorDeArchivo(`El tipo del archivo no coincide con su contenido (${etiqueta}).`);
  }
  return tipoContenido;
}
