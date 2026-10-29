// Endpoints de documentos (HU2.8, contrato 4.10). Conoce el contrato de la API (rutas, cuerpos y
// formato de error), pero no produce texto de interfaz: eso lo deciden los componentes. La
// clave del almacenamiento y el hash nunca llegan acá: la API no los expone.

import {
  CAMPO_ARCHIVO_DOCUMENTO,
  CandidatoAplicacionSchema,
  DocumentoConAplicacionesSchema,
  DocumentoResumenSchema,
  ResultadoCargaDocumentoSchema,
  type CandidatoAplicacion,
  type DocumentoConAplicaciones,
  type DocumentoResumen,
  type ResultadoCargaDocumento,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  mensajeDelServidor,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';

/** Prefijo de todas las queries de documentos: el repositorio, los detalles y los candidatos. */
export const documentosQueryKey = ['documentos'] as const;

/** Filtros del repositorio: el período es obligatorio (la API no lista sin él). */
export interface FiltrosDocumentos {
  anio: number;
  mes: number;
  tipoDocumentoId?: string | undefined;
}

export const listaDocumentosQueryKey = ({ anio, mes, tipoDocumentoId }: FiltrosDocumentos) =>
  [
    ...documentosQueryKey,
    'lista',
    { anio, mes, tipoDocumentoId: tipoDocumentoId ?? null },
  ] as const;

export const detalleDocumentoQueryKey = (id: string) =>
  [...documentosQueryKey, 'detalle', id] as const;

export const candidatosQueryKey = (id: string) =>
  [...documentosQueryKey, 'candidatos', id] as const;

const conSenal = (signal?: AbortSignal) => (signal ? { signal } : {});

/** `GET /documentos?anio&mes[&tipoDocumentoId]`. Del más nuevo al más viejo (lo ordena la API). */
export async function listarDocumentos(
  { anio, mes, tipoDocumentoId }: FiltrosDocumentos,
  signal?: AbortSignal,
): Promise<DocumentoResumen[]> {
  const params = new URLSearchParams({ anio: String(anio), mes: String(mes) });
  if (tipoDocumentoId !== undefined) params.set('tipoDocumentoId', tipoDocumentoId);
  const response = await http(`/documentos?${params.toString()}`, conSenal(signal));
  return DocumentoResumenSchema.array().parse(await response.json());
}

/** `GET /documentos/:id`: el documento con todas sus aplicaciones, vigentes y reemplazadas. */
export async function obtenerDocumento(
  id: string,
  signal?: AbortSignal,
): Promise<DocumentoConAplicaciones> {
  const response = await http(`/documentos/${encodeURIComponent(id)}`, conSenal(signal));
  return DocumentoConAplicacionesSchema.parse(await response.json());
}

/** `GET /documentos/:id/candidatos`: ítems pendientes compatibles, ordenados para agrupar. */
export async function listarCandidatos(
  id: string,
  signal?: AbortSignal,
): Promise<CandidatoAplicacion[]> {
  const response = await http(`/documentos/${encodeURIComponent(id)}/candidatos`, conSenal(signal));
  return CandidatoAplicacionSchema.array().parse(await response.json());
}

export interface DocumentoACargar {
  archivo: File;
  tipoDocumentoId: string;
  anio: number;
  mes: number;
}

/**
 * `POST /documentos` (multipart). Sin `Content-Type` a mano: el navegador lo arma con el
 * `boundary` del formulario. El servidor valida el contenido real del archivo; acá no se lo lee.
 */
export async function cargarDocumento({
  archivo,
  tipoDocumentoId,
  anio,
  mes,
}: DocumentoACargar): Promise<ResultadoCargaDocumento> {
  const formulario = new FormData();
  formulario.set('tipoDocumentoId', tipoDocumentoId);
  formulario.set('anio', String(anio));
  formulario.set('mes', String(mes));
  formulario.set(CAMPO_ARCHIVO_DOCUMENTO, archivo, archivo.name);
  const response = await http('/documentos', { method: 'POST', body: formulario });
  return ResultadoCargaDocumentoSchema.parse(await response.json());
}

/** `POST /documentos/:id/aplicaciones`: todo o nada. Devuelve el documento actualizado. */
export async function aplicarDocumento(
  id: string,
  itemIds: readonly string[],
): Promise<DocumentoConAplicaciones> {
  const response = await http(`/documentos/${encodeURIComponent(id)}/aplicaciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds }),
  });
  return DocumentoConAplicacionesSchema.parse(await response.json());
}

/** `GET /documentos/:id/archivo`: el contenido, siempre a través del backend. */
export async function descargarArchivo(id: string): Promise<Blob> {
  const response = await http(`/documentos/${encodeURIComponent(id)}/archivo`, {
    headers: { Accept: '*/*' },
  });
  return response.blob();
}

// ─── Errores ──────────────────────────────────────────────────────────────────

const esFalloHttp = (error: unknown, status: number): error is ApiClientError =>
  error instanceof ApiClientError && error.kind === 'http' && error.status === status;

const motivoDe = (details: unknown): unknown => (esObjeto(details) ? details.motivo : undefined);

/** Por qué falló una carga. El texto lo arma la interfaz. */
export type FalloDeCarga =
  /** El archivo no pasó la validación del servidor (formato, extensión, tamaño, nombre). */
  | { tipo: 'archivo'; mensaje: string | null }
  | { tipo: 'demasiado-grande' }
  | { tipo: 'tipo-inexistente' }
  /** El tipo está desactivado y no hay ítems pendientes de ese tipo en el período. */
  | { tipo: 'tipo-inactivo' }
  /** El almacenamiento no respondió: no se registró nada y se puede reintentar. */
  | { tipo: 'almacenamiento' }
  | { tipo: 'conexion' }
  | { tipo: 'inesperado' };

export function interpretarFalloCarga(error: unknown): FalloDeCarga {
  if (error instanceof ApiClientError && error.kind === 'network') return { tipo: 'conexion' };
  if (esFalloHttp(error, 413)) return { tipo: 'demasiado-grande' };
  if (esFalloHttp(error, 503)) return { tipo: 'almacenamiento' };
  if (esFalloHttp(error, 404)) return { tipo: 'tipo-inexistente' };
  const cuerpo = error instanceof ApiClientError ? leerCuerpoDeError(error.payload) : null;
  if (esFalloHttp(error, 409) && motivoDe(cuerpo?.details) === 'TIPO_DOCUMENTO_INACTIVO') {
    return { tipo: 'tipo-inactivo' };
  }
  if (esFalloHttp(error, 400)) {
    const deArchivo = leerDetallesInvalidos(cuerpo?.details).find(
      (detalle) => detalle.campo === CAMPO_ARCHIVO_DOCUMENTO,
    );
    if (deArchivo !== undefined) {
      return { tipo: 'archivo', mensaje: mensajeDelServidor(deArchivo.mensaje) };
    }
  }
  return { tipo: 'inesperado' };
}

/** Motivos de un 409 al aplicar (contrato 4.10). */
export type MotivoDeRechazoDeAplicacion =
  'ITEM_NO_PENDIENTE' | 'RENDICION_ANULADA' | 'TIPO_DOCUMENTO_DISTINTO' | 'PERIODO_DISTINTO';

const MOTIVOS: readonly MotivoDeRechazoDeAplicacion[] = [
  'ITEM_NO_PENDIENTE',
  'RENDICION_ANULADA',
  'TIPO_DOCUMENTO_DISTINTO',
  'PERIODO_DISTINTO',
];

/** Por qué falló una aplicación. */
export type FalloDeAplicacion =
  /** Un ítem dejó de cumplir; `itemId` es el primero que no cumple (si la API lo informó). */
  | { tipo: 'rechazado'; motivo: MotivoDeRechazoDeAplicacion; itemId: string | null }
  /** El documento o algún ítem ya no existe. */
  | { tipo: 'no-existe' }
  | { tipo: 'conexion' }
  | { tipo: 'inesperado' };

export function interpretarFalloAplicacion(error: unknown): FalloDeAplicacion {
  if (error instanceof ApiClientError && error.kind === 'network') return { tipo: 'conexion' };
  if (esFalloHttp(error, 404)) return { tipo: 'no-existe' };
  if (esFalloHttp(error, 409)) {
    const details = leerCuerpoDeError(error.payload)?.details;
    const motivo = MOTIVOS.find((conocido) => conocido === motivoDe(details));
    if (motivo !== undefined) {
      const itemId =
        esObjeto(details) && typeof details.itemId === 'string' ? details.itemId : null;
      return { tipo: 'rechazado', motivo, itemId };
    }
  }
  return { tipo: 'inesperado' };
}
