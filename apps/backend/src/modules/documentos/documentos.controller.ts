import { pipeline } from 'node:stream/promises';

import type {
  AplicarDocumentoSchema,
  CandidatoAplicacion,
  CargarDocumentoSchema,
  DocumentoConAplicaciones,
  DocumentoResumen,
  HistorialDeItem,
  ListarDocumentosQuerySchema,
  ReemplazarDocumentoDeItemSchema,
  RendicionDetalle,
  ResultadoCargaDocumento,
} from '@realpolitik/shared';
import { CAMPO_ARCHIVO_DOCUMENTO } from '@realpolitik/shared';
import type { Request, Response } from 'express';

import { validationError } from '../../errors/app-error';
import type { AlmacenamientoDocumentos } from '../../lib/almacenamiento/almacenamiento';
import type { ValidatedLocals } from '../../middleware/validate';
import type {
  IdParamsSchema,
  ItemDeRendicionParamsSchema,
} from '../rendiciones/rendiciones.routes';

import {
  aplicarDocumento,
  historialDeItem,
  reemplazarDocumentoDeItem,
} from './aplicaciones.service';
import {
  cargarDocumento,
  listarCandidatos,
  listarDocumentos,
  obtenerArchivo,
  obtenerDocumento,
} from './documentos.service';
import { contentDispositionDeDescarga } from './nombreDeDescarga';

type CargarDocumentoLocals = ValidatedLocals<{ body: typeof CargarDocumentoSchema }>;
type ListarDocumentosLocals = ValidatedLocals<{ query: typeof ListarDocumentosQuerySchema }>;
type DocumentoLocals = ValidatedLocals<{ params: typeof IdParamsSchema }>;

/** El nombre sin carpetas: un navegador viejo puede mandar la ruta completa (`C:\…\a.pdf`). */
const sinCarpetas = (nombre: string): string => nombre.split(/[\\/]/).pop() ?? '';

/** `POST /documentos` (multipart): el archivo en `req.file`, los campos ya validados. */
export function cargarDocumentoController(almacenamiento: AlmacenamientoDocumentos) {
  return async (req: Request, res: Response<ResultadoCargaDocumento, CargarDocumentoLocals>) => {
    const archivo = req.file;
    if (archivo === undefined) {
      throw validationError([
        { campo: CAMPO_ARCHIVO_DOCUMENTO, mensaje: 'Elegí el archivo del documento.' },
      ]);
    }
    const resultado = await cargarDocumento(almacenamiento, res.locals.validated.body, {
      nombreOriginal: sinCarpetas(archivo.originalname),
      tipoMimeDeclarado: archivo.mimetype,
      contenido: archivo.buffer,
    });
    res.status(201).json(resultado);
  };
}

export async function listarDocumentosController(
  _req: Request,
  res: Response<DocumentoResumen[], ListarDocumentosLocals>,
): Promise<void> {
  res.status(200).json(await listarDocumentos(res.locals.validated.query));
}

export async function obtenerDocumentoController(
  _req: Request,
  res: Response<DocumentoConAplicaciones, DocumentoLocals>,
): Promise<void> {
  res.status(200).json(await obtenerDocumento(res.locals.validated.params.id));
}

export async function listarCandidatosController(
  _req: Request,
  res: Response<CandidatoAplicacion[], DocumentoLocals>,
): Promise<void> {
  res.status(200).json(await listarCandidatos(res.locals.validated.params.id));
}

/**
 * `GET /documentos/:id/archivo`: el contenido pasa por el backend como stream, sin URLs del
 * proveedor. Siempre se descarga (`attachment`), con el MIME guardado y `nosniff`, y una CSP que
 * impide ejecutar nada si alguien lo abriera en el navegador. `no-store`: es un documento privado.
 */
export function descargarArchivoController(almacenamiento: AlmacenamientoDocumentos) {
  return async (_req: Request, res: Response<unknown, DocumentoLocals>) => {
    const archivo = await obtenerArchivo(almacenamiento, res.locals.validated.params.id);
    res.status(200).set({
      'Content-Type': archivo.tipoContenido,
      'Content-Length': String(archivo.tamanioBytes),
      'Content-Disposition': contentDispositionDeDescarga(archivo.nombreOriginal),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    try {
      await pipeline(archivo.contenido, res);
    } catch (error) {
      // `pipeline` ya cortó la respuesta: el cliente ve una descarga incompleta, no un archivo
      // truncado como si estuviera entero. Que el cliente cancele la descarga es normal.
      const codigo = (error as { code?: unknown }).code;
      if (codigo !== 'ERR_STREAM_PREMATURE_CLOSE') {
        const nombre = error instanceof Error ? error.name : 'desconocido';
        console.error(`Descarga de documento interrumpida (${nombre}).`);
      }
    }
  };
}

// ─── Aplicaciones (bloque 3B) ─────────────────────────────────────────────────

type AplicarDocumentoLocals = ValidatedLocals<{
  params: typeof IdParamsSchema;
  body: typeof AplicarDocumentoSchema;
}>;
type ItemLocals = ValidatedLocals<{ params: typeof ItemDeRendicionParamsSchema }>;
type ReemplazarLocals = ValidatedLocals<{
  params: typeof ItemDeRendicionParamsSchema;
  body: typeof ReemplazarDocumentoDeItemSchema;
}>;

export async function aplicarDocumentoController(
  _req: Request,
  res: Response<DocumentoConAplicaciones, AplicarDocumentoLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  res.status(200).json(await aplicarDocumento(params.id, body.itemIds));
}

export async function reemplazarDocumentoDeItemController(
  _req: Request,
  res: Response<RendicionDetalle, ReemplazarLocals>,
): Promise<void> {
  const { params, body } = res.locals.validated;
  res.status(200).json(await reemplazarDocumentoDeItem(params.id, params.itemId, body));
}

export async function historialDeItemController(
  _req: Request,
  res: Response<HistorialDeItem, ItemLocals>,
): Promise<void> {
  const { params } = res.locals.validated;
  res.status(200).json(await historialDeItem(params.id, params.itemId));
}
