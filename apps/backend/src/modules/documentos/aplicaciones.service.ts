import { Prisma } from '@prisma/client';
import {
  HistorialDeItemSchema,
  type DocumentoConAplicaciones,
  type HistorialDeItem,
  type RendicionDetalle,
} from '@realpolitik/shared';

import { conflict, notFound, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';
import { enTransaccionSerializable, obtenerRendicion } from '../rendiciones/rendiciones.service';

import { CON_TIPO, toDocumentoDto } from './documento.mapper';
import { obtenerDocumento } from './documentos.service';

/**
 * Aplicar un documento a ítems del checklist y reemplazar el documento de un ítem (HU2.8,
 * ADR-0004). Las aplicaciones son historial: nunca se borran ni se reescriben, salvo marcar la
 * anterior como reemplazada. Un ítem está completado si y solo si tiene una aplicación vigente:
 * las dos cosas se escriben en la misma transacción.
 *
 * Concurrencia, en transacciones serializables (`enTransaccionSerializable`, con reintento ante
 * P2034):
 * - Las rendiciones involucradas se bloquean con `FOR SHARE`. La anulación no corre en
 *   serializable y aplicar no escribe la rendición, así que sin el bloqueo PostgreSQL no vería el
 *   choque: con él, una anulación en curso espera a que esto termine, o esto se reintenta y ve la
 *   rendición anulada.
 * - Dos pedidos sobre el mismo ítem: el índice único parcial de la aplicación vigente rechaza al
 *   segundo (P2002) y se reintenta. Ahí ve el ítem ya completado y responde el 409 que corresponde.
 */

/** Índice único parcial: una sola aplicación vigente por ítem. */
const INDICE_VIGENTE = 'uq_aplicacion_documento_item_vigente';

/** Reintentos ante el P2002 de una carrera (además de los P2034 de la transacción). */
const INTENTOS = 3;

/**
 * P2002 de una carrera entre aplicaciones: el índice de la vigente o el único de `reemplazaAId`.
 * Con un índice creado en SQL, Prisma informa el nombre o las columnas, según la versión.
 */
function esCarreraDeAplicaciones(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const campos = Array.isArray(target)
    ? target.filter((campo): campo is string => typeof campo === 'string')
    : typeof target === 'string'
      ? [target]
      : [];
  return campos.some(
    (campo) =>
      campo.includes(INDICE_VIGENTE) ||
      campo.includes('itemChecklistId') ||
      campo.includes('reemplazaAId'),
  );
}

/** Corre `operacion` y la repite si perdió una carrera contra otra aplicación (P2002). */
async function conReintentoAnteCarrera<T>(operacion: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento += 1) {
    try {
      return await operacion();
    } catch (error) {
      if (!esCarreraDeAplicaciones(error) || intento >= INTENTOS) {
        throw error;
      }
    }
  }
}

/** Bloquea las rendiciones contra una anulación simultánea hasta que termine la transacción. */
async function bloquearRendiciones(
  tx: Prisma.TransactionClient,
  rendicionIds: readonly string[],
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Rendicion" WHERE id = ANY(${[...rendicionIds]}::uuid[]) FOR SHARE`;
}

const documentoNoEncontrado = (): AppError => notFound('Documento no encontrado');
const itemNoEncontrado = (): AppError => notFound('Ítem no encontrado');

/** Lo que se compara entre un documento y el ítem al que se aplica. */
interface DocumentoAComparar {
  tipoDocumentoId: string;
  anio: number;
  mes: number;
}

interface ItemAComparar {
  id: string;
  tipoDocumentoId: string;
  completado: boolean;
  rendicion: { anio: number; mes: number; isDeleted: boolean };
}

/**
 * Por qué el documento no se puede aplicar a este ítem, o `null` si se puede. Tipo según el
 * snapshot del ítem, período de la rendición y rendición activa. Un cliente inactivo no impide
 * nada: la rendición sigue activa.
 */
function motivoDeRechazo(documento: DocumentoAComparar, item: ItemAComparar): AppError | null {
  const datos = { itemId: item.id };
  if (item.rendicion.isDeleted) {
    return conflict('RENDICION_ANULADA', datos, 'La rendición del ítem está anulada');
  }
  if (item.tipoDocumentoId !== documento.tipoDocumentoId) {
    return conflict('TIPO_DOCUMENTO_DISTINTO', datos, 'El documento es de otro tipo que el ítem');
  }
  if (item.rendicion.anio !== documento.anio || item.rendicion.mes !== documento.mes) {
    return conflict('PERIODO_DISTINTO', datos, 'El documento es de otro período que la rendición');
  }
  return null;
}

// ─── Aplicar ──────────────────────────────────────────────────────────────────

/**
 * Aplica el documento a los ítems elegidos (contrato 4.10). Todo o nada: si un ítem no cumple, no
 * se aplica a ninguno y el 409 lleva el `itemId` del primero que no cumple, en el orden pedido.
 * Cada ítem tiene que ser del mismo tipo (su snapshot) y período que el documento, de una
 * rendición activa de un cliente no borrado, y estar pendiente. Puede haber varios de la misma
 * rendición. Responde con el documento y todas sus aplicaciones.
 */
export async function aplicarDocumento(
  documentoId: string,
  itemIds: readonly string[],
): Promise<DocumentoConAplicaciones> {
  await conReintentoAnteCarrera(() =>
    enTransaccionSerializable(async (tx) => {
      const documento = await tx.documento.findUnique({
        where: { id: documentoId },
        select: { tipoDocumentoId: true, anio: true, mes: true },
      });
      if (documento === null) {
        throw documentoNoEncontrado();
      }

      const items = await tx.itemChecklist.findMany({
        where: { id: { in: [...itemIds] }, rendicion: { cliente: { isDeleted: false } } },
        select: {
          id: true,
          tipoDocumentoId: true,
          completado: true,
          rendicion: { select: { id: true, anio: true, mes: true, isDeleted: true } },
          aplicaciones: { where: { reemplazadaEn: null }, select: { id: true } },
        },
      });
      const porId = new Map(items.map((item) => [item.id, item]));
      if (itemIds.some((id) => !porId.has(id))) {
        throw itemNoEncontrado();
      }
      await bloquearRendiciones(tx, [...new Set(items.map((item) => item.rendicion.id))]);

      for (const id of itemIds) {
        const item = porId.get(id);
        if (item === undefined) continue;
        const motivo = motivoDeRechazo(documento, item);
        if (motivo !== null) throw motivo;
        if (item.completado || item.aplicaciones.length > 0) {
          throw conflict('ITEM_NO_PENDIENTE', { itemId: id }, 'El ítem ya tiene un documento');
        }
      }

      const ahora = new Date();
      await tx.aplicacionDocumento.createMany({
        data: itemIds.map((itemChecklistId) => ({
          documentoId,
          itemChecklistId,
          tipoDocumentoId: documento.tipoDocumentoId,
          aplicadaEn: ahora,
        })),
      });
      const { count } = await tx.itemChecklist.updateMany({
        where: { id: { in: [...itemIds] }, completado: false },
        data: { completado: true, completadoAt: ahora },
      });
      // Ya se comprobó que estaban pendientes: si no coincide, otra escritura se coló en el medio
      // y la transacción entera se deshace.
      if (count !== itemIds.length) {
        throw conflict('ITEM_NO_PENDIENTE', {}, 'Un ítem dejó de estar pendiente');
      }
    }),
  );
  return obtenerDocumento(documentoId);
}

// ─── Reemplazar ───────────────────────────────────────────────────────────────

/**
 * Reemplaza el documento vigente de un ítem (contrato 4.10). `aplicacionVigenteId` es la que la
 * operadora vio como vigente: si ya no lo es (otro la reemplazó en el medio), `409
 * APLICACION_DESACTUALIZADA` con la vigente actual, sin escribir nada. La anterior recibe
 * `reemplazadaEn` y la nueva la apunta con `reemplazaAId`. El ítem sigue completado (con su fecha
 * original). Las aplicaciones del documento anterior en otros ítems no se tocan. Solo en una
 * rendición activa. Responde con la rendición, como la corrección del canal.
 */
export async function reemplazarDocumentoDeItem(
  rendicionId: string,
  itemId: string,
  { documentoId, aplicacionVigenteId }: { documentoId: string; aplicacionVigenteId: string },
): Promise<RendicionDetalle> {
  await conReintentoAnteCarrera(() =>
    enTransaccionSerializable(async (tx) => {
      // Un ítem de otra rendición, o de un cliente borrado, no existe para esta.
      const item = await tx.itemChecklist.findFirst({
        where: { id: itemId, rendicionId, rendicion: { cliente: { isDeleted: false } } },
        select: {
          id: true,
          tipoDocumentoId: true,
          completado: true,
          rendicion: { select: { id: true, anio: true, mes: true, isDeleted: true } },
          aplicaciones: { where: { reemplazadaEn: null }, select: { id: true, documentoId: true } },
        },
      });
      if (item === null) {
        throw itemNoEncontrado();
      }
      await bloquearRendiciones(tx, [item.rendicion.id]);

      const documento = await tx.documento.findUnique({
        where: { id: documentoId },
        select: { tipoDocumentoId: true, anio: true, mes: true },
      });
      if (documento === null) {
        throw documentoNoEncontrado();
      }
      const motivo = motivoDeRechazo(documento, item);
      if (motivo !== null) throw motivo;

      const [vigente] = item.aplicaciones;
      if (vigente?.id !== aplicacionVigenteId) {
        throw conflict(
          'APLICACION_DESACTUALIZADA',
          { aplicacionVigenteId: vigente?.id ?? null },
          'El documento del ítem cambió: volvé a cargar la rendición',
        );
      }
      if (vigente.documentoId === documentoId) {
        throw conflict('DOCUMENTO_YA_VIGENTE', {}, 'Ese documento ya es el vigente del ítem');
      }

      const ahora = new Date();
      const { count } = await tx.aplicacionDocumento.updateMany({
        where: { id: vigente.id, itemChecklistId: itemId, reemplazadaEn: null },
        data: { reemplazadaEn: ahora },
      });
      if (count !== 1) {
        throw conflict('APLICACION_DESACTUALIZADA', {}, 'El documento del ítem cambió');
      }
      await tx.aplicacionDocumento.create({
        data: {
          documentoId,
          itemChecklistId: itemId,
          tipoDocumentoId: documento.tipoDocumentoId,
          aplicadaEn: ahora,
          reemplazaAId: vigente.id,
        },
      });
      // El ítem ya estaba completado (tenía una vigente). Si por un dato viejo no lo estaba, se
      // corrige acá: con una aplicación vigente, el ítem está completado.
      if (!item.completado) {
        await tx.itemChecklist.update({
          where: { id: itemId },
          data: { completado: true, completadoAt: ahora },
        });
      }
    }),
  );
  return obtenerRendicion(rendicionId);
}

// ─── Historial ────────────────────────────────────────────────────────────────

/**
 * Todas las aplicaciones de un ítem, de la más reciente a la más vieja, con su documento. También
 * de una rendición anulada: es historial. Un ítem sin documentos tiene la lista vacía.
 */
export async function historialDeItem(
  rendicionId: string,
  itemId: string,
): Promise<HistorialDeItem> {
  const item = await prisma.itemChecklist.findFirst({
    where: { id: itemId, rendicionId, rendicion: { cliente: { isDeleted: false } } },
    select: {
      id: true,
      aplicaciones: {
        include: { documento: { include: CON_TIPO } },
        orderBy: [{ aplicadaEn: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      },
    },
  });
  if (item === null) {
    throw itemNoEncontrado();
  }
  return HistorialDeItemSchema.parse({
    itemChecklistId: item.id,
    aplicaciones: item.aplicaciones.map((aplicacion) => ({
      id: aplicacion.id,
      documentoId: aplicacion.documentoId,
      itemChecklistId: aplicacion.itemChecklistId,
      estado: aplicacion.reemplazadaEn === null ? 'VIGENTE' : 'REEMPLAZADA',
      aplicadaEn: aplicacion.aplicadaEn,
      reemplazadaEn: aplicacion.reemplazadaEn,
      reemplazaAId: aplicacion.reemplazaAId,
      documento: toDocumentoDto(aplicacion.documento),
    })),
  });
}
