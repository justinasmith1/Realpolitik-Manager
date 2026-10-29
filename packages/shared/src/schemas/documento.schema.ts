import { z } from 'zod';

import { sinCaracteresDeControl } from './campos.js';
import { enteroDeQuery } from './listarRendicionesQuery.schema.js';
import { AnioSchema, MENSAJE_ANIO, MENSAJE_MES, MesSchema } from './rendicion.schema.js';
import { TipoDocumentoIdSchema } from './requisitoCliente.schema.js';

// Documentos cargados una sola vez y aplicados a ítems de rendiciones (HU2.8, ADR-0004). El
// archivo no viaja en estos schemas: vive en el almacenamiento de objetos y la base guarda sus
// metadatos (`Documento`, `apps/backend/prisma/schema.prisma`).

// ─── Formatos y tamaño ────────────────────────────────────────────────────────

/**
 * Tamaño máximo de un archivo: 10 MB (10 × 1024 × 1024 bytes). Es la propuesta inicial y se
 * cambia acá, en un solo lugar: la base solo exige un tamaño positivo (CHECK
 * ck_documento_tamanio_positivo), así que cambiarlo no requiere migración.
 */
export const TAMANIO_MAXIMO_DOCUMENTO_BYTES = 10 * 1024 * 1024;

/** Formatos admitidos, por su tipo MIME (siempre en minúscula). */
export const TipoContenidoDocumento = z.enum(
  [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  { errorMap: () => ({ message: mensajeTipoContenido() }) },
);

export type TipoContenidoDocumento = z.infer<typeof TipoContenidoDocumento>;

/**
 * Cómo se nombra cada formato y con qué extensiones se reconoce (en minúscula, sin el punto), por
 * ejemplo para el `accept` de un selector de archivos.
 *
 * Ni la extensión ni el MIME que declara el navegador alcanzan para aceptar un archivo: el backend
 * tiene que verificar el contenido efectivo (la firma de los primeros bytes) y guardar el
 * `tipoContenido` que corresponde a ese contenido, no el declarado.
 */
export const FORMATOS_DE_DOCUMENTO: Readonly<
  Record<TipoContenidoDocumento, { etiqueta: string; extensiones: readonly string[] }>
> = {
  'application/pdf': { etiqueta: 'PDF', extensiones: ['pdf'] },
  'image/jpeg': { etiqueta: 'JPG', extensiones: ['jpg', 'jpeg'] },
  'image/png': { etiqueta: 'PNG', extensiones: ['png'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    etiqueta: 'DOCX',
    extensiones: ['docx'],
  },
};

/** "Se aceptan PDF, JPG, PNG y DOCX.", armado con `FORMATOS_DE_DOCUMENTO`. */
function mensajeTipoContenido(): string {
  const etiquetas = Object.values(FORMATOS_DE_DOCUMENTO).map((formato) => formato.etiqueta);
  const lista = `${etiquetas.slice(0, -1).join(', ')} y ${etiquetas[etiquetas.length - 1] ?? ''}`;
  return `El formato del archivo no está admitido. Se aceptan ${lista}.`;
}

// ─── Campos ───────────────────────────────────────────────────────────────────

/** Largo de la columna `Documento.nombreOriginal`. */
export const NOMBRE_ORIGINAL_MAX = 255;

/**
 * Nombre del archivo tal como llegó, recortado. Es un dato no confiable: se guarda solo para
 * mostrarlo (escapado) y nunca forma parte de la clave del almacenamiento ni de una ruta. Sin
 * caracteres de control y sin `/` ni `\`: un nombre de archivo no trae carpetas.
 */
export const NombreOriginalSchema = z
  .string({
    required_error: 'El nombre del archivo es obligatorio.',
    invalid_type_error: 'El nombre del archivo debe ser un texto.',
  })
  .trim()
  .min(1, { message: 'El nombre del archivo es obligatorio.' })
  .max(NOMBRE_ORIGINAL_MAX, {
    message: `El nombre del archivo no puede superar los ${NOMBRE_ORIGINAL_MAX} caracteres.`,
  })
  .refine(sinCaracteresDeControl, {
    message: 'El nombre del archivo no puede contener caracteres de control.',
  })
  .refine((nombre) => !/[/\\]/.test(nombre), {
    message: 'El nombre del archivo no puede contener / ni \\.',
  });

const MENSAJE_TAMANIO = `El archivo tiene que pesar más de 0 bytes y hasta ${TAMANIO_MAXIMO_DOCUMENTO_BYTES / (1024 * 1024)} MB.`;

/** Tamaño en bytes: entero, mayor que 0 y hasta `TAMANIO_MAXIMO_DOCUMENTO_BYTES`. */
export const TamanioDocumentoSchema = z
  .number({ required_error: MENSAJE_TAMANIO, invalid_type_error: MENSAJE_TAMANIO })
  .int({ message: MENSAJE_TAMANIO })
  .min(1, { message: MENSAJE_TAMANIO })
  .max(TAMANIO_MAXIMO_DOCUMENTO_BYTES, { message: MENSAJE_TAMANIO });

/** SHA-256 del contenido, en hexadecimal y en minúscula (como el CHECK de la base). */
export const Sha256Schema = z
  .string({ required_error: 'Falta el hash SHA-256 del archivo.' })
  .regex(/^[0-9a-f]{64}$/, {
    message: 'El hash SHA-256 debe tener 64 caracteres hexadecimales en minúscula.',
  });

// ─── Escritura ────────────────────────────────────────────────────────────────

/**
 * Un documento a registrar, con los datos que el backend obtiene DESPUÉS de recibir y leer el
 * archivo. No es el cuerpo del pedido HTTP (la carga es multipart y la define el bloque de
 * endpoints): `tipoContenido` es el detectado por el contenido y `tamanioBytes` y `sha256` los
 * calcula el backend; ninguno se toma de lo que informa el navegador. La clave del
 * almacenamiento la genera el backend y no forma parte de ningún contrato.
 *
 * El período usa los mismos rangos que la rendición (2020 a 2100, mes 1 a 12). No se le aplica el
 * tope de "hasta el mes siguiente" de la rendición: esa regla no está confirmada para documentos.
 */
export const DocumentoNuevoSchema = z.object({
  tipoDocumentoId: TipoDocumentoIdSchema,
  anio: AnioSchema,
  mes: MesSchema,
  nombreOriginal: NombreOriginalSchema,
  tipoContenido: TipoContenidoDocumento,
  tamanioBytes: TamanioDocumentoSchema,
  sha256: Sha256Schema,
});

export type DocumentoNuevoDto = z.infer<typeof DocumentoNuevoSchema>;

// ─── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Documento tal como lo devuelve la API. Es una entidad de lectura: valida la forma, no las reglas
 * de escritura (un formato que se deje de admitir no rompe un listado). `creadoEn` es la fecha de
 * carga. El hash y la clave del almacenamiento no salen: son detalles internos. El nombre del
 * tipo es el actual del catálogo (no una foto, a diferencia del ítem del checklist).
 */
export const DocumentoSchema = z.object({
  id: z.string().uuid(),
  tipoDocumento: z.object({
    id: z.string().uuid(),
    nombre: z.string(),
  }),
  anio: z.number().int(),
  mes: z.number().int(),
  nombreOriginal: z.string(),
  tipoContenido: z.string(),
  tamanioBytes: z.number().int().min(1),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type Documento = z.infer<typeof DocumentoSchema>;

// ─── Consulta ─────────────────────────────────────────────────────────────────

/**
 * Parámetros del repositorio de documentos (query string): `anio` y `mes` obligatorios (el
 * repositorio se consulta por período y los listados no se paginan) y `tipoDocumentoId`
 * opcional. Se entregan ya como números.
 */
export const ListarDocumentosQuerySchema = z.object({
  anio: enteroDeQuery(AnioSchema, MENSAJE_ANIO),
  mes: enteroDeQuery(MesSchema, MENSAJE_MES),
  tipoDocumentoId: z
    .string({ invalid_type_error: 'El tipo de documento debe ser un UUID válido.' })
    .uuid({ message: 'El tipo de documento debe ser un UUID válido.' })
    .optional(),
});

export type ListarDocumentosQuery = z.infer<typeof ListarDocumentosQuerySchema>;
