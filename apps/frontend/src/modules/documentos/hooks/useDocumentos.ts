import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';
import { manejarErrorGlobal } from '@/modules/auth/manejoGlobal';
import { CLAVE_SESION, confirmarSesion } from '@/modules/auth/sesion';
import {
  aplicarDocumento,
  candidatosQueryKey,
  cargarDocumento,
  detalleDocumentoQueryKey,
  documentosQueryKey,
  historialDeItemQueryKey,
  interpretarFalloDescarga,
  listaDocumentosQueryKey,
  listarCandidatos,
  listarDocumentos,
  obtenerDocumento,
  obtenerHistorialDeItem,
  reemplazarDocumentoDeItem,
  type FalloDeDescarga,
  type FiltrosDocumentos,
  type ItemDeRendicion,
} from '@/modules/documentos/api/documentos.api';
import { descargarDocumento } from '@/modules/documentos/descargarDocumento';
import { invalidarRendiciones } from '@/modules/rendiciones/hooks/invalidarRendiciones';

/**
 * Repositorio de un período. Como en el catálogo, mientras llega la respuesta de un filtro nuevo
 * se sigue mostrando la anterior (`isPlaceholderData`): la lista no se vacía al cambiar de mes.
 */
export function useDocumentos(filtros: FiltrosDocumentos, { enabled = true } = {}) {
  return useQuery({
    queryKey: listaDocumentosQueryKey(filtros),
    queryFn: ({ signal }) => listarDocumentos(filtros, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Un documento con sus aplicaciones. Sin `id`, no pide nada. */
export function useDocumento(id: string | null) {
  return useQuery({
    queryKey: detalleDocumentoQueryKey(id ?? ''),
    queryFn: ({ signal }) => obtenerDocumento(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Ítems donde se podría aplicar el documento. Sin `id`, no pide nada. */
export function useCandidatos(id: string | null) {
  return useQuery({
    queryKey: candidatosQueryKey(id ?? ''),
    queryFn: ({ signal }) => listarCandidatos(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Carga un documento. Al terminar, el repositorio se vuelve a pedir. */
export function useCargarDocumento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cargarDocumento,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
  });
}

export interface AplicacionPedida {
  documentoId: string;
  itemIds: readonly string[];
  /** Clientes de los ítems elegidos: sus rendiciones cambian (avance del checklist). */
  clienteIds: readonly string[];
}

/**
 * Aplica un documento a los ítems elegidos. Salga bien o mal, se vuelven a pedir los documentos
 * (repositorio, detalle y candidatos: un 409 significa que algo cambió), las rendiciones de los
 * clientes involucrados y la pantalla Rendiciones (cambia el avance). La mutación termina recién
 * cuando eso se volvió a pedir.
 */
export function useAplicarDocumento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentoId, itemIds }: AplicacionPedida) =>
      aplicarDocumento(documentoId, itemIds),
    onSettled: (_data, _error, { clienteIds }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
        ...clienteIds.map((clienteId) => invalidarRendiciones(queryClient, clienteId)),
      ]),
  });
}

/** Historial de documentos de un ítem. Sin ítem, no pide nada. */
export function useHistorialDeItem(item: ItemDeRendicion | null) {
  return useQuery({
    queryKey: historialDeItemQueryKey(item ?? { clienteId: '', rendicionId: '', itemId: '' }),
    queryFn: ({ signal }) =>
      obtenerHistorialDeItem(item?.rendicionId ?? '', item?.itemId ?? '', signal),
    enabled: item !== null,
  });
}

export interface ReemplazoPedido extends ItemDeRendicion {
  documentoId: string;
  /** La aplicación que la operadora vio como vigente. */
  aplicacionVigenteId: string;
}

/**
 * Reemplaza el documento vigente de un ítem. Sin reintentos. Salga bien o mal, se vuelven a pedir
 * los documentos (cambian sus aplicaciones vigentes), las rendiciones del cliente, con el detalle
 * y el historial, y la pantalla Rendiciones: un 409 significa que el ítem cambió y hay que mostrar
 * el vigente de ahora. La mutación termina recién cuando eso se volvió a pedir.
 */
export function useReemplazarDocumentoDeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rendicionId, itemId, documentoId, aplicacionVigenteId }: ReemplazoPedido) =>
      reemplazarDocumentoDeItem(rendicionId, itemId, { documentoId, aplicacionVigenteId }),
    retry: false,
    onSettled: (_data, _error, { clienteId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
        invalidarRendiciones(queryClient, clienteId),
      ]),
  });
}

/** Lo que hace falta para descargar un documento: el id y el nombre con que se guarda. */
export interface DocumentoADescargar {
  id: string;
  nombreOriginal: string;
}

/**
 * Pasa el error de una descarga al manejo global, como cualquier pedido de la app (HU4.4, CA12):
 * un 401 confirma la sesión, un 403 de permiso la revalida, y un 503 o la falta de red no la
 * tocan. Sin contexto: la descarga no es un envío (no quedó nada "sin guardar") ni una consulta
 * que se pueda volver a pedir sola.
 *
 * Dice si hay que avisar el fallo en la pantalla. Un 401 solo se avisa si la sesión sigue (era
 * atrasado, o no se pudo confirmar): si terminó, la guarda lleva a `/login` con su motivo, y un
 * aviso acá lo contradiría.
 */
async function avisarFalloDeDescarga(
  queryClient: QueryClient,
  error: unknown,
  fallo: FalloDeDescarga,
): Promise<boolean> {
  manejarErrorGlobal(queryClient, error);
  if (fallo.tipo !== 'sin-sesion') return true;
  // Ya sin sesión (otro pedido la terminó antes): de eso se ocupa la guarda.
  if (queryClient.getQueryData(CLAVE_SESION) === null) return false;
  // Se suma a la confirmación que acaba de empezar el manejo global: no hace otro pedido.
  const auth = clasificarErrorDeAuth(error);
  const vencida = auth.clase === 'sin-sesion' && auth.vencida;
  return confirmarSesion(queryClient, {
    motivo: vencida ? 'vencida' : 'terminada',
    sinGuardar: false,
  });
}

/**
 * Descargas a través del backend, con los documentos que están descargándose (sus botones
 * muestran la espera) y sin repetir una que ya está en curso. `onFallo` decide cómo avisarlo, con
 * el motivo (`mensajeFalloDescarga`); si la sesión terminó, no se lo llama.
 */
export function useDescargas(
  onFallo: (documento: DocumentoADescargar, fallo: FalloDeDescarga) => void,
) {
  const queryClient = useQueryClient();
  const [idsDescargando, setIdsDescargando] = useState<readonly string[]>([]);
  // Las que están en curso, también entre dos clics que llegan antes de volver a renderizar.
  const enCurso = useRef(new Set<string>());
  const descargar = async (documento: DocumentoADescargar) => {
    if (enCurso.current.has(documento.id)) return;
    enCurso.current.add(documento.id);
    setIdsDescargando((previos) => [...previos, documento.id]);
    try {
      await descargarDocumento(documento);
    } catch (error) {
      const fallo = interpretarFalloDescarga(error);
      if (await avisarFalloDeDescarga(queryClient, error, fallo)) onFallo(documento, fallo);
    } finally {
      enCurso.current.delete(documento.id);
      setIdsDescargando((previos) => previos.filter((id) => id !== documento.id));
    }
  };
  return { idsDescargando, descargar };
}
