import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { Prisma } from '@prisma/client';
import {
  compararItemsDeChecklist,
  DocumentoNuevoSchema,
  type CandidatoAplicacion,
  type CargarDocumentoDto,
  type DocumentoConAplicaciones,
  type DocumentoResumen,
  type ListarDocumentosQuery,
  type ResultadoCargaDocumento,
} from '@realpolitik/shared';

import { conflict, notFound, serviceUnavailable, validationError } from '../../errors/app-error';
import {
  esErrorAlmacenamiento,
  exigirClaveValida,
  generarClaveDocumento,
  type AlmacenamientoDocumentos,
  type ClaveAlmacenamiento,
} from '../../lib/almacenamiento/almacenamiento';
import { prisma } from '../../lib/prisma';

import { validarArchivo, type ArchivoRecibido } from './contenidoDeArchivo';
import {
  CON_TIPO,
  ITEM_UBICADO,
  toCandidatoDto,
  toDocumentoConAplicacionesDto,
  toDocumentoDto,
  toDocumentoResumenDto,
  type ItemUbicado,
} from './documento.mapper';

/**
 * Documentos cargados una vez y aplicables a varios clientes (HU2.8, ADR-0004). Este módulo
 * carga, consulta y busca candidatos; aplicar y reemplazar vienen después.
 *
 * El almacenamiento llega por parámetro (lo inyecta `createApp`): este módulo nunca elige ni
 * construye un proveedor. Ninguna operación de red ocurre dentro de una transacción de Prisma.
 */

const ALMACENAMIENTO_NO_DISPONIBLE =
  'El almacenamiento de documentos no está disponible. Intentá de nuevo en unos minutos.';

/**
 * Un error del almacenamiento, como error de la API. `NO_DISPONIBLE` es un 503 (se puede
 * reintentar); cualquier otro (`YA_EXISTE` con una clave aleatoria, `CLAVE_INVALIDA` de una fila
 * de la base, `NO_ENCONTRADO` de un documento registrado) es un error nuestro y sigue como 500.
 */
function traducirErrorDeAlmacenamiento(error: unknown): unknown {
  return esErrorAlmacenamiento(error, 'NO_DISPONIBLE')
    ? serviceUnavailable(ALMACENAMIENTO_NO_DISPONIBLE)
    : error;
}

/**
 * Ítems pendientes de un tipo en un período: de rendiciones ACTIVAS de clientes no borrados, sin
 * documento vigente. Se compara el `tipoDocumentoId` del ítem (su snapshot), no la matriz actual:
 * un requisito dado de baja o un tipo desactivado después de abrir la rendición no cambian qué se
 * pidió en ella.
 */
const itemsPendientes = (periodo: {
  tipoDocumentoId: string;
  anio: number;
  mes: number;
}): Prisma.ItemChecklistWhereInput => ({
  tipoDocumentoId: periodo.tipoDocumentoId,
  completado: false,
  aplicaciones: { none: { reemplazadaEn: null } },
  rendicion: {
    anio: periodo.anio,
    mes: periodo.mes,
    isDeleted: false,
    cliente: { isDeleted: false },
  },
});

/** Una aplicación de un cliente no borrado (como las rendiciones: de un cliente borrado, no hay). */
const DE_CLIENTE_VIGENTE = {
  itemChecklist: { rendicion: { cliente: { isDeleted: false } } },
} satisfies Prisma.AplicacionDocumentoWhereInput;

// ─── Carga ────────────────────────────────────────────────────────────────────

/**
 * Un tipo se puede usar para cargar si existe y está activo. Uno DESACTIVADO solo si todavía hay
 * ítems pendientes de ese tipo en el período: si no, esos ítems de rendiciones ya abiertas no se
 * podrían completar nunca. Sin pendientes, `409 TIPO_DOCUMENTO_INACTIVO`.
 */
async function exigirTipoUtilizable(periodo: {
  tipoDocumentoId: string;
  anio: number;
  mes: number;
}): Promise<void> {
  const tipo = await prisma.tipoDocumento.findUnique({
    where: { id: periodo.tipoDocumentoId },
    select: { activo: true },
  });
  if (tipo === null) {
    throw notFound('Tipo de documento no encontrado');
  }
  if (tipo.activo) return;
  const pendiente = await prisma.itemChecklist.findFirst({
    where: itemsPendientes(periodo),
    select: { id: true },
  });
  if (pendiente === null) {
    throw conflict(
      'TIPO_DOCUMENTO_INACTIVO',
      {},
      'El tipo de documento está desactivado y no hay ítems pendientes de ese tipo en el período',
    );
  }
}

/**
 * Si no se pudo registrar el documento, se borra el objeto ya guardado. Si también falla, queda
 * huérfano: privado y sin referencias. Se registra su clave (opaca: no revela nada) para
 * limpiarlo con la conciliación, y el error original sigue su curso.
 */
async function compensar(
  almacenamiento: AlmacenamientoDocumentos,
  clave: ClaveAlmacenamiento,
): Promise<void> {
  try {
    await almacenamiento.eliminar(clave);
  } catch (error) {
    const nombre = error instanceof Error ? error.name : 'desconocido';
    console.error(`No se pudo borrar el objeto ${clave} de una carga fallida (${nombre}).`);
  }
}

/**
 * Carga un documento (contrato 4.10): valida el archivo y el tipo, guarda el objeto y DESPUÉS
 * registra sus metadatos. No lo aplica a ningún ítem.
 *
 * El contenido repetido no se rechaza: los documentos ya cargados con el mismo SHA-256, tipo y
 * período vuelven en `posiblesDuplicados`, para ofrecer reutilizarlos.
 */
export async function cargarDocumento(
  almacenamiento: AlmacenamientoDocumentos,
  campos: CargarDocumentoDto,
  archivo: ArchivoRecibido,
): Promise<ResultadoCargaDocumento> {
  const tipoContenido = validarArchivo(archivo);
  const metadatos = DocumentoNuevoSchema.safeParse({
    ...campos,
    nombreOriginal: archivo.nombreOriginal,
    tipoContenido,
    tamanioBytes: archivo.contenido.length,
    sha256: createHash('sha256').update(archivo.contenido).digest('hex'),
  });
  if (!metadatos.success) {
    // Lo único que puede fallar acá es el nombre del archivo (el resto ya se validó o se calculó).
    throw validationError(
      metadatos.error.issues.map((issue) => ({ campo: 'archivo', mensaje: issue.message })),
    );
  }
  const datos = metadatos.data;

  await exigirTipoUtilizable(datos);
  const posiblesDuplicados = await prisma.documento.findMany({
    where: {
      sha256: datos.sha256,
      tipoDocumentoId: datos.tipoDocumentoId,
      anio: datos.anio,
      mes: datos.mes,
    },
    include: CON_TIPO,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const clave = generarClaveDocumento();
  try {
    await almacenamiento.guardar({ clave, contenido: archivo.contenido, tipoContenido });
  } catch (error) {
    throw traducirErrorDeAlmacenamiento(error);
  }

  let creado;
  try {
    creado = await prisma.documento.create({
      data: { ...datos, claveAlmacenamiento: clave },
      include: CON_TIPO,
    });
  } catch (error) {
    await compensar(almacenamiento, clave);
    throw error;
  }

  return {
    documento: toDocumentoDto(creado),
    posiblesDuplicados: posiblesDuplicados.map(toDocumentoDto),
  };
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/**
 * Documentos de un período (y tipo, si se pide), del más nuevo al más viejo, con cuántas
 * aplicaciones vigentes tienen en rendiciones activas.
 */
export async function listarDocumentos({
  anio,
  mes,
  tipoDocumentoId,
}: ListarDocumentosQuery): Promise<DocumentoResumen[]> {
  const filas = await prisma.documento.findMany({
    where: { anio, mes, ...(tipoDocumentoId !== undefined && { tipoDocumentoId }) },
    include: {
      ...CON_TIPO,
      _count: {
        select: {
          aplicaciones: {
            where: {
              reemplazadaEn: null,
              itemChecklist: { rendicion: { isDeleted: false, cliente: { isDeleted: false } } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return filas.map((fila) => toDocumentoResumenDto(fila, fila._count.aplicaciones));
}

/**
 * Un documento con todas sus aplicaciones: primero las vigentes y después las reemplazadas, cada
 * grupo de la más reciente a la más vieja. Las de rendiciones anuladas se incluyen (marcadas):
 * son historial.
 */
export async function obtenerDocumento(id: string): Promise<DocumentoConAplicaciones> {
  const documento = await prisma.documento.findUnique({
    where: { id },
    include: {
      ...CON_TIPO,
      aplicaciones: { where: DE_CLIENTE_VIGENTE, include: { itemChecklist: ITEM_UBICADO } },
    },
  });
  if (documento === null) {
    throw notFound('Documento no encontrado');
  }
  const aplicaciones = [...documento.aplicaciones].sort(
    (a, b) =>
      Number(a.reemplazadaEn !== null) - Number(b.reemplazadaEn !== null) ||
      b.aplicadaEn.getTime() - a.aplicadaEn.getTime() ||
      a.id.localeCompare(b.id),
  );
  return toDocumentoConAplicacionesDto(documento, aplicaciones);
}

export interface ArchivoDeDocumento {
  contenido: Readable;
  nombreOriginal: string;
  tipoContenido: string;
  tamanioBytes: number;
}

/**
 * El contenido de un documento, para descargarlo a través del backend. La clave sale de la base
 * y se vuelve a validar antes de usarla; nunca se expone.
 */
export async function obtenerArchivo(
  almacenamiento: AlmacenamientoDocumentos,
  id: string,
): Promise<ArchivoDeDocumento> {
  const documento = await prisma.documento.findUnique({
    where: { id },
    select: {
      nombreOriginal: true,
      tipoContenido: true,
      tamanioBytes: true,
      claveAlmacenamiento: true,
    },
  });
  if (documento === null) {
    throw notFound('Documento no encontrado');
  }
  try {
    const { contenido } = await almacenamiento.obtener(
      exigirClaveValida(documento.claveAlmacenamiento),
    );
    return {
      contenido,
      nombreOriginal: documento.nombreOriginal,
      tipoContenido: documento.tipoContenido,
      tamanioBytes: documento.tamanioBytes,
    };
  } catch (error) {
    throw traducirErrorDeAlmacenamiento(error);
  }
}

// ─── Candidatos ───────────────────────────────────────────────────────────────

/** Orden para agrupar en el front: cliente, rendición y, dentro de ella, el del checklist. */
function compararCandidatos(a: ItemUbicado, b: ItemUbicado): number {
  const clienteA = a.rendicion.cliente;
  const clienteB = b.rendicion.cliente;
  return (
    clienteA.denominacion.localeCompare(clienteB.denominacion, 'es') ||
    clienteA.id.localeCompare(clienteB.id) ||
    a.rendicion.numeroFactura.localeCompare(b.rendicion.numeroFactura, 'es') ||
    a.rendicion.id.localeCompare(b.rendicion.id) ||
    compararItemsDeChecklist(a, b)
  );
}

/**
 * Los ítems a los que se podría aplicar el documento: mismo tipo (el del snapshot del ítem), mismo
 * período, rendición activa e ítem pendiente. Incluye clientes INACTIVOS con rendiciones activas
 * (llevan su estado) y varias rendiciones del mismo cliente. Solo sugiere: no elige ninguno.
 */
export async function listarCandidatos(id: string): Promise<CandidatoAplicacion[]> {
  const documento = await prisma.documento.findUnique({
    where: { id },
    select: { tipoDocumentoId: true, anio: true, mes: true },
  });
  if (documento === null) {
    throw notFound('Documento no encontrado');
  }
  const items = await prisma.itemChecklist.findMany({
    where: itemsPendientes(documento),
    ...ITEM_UBICADO,
  });
  return items.sort(compararCandidatos).map(toCandidatoDto);
}
